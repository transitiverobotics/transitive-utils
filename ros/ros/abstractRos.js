const { getLogger, wait } = require('@transitive-sdk/utils');

const log = getLogger('AbstractROS');
log.setLevel('error');

/** An abstract base class for all our ROS and pseudeo-ROS implementations. */
const AbstractROS = (BaseClass = Object) => class extends BaseClass {

  rosVersion = null;

  async generateMessages() {
    log.warn('not implemented: generateMessages');
  }

  async init() {
    log.warn('not implemented');
  }

  requireInit() {
    log.warn('not implemented');
  }

  async getTopicsWithTypes(type = undefined) {
    log.warn('not implemented: getTopicsWithTypes');
    return [];
  }

  async getTopics(type = undefined) {
    log.warn('not implemented: getTopics');
    return [];
  }

  async getSubscribedTopics(type = undefined) {
    log.warn('not implemented: getSubscribedTopics');
    return [];
  }

  async getServices() {
    log.warn('not implemented: getServices');
    return [];
  }

  async getServiceType(service) {
    log.warn('not implemented: getServiceType');
  }

  async getActions() {
    log.warn('not implemented: getActions');
    return [];
  }

  subscribe(topic, _type, onMessage) {
    log.warn('not implemented: subscribe', topic);
  }

  unsubscribe(topic) {
    log.warn('not implemented: unsubscribe', topic);
  }

  async publish(topic, _type, message, latching = true) {
    log.warn('not implemented: publish', topic, message);
  }

  /** create a header for the given frame_id and date */
  createHeader(frame_id = '', date = new Date()) {
    const msecs = date.getTime();
    return {
      stamp: {
        secs: Math.floor(msecs / 1000),
        nsecs: (msecs % 1000) * 1e6,
        nanosec: (msecs % 1000) * 1e6
      },
      frame_id
    };
  }

  shutdown() {
  }

  async callService(serviceName, type, requestBody = undefined) {
    log.warn('not implemented: callService');
  }

  getAvailableTypes() {
    log.warn('not needed: getAvailableTypes');
    return [];
  }

  async callAction(actionServer, type, goal, feedbackCallback = undefined) {
    log.warn('not implemented: callAction');
  }
};

module.exports = AbstractROS;
