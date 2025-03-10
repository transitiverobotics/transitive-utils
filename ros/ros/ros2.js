const fs = require('fs');
const path = require('path');
const rclnodejs = require('rclnodejs');
const _ = require('lodash');

const { getLogger, wait } = require('@transitive-sdk/utils');
const log = getLogger('ROS2');
log.setLevel('info');

volatileQos = new rclnodejs.QoS();
volatileQos.reliability = rclnodejs.QoS.ReliabilityPolicy.RMW_QOS_POLICY_RELIABILITY_BEST_EFFORT;

latchingQos = new rclnodejs.QoS();
latchingQos.reliability = rclnodejs.QoS.ReliabilityPolicy.RMW_QOS_POLICY_RELIABILITY_BEST_EFFORT;
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

/* Function to implement convenience of poviding a ROS1 type and converting it
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

  /** Subscribe to the named topic of the named type. Each time a new message
  * is received the provided callback is called. For available options see
  * https://robotwebtools.github.io/rclnodejs/docs/0.22.3/Node.html#createSubscription.
  * The default `options.qos.reliability` is best-effort.
  * */
  subscribe(topic, type, onMessage, options = {}) {
    // TODO: this only supports a single subscription per topic
    this.requireInit();
    let firstLatchedMessage;
    const ros2Type = toROS2Type(type);
    const _destroyLatchingSub = () => {
      const subs = this.subscriptions[topic];
      if (subs?.latching){
        if (!subs.latching.__destroyed){
          subs.latching.__destroyed = true;
          this.node.destroySubscription(subs.latching);
        }
        delete this.subscriptions[topic].latching;
      }
    }

    const latchingSub = this.node.createSubscription(
      ros2Type, topic, {latchingQos, ...options}, (msg) => {
        _destroyLatchingSub();
        firstLatchedMessage = msg;
        onMessage(msg);
      }
    );

    const volatileSub = this.node.createSubscription(
      ros2Type, topic, {volatileQos, ...options}, (msg) => {
        _destroyLatchingSub();
        if (firstLatchedMessage){
          if(_.isEqual(firstLatchedMessage, msg)){
            firstLatchedMessage = undefined;
            // avoids duplicate first message
            return;
          }
          firstLatchedMessage = undefined;          
        }
        onMessage(msg);
      }
    );  

    this.subscriptions[topic] = {
      volatile: volatileSub,
      latching: latchingSub,
    }
    return {
      shutdown: () => {
        this.unsubscribe(topic);
      }
    }
  }

  /** Unsubscribe from topic */
  unsubscribe(topic) {
    const subs = this.subscriptions[topic];
    if (!subs) {
      console.warn(`cannot unsubscribe from ${topic}, subscription not found`);
      return;
    }
    if (subs.volatile && !subs.volatile.__destroyed){
      subs.volatile.__destroyed = true;
      this.node.destroySubscription(subs.volatile);
    }
    if (subs.latching && !subs.latching.__destroyed){
      subs.latching.__destroyed = true;
      this.node.destroySubscription(subs.latching);
    }
    delete this.subscriptions[topic];
  }

  /** Publish the given message (json) on the names topic of type. Will
  advertise the topic if not yet advertised. */
  publish(topic, type, message, latching = true) {
    if (!this.publishers[topic]) {
      const ros2Type = toROS2Type(type);
      if(latching){
        this.publishers[topic] = this.node.createPublisher(ros2Type, topic, {latchingQos});
      } else {
        this.publishers[topic] = this.node.createPublisher(ros2Type, topic);
      }
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
