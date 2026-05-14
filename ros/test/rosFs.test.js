const rosFs = require('../ros/rosFs.js');

const run = async () => {
  // rosFs.init();
  rosFs.init({publishInterval: 100}); // default is 10000
  rosFs.subscribe('time', null, console.log);
  // try to publish 10hz -> will be throttled to max(1000, publishInterval)
  setInterval(() => rosFs.publish('time', null, Date.now()), 100);
  rosFs.subscribe('topic2', null, console.log);
};

run();

console.log('now edit /tmp/transitive-ros-fs/topic2');
