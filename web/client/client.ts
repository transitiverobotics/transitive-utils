// It is OK to use paths outside of this package because webpack will bundle them
export * from '../../common/common';
export * from '../../common/datacache/index';
export { MqttSync } from '../../common/MqttSync';

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
export const fetchJson = (
  url: string,
  callback: (error: string | false | undefined, data?: unknown) => void,
  options: { method?: string; body?: unknown; headers?: Record<string, string> } = {}
) => {
  fetch(url, {
    method: options.method || (options.body ? 'post' : 'get'),
    mode: 'cors',
    cache: 'no-cache',
    // Maybe we'll need this (when embedding)?
    // credentials: 'same-origin', // include, *same-origin, omit
    headers: {
      'Content-Type': 'application/json',
      ...options.headers
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
