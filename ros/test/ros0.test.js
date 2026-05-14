const ros0 = require('../ros/ros0.js');

const run = async () => {
  await ros0.init('test');

  ros0.subscribe('topic1', null, console.log);
  // ros0.subscribe('time');

  setInterval(() =>
    ros0.publish('topic1', null, Date.now()), 1000);
};

run();

