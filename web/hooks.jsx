import React, { useState, useEffect, useMemo } from 'react';
import _ from 'lodash';
import mqtt from 'mqtt-browser';
import { decodeJWT, getLogger, clone, pathToTopic } from './client';
const MqttSync = require('../common/MqttSync');

const log = getLogger('utils-web/hooks');
log.setLevel('info');

/** hook for using MqttSync in React */
export const useMqttSync = ({jwt, id, mqttUrl}) => {
  const [status, setStatus] = useState('connecting');
  const [mqttSync, setMqttSync] = useState();
  const [data, setData] = useState({});

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
          ignoreRetain: true
        });
        setMqttSync(mqttSyncClient);
        setStatus('connected');

        // Update data on change. Note: need to clone object to force reaction
        mqttSyncClient.data.subscribe(_.debounce(() =>
          setData(clone(mqttSyncClient.data.get())), 100));
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
    ready: status == 'connected',
    StatusComponent: () => <div>{status}</div>,
    mqttSync, // Note: mqttSync.data is not reactive.
    data, // This is a reactive data-source (to use meteor terminology).
  };
};

/** Hook for using Transitive in React. Connects to MQTT, establishes sync, and
exposes reactive `data` state variable. */
export const useTransitive = ({jwt, id, host, ssl, capability, versionNS}) => {

  const [scope, capabilityName] = capability;

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
