
const assert = require('assert');
const Aedes = require('aedes');
const mqtt = require('mqtt');

const MqttSync = require('./common/MqttSync');
const { getLogger, DataCache, parseMQTTTopic, randomId, topicToPath, wait } =
  require('./index');

const loglevel = require('loglevel');
// log.getLogger('MqttSync.js').setLevel('debug');
const log = getLogger('test');
// loglevel.setAll('debug');
loglevel.setAll('info');
log.setLevel('debug');

const port = 9900;
const mqttURL = `mqtt://localhost:${port}`;

/* ---------------------------
  utility functions
*/

/** assert that mqttSync instances a and b are in sync, then call done */
const inSync = (a, b, done, delay = 50) => {
  setTimeout(() => {
      log.debug('A', a.data.get());
      log.debug('B', b.data.get());
      assert.deepEqual(b.data.get(), a.data.get());
      assert(a.publishQueue.size == 0);
      done();
    }, delay);
};

/* --------------------------- */

describe('MqttSync', function() {

  let server;
  let mqttClientA, mqttClientB;
  let clientA, clientB;
  let interval;
  let aedes;

  beforeEach(function(done) {
    // Start the local mqtt broker
    console.log('\n    ▶ ', this.currentTest?.title);

    aedes = Aedes({
      authenticate: (client, username, password, callback) => {
        // callback(null, username === 'skroob' && password === '12345')
        // console.log('auth', username, password);
        callback(null, true);
      },
      authorizePublish: (client, sub, callback) => {
        // callback(null, username === 'skroob' && password === '12345')
        // console.log('authorizePublish', sub);
        if (sub.topic.endsWith('notAllowed')) {
          // console.log('not allowing', sub);
          callback('not allowed', false);
        } else {
          callback(null, true);
        }
      },
    });
    // aedes.on('client', function (client) {
    //   console.log('new client', client.id);
    // })
    // aedes.on('publish', (packet, client) => {
    //   console.log('[aedes] publishing', packet);
    // });
    server = require('net').createServer(aedes.handle);
    server.listen(port, function () {
      // console.log('mqtt server started and listening on port ', port);

      mqttClientA = mqtt.connect(mqttURL);
      mqttClientB = mqtt.connect(mqttURL);
      mqttClientA.on('connect', () => mqttClientB.on('connect', () => {
        !clientA &&
          (clientA = new MqttSync({mqttClient: mqttClientA, ignoreRetain: true}));
        clientB = new MqttSync({mqttClient: mqttClientB, ignoreRetain: true});
        done();
      }));

      // Aedes doesn't by itself send these, so we will, like mosquitto does
      const start = Date.now();
      interval = setInterval(() => aedes.publish({
          topic: '$SYS/broker/uptime',
          payload: String((Date.now() - start)/1e3) + ' seconds'
        }), 200);
    });
  });

  afterEach(function(done) {
    clearInterval(interval);
    mqttClientA.end();
    mqttClientB.end();
    mqttClientA = null;
    mqttClientB = null;
    clientA = null;
    clientB = null;

    // console.log('shutting down mqtt server');
    server && server.listening && server.close(done);
  });

  /* ---------------------------------------------------------------- */

  it('does simple sync', function(done) {
    clientA.publish('/a/#');
    clientB.subscribe('/a/#');
    clientA.data.update('a', {b: 1});
    inSync(clientA, clientB, done);
  });

  it('does simple sync with 0\'s', function(done) {
    clientA.publish('/a/#');
    clientB.subscribe('/a/#');
    clientA.data.updateFromArray(['a', 'b'], 0);
    clientA.data.updateFromArray(['a', 'c', 'd'], 1);
    clientA.data.updateFromArray(['a', 'c', '2'], 0);
    inSync(clientA, clientB, done);
  });

  it('truncates huge messages in log', function(done) {
    clientA.publish('/a/#');
    clientB.subscribe('/a/#');
    clientA.data.update('a', {b: randomId(1000000)});
    inSync(clientA, clientB, done);
  });

  it('does not bleed from test to test', function(done) {
    clientB.subscribe('/a/#');
    setTimeout(() => {
        assert.deepEqual(clientB.data.get(), {});
        done();
      }, 30);
  });

  it('keeps track of published messages', function(done) {
    clientA.publish('/a/#');
    clientA.data.update('/a', {b: 1});
    clientA.data.update('/a/b', 2);
    clientA.data.update('/a/c', 3);
    clientA.data.update('/a/d/e', 4);
    setTimeout(() => {
        assert(clientA.publishedMessages['/a/b']);
        assert(clientA.publishedMessages['/a/c']);
        assert(clientA.publishedMessages['/a/d/e']);
        done();
      }, 20);
  });

  it('removes sub-document messages when setting sub-document (flat to atomic)',
    function(done) {
      clientA.publish('/a/#');
      clientB.subscribe('/a/#');
      clientA.data.update('/a/b/c', 1);
      clientA.waitForHeartbeatOnce(() => {
        clientA.data.update('/a/b', {c: 2});
        inSync(clientA, clientB, () => {
          console.log(clientA.publishedMessages);
          assert(clientA.publishedMessages['/a/b/c'] === null);
          done();
        });
      });
    });

  it('syncs nulls on sub-documents (atomic to flat, to atomic)', function(done) {
    clientA.publish('/a/#');
    clientB.subscribe('/a/#');
    clientA.data.update('/a', {d: 1});
    clientA.data.update('/a/b', {c: 1});
    clientA.data.update('/a/b', null);
    inSync(clientA, clientB, done);
  });

  it('replaces super-document messages (atomic to flat)', function(done) {
    clientA.publish('/a/#');
    clientB.subscribe('/a/#');
    clientA.data.update('/a/b', {c: 2});
    clientA.data.update('/a/b/c', 1);
    inSync(clientA, clientB, () => {
      console.log(clientA.publishedMessages);
      assert(clientA.publishedMessages['/a/b'] === null);
      done();
    });
  });

  it('syncs correctly when switching from atomic to flat', function(done) {
    clientA.publish('/a');
    clientB.subscribe('/a');
    clientA.data.update('/a', {b: {c: 1, d: 4}});
    clientA.data.update('/a/b/c', 2);
    clientA.data.update('/a/b/e', 3);
    inSync(clientA, clientB, done);
  });


  it('syncs when subscribing to super-document', function(done) {
    clientA.publish('/a/b');
    clientB.subscribe('/a');
    clientA.data.update('/a', {b: {c: 1}});
    inSync(clientA, clientB, done);
  });

  it('syncs when subscribing to sub-document once flat', function(done) {
    clientA.publish('/a/#');
    clientB.subscribe('/a/b/#');
    clientA.data.update('/a', {b: {c: 1, d: 4}});
    // Note: this ^^ alone actually doesn't work at the mqtt level, the way the
    // receiver is subscribing. But it works when going flat:
    clientA.data.update('/a/b/c', 2);
    inSync(clientA, clientB, done);
  });

  it('syncs when updating sub-document', function(done) {
    clientA.publish('/a');
    clientB.subscribe('/a');
    clientA.data.update('/a', {b: {c: 1, d: 4}, e: 1});
    clientA.data.update('/a/b', {c: 2, d: 5});
    inSync(clientA, clientB, done);
  });

  it('syncs when using atomic', function(done) {
    clientA.publish('/a', {atomic: true});
    clientB.subscribe('/a');
    clientA.data.update('/a', {b: {c: 1, d: 4}});
    clientA.data.update('/a/b/c', 2);
    clientA.data.update('/a/b/e', 3);
    inSync(clientA, clientB, done);
  });

  it('should ignore repeated publish calls for the same topic', function(done) {
    let clientC = new MqttSync({mqttClient: clientB.mqtt});
    clientA.publish('/a');
    assert(!clientA.publish('/a'));
    done();
  });


  it('publishs topics with wildcards', function(done) {
    clientA.publish('/+/b');
    clientB.subscribe('/a');
    clientA.data.update('/a/b/c', 2);
    inSync(clientA, clientB, done);
  });

  it('publishs topics with wildcards (atomic)', function(done) {
    clientA.publish('/+/b', {atomic: true});
    clientB.subscribe('/a');
    clientA.data.update('/a/b', {c: 1});
    clientA.data.update('/a/b/d', {e: 1});
    clientA.data.update('/a/b/f/g/h', 'somestring');
    inSync(clientA, clientB, done);
  });

  it('triggers onChange callback', function(done) {
    let clientC = new MqttSync({mqttClient: clientB.mqtt,
      onChange: () => done()
    });
    clientC.subscribe('/a');
    clientA.publish('/a');
    clientA.data.update('/a', 1);
  });

  it('triggers onChange callback (atomic)', function(done) {
    let clientC = new MqttSync({mqttClient: clientB.mqtt,
      onChange: () => done()
    });
    clientC.subscribe('/a');
    clientA.publish('/a', {atomic: true});
    clientA.data.update('/a', 1);
  });

  it('triggers onChange callback on null', function(done) {
    clientA.publish('/a');
    clientA.data.update('/a/b', 1);
    clientA.data.update('/a/c', 2);
    let clientC = new MqttSync({mqttClient: clientB.mqtt,
      onChange: (changes) => changes['/a/c'] == null && done(),
      ignoreRetain: true,
      onReady: () => {
        clientA.data.update('/a/c', null);
      }
    });
    clientC.subscribe('/a');
  });

  it('waits for heartbeats', function(done) {
    this.timeout(5000);
    clientA.waitForHeartbeatOnce(done);
  });

  it('triggers subscribePath callbacks on null (atomic)', function(done) {
    clientA.publish('/a/b', {atomic: true});
    clientB.subscribe('/a/b');
    clientA.data.update('/a/b', {c: 1});
    setTimeout(() => {
        clientB.data.subscribePath('/a/b', () => done());
        clientA.data.update('/a/b', null);
      }, 100);
  });

  it('triggers subscribePath callbacks on topics with slashes', function(done) {
    clientA.publish('/a');
    clientB.subscribe('/a');
    setTimeout(() => {
        clientB.data.subscribePath('/a', () => done());
        clientA.data.update(['a', 'b/c/d', 'e'], {f: 1});
      }, 100);
  });

  describe('migrate data', function() {
    it('migrates single topic', function(done) {
      clientA.publish('/uId/dId/@scope/capname/1.0.0');
      clientA.publish('/uId/dId/@scope/capname/1.1.0');
      clientA.subscribe('/uId/dId/@scope/capname/1.2.0/b/#');
      clientA.data.update('/uId/dId/@scope/capname/1.0.0/b', {c: 1, d: 1});
      clientA.data.update('/uId/dId/@scope/capname/1.1.0/b', {c: 2, e: 3});
      setTimeout(() => {
          let mqttClientC = mqtt.connect(mqttURL);
          let clientC = new MqttSync({
            mqttClient: mqttClientC,
            migrate: [{topic: '/uId/dId/@scope/capname/+/b', newVersion: '1.2.0'}],
            onReady: () => {
              log.debug('onReady');
              setTimeout(() => {
                  assert.deepEqual(
                    clientA.data.getByTopic('/uId/dId/@scope/capname/1.2.0/b'),
                    {c: 2, d: 1, e: 3});
                  mqttClientC.end();
                  mqttClientC = null;
                  clientC = null;
                  done();
                }, 300);
            }
          });
        }, 100);
    });

    it('migrates single topic with transform', function(done) {
      clientA.publish('/uId/dId/@scope/capname/1.0.0');
      clientA.publish('/uId/dId/@scope/capname/1.1.0');
      clientA.subscribe('/uId/dId/@scope/capname/1.2.0/b/#');
      clientA.data.update('/uId/dId/@scope/capname/1.0.0/b', {c: 1, d: 1});
      clientA.data.update('/uId/dId/@scope/capname/1.1.0/b', {c: 2, e: 3});
      setTimeout(() => {
          let mqttClientC = mqtt.connect(mqttURL);
          let clientC = new MqttSync({
            mqttClient: mqttClientC,
            migrate: [{
              topic: '/uId/dId/@scope/capname/1.1.0/b',
              newVersion: '1.2.0',
              transform: (merged) => {
                merged.newField = Object.keys(merged).sort();
                return merged;
              }
            }],
            onReady: () => {
              log.debug('onReady');
              setTimeout(() => {
                  assert.deepEqual(
                    clientA.data.getByTopic('/uId/dId/@scope/capname/1.2.0/b'),
                    {c: 2, d: 1, e: 3, newField: ['c','d','e']});
                  mqttClientC.end();
                  mqttClientC = null;
                  clientC = null;
                  done();
                }, 300);
            }
          });
        }, 100);
    });

    it('migrates single topic flat', function(done) {
      clientA.publish('/uId/dId/@scope/capname/1.0.0');
      clientA.publish('/uId/dId/@scope/capname/1.1.0');
      clientA.subscribe('/uId/dId/@scope/capname/1.2.0/b/#');
      clientA.data.update('/uId/dId/@scope/capname/1.0.0/b', {c: 1, d: 1});
      clientA.data.update('/uId/dId/@scope/capname/1.1.0/b', {c: 2, e: 3});
      const receivedTopics = {};
      clientA.mqtt.on('message', topic => receivedTopics[topic] = true);
      setTimeout(() => {
          let mqttClientC = mqtt.connect(mqttURL);
          let clientC = new MqttSync({
            mqttClient: mqttClientC,
            migrate: [{topic: '/uId/dId/@scope/capname/+/b', newVersion: '1.2.0',
              flat: true}],
            onReady: () => {
              log.debug('onReady');
              setTimeout(() => {
                  // was received flat:
                  ['c', 'd', 'e'].forEach(field => assert(receivedTopics[
                    `/uId/dId/@scope/capname/1.2.0/b/${field}`]));
                  assert(!receivedTopics['/uId/dId/@scope/capname/1.2.0/b']);
                  // and data is complete:
                  assert.deepEqual(
                    clientA.data.getByTopic('/uId/dId/@scope/capname/1.2.0/b'),
                    {c: 2, d: 1, e: 3});
                  mqttClientC.end();
                  mqttClientC = null;
                  clientC = null;
                  done();
                }, 300);
            }
          });
        }, 100);
    });

    it('migrates multiple topics', function(done) {
      clientA.publish('/uId/dId/@scope/capname/1.0.0');
      clientA.publish('/uId/dId/@scope/capname/1.1.0');
      clientA.subscribe('/uId/dId/@scope/capname/1.2.0/b/#');
      clientA.subscribe('/uId/dId/@scope/capname/1.2.0/c/#');
      clientA.data.update('/uId/dId/@scope/capname/1.0.0/b', {c: 1, d: 1});
      clientA.data.update('/uId/dId/@scope/capname/1.1.0/b', {c: 2, e: 3});
      clientA.data.update('/uId/dId/@scope/capname/1.1.0/c', {g: 2, h: 3});
      setTimeout(() => {
          let mqttClientC = mqtt.connect(mqttURL);
          let clientC = new MqttSync({
            mqttClient: mqttClientC,
            migrate: [
              {topic: '/uId/dId/@scope/capname/+/b', newVersion: '1.2.0'},
              {topic: '/uId/dId/@scope/capname/+/c', newVersion: '1.2.0'},
            ],
            onReady: () => {
              log.debug('onReady');
              setTimeout(() => {
                  assert.deepEqual(
                    clientA.data.getByTopic('/uId/dId/@scope/capname/1.2.0/b'),
                    {c: 2, d: 1, e: 3});
                  assert.deepEqual(
                    clientA.data.getByTopic('/uId/dId/@scope/capname/1.2.0/c'),
                    {g: 2, h: 3});
                  mqttClientC.end();
                  mqttClientC = null;
                  clientC = null;
                  done();
                }, 300);
            }
          });
        }, 100);
    });

    it('migrates topics at lower levels separately', function(done) {
      clientA.publish('/uId/dId/@scope/capname/1.0.0');
      clientA.publish('/uId/dId/@scope/capname/1.1.0');
      clientA.subscribe('/uId/dId/@scope/capname/1.2.0/b/#');
      clientA.data.update('/uId/dId/@scope/capname/1.0.0/b/a', {c: 1, d: 1});
      clientA.data.update('/uId/dId/@scope/capname/1.1.0/b/a', {c: 2, e: 3});
      clientA.data.update('/uId/dId/@scope/capname/1.1.0/b/b%2Fb', {'g/g': 2, h: 3});
      let failure = false;

      setTimeout(() => {
          clientA.mqtt.on('message', (topic) => {
            if (topic.startsWith('/')) {
              // throw and error if any message sent during migration it not at
              // right level:
              assert(topicToPath(topic).length == 7);
            }
          });

          let mqttClientC = mqtt.connect(mqttURL);
          let clientC = new MqttSync({
            mqttClient: mqttClientC,
            migrate: [
              {topic: '/uId/dId/@scope/capname/+/b', newVersion: '1.2.0', level: 1},
            ],
            onReady: () => {
              log.debug('onReady');
              setTimeout(() => {
                  assert.deepEqual(
                    clientA.data.getByTopic('/uId/dId/@scope/capname/1.2.0/b/a'),
                    {c: 2, d: 1, e: 3});
                  assert.deepEqual(
                    clientA.data.getByTopic('/uId/dId/@scope/capname/1.2.0/b/b%2Fb'),
                    {'g/g': 2, h: 3});

                  mqttClientC.end();
                  mqttClientC = null;
                  clientC = null;
                  done();
                }, 300);
            }
          });
        }, 100);
    });

    it('correctly migrates topics with escaped slashes', function(done) {
      clientA.publish('/uId/dId/@scope/capname/1.0.0');
      clientA.publish('/uId/dId/@scope/capname/1.1.0');
      clientA.subscribe('/uId/dId/@scope/capname/1.2.0/b/#');
      clientA.data.update('/uId/dId/@scope/capname/1.0.0/b/%2Fc%2Fd', 1);
      clientA.data.update('/uId/dId/@scope/capname/1.1.0/b/%2Fc%2Fd', 2);
      setTimeout(() => {
          let mqttClientC = mqtt.connect(mqttURL);
          let clientC = new MqttSync({
            mqttClient: mqttClientC,
            migrate: [{topic: '/uId/dId/@scope/capname/+/b',
              newVersion: '1.2.0', flat: true}],
            onReady: () => {
              log.debug('onReady');
              setTimeout(() => {
                  assert.deepEqual(
                    clientA.data.getByTopic('/uId/dId/@scope/capname/1.2.0/b'),
                    {['/c/d']: 2});
                  mqttClientC.end();
                  mqttClientC = null;
                  clientC = null;
                  done();
                }, 300);
            }
          });
        }, 100);
    });

    it('ignores future versions', function(done) {
      clientA.publish('/uId/dId/@scope/capname/1.0.0');
      clientA.publish('/uId/dId/@scope/capname/1.1.0');
      clientB.publish('/uId/dId/@scope/capname/1.3.0');
      clientA.subscribe('/uId/dId/@scope/capname/1.2.0/b/#');
      clientA.data.update('/uId/dId/@scope/capname/1.0.0/b', {c: 1, d: 1});
      clientA.data.update('/uId/dId/@scope/capname/1.1.0/b', {c: 2, e: 3});
      clientB.data.update('/uId/dId/@scope/capname/1.3.0/b', {c: 20});
      setTimeout(() => {
          let mqttClientC = mqtt.connect(mqttURL);
          let clientC = new MqttSync({
            mqttClient: mqttClientC,
            migrate: [{topic: '/uId/dId/@scope/capname/+/b', newVersion: '1.2.0'}],
            onReady: () => {
              log.debug('onReady');
              setTimeout(() => {
                  assert.deepEqual(
                    clientA.data.getByTopic('/uId/dId/@scope/capname/1.2.0/b'),
                    {c: 2, d: 1, e: 3});
                  mqttClientC.end();
                  mqttClientC = null;
                  clientC = null;
                  done();
                }, 300);
            }
          });
        }, 100);
    });

    it('cleans up after migration', function(done) {
      clientA.publish('/uId/dId/@scope/capname/1.0.0');
      clientA.publish('/uId/dId/@scope/capname/1.1.0');
      clientA.subscribe('/uId/dId/@scope/capname/1.2.0/b/#');
      clientA.data.update('/uId/dId/@scope/capname/1.0.0/b', {c: 1, d: 1});
      clientA.data.update('/uId/dId/@scope/capname/1.1.0/b', {c: 2, e: 3});
      setTimeout(() => {
          let mqttClientC = mqtt.connect(mqttURL);
          let clientC = new MqttSync({
            mqttClient: mqttClientC,
            migrate: [{topic: '/uId/dId/@scope/capname/+/b', newVersion: '1.2.0'}],
            onReady: () => {
              log.debug('onReady');
              setTimeout(() => {
                  assert.deepEqual(
                    clientA.data.getByTopic('/uId/dId/@scope/capname/1.2.0/b'),
                    {c: 2, d: 1, e: 3});
                  console.log('b', clientA.data.getByTopic('/uId/dId/@scope/capname/1.1.0/b'));
                  assert(
                    clientA.data.getByTopic('/uId/dId/@scope/capname/1.1.0/b')
                    == undefined);
                  mqttClientC.end();
                  mqttClientC = null;
                  clientC = null;
                  done();
                }, 300);
            }
          });
        }, 100);
    });

    it('does not fail on empty data', function(done) {
      // clientA.publish('/uId/dId/@scope/capname/1.0.0');
      // clientA.publish('/uId/dId/@scope/capname/1.1.0');
      // clientA.subscribe('/uId/dId/@scope/capname/1.2.0/b/#');
      // clientA.data.update('/uId/dId/@scope/capname/1.0.0/b', {c: 1, d: 1});
      // clientA.data.update('/uId/dId/@scope/capname/1.1.0/b', {c: 2, e: 3});
      setTimeout(() => {
          let mqttClientC = mqtt.connect(mqttURL);
          let clientC = new MqttSync({
            mqttClient: mqttClientC,
            migrate: [{topic: '/uId/dId/@scope/capname/+/b', newVersion: '1.2.0'}],
            onReady: () => {
              log.debug('onReady');
              mqttClientC.end();
              mqttClientC = null;
              clientC = null;
              done();
            }
          });
        }, 100);
    });
  });

  /** testing throttle and queue-merge:
    - send a lot of updates to the queue on similar and different topics
    - see same topic updates merged
    - see no more than RATE updates per minute per topic
  */
  it('does throttle', function(done) {
    clientA.publish('/a/#');
    clientA.setThrottle(300);
    clientB.subscribe('/a/#');
    let messages = 0;
    clientB.mqtt.on('message', (topic, payload) => {
      topic == '/a' && messages++;
    });
    clientA.data.update('a', {b: 1});
    setTimeout(() => {
        clientA.data.update('a', {b: 2});
        clientA.data.update('a', {b: 3});
        clientA.data.update('a', {b: 4});
        clientA.data.update('a', {b: 5});
        clientA.data.update('a', {b: 6});
        clientA.data.update('a', {b: 7});
      }, 100);
    inSync(clientA, clientB, () => {
        assert.equal(messages, 3);
        // 2 would be ideal, but there seems to be some duplicate messages
        done();
      }, 500);
  });

  it('calls onReady', function(done) {
    mqttClientA.end();
    mqttClientB.end();
    clientA = null;
    clientB = null;

    let mqttClientC = mqtt.connect(mqttURL);
    let clientC = new MqttSync({
      mqttClient: mqttClientC,
      onReady: () => {
        mqttClientC.end();
        mqttClientC = null;
        clientC = null;
        done();
      }
    });
  });

  it('calls onReady with migrate', function(done) {
    clientA.publish('/uId/dId/@scope/capname/1.0.0');
    clientA.publish('/uId/dId/@scope/capname/1.1.0');
    clientA.subscribe('/uId/dId/@scope/capname/1.2.0/b/#');
    clientA.data.update('/uId/dId/@scope/capname/1.0.0/b', {c: 1, d: 1});
    clientA.data.update('/uId/dId/@scope/capname/1.1.0/b', {c: 2, e: 3});

    let mqttClientC = mqtt.connect(mqttURL);
    let clientC = new MqttSync({
      mqttClient: mqttClientC,
      migrate: [{
        topic: '/uId/dId/@scope/capname/1.1.0/b',
        newVersion: '1.2.0'}],
      onReady: () => {
        console.log('Ready');
        mqttClientC.end();
        mqttClientC = null;
        clientC = null;

        mqttClientA.end();
        mqttClientB.end();
        clientA = null;
        clientB = null;

        done();
      }
    });
  });

  it('does sliceTopic', function(done) {
    clientA.publish('/#');
    let mqttClientC = mqtt.connect(mqttURL);
    let clientC = new MqttSync({
      mqttClient: mqttClientC,
      sliceTopic: 2,
      onReady: () => {
        console.log('Ready');
        assert.deepEqual(clientC.data.get(), clientA.data.get().a.a);
        mqttClientC.end();
        mqttClientC = null;
        clientC = null;
        done();
      }
    });
    clientC.subscribe('/#');
    clientA.data.update('/a/a/b', {c: 1})
  });

  it('key-prefixes do not break key', function(done) {
    clientA.publish('/a/#');
    clientB.subscribe('/a/#');
    clientA.data.update('/a/b', 'good');
    clientA.data.update('/a/b-2', 'good');
    clientA.data.update('/a/b-3', 'good');
    inSync(clientA, clientB, done);
  });


  /** test cases that arise when both publishing and subscribing to the
  same or overlapping topics */
  describe('subscribe to published topics', function() {

    /** checks that we record external changes to the data such that when we
    subsequently make another change to it, e.g., deleting it, we will publish
  that. */
    it('detects changes to external updates', function(done) {
      clientA.publish('/a/#');
      clientB.publish('/a/#'); // implies subscribing to
      clientA.data.update('/a/b', 'good');

      setTimeout(() => {
          clientB.data.subscribe((changes) => {
            assert.deepEqual(changes, {'/a/b': null});
            done();
          });
          clientB.data.update('/a/b', null);
        }, 100);
    });
  });

  describe('clear', function() {
    it('does simple clears', function(done) {
      clientA.publish('/#');
      clientB.subscribe('/#');
      clientA.data.update('/uId/dId/@scope/capname/1.0.0/a', {d: 1});
      clientA.data.update('/uId/dId/@scope/capname/1.0.0/b', {c: 1});
      clientA.data.update('/uId/dId/@scope/capname/1.1.0/b', {c: 2});
      clientA.data.update('/uId/dId/@scope/capname/1.2.0/b', {c: 3});
      clientA.clear(['/uId/dId/@scope/capname/+/b'], () => {
        setTimeout(() => {
            assert.deepEqual(clientB.data.getByTopic('/uId/dId/@scope/capname/'),
              {'1.0.0': {a: {d: 1}}});
            done();
          }, 200);
      });
    });

    it('applies filters when clearing', function(done) {
      clientA.publish('/#');
      clientB.subscribe('/#');
      clientA.data.update('/uId/dId/@scope/capname/1.0.0/a', {d: 1});
      clientA.data.update('/uId/dId/@scope/capname/1.0.0/b', {c: 1});
      clientA.data.update('/uId/dId/@scope/capname/1.1.0/b', {c: 2});
      clientA.data.update('/uId/dId/@scope/capname/1.2.0/b', {c: 3});
      clientA.clear(['/uId/dId/@scope/capname/+/b'], () => {
          setTimeout(() => {
              assert.deepEqual(clientB.data.getByTopic('/uId/dId/@scope/capname/'),
                {'1.0.0': {a: {d: 1}}, '1.2.0': {b: {c: 3}}});
              done();
            }, 200);
        }, {
          filter: (topic) => parseMQTTTopic(topic).version != '1.2.0'
        });
    });


    it('does not retrigger listeners with values during clear', function(done) {
      clientA.publish('/#');
      clientB.subscribe('/uId/dId/@scope/capname/1.0.0/a');
      clientB.publish('/uId/dId/@scope/capname/1.0.0/b');
      // clientB.data.subscribePath('/uId/dId/@scope/capname/1.0.0/a', console.log);
      clientA.data.update('/uId/dId/@scope/capname/1.0.0/a', {d: 1});
      clientB.data.update('/uId/dId/@scope/capname/1.0.0/b', {c: 1});

      setTimeout(() => {
          clientB.data.subscribePath('/uId/dId/@scope/capname/1.0.0/a', (value) =>
            assert(!value));
          clientB.clear(['/uId/dId/@scope/capname/1.0.0'], () => {
            setTimeout(() => {
                assert.deepEqual(clientB.data.getByTopic('/uId/dId/@scope/capname/'),
                  undefined);
                done();
              }, 200);
          });
        }, 200);
    });

    it('clears yet-unknown sub-topics', function(done) {
      clientA.publish('/#');
      clientA.data.update('/uId/dId/@scope/capname/1.0.0/a', {d: 1});
      clientA.data.update('/uId/dId/@scope/capname/1.0.0/b', {c: 1});
      clientA.data.update('/uId/dId/@scope/capname/1.1.0/b', {c: 2});
      // now clear from another client who hasn't been listening
      clientB.clear(['/uId/dId/@scope/capname/1.0.0'], () => {
        setTimeout(() => {
            assert.deepEqual(clientA.data.getByTopic('/uId/dId/@scope/capname/'),
              {'1.1.0': {b: {c: 2}}}, 'a');
            done();
          }, 200);
      });
    });


    it('clears already known sub-topics', function(done) {
      clientA.publish('/#');
      clientB.subscribe('/#');
      clientA.data.update('/uId/dId/@scope/capname/1.0.0/a', {d: 1});
      clientA.data.update('/uId/dId/@scope/capname/1.0.0/b', {c: 1});
      clientA.data.update('/uId/dId/@scope/capname/1.1.0/b', {c: 2});
      setTimeout(() => {
          console.log('clearing');
          clientB.clear(['/uId/dId/@scope/capname/1.0.0'], () => {
            setTimeout(() => {
                assert.deepEqual(clientA.data.getByTopic('/uId/dId/@scope/capname/'),
                  {'1.1.0': {b: {c: 2}}}, 'a');
                done();
              }, 200);
          });
        }, 400);
    });

  });

  it('calls onBeforeDisconnect hooks', function(done) {
    clientA.onBeforeDisconnect(() => done());
    clientA.beforeDisconnect();
  });


  describe('does not block queue processing', function() {
    it('.. when client disconnects and reconnects', function(done) {
      this.timeout(10000);
      clientA.publish('/a/#');
      clientB.subscribe('/a/#');
      clientA.mqtt.end(() => {
        clientA.data.update('a', {b: 1});
        assert(clientA._processing);
        clientA.mqtt.reconnect();
        clientA.mqtt.on('connect', () => {
          setTimeout(() => {
              assert(!clientA._processing);
              done();
            }, 8000);
        });
      })
    });

    it('.. when publish non-permitted topic/message', function(done) {
      clientA.publish('/a/#');
      clientA.data.update('a/notAllowed', 1);
      setTimeout(() => {
          assert(!clientA._processing);
          done();
        }, 100);
    });

    // it('.. when broker restarts', function(done) {
    //   this.timeout(5000);
    //   clientA.publish('/a/#');
    //   server.close(() => {
    //     delete server;
    //     console.log('server closed');
    //     const newServer = require('net').createServer(aedes.handle);
    //     newServer.listen(port, function () {
    //       console.log('new server listening');
    //       clientA.data.update('a', {b: 1});
    //       setTimeout(() => {
    //           assert(!clientA._processing);
    //           done();
    //         }, 100);
    //     });
    //   });
    // });

  });

  describe('multiple publishers', function() {
    it('producer and destructive consumer', function(done) {
      this.timeout(10000);
      clientA.publish('/#');
      clientB.publish('/#');
      clientA.data.update('a', {b: 1});
      setTimeout(() => {
          clientB.data.update('a', null);
          setTimeout(() => {
              console.log(clientA.data.get(), clientB.data.get());
              done();
            }, 100);
        }, 100);
      // inSync(clientA, clientB, done);
    });
  });
});
