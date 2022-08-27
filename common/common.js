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

/** convenience function to set all loggers to the given level */
loglevel.setAll = (level) =>
  Object.values(loglevel.getLoggers()).forEach(l => l.setLevel(level));

// patch the methodFactory to prefix logs with name and level
const originalFactory = loglevel.methodFactory;
loglevel.methodFactory = (methodName, level, loggerName) => {
  const rawMethod = originalFactory(methodName, level, loggerName);
  return (...args) => rawMethod(`[${loggerName},${methodName}]`, ...args);
};

/** get a new logger; call with a name, e.g., `module.id` */
const getLogger = loglevel.getLogger;

/** Deep-clone the given object. All functionality is lost, just data is kept. */
const clone = (obj) => JSON.parse(JSON.stringify(obj));

// -------------------------------------------------------------------------
// DataCache tools

/** Unset the topic in that obj, and clean up parent if empty, recursively.
  Return the path to the removed node.
 */
const unset = (obj, path) => {
  if (!path || path.length == 0) return;
  _.unset(obj, path);
  const parentPath = path.slice(0, -1);
  // _.get doesn't do the intuitive thing for the empty path, handle it ourselves
  const parent = parentPath.length == 0 ? obj : _.get(obj, parentPath);
  if (_.isEmpty(parent)) {
    return unset(obj, parentPath);
  } else {
    return path;
  }
};

/** given a modifier {"a/b/c": "xyz"} update the object `obj` such that
  obj.a.b.c = "xyz" */
const updateObject = (obj, modifier) => {
  _.forEach( modifier, (value, topic) => {
    const path = topicToPath(topic);
    if (value == null) {
      unset(obj, path);
    } else {
      _.set(obj, path, value);
    }
  });
  return obj;
};

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

/** given an object and a path with wildcards (* and +), *modify* the object
  to only contain elements matched by the path, e.g.,
  {a: {b: 1, c: 2}, d: 2} and ['a','+'] would give {a: {b: 1, c: 2}}
*/
const selectFromObject = (obj, path) => {
  if (path.length == 0) return;
  const next = path[0];
  if (next) {
    for (let key in obj) {
      if (key != next && next != '*' && !next.startsWith('+')) {
        delete obj[key];
      } else {
        selectFromObject(obj[key], path.slice(1));
      }
    }
  }
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

class DataCache {

  #data = {};
  #listeners = [];
  #flatListeners = [];

  constructor(data = {}) {
    this.#data = data;
  }

  /** update the object with the given value at the given path, remove empty;
    return the flat changes (see toFlatObject). Add `tags` to updates to mark
    them somehow based on the context, e.g., so that some subscriptions can choose
  to ignore updates with a certain tag.
  */
  updateFromArray(path, value, tags = {}) {
    // const empty = Object.keys(this.#data).length == 0; // object already empty
    const current = _.get(this.#data, path);
    if (value == null) {
      if (current === undefined || current === null) {
        return {}; // no change, do not call listeners
      } else {
        unset(this.#data, path);
      }
    } else {
      if (_.eq(current, value)) {
        // note: this is just a shallow equal, so replacing a sub-document
        // with an atomic copy of it should still trigger listeners.
        return {}; // nothing to do, do not bother listeners
      }
      // console.log('setting', path, value);
      _.set(this.#data, path, value);
      // TODO: implement this ourselves so we can do better change-checking
    }

    const topic = pathToTopic(path);
    const obj = {[topic]: value};

    // flatten the value and combine eith topic (without reflattening the topic):
    let flatChanges;
    if (value instanceof Object) {
      const flatValue = toFlatObject(value);
      flatChanges = {};
      _.forEach(flatValue, (atomic, flatKey) => {
        flatChanges[`${topic}${flatKey}`] = atomic;
      });
    } else {
      flatChanges = obj;
    }

    // option 1. using flat changes (sub-documents are never atomic)
    // this.#listeners.forEach(fn => fn(flatChanges));

    // option 2. allow atomic sub-document changes
    this.#listeners.forEach(fn => fn(obj, tags));

    this.#flatListeners.forEach(fn => fn(flatChanges, tags));

    return flatChanges;
  }

  /** update the value at the given path (array or dot separated string) */
  update(path, value, tags) {
    if (typeof path == 'string') {
      return this.updateFromTopic(path, value, tags);
    } else if (path instanceof Array) {
      return this.updateFromArray(path, value, tags);
    } else {
      throw new Error('unrecognized path expression');
    }
  }

  /** set value from the given topic (with or without leading or trailing slash) */
  updateFromTopic(topic, value, tags) {
    return this.updateFromArray(topicToPath(topic), value, tags);
  }

  /** update data from a modifier object where keys are topic names to be
    interpreted as paths, and values are the values to set */
  updateFromModifier(modifier, tags) {
    return _.map(modifier, (value, topic) =>
      this.updateFromTopic(topic, value, tags));
  }

  /** add a callback for change events */
  subscribe(callback) {
    if (callback instanceof Function) {
      this.#listeners.push(callback);
    } else {
      console.warn('DataCache.subscribe expects a function as argument. Did you mean to use subscribePath?');
    }
  }

  /** Subscribe to a specific topic only. Unlike in `subscribe`, here callback
  only receives the value. */
  subscribePath(topic, callback) {
    this.#listeners.push((changes, tags) => {
      _.forEach(changes, (value, key) => {
        const matched = pathMatch(topic, key);
        matched && callback(value, key, matched, tags);
      });
    });
  }

  /** Same as subscribePath but always get all changes in flat form */
  subscribePathFlat(topic, callback) {
    this.#flatListeners.push((changes, tags) => {
      _.forEach(changes, (value, key) => {
        const matched = pathMatch(topic, key);
        matched && callback(value, key, matched, tags);
      });
    });
  }

  /** remove a callback */
  unsubscribe(callback) {
    this.#listeners = this.#listeners.filter(f => f != callback);
  }

  /** get sub-value at path, or entire object if none given */
  get(path = []) {
    return path.length == 0 ? this.#data : _.get(this.#data, path);
  }

  getByTopic(topic) {
    return this.get(topicToPath(topic));
  }

  /** filter the object using path with wildcards */
  filter(path) {
    const rtv = JSON.parse(JSON.stringify(this.get()));
    selectFromObject(rtv, path);
    return rtv;
  }

  /** filter the object using topic with wildcards */
  filterByTopic(topic) {
    return this.filter(topicToPath(topic));
  }

  /** for each topic match, invoke the callback with the value, topic, and match
  just like subscribePath */
  forMatch(topic, callback) {
    const path = topicToPath(topic);
    this.forPathMatch(path, callback);
  }

  /** for each path match, invoke the callback with the value, topic, and match
  just like subscribePath */
  forPathMatch(path, callback) {
    forMatchIterator(this.get(), path, callback);
  }
};

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


module.exports = { parseMQTTUsername, parseMQTTTopic, updateObject, DataCache,
  pathToTopic, topicToPath, toFlatObject, mqttTopicMatch, pathMatch,
  mqttParsePayload, getRandomId, versionCompare, loglevel, getLogger,
  mergeVersions, mqttClearRetained, isSubTopicOf, clone, setFromPath,
  forMatchIterator, encodeTopicElement, decodeTopicElement
};
