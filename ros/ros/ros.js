const rosnodejs = require('rosnodejs');

const { getLogger } = require('@transitive-sdk/utils');
const log = getLogger('ROS1');
log.setLevel('info');

const ROS_MASTER_URI = process.env.ROS_MASTER_URI || 'http://localhost:11311';

/** Small convenient singleton class for interfacing with ROS, including some
  auxiliary functions that come in handy in capabilities. Based on rosnodejs. */
class ROS {

  publishers = {};

  rosVersion = 1;

  async init(suffix = '') {
    if (this.rn) {
      log.info('already initialized');
      return;
    }

    log.info('initializing, using master:', ROS_MASTER_URI);

    const nodeName =
      (process.env.TRPACKAGE || `cap_ros_${Date.now().toString(16)}`)
        .replace(/[^a-zA-Z0-9\/\_]/g, '_');

    this.rn = await rosnodejs.initNode(`/transitive/${nodeName}${suffix}`, {
      rosMasterUri: ROS_MASTER_URI,
      notime: true,
      logging: {skipRosLogging: true},
      node: {forceExit: true}
    });

    log.info('done initializing');
  }

  requireInit() {
    if (!this.rn) {
      throw Error('need to call init first');
    }
  }

  async getTopicsWithTypes(type = undefined) {
    this.requireInit();

    let {topics} = await this.rn._node._masterApi.getPublishedTopics();
    type && (topics = topics.filter(topic => topic.type == type));
    return topics;
  }

  async getTopics(type = undefined) {
    const topics = await this.getTopicsWithTypes(type);
    return topics.map(t => t.name);
  }

  /** Get topics that have subscribers */
  async getSubscribedTopics(type = undefined) {
    this.requireInit();

    let {subscribers} = await this.rn._node._masterApi.getSystemState();
    const topicTypes = await this.rn._node._masterApi.getTopicTypes();
    return topicTypes.topics.filter(topic =>
      (!type || topic.type == type) && // topic is of the right type
        subscribers[topic.name] // and it has subscribers
    ).map(topic => topic.name); // we only want the name
  }

  subscribe(topic, type, onMessage) {
    this.requireInit();
    const subscriber = this.rn.subscribe(topic, type, onMessage, {throttleMs: -1});
    return {shutdown: subscriber.shutdown.bind(subscriber)};
  }

  unsubscribe(topic) {
    this.rn.unsubscribe(topic);
  }

  /** Publish the given message (json) on the names topic of type. Will
  advertise the topic if not yet advertised. */
  publish(topic, type, message, latching = true) {
    if (!this.publishers[topic]) {
      this.publishers[topic] = this.rn.advertise(topic, type, {
        queueSize: 1,
        latching,
        throttleMs: -1
      });
    }

    const pub = this.publishers[topic];
    const [msgPackage, msgType] = type.split('/');
    const MsgClass = rosnodejs.require(msgPackage).msg[msgType];
    const msgInstance = new MsgClass(message);
    pub.publish(msgInstance);
  }

  /** create a std_msgs/Header for the given frame_id and date */
  createHeader(frame_id = '', date = new Date()) {
    const msecs = date.getTime();
    return {
      stamp: {
        seq: 0,
        secs: Math.floor(msecs / 1000),
        nsecs: (msecs % 1000) * 1e6
      },
      frame_id
    };
  }

  shutdown() {
    Object.values(this.publishers).forEach(pub => {
      pub.shutdown();
    });
  }
};

const instance = new ROS();

module.exports = instance;
