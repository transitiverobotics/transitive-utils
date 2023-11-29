
const assert = require('assert');
const Aedes = require('aedes');
const mqtt = require('mqtt');
const cluster = require('node:cluster');

const { wait, MqttSync, getLogger, loglevel, Capability } = require('../index');

const log = getLogger('Cloud Tests');
log.setLevel('debug');
// loglevel.setAll('debug');

const port = 9900;
const mqttURL = `mqtt://localhost:${port}`;

/** fake the environment */
process.env.npm_package_name = '@transitive-robotics/cloud-test';
process.env.MQTT_URL = mqttURL;

cluster.setupPrimary({
  exec: `${__dirname}/broker.js`
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


// describe('Capability, basic', function() {

//   /* note, Aedes doesn't support mqtt version 5 yet, which is used by Capability,
//   hence we can't yet test using an ad-hoc Aedes server. For now just testing
//   the bare minimum */
//   it('constructs', function(done) {
//     const c = new Capability();
//     done();
//   });

//   it('sets the right version', function(done) {
//     process.env.npm_package_version = '1.2.3';
//     process.env.npm_package_config_versionNamespace = 'minor';
//     const c = new Capability();
//     assert.equal(c.version, '1.2');
//     done();
//   });

// });

// describe('Capability, mqttsync', function() {

//   let server;
//   let mqttClientA;
//   let clientA;
//   let aedes;
//   let sockets = [];
//   let worker = null;

//   const startBroker = (done) => {
//     worker = cluster.fork({ MQTT_PORT: port });
//     worker.on('message', ({event}) => {
//       log.debug('message', event);
//       if (event == 'onOpen') {
//         mqttClientA = mqtt.connect(mqttURL);
//         mqttClientA?.on('connect', () => {
//           !clientA &&
//             (clientA = new MqttSync({mqttClient: mqttClientA, ignoreRetain: true}));
//           clientA.publish('/#');
//           clientA.data.update('/cap/ping', 123);
//           done();
//         });
//       }
//     });

//     worker.on('exit', () => log.debug('broker exited'));
//   };

//   const stopBroker = () => {
//     log.debug('stopping broker');
//     worker?.process.kill();
//   };

//   beforeEach(function(done) {
//     // Start the local mqtt broker
//     console.log('\n    ▶ ', this.currentTest?.title);
//     startBroker(done);
//   });

//   afterEach(function(done) {
//     mqttClientA.end();
//     mqttClientA = null;
//     clientA = null;

//     log.debug('shutting down mqtt server');
//     stopBroker();
//     done();
//   });

//   /* ---------------------------------------------------------------- */

//   it('reconnects', function(done) {
//     log.debug('starting');
//     let first = true;
//     const cap = new Capability(() => {
//         log.debug('onReady');

//         cap.mqttSync.subscribe('/cap/#');

//         if (first) {
//           first = false;
//           log.debug('restarting broker');
//           stopBroker();

//           setTimeout(() => {
//               log.debug('data', cap.mqttSync.data.get());
//               startBroker(() => {
//                 log.debug('restarted the broker');
//                 log.debug('data', cap.mqttSync.data.get());
//               });
//             }, 400);
//         } else {
//           log.debug('reconnected');

//           cap.mqttSync.mqtt.end();
//           done();
//         }
//       }, {
//         mqttOptions: {}
//       });
//   });
// });
