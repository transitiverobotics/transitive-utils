const Aedes = require('aedes');
const mqtt = require('mqtt');
const httpServer = require('http').createServer();
const ws = require('websocket-stream');

const MqttSync = require('../../common/MqttSync');
const { loglevel, getLogger } = require('../..');

const log = getLogger('server');
log.setLevel('debug');
loglevel.setAll('debug');

const port = 8888;
const mqttPort = port + 1;
const mqttURL = `mqtt://localhost:${mqttPort}`;

/** fire up a small mqtt broker over websocket, using aedes, for testing */
const startServer = () => {
  console.log('starting server');
  const aedes = Aedes();
  ws.createServer({ server: httpServer }, aedes.handle);

  require('net').createServer(aedes.handle).listen(mqttPort, () =>
    console.log('mqtt server started and listening on port ', port));

  aedes.authorizeSubscribe = (client, sub, callback) => {
    // prohibited to subscribe '/forbidden'
    console.log('sub', sub);
    callback(null, sub.topic.startsWith('/forbidden') ? null : sub)
  };

  httpServer.listen(port, function () {
    console.log('websocket server listening on port ', port);
    // const client = mqtt.connect('ws://localhost:8888');

    const ping = () => {
      process.stdout.write('.');
      aedes.publish({
        topic: '/test/ping',
        payload: JSON.stringify(new Date()),
        retain: true
      });
      // client.publish('/test/ping', JSON.stringify(new Date()), {retain: true});
    };

    setInterval(ping, 1000);
  });

  // start mqttSync
  const mqttClient = mqtt.connect(mqttURL);
  mqttClient.on('connect', () => {
    console.log('connected');
    const client = new MqttSync({mqttClient: mqttClient, ignoreRetain: true});
    client.subscribe('/web');
    client.publish('/server');

    const update = () =>
      client.data.update('/server/time', String(new Date()));
    update();
    setTimeout(() => update(), 3000);
  });
  mqttClient.on('message', (topic, value) =>
    console.log(topic, value == null ? null : value.toString()));
};

module.exports = startServer;
