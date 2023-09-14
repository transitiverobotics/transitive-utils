/** server-only utils */
const assert = require('assert');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const https = require('https');

const common = require('./common/common');
const MqttSync = require('./common/MqttSync');
const cloud = require('./cloud');
const Mongo = require('./mongo');
const {DataCache, updateObject} = require('./common/DataCache');
const {findPath} = require('./server');

const randomId = (bytes = 16) => crypto.randomBytes(bytes).toString('base64');

/** set the title of the terminal we are running in */
const setTerminalTitle = (title) => console.log(`\0o33]0;${title}\0o07`);

const decodeJWT = (token) => JSON.parse(Buffer.from(token.split('.')[1], 'base64'));

/** a simple function to fetch a URL */
const fetchURL = (url) => new Promise((resolve, reject) => {
  const protocolHandlers = {http, https};
  const protocol = url.split(':')[0];
  const handler = protocolHandlers[protocol];
  if (!handler) {
    reject(`Unhandled protocol: ${protocol}`);
  }

  handler.get(url, (res) => {
    const { statusCode } = res;

    let error;
    // Any 2xx status code signals a successful response but
    // here we're only checking for 200.
    if (!(200 <= statusCode && statusCode < 300)) {
      // Consume response data to free up memory
      res.resume();
      reject(`HTTP request failed.\nStatus Code: ${statusCode}`);
      return;
    }

    let rawData = '';
    res.on('data', (chunk) => { rawData += chunk; });
    res.on('end', () => { resolve(rawData); });
  }).on('error', (e) => {
      reject(`HTTP request failed: ${e.message}`);
    });
});

// const PUBLIC_BILLING_KEY_PATH = '/home/transitive/publicBillingKey';
// const BILLING_KEY_URL = 'https://billing.transitiverobotics.com/publicKey';
// let publicBillingKey;
// const verifyPremiumJWT = (token) => {
//   if (!publicBillingKey) {
//     try {
//       publicBillingKey = fs.readFileSync(PUBLIC_BILLING_KEY_PATH,
//         {encoding: 'utf-8'});
//     } catch (e) {
//       // not yet stored locally
//       // #HERE: get key, test this;
//       const publicBillingKey = fetchURL(BILLING_KEY_URL);
//       // #NO this fetch could be spoofed by a self-hosting user, see ticket
//       fs.writeFileSync(PUBLIC_BILLING_KEY_PATH, publicBillingKey);
//     }
//   }

//   jwt.verify(token, publicBillingKey, {algorithm: 'RS256'});
// };

module.exports = Object.assign({}, common, cloud, {
  randomId, decodeJWT, setTerminalTitle, MqttSync, Mongo, fetchURL, DataCache,
  updateObject, findPath
});
