/** server-only utils */
const assert = require('assert')

const common = require('./common/common');
const MqttSync = require('./common/MqttSync');
const crypto = require('crypto')
const cloud = require('./cloud');
const Mongo = require('./mongo');

const randomId = (bytes = 16) => crypto.randomBytes(bytes).toString('base64');

/** set the title of the terminal we are running in */
const setTerminalTitle = (title) => console.log(`\0o33]0;${title}\0o07`);

const decodeJWT = (jwt) => JSON.parse(Buffer.from(jwt.split('.')[1], 'base64'));

module.exports = Object.assign({}, common, cloud, {
  randomId, decodeJWT, setTerminalTitle, MqttSync, Mongo
});
