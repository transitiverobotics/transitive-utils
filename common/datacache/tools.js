
const _ = {
  get: require('lodash/get'),
  set: require('lodash/set'),
  forEach: require('lodash/forEach'),
  map: require('lodash/map'),
  isPlainObject: require('lodash/isPlainObject'),
};


// -------------------------------------------------------------------------
// DataCache tools

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


/** convert a path array to mqtt topic; reduces +id identifiers to + */
const pathToTopic = (pathArray) => {
  /** reduce wildcards with Ids, such as `+sessionId`, to just + */
  const dropWildcardIds = (x) => x.startsWith('+') ? '+' : x;
  return `/${pathArray.map(dropWildcardIds).map(encodeTopicElement).join('/')}`;
};

/**
 * Given an object, return a new flat object of topic+value pairs, e.g.:
```js
{a: {b: 1, c: 2}, d: 3}   →   {'/a/b': 1, '/a/c': 2, '/d': 3}
```
Note: not idempotent!
```js
{'/a/b': 1, '/a/c': 2, d: 3}  →  {'%2Fa%2Fb': 1, '%2Fa%2Fc': 2, '/d': 3}
```
*/
const toFlatObject = (obj, prefix = [], rtv = {}) => {
  _.forEach(obj, (value, key) => {
    // const newPrefix = prefix.concat(topicToPath(String(key)));
    const newPrefix = prefix.concat(String(key));

    // TODO: using isPlainObject also means custom objects (classes) do not get
    // broken down.
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


/** Match a slash-separated topic or path array with a selector using +XYZ for
* (named) wildcards. Return the matching result.
*/
const topicMatch = (selector, topic) => {
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

  const selectorArray = Array.isArray(selector) ? selector : topicToPath(selector);
  const pathArray = Array.isArray(topic) ? topic : topicToPath(topic);
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


module.exports = {
  topicToPath,
  pathToTopic,
  toFlatObject,
  forMatchIterator,
  setFromPath,
  encodeTopicElement,
  decodeTopicElement,
  topicMatch,
  isSubTopicOf,
};