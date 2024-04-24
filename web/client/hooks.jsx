import React, { useState, useEffect, useMemo } from 'react';
import _ from 'lodash';
import mqtt from 'mqtt-browser';
import { decodeJWT, getLogger, clone, pathToTopic, mergeVersions, topicToPath }
  from './client';
const MqttSync = require('../../common/MqttSync');

const log = getLogger('utils-web/hooks');
log.setLevel('info');
log.setLevel('debug'); // #DEBUG

/** Hook for using MqttSync in React.
 @returns {object} An object `{data, mqttSync, ready, StatusComponent, status}`
where:
 `data` is a reactive data source in React containing all the data received by
mqttsync,
 `mqttSync` is the MqttSync object itself,
 `ready` indicates when mqttSync is ready to be used (connected and received
 successfully subscribed to mqtt system heartbeats)
 */
export const useMqttSync = ({jwt, id, mqttUrl}) => {
  const [status, setStatus] = useState('connecting');
  const [mqttSync, setMqttSync] = useState();
  const [data, setData] = useState({});
  // True once the subscription to the system heartbeat has been granted.
  const [heartbeatGranted, setHeartbeatGranted] = useState(false);

  useEffect(() => {
      const payload = decodeJWT(jwt);
      const client = mqtt.connect(mqttUrl, {
        username: JSON.stringify({id, payload}),
        password: jwt
      });

      client.on('connect', () => {
        log.debug('connected');
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
exposes reactive `data` state variable. */
export const useTransitive = ({jwt, id, host, ssl, capability, versionNS}) => {

  const [scope, capabilityName] = capability.split('/');

  const { device } = decodeJWT(jwt);
  const prefixPath = [id, device, scope, capabilityName];
  const prefix = pathToTopic(prefixPath);
  const prefixPathVersion = [...prefixPath, versionNS];
  const prefixVersion = pathToTopic(prefixPathVersion);

  const mqttUrl = `${ssl && JSON.parse(ssl) ? 'wss' : 'ws'}://mqtt.${host}`;
  const fromMqttSync = useMqttSync({ jwt, id, mqttUrl });

  return {...fromMqttSync, device, prefixPath, prefix, prefixPathVersion,
    prefixVersion};
};


/** Subscribe to MqttSync topics using the provided JWT. This will
automatically find which version of the capability named in the JWT is running
on the device of the JWT and get the data for that version.

Example usage (with webrtc-video):

```js
  const { agentStatus, topicData } = useTopics({ jwt, topics: [
    '/options/videoSource',
    '/stats/+/log/'
  ]});
```

@param {object} options An object containing:
`JWT`: A list of subtopics of the capability named in the JWT.
 `topics`: A list of subtopics of the capability named in the JWT.
@returns {object} An object `{data, mqttSync, ready, agentStatus, topicData}`
where:
 * `agentStatus` is the `status` field of the running robot agent, including
heartbeat and runningPackages, and
 * `topicData` is the data for the selected topics of the capability
*/
export const useTopics = ({jwt, host = 'transitiverobotics.com', ssl = true,
    topics = []}) => {

    // #TODO:
    // Make sure this function is not invoked multiple times with different `topics`
    // objects, like `useTopics({jwt, topics: ['/abc']})`. Instead make sure the
    // variable passed to topics is strictly equal unless you actually want to change
    // the content.

    const {device, id, capability} = decodeJWT(jwt);
    if (device == '_fleet') {
      log.warn('useTopics only works for device JWTs, not _fleet ones');
      return;
    }

    const agentPrefix = `/${id}/${device}/@transitive-robotics/_robot-agent/+/status`;

    const {mqttSync, data, status, ready, StatusComponent} =
      useMqttSync({jwt, id, mqttUrl: `ws${ssl ? 's' : ''}://mqtt.${host}`});

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
      }, [topics, runningVersion, mqttSync]);

    const topicData = _.get(data, topicToPath(prefix));
    // log.debug(data, agentStatus, topicData);

    return {data: data?.[id]?.[device], mqttSync, agentStatus, topicData};
  };


/** Hook to load and use a Transitive web component. Besides loading the custom
element, this hook also returns any functions and objects the component exports.
*/
const loading = {};
export const useComponent = ({
    capability, name, userId, deviceId,
    host = 'transitiverobotics.com', ssl = true,
    testing = false
  }) => {

    const [returns, setReturns] = useState({});

    const done = (message, loadedModule = undefined) => {
      log.debug(`custom component ${name}: ${message}`);
      setReturns(x => ({...x, loadedModule, loaded: true}));
    };

    useEffect(() => {
        log.debug(`loading custom component ${name}`);

        if (customElements.get(name)) return done('already loaded');
        if (loading[name]) return done('already loading');
        loading[name] = 1;

        const baseUrl = testing ? '' : // for testing
          `http${ssl ? 's' : ''}://portal.${host}`;
        const params = new URLSearchParams({userId, deviceId});
        // filename without extension as we'll try multiple
        const fileBasename = `${baseUrl}/running/${capability}/dist/${name}`;

        import(`${fileBasename}.esm.js?${params.toString()}`).then(
          esm => done('loaded esm', esm),
          error => {
            log.warn(`No ESM module found for ${name}, loading iife`);
            import(`${fileBasename}.js?${params.toString()}`).then(
              iife => done('loaded iife', iife),
              error => log.warn(`Failed to load ${name} iife`, error));
          });
      }, [capability, name, userId, deviceId]);

    return returns;
  };
