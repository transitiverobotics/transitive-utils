
const { EventEmitter } = require('node:events');
const _ = require('lodash');
const zmq = require('zeromq')

const { getLogger, tryJSONParse } = require('@transitive-sdk/utils');

const AbstractROS = require('./abstractRos.js')

const log = getLogger('ROS0');
log.setLevel('debug');


/** A class that is interface-compatible with our ROS and ROS2 classes, but
* connects to ZeroMQ addresses for pub and sub instead. For non-ROS users.
* To enable, set `global.rosFs` to a truthy value in `config.json`. Config options:
* - `address` (default 'ipc:///tmp/transitive-zmq.sock'): the zeroMQ address to
* bind (Publisher) and connect to (Subscriber).
*/
class ROS0 extends AbstractROS(EventEmitter) {

  rosVersion = 0;
  pub = null;
  sub = null;
  address = null;

  /** Open two UNIX domain sockets: one for pushing and one for pulling */
  async init(config) {
    if (this.pub && this.sub) {
      log.info('already initialized');
      return;
    }

    this.config = config
      || JSON.parse(process.env.TRCONFIG || '{}')?.global?.ros0
      || {};

    this.address = this.config.address || 'ipc:///tmp/transitive-zmq.sock';

    log.info('initializing, connecting to zeroMQ address:', this.address);

    this.pub = new zmq.Publisher();
    await this.pub.bind(this.address);

    this.sub = new zmq.Subscriber()
    this.sub.connect(this.address);

    // Do NOT await
    this.watchForMessages().catch(err => log.error(err));

    log.info('done initializing');
  }

  /** Start watching for messages; Do _not_ await this! */
  async watchForMessages() {
    for await (const [topic, msg] of this.sub) {
      const topicStr = topic.toString('utf8');
      const msgStr = msg.toString('utf8');
      const msgJSON = tryJSONParse(msgStr) || msgStr;
      this.emit(`msg/${topicStr}`, msgJSON);
    }
  }

  requireInit() {
    if (!this.pub && !this.sub) {
      throw Error('need to call init first');
    }
  }

  /** Subscribe to the named topic of the named type. Each time a new message
  * is received the provided callback is called.
  * */
  subscribe(topic, _type, onMessage) {
    this.requireInit();
    this.sub.subscribe(topic);
    this.on(`msg/${topic}`, onMessage);
  }

  /** Unsubscribe from topic */
  unsubscribe(topic) {
    this.sub.unsubscribe(topic);
    this.removeAllListeners(`msg/${topic}`);
  }

  /** Publish the given message (json) on the names topic of type. Will
  advertise the topic if not yet advertised. */
  async publish(topic, _type, message, latching = true) {
    this.requireInit();
    await this.pub.send([topic, message]);
  }

  shutdown() {
    this.isShutdown = true;
    this.pub.unbind(this.address);
    this.sub.disconnect(this.address);
  }
};

const instance = new ROS0();

module.exports = instance;
