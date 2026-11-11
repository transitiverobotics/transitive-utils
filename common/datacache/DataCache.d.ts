export type DataCacheObject<TValue = unknown> = Record<string, TValue>;
export type DataCacheTags = Record<string, unknown>;
export type DataCacheMatch = boolean | Record<string, string>;

export type DataCacheListener<TValue = unknown> = (
  changes: Record<string, TValue>,
  tags?: DataCacheTags
) => void;

export type DataCachePathListener<TValue = unknown> = (
  value: TValue,
  key: string,
  matched: DataCacheMatch,
  tags?: DataCacheTags
) => void;

export type DataCacheMatchListener<TValue = unknown> = (
  value: TValue,
  path: string[],
  matched: Record<string, string>
) => void;

export class DataCache<TValue = unknown> {
  constructor(data?: DataCacheObject);

  updateFromArray(
    path: string[],
    value: TValue,
    tags?: DataCacheTags
  ): Record<string, TValue>;
  update(
    path: string | string[],
    value: TValue,
    tags?: DataCacheTags
  ): Record<string, TValue>;
  updateFromTopic(
    topic: string,
    value: TValue,
    tags?: DataCacheTags
  ): Record<string, TValue>;
  updateFromModifier(
    modifier: Record<string, TValue>,
    tags?: DataCacheTags
  ): Array<Record<string, TValue>>;

  subscribe(callback: DataCacheListener<TValue>): void;
  subscribePath(path: string | string[], callback: DataCachePathListener<TValue>): void;
  subscribeTopic(topic: string, callback: DataCachePathListener<TValue>): void;
  subscribePathFlat(topic: string | string[], callback: DataCachePathListener<TValue>): void;
  unsubscribe(callback: DataCacheListener<TValue>): void;

  get(path?: string[]): TValue | DataCacheObject<TValue> | undefined;
  getByTopic(topic: string): TValue | DataCacheObject<TValue> | undefined;
  filter(path: string[]): DataCacheObject<TValue>;
  filterByTopic(topic: string): DataCacheObject<TValue>;

  forMatch(topic: string, callback: DataCacheMatchListener<TValue>): void;
  forPathMatch(path: string[], callback: DataCacheMatchListener<TValue>): void;
}

export function updateObject(
  obj: DataCacheObject,
  modifier: Record<string, unknown>
): DataCacheObject;
