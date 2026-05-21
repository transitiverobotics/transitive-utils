const ros0 = require('../ros/ros0.js');

const { Proxy, XPublisher, XSubscriber } = require('zeromq');

/** Run a ZeroMQ Proxy. See Figure 13 - Pub-Sub Network with a Proxy in
 * https://zguide.zeromq.org/docs/chapter2/#Intermediaries-and-Proxies */
async function runProxy() {
  // 1. Initialize the sockets and the Proxy object
  const frontend = new XSubscriber();
  const backend = new XPublisher();
  const proxy = new Proxy(frontend, backend);

  // 2. Bind the endpoints (or connect depending on topology)
  // Publishers will connect here to drop off messages
  await proxy.frontEnd.bind("ipc:///tmp/transitive-zmq.sock.pub");

  // Subscribers will connect here to read messages
  await proxy.backEnd.bind("ipc:///tmp/transitive-zmq.sock.sub");

  console.log("ZeroMQ Proxy is running...");

  // 3. Start the proxy loop (returns a Promise)
  // This will run indefinitely until proxy.terminate() is called
  await proxy.run();
}

// start the proxy
runProxy().catch(console.error);


const run = async () => {
  await ros0.init();

  ros0.subscribe('topic1', null, d => console.log('topic1', d));
  ros0.subscribe('topic2', null, console.log);

  setInterval(() => {
      ros0.publish('topic1', null, {data: Date.now(), pid: process.pid});
      ros0.publish('topic2', null, {data: Date.now(), pid: process.pid});
    }, 10);
};

run();

