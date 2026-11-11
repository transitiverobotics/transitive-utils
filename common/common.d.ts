import type { Buffer } from 'node:buffer';
import type { MqttClient } from 'mqtt';
import loglevelModule = require('loglevel');

export {
  pathToTopic,
  topicToPath,
  toFlatObject,
  topicMatch,
  isSubTopicOf,
  setFromPath,
  forMatchIterator,
  encodeTopicElement,
  decodeTopicElement,
} from './datacache/tools';

export type {
  TopicPath,
  TopicSelector,
  TopicMatch,
} from './datacache/tools';

export interface ROSRelease {
  rosVersion: 1 | 2;
  ubuntuCodename?: string;
}

export interface CommonConstants {
  rosReleases: Record<string, ROSRelease>;
}

export interface ExtendedLogLevel extends loglevelModule.RootLogger {
  setAll(level: loglevelModule.LogLevelDesc): void;
}

export interface ParsedMQTTUsername {
  organization: string | undefined;
  client: string | undefined;
  sub: string[];
}

export interface ParsedMQTTTopic {
  organization: string | undefined;
  device: string | undefined;
  capabilityScope: string | undefined;
  capabilityName: string | undefined;
  capability: string;
  version: string | undefined;
  sub: string[];
}

export interface MergeVersionsOptions {
  minVersion?: string;
  maxVersion?: string;
}

export interface MergeAllVersionsOptions extends MergeVersionsOptions {
  subTopic?: string;
}

export const constants: CommonConstants;
export const loglevel: ExtendedLogLevel;
export const getLogger: typeof loglevelModule.getLogger;

export function clone<T>(obj: T): T;
export function decodeJWT(jwt: string): unknown;
export function tryJSONParse(
  input: string | Buffer | null | undefined
): unknown | null;

export function visit<T extends object>(
  object: T | null | undefined,
  childField: string,
  visitor: (object: T) => void
): void;
export function visitAncestor<T extends object>(
  object: T,
  path: string[],
  visitor: (object: T, prefix: string[]) => void,
  prefix?: string[]
): void;
export function wait(delay: number): Promise<void>;

export function parseMQTTUsername(username: string): ParsedMQTTUsername;
export function parseMQTTTopic(topic: string): ParsedMQTTTopic;
export function mqttParsePayload(payload: Buffer): unknown | null;
export function mqttClearRetained(
  mqttClient: MqttClient,
  prefixes: string[],
  callback?: (count: number) => void,
  delay?: number
): void;

export function metaPathToSelectorPath(path: string[]): string[];
export function metaTopicToSelector(topic: string): string;
export function selectorPathToMetaPath(path: string[]): string[];
export function selectorToMetaTopic(topic: string): string;

export function getRandomId(bytes?: number): string;
export function toBase52(num: number): string;
export function getDateBase52(): string;
export function versionCompare(a: string, b: string): -1 | 0 | 1;
export function mergeVersions(
  versionsObject: Record<string, unknown> | null | undefined,
  subTopic?: string,
  options?: MergeVersionsOptions
): Record<string, unknown> | null | undefined;
export function mergeAllVersions(
  data: Record<string, unknown>,
  options?: Record<string, MergeAllVersionsOptions>
): Record<string, unknown>;

export function formatBytes(bytes: number): string;
export function formatDuration(seconds: number): string;
export function doOnce(fn: () => void, key?: string): void;
