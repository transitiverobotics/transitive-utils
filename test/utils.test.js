
const assert = require('assert');
const fs = require('fs');
const {expect} = require('expect'); // from jest

const { updateObject, DataCache, toFlatObject, topicToPath, topicMatch,
  versionCompare, getPackageVersionNamespace, pathToTopic, decodeJWT,
  mergeVersions, isSubTopicOf,
  setFromPath, getLogger, fetchURL, visit, wait, formatBytes,
  formatDuration, findPath, tryJSONParse,
  forMatchIterator
} = require('../index');
const Mongo = require('../mongo/index');

const log = getLogger('utils.test');

describe('topicMatch', function() {
  const topic = '/a123/b234/c345/d456';

  it('should do full matches', function() {
    assert(topicMatch(topic, topic));
    assert(!topicMatch('/a123/b234/wrong/d456', topic));
  });

  it('should do tail matches', function() {
    assert(topicMatch('/a123/b234', topic));
    assert(topicMatch('/#', topic));
    assert(!topicMatch('/a', topic));
    assert(!topicMatch('/a/#', topic));
    assert(!topicMatch('/a123/b234/wrong/#', topic));
  });

  it('should do wild-card matches and return result', function() {
    assert.deepEqual(topicMatch('/a123/+bpart/c345/d456', topic), {bpart: 'b234'});
    assert.deepEqual(topicMatch('/a123/+bpart', topic), {bpart: 'b234'});
    assert.deepEqual(topicMatch('/a123/+bpart/c345/+dpart', topic), {
      bpart: 'b234',
      dpart: 'd456'
    });
    assert(!topicMatch('/a123/+bpart/1345/+dpart', topic));
  });

  it('wildcards should match empty', function() {
    assert(topicMatch('/a/#', '/a'));
    assert(topicMatch('/a/b/#', '/a/b'));
    assert(topicMatch('/a/b/c/#', '/a/b'));
  });

  it('should match on over-specific selectors', function() {
    // because the place in the object described by the selector does get
    // affected by that key
    assert(topicMatch('/a/b/c', '/a/b'));
    assert(topicMatch('/a/b/c/#', '/a/b'));
    assert(!topicMatch('/a/b/c', '/a/b/d'));
    assert(!topicMatch('/a/b/c/#', '/a/b/d'));
  });

  it('should match path against topic', function() {
    assert(topicMatch(topicToPath(topic), topic));
    assert(!topicMatch(topicToPath('/a123/b234/wrong/d456'), topic));
  });

  it('should match path against topic', function() {
    assert(topicMatch(topic, topicToPath(topic)));
    assert(!topicMatch('/a123/b234/wrong/d456', topicToPath(topic)));
  });
});


describe('updateObject', function() {
  it('should resolve a/b/c/d', function() {
    assert.deepEqual(
      updateObject({}, {'/a/b/c/d': 1}),
      {a: {b: {c: {d: 1}}}}
    );
  });

  it('should update entire sub-objects', function() {
    assert.deepEqual(
      updateObject({a: {b: {c: {d: 1}}}}, {'/a/b/c': {d: 2, e: 3}}),
      {a: {b: {c: {d: 2, e: 3}}}}
    );
  });

  it('should unset null values', function() {
    assert.deepEqual(
      updateObject({a: {b: 1, c: 2}}, {'/a/b': null}),
      {a: {c: 2}}
    );
  });

  it('should remove empty sub-objects but leave root as {}', function() {
    assert.deepEqual(
      updateObject({a: {b: {c: 1}}}, {'/a/b/c': null}),
      {}
    );
  });
});


describe('DataCache', function() {
  it('should update', function() {
    const d = new DataCache();
    const changes = d.update(['a', 'b', 'c', 'd'], 1);
    assert.deepEqual(d.get(), {a: {b: {c: {d: 1}}}});
    assert.deepEqual(changes, {'/a/b/c/d': 1});
  });

  it('should unset empty', function() {
    const d = new DataCache({a: {b: {c: {d: 1}}}, a2: 1});
    const changes = d.update(['a', 'b', 'c', 'd'], null);
    assert.deepEqual(d.get(), {a2: 1});
    assert.deepEqual(changes, {'/a/b/c/d': null});
  });

  it('should handle unsetting last value', function() {
    const d = new DataCache({a: {b: {c: {d: 1}}}});
    const changes = d.update(['a', 'b', 'c', 'd'], null);
    assert.deepEqual(d.get(), {});
    assert.deepEqual(changes, {'/a/b/c/d': null});
  });

  it('should emit update events to subscribers', function(done) {
    const d = new DataCache({a: {b: {c: {d: 1}}}, a2: 1});
    let changes;
    d.subscribe((_changes) => setTimeout(() => {
        // this deferal is required so that the update function can return first,
        // and set the path variable
        assert.deepEqual(changes, _changes);
        done();
      }, 1));
    changes = d.update(['a', 'b', 'c', 'd'], 3);
  });

  it('should relay tags to event listeners on update', function(done) {
    const d = new DataCache({a: {b: {c: {d: 1}}}, a2: 1});
    let triggered = false;
    d.subscribe((_changes, tags) => {
      assert(tags.myTag);
      done();
    });
    d.update(['a', 'b', 'c', 'd'], 3, {myTag: true});
  });

  it('should return partial updates', function() {
    const d = new DataCache({a: {b: {c: {d: 1}}}});
    const changes = d.update(['a', 'b', 'c', 'e'], 2);
    assert.deepEqual(d.get(), {a: {b: {c: {d: 1, e: 2}}}});
    assert.deepEqual(changes, {'/a/b/c/e': 2});
  });

  /** this tests the core functionality of this class we care about */
  it('should replicate itself over a sync protocol', function() {
    const d1 = new DataCache();
    const d2 = new DataCache();
    // keeping d2 up-to-date with changes to d1 via patches; these patches
    // could be sent over the wire (e.g., over mqtt)
    d1.subscribe(changes => {
      for (let path in changes) {
        d2.update(path, changes[path]);
      }
    });
    d1.update(['a', 'b', 'c', 'd'], 1);
    d1.update(['a', 'b', 'e'], 2);
    assert.deepEqual(d1.get(), d2.get());

    d1.update(['a', 'b', 'e'], 3);
    assert.deepEqual(d1.get(), d2.get());

    d1.update(['a', 'b', 'c', 'd'], null);
    assert.deepEqual(d1.get(), d2.get());

    d1.update(['a', 'b', 'e'], null);
    assert.deepEqual(d1.get(), d2.get());

    d1.update(['a', 'b', 'e'], 4);
    assert.deepEqual(d1.get(), d2.get());
  });

  it('should replicate removals over a sync protocol', function() {
    const d1 = new DataCache();
    const d2 = new DataCache();
    // keeping d2 up-to-date with changes to d1 via patches; these patches
    // could be sent over the wire (e.g., over mqtt)
    d1.subscribe(changes => {
      for (let path in changes) {
        // console.log(path, changes[path]);
        d2.update(path, changes[path]);
      }
    });
    d1.update(['a', 'b', 'c', 'd'], 1);
    d1.update(['a', 'b', 'c'], null);
    assert.deepEqual(d1.get(), d2.get());
  });

  it('should emit null change events once', function(done) {
    const d1 = new DataCache({a: 1});
    d1.subscribe(changes => done());
    d1.update(['a'], null);
  });

  it('should emit null change events once, with subobject', function(done) {
    const d1 = new DataCache({a: {b: 1}});
    d1.subscribe(changes => done());
    d1.update(['a'], null);
  });

  it('should emit null change event from topic string', function(done) {
    const d1 = new DataCache({a: {b: 1}});
    d1.subscribe(changes => done());
    d1.update('/a', null);
  });

  it('should not emit repeated null change events', function(done) {
    const d1 = new DataCache({});
    let error;
    d1.subscribe(changes => error = 'repeated change event on null root');
    d1.update(['a'], null);
    setTimeout(() => done(error), 10);
  });

  it('should not emit repeated null change events for sub-trees either',
    function(done) {
      const d1 = new DataCache({a: {b: {c: 1}, d: 2}});
      d1.update(['a', 'b', 'c'], null);

      let error;
      d1.subscribe(changes => error = 'repeated change event on null' +
        JSON.stringify(d1.get()) + JSON.stringify(changes));
      d1.update(['a', 'b', 'c'], null);
      setTimeout(() => done(error), 10);
    });


  it('should support topics with and without starting or trailing slash', function() {
    const d = new DataCache({a: {b: {c: {d: 1}}}});
    const changes = d.updateFromTopic('a/b/c/e', 2);
    assert.deepEqual(d.get(), {a: {b: {c: {d: 1, e: 2}}}});
    assert.deepEqual(changes, {'/a/b/c/e': 2});

    const d2 = new DataCache({a: {b: {c: {d: 1}}}});
    const changes2 = d2.updateFromTopic('/a/b/c/e', 2);
    assert.deepEqual(d2.get(), {a: {b: {c: {d: 1, e: 2}}}});
    assert.deepEqual(changes2, {'/a/b/c/e': 2});

    const d3 = new DataCache({a: {b: {c: {d: 1}}}});
    const changes3 = d3.updateFromTopic('a/b/c/e/', 2);
    assert.deepEqual(d3.get(), {a: {b: {c: {d: 1, e: 2}}}});
    assert.deepEqual(changes3, {'/a/b/c/e': 2});
  });

  it('should filter', function() {
    const d = new DataCache({a: {b: {c: {d: 1, e: 2}}}});
    assert.deepEqual(d.filter(['a','b','c','d']), {a: {b: {c: {d: 1}}}});

    const d2 = new DataCache({a: {b: 2}, c: 1});
    assert.deepEqual(d2.filter(['a']), {a: {b: 2}});

    const d3 = new DataCache({a: {b: {c: 3}}, d: 1});
    assert.deepEqual(d3.filter(['+']), {a: {b: {c: 3}}, d: 1});

    const d4 = new DataCache({a: {b: {c: 3, d: 3}, e: {c: 3}}});
    assert.deepEqual(d4.filter(['a','*','c']), {a: {b: {c: 3}, e: {c: 3}}});
    assert.deepEqual(d4.filterByTopic('/a/+/c/'), {a: {b: {c: 3}, e: {c: 3}}});
    assert.deepEqual(d4.filterByTopic('/a/+named/c/'), {a: {b: {c: 3}, e: {c: 3}}});
    assert.deepEqual(d4.filterByTopic('/a/*/c/'), {a: {b: {c: 3}, e: {c: 3}}});

    assert.deepEqual(d.filter([]), {a: {b: {c: {d: 1, e: 2}}}});
  //
  });

  it('should ignore non-changes', function(done) {
    const d = new DataCache({a: {b: 1}});
    let error = false;
    d.subscribe(() => error = 'non-change update was not ignored');
    d.update(['a', 'b'], 1);
    d.update(['a'], {b: 1});
    setTimeout(() => done(error), 1);
  });

  /** --- subscribePath */
  describe('subscribePath', function() {
    it('should trigger subscribePath callbacks on relevent change', function(done) {
      const d = new DataCache({a: {b: 1, c: 2}, d: 3});
      d.subscribePath('/a/b', (value, key) => {
        assert.equal(value, 2);
        assert.equal(key, '/a/b');
        done();
      });
      d.update(['a', 'b'], 2);
    });

    it('should trigger subscribePath callbacks on sub-key changes', function(done) {
      const d = new DataCache({a: {b: 1, c: 2}, d: 3});
      d.subscribePath('/a/b', (value, key) => {
        assert.equal(value, 2);
        assert.equal(key, '/a/b/e');
        done();
      });
      d.update(['a', 'b', 'e'], 2);
    });

    it('should trigger subscribePath callbacks on sub-key changes with wildcards', function(done) {
      const d = new DataCache({a: {b: 1, c: 2}, d: 3});
      d.subscribePath('/+/b', (value, key) => {
        assert.equal(value, 2);
        assert.equal(key, '/a/b/e');
        done();
      });
      d.update(['a', 'b', 'e'], 2);
    });

    it('should trigger a single subscribePath callback when doing atomic update',
      function(done) {
        const d = new DataCache({a: {b: 1, c: 2}, d: 3});
        const keys = [];
        d.subscribePath('/a/b', (value, key) => {
          keys.push(key);
        });
        d.update(['a', 'b', 'e'], {e1: 1, e2: {e3: 3, e4: 4}});
        setTimeout(() => {
            // waiting until all change events have triggered, then check
            assert.deepEqual(keys, ['/a/b/e']);
            done();
          }, 30);
      });

    it('should trigger subscribePath callbacks on relevent change', function(done) {
      const d = new DataCache({a: {b: 1, c: 2}, d: 3});
      let error = false;
      d.subscribePath('/a/b', () => done('triggered an irrelevant change'));
      d.update(['a', 'c'], 1);
      setTimeout(() => done(error), 1);
    });

    it('should trigger subscribePath callbacks only on change', function(done) {
      const d = new DataCache({a: {b: 1, c: 2}, d: 3});
      let error = false;
      d.subscribePath('/a/b', () => error = 'triggered on non-change');
      d.update(['a', 'b'], 1);
      setTimeout(() => done(error), 1);
    });

    it('should trigger subscribePath callbacks with matches', function(done) {
      const d = new DataCache({a: {b: 1, c: 2}, d: 3});
      d.subscribePath('/a/+l2/e', (value, key, match) => {
        assert.equal(value, 2);
        assert.deepEqual(match, {l2: 'b'});
        done();
      });
      d.update(['a', 'b', 'e'], 2);
    });

    it('should trigger subscribePath callbacks also on first value', function(done) {
      const d = new DataCache();
      d.subscribePath('/a/+l2', (value, key, match) => {
        assert.equal(value, 1);
        assert.deepEqual(match, {l2: 'b'});
        done();
      });
      d.update(['a', 'b'], 1);
    });


    describe('triggers subscribePath callbacks on null (clear)', function() {
      it('with matches', function(done) {
        const d = new DataCache({a: {b: {c: 2}}, d: 3});
        d.subscribePath('/a/+l2/c', (value, key, match) => {
          assert.equal(value, null);
          assert.deepEqual(match, {l2: 'b'});
          done();
        });
        d.update(['a', 'b', 'c'], null);
      });

      it('on root', function(done) {
        const d = new DataCache({a: {b: {c: 2}}, d: 3});
        d.subscribePath('/a', (value, key, match) => {
          assert.equal(value, null);
          assert.deepEqual(key, '/a');
          done();
        });
        d.update(['a'], null);
      });

      it('on /a/b', function(done) {
        const d = new DataCache({a: {b: {c: 2}}});
        d.subscribePath('/a/b', (value, key, match) => {
          assert.equal(value, null);
          assert.deepEqual(key, '/a/b');
          done();
        });
        d.update(['a', 'b'], null);
      });

      it('on null of parent document', function(done) {
        const d = new DataCache({a: {b: {c: 2}}, d: 3});
        d.subscribePath('/a/b/c', (value, key, match) => {
          assert.equal(value, null);
          assert.deepEqual(key, '/a/b');
          done();
        });
        d.update(['a', 'b'], null);
      });
    });
  });

  describe('subscribePathFlat', function() {
    it('should flatten atomic changes', function(done) {
      const d = new DataCache({});
      // gets atomic updates
      d.subscribePath('/a', (value, key) => {
        assert.deepEqual(value, {b: 1});
        assert.equal(key, '/a');
      });
      // get flat updates
      d.subscribePathFlat('/a', (value, key) => {
        assert.equal(value, 1);
        assert.equal(key, '/a/b');
        done();
      });
      d.update(['a'], {b: 1});
    });

    it('should still populate matched', function(done) {
      const d = new DataCache({});
      d.subscribePathFlat('/a/+second/c', (value, key, matched) => {
        assert.equal(value, 2);
        assert.equal(key, '/a/b/c');
        assert.equal(matched.second, 'b');
        done();
      });
      d.update(['a'], {b: {c: 2}});
    });

    it('should ignore irrelevant changes', function(done) {
      const d = new DataCache({});
      let error = false;
      d.subscribePathFlat('/a/b/c', (value, key, matched) => {
        error = true;
      });
      d.update(['a'], {b: {d: 2}});
      setTimeout(() => done(error), 100);
    });

    it('should match on all places', function(done) {
      const d = new DataCache({});
      d.subscribePathFlat('/+first/+second/+third', (value, key, matched) => {
        assert.equal(value, 2);
        assert.equal(key, '/a/b/c');
        assert.deepEqual(matched, {first: 'a', second: 'b', third: 'c'});
        done();
      });
      d.update(['a'], {b: {c: 2}});
    });

    it('should match on all places with flat updates', function(done) {
      const d = new DataCache({});
      d.subscribePathFlat('/+first/+second/+third', (value, key, matched) => {
        assert.equal(value, 2);
        assert.equal(key, '/a/b/c');
        assert.deepEqual(matched, {first: 'a', second: 'b', third: 'c'});
        done();
      });
      d.update(['a', 'b', 'c'], 2);
    });
  });

  it('should not delete others', function() {
    const d = new DataCache();
    d.update(['a', 'b', 'c1'], 1);
    d.update(['a', 'b', 'c2'], 1);
    d.update(['a', 'b', 'c3'], 1);
    assert.deepEqual(d.get(), {a: {b: {c1: 1, c2: 1, c3: 1}}});
    d.update(['a', 'b', 'c1'], 1);
    assert.deepEqual(d.get(), {a: {b: {c1: 1, c2: 1, c3: 1}}});
  });


  it('should allow keys with dots', function() {
    const d = new DataCache();
    d.update(['a', 'b.b.b', 'c'], 1);
    assert.deepEqual(d.get(), {a: {'b.b.b': {c: 1}}});
    d.update(['a', 'b.b.b', 'c'], 2);
    assert.deepEqual(d.get(), {a: {'b.b.b': {c: 2}}});
  });

  it('should allow numeric keys with dots', function() {
    const d = new DataCache();
    d.update(['a', '0.1.2', 'c'], 1);
    assert.deepEqual(d.get(), {a: {'0.1.2': {c: 1}}});
    d.update(['a', '0.1.2', 'c'], 2);
    assert.deepEqual(d.get(), {a: {'0.1.2': {c: 2}}});
  });

  it('should trigger correctly on paths with dots', function(done) {
    const d = new DataCache();
    d.subscribePath('/a/+l1/#', (value, key, match) => {
      assert.equal(value, 2);
      assert.equal(key, '/a/0.1.2/c');
      assert.deepEqual(match, {l1: '0.1.2'});
      done();
    });
    d.update(['a', '0.1.2', 'c'], 2);
  });

  it('should trigger correctly on paths with dots at the end', function(done) {
    const d = new DataCache();
    d.subscribePath('/+l0/+l1', (value, key, match) => {
      assert.equal(value, 2);
      assert.equal(key, '/a/0.1.2');
      assert.deepEqual(match, {l0: 'a', l1: '0.1.2'});
      done();
    });
    d.update(['a', '0.1.2'], 2);
  });


  it('should interpret numbers as array indices', function() {
    const d = new DataCache();
    const changes = d.update(['a', '2'], 1);
    assert.deepEqual(d.get(), {a: [,, 1]});
    assert.deepEqual(changes, {'/a/2': 1});
  });

  // WIP:
  // it('should not interpret large numbers as array indices', function() {
  //   const d = new DataCache();
  //   const changes = d.update(['a', '500'], 1);
  //   assert.deepEqual(d.get(), {a: {'500': 1}});
  //   assert.deepEqual(changes, {'/a/500': 1});
  // });

  describe('forMatch', function() {
    const d = new DataCache({
      a: {
        b: {c: {d: 1}},
        b2: {c: 2, c2: [3]}
      },
      a2: 1
    });

    it('should visit each match', function(done) {
      let count = 0;
      d.forMatch('/+first/+second/c/#', (value, topic, {first, second}) => {
        assert.equal(first, 'a');
        assert(second);
        count++;
        if (count == 2) done();
      });
    });

    it('should ignore unnamed wildcards +', function(done) {
      let count = 0;
      d.forMatch('/+/+/c/#', (value, topic, matched) => {
        assert.deepEqual(matched, {});
        count++;
        if (count == 2) done();
      });
    });

    it('should ignore unnamed wildcards *', function(done) {
      let count = 0;
      d.forMatch('/*/*/c/#', (value, topic, matched) => {
        assert.deepEqual(matched, {});
        count++;
        if (count == 2) done();
      });
    });

    it('should imply a trailing hash', function(done) {
      let count = 0;
      d.forMatch('/*/*/c/', (value, topic, matched) => {
        assert.deepEqual(matched, {});
        count++;
        if (count == 2) done();
      });
    });

    it('should not visit non-matches', function() {
      let count = 0;
      d.forMatch('/+first/b/c/#', (value, topic, {first}) => {
        assert(topic[1] == 'b');
      });
    });
  });
});


describe('toFlatObject', function() {
  it('should handle deep objects', function() {
    const obj = {a: {b: {c: {d: 1}}}, a2: 1};
    assert.deepEqual(
      toFlatObject(obj),
      { '/a/b/c/d': 1, '/a2': 1 }
    );
  });

  it('should handle arrays', function() {
    const obj = {a: {b: [{c: {d: 1}}, {e: 3}]}, a2: 1};
    assert.deepEqual(
      toFlatObject(obj),
      { '/a/b/0/c/d': 1,
        '/a/b/1/e': 3,
        '/a2': 1 }
    );
  });

  it('should handle null values', function() {
    const obj = {a: null};
    assert.deepEqual(
      toFlatObject(obj),
      {'/a': null}
    );
  });

  it('should handle Dates as primitives', function() {
    const obj = {a: new Date()};
    assert.deepEqual(
      toFlatObject(obj),
      {'/a': obj.a}
    );
  });

  it('should keep escaped slashes', function() {
    const obj = {a: {'/c/d': 2}};
    assert.deepEqual(
      toFlatObject(obj),
      {'/a/%2Fc%2Fd': 2}
    );
  });
});


describe('topicToPath', function() {
  it('should handle leading slashes', function() {
    assert.deepEqual(topicToPath('/a/b/c/'), ['a', 'b', 'c']);
    assert.deepEqual(topicToPath('a/b/c/'), ['a', 'b', 'c']);
    assert.deepEqual(topicToPath('a/b/c'), ['a', 'b', 'c']);
    assert.deepEqual(topicToPath('a'), ['a']);
    assert.deepEqual(topicToPath('/a'), ['a']);
    assert.deepEqual(topicToPath('/'), []);
    assert.deepEqual(topicToPath(''), []);
  });
  it('should handle encoded slashes', function() {
    assert.deepEqual(topicToPath('aa%2Fbb/cc'), ['aa/bb', 'cc']);
    assert.deepEqual(topicToPath('aa%2Fbb%2Fcc'), ['aa/bb/cc']);
    assert.deepEqual(topicToPath('%2F'), ['/']);
  });
  it('should decode non-encoded special characters', function() {
    assert.deepEqual(topicToPath('myid/%02d_%s.txt'), ['myid', '%02d_%s.txt']);
  });
});

describe('pathToTopic', function() {
  it('should do the basics', function() {
    assert.equal(pathToTopic(['more']), '/more');
    assert.equal(pathToTopic(['more', 'something', 'else']), '/more/something/else');
    assert.equal(pathToTopic(['+','something','else']), '/+/something/else');
    assert.equal(pathToTopic(['more','+','something','else']), '/more/+/something/else');
    assert.equal(pathToTopic(['more','+']), '/more/+');
  });

  it('should reduce wildcards', function() {
    assert.equal(pathToTopic(['+myid','something','else']), '/+/something/else');
    assert.equal(pathToTopic(['more','+myid']), '/more/+');
    assert.equal(pathToTopic(['more','+myid','+yo','too']), '/more/+/+/too');
  });

  it('should encode slashes and percentage signs', function() {
    assert.equal(pathToTopic(['myid','something/%50 interesting','else']),
      '/myid/something%2F%2550 interesting/else');
  });

  it('should be the inverse of topicToPath', function() {
    const list = [
      ['myid','something/ 50% interesting','else'],
      ['my/id','some20%thing/intere/sting','el//s /e']
    ];
    list.forEach(path => assert.deepEqual(topicToPath(pathToTopic(path)), path));

    const list2 = [
      '/myid/something%2Finteresting/else',
      '/my%2Fid/something%2Fintere%2Fsting/el%2F%2Fs %2Fe'
    ];
    list2.forEach(topic => assert.equal(pathToTopic(topicToPath(topic)), topic));
  });
});


describe('versionCompare', function() {
  it('should work on any part', function() {
    assert(versionCompare('10.5.1', '2.50.1') > 0);
    assert(versionCompare('1.5.1', '1.4.2') > 0);
    assert(versionCompare('0.0.3', '0.0.2') > 0);
    assert(versionCompare('1.0.3', '0.0.2') > 0);
    assert.equal(versionCompare('1.3.1', '1.3.1'), 0);
    assert.equal(versionCompare('1.3.1-24', '1.3.1-24'), 0);
    assert(versionCompare('0.0.0', '0.0.0') == 0);
    assert(versionCompare('0.0.1', '0.0.2') < 0);
    assert(versionCompare('1.0.1', '1.0.2') < 0);
    assert(versionCompare('1.3.1', '1.4.2') < 0);
    assert(versionCompare('1.3.1-3', '1.4.2') < 0);
    assert(versionCompare('1.3.1-3', '1.3.1-4') < 0);
    assert(versionCompare('1.3.1-4', '1.3.1-3') > 0);
    assert(versionCompare('1.3.1', '1.3.1-3') > 0);
    // yes, because `-N` indicates "prerelease"
    assert(versionCompare('1.3.1', '1.3.1-0') > 0);
  });

  it('should sort an array of versions correctly', function() {
    const versions = ['3.45.2', '2.3.4', '56.8.9-21', '56.8.9-12', '0.1.4'];
    versions.sort(versionCompare);
    assert.deepEqual(versions,
      [
        '0.1.4',
        '2.3.4',
        '3.45.2',
        '56.8.9-12',
        '56.8.9-21',
      ]
    )
  });

  it('compares ranges based on minVersion', function() {
    assert(versionCompare('1.3.1', '1.3') > 0);
    assert(versionCompare('2.0', '1.0.1') > 0);
    assert(versionCompare('2.1', '2.0') > 0);
    assert(versionCompare('2.0.1', '2.0') > 0);
    assert(versionCompare('2', '1') > 0);
    assert(versionCompare('2.1', '2') > 0);
    assert(versionCompare('2.1', '2') > 0);
  });
});


describe('decodeJWT', function() {
  it('should decode payload', function() {
    const token = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJkZXZpY2UiOiJHYkdhMnlncXF6IiwiY2FwYWJpbGl0eSI6ImhlYWx0aC1tb25pdG9yaW5nIiwidXNlcklkIjoicG9ydGFsVXNlci1xRW1ZbjV0aWJvdktnR3ZTbSIsInZhbGlkaXR5Ijo0MzIwMCwiaWF0IjoxNjM3MDk3NzUxfQ.UZpWrXWncXOjUaidzCJG6nnRkk_5i3x4tQr4oYkBE64';
    const payload = decodeJWT(token);
    assert.deepEqual(payload, {
      device: 'GbGa2ygqqz',
      capability: 'health-monitoring',
      userId: 'portalUser-qEmYn5tibovKgGvSm',
      validity: 43200,
      iat: 1637097751
    });
  });
});


describe('mergeVersions', function() {
  it('should keep data from all versions, but use latest in conflict', function() {
    const data = {
      '1.2.3': {a: 1, b: 1},
      '1.2.4-12': {a: 3}, // note, this is a *lower* version than 1.2.4
      '1.2.4': {a: 2},
    };
    assert.deepEqual(mergeVersions(data), {a: 2, b: 1});
  });

  it('should work with sub-path', function() {
    const data = {
      '1.2.3': {x: {a: 1, b: 1}, y: 2},
      '1.2.4-12': {x: {a: 3}},
      '1.2.4': {x: {a: 2}},
    };
    assert.deepEqual(mergeVersions(data, 'x'), {x: {a: 2, b: 1}});
  });

  it('should do nothing on empty objects', function() {
    assert.deepEqual(mergeVersions({}, 'x'), {x: {}});
  });

  it('should do nothing on null', function() {
    assert.deepEqual(mergeVersions(null, 'x'), {x: null});
  });

  it('should do nothing on undefined', function() {
    assert.deepEqual(mergeVersions(undefined, 'x'), {x: undefined});
  });

  it('should respect maxVersion', function() {
    const data = {
      '1.2.3': {x: {a: 1, b: 1}, y: 2},
      '1.2.4-12': {x: {a: 3}},
      '1.2.4': {x: {a: 2}},
    };
    assert.deepEqual(mergeVersions(data, 'x', {maxVersion: '1.2.4-12'}),
      {x: {a: 3, b: 1}});
  });

  it('should respect maxVersion even if not present', function() {
    const data = {
      '1.2.3': {x: {a: 1, b: 1}, y: 2},
      '1.2.4-12': {x: {a: 3}},
      '1.2.4': {x: {a: 2}},
    };
    assert.deepEqual(mergeVersions(data, 'x', {maxVersion: '1.2.4-15'}),
      {x: {a: 3, b: 1}});
  });

  it('should respect minVersion', function() {
    const data = {
      '1.2.3': {x: {a: 1, b: 1}, y: 2},
      '1.2.4-12': {x: {a: 3}},
      '1.2.4': {x: {a: 2}},
    };
    assert.deepEqual(mergeVersions(data, 'x', {minVersion: '1.2.4-12'}),
      {x: {a: 2}});
  });

  it('should respect minVersion even if not present', function() {
    const data = {
      '1.2.3': {x: {a: 1, b: 1}, y: 2},
      '1.2.4-12': {x: {a: 3}},
      '1.2.4': {x: {a: 2}},
    };
    assert.deepEqual(mergeVersions(data, 'x', {minVersion: '1.2.4-11'}),
      {x: {a: 2}});
  });

  it('should respect min- and maxVersion at the same time', function() {
    const data = {
      '1.2.3': {x: {a: 1, b: 1}, y: 2},
      '1.2.4-12': {x: {a: 3}},
      '1.2.4': {x: {a: 2}},
    };
    assert.deepEqual(
      mergeVersions(data, 'x', {minVersion: '1.2.4-12', maxVersion: '1.2.4-12'}),
      {x: {a: 3}});
  });

  it('should respect min- and maxVersion at the same time even if not present',
    function() {
      const data = {
        '1.2.3': {x: {a: 1, b: 1}, y: 2},
        '1.2.4-12': {x: {a: 3}},
        '1.2.4': {x: {a: 2}},
      };
      assert.deepEqual(
        mergeVersions(data, 'x', {minVersion: '1.2.4-11', maxVersion: '1.2.4-13'}),
        {x: {a: 3}});
    });

  it('should return the empty object if minVersion > maxVersion',
    function() {
      const data = {
        '1.2.3': {x: {a: 1, b: 1}, y: 2},
        '1.2.4-12': {x: {a: 3}},
        '1.2.4': {x: {a: 2}},
      };
      assert.deepEqual(
        mergeVersions(data, 'x', {minVersion: '1.2.4-13', maxVersion: '1.2.4-11'}),
        {x: {}});
    });
});


describe('isSubTopicOf', function() {
  it('should work on simple examples', function() {
    assert(isSubTopicOf('/a/b/c', '/a/b'));
    assert(isSubTopicOf('/a', '/'));

    assert(!isSubTopicOf('/a', '/a/'));
    assert(!isSubTopicOf('/a', '/a'));
    assert(!isSubTopicOf('a/d', '/a/d'));
    assert(!isSubTopicOf('/a/d/c', '/a/b'));
    assert(!isSubTopicOf('/a/d', '/a/b'));
  });
});


const test = it; // for jest syntax in mocha
describe('setFromPath', () => {
  test('simple set', () => {
    const x = {};
    setFromPath(x, ['a', 'b'], 1);
    expect(x).toStrictEqual({a: {b: 1}});
  });

  test('handles numbers as keys', () => {
    const x = {};
    setFromPath(x, ['a', 4, 'b'], 1);
    expect(x).toStrictEqual({a: {4: {b: 1}}});
  });

  test('handles empty paths', () => {
    const x = {};
    setFromPath(x, [], 1);
    expect(x).toStrictEqual({});
  });

  test('handles complex cases with updates', () => {
    const x = {};
    setFromPath(x, ['a', 4, 'b'], 1);
    setFromPath(x, ['a', 5, 'b'], 1);
    setFromPath(x, ['a', 5, 'b'], 2);
    setFromPath(x, ['b', 'c'], 2);
    expect(x).toStrictEqual({
      a: {
        4: {b: 1},
        5: {b: 2}
      },
      b: {
        c: 2
      }
    });
  });
});

describe('Mongo', function() {
  test('is defined', () => {
    assert(Mongo.init);
  });
});

/* just visually check */
describe('logger', function() {
  it('prints logger output', function() {
    log.setLevel('trace');
    log.error('this is error');
    log.warn('this is warn');
    log.info('this is info');
    log.debug('this is debug');
    log.trace('this is trace');
    log.setLevel('info');

    const log2 = getLogger('logger2');
    log2.setLevel('debug');
    log2.error('this is error');
    log2.warn('this is warn');
    log2.info('this is info');
    log2.debug('this is debug');
    log2.setLevel('info');

    log.info('done');
  });
});

describe('fetchURL', function() {
  it('gets example.com', async function() {
    const result = await fetchURL('https://example.com');
    assert(result.length > 0);
  });
});

describe('visit', function() {
  const obj = {
    value: '1',
    children: [
      {value: '1.1'},
      {value: '1.2', children: [
        {value: '1.2.1'}
      ]},
      {value: '1.3', children: [
        {value: '1.3.1'},
        {value: '1.3.2'}
      ]},
    ]
  };

  it('visits in prefix traversal order', function() {
    const inOrder = [];
    visit(obj, 'children', node => inOrder.push(node.value));
    assert.deepEqual(inOrder,
      ['1', '1.1', '1.2', '1.2.1', '1.3', '1.3.1', '1.3.2']);
  });
});

describe('wait', function() {
  it('can wait', async function() {
    const start = Date.now();
    await wait(1000);
    assert(Date.now() - start >= 1000);
  });
});

describe('formatting', function() {
  it('formats bytes', async function() {
    assert.equal(formatBytes(100), '100.00 B');
    assert.equal(formatBytes(2048), '2.00 KB');
    assert.equal(formatBytes(1234567), '1.18 MB');
  });

  it('formats durations', async function() {
    assert.equal(formatDuration(10), '10s');
    assert.equal(formatDuration(200), '3m 20s');
    assert.equal(formatDuration(4600), '1h 16m');
  });
});

describe('findPath', function() {

  const cwd = process.cwd();

  it('find it in starting dir', async function() {
    // set up a directory tree for testing
    const tmp = fs.mkdtempSync('/tmp/');
    fs.mkdirSync(`${tmp}/a/certs`, {recursive: true});
    process.chdir(`${tmp}/a`);

    assert.equal(findPath('certs'), `${tmp}/a/certs`);
    fs.rmSync(tmp, {recursive: true, forced: true});
  });

  it('find it in upper dir', async function() {
    const tmp = fs.mkdtempSync('/tmp/');
    fs.mkdirSync(`${tmp}/a/b`, {recursive: true});
    fs.mkdirSync(`${tmp}/a/certs`, {recursive: true});
    process.chdir(`${tmp}/a/b`);
    assert.equal(findPath('certs'), `${tmp}/a/certs`);
    fs.rmSync(tmp, {recursive: true, forced: true});
  });

  it('returns null when none is found', async function() {
    const tmp = fs.mkdtempSync('/tmp/');
    fs.mkdirSync(`${tmp}/a/b/c/d`, {recursive: true});
    process.chdir(`${tmp}/a/b/c/d`);

    assert.equal(findPath('certs'), null);
    fs.rmSync(tmp, {recursive: true, forced: true});
  });

});


describe('getPackageVersionNamespace', function() {
  const cases = [
    {ns: null, version: '1.2.3', correct: '1.2.3'},
    {ns: 'patch', version: '1.2.3', correct: '1.2.3'},
    {ns: 'minor', version: '1.2.3', correct: '1.2'},
    {ns: 'major', version: '1.2.3', correct: '1'},
  ];

  cases.forEach(({ns, version, correct}) => {
    it(`works for ${ns}`, function() {
      process.env.npm_package_config_versionNamespace = ns;
      process.env.npm_package_version = version;
      assert.equal(getPackageVersionNamespace(), correct);
    });
  });
});

describe('tryJSONParse', function() {
  it('handles failures', function() {
    assert.equal(tryJSONParse(null), null);
    assert.equal(tryJSONParse(''), null);
    assert.equal(tryJSONParse(undefined), null);
    assert.equal(tryJSONParse('this is not json'), null);
    assert.equal(tryJSONParse('{a: "this is not json either"}'), null);
  });

  it('handles basics', function() {
    assert.equal(tryJSONParse('true'), true);
    assert.equal(tryJSONParse('false'), false);
    assert.equal(tryJSONParse('1'), 1);
    assert.equal(tryJSONParse('\"abc\"'), 'abc');
  });

  it('handles objects and arrays', function() {
    assert.deepEqual(tryJSONParse('{"a": 1}'), {a: 1});
    assert.deepEqual(tryJSONParse('[1,2,3]'), [1,2,3]);
  });

  it('handles Buffers', function() {
    assert.equal(tryJSONParse(Buffer.from('')), null);
    assert.equal(tryJSONParse(Buffer.alloc(0)), null);
    assert.equal(tryJSONParse(Buffer.from('true')), true);
    assert.deepEqual(tryJSONParse(Buffer.from('{"a": 1}')), {a: 1});
  });
});


describe('forMatchIterator', function() {
  const obj = {
    a: {
      b: {c: 'abc'},
      c: {d: 'acd'}
    },
    b: {
      c: 'bc'
    }
  };

  it('matches static values', function(done) {
    forMatchIterator(obj, ['b', 'c'], (value, path, match) => {
      assert.equal(value, 'bc');
      assert.deepEqual(path, ['b', 'c']);
      done();
    });
  });

  it('matches wildcards', function(done) {
    forMatchIterator(obj, ['+first', 'b', 'c'], (value, path, match) => {
      assert.equal(value, 'abc');
      assert.equal(match.first, 'a');
      assert.deepEqual(path, ['a', 'b', 'c']);
      done();
    });
  });
});