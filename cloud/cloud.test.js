
const assert = require('assert');
const Aedes = require('aedes');
const mqtt = require('mqtt');
const cluster = require('node:cluster');

const { Capability } = require('.');
const { wait, MqttSync, getLogger, loglevel } = require('../index');

const log = getLogger('Cloud Tests');
log.setLevel('debug');
loglevel.setAll('debug');

const port = 9900;
const mqttURL = `mqtt://localhost:${port}`;

/** fake the environment */
process.env.npm_package_name = '@transitive-robotics/cloud-test';
process.env.MQTT_URL = mqttURL;

cluster.setupPrimary({
  exec: `${__dirname}/test/broker.js`
});


/* ---------------------------
  utility functions
*/

/** assert that mqttSync instances a and b are in sync, then call done */
const inSync = (a, b, done, delay = 50) => {
  setTimeout(() => {
      // console.log('A', a.data.get());
      // console.log('B', b.data.get());
      assert.deepEqual(b.data.get(), a.data.get());
      assert(a.publishQueue.size == 0);
      done();
    }, delay);
};

/* --------------------------- */

describe('Capability', function() {

  let server;
  let mqttClientA;
  let clientA;
  let interval;
  let aedes;
  let sockets = [];
  let worker = null;

  const startBroker = (done) => {
    worker = cluster.fork({ MQTT_PORT: port });
    worker.on('message', ({event}) => {
      log.debug('message', event);
      if (event == 'onOpen') {
        mqttClientA = mqtt.connect(mqttURL);
        mqttClientA?.on('connect', () => {
          !clientA &&
            (clientA = new MqttSync({mqttClient: mqttClientA, ignoreRetain: true}));
          clientA.publish('/#');
          clientA.data.update('/cap/ping', 123);
          done();
        });
      }
    });

    worker.on('exit', () => log.debug('broker exited'));
  };

  const stopBroker = () => {
    log.debug('stopping broker');
    worker?.process.kill();
  };

  beforeEach(function(done) {
    // Start the local mqtt broker
    console.log('\n    ▶ ', this.currentTest?.title);
    startBroker(done);
  });

  afterEach(function(done) {
    clearInterval(interval);
    mqttClientA.end();
    mqttClientA = null;
    clientA = null;

    log.debug('shutting down mqtt server');
    stopBroker();
    done();
  });

  /* ---------------------------------------------------------------- */

  it('reconnects', function(done) {
    log.debug('starting');
    let first = true;
    const cap = new Capability(() => {
        log.debug('onReady');

        cap.mqttSync.subscribe('/cap/#');

        if (first) {
          first = false;
          stopBroker();

          setTimeout(() => {
              log.debug('data', cap.mqttSync.data.get());
              startBroker(() => {
                log.debug('restarted the broker');
                log.debug('data', cap.mqttSync.data.get());
              });
            }, 400);
        } else {
          log.debug('reconnected');

          cap.mqttSync.mqtt.end();
          done();
        }
      }, {
        mqttOptions: {}
      });
  });
});
