import React, { useState, useEffect, useContext, useRef,
    forwardRef, useImperativeHandle }
  from 'react';

import { Badge, Button, OverlayTrigger, Popover } from 'react-bootstrap';

import { getLogger, fetchJson, useMqttSync, MqttSync, Timer, TimerContext,
  ErrorBoundary, createWebComponent, useTransitive, useTopics } from '../index';
const log = getLogger('test/App');
log.setLevel('debug');

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

/** ----  Custom components, exposing an imperative API */
const Comp = forwardRef((props, ref) => {
  useImperativeHandle(ref, () => ({
    foo4: (...args) => {
      log.debug('foo4', args, this);
      return 'return of Comp:foo4';
    },
  }));

  setTimeout(() => {
    props.setConfig({k1: 'v1'});
  }, 1000);

  console.log('comp1 render');
  return <div>custom component:
    <OverlayTrigger placement='bottom-start' trigger="click"
      overlay={
        <Popover id="stats" className='transitive-bs-root'>
          <Popover.Header>header</Popover.Header>
          <Popover.Body>
            Body
          </Popover.Body>
        </Popover>
      }
    >
      <Badge bg="primary">bootstrap badge (click me)</Badge>
    </OverlayTrigger>
  </div>;
});

class Comp2 extends React.Component {
  foo(...args) {
    log.debug('foo', ...args, this);
    return 'return of Comp2:foo';
  }

  render() {
    setTimeout(() => {
      this.props.setConfig({k2: new Date()});
    }, 1000);

    console.log('comp2 render');
    return <div>custom component 2:
      <Badge bg="primary">bootstrap badge (missing stylesheet)</Badge>
    </div>;
  }
};

/** a functional component not wrapped in forwardRef: will not allow use of
* useImperativeHandle, but should not throw an error */
const Comp3 =({setConfig, setOnDisconnect}) => {
  setTimeout(() => {
    setConfig?.({k3: 'v3'});
  }, 1000);

  // test a disconnect that throws an exception
  setOnDisconnect(() => {
    throw new Error('testing failures in onDisconnect');
  });

  console.log('comp3 render');
  return <div>custom component3</div>
};

createWebComponent(Comp, 'custom-component', ['jwt'], '1.2.3', {
  stylesheets: [
    // load local css for testing
    '/bootstrap_transitive-bs-root.css'
  ],
  });

createWebComponent(Comp2, 'custom-component2', ['jwt'], '1.2.3', {
  stylesheets: [// seems to define the CSS 'badge' class
    'https://unpkg.com/leaflet@1.9.3/dist/leaflet.css'],
  shadowDOM: true
});

createWebComponent(Comp3, 'custom-component3', ['jwt'], '1.2.3', {
  stylesheets: [],
  shadowDOM: true
});

/* ------------- */

export default () => {
  const [count, setCount] = useState(0);
  const [show, setShow] = useState(true);
  const toggleShow = () => setShow(s => !s);

  const jwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJkZXZpY2UiOiJHYkdhMnlncXF6IiwiY2FwYWJpbGl0eSI6Il9yb2JvdC1hZ2VudCIsInVzZXJJZCI6InBvcnRhbFVzZXItcUVtWW41dGlib3ZLZ0d2U20iLCJ2YWxpZGl0eSI6NDMyMDAsImlhdCI6MTY0MzMzNDgxMn0.2eciKJ-tNGJmJbyZRr8lopELr73M5EK9lQqmsOsdXyA';
  const id = 'qEmYn5tibovKgGvSm';
  const mqttUrl = 'ws://localhost:8888';
  const {mqttSync, data, status, ready, StatusComponent} =
    // useMqttSync({jwt, id, mqttUrl});
    useTransitive({jwt, id, host: 'homedesk.local:8888', ssl: false,
      capability: '@transitive-robotics/web-test',
      versionNS: '0.1'});

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

  // const {data: allData, agentStatus, topicData} =
  //   useTopics({jwt, host: 'homedesk.local:8888', ssl: false, topics: []});
  // console.log({allData, agentStatus, topicData});
  // ^^ This doesn't work here, since there is no agent data in our test

  // test function on custom component
  const myref = useRef(null);
  if (myref.current) {
    log.debug(myref.current.call('foo4', 'abc', 123),
      myref.current.getConfig());
  }

  const myref2 = useRef(null);
  if (myref2.current) {
    log.debug(myref2.current.call('foo', 'abc', 123),
      myref2.current.getConfig());
  }

  const myref3 = useRef(null);

  if (!mqttSync || !ready) {
    return <div>Connecting...</div>;
  }

  // log.debug({data});


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

    <button onClick={() => fetchJson('/unauthorized', console.log)}>
      fetchJson fail: 401
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

    <Section title="Custom Components">
      <Badge bg="primary">bootstrap badge (outside)</Badge><br/>
      <button onClick={toggleShow}>
        {show ? 'hide' : 'show'}
      </button> showing/hiding should not make a style change above<br/>
      {show && <custom-component ref={myref}/>}
      {show && <custom-component2 ref={myref2}/>}
      {show && <custom-component2/>}
      {show && <custom-component3 ref={myref3}/>}
      {show && <custom-component3/>}
    </Section>
  </div>;
};


// a failing component to test the ErrorBoundary
const Fail = () => {
  const foo = 'test';
  const {a, b, c} = foo.a; // fails to destruct
  return <div>Should fail</div>;
}

