import type { MqttClient } from 'mqtt';
import type { MqttSync } from '../common/MqttSync';

export interface ImportCapabilityOptions {
  jwt: string;
  host?: string;
  ssl?: boolean;
}

export function setTerminalTitle(title: string): void;
export function fetchURL(url: string): Promise<string>;
export function findPath(basename: string): string | null;
export function getPackageVersionNamespace(): string | undefined;
export function importCapability<T = unknown>(
  args: ImportCapabilityOptions
): Promise<T>;
export function registerCatchAll(): void;
export function connectToLocalMQTT(): MqttClient;
export function getLocalMQTTSync(
  options?: Omit<ConstructorParameters<typeof MqttSync>[0], 'mqttClient'>
): Promise<MqttSync>;
export function randomId(bytes?: number): string;
