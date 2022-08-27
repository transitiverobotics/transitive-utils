import React, { useState, useEffect } from 'react';

import { useMqttSync } from '../hooks.jsx';
import { getLogger, fetchJson } from '../index';
// import log from 'loglevel';
// log.setLevel('trace');
const log = getLogger('test/App');

export default () => {
  const [count, setCount] = useState(0);

  const jwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJkZXZpY2UiOiJHYkdhMnlncXF6IiwiY2FwYWJpbGl0eSI6Il9yb2JvdC1hZ2VudCIsInVzZXJJZCI6InBvcnRhbFVzZXItcUVtWW41dGlib3ZLZ0d2U20iLCJ2YWxpZGl0eSI6NDMyMDAsImlhdCI6MTY0MzMzNDgxMn0.2eciKJ-tNGJmJbyZRr8lopELr73M5EK9lQqmsOsdXyA';
  const id = 'qEmYn5tibovKgGvSm';
  const mqttUrl = 'ws://localhost:8888';

  const {mqttSync, data, status, ready, StatusComponent} =
    useMqttSync({jwt, id, mqttUrl});

  useEffect(() => {
      if (mqttSync && ready) {
        console.log('using', {mqttUrl});
        mqttSync.subscribe('/test');
        mqttSync.publish('/web/atomic', {atomic: true});
        mqttSync.publish('/web/string');
        mqttSync.subscribe('/forbidden', log.warn);
        window.mqttSync = mqttSync; // for debugging in browser console
      }
    }, [mqttSync, ready]);


  if (!mqttSync || !ready) {
    return <div>Connecting...</div>;
  }

  return <div>
    <h1>utils/web testing</h1>

    <button onClick={() => setCount(c => c+1)}>clicked: {count}</button>

    <pre>
      {JSON.stringify(data, true, 2)}
    </pre>

    <button onClick={() => fetchJson('/json1', console.log)}>
      fetchJson1
    </button>

    <button onClick={() => fetchJson('/doesnotexist', console.log)}>
      fetchJson fail: 404
    </button>

    <button onClick={() => {
      mqttSync.data.update('/web/atomic', {a: Date.now()});
      mqttSync.data.update('/web/string', (new Date()).toLocaleString());
    }}>
      update /web
    </button>
  </div>;
};
