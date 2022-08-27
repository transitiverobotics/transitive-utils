
const assert = require('assert');
const mqtt = require('mqtt');
const { parseMQTTTopic, DataCache } = require('./server');

const MQTT_HOST = 'mqtt://localhost'; // the mqtt server provided by robot-agent


/** A decorated mqtt client for capabilities doing the boilerplate work of
  connecting to the local mqtt broker and setting up a dataCache. Uses the
  environment variable we expect to identify the package and and its password.
*/
class MqttCap {

  constructor({onMessage, onConnect}) {
    const clientId = process.env.TRPACKAGE;
    assert(clientId, 'no client id provided, please set env var "TRPACKAGE"');
    assert(process.env.PASSWORD, 'the PASSWORD env var is not set');

    this.mqttClient  = mqtt.connect(MQTT_HOST, {
      clientId,
      username: 'ignore',
      password: process.env.PASSWORD, // is set by systemd user service
    });

    this.dataCache = new DataCache();

    this.mqttClient.on('message', (topic, message, packet) => {
      console.log(`MqttCap, ${topic}: ${message.toString()}`);
      const parsed = parseMQTTTopic(topic);
      const json = message.length == 0 ? null : JSON.parse(message.toString());
      this.dataCache.update(parsed.sub, json);
      onMessage && onMessage(parsed, json, packet, this);
    });

    this.mqttClient.on('error', console.log);
    this.mqttClient.on('disconnect', console.log);

    this.mqttClient.on('connect', (x) => {
      onConnect && onConnect(x, this);
    });

    this.publish = this.mqttClient.publish.bind(this.mqttClient);
  }

  /** subscribe to a path in the dataCache; makes sure mqtt is subscribed to the
  corresponding topic */
  subscribe(topic, callback) {
    this.dataCache.subscribePath(topic, callback);
    const topic2 = topic.slice(1) + '/#';
    // note: we drop the initial slash in topic
    console.log('subscribing to topic:', topic);
    this.mqttClient.subscribe(topic);
  }
};

module.exports = MqttCap;
