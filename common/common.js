const semverCompare = require('semver/functions/compare');
// import semverCompare from 'semver/functions/compare';

const _ = {
  get: require('lodash/get'),
  set: require('lodash/set'),
  unset: require('lodash/unset'),
  forEach: require('lodash/forEach'),
  map: require('lodash/map'),
  isEmpty: require('lodash/isEmpty'),
  eq: require('lodash/isEqual'),
  isPlainObject: require('lodash/isPlainObject'),
  merge: require('lodash/merge'),
};

const loglevel = require('loglevel');
const chalk = require('chalk');

const constants = require('./constants');

/** convenience function to set all loggers to the given level */
loglevel.setAll = (level) =>
  Object.values(loglevel.getLoggers()).forEach(l => l.setLevel(level));

const methodColors = {
  warn: chalk.yellow,
  error: chalk.red,
  info: chalk.green,
  debug: chalk.gray,
};
const coloredMethod = (method) =>
  methodColors[method] ? methodColors[method](method) : method;

// patch the methodFactory to prefix logs with name and level
const originalFactory = loglevel.methodFactory;
loglevel.methodFactory = (methodName, level, loggerName) => {
  const rawMethod = originalFactory(methodName, level, loggerName);

  if (typeof window != 'undefined') {
    // browser: keep it simple
    const context = `${loggerName} ${methodName}`;
    return (...args) => rawMethod(`[${context}]`, ...args);
  }

  const context = `${loggerName} ${coloredMethod(methodName)}`;
  return (...args) => rawMethod(
    `[${chalk.blue((new Date()).toISOString())} ${context}]`, ...args);
};

/** get a new logger; call with a name, e.g., `module.id` */
const getLogger = loglevel.getLogger;

/** Deep-clone the given object. All functionality is lost, just data is kept. */
const clone = (obj) => JSON.parse(JSON.stringify(obj));

/** reusable visitor pattern: iteratively visits all nodes in the tree
 described by `object`, where `childField` indicates the child-of predicate.
*/
const visit = (object, childField, visitor) => {
  if (!object) return;
  visitor(object);
  object[childField]?.forEach(child => visit(child, childField, visitor));
};

/** wait for delay ms, usable in async functions */
const wait = (delay) => new Promise((resolve) => { setTimeout(resolve, delay); });

// -------------------------------------------------------------------------
// DataCache tools


/** given an object, return a new object where all sub-objects are
replaced by topic-values, e.g.:
{a: {b: 1, c: 2}, d: 3}   ->   {'/a/b': 1, '/a/c': 2, d: 3}
Note: not idempotent!
{'/a/b': 1, '/a/c': 2, d: 3}  -> {'%2Fa%2Fb': 1, '%2Fa%2Fc': 2, d: 3}
*/
const toFlatObject = (obj, prefix = [], rtv = {}) => {
  _.forEach(obj, (value, key) => {
    // const newPrefix = prefix.concat(topicToPath(String(key)));
    const newPrefix = prefix.concat(String(key));

    if ((_.isPlainObject(value) || value instanceof Array) && value !== null) {
      // it's an object or array
      toFlatObject(value, newPrefix, rtv);
    } else {
      // it's a primitive
      rtv[pathToTopic(newPrefix)] = value;
    }
  });
  return rtv;
};

/** Iterate through the object and invoke callback for each match of path (with
named wildcards) */
const forMatchIterator = (obj, path, callback, pathSoFar = [], matchSoFar = {}) => {

  if (path.length == 0 || path[0] == '#') {
    callback(obj, pathSoFar, matchSoFar);
    return;
  }

  const next = path[0]; // don't use shift, we don't want to modify path
  if (next) {
    for (let key in obj) {
      if (key == next || next == '*' || next.startsWith('+')) {
        const match = next.startsWith('+') && next.length > 1 ?
          Object.assign({}, matchSoFar, {[next.slice(1)]: key}) :
          matchSoFar;
        forMatchIterator(obj[key], path.slice(1), callback,
          pathSoFar.concat([key]), match);
      }
    }
  }
};

/** Like _.set but without arrays. This allows using numbers as keys. */
const setFromPath = (obj, path, value) => {
  if (path.length == 0) return obj;
  const next = path.shift();
  if (path.length == 0) {
    obj[next] = value;
  } else {
    if (!obj[next]) obj[next] = {};
    setFromPath(obj[next], path, value);
  }
};

const encodeTopicElement = x => x.replace(/%/g, '%25').replace(/\//g, '%2F');
const decodeTopicElement = x => x.replace(/%25/g, '%').replace(/%2F/g, '/');

/** convert a path array to mqtt topic; reduces +id identifiers to + */
const pathToTopic = (pathArray) => {
  /** reduce wildcards with Ids, such as `+sessionId`, to just + */
  const dropWildcardIds = (x) => x.startsWith('+') ? '+' : x;
  return `/${pathArray.map(dropWildcardIds).map(encodeTopicElement).join('/')}`;
};

/** convert topic to path array */
const topicToPath = (topic) => {
  // split topic by slashes, but not if they are escaped
  // const path = topic.match(/(\\.|[^/])+/g) || [];
  // split topic by slashes and unescape slashes in each item
  const path = topic.split('/').map(decodeTopicElement);
  // handle leading slash
  path.length > 0 && path[0].length == 0 && path.shift();
  // handle trailing slash
  path.length > 0 && path.at(-1).length == 0 && path.pop();
  return path;
};

/** match a slash-separated topic with a selector using +XYZ for (named)
  wildcards. Return the matching result.
*/
const pathMatch = (selector, topic) => {
  const byArray = (s, p) => {
    if (s.length == 0) return true; // we are done: prefix matched
    if (s[0][0] == '#') return true; // explicit tail-wildcard
    // if (p.length < s.length) return false;
    if (p.length == 0) return true; // we are done, matched all
    // simple match:
    if (s[0] == p[0]) return byArray(s.slice(1), p.slice(1));
    // wild card match:
    if (s[0][0] == '+') {
      const sub = byArray(s.slice(1), p.slice(1));
      return sub && Object.assign({[s[0].slice(1)]: p[0]}, sub);
    }
    // else: failure!
    return false;
  };

  const selectorArray = topicToPath(selector);
  const pathArray = topicToPath(topic);
  // const selectorArray = selector.split('/');
  // const pathArray = topic.split('/');
  return byArray(selectorArray, pathArray);
};

/** sub is a strict sub-topic of parent, and in particular not equal */
const isSubTopicOf = (sub, parent) => {
  const pPath = topicToPath(parent);
  const sPath = topicToPath(sub);
  return isPrefixOf(pPath, sPath) && pPath.length < sPath.length;
};

/** prefixArray is a prefix of the array */
const isPrefixOf = (prefixArray, array) => {
  if (prefixArray.length == 0) return true;
  return (prefixArray[0] == array[0] &&
      isPrefixOf(prefixArray.slice(1), array.slice(1))
  );
}


// -------------------------------------------------------------------------



// -------------------------------------------------------------------------
// MQTT Tools

/** parse usernames used in MQTT */
const parseMQTTUsername = (username) => {
  const parts = username.split(':');
  return {
    organization: parts[0],
    client: parts[1],
    sub: parts.slice(2)
  }
};

/** parse an MQTT topic according to our topic schema */
const parseMQTTTopic = (topic) => {
  const parts = topicToPath(topic);
  return {
    organization: parts[0],
    device: parts[1],
    capabilityScope: parts[2],
    capabilityName: parts[3],
    capability: `${parts[2]}/${parts[3]}`,
    version: parts[4],
    sub: parts.slice(5)
  }
};

/** check whether topic matches the mqtt subscription expression, i.e.,
  a topic with potential wildcards; see https://mosquitto.org/man/mqtt-7.html */

// TODO: by now pretty much a copy of pathMatch, which seems better maintained.
// Remove?
const mqttTopicMatch = (topic, subscription) => {
  const partsMatch = (topicParts, subParts) => {
    if (subParts.length == 0 && topicParts.length == 0) {
      return true;
    } else if (subParts.length == 0 && topicParts.length > 0) {
      // subscription is for a (specific) parent topic
      return false;
    } else if (subParts[0] == '#') {
      return true;
    } else if (subParts.length > 0 && topicParts.length == 0) {
      // subscription is more specific than topic
      return false;
    } else {
      return (subParts[0] == '+' || subParts[0] == topicParts[0])
        && partsMatch(topicParts.slice(1), subParts.slice(1));
    }
  };

  return partsMatch(topicToPath(topic), topicToPath(subscription));
}

const mqttParsePayload = (payload) =>
  payload.length == 0 ? null : JSON.parse(payload.toString('utf-8'));


/** delete all retained messages in a certain topic prefix, waiting for
    a given delay to collect existing retained. Use with care, never delete topics
  not owned by us. Harmless within capabilities, which are namespaced already.
*/
const mqttClearRetained = (mqttClient, prefixes, callback, delay = 1000) => {

  const toDelete = [];
  const collectToDelete = (topic) => {
    // there may be other mqtt subscriptions running, filter by topic
    prefixes.forEach(prefix =>
      mqttTopicMatch(topic, `${prefix}/#`) && toDelete.push(topic)
    );
  }
  mqttClient.on('message', collectToDelete);

  // subscribe to all
  prefixes.forEach(prefix => {
    if (typeof prefix == 'string') {
      mqttClient.subscribe(`${prefix}/#`);
    } else {
      console.warn('Ignoring', prefix, 'since it is not a string.');
    }
  });

  // value to use to clear, depending on node.js vs. browser
  const nullValue = (typeof Buffer != 'undefined' ? Buffer.alloc(0) : null);

  setTimeout(() => {
      mqttClient.removeListener('message', collectToDelete);
      prefixes.forEach(prefix => mqttClient.unsubscribe(`${prefix}/#`));

      const count = toDelete.length;
      console.log(`clearing ${count} retained messages from ${prefixes}`);
      toDelete.forEach(topic => {
        mqttClient.publish(topic, nullValue, {retain: true});
      });

      callback && callback(count);
    }, delay);
};

// -------------------------------------------------------------------------

const getRandomId = () => Math.random().toString(36).slice(2);

// -------------------------------------------------------------------------

/** Compare to version strings. Return -1 if a is lower than b,
  0 if they are equal, and 1 otherwise. */
const versionCompare = semverCompare;

// -------------------------------------------------------------------------

/** given an object where the keys are versions, merge this into one object
  where the latest version of each subfield overwrites any previous */
const mergeVersions = (versionsObject, subTopic = undefined, options = {}) => {
  if (!versionsObject) {
    return subTopic ? _.set({}, subTopic, versionsObject) : versionsObject;
  }

  const versions = Object.keys(versionsObject).filter(ver =>
      (!options.maxVersion || versionCompare(ver, options.maxVersion) <= 0) &&
        (!options.minVersion || versionCompare(options.minVersion, ver) <= 0))
      .sort(versionCompare);

  const merged = {};
  const subPath = subTopic && topicToPath(subTopic);
  versions.forEach(nextVersion => {
    const newValue = subPath ? _.get(versionsObject[nextVersion], subPath) :
      versionsObject[nextVersion];
    // Object.assign(merged, newValue);
    _.merge(merged, newValue);
  });
  return subPath ? _.set({}, subPath, merged) : merged;
};

// -------------------------------------------------------------------------


module.exports = { parseMQTTUsername, parseMQTTTopic,
  pathToTopic, topicToPath, toFlatObject, mqttTopicMatch, pathMatch,
  mqttParsePayload, getRandomId, versionCompare, loglevel, getLogger,
  mergeVersions, mqttClearRetained, isSubTopicOf, clone, setFromPath,
  forMatchIterator, encodeTopicElement, decodeTopicElement, constants, visit,
  wait
};
