const { describe, it, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('assert');
const Aedes = require('aedes');
const mqtt = require('mqtt');
const { default: why } = require('why-is-node-running');

// const MqttSync = require('../common/MqttSync');
const { getLogger, DataCache, parseMQTTTopic, randomId, topicToPath, wait,
  MqttSync } = require('../index');

const loglevel = require('loglevel');
// log.getLogger('MqttSync.js').setLevel('debug');
const log = getLogger('test');
// loglevel.setAll('debug');
// loglevel.setAll('info');
log.setLevel('debug');

const port = 9900;
const mqttURL = `mqtt://localhost:${port}`;

const HEARTBEAT_MS = 200; // server: send mqtt heartbeat every this many ms

/* ---------------------------
  utility functions
*/

/** assert that mqttSync instances a and b are in sync, then call done */
const inSync = (a, b, done, delay = 150) => {
  setTimeout(() => {
      log.debug('A', a.data.get());
      log.debug('B', b.data.get());
      assert.deepEqual(b.data.get(), a.data.get());
      assert(a.publishQueue.size == 0);
      done();
    }, delay);
};

/* --------------------------- */

/** We write our own `it` function to set a default timeout (instead of Infinity). */
// const it = (...args) => {
//   const name = args[0];
//   let options = {timeout: 2000};
//   let fn;
//   if (args[1] instanceof Function) {
//     fn = args[1];
//   } else {
//     options = args[1];
//     fn = args[2];
//   }

//   test(name, options, fn);
// }

describe('MqttSync', function() {

  let server;
  let mqttClientA, mqttClientB, mqttClientRobot, mqttClientMeta;
  let clientA, clientB, clientRobot, clientMeta;
  let interval;
  let aedes;

  beforeEach(function(t, done) {
    // Start the local mqtt broker
    // console.log('\n    ▶ ', this.currentTest?.title);

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
      mqttClientRobot = mqtt.connect(mqttURL);
      mqttClientMeta = mqtt.connect(mqttURL);

      const initAll = () => {
        if (mqttClientA.connected && mqttClientB.connected &&
          mqttClientRobot.connected && mqttClientMeta.connected &&
          !clientA && !clientB && !clientRobot && !clientMeta) {
          clientA = new MqttSync({mqttClient: mqttClientA, ignoreRetain: true});
          clientB = new MqttSync({mqttClient: mqttClientB, ignoreRetain: true});
          clientRobot = new MqttSync({mqttClient: mqttClientRobot});
          clientMeta = new MqttSync({mqttClient: mqttClientMeta, inclMeta: true});
          done();
        }
      }

      mqttClientA.on('connect', initAll);
      mqttClientB.on('connect', initAll);
      mqttClientRobot.on('connect', initAll);
      mqttClientMeta.on('connect', initAll);

      // Aedes doesn't by itself send these, so we will, like mosquitto does
      const start = Date.now();
      interval = setInterval(() => aedes.publish({
          topic: '$SYS/broker/uptime',
          payload: String((Date.now() - start)/1e3) + ' seconds'
        }), HEARTBEAT_MS);
    });

  }, {timeout: 2000});

  afterEach(function(t, done) {
    clearInterval(interval);
    mqttClientA.end();
    mqttClientB.end();
    mqttClientRobot.end();
    mqttClientMeta.end();
    mqttClientA = null;
    mqttClientB = null;
    mqttClientRobot = null;
    mqttClientMeta = null;
    clientA = null;
    clientB = null;
    clientRobot = null;
    clientMeta = null;
    aedes.close();
    server && server.listening && server.close(done);
  }, {timeout: 2000});

  /* ---------------------------------------------------------------- */

  it('does simple sync', function(t, done) {
    clientA.publish('/a/#');
    clientB.subscribe('/a/#');
    clientA.data.update('a', {b: 1});
    inSync(clientA, clientB, done);
  });

  it('does simple sync with 0\'s', function(t, done) {
    clientA.publish('/a/#');
    clientB.subscribe('/a/#');
    clientA.data.updateFromArray(['a', 'b'], 0);
    clientA.data.updateFromArray(['a', 'c', 'd'], 1);
    clientA.data.updateFromArray(['a', 'c', '2'], 0);
    inSync(clientA, clientB, done);
  });

  it('truncates huge messages in log', function(t, done) {
    clientA.publish('/a/#');
    clientB.subscribe('/a/#');
    clientA.data.update('a', {b: randomId(10000)});
    inSync(clientA, clientB, done);
  });

  it('does not bleed from test to test', function(t, done) {
    clientB.subscribe('/a/#');
    setTimeout(() => {
        assert.deepEqual(clientB.data.get(), {});
        done();
      }, 30);
  });

  it('keeps track of published messages', function(t, done) {
    clientA.publish('/a/#');
    clientA.data.update('/a', {b: 1});
    clientA.data.update('/a/b', 2);
    clientA.data.update('/a/c', 3);
    clientA.data.update('/a/d/e', 4);
    setTimeout(() => {
        const published = clientA.publishedMessages.get();
        console.log(JSON.stringify(published, true, 2));
        assert(published.a.b);
        assert(published.a.c);
        assert(published.a.d.e);
        done();
      }, 60);
  });

  it('removes sub-document messages when setting sub-document (flat to atomic)',
    function(t, done) {
      clientA.publish('/a/#');
      clientB.subscribe('/a/#');
      clientA.data.update('/a/b/c', 1);
      clientA.waitForHeartbeatOnce(() => {
        clientA.data.update('/a/b', {c: 2});
        inSync(clientA, clientB, () => {
          // also check that publishedMessages were updated
          // assert(clientA.publishedMessages['/a/b/c'] === null);
          const published = clientA.publishedMessages.get();
          console.log(JSON.stringify(published, true, 2));
          assert(published.a.b.c == null);
          done();
        });
      });
    });

  it('syncs nulls on sub-documents (atomic to flat, to atomic)', function(t, done) {
    clientA.publish('/a/#');
    clientB.subscribe('/a/#');
    clientA.data.update('/a', {d: 1});
    clientA.data.update('/a/b', {c: 1});
    clientA.data.update('/a/b', null);
    inSync(clientA, clientB, done);
  });

  it('replaces super-document messages (atomic to flat)', function(t, done) {
    clientA.publish('/a/#');
    clientB.subscribe('/a/#');
    clientA.data.update('/a/b', {c: 2});
    clientA.data.update('/a/b/c', 1);
    inSync(clientA, clientB, () => {
      // console.log(clientA.publishedMessages);
      // assert(clientA.publishedMessages['/a/b'] === null);
      const published = clientA.publishedMessages.get();
      console.log(JSON.stringify(published, true, 2));
      assert(!published.a.b['$_']);
      done();
    });
  });

  it('stays atomic on re-publish', function(t, done) {
    clientA.publish('/a/#');
    // clientA.setThrottle(10);
    clientB.subscribe('/a/#');
    clientA.data.update('/a/b', {c: 2});
    setTimeout(() => {
      clientA.data.update('/a/b', {c: 3});
      inSync(clientA, clientB, () => {
        const published = clientA.publishedMessages.get();
        console.log(JSON.stringify(published, true, 2));
        assert(published.a.b['$_']); // checks that it is still atomic
        done();
      });
    }, 30);  // works with 1, not with 0 (because the self-published 2 will overwrite the 3), #FIX
  });

  it('syncs correctly when switching from atomic to flat', function(t, done) {
    clientA.publish('/a');
    clientB.subscribe('/a');
    clientA.data.update('/a', {b: {c: 1, d: 4}});
    clientA.data.update('/a/b/c', 2);
    clientA.data.update('/a/b/e', 3);
    inSync(clientA, clientB, done);
  });


  it('syncs when subscribing to super-document', function(t, done) {
    clientA.publish('/a/b');
    clientB.subscribe('/a');
    clientA.data.update('/a', {b: {c: 1}});
    inSync(clientA, clientB, done);
  });

  it('syncs when subscribing to sub-document once flat', function(t, done) {
    clientA.publish('/a/#');
    clientB.subscribe('/a/b/#');
    clientA.data.update('/a', {b: {c: 1, d: 4}});
    // Note: this ^^ alone actually doesn't work at the mqtt level, the way the
    // receiver is subscribing. But it works when going flat:
    clientA.data.update('/a/b/c', 2);
    inSync(clientA, clientB, done);
  });

  it('syncs when updating sub-document', function(t, done) {
    clientA.publish('/a');
    clientB.subscribe('/a');
    clientA.data.update('/a', {b: {c: 1, d: 4}, e: 1});
    clientA.data.update('/a/b', {c: 2, d: 5});
    inSync(clientA, clientB, done);
  });

  it('syncs when using atomic', function(t, done) {
    clientA.publish('/a', {atomic: true});
    clientB.subscribe('/a');
    clientA.data.update('/a', {b: {c: 1, d: 4}});
    clientA.data.update('/a/b/c', 2);
    clientA.data.update('/a/b/e', 3);
    inSync(clientA, clientB, done);
  });

  it('should ignore repeated publish calls for the same topic', function(t, done) {
    let clientC = new MqttSync({mqttClient: clientB.mqtt});
    clientA.publish('/a');
    assert(!clientA.publish('/a'));
    done();
  });


  it('publishs topics with wildcards', function(t, done) {
    clientA.publish('/+/b');
    clientB.subscribe('/a');
    clientA.data.update('/a/b/c', 2);
    inSync(clientA, clientB, done);
  });

  it('publishs topics with wildcards (atomic)', function(t, done) {
    clientA.publish('/+/b', {atomic: true});
    clientB.subscribe('/a');
    clientA.data.update('/a/b', {c: 1});
    clientA.data.update('/a/b/d', {e: 1});
    clientA.data.update('/a/b/f/g/h', 'somestring');
    inSync(clientA, clientB, done);
  });

  it('triggers onChange callback', function(t, done) {
    let clientC = new MqttSync({mqttClient: clientB.mqtt,
      onChange: () => done()
    });
    clientC.subscribe('/a');
    clientA.publish('/a');
    clientA.data.update('/a', 1);
  });

  it('triggers onChange callback (atomic)', function(t, done) {
    let clientC = new MqttSync({mqttClient: clientB.mqtt,
      onChange: () => done()
    });
    clientC.subscribe('/a');
    clientA.publish('/a', {atomic: true});
    clientA.data.update('/a', 1);
  });

  it('triggers onChange callback on null', function(t, done) {
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

  it('waits for heartbeats', {timeout: 5000}, function(t, done) {
    clientA.waitForHeartbeatOnce(done);
  });

  it('triggers subscribePath callbacks on null (atomic)', function(t, done) {
    clientA.publish('/a/b', {atomic: true});
    clientB.subscribe('/a/b');
    clientA.data.update('/a/b', {c: 1});
    setTimeout(() => {
        clientB.data.subscribePath('/a/b', () => done());
        clientA.data.update('/a/b', null);
      }, 100);
  });

  it('triggers subscribePath callbacks on topics with slashes', function(t, done) {
    clientA.publish('/a');
    clientB.subscribe('/a');
    setTimeout(() => {
        clientB.data.subscribePath('/a', () => done());
        clientA.data.update(['a', 'b/c/d', 'e'], {f: 1});
      }, 100);
  });

  describe('migrate data', function() {
    it('migrates single topic', function(t, done) {
      clientA.publish('/uId/dId/@scope/capname/1.0.0');
      clientA.publish('/uId/dId/@scope/capname/1.1.0');
      clientA.subscribe('/uId/dId/@scope/capname/1.2.0/b/#');
      clientA.data.update('/uId/dId/@scope/capname/1.0.0/b', {c: 1, d: 1});
      clientA.data.update('/uId/dId/@scope/capname/1.1.0/b', {c: 2, e: 3});
      setTimeout(() => {
          log.info('received before', clientA.receivedTopics);
          let mqttClientC = mqtt.connect(mqttURL);
          let clientC = new MqttSync({
            mqttClient: mqttClientC,
            migrate: [{topic: '/uId/dId/@scope/capname/+/b', newVersion: '1.2.0'}],
            onReady: () => {
              log.debug('onReady');
              setTimeout(() => {
                  log.info('received after', clientC.receivedTopics);
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

    it('migrates single topic, base values', function(t, done) {
      clientA.publish('/uId/dId/@scope/capname/1.0.0');
      clientA.publish('/uId/dId/@scope/capname/1.1.0');
      clientA.subscribe('/uId/dId/@scope/capname/1.2.0/b/#');
      clientA.data.update('/uId/dId/@scope/capname/1.0.0/b/c', 1);
      clientA.data.update('/uId/dId/@scope/capname/1.0.0/b/d', 1);
      clientA.data.update('/uId/dId/@scope/capname/1.1.0/b/c', 2);
      clientA.data.update('/uId/dId/@scope/capname/1.1.0/b/e', 3);
      setTimeout(() => {
          log.info('received before', clientA.receivedTopics);
          let mqttClientC = mqtt.connect(mqttURL);
          let clientC = new MqttSync({
            mqttClient: mqttClientC,
            migrate: [{topic: '/uId/dId/@scope/capname/+/b', newVersion: '1.2.0'}],
            onReady: () => {
              log.debug('onReady');
              setTimeout(() => {
                  log.info('received after', clientC.receivedTopics);
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

    it('migrates nothing when nothing applies', function(t, done) {
      clientA.publish('/uId/dId/@scope/capname/1.0.0');
      clientA.subscribe('/#');
      clientA.data.update('/uId/dId/@scope/capname/1.0.0/b', {c: 1, d: 1});
      setTimeout(() => {
          let mqttClientC = mqtt.connect(mqttURL);
          let clientC = new MqttSync({
            mqttClient: mqttClientC,
            migrate: [{topic: '/uDifferent/dId/@scope/capname/+/b', newVersion: '1.2.0'}],
            onReady: () => {
              log.debug('onReady');
              setTimeout(() => {
                  assert.deepEqual(
                    clientA.data.getByTopic('/uId/dId/@scope/capname/1.0.0/b'),
                    {c: 1, d: 1});
                  mqttClientC.end();
                  mqttClientC = null;
                  clientC = null;
                  done();
                }, 300);
            }
          });
        }, 100);
    });

    it('migrates single topic with transform', function(t, done) {
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

    it('migrates single topic flat', function(t, done) {
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

    it('migrates multiple topics', function(t, done) {
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

    it('migrates topics at lower levels separately', function(t, done) {
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

    it('correctly migrates topics with escaped slashes', function(t, done) {
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

    it('ignores future versions', function(t, done) {
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

    it('cleans up after migration', function(t, done) {
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

    it('does not fail on empty data', function(t, done) {
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


    it('migrates topics with wildcards', function(t, done) {
      clientA.publish('/+/dId/@scope/capname/+');
      clientA.subscribe('/#'); // result
      clientA.data.update('/uId1/dId/@scope/capname/1.0.0/b', {c: 1, d: 1});
      clientA.data.update('/uId1/dId/@scope/capname/1.0.0/d', {keep: true});
      clientA.data.update('/uId1/dId/@scope/capname/1.1.0/b', {c: 2, e: 3});
      clientA.data.update('/uId2/dId/@scope/capname/1.0.0/b', {c: 1, d: 1});
      clientA.data.update('/uId2/dId/@scope/capname/1.1.0/b', {c: 2, e: 3});
      setTimeout(() => {
          let mqttClientC = mqtt.connect(mqttURL);
          // new client which does the migration
          let clientC = new MqttSync({
            mqttClient: mqttClientC,
            migrate: [{topic: '/+/dId/@scope/capname/+/b', newVersion: '1.2.0'}],
            onReady: () => {
              log.debug('onReady');
              setTimeout(() => {
                  // log.debug(JSON.stringify(clientA.data.get(), true, 2));
                  // verify migration result:
                  assert.deepEqual(
                    clientA.data.getByTopic('/uId1/dId/@scope/capname/1.2.0/b'),
                    {c: 2, d: 1, e: 3});
                  assert.deepEqual(
                    clientA.data.getByTopic('/uId2/dId/@scope/capname/1.2.0/b'),
                    {c: 2, d: 1, e: 3});
                  // verify old data has been cleared:
                  assert.deepEqual(
                    clientA.data.getByTopic('/uId1/dId/@scope/capname/1.0.0'),
                    {d: {keep: true}});
                  assert.equal(
                    clientA.data.getByTopic('/uId1/dId/@scope/capname/1.1.0'),
                    null);
                  assert.equal(
                    clientA.data.getByTopic('/uId2/dId/@scope/capname/1.0.0'),
                    null);
                  assert.equal(
                    clientA.data.getByTopic('/uId2/dId/@scope/capname/1.1.0'),
                    null);

                  mqttClientC.end();
                  mqttClientC = null;
                  clientC = null;
                  done();
                }, 300);
            }
          });
        }, 100);
    });

    it('migrates topics with wildcards, flat', function(t, done) {
      clientA.publish('/+/dId/@scope/capname/+');
      clientA.subscribe('/+/dId/@scope/capname/1.2.0/b/#'); // result
      clientA.data.update('/uId1/dId/@scope/capname/1.0.0/b', {c: 1, d: 1});
      clientA.data.update('/uId1/dId/@scope/capname/1.0.0/d', {keep: true});
      clientA.data.update('/uId1/dId/@scope/capname/1.1.0/b', {c: 2, e: 3});
      clientA.data.update('/uId2/dId/@scope/capname/1.0.0/b', {c: 1, d: 1});
      clientA.data.update('/uId2/dId/@scope/capname/1.1.0/b', {c: 2, e: 3});
      setTimeout(() => {
          let mqttClientC = mqtt.connect(mqttURL);
          let clientC = new MqttSync({
            mqttClient: mqttClientC,
            migrate: [{topic: '/+/dId/@scope/capname/+/b', newVersion: '1.2.0', flat: true}],
            onReady: () => {
              log.debug('onReady');
              setTimeout(() => {
                  // log.debug(clientA.data.get());
                  assert.deepEqual(
                    clientA.data.getByTopic('/uId1/dId/@scope/capname/1.2.0/b'),
                    {c: 2, d: 1, e: 3});
                  assert.deepEqual(
                    clientA.data.getByTopic('/uId2/dId/@scope/capname/1.2.0/b'),
                    {c: 2, d: 1, e: 3});
                  assert.deepEqual(
                    clientA.data.getByTopic('/uId1/dId/@scope/capname/1.0.0'),
                    {d: {keep: true}});
                  mqttClientC.end();
                  mqttClientC = null;
                  clientC = null;
                  done();
                }, 300);
            }
          });
        }, 100);
    });
  });

  it('migrates topics with multiple wildcards', function(t, done) {
    clientA.publish('/+/+/@scope/capname/+');
    clientA.subscribe('/#'); // result
    clientA.data.update('/uId1/dId1/@scope/capname/1.0.0/b', {c: 1, d: 1});
    clientA.data.update('/uId1/dId1/@scope/capname/1.0.0/d', {keep: true});
    clientA.data.update('/uId1/dId1/@scope/capname/1.1.0/b', {c: 2, e: 3});
    clientA.data.update('/uId2/dId2/@scope/capname/1.0.0/b', {c: 1, d: 1});
    clientA.data.update('/uId2/dId2/@scope/capname/1.1.0/b', {c: 2, e: 3});
    setTimeout(() => {
        let mqttClientC = mqtt.connect(mqttURL);
        // new client which does the migration
        let clientC = new MqttSync({
          mqttClient: mqttClientC,
          migrate: [{topic: '/+/+/@scope/capname/+/b', newVersion: '1.2.0'}],
          onReady: () => {
            log.debug('onReady');
            setTimeout(() => {
                // log.debug(JSON.stringify(clientA.data.get(), true, 2));
                // verify migration result:
                assert.deepEqual(
                  clientA.data.getByTopic('/uId1/dId1/@scope/capname/1.2.0/b'),
                  {c: 2, d: 1, e: 3});
                assert.deepEqual(
                  clientA.data.getByTopic('/uId2/dId2/@scope/capname/1.2.0/b'),
                  {c: 2, d: 1, e: 3});
                // verify old data has been cleared:
                assert.deepEqual(
                  clientA.data.getByTopic('/uId1/dId1/@scope/capname/1.0.0'),
                  {d: {keep: true}});
                assert.equal(
                  clientA.data.getByTopic('/uId1/dId1/@scope/capname/1.1.0'),
                  null);
                assert.equal(
                  clientA.data.getByTopic('/uId2/dId2/@scope/capname/1.0.0'),
                  null);
                assert.equal(
                  clientA.data.getByTopic('/uId2/dId2/@scope/capname/1.1.0'),
                  null);

                mqttClientC.end();
                mqttClientC = null;
                clientC = null;
                done();
              }, 300);
          }
        });
      }, 100);
  });

  it('migrates topics with wildcards and empty sets', function(t, done) {
    clientA.publish('/+/dId/@scope/capname/+');
    clientA.subscribe('/#'); // result
    clientA.data.update('/uId1/dId/@scope/capname/1.0.0/b', {c: 1, d: 1});
    clientA.data.update('/uId1/dId/@scope/capname/1.0.0/d', {keep: true});
    clientA.data.update('/uId1/dId/@scope/capname/1.1.0/b', {c: 2, e: 3});
    clientA.data.update('/uId2/dId/@scope/capname/1.0.0/f', {c: 1, d: 1});
    clientA.data.update('/uId2/dId/@scope/capname/1.1.0/f', {c: 2, e: 3});
    setTimeout(() => {
        let mqttClientC = mqtt.connect(mqttURL);
        // new client which does the migration
        let clientC = new MqttSync({
          mqttClient: mqttClientC,
          migrate: [{topic: '/+/dId/@scope/capname/+/b', newVersion: '1.2.0'}],
          onReady: () => {
            log.debug('onReady');
            setTimeout(() => {
                // log.debug(JSON.stringify(clientA.data.get(), true, 2));
                // verify migration result:
                assert.deepEqual(
                  clientA.data.getByTopic('/uId1/dId/@scope/capname/1.2.0/b'),
                  {c: 2, d: 1, e: 3});
                // verify old data has been cleared:
                assert.deepEqual(
                  clientA.data.getByTopic('/uId1/dId/@scope/capname/1.0.0'),
                  {d: {keep: true}});
                assert.equal(
                  clientA.data.getByTopic('/uId1/dId/@scope/capname/1.1.0'),
                  null);
                assert.deepEqual(
                  clientA.data.getByTopic('/uId2/dId/@scope/capname/'),
                  {
                    '1.0.0': {f: {c: 1, d: 1}},
                    '1.1.0': {f: {c: 2, e: 3}},
                  });

                mqttClientC.end();
                mqttClientC = null;
                clientC = null;
                done();
              }, 300);
          }
        });
      }, 100);
  });

  /** testing throttle and queue-merge:
    - send a lot of updates to the queue on similar and different topics
    - see same topic updates merged
    - see no more than RATE updates per minute per topic
  */
  it('does throttle', function(t, done) {
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
        assert.equal(messages, 2);
        // 2 would be ideal, but there seems to be some duplicate messages
        done();
      }, 500);
  });

  it('calls onReady', function(t, done) {
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

  it('calls onReady with migrate', function(t, done) {
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

  it('does sliceTopic', function(t, done) {
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

  it('key-prefixes do not break key', function(t, done) {
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
    it('detects changes to external updates', function(t, done) {
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

    it('does not republish changes received from subscription', function(t, done) {
      clientA.publish('/a/#');
      clientA.data.update('/a/b', 'good');
      let failed = false;

      setTimeout(() => {
          clientA.mqtt.on('message',
            // fail if we receive the message back:
            (topic) => {
              if (topic.startsWith('/a')) {
                failed = true;
                done(new Error('it republished!'));
              }
            });
          clientB.publish('/a/#'); // implies subscribing to

          setTimeout(() => {
              !failed && inSync(clientA, clientB, done);
            }, 100);
        }, 100);
    });

    it('does not republish (atomic) changes received from subscription', function(t, done) {
      clientA.publish('/a');
      clientA.data.update('/a/b', 'good');
      let failed = false;

      setTimeout(() => {
          clientA.mqtt.on('message',
            // fail if we receive the message back:
            (topic) => {
              if (topic.startsWith('/a')) {
                failed = true;
                done(new Error('it republished!'));
              }
            });
          clientB.subscribe('/a');
          clientB.publish('/a', {atomic: true});

          setTimeout(() => {
              !failed && inSync(clientA, clientB, done);
            }, 100);
        }, 100);
    });
  });

  describe('clear', function() {
    it('does simple clears', function(t, done) {
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

    it('applies filters when clearing', function(t, done) {
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


    it('does not retrigger listeners with values during clear', function(t, done) {
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

    it('clears yet-unknown sub-topics', function(t, done) {
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

    /* Note that the aedes mqtt broker seems to behave slightly differently here
    than mosquitto: In mosquitto, it seems we do not receive the already
    subscribed topics again when we call clear, while in aedes we do. */
    it('clears already known sub-topics', function(t, done) {
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

    it('clears already known parent topics', function(t, done) {
      clientA.publish('/#');
      clientB.subscribe('/#');
      clientA.data.update('/uId/dId/@scope/capname/1.0.0/a', {d: 1});
      clientA.data.update('/uId/dId/@scope/capname/1.0.0/b', {c: 1});
      clientA.data.update('/uId/dId/@scope/capname/1.1.0/b', {c: 2});
      setTimeout(() => {
          console.log('clearing');
          clientB.clear(['/uId/dId'], () => {
            setTimeout(() => {
                assert.deepEqual(clientB.data.get(), {});
                done();
              }, 200);
          });
        }, 400);
    });

    it('applies filters when clearing already known sub-topics', function(t, done) {
      clientA.publish('/#');
      clientB.subscribe('/#');
      clientA.data.update('/uId/dId/@scope/capname/1.0.0/a', {d: 1});
      clientA.data.update('/uId/dId/@scope/capname/1.0.0/b', {c: 1});
      clientA.data.update('/uId/dId/@scope/capname/1.1.0/b', {c: 2});
      setTimeout(() => {
          console.log('clearing');
          clientB.clear(['/uId/dId/@scope/capname/1.0.0'], () => {
              setTimeout(() => {
                  assert.deepEqual(
                    clientA.data.getByTopic('/uId/dId/@scope/capname/'),
                    {
                      '1.0.0': {b: {c: 1}},
                      '1.1.0': {b: {c: 2}}
                    },
                    'matches');
                  done();
                }, 200);
            }, {
              filter: (topic) => !topic.match(/1.0.0\/b/)
            });
        }, 400);
    });


    it('does not repeatedly clear the same topics', {timeout: 4000}, async function() {

      clientA.publish('/#');
      clientB.subscribe('/#');

      // publish a bunch
      for (let i = 0; i < 200; i++) {
        clientA.data.update(`/uId/dId/@scope/capname/1.0.0/topic_${i}/foo/bar`,
          {value: i});
      }

      const clearPromise = (topics) =>
        new Promise((resolve, reject) => clientB.clear(topics, resolve));

      await wait(600);
      log.debug('clearing, 1st');
      const cleared1 = await clearPromise(['/+/+/@scope/capname/+/+/foo']);
      assert(cleared1 > 200);

      await wait(600);
      log.debug('clearing, 2nd');
      const cleared2 = await clearPromise(['/+/+/@scope/capname/+/+/foo']);
      assert.equal(cleared2, 0);
    });
  });

  it('calls onBeforeDisconnect hooks', function(t, done) {
    clientA.onBeforeDisconnect(() => done());
    clientA.beforeDisconnect();
  });


  describe('does not block queue processing', function() {
    it('.. when client disconnects and reconnects', {timeout: 10000}, function(t, done) {
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

    it('.. when publish non-permitted topic/message', function(t, done) {
      clientA.publish('/a/#');
      clientA.data.update('a/notAllowed', 1);
      setTimeout(() => {
          assert(!clientA._processing);
          done();
        }, 100);
    });

    // it('.. when broker restarts', {timeout: 5000}, function(t, done) {
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
    it('producer and destructive consumer', {timeout: 10000}, function(t, done) {
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

  describe('RPCs', function() {
    const command = '/command1';
    const command2 = '/commands/subcom1/mycommand2';

    it('send simple RPC', function(t, done) {
      clientA.register(command, arg => arg * arg);

      setTimeout(() => {
          clientB.call(command, 11, (result) => {
            assert.equal(result, 121);
            done();
          })
        }, 10);
    });

    it('send simple RPC, await', async function() {
      clientA.register(command, arg => arg * arg * arg);

      await wait(10);
      const result = await clientB.call(command, 3);
      assert.equal(result, 27);
    });

    it('send multiple RPCs, await', async function() {
      clientA.register(command, arg => arg * arg * arg);
      await wait(10);

      assert.equal(await clientB.call(command, 2), 8);
      assert.equal(await clientB.call(command, 3), 27);
      assert.equal(await clientB.call(command, 4), 64);
    });

    it('parallel RPCs, await', async function() {
      let counter = 0;
      clientA.register(command, arg => counter++);
      await wait(10);

      await Promise.all([
        clientB.call(command, 2),
        clientB.call(command, 3),
        clientB.call(command, 4),
      ]);

      assert.equal(counter, 3);
    });

    it('send complex path RPC, await', async function() {
      clientA.register(command2, arg => arg * arg);

      await wait(10);
      assert.equal(await clientB.call(command2, 2), 4);
    });

    it('RPC: async handler', async function() {
      clientA.register(command, async arg => {
        await wait(10);
        return arg * arg * arg;
      });

      await wait(10);
      const result = await clientB.call(command, 3);
      assert.equal(result, 27);
    });

    it('register RPC without ignoreRetained', async function() {
      clientRobot.register(command, arg => arg * arg * arg * arg);
      await wait(10);
      assert.equal(await clientB.call(command, 2), 16);
    });

    it('calling RPC without ignoreRetained', async function() {
      clientA.register(command, arg => arg * arg * arg * arg * arg);
      await wait(10);
      assert.equal(await clientRobot.call(command, 2), 32);
    });

  });


  it('ignores (binary) data sent and subscribed directly on client', function(t, done) {
    clientA.publish('/a/#');
    clientB.subscribe('/a/#');

    clientB.mqtt.subscribe('/binary/#');
    clientB.mqtt.on('message', (topic, buffer, packet) => {
      if (topic.startsWith('/binary')) {
        inSync(clientA, clientB, done);
      }
    });

    setTimeout(() => {
        const buffer = Buffer.from([200, 201, 202, 203]); // some binary data
        clientA.mqtt.publish('/binary/b', buffer);
        clientA.data.update('a', {b: 1});
      }, 50);
  });

  it('requests history storage without data change', async function() {
    clientA.publish('/#');
    clientB.subscribe('/#');
    clientA.requestHistoryStorage('/+/+/scope/cap/+/mydata', 13);
    await wait(10);
    assert.deepEqual(clientA.data.get(), {});
    assert.deepEqual(clientB.data.get(), {});
  });

  it('receives storage requests only when requesting meta-data', async function() {
    clientMeta.subscribe('/$store/#');
    clientA.requestHistoryStorage('/+/+/scope/cap/+/mydata', 13);
    clientB.subscribe('/#');
    await wait(50);
    assert.equal(clientMeta.data.get().$store.$store.scope.cap.$store.mydata, 13);
    assert.deepEqual(clientB.data.get(), {});
  });

});
