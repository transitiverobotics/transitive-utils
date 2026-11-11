export type DataCacheObject = Record<string, unknown>;
export type DataCacheTags = Record<string, unknown>;
export type DataCacheMatch = boolean | Record<string, string>;

export type DataCacheListener = (
  changes: Record<string, unknown>,
  tags?: DataCacheTags
) => void;

export type DataCachePathListener = (
  value: unknown,
  key: string,
  matched: DataCacheMatch,
  tags?: DataCacheTags
) => void;

export type DataCacheMatchListener = (
  value: unknown,
  path: string[],
  matched: Record<string, string>
) => void;

export class DataCache {
  constructor(data?: DataCacheObject);

  updateFromArray(
    path: string[],
    value: unknown,
    tags?: DataCacheTags
  ): Record<string, unknown>;
  update(
    path: string | string[],
    value: unknown,
    tags?: DataCacheTags
  ): Record<string, unknown>;
  updateFromTopic(
    topic: string,
    value: unknown,
    tags?: DataCacheTags
  ): Record<string, unknown>;
  updateFromModifier(
    modifier: Record<string, unknown>,
    tags?: DataCacheTags
  ): Array<Record<string, unknown>>;

  subscribe(callback: DataCacheListener): void;
  subscribePath(path: string | string[], callback: DataCachePathListener): void;
  subscribeTopic(topic: string, callback: DataCachePathListener): void;
  subscribePathFlat(topic: string | string[], callback: DataCachePathListener): void;
  unsubscribe(callback: DataCacheListener): void;

  get(path?: string[]): unknown;
  getByTopic(topic: string): unknown;
  filter(path: string[]): DataCacheObject;
  filterByTopic(topic: string): DataCacheObject;

  forMatch(topic: string, callback: DataCacheMatchListener): void;
  forPathMatch(path: string[], callback: DataCacheMatchListener): void;
}

export function updateObject(
  obj: DataCacheObject,
  modifier: Record<string, unknown>
): DataCacheObject;
