import type { IClientOptions, MqttClient } from 'mqtt';
import MqttSync = require('../common/MqttSync');

export interface CapabilityOptions {
  mqttOptions?: IClientOptions;
}

export class Capability {
  constructor(onReady?: () => void, options?: CapabilityOptions);

  readonly scope: string;
  readonly name: string;
  readonly fullVersion: string | undefined;
  readonly version: string | undefined;
  readonly capability: string;
  readonly ourPath: string[];
  readonly fullName: string;
  readonly mqtt: MqttClient;
  mqttSync: MqttSync | undefined;
  readonly data: MqttSync.MqttSyncData;
}
