
const _ = {
  get: require('lodash/get'),
  set: require('lodash/set'),
  unset: require('lodash/unset'),
  forEach: require('lodash/forEach'),
  map: require('lodash/map'),
  isEmpty: require('lodash/isEmpty'),
  eq: require('lodash/isEqual'),
  isPlainObject: require('lodash/isPlainObject'),
  merge: require('lodash/merge'),
};

const {topicToPath, pathToTopic, toFlatObject, pathMatch, forMatchIterator}
  = require('./common');

/** Unset the topic in that obj, and clean up parent if empty, recursively.
Return the path to the removed node.
*/
const unset = (obj, path) => {
  if (!path || path.length == 0) return;
  _.unset(obj, path);
  const parentPath = path.slice(0, -1);
  // _.get doesn't do the intuitive thing for the empty path, handle it ourselves
  const parent = parentPath.length == 0 ? obj : _.get(obj, parentPath);
  if (_.isEmpty(parent)) {
    return unset(obj, parentPath);
  } else {
    return path;
  }
};

/** given a modifier {"a/b/c": "xyz"} update the object `obj` such that
obj.a.b.c = "xyz" */
const updateObject = (obj, modifier) => {
  _.forEach( modifier, (value, topic) => {
    const path = topicToPath(topic);
    if (value == null) {
      unset(obj, path);
    } else {
      _.set(obj, path, value);
    }
  });
  return obj;
};

/** given an object and a path with wildcards (* and +), *modify* the object
  to only contain elements matched by the path, e.g.,
  {a: {b: 1, c: 2}, d: 2} and ['a','+'] would give {a: {b: 1, c: 2}}
*/
const selectFromObject = (obj, path) => {
  if (path.length == 0) return;
  const next = path[0];
  if (next) {
    for (let key in obj) {
      if (key != next && next != '*' && !next.startsWith('+')) {
        delete obj[key];
      } else {
        selectFromObject(obj[key], path.slice(1));
      }
    }
  }
};


class DataCache {

  #data = {};
  #listeners = [];
  #flatListeners = [];

  constructor(data = {}) {
    this.#data = data;
  }

  /** update the object with the given value at the given path, remove empty;
    return the flat changes (see toFlatObject). Add `tags` to updates to mark
    them somehow based on the context, e.g., so that some subscriptions can choose
  to ignore updates with a certain tag.
  */
  updateFromArray(path, value, tags = {}) {
    // const empty = Object.keys(this.#data).length == 0; // object already empty
    const current = _.get(this.#data, path);
    if (value == null) {
      if (current === undefined || current === null) {
        return {}; // no change, do not call listeners
      } else {
        unset(this.#data, path);
      }
    } else {
      if (_.eq(current, value)) {
        // note: this is just a shallow equal, so replacing a sub-document
        // with an atomic copy of it should still trigger listeners.
        // TODO: Note also that when value is an object, we will set it by
        // reference here, so any changes made to that object will *not* trigger
        // listeners because `current` will already be changed -- which is
        // probably wrong. May want to always clone value first.
        return {}; // nothing to do, do not bother listeners
      }
      // console.log('setting', path, value);
      _.set(this.#data, path, value);
      // TODO: implement this ourselves so we can do better change-checking
    }

    const topic = pathToTopic(path);
    const obj = {[topic]: value};

    // flatten the value and combine eith topic (without reflattening the topic):
    let flatChanges;
    if (value instanceof Object) {
      const flatValue = toFlatObject(value);
      flatChanges = {};
      _.forEach(flatValue, (atomic, flatKey) => {
        flatChanges[`${topic}${flatKey}`] = atomic;
      });
    } else {
      flatChanges = obj;
    }

    // option 1. using flat changes (sub-documents are never atomic)
    // this.#listeners.forEach(fn => fn(flatChanges));

    // option 2. allow atomic sub-document changes
    this.#listeners.forEach(fn => fn(obj, tags));

    this.#flatListeners.forEach(fn => fn(flatChanges, tags));

    return flatChanges;
  }

  /** update the value at the given path (array or dot separated string) */
  update(path, value, tags) {
    if (typeof path == 'string') {
      return this.updateFromTopic(path, value, tags);
    } else if (path instanceof Array) {
      return this.updateFromArray(path, value, tags);
    } else {
      throw new Error('unrecognized path expression');
    }
  }

  /** set value from the given topic (with or without leading or trailing slash) */
  updateFromTopic(topic, value, tags) {
    return this.updateFromArray(topicToPath(topic), value, tags);
  }

  /** update data from a modifier object where keys are topic names to be
    interpreted as paths, and values are the values to set */
  updateFromModifier(modifier, tags) {
    return _.map(modifier, (value, topic) =>
      this.updateFromTopic(topic, value, tags));
  }

  /** add a callback for change events */
  subscribe(callback) {
    if (callback instanceof Function) {
      this.#listeners.push(callback);
    } else {
      console.warn('DataCache.subscribe expects a function as argument. Did you mean to use subscribePath?');
    }
  }

  /** Subscribe to a specific topic only. Unlike in `subscribe`, here callback
  only receives the value. */
  subscribePath(topic, callback) {
    this.#listeners.push((changes, tags) => {
      _.forEach(changes, (value, key) => {
        const matched = pathMatch(topic, key);
        matched && callback(value, key, matched, tags);
      });
    });
  }

  /** Same as subscribePath but always get all changes in flat form */
  subscribePathFlat(topic, callback) {
    this.#flatListeners.push((changes, tags) => {
      _.forEach(changes, (value, key) => {
        const matched = pathMatch(topic, key);
        matched && callback(value, key, matched, tags);
      });
    });
  }

  /** remove a callback */
  unsubscribe(callback) {
    this.#listeners = this.#listeners.filter(f => f != callback);
  }

  /** get sub-value at path, or entire object if none given */
  get(path = []) {
    return path.length == 0 ? this.#data : _.get(this.#data, path);
  }

  getByTopic(topic) {
    return this.get(topicToPath(topic));
  }

  /** filter the object using path with wildcards */
  filter(path) {
    const rtv = JSON.parse(JSON.stringify(this.get()));
    selectFromObject(rtv, path);
    return rtv;
  }

  /** filter the object using topic with wildcards */
  filterByTopic(topic) {
    return this.filter(topicToPath(topic));
  }

  /** for each topic match, invoke the callback with the value, topic, and match
  just like subscribePath */
  forMatch(topic, callback) {
    const path = topicToPath(topic);
    this.forPathMatch(path, callback);
  }

  /** for each path match, invoke the callback with the value, topic, and match
  just like subscribePath */
  forPathMatch(path, callback) {
    forMatchIterator(this.get(), path, callback);
  }
};

module.exports = {
  DataCache, updateObject
}