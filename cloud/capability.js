const _ = require('lodash');
const fs = require('fs');
const mqtt = require('mqtt');

const { DataCache, mqttParsePayload, getLogger } = require('../common/common');
const MqttSync = require('../common/MqttSync');
const { findPath } = require('../server');

const log = getLogger('Capability');
log.setLevel('info');

/** super class for all capabilities (cloud component) */
class Capability {

  constructor(onReady, options = {}) {

    [this.scope, this.name] = process.env.npm_package_name.split('/');
    this.version = process.env.npm_package_version;
    this.capability = `${this.scope}/${this.name}`;
    this.ourPath = [this.scope, this.name, this.version];
    this.fullName = this.ourPath.join('/');

    const MQTT_URL = process.env.MQTT_URL || 'mqtts://localhost';
    log.info('using', MQTT_URL);

    const certsPath = findPath('certs');
    if (!certsPath) {
      const error = 'Unable to find certificates directory';
      log.error(error);
      throw new Error(error);
    }

    const mqttClient = mqtt.connect(MQTT_URL, options.mqttOptions || {
      key: fs.readFileSync(`${certsPath}/client.key`),
      cert: fs.readFileSync(`${certsPath}/client.crt`),
      rejectUnauthorized: false,
      protocolVersion: 5 // needed for the `rap` option, i.e., to get retain flags
    });
    this.mqtt = mqttClient;

    log.info('connecting');
    mqttClient.on('connect', () => {
      log.info('(re-)connected');
      this.mqttSync ||= new MqttSync({mqttClient});
      onReady && onReady();
    });

    mqttClient.on('error', log.error.bind(log));
    mqttClient.on('disconnect', log.warn.bind(log));
  }

  get data() {
    return this.mqttSync.data;
  }
};


module.exports = { Capability };
