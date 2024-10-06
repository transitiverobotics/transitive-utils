import React, { useState, useEffect, useMemo } from 'react';
import _ from 'lodash';
import mqtt from 'mqtt';

import { decodeJWT, getLogger, clone, pathToTopic, mergeVersions, topicToPath }
  from './client';
const MqttSync = require('../../common/MqttSync');

const log = getLogger('utils-web/hooks');
log.setLevel('info');


/** Hook for using MqttSync in React.
* @returns {object} An object `{data, mqttSync, ready, StatusComponent, status}`
* where:
* `data` is a reactive data source in React containing all the data received by
* mqttsync,
* `mqttSync` is the MqttSync object itself,
* `ready` indicates when mqttSync is ready to be used (connected and received
* successfully subscribed to mqtt system heartbeats)
*/
export const useMqttSync = ({jwt, id, mqttUrl, appReact}) => {
  const { useState, useRef, useEffect } = appReact || React;

  const [status, setStatus] = useState('connecting');
  const [mqttSync, setMqttSync] = useState();
  const [data, setData] = useState({});
  // True once the subscription to the system heartbeat has been granted.
  const [heartbeatGranted, setHeartbeatGranted] = useState(false);

  useEffect(() => {
      const payload = decodeJWT(jwt);
      log.debug('re-create mqtt client');
      const client = mqtt.connect(mqttUrl, {
        username: JSON.stringify({id, payload}),
        password: jwt
      });

      client.once('connect', () => {
        log.debug('MQTT connected');
        const mqttSyncClient = new MqttSync({
          mqttClient: client,
          ignoreRetain: true,
          onHeartbeatGranted: () => setHeartbeatGranted(true)
        });
        setMqttSync(mqttSyncClient);
        setStatus('connected');

        // Update data on change. Note: need to clone object to force reaction
        mqttSyncClient.data.subscribe(_.throttle(() =>
          setData(clone(mqttSyncClient.data.get())), 50));
      });

      client.on('error', (error) => {
        log.error(error);
        setStatus(`error: ${error}`);
      });

      return () => {
        log.info('cleaning up useMQTTSync');
        if (mqttSync && mqttSync.beforeDisconnect) {
          mqttSync.beforeDisconnect();
          mqttSync.waitForHeartbeatOnce(() => client.end());
        } else {
          client.end();
        }
      };
    }, [jwt, id]);

  return {
    status,
    // ready: status == 'connected',
    ready: heartbeatGranted,
    StatusComponent: () => <div>{status}</div>,
    mqttSync, // Note: mqttSync.data is not reactive.
    data, // This is a reactive data-source (to use meteor terminology).
  };
};

/** Hook for using Transitive in React. Connects to MQTT, establishes sync, and
* exposes reactive `data` state variable. */
export const useTransitive =
  ({jwt, id, capability, versionNS, appReact,
    host = 'transitiverobotics.com', ssl = true }) => {

    const [scope, capabilityName] = capability.split('/');

    const { device } = decodeJWT(jwt);
    const prefixPath = [id, device, scope, capabilityName];
    const prefix = pathToTopic(prefixPath);
    const prefixPathVersion = [...prefixPath, versionNS];
    const prefixVersion = pathToTopic(prefixPathVersion);

    const mqttUrl = `${ssl && JSON.parse(ssl) ? 'wss' : 'ws'}://mqtt.${host}`;
    const fromMqttSync = useMqttSync({ jwt, id, mqttUrl, appReact });

    return {...fromMqttSync, device, prefixPath, prefix, prefixPathVersion,
      prefixVersion};
  };


/** Subscribe to MqttSync topics using the provided JWT. This will
* automatically find which version of the capability named in the JWT is running
* on the device of the JWT and get the data for that version.
*
* Example usage (with webrtc-video):
*
* ```js
*   const { agentStatus, topicData } = useTopics({ jwt, topics: [
*     '/options/videoSource',
*     '/stats/+/log/'
*   ]});
* ```
*
* @param {object} options An object containing:
* `JWT`: A list of subtopics of the capability named in the JWT.
*  `topics`: A list of subtopics of the capability named in the JWT.
* @returns {object} An object `{data, mqttSync, ready, agentStatus, topicData}`
* where:
*  `agentStatus` is the `status` field of the running robot agent, including
* heartbeat and runningPackages, and
*  `topicData` is the data for the selected topics of the capability
*/
export const useTopics = ({jwt, host = 'transitiverobotics.com', ssl = true,
    topics = [], appReact}) => {

    const { useState, useEffect } = appReact || React;

    // We need to make sure we don't resubscribe (below) when this function
    // is called with the same content of `topics` but a different object.
    const [topicList, setTopicList] = useState();
    !_.isEqual(topicList, topics) && setTopicList(topics);

    const {device, id, capability} = decodeJWT(jwt);
    if (device == '_fleet') {
      log.warn('useTopics only works for device JWTs, not _fleet ones');
      return;
    }

    const agentPrefix = `/${id}/${device}/@transitive-robotics/_robot-agent/+/status`;

    const {mqttSync, data, status, ready, StatusComponent} =
      useMqttSync({jwt, id, mqttUrl: `ws${ssl ? 's' : ''}://mqtt.${host}`, appReact});

    useEffect(() => {
        if (ready) {
          mqttSync.subscribe(agentPrefix, (err) => err && console.warn(err));
        }
      }, [mqttSync, ready]);

    const agentStatus = mergeVersions(
      data[id]?.[device]['@transitive-robotics']['_robot-agent'], 'status').status;
    const runningPackages = agentStatus?.runningPackages;

    const [scope, capName] = capability.split('/');
    const versions = runningPackages?.[scope]?.[capName];
    const runningVersion = versions && Object.values(versions).filter(Boolean)[0];
    const prefix = `/${id}/${device}/${capability}/${runningVersion}`;

    useEffect(() => {
        log.debug('topics', topics);
        if (runningVersion) {
          topics.forEach(topic => {
            log.debug(`subscribing to ${prefix}${topic}`);
            mqttSync.subscribe(`${prefix}${topic}`,
              (err) => err && log.warn(err));
          });
        }
      }, [topicList, runningVersion, mqttSync]);

    const topicData = _.get(data, topicToPath(prefix));
    // log.debug(data, agentStatus, topicData);

    return {data: data?.[id]?.[device], mqttSync, agentStatus, topicData};
  };


const listeners = {};
const loadedModules = {};
/** Hook to load a Transitive capability. Besides loading the custom element,
* this hook also returns any functions and objects the component exports in
* `loadedModule`. Example:
* ```js
*   const {loaded, loadedModule} = useCapability({
*     capability: '@transitive-robotics/terminal',
*     name: 'mock-device',
*     userId: 'user123',
*     deviceId: 'd_mydevice123',
*   });
* ```
*/
export const useCapability = ({ capability, name, userId, deviceId,
    host = 'transitiverobotics.com', ssl = true, appReact
  }) => {
    const { useState, useEffect } = appReact || React;

    const [returns, setReturns] = useState({ loaded: false });

    // called when loaded
    const done = (message, theModule) => {
      log.debug(`custom component ${name}: ${message}`);
      loadedModules[name] = theModule;
      setReturns(x => ({...x, loadedModule: theModule, loaded: !!theModule}));
    };

    /** set the returns for all listeners */
    const notifyListeners = (...args) => listeners[name].forEach(l => l(...args));

    useEffect(() => {
        log.debug(`loading custom component ${name}`);

        if (loadedModules[name]) {
          return done('already loaded', loadedModules[name]);
        }
        if (listeners[name]) {
          log.debug('already loading');
          // get notified when loading completes
          listeners[name].push(done);
          return;
        }
        listeners[name] = [done];

        const baseUrl = `http${ssl ? 's' : ''}://portal.${host}`;
        const params = new URLSearchParams({ userId, deviceId });
        // filename without extension as we'll try multiple
        const fileBasename = `${baseUrl}/running/${capability}/dist/${name}`;

        /* Since some users use webpack and webpack is stupid, we need to use
        this magic comment for it to ignore these (remote) requests, see:
        https://webpack.js.org/api/module-methods/#webpackignore. */
        import(/* webpackIgnore: true */
          `${fileBasename}.esm.js?${params.toString()}`).then(
            esm => notifyListeners('loaded esm', esm),
            error => {
              log.warn(`No ESM module found for ${name}, loading iife`, error);
              import(/* webpackIgnore: true */
                `${fileBasename}.js?${params.toString()}`).then(
                  iife => notifyListeners('loaded iife', iife),
                  error => log.error(`Failed to load ${name} iife`, error));
            });
      }, [capability, name, userId, deviceId]);

    return returns;
  };


