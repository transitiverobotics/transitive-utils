import type { MqttClient } from 'mqtt';

declare namespace MqttSync {
  export type MqttSyncValue =
    | string
    | number
    | boolean
    | null
    | MqttSyncValue[]
    | { [key: string]: MqttSyncValue };

  export interface MqttSyncData {
    update(
      path: string | string[],
      value: MqttSyncValue,
      tags?: Record<string, unknown>
    ): Record<string, MqttSyncValue>;
    updateFromArray(
      path: string[],
      value: MqttSyncValue,
      tags?: Record<string, unknown>
    ): Record<string, MqttSyncValue>;
    updateFromTopic(
      topic: string,
      value: MqttSyncValue,
      tags?: Record<string, unknown>
    ): Record<string, MqttSyncValue>;
    updateFromModifier(
      modifier: Record<string, MqttSyncValue>,
      tags?: Record<string, unknown>
    ): Array<Record<string, MqttSyncValue>>;
    subscribe(
      callback: (
        changes: Record<string, MqttSyncValue>,
        tags?: Record<string, unknown>
      ) => void
    ): void;
    subscribePath(
      path: string | string[],
      callback: (
        value: MqttSyncValue,
        key: string,
        matched: boolean | Record<string, string>,
        tags?: Record<string, unknown>
      ) => void
    ): void;
    subscribePathFlat(
      path: string | string[],
      callback: (
        value: MqttSyncValue,
        key: string,
        matched: boolean | Record<string, string>,
        tags?: Record<string, unknown>
      ) => void
    ): void;
    subscribeTopic(
      topic: string,
      callback: (
        value: MqttSyncValue,
        key: string,
        matched: boolean | Record<string, string>,
        tags?: Record<string, unknown>
      ) => void
    ): void;
    unsubscribe(
      callback: (
        changes: Record<string, MqttSyncValue>,
        tags?: Record<string, unknown>
      ) => void
    ): void;
    get(path?: string[]): MqttSyncValue | undefined;
    getByTopic(topic: string): MqttSyncValue | undefined;
    filter(path: string[]): MqttSyncValue | undefined;
    filterByTopic(topic: string): MqttSyncValue | undefined;
    forMatch(
      topic: string,
      callback: (
        value: MqttSyncValue,
        path: string[],
        matched: boolean | Record<string, string>
      ) => void
    ): void;
    forPathMatch(
      path: string[],
      callback: (
        value: MqttSyncValue,
        path: string[],
        matched: boolean | Record<string, string>
      ) => void
    ): void;
  }

  export interface MqttSyncMigration {
    topic: string;
    newVersion: string;
    transform?: (value: MqttSyncValue | undefined) => MqttSyncValue;
    flat?: boolean;
    level?: number;
  }

  export interface MqttSyncOptions {
    mqttClient: MqttClient;
    onChange?: (changes: Record<string, MqttSyncValue>) => void;
    ignoreRetain?: boolean;
    migrate?: MqttSyncMigration[];
    onReady?: () => void;
    sliceTopic?: number;
    onHeartbeatGranted?: () => void;
    inclMeta?: boolean;
  }

  export interface MqttSyncPublishOptions {
    atomic?: boolean;
  }

  export interface MqttSyncClearOptions {
    filter?: (topic: string) => boolean;
  }

  export interface MqttSyncHistoryQuery {
    topic: string;
    since?: Date;
    until?: Date;
    path?: string[];
    type?: string;
    orderBy?: string;
    limit?: number;
    bins?: number;
    agg?: string;
    aggSeconds?: number;
  }

  export type MqttSyncRPCHandler<Args = unknown, Result = unknown> = (
    args: Args,
    commandTopic: string
  ) => Result | Promise<Result>;
}

declare class MqttSync {
  constructor(options: MqttSync.MqttSyncOptions);

  readonly mqtt: MqttClient;
  readonly data: MqttSync.MqttSyncData;
  readonly publishedMessages: MqttSync.MqttSyncData;
  subscribedPaths: Record<string, 1>;
  publishedPaths: Record<string, MqttSync.MqttSyncPublishOptions>;
  publishQueue: Map<string, MqttSync.MqttSyncValue>;
  receivedTopics: Set<string>;
  heartbeatWaitersOnce: Array<() => void>;
  heartbeats: number;
  beforeDisconnectHooks: Array<(mqttSync: MqttSync) => void>;
  rpcHandlers: Record<string, MqttSync.MqttSyncRPCHandler>;
  rpcCallbacks: Record<string, (result: unknown) => void>;

  getPublishedPaths(
    object?: MqttSync.MqttSyncValue,
    path?: string[]
  ): string[][];
  publishAtLevel(topic: string, value: MqttSync.MqttSyncValue, level: number): void;
  migrate(list: MqttSync.MqttSyncMigration[], onReady?: () => void): void;
  clear(
    prefixes?: string[],
    callback?: (count: number) => void,
    options?: MqttSync.MqttSyncClearOptions
  ): void;
  waitForHeartbeatOnce(callback: () => void): void;
  heartbeatPromise(): Promise<void>;
  isSubscribed(topic: string): boolean;
  isPublished(topic: string): boolean;
  subscribe(
    topic: string,
    callback?: (error?: string | null) => void
  ): void;
  unsubscribe(topic: string): void;
  _actuallyPublish(topic: string, value: MqttSync.MqttSyncValue): boolean;
  _processQueue_rec(callback: () => void): void;
  _processQueue(): void;
  setThrottle(delay: number): void;
  clearThrottle(): void;
  addToQueue(topic: string, value: MqttSync.MqttSyncValue): void;
  _enqueue(topic: string, value: MqttSync.MqttSyncValue): void;
  publish(topic: string, options?: MqttSync.MqttSyncPublishOptions): boolean;
  beforeDisconnect(): void;
  onBeforeDisconnect(callback: (mqttSync: MqttSync) => void): void;
  getRPCHandler(topic: string): MqttSync.MqttSyncRPCHandler | undefined;
  handleRPCRequest(
    path: string[],
    handler: MqttSync.MqttSyncRPCHandler,
    request: { id: string; args: unknown }
  ): Promise<void>;
  handleRPCResponse(topic: string, response: { id: string; result: unknown }): void;
  register<Args = unknown, Result = unknown>(
    command: string,
    handler: MqttSync.MqttSyncRPCHandler<Args, Result>
  ): void;
  call<Result = unknown>(
    command: string,
    args: unknown,
    callback: (result: Result) => void
  ): void;
  call<Result = unknown>(command: string, args: unknown): Promise<Result>;
  requestHistoryStorage(topic: string, ttl?: number): void;
  queryHistory<Result = unknown>(
    params: MqttSync.MqttSyncHistoryQuery
  ): Promise<Result>;
}

export = MqttSync;
