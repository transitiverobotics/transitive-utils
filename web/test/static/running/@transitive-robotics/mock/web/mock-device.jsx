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
};

export const Device = (props) => {

  const [clicked, setClicked] = useState(0);
  const [topics, setTopics] = useState(['/data']);

  const {jwt, host, ssl} = props;
  const { agentStatus, topicData } = useTopics({
    jwt,
    topics,
    host,
    ssl: JSON.parse(ssl),
  });

  useEffect(() => props.onData?.({clicked, topicData}), [clicked, topicData]);
  log.debug({props});

  return <div style={styles.wrapper}>Mock-Device
    <pre>
      {JSON.stringify(props, true, 2)}
    </pre>
    <button onClick={() => {
      setClicked(c => c + 1);
      setTopics(['/data', '/more']);
      props.onclick2?.();
    }}>
      clicked {clicked}
    </button>
  </div>;
};

log.debug('creating component');
export const proto =
  createWebComponent(Device, `${capabilityName}-device`, TR_PKG_VERSION);
