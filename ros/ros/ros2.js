const rclnodejs = require('rclnodejs');

const { getLogger } = require('@transitive-sdk/utils');
const log = getLogger('ROS2');
log.setLevel('info');

qos = new rclnodejs.QoS();
qos.reliability = rclnodejs.QoS.ReliabilityPolicy.RMW_QOS_POLICY_RELIABILITY_BEST_EFFORT;

/** Small convenient singleton class for interfacing with ROS2, including some
  auxiliary functions that come in handy in capabilities. Based on rclnodejs. */
class ROS2 {

  publishers = {};
  // subscriptions keyed by topic
  subscriptions = {};
  // the rclnode
  node;

  rosVersion = 2;

  /** Initialize ROS node. This needs to be called first. */
  async init(suffix = '') {

    if (this.node) {
      log.info('already initialized');
      return;
    }

    log.info('initializing');
    const nodeName =
      (process.env.TRPACKAGE || `cap_ros_${Date.now().toString(16)}`)
        .replace(/[^a-zA-Z0-9\_]/g, '_');

    if (!rclnodejs.Context.defaultContext().isInitialized()) {
      await rclnodejs.init();
    }

    this.node = rclnodejs.createNode(
      `${nodeName}${suffix.replace(/[^a-zA-Z0-9\_]/g, '_')}`);
    rclnodejs.spin(this.node);
    log.info('done initializing');
  }

  requireInit() {
    if (!this.node) {
      throw Error('need to call init first');
    }
  }

  async getTopicsWithTypes(type = undefined) {
    this.requireInit();
    let topics = this.node.getTopicNamesAndTypes();
    type && (topics = topics.filter(topic => topic.types.includes(type)));
    return topics;
  }

  /** Get all topic of a given type or all topics ifno type is specified */
  async getTopics(type = undefined) {
    const topics = await this.getTopicsWithTypes(type);
    return topics.map(t => t.name);
  }

  /** Get topics that have subscribers */
  async getSubscribedTopics(type = undefined) {
    this.requireInit();
    const topics = await this.getTopics(type);
    const subscribedTopics = topics.filter(topic =>
      this.node.countSubscribers(topic) > 0);
    return subscribedTopics;
  }

  /** Subscribe to the named topic of the named type. Each time a new message
  * is received the provided callback is called. For available options see
  * https://robotwebtools.github.io/rclnodejs/docs/0.22.3/Node.html#createSubscription.
  * The default `options.qos.reliability` is best-effort.
  * */
  subscribe(topic, type, onMessage, options = {}) {
    this.requireInit();
    const sub = this.node.createSubscription(
      type, topic, {qos, ...options}, onMessage);
    this.subscriptions[topic] = sub;
    return {
      shutdown: () => {
        if (!sub || sub.__destroyed) return;
        sub.__destroyed = true;
        this.node.destroySubscription(sub);
      }
    }
  }

  /** Unsubscribe from topic */
  unsubscribe(topic) {
    const sub = this.subscriptions[topic];
    if (!sub) {
      console.warn(`cannot unsubscribe from ${topic}, subscription not found`);
      return;
    }
    this.node.destroySubscription(sub);
  }

  /** Publish the given message (json) on the names topic of type. Will
  advertise the topic if not yet advertised. */
  publish(topic, type, message, latching = true) {
    if (!this.publishers[topic]) {
      this.publishers[topic] = this.node.createPublisher(type, topic);
    }

    this.publishers[topic].publish({
      header: this.createHeader(),
      ...message
    });

    // TODO: latching, see
    // https://github.com/RobotWebTools/rclnodejs/blob/develop/example/publisher-qos-example.js
    // and https://github.com/ros2/ros2/issues/464
  }

  /** create a std_msgs/Header for the given frame_id and date */
  createHeader(frame_id = '', date = new Date()) {
    const msecs = date.getTime();
    return {
      stamp: {
        sec: Math.floor(msecs / 1000),
        nanosec: (msecs % 1000) * 1e6
      },
      frame_id
    };
  }
};

const instance = new ROS2();

module.exports = instance;
