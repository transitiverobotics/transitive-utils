const _ = require('lodash');
const fs = require('fs');
const mqtt = require('mqtt');

const { DataCache, mqttParsePayload, getLogger } = require('../common/common');
const MqttSync = require('../common/MqttSync');

const log = getLogger('Capability');

const MQTT_URL = process.env.MQTT_URL || 'mqtts://localhost';

/** super class for all capabilities (cloud component) */
class Capability {

  constructor(onReady, options = {}) {
    [this.scope, this.name] = process.env.npm_package_name.split('/');
    this.version = process.env.npm_package_version;
    this.capability = `${this.scope}/${this.name}`;
    this.ourPath = [this.scope, this.name, this.version];
    this.fullName = this.ourPath.join('/');

    console.log('using', MQTT_URL);
    const mqttClient = mqtt.connect(MQTT_URL, {
      key: fs.readFileSync('certs/client.key'),
      cert: fs.readFileSync('certs/client.crt'),
      rejectUnauthorized: false,
      protocolVersion: 5 // needed for the `rap` option, i.e., to get retain flags
    });
    this.mqtt = mqttClient;

    log.info('connecting');
    mqttClient.on('connect', () => {
      log.info('connected');
      this.mqttSync = new MqttSync({mqttClient});
      onReady && onReady();
    });

    mqttClient.on('error', log.error.bind(log));
    mqttClient.on('disconnect', log.info.bind(log));
  }

  get data() {
    return this.mqttSync.data;
  }
};


module.exports = { Capability };
