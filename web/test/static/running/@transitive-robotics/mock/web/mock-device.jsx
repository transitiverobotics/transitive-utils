import React, { useState, useRef, useEffect } from 'react';

import { createWebComponent, getLogger, useTopics }
  from '@transitive-sdk/utils-web';

const log = getLogger('mock capability');
log.setLevel('debug');

const [scope, capabilityName] = TR_PKG_NAME.split('/');

const styles = {
};


const listeners = [];
export const onData = (listener) => listeners.push(listener);

const topics = [
  '/data',
];

const Device = (props) => {

  const [clicked, setClicked] = useState(0);

  const {jwt, host, ssl} = props;
  const { agentStatus, topicData } = useTopics({
    jwt,
    topics,
    host,
    ssl: JSON.parse(ssl),
  });

  useEffect(() => {
    listeners.forEach(l => l({topicData}));
  }, [topicData]);

  useEffect(() => {
    listeners.forEach(l => l({clicked}));
  }, [clicked]);

  // log.debug({agentStatus, topicData});

  return <div>Mock-Device
    <pre>
      {JSON.stringify(props, true, 2)}
    </pre>
    <button onClick={() => setClicked(c => c + 1)}>
      clicked {clicked}
    </button>
  </div>;
};

log.debug('creating component');
createWebComponent(Device, `${capabilityName}-device`, TR_PKG_VERSION);
