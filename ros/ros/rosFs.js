
const { EventEmitter } = require('node:events');
const fs = require('node:fs')
const path = require('node:path')

const _ = require('lodash')

const { getLogger, tryJSONParse } = require('@transitive-sdk/utils');

const AbstractROS = require('./abstractRos.js')

const log = getLogger('ROSfs');
log.setLevel('debug');


/** A class that is interface-compatible with our ROS and ROS2 classes, but
* uses the filesystem for pub and sub instead. For non-ROS users, low rate.
* To enable, set `global.rosFs` to a truthy value in `config.json`.
*
* Config options:
* - `basePath` (default: '/tmp/transitive-ros-fs/'): the root of the file-tree
* where to publish and subscribe to "topics", i.e., files.
* - `publishInterval` (default 10000, min: 1000): throttle interval (in ms) for
* publishing.
*
* Example assuming default config:
* - `publish('/my/topic', null, {mytime: 1778801349319})` would write the given JSON
*   to `/tmp/transitive-ros-fs/my/topic`.
* - `subscribe('/my/topic', null, console.log)` would watch
*   `/tmp/transitive-ros-fs/my/topic` and, on changes, print the new content to
*   the console (JSON parsed).
*/
class ROSfs extends AbstractROS(EventEmitter) {

  rosVersion = 'fs';
  basePath = null;
  publisherDirs = {}; // keep track of dirs we've already created
  watchedDirs = {}; // dirs and watchers

  init(config = undefined) {
    this.config = config
      || JSON.parse(process.env.TRCONFIG || '{}')?.global?.rosFs
      || {};
    this.basePath = this.config.basePath || '/tmp/transitive-ros-fs/';
    fs.mkdirSync(this.basePath, {recursive: true});

    /** Publish the given message (json) on the named "topic", i.e., filepath. */
    this.publish = _.throttle((topic, _type, message, latching = true) => {
        const filePath = path.join(this.basePath, topic);
        const dir = path.dirname(filePath);
        if (!this.publisherDirs[dir]) {
          fs.mkdirSync(dir, {recursive: true});
          this.publisherDirs[dir] = true;
        }

        fs.writeFileSync(filePath, JSON.stringify(message));
      }, Math.max(this.config.publishInterval || 10000, 1000))

    log.info('done initializing');
  }

  requireInit() {
    if (!this.basePath) {
      throw Error('need to call init first');
    }
  }

  /** Refresh and emit the topic value from file; debounced to handle repeat
   * triggers caused by many ways of modifying the file (including
  * `echo "test" > file` and some editors)
  */
  refreshFromFile = _.debounce((topic, filename) => {
      try {
        const data = JSON.parse(fs.readFileSync(filename, 'utf8'));
        // log.debug('file-based API', filename, data);
        this.emit(`msg/${topic}`, data);

      } catch (e) {
        if (e.code == 'ENOENT') {
          log.debug(`API file ${filename} doesn't exist.`);
        } else {
          log.warn(`Could not parse file API file content of ${filename}`, e.message);
        }
      }
    }, 100, {maxWait: 1000})

  /** subscribe to topic: start watching the respective directory and register
  * event handler */
  subscribe(topic, _type, onMessage) {

    this.on(`msg/${topic}`, onMessage);

    const dir = path.dirname(path.join(this.basePath, topic));
    if (this.watchedDirs[dir]) {
      log.debug('already watching', dir);
      return;
    }

    fs.mkdirSync(dir, {recursive: true});
    this.watchedDirs[dir] = fs.watch(dir, (type, filename) => {
      this.refreshFromFile(topic, path.join(dir, filename));
    });
  }

  /** Unsubscribe from topic */
  unsubscribe(topic) {
    this.removeAllListeners(`msg/${topic}`);
    // TODO: check if we can stop watching the corresponding folder
  }


  shutdown() {
    for (let dir in this.watchedDirs) {
      this.watchedDirs[dir].close();
    }
  }
};

const instance = new ROSfs();

module.exports = instance;
