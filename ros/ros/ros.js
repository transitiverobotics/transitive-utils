
process.env.CMAKE_PREFIX_PATH += `:${process.env.PWD}/var/ros1`;
const rosnodejs = require('rosnodejs');
const _ = require('lodash');

const { getLogger, wait } = require('@transitive-sdk/utils');
const log = getLogger('ROS1');
log.setLevel('info');

const ROS_MASTER_URI = process.env.ROS_MASTER_URI || 'http://localhost:11311';

/** Small convenient singleton class for interfacing with ROS, including some
  auxiliary functions that come in handy in capabilities. Based on rosnodejs. */
class ROS {

  publishers = {};
  isShutdown = false;

  rosVersion = 1;

  async generateMessages() {
    log.info('Generating messages for ROS 1');
    await rosnodejs.loadAllPackages(
      `${process.env.PWD}/var/ros1/share/gennodejs/ros`);
  }

  /** Initialize ROS node. This needs to be called first. */
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
      logging: {
        skipRosLogging: true,
        overrideLoggerCleanup: true
      },
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

  /** Get all topic of a given type or all topics if no type is specified */
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

  /** Get available services (list of names). */
  async getServices() {
    this.requireInit();
    let {services} = await this.rn._node.getSystemState();
    return Object.keys(services);
  }

  /** Get type of a given service. Note that in ROS 1 this requires connecting
  * to the service provider directly, and we don't want to poll all of them. So
  * only use this on-demand. */
  async getServiceType(service) {
    const header =
      await Promise.race([ this.rn.getServiceHeader(service), wait(1000) ]);
    if (!header) {
      log.warn(`Timeout waiting for service: ${service}`);
      return null;
    }
    return header.type;
  }

  /** Get available actions */
  async getActions() {
    const {publishers, subscribers} = await this.rn._node._masterApi.getSystemState();
    const topicTypes = await this.rn._node._masterApi.getTopicTypes();
    const topicTypesIndex = _.keyBy(topicTypes.topics, 'name');

    // find actions based on published and subscribed topics
    const actions = {};

    // collect goal and cancel topics
    _.forEach(subscribers, (_nodes, topic) => {
      const parts = topic.split('/');
      const name = parts.slice(0,-1).join('/');
      if (['goal', 'cancel'].includes(parts.at(-1))) {
        actions[name] ||= {};
        actions[name][parts.at(-1)] = topicTypesIndex[topic].type;
      }
    });

    // collect result, feedback, and status topics
    _.forEach(publishers, (_nodes, topic) => {
      const parts = topic.split('/');
      const name = parts.slice(0,-1).join('/');
      if (['result', 'feedback', 'status'].includes(parts.at(-1))) {
        actions[name] ||= {};
        actions[name][parts.at(-1)] = true;
      }
    });

    // return names of complete actions, i.e., those that have all required topics
    const results = {};
    _.forEach(actions, (topics, name) =>
      ['goal', 'cancel', 'result', 'feedback', 'status'].every(topic =>
        topics[topic]) && (results[name] = topics.goal.replace(/Goal$/, '')));

    return results;
  }


  /** Subscribe to the named topic of the named type. Each time a new message
  * is received the provided callback is called. Here `options` is an optional
  * object: `{ "throttleMs": throttle-in-milliseconds }`.
  * */
  subscribe(topic, type, onMessage, options = {}) {
    this.requireInit();
    const subscriber = this.rn.subscribe(topic, type, onMessage,
      {throttleMs: -1, ...options});
    return {shutdown: subscriber.shutdown.bind(subscriber)};
  }

  /** Unsubscribe from topic */
  unsubscribe(topic) {
    this.rn.unsubscribe(topic);
  }

  /** Publish the given message (json) on the names topic of type. Will
  advertise the topic if not yet advertised. */
  async publish(topic, type, message, latching = true) {
    this.requireInit();
    if (!this.publishers[topic]) {
      this.publishers[topic] = this.rn.advertise(topic, type, {
        queueSize: 1,
        latching,
        throttleMs: -1
      });
      // Ugly but seems necessary and I don't see a better signal to wait for.
      // Without this, the first published message doesn't go through, presumably
      // because we are not yet registered as a publisher with the master.
      await wait(100);
    }

    if (this.isShutdown) {
      // since we may have waited, we need to verify that we are not shut down
      log.debug('We are shut down, not publishing to', topic);
      return;
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
    this.isShutdown = true;
    Object.values(this.publishers).forEach(pub => {
      pub.shutdown();
    });
  }

  /** Call the given service of the given type with the given body (not required
  * when type is "std_srvs/Empty"). */
  async callService(serviceName, type, requestBody = undefined) {

    let serviceClient;
    try {
      serviceClient = this.rn.serviceClient(serviceName, type);
    } catch (e) {
      const error = `Unable to get service: "${e}"`;
      log.warn(`callService: ${error}`);
      return {success: false, error};
    }

    const available = await this.rn.waitForService(serviceClient.getService(), 2000);

    if (!available) {
      const error = `service not available "${service}"`;
      log.warn(`callService: ${error}`);
      return {success: false, error};
    }

    const [srvPackage, srvType] = type.split('/');
    const SrvClass = rosnodejs.require(srvPackage).srv[srvType];
    if (!SrvClass) {
      const error = `unknown service type "${type}"`;
      log.warn(`callService: ${error}`);
      return {success: false, error};
    }

    const request = new SrvClass.Request(requestBody);
    try {
      const response = await serviceClient.call(request);
      log.debug('Service response', response);
      return {success: true, response};
    } catch (error) {
      return {success: false, error: error.code};
    }
  }

  /** Get all known message and service types, grouped by package. */
  getAvailableTypes() {
    const packages = rosnodejs.getAvailableMessagePackages();
    const types = {};
    _.forEach(packages, (value, pkgName) => {
      try {
        const pkg = rosnodejs.require(pkgName);
        types[pkgName] = {
          msg: pkg.msg ? Object.keys(pkg.msg) : [],
          srv: pkg.srv ? Object.keys(pkg.srv) : []
        };
      } catch (e) {
        log.warn(`Failed to load package ${pkgName}`, e);
      }
    });
    return types;
  }

  /** Given a package, category, and type, e.g., 'std_msgs', 'msg', and 'String',
  * return a plain object representing that type, which can be used as a
  * template for creating messages. */
  getTypeTemplate(pkg, category, type, response = false) {
    if (category != 'msg' && category != 'srv') {
      throw new Error(`Unknown type category ${category} (must be msg or srv).`);
    }

    const Type = rosnodejs.require(pkg)[category][type];
    return (category == 'msg' ? new Type() :
      new Type[response ? 'Response' : 'Request']());
  }

  /** Get the value of the given ROS parameter  */
  async getParam(param) {
    return await this.rn.getParam(param);
  }

  /** Set the value of the given ROS parameter  */
  setParam(param, value) {
    return this.rn.setParam(param, value);
  }

    /** Call an action, i.e., send goal to action server */
  async callAction(actionServer, type, goal, feedbackCallback = undefined) {
    const client = new rosnodejs.ActionClient({nh: this.nh, type, actionServer});
    client.sendGoal(goal);
    // #HERE
  }

};

const instance = new ROS();

module.exports = instance;
