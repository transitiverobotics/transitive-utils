import React, { useState, useEffect, useContext, useRef,
    forwardRef, useImperativeHandle, Suspense }
  from 'react';
// window.React = React;
import ReactDOM from 'react-dom';

import { Badge, Button, OverlayTrigger, Popover } from 'react-bootstrap';

import { getLogger, loglevel, fetchJson, useMqttSync, MqttSync, Timer, TimerContext,
    ErrorBoundary, createWebComponent, useTransitive, useTopics, useCapability,
    TransitiveCapability } from '../../index';
const log = getLogger('test/App');
log.setLevel('debug');
// loglevel.setAll('debug');

const HOSTNAME = 'localhost';
const PORT = 8888;
const HOST = `${HOSTNAME}:${PORT}`;

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
      // log.debug('foo4', args, this);
      return 'return of Comp:foo4';
    },
  }));

  setTimeout(() => {
    props.setConfig({k1: 'v1'});
  }, 1000);

  // console.log('comp1 render');
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
    // log.debug('foo', ...args, this);
    return 'return of Comp2:foo';
  }

  render() {
    setTimeout(() => {
      this.props.setConfig({k2: new Date()});
    }, 1000);

    // console.log('comp2 render');
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

  // console.log('comp3 render');
  return <div>custom component3</div>
};

createWebComponent(Comp, 'custom-component', '1.2.3', {
  stylesheets: [
    // load local css for testing
    '/bootstrap_transitive-bs-root.css'
  ],
  });

createWebComponent(Comp2, 'custom-component2', '1.2.3', {
  stylesheets: [// seems to define the CSS 'badge' class
    'https://unpkg.com/leaflet@1.9.3/dist/leaflet.css'],
  shadowDOM: true
});

createWebComponent(Comp3, 'custom-component3', '1.2.3', {
  stylesheets: [],
  shadowDOM: true
});



/* ------------- */

const JWTs = [
  // put JWTs here to render using TransitiveCapability
];

const SimpleFunctional = () => {
  const [clicked, setClicked] = useState(0);
  return <div>
    SimpleFunctional
    <button onClick={() => setClicked(c => c+1)}>
      clicked {clicked}
    </button>
  </div>;
}

const ClassWithFunctional = class extends React.Component {
  render() {
    return <div>
      RFunction2
      <SimpleFunctional />
    </div>;
  }
};

const mockJWT = (id, count) =>
  `ignore.${btoa(JSON.stringify({
    id,
    device: `d_mock_${count}`,
    capability: '@transitive-robotics/mock'
  }))}.ignore`;

export default () => {
  const [count, setCount] = useState(0);
  const [show, setShow] = useState(true);
  const toggleShow = () => setShow(s => !s);

  const [dynData, setDynData] = useState();
  const [dynData2, setDynData2] = useState();
  const [dynData3, setDynData3] = useState();

  const [id, setId] = useState('mockUser');
  const [jwt, setJwt] = useState(mockJWT('mockUser', 0));

  useEffect(() => {
      setId(`mockUser_${count}`);
    }, [count]);

  useEffect(() => {
      setJwt(mockJWT(id, count));
    }, [id]);

  const {mqttSync, data, status, ready, StatusComponent} =
    useTransitive({jwt, id, host: HOST, ssl: false,
      capability: '@transitive-robotics/web-test',
      versionNS: '0.1'});

  useEffect(() => {
      if (mqttSync && ready) {
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
    // log.debug(myref.current.call('foo4', 'abc', 123),
    //   myref.current.getConfig());
  }

  const myref2 = useRef(null);
  if (myref2.current) {
    // log.debug(myref2.current.call('foo', 'abc', 123),
    //   myref2.current.getConfig());
  }

  const myref3 = useRef(null);

  // log.debug({data});

  const {loaded, loadedModule} = useCapability({
    capability: '@transitive-robotics/mock',
    name: 'mock-device',
    userId: 'cfritz',
    deviceId: 'd_f5b1b62bd4',
    host: HOST,
    ssl: false,
  });

  loadedModule?.doSomething?.(1,2,3); // only works with ESM
  const RClass = loadedModule?.RClass;
  const RFunction = loadedModule?.RFunction;
  const Device = loadedModule?.default;

  // log.debug({loadedModule});

  if (!mqttSync || !ready) {
    return <div>Connecting...</div>;
  }

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
      It should show an Error:
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


    <Section title="Dynamically loaded web components">

      1, from web component:
      { loaded && <mock-device id="cfritz" host={HOST} ssl="false"
        jwt={jwt}
        />}

      2, TransitiveCapability:
      <TransitiveCapability jwt={jwt} myconfig={123}
        host={HOST} ssl={false}
        onclick2={() => { log.debug('clicked2!!!'); }}
        onData={setDynData2}
        />
      {dynData2 && <pre>dynData2: {JSON.stringify(dynData2, true, 2)}</pre>}

      3, TransitiveCapability:
      <TransitiveCapability jwt={jwt} myconfig={123}
        host={HOST} ssl={false}
        onclick2={() => { log.debug('clicked3!!!'); }}
        onData={setDynData3}
        />
      {dynData3 && <pre>dynData3: {JSON.stringify(dynData3, true, 2)}</pre>}

      4, TransitiveCapability: click 3's button four time!
      {dynData3?.clicked > 3 &&
          <TransitiveCapability jwt={jwt} myconfig={123}
            host={HOST} ssl={false}
            onclick2={() => { log.debug('clicked4!!!'); }}
            someData={{a: 1, b: 2}}
            anArray={[1,2,3,5,8,13,21]}
            />
      }

      { /* Render all capabilities for which we have a JWT */
        JWTs.map((jwt, i) =>
          <TransitiveCapability key={i} jwt={jwt} host={HOSTNAME} ssl={false} />)
      }

      { RClass && <RClass /> }
      { RFunction && <RFunction myReact={React} /> }
      { ClassWithFunctional && <ClassWithFunctional /> }
      { Device && <Device appReact={React}
          jwt={jwt}
          myconfig={'default123'}
          host={HOST}
          ssl={false}
          onclick2={() => { log.debug('clicked Device!!!'); }}
          someData={{a: 1, b: 2}}
          anArray={[1,2,3,5,8,13,21]}
          /> }

    </Section>


    <Section title="Production Capabilities">
    </Section>

    <Section title="Failures">
      Test with bad JWTs
      <ErrorBoundary>
        <TransitiveCapability
          jwt={`xx.${btoa(JSON.stringify({ id: 'id1', device: 'd_mock' }))}.xx`}
          />
        <TransitiveCapability
          jwt={`xx.${btoa(JSON.stringify({ device: 'd_mock', capability: 'a/b' }))}.xx`}
          />
        <TransitiveCapability
          jwt={`xx.${btoa(JSON.stringify({ id: 'id1', capability: 'a/b' }))}.xx`}
          />
      </ErrorBoundary>
    </Section>


    The end
  </div>;
};


// a failing component to test the ErrorBoundary
const Fail = () => {
  const foo = 'test';
  const {a, b, c} = foo.a; // fails to destruct
  return <div>Should fail</div>;
}

