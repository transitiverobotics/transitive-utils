const ros0 = require('../ros/ros0.js');

const run = async () => {
  await ros0.init();
  // await ros0.init({address: 'tcp://localhost:4444'});

  ros0.subscribe('topic1', null, console.log);
  // ros0.subscribe('time');

  setInterval(() =>
    ros0.publish('topic1', null, {data: Date.now()}), 1000);
};

run();

