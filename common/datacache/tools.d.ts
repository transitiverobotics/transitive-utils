export type TopicPath = string[];
export type TopicSelector = string | TopicPath;
export type TopicMatch = boolean | Record<string, string>;

export function topicToPath(topic: string): TopicPath;
export function pathToTopic(pathArray: Array<string | number>): string;
export function toFlatObject(
  obj: Record<string, unknown> | unknown[],
  prefix?: string[],
  result?: Record<string, unknown>
): Record<string, unknown>;
export function forMatchIterator(
  obj: Record<string, unknown> | unknown[],
  path: TopicPath,
  callback: (
    value: unknown,
    path: string[],
    matched: Record<string, string>
  ) => void,
  pathSoFar?: string[],
  matchSoFar?: Record<string, string>
): void;
export function setFromPath(
  obj: Record<string, unknown>,
  path: string[],
  value: unknown
): Record<string, unknown> | undefined;
export function encodeTopicElement(element: string): string;
export function decodeTopicElement(element: string): string;
export function topicMatch(
  selector: TopicSelector,
  topic: TopicSelector
): TopicMatch;
export function isSubTopicOf(sub: string, parent: string): boolean;
