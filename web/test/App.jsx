import React, { useState, useEffect, useContext } from 'react';

import { Badge } from 'react-bootstrap';

import { getLogger, fetchJson, useMqttSync, MqttSync, Timer, TimerContext,
  ErrorBoundary, createWebComponent } from '../index';
const log = getLogger('test/App');

// to verify the export works
window.transitive = { MqttSync };

const styles = {
  section: {
    borderTop: '1px solid #aaa',
    marginTop: '1em'
  }
};

const Section = ({title, children}) => <div style={styles.section}>
  <h2>{title}</h2>
  {children}
</div>;


const TimerChild = () => {
  const context = useContext(TimerContext);
  return <div style={{backgroundColor: '#ccd'}}>I'm the TimerChild.
    <pre>{JSON.stringify(context, true, 2)}</pre>
    <button onClick={context.reset}>Reset</button>
  </div>;
}

const Comp = () => {
  return <div>custom component <Badge>bootstrap</Badge></div>
};

createWebComponent(Comp, 'custom-component', ['jwt'], '1.2.3', {
  stylesheets: ['https://unpkg.com/leaflet@1.9.3/dist/leaflet.css']
});


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
        mqttSync.subscribe('/server');
        mqttSync.publish('/web/atomic', {atomic: true});
        mqttSync.publish('/web/string');
        mqttSync.subscribe('/forbidden', log.warn);
        window.mqttSync = mqttSync; // for debugging in browser console
      }
    }, [mqttSync, ready]);


  if (!mqttSync || !ready) {
    return <div>Connecting...</div>;
  }

  log.debug({data});

  return <div>
    <h1>utils/web testing</h1>

    <button onClick={() => setCount(c => c+1)}>clicked: {count}</button>

    <pre>
      {JSON.stringify(data.test, true, 2)}
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

    <Section title='testing error boundary'>
      <ErrorBoundary>
        <Fail />
        test
      </ErrorBoundary>
    </Section>

    <Section title="Timer">
      <Timer duration={20}>
        timeout in 20s
        <TimerChild>
        </TimerChild>
      </Timer>
    </Section>

    <Section title="Custom Component">
      <custom-component/>
    </Section>
  </div>;
};


// a failing component to test the ErrorBoundary
const Fail = () => {
  const foo = 'test';
  const {a, b, c} = foo.a; // fails to destruct
  return <div>Should fail</div>;
}

