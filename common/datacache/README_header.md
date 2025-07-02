

# DataCache

A class for storing data in a JSON object with change detection and change notifications. Ideal for building data-syncs and for triggering reactive updates in React (or similar front-end framework) when this synced data is changed on the back-end.

```js
> const {DataCache} = require('@transitive-sdk/datacache')
> d = new DataCache()
> d.subscribe((change) => console.log('d has changed', change));
> d.subscribeTopic('/+first/c', (value, path, match) => console.log('/+first/c has changed to', value, `with first being ${match.first}`));

> d.update(['a','b'], 1234)
d has changed { '/a/b': 1234 }

> d.update(['a','c'], 123)
d has changed { '/a/c': 123 }
/+first/c has changed to 123 with first being a

> d.get()
{ a: { b: 1234, c: 123 } }
```

With this it is terribly easy to implement a data-sync over any connection that allows you to send strings:

```js
const data = new DataCache();

const client = new SomeCommunicationProtocol();
client.connect('...to some peer over some protocol');

// parse messages we receive from peer, apply to local DataCache
client.on('message', (message) => {
  const change = JSON.parse(message.toString());
  if (change) {
    _.forEach(change, (value, key) =>
      data.update(key, value, {external: true}));
  }
});

// subscribe to local changes and publish them to the peer
data.subscribe((change, tags) => {
  if (tags?.external)
    // this is a change that we've received from another party, don't re-publish
    return;

  // notify the peer of these changes
  client.send(JSON.stringify(change));
});
```

------

# Documentation


