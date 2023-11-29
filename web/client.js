
// It is OK to use paths outside of this package because webpack will bundle them
export * from '../common/common.js';
import MS from '../common/MqttSync.js';
export * from '../common/DataCache';

export const MqttSync = MS;

// moved to common
// export const decodeJWT = (jwt) => JSON.parse(atob(jwt.split('.')[1]));

/** parse document cookies */
export const parseCookie = str =>
  str.split(';')
    .map(v => v.split('='))
    .reduce((acc, v) => {
      acc[decodeURIComponent(v[0].trim())] =
        v[1] && decodeURIComponent(v[1].trim());
      return acc;
    }, {});

/** get or post (if body given) json */
export const fetchJson = (url, callback, options = {}) => {
  fetch(url, {
    method: options.method || (options.body ? 'post' : 'get'),
    mode: 'cors',
    cache: 'no-cache',
    // Maybe we'll need this (when embedding)?
    // credentials: 'same-origin', // include, *same-origin, omit
    headers: {
      'Content-Type': 'application/json'
    },
    redirect: 'follow',
    referrerPolicy: 'no-referrer',
    body: options.body ? JSON.stringify(options.body) : undefined
  }).then(res => {
      const error = !res.ok &&
        `fetching ${url} failed: ${res.status} ${res.statusText}`;
      res.json()
        .then(data => callback(error, data))
        .catch(err => {
          throw new Error(err);
        });
    }).catch((error) => callback(`error: ${error}`));
};
