import React, { useState, useRef, useEffect } from 'react';

import { createWebComponent, getLogger, useTopics }
  from '@transitive-sdk/utils-web';

const log = getLogger('mock capability');
log.setLevel('debug');

const [scope, capabilityName] = TR_PKG_NAME.split('/');

const styles = {
};

const Device = (props) => {

  const {jwt} = props;
  const { agentStatus, topicData } = useTopics({
    jwt,
    topics: [
      '/test',
      '/server'
    ],
    host: 'homedesk.local:8888',
    ssl: false,
  });

  log.debug({agentStatus, topicData});

  return <div>Mock-Device
    <pre>
      {JSON.stringify(props, true, 2)}
    </pre>
  </div>;
};

log.debug('creating component');
createWebComponent(Device, `${capabilityName}-device`, ['jwt']);
