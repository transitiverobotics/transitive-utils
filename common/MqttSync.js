'use strict';

const { DataCache, mqttParsePayload, pathMatch, topicToPath, pathToTopic,
toFlatObject, getLogger, mergeVersions, parseMQTTTopic, isSubTopicOf,
versionCompare, encodeTopicElement } = require('./common');
const _ = require('lodash');

const log = getLogger('MqttSync');

const HEARTBEAT_TOPIC = '$SYS/broker/uptime';

const noop = () => {};

/** clone a mqtt payload, if necessary */
const clone = (payload) => {
  if (typeof payload == 'object') {
    return JSON.parse(JSON.stringify(payload));
  } else {
    return payload;
  }
};

/** return new string that ends in /# for sure */
const ensureHashSuffix = (topic) =>
  topic.endsWith('/#') ? topic :
  ( topic.endsWith('/') ? topic.concat('#') :
    topic.concat('/#') );

/** given a path, replace any double slashes, '//', with single ones */
const resolveDoubleSlashes = (path) => path.replace(/\/\//g, '/');


/** A class that combines DataCache and MQTT to implement a data synchronization
  feature over the latter. Relies on retained messages in mqtt for persistence.
*/
class MqttSync {

  data = new DataCache();

  /** Directory of paths we've subscribed to in this class; this matters
    because the same mqtt client may have subscriptions to paths that we don't
  care to store (sync). */
  subscribedPaths = {};

  publishedPaths = {}; // not used in atomic mode

  /** Store messages retained on mqtt so we can publish what is necessary to
    achieve the "should-be" state. Note that we cannot use a structured document
    for storing these publishedMessages since we need to be able to store separate
    values at non-leaf nodes in the object (just like mqtt, where you can have
  /a/b = 1 and /a/b/c = 1 at the same time). Note: not used in atomic mode. */
  publishedMessages = {};

  /** The order in which we send retained messages matters, which is why we use
  a queue for sending things. Note that we here use the property of Map that it
  remembers insertion order of keys. */
  publishQueue = new Map();

  /** List of callbacks waiting for next heartbeat, gets purged with each
  heartbeat */
  heartbeatWaitersOnce = [];

  heartbeats = 0;

  beforeDisconnectHooks = [];

  /**
  - ignoreRetain: retain all messages, ignorant of the retain flag.
  - sliceTopic: (optional) a number indicating at what level to slice the topic,
  i.e., only use a suffix.
  */
  constructor({mqttClient, onChange, ignoreRetain, migrate, onReady,
  sliceTopic }) {
    this.mqtt = mqttClient;

    this.mqtt.on('message', (topic, payload, packet) => {
      const payloadString = payload && payload.toString()
      log.debug('got message', topic, payloadString.slice(0, 180),
        payloadString.length > 180 ? `... (${payloadString.length} bytes)` : '',
        packet.retain);

      if (topic == HEARTBEAT_TOPIC) {
        if (this.heartbeats > 0) { // ignore initial heartbeat (retained)
          this.heartbeatWaitersOnce.forEach(cb => cb());
          this.heartbeatWaitersOnce = [];
        }
        if (this.heartbeats == 1 && !migrate && onReady) onReady();
        this.heartbeats++;

      } else if (packet.retain || ignoreRetain) {
        log.debug('processing message', topic);
        sliceTopic &&
          (topic = pathToTopic(topicToPath(topic).slice(sliceTopic)));

        const json = mqttParsePayload(payload);
        if (this.isPublished(topic)) {
          // store plain messages, still stored in a structure, but values are
          // not interpreted; we just store them to undo them if necessary, e.g.,
          // for switching between atomic and non-atomic subdocuments
          // log.trace('setting publishedMessages', topic);
          this.publishedMessages[topic] = json;
          // this.pubData.update(topic, json);
          // Still need to update the data so that we can detect changes we make
          // and publish them. But we need to break the reaction-chain to avoid
          // loops, so tag this update with 'published' and then ignore those
          // updates in this.publish.
          this.data.update(topic, json, {external: true});

        } else if (this.isSubscribed(topic)) {
          log.debug('applying received update', topic);
          const changes = this.data.update(topic, json);
          onChange && Object.keys(changes).length > 0 && onChange(changes);
        }
      }
    });

    this.mqtt.subscribe(HEARTBEAT_TOPIC, {rap: true}, log.debug);

    migrate?.length > 0 && this.migrate(migrate, () => {
      log.debug('done migrating', onReady);
      onReady && this.waitForHeartbeatOnce(onReady);
    });
  }

  /**
  * Publish all values at the given level of the given object under the given
  * topic (plus sub-key, of course).
  * TODO: Is this OK, or do we need to go through this.publish?
  */
  publishAtLevel(topic, value, level) {
    log.debug(`publishingAtLevel ${level}`, topic, value);

    if (level > 0) {
      _.forEach(value, (subValue, subKey) => {
        const subTopic = `${topic}/${encodeTopicElement(subKey)}`;
        log.debug(`publishing ${subTopic}`);
        this.publishAtLevel(subTopic, subValue, level - 1);
      });
    } else {
      this.mqtt.publish(topic, JSON.stringify(value), {retain: true}, (err) => {
        err && log.warn('Error when publishing migration result', err);
      });
    }
  }

  /** Migrate a list of {topic, newVersion, transform}. The version number in
  topic will be ignored, and all versions' values will be merged, applied in
  order, such that the latest version is applied last. */
  migrate(list, onReady = undefined) {

    let toGo = list.length;
    if (toGo == 0) {
      onReady && onReady(); // in case an empty list was given
      return;
    }

    /** called each time one item is done */
    const oneDown = () => --toGo == 0 && onReady && onReady();

    list.forEach(({topic, newVersion, transform = undefined, flat = false,
      level = 0}) => {
        log.debug('migrating', topic, newVersion);
        const {organization, device, capability, sub} = parseMQTTTopic(topic);
        const prefix = `/${organization}/${device}/${capability}`;

        const suffix = sub.length == 0 ? '/#' : pathToTopic(sub);
        // suffix will have a leading slash
        const subTopic = `${prefix}/+${suffix}`;

        this.subscribe(subTopic, (err) => {
          if (err) {
            log.warn('Error during migration', err);
            oneDown();
            return;
          }

          this.waitForHeartbeatOnce(() => {
            // merge everything
            log.debug('got heartbeat', topic, subTopic);
            const all = this.data.getByTopic(prefix);
            if (!all) {
              // no data to migrate
              this.unsubscribe(subTopic);
              oneDown();
              return;
            }

            const merged = mergeVersions(all, suffix, {maxVersion: newVersion});
            // log.debug(JSON.stringify({all, merged}, true, 2));
            // get suffix in merged
            const suffixMergedValue = _.get(merged, topicToPath(suffix));
            // ^ this will need to change to support wild-cards in suffix
            const transformed = transform ? transform(suffixMergedValue) :
              suffixMergedValue;
            // publish its value at `prefix/newVersion/suffix`
            const newTopic =
              resolveDoubleSlashes(`${prefix}/${newVersion}/${suffix}`);
            log.debug('publishing merged', newTopic);

            if (flat) {
              const flatObj = toFlatObject(transformed);
              const newPath = topicToPath(newTopic);
              _.forEach(flatObj, (value, key) => {
                const keyTopic = pathToTopic(newPath.concat(topicToPath(key)));
                // TODO: Is this OK, or do we need to go through this.publish?
                this.mqtt.publish(keyTopic, JSON.stringify(value),
                  {retain: true}, (err) => {
                    err && log.warn(
                      `Error when publishing migration result for ${key}`, err);
                  });
              });

            } else {
              this.publishAtLevel(newTopic, transformed, level);
            }

            this.unsubscribe(subTopic); // TODO: ensure hash?
            this.waitForHeartbeatOnce(() => {
              // now clear this suffix in the old version space
              const oldVersions = Object.keys(all).filter(v =>
                versionCompare(v, newVersion) < 0);
              // log.debug({oldVersions});

              const prefixesToClear = oldVersions.map(oldV =>
                resolveDoubleSlashes(`${prefix}/${oldV}/${suffix}`));

              log.debug({prefixesToClear});
              this.clear(prefixesToClear);
              oneDown();
            });
          });
        });
      });
  }

  /** Delete all retained messages in a certain topic prefix, waiting for
    a mqtt broker heartbeat to collect existing retained. Use with care, never
    delete topics not owned by us. Harmless within capabilities, which are
    namespaced already.

    `options.filter(topic)`: a function that can be provided to further,
    programmatically filter the set of topics to clear, e.g., to onlt clear
  topics of old versions.
  */
  clear(prefixes, callback = undefined, options = {}) {

    const toDelete = [];
    const collectToDelete = (topic) => {
      // there may be other mqtt subscriptions running, filter by topic
      prefixes.forEach(prefix =>
        // mqttTopicMatch(topic, `${prefix}/#`)
        pathMatch(`${prefix}/#`, topic)
          && (!options.filter || options.filter(topic))
          && toDelete.push(topic)
      );
    }
    this.mqtt.on('message', collectToDelete);
    // TODO: this only works if we haven't already gotten these messages before!

    // subscribe to all
    prefixes.forEach(prefix => {
      if (typeof prefix == 'string') {
        this.mqtt.subscribe(`${prefix}/#`);
      } else {
        log.warn('Ignoring', prefix, 'since it is not a string.');
      }
    });

    // value to use to clear, depending on node.js vs. browser
    const nullValue = (typeof Buffer != 'undefined' ? Buffer.alloc(0) : null);

    this.waitForHeartbeatOnce(() => {
      this.mqtt.removeListener('message', collectToDelete);
      prefixes.forEach(prefix => this.mqtt.unsubscribe(`${prefix}/#`));

      const count = toDelete.length;
      log.debug(`clearing ${count} retained messages from ${prefixes}`);
      toDelete.forEach(topic => {
        this.mqtt.publish(topic, nullValue, {retain: true});
      });

      callback && callback(count);
    });
  };


  /** register a callback for the next heartbeat from the broker */
  waitForHeartbeatOnce(callback) {
    // need to wait a tick, in case we are still in the callback tree
    // of a previous heartbeat waiter
    setTimeout(() => this.heartbeatWaitersOnce.push(callback), 1);
  }

  /** check whether we are subscribed to the given topic */
  isSubscribed(topic) {
    return Object.keys(this.subscribedPaths).some(subscribedTopic =>
      pathMatch(subscribedTopic, topic));
  }

  /** Check whether we are publishing the given topic in a non-atomic way.
  This is used to determine whether to store the published value or not. */
  isPublished(topic) {
    return Object.keys(this.publishedPaths).some(subscribedTopic =>
      pathMatch(subscribedTopic, topic) &&
      !this.publishedPaths[subscribedTopic].atomic
    );
  }

  /** Subscribe to the given topic (and all sub-topics). The callback will
  indicate success/failure, *not* a message on the topic. */
  subscribe(topic, callback = noop) {
    topic = ensureHashSuffix(topic);
    if (this.subscribedPaths[topic]) {
      log.debug('already subscribed to', topic);
      callback();
      return;
    }

    this.mqtt.subscribe(topic, {rap: true}, (err, granted) => {
      log.debug('subscribe', topic, 'granted:', granted);
      if (granted && granted.some(grant => grant.topic == topic && grant.qos < 128)) {
        // granted
        this.subscribedPaths[topic] = 1;
        callback(null);
      } else {
        // let user know (somehow) when we don't get permission
        callback(`not permitted to subscribe to topic ${topic}, ${JSON.stringify(granted)}`);
      }
    });
  }

  unsubscribe(topic) {
    if (this.subscribedPaths[topic]) {
      this.mqtt.unsubscribe(topic);
      delete this.subscribedPaths[topic];
    }
  }

  /** Publish retained to MQTT, store as published, and return a promise */
  _actuallyPublish(topic, value) {
    // return new Promise((resolve, reject) =>
    //   this.mqtt.publish(topic,
    //     value == null ? null : JSON.stringify(value), // aka "unparse payload"
    //     {retain: true},
    //     (err) => {
    //       // Note that this returns optimistically at QoS 0, and no error occurs
    //       // even when we are not allowed to publish this topic/message, see
    //       // https://github.com/mqttjs/MQTT.js/#publish. Only when the client
    //       // disconnects it seems.
    //       if (err) {
    //         log.warn('error in _actuallyPublish:', err);
    //         reject(err);
    //         // TODO: if this happens, we may need to force a full-sync
    //       } else {
    //         resolve();
    //       }
    //     }));

    if (!this.mqtt.connected) {
      log.warn('not connected, not publishing', topic);
      return false;
    }
    log.debug('actually publishing', topic);
    this.mqtt.publish(topic,
      value == null ? null : JSON.stringify(value), // aka "unparse payload"
      {retain: true});
    return true;
  }

  /** Send all items in the queue in sequence, if any and if not already
  running. */
  // async _processQueue() {
  //   if (this._processing) return; // already running (and probably waiting)
  //
  //   this._processing = true;
  //   while (this.publishQueue.length > 0) {
  //     const {topic, value} = this.publishQueue.shift();
  //     await this._actuallyPublish(topic, value);
  //   }
  //   this._processing = false;
  // }

  // when using Map
  _processQueue_rec(cb) {
    if (this.publishQueue.size > 0) {
      const [topic, value] = this.publishQueue.entries().next().value;
      // this.publishQueue.delete(topic);
      // this._actuallyPublish(topic, value).then(
      //   () => this._processQueue_rec(cb),
      //   cb); // always call cb, even in rejection case
      if (this._actuallyPublish(topic, value)) {
        this.publishQueue.delete(topic);
        this._processQueue_rec(cb);
      } else {
        // try again soon
        setTimeout(() => this._processQueue_rec(cb), 5000);
      }
    } else {
      cb();
    }
  }

  _processQueue() {
    if (this._processing) return; // already running (and probably waiting)

    this._processing = true; // semaphore
    this._processQueue_rec(() => this._processing = false);
  }

  /** set min delay between processing of queue */
  setThrottle(delay) {
    this._processQueueThrottled =
      _.throttle(this._processQueue.bind(this), delay);
  }

  /** clear the set throttling delay */
  clearThrottle() {
    delete this._processQueueThrottled;
  }

  addToQueue(topic, value) {
    // this.publishQueue.push({topic, value});
    this.publishQueue.set(topic, value);
  }

  /** Add to publication queue */
  _enqueue(topic, value) {
    log.debug('enqueuing', topic);
    this.addToQueue(topic, value);
    // const fn = (this._processQueueThrottled || this._processQueue).bind(this);
    // fn();
    if (this._processQueueThrottled) {
      this._processQueueThrottled();
    } else {
      this._processQueue();
    }
    // yes, this is optimistic, but if we don't, then upcoming changes
    // may not work as expected (e.g., when switching from flat to atomic to flat)
    if (value == null) {
      delete this.publishedMessages[topic];
    } else {
      this.publishedMessages[topic] = clone(value);
    }
  }

  /** Register a listener for path in data. Make sure to populate the data
    before calling this or set the data all at once afterwards.

    With option "atomic" this will always send the whole sub-document,
    not flat changes. Useful, e.g., for desiredPackages, see
    https://github.com/chfritz/transitive/issues/85.

    @return true if publication added (false, e.g., when already present)
  */
  publish(topic, options = {atomic: false}) {
    topic = ensureHashSuffix(topic);

    if (_.isEqual(this.publishedPaths[topic], options)) {
      return false;
      // avoid double subscription
    }
    this.publishedPaths[topic] = options;

    if (options.atomic) {
      // this case is quite simple
      this.data.subscribePath(topic, (value, key, matched, tags) => {
        // do not re-publish changes received from external:
        if (tags?.external) return;

        log.debug('processing change (atomic)', key, topic);
        // instantiate topic according to key (topic may have wildcards)
        const topicWithoutHash = topic.slice(0, topic.length - 2);
        const groundedTopic = pathToTopic(
          // get length of topic (how many levels of selectors), get that many
          // levels from key prefix
          topicToPath(key).slice(0, topicToPath(topicWithoutHash).length)
        );
        this._enqueue(groundedTopic, this.data.getByTopic(groundedTopic));
      });
      return true;
    }

    this.mqtt.subscribe(topic);

    // second: keep them up to date by publishing updates as changes happen
    this.data.subscribePath(topic, (value, key, matched, tags) => {
      if (tags?.external) return;

      log.debug('processing change', key);

      /* First: establish clarity by ensuring that the object defined by the
        currently present retained messages under this path accurately reflect
        the current value of this.data (and if not, publish what is necessary to
      create consistency). */
      // first, clear/replace all messages below or above this sub-path (if any)
      _.each(this.publishedMessages, (oldValue, oldKey) => {
        log.trace('oldKey', oldKey);
        if (oldKey == key) {
          // no special treatment required when just replacing values 1:1
          return true;
        }

        if (isSubTopicOf(oldKey, key)) {
          // we are going from flat to atomic, i.e., we are publishing at a
          // higher level than before: just clear out
          // log.trace('going atomic: need to clear', oldKey);
          this._enqueue(oldKey, null);
        }

        if (isSubTopicOf(key, oldKey)) {
          // we are going from atomic to separate values: need to transform
          // existing sub-document to flat values
          // log.trace('need to replace', oldKey, 'with flat values');
          // remove the old published (atomic) message:
          this._enqueue(oldKey, null);

          // now re-add as separate flat messages
          const flat = toFlatObject(oldValue);
          _.each(flat, (flatValue, flatKey) => {
            const oldFlatKey = `${oldKey}${flatKey}`;
            // log.trace('publish flat', oldFlatKey, flatValue);
            this._enqueue(oldFlatKey, flatValue);
          })
        }
      })

      /* We need to first wait until all of the above messages are out;
        otherwise replacing an atomic `/a = {c: 1}` with `/a/c = 2` would create
        a race condition where it is not clear which message, the replacement
        c = 1 or the new c = 2, would be sent last (and hence retained). That's
        why we use a publishing queue in this class.
      */
      this._enqueue(key, value);
      return true;
    });
  }

  /** Run all registered hooks before disconnecting */
  beforeDisconnect() {
    this.beforeDisconnectHooks.forEach(fn => fn(this));
  }

  /** register a new hook to be called before disconnecting */
  onBeforeDisconnect(fn) {
    this.beforeDisconnectHooks.push(fn);
  }
}

module.exports = MqttSync;
