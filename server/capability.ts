import fs from 'fs';
import mqtt from 'mqtt';
import type { IClientOptions, MqttClient } from 'mqtt';

import { getLogger } from '../common/common';
import { MqttSync } from '../common/MqttSync';
import { findPath, getPackageVersionNamespace } from './server';

export interface CapabilityOptions {
  mqttOptions?: IClientOptions;
}

const log = getLogger('Capability');
log.setLevel('info');

/** Super class for all cloud capabilities. */
export class Capability {

  scope: string;
  name: string;
  fullVersion: string | undefined;
  version: string | undefined;
  capability: string;
  ourPath: string[];
  fullName: string;
  readonly mqtt: MqttClient;
  mqttSync: MqttSync | undefined;

  constructor(onReady?: () => void, options: CapabilityOptions = {}) {

    [this.scope, this.name] = process.env.npm_package_name.split('/');
    this.fullVersion = process.env.npm_package_version;
    this.version = getPackageVersionNamespace();
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
    mqttClient.once('connect', () => {
      log.info('connected');
      this.mqttSync ||= new MqttSync({mqttClient});
      onReady && onReady();
    });
    mqttClient.on('connect', () => log.info('(re-)connected'));

    mqttClient.on('error', log.error.bind(log));
    mqttClient.on('disconnect', log.warn.bind(log));
  }

  get data() {
    return this.mqttSync.data;
  }
}
