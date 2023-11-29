# Web (browser)

These classes and functions are available via the `@transitive-sdk/utils-web` npm package and are for use in the browser or other browser based front-ends.

#### Example

In this example we create a new web-component (custom element) from a React component using mqttSync to subscribe to some data and re-rendering it in real-time whenever it changes.

```js
import React, { useEffect } from 'react';

import { createWebComponent, useTransitive, getLogger }
  from '@transitive-sdk/utils-web';

const log = getLogger('my-new-capability');
log.setLevel('debug');

// Get the name of the package we are part of. TR_PKG_NAME is set by esbuild.
const [scope, capabilityName] = TR_PKG_NAME.split('/');

const Device = ({jwt, id, host, ssl}) => {

  const { mqttSync, data, StatusComponent, prefixVersion } =
    useTransitive({ jwt, id, host, ssl,
      capability: TR_PKG_NAME,
      versionNS: TR_PKG_VERSION_NS
    });

  // once mqttSync is connected, subscribe to some topics
  useEffect(() => {
      if (!mqttSync) return;
      mqttSync.subscribe(`${prefixVersion}/device`);
      mqttSync.subscribe(`${prefixVersion}/cloud`);
    }, [mqttSync]);

  log.debug({prefixVersion, data, TR_PKG_NAME, TR_PKG_VERSION, TR_PKG_VERSION_NS});

  return <div>
    <StatusComponent />
    <pre>
      {/* Render the data. This updates automatically whenever data changes. */}
      {JSON.stringify(data, true, 2)}
    </pre>
  </div>;
};

createWebComponent(Device, `${capabilityName}-device`, ['jwt']);
```

