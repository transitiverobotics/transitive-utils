import React, { useState, useRef, useEffect } from 'react';

import { createWebComponent, getLogger, useTopics }
  from '@transitive-sdk/utils-web';

const log = getLogger('mock capability');
log.setLevel('debug');

const [scope, capabilityName] = TR_PKG_NAME.split('/');

const styles = {
  wrapper: {
    borderRadius: '8px',
    backgroundColor: '#acf',
    padding: '1em'
  }
};

/** simple example exported function */
export const doSomething = (...args) => {
  log.debug('doing something', ...args);
  // NOTE: cannot use hooks here! This doesn't work, will through Invalid hook
  // call error
  // const [state, setState] = useState(123);
  // setState(s => s + 1);
};

/** This works!! No "Invalid Hook call" error from using this */
export class RClass extends React.Component {

  state = {counter: 0};

  componentDidMount() {
    this.setState({counter: 100});
  }

  doit() {
    this.setState(s => ({...s, counter: s.counter + 1}));
  }

  render() {
    return <div>
      RClass
      <button onClick={this.doit.bind(this)}>clicked {this.state.counter}</button>
    </div>;
  }
};

/* Crazy way to make hooks work in functional components like this that are
dynamically imported into a different React application: give React (hook
functions) to it dynamically. This "hydrates" the used React functions with
the ones provided by the using application. */
export function RFunction({myReact}) {
  const { useState, useRef, useEffect } = myReact;

  const [clicked, setClicked] = useState(0);
  useEffect(() => {
      setClicked(200);
    }, []);

  return <div>
    RFunction
    <button onClick={() => setClicked(c => c+1)}>
      clicked {clicked}
    </button>
  </div>;
};


const Device = (props) => {
  console.log('Device', {props});

  const appReact = props.appReact || React;
  const { useState, useRef, useEffect } = appReact;

  const [clicked, setClicked] = useState(0);
  const [topics, setTopics] = useState(['/data']);

  const {jwt, host, ssl} = props;
  const { agentStatus, topicData } = useTopics({
    jwt,
    topics,
    host,
    ssl: JSON.parse(ssl),
    appReact
  });

  useEffect(() => props.onData?.({clicked, topicData}), [clicked, topicData]);
  // log.debug({props});

  return <div style={styles.wrapper}>Mock-Device
    <pre>
      {/* {JSON.stringify(props, true, 2)} */}
      {JSON.stringify(topicData, true, 2)}
    </pre>
    <button onClick={() => {
      setClicked(c => c + 1);
      // dynamically change subscriptions
      setTopics(['/data', '/more']);
      props.onclick2?.();
    }}>
      clicked {clicked}
    </button>
  </div>;
};

/** A secondary UI offered by this (mock) capability */
const Secondary = (props) => {
  return <div>Secondary UI component: {capabilityName}-secondary. Props:
    <pre>
      {JSON.stringify(props, true, 2)}
    </pre>
  </div>
};


log.debug('creating components');
createWebComponent(Device, `${capabilityName}-device`, TR_PKG_VERSION);
createWebComponent(Secondary, `${capabilityName}-secondary`, TR_PKG_VERSION);


export default Device;
