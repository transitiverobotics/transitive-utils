import React, { useState, useEffect, useMemo } from 'react';
import { decodeJWT, getLogger, clone } from './client';
// import MqttSync from '../MqttSync';
const MqttSync = require('../common/MqttSync');
import mqtt from 'mqtt-browser';
const log = getLogger('utils-web/hooks');


/** hook for using MqttSync in react */
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
        mqttSyncClient.data.subscribe(() =>
          setData(clone(mqttSyncClient.data.get())));
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
