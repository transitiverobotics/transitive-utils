const fs = require('fs');
const path = require('path');
const rclnodejs = require('rclnodejs');
const _ = require('lodash');
const EventEmitter = require('events');

const { getLogger, wait } = require('@transitive-sdk/utils');
const log = getLogger('ROS2');
log.setLevel('info');

volatileQos = new rclnodejs.QoS();
volatileQos.reliability = rclnodejs.QoS.ReliabilityPolicy.RMW_QOS_POLICY_RELIABILITY_BEST_EFFORT;

latchingQos = new rclnodejs.QoS();
latchingQos.reliability = rclnodejs.QoS.ReliabilityPolicy.RMW_QOS_POLICY_RELIABILITY_RELIABLE;
latchingQos.durability = rclnodejs.QoS.DurabilityPolicy.RMW_QOS_POLICY_DURABILITY_TRANSIENT_LOCAL;



const primitiveDefaults = {
  bool: true,
  byte: 0,
  char: '',
  float32: 1.0001,
  float64: 1.0001,
  int16: 0,
  int32: 0,
  int64: 0,
  int8: 0,
  string: '',
  uint16: 0,
  uint32: 0,
  uint64: 0,
  uint8: 0,
};

/* Generate a template of the given type class with default values for all
* fields. */
const generateTemplate = (TypeClass) => {
  const rtv = {};

  const get = (type) => type.isArray ? [get({...type, isArray: false})] :
    type.isPrimitiveType ? primitiveDefaults[type.type] :
    generateTemplate(rclnodejs.require(`${type.pkgName}/msg/${type.type}`));

  TypeClass.ROSMessageDef.fields.forEach(({name, type}) => {
    rtv[name] = get(type);
  });
  return rtv;
};

/* Function to implement convenience of providing a ROS1 type and converting it
 * to ROS2, i.e., inject msg/ or srv/ .*/
const toROS2Type = (type, category = 'msg') => {
  if (!type) return type; // null or undefined, keep it like that
  const parts = type.split('/');
  if (parts.length > 2) return type; // already a ROS2 type
  return [parts[0], category, parts[1]].join('/');
};

/** Small convenient singleton class for interfacing with ROS2, including some
  auxiliary functions that come in handy in capabilities. Based on rclnodejs. */
class ROS2 {

  publishers = {};
  // subscriptions keyed by topic
  subscriptions = {};
  // the rclnode
  node;

  rosVersion = 2;

  emitter;

  async generateMessages() {
    log.info('Generating messages for ROS 2');
    await rclnodejs.regenerateAll();
  }

  /** Initialize ROS node. This needs to be called first. */
  async init(suffix = '') {

    if (this.node) {
      log.info('already initialized');
      return;
    }

    log.info('initializing');

    this.emitter = new EventEmitter();
    const nodeName =
      (process.env.TRPACKAGE || `cap_ros_${Date.now().toString(16)}`)
        .replace(/[^a-zA-Z0-9\_]/g, '_');

    if (!rclnodejs.Context.defaultContext().isInitialized()) {
      await rclnodejs.init();
    }

    this.node = rclnodejs.createNode(
      `${nodeName}${suffix.replace(/[^a-zA-Z0-9\_]/g, '_')}`, 'transitive');
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
    const ros2Type = toROS2Type(type);
    ros2Type && 
    (topics = topics
      .filter(topic => topic.types.includes(ros2Type))
      .map(topic => ({name: topic.name, type: ros2Type}))
    );
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
    const topics = await this.getTopics(type);
    const subscribedTopics = topics.filter(topic =>
      this.node.countSubscribers(topic) > 0);
    return subscribedTopics;
  }

  /** Get list of available services (list of names). */
  async getServices() {
    const list = await this.node.getServiceNamesAndTypes();
    return list.map(({name}) => name);
  }

  /** Get type of a given service. */
  async getServiceType(service) {
    const list = await this.node.getServiceNamesAndTypes();
    return list.find(({name}) => name == service)?.types[0];
  }

  /** Destroys a given subscriber. */
  _destroySubscriber(subscriber) {
    if (subscriber && !subscriber.__destroyed) {
      subscriber.__destroyed = true;
      this.node.destroySubscription(subscriber);
    }
  }
  /** Subscribe to the named topic of the named type. Each time a new message
  * is received the provided callback is called. For available options see
  * https://robotwebtools.github.io/rclnodejs/docs/0.22.3/Node.html#createSubscription.
  * The default `options.qos.reliability` is best-effort.
  * options object can contain: "throttleMs": throttle-in-milliseconds.
  * */
  subscribe(topic, type, onMessage, options = {}) {
    this.requireInit();
    let firstLatchedMessage;
    const ros2Type = toROS2Type(type);
    const throttledCallback = options?.throttleMs ?
      _.throttle(onMessage, options.throttleMs) :
      onMessage;

    // we create two subscriptions, one for latched messages and one for volatile (new) messages
    // after receiving the first message we destroy the latched subscription and only keep the volatile one
    // we need to do this because of qos incompatibilities between volatile/latching pubs and subs
    // we can't have a single subscription that can handle both, and user may not be in control of the publisher
    // see https://docs.ros.org/en/rolling/Concepts/Intermediate/About-Quality-of-Service-Settings.html#qos-compatibilities
    const latchingSub = this.node.createSubscription(
      ros2Type, topic, {qos: latchingQos, ...options}, (msg) => {
        this._destroySubscriber(latchingSub);
        firstLatchedMessage = msg;
        this.emitter.emit(topic, msg);
      }
    );

    const volatileSub = this.node.createSubscription(
      ros2Type, topic, {qos: volatileQos, ...options}, (msg) => {
        this._destroySubscriber(latchingSub);
        if (firstLatchedMessage) {
          if (_.isEqual(firstLatchedMessage, msg)) {
            firstLatchedMessage = undefined;
            // avoids duplicating first message
            return;
          }
          firstLatchedMessage = undefined;          
        }
        this.emitter.emit(topic, msg);
      }
    );  

    if (!this.subscriptions[topic]) {
      this.subscriptions[topic] = {
        volatileSubscriber: volatileSub,
        latchingSubscriber: latchingSub,
      };
    }

    this.emitter.on(topic, throttledCallback);
    return {
      shutdown: () => {
        const sub = this.subscriptions[topic];
        if (!sub) {
          console.warn(`cannot shutdown ${topic}, subscription not found`);
          return;
        }
        this.emitter.off(topic, throttledCallback);
        if (this.emitter.listenerCount(topic) == 0) {
          this.unsubscribe(topic);
        }
      }
    }
  }

  /** Unsubscribe from topic */
  unsubscribe(topic) {
    this.emitter.removeAllListeners(topic);
    const sub = this.subscriptions[topic];
    if (!sub) {
      console.warn(`cannot unsubscribe from ${topic}, subscription not found`);
      return;
    }
    this._destroySubscriber(sub.volatileSubscriber);
    this._destroySubscriber(sub.latchingSubscriber);
    delete this.subscriptions[topic];
  }

  /** Publish the given message (json) on the names topic of type. Will
  advertise the topic if not yet advertised. */
  publish(topic, type, message, latching = false) {
    if (!this.publishers[topic]) {
      const ros2Type = toROS2Type(type);
      this.publishers[topic] = this.node.createPublisher(ros2Type, topic, {qos: latching ? latchingQos : volatileQos});
    }

    this.publishers[topic].publish({
      header: this.createHeader(),
      ...message
    });
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


  /** Call the given service of the given type with the given body (not required
  * when type is "std_srvs/srv/Empty"). */
  async callService(serviceName, type, request = undefined) {

    let serviceClient;
    try {
      const ros2Type = toROS2Type(type, 'srv');
      serviceClient = this.node.createClient(ros2Type, serviceName);
    } catch (e) {
      const error = `Unable to get service: "${e}"`;
      log.warn(`callService: ${error}`);
      return {success: false, error};
    }

    const available = await serviceClient.waitForService(2000);

    if (!available) {
      const error = `service not available "${serviceName}"`;
      log.warn(`callService: ${error}`);
      return {success: false, error};
    }

    log.debug(`calling ${serviceName}`);
    return Promise.race([
      new Promise((resolve, reject) => {
        serviceClient.sendRequest(request, response => {
          log.debug('Service response', response);
          resolve({success: true, response});
        });
      }),
      (async () => { // adding a timeout
        await wait(2000);
        const error = `Timeout calling service: "${serviceName}"`;
        log.warn(`callService: ${error}`);
        return {success: false, error};
      })()
    ]);
  }

  /** Get all known message, service, and action types, grouped by package. */
  getAvailableTypes() {
    const packagePath = path.dirname(require.resolve('rclnodejs/package.json'));
    const messageDir = path.join(packagePath, 'generated');
    const packages = fs.readdirSync(messageDir, {withFileTypes: true})
        .filter(item => item.isDirectory())
        .map(({name}) => name);

    const types = {};
    _.forEach(packages, (pkgName) => {
      const content = fs.readdirSync(path.join(messageDir, pkgName));
      const parsed = content.map(fileName =>
        fileName.replace('.js', '').split('__').slice(1,3));
      const grouped = _.groupBy(parsed, type => type[0]);
      types[pkgName] = {
        msg: grouped.msg?.map(type => type[1]) || [],
        srv: grouped.srv?.map(type => type[1]) || [],
        action: grouped.action?.map(type => type[1]) || [],
      };
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

    const TypeClass = rclnodejs.require(`${pkg}/${category}/${type}`);
    return (category == 'msg' ? generateTemplate(TypeClass, category) :
      generateTemplate(TypeClass[response ? 'Response' : 'Request']));
  }
};

const instance = new ROS2();

module.exports = instance;
