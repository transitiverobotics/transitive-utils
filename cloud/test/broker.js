const cluster = require('node:cluster');
const Aedes = require('aedes');

// cluster.worker.on('message', handleProtocol);

const port = process.env.MQTT_PORT;

aedes = Aedes({
  authenticate: (client, username, password, callback) => {
    callback(null, true);
  },
  authorizePublish: (client, sub, callback) => {
    if (sub.topic.endsWith('notAllowed')) {
      callback('not allowed', false);
    } else {
      callback(null, true);
    }
  },
});

server = require('net').createServer(aedes.handle);
server.listen(port, function () {
  console.log('mqtt server started and listening on port ', port)

  const start = Date.now();
  interval = setInterval(() => aedes.publish({
      topic: '$SYS/broker/uptime',
      payload: String((Date.now() - start)/1e3) + ' seconds'
    }), 200);

  cluster.worker.send({event: 'onOpen'});
});
