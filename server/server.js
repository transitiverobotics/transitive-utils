
const fs = require('fs');
const path = require('path');

const assert = require('assert');
const jwt = require('jsonwebtoken');
const http = require('http');
const https = require('https');

const Mongo = require('./mongo');
const { getRandomId } = require('../common/common');

const randomId = getRandomId;

// moved to common
// const decodeJWT = (token) => JSON.parse(Buffer.from(token.split('.')[1], 'base64'));

/** set the title of the terminal we are running in */
const setTerminalTitle = (title) => console.log(`\0o33]0;${title}\0o07`);

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

/** walk up the directory tree until we find a file or directory called basename
 */
const findPath = (basename) => {
  let lastDir = null;
  let dir = process.cwd();
  while (dir != lastDir) {
    if (fs.existsSync(`${dir}/${basename}`)) {
      return `${dir}/${basename}`;
    }
    lastDir = dir;
    dir = path.dirname(dir);
  }
  return null;
};

const versionScopes = ['major', 'minor', 'patch'];
/** Get from package info the version namespace we should use, e.g.,
`{version: '1.2.3', config.versionNamespace: 'minor'}` => '1.2' */
const getPackageVersionNamespace = () => {
  let versionScope =
    versionScopes.indexOf(process.env.npm_package_config_versionNamespace || 'patch');
  versionScope < 0 && (versionScope = 2);
  return process.env.npm_package_version?.split('.')
      .slice(0, versionScope + 1).join('.');
};

module.exports = Object.assign({}, {
  findPath, getPackageVersionNamespace,
  randomId, setTerminalTitle, fetchURL,
  Mongo
});
