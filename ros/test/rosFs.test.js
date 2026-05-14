const rosFs = require('../ros/rosFs.js');

const run = async () => {
  rosFs.init();
  rosFs.subscribe('time', null, console.log);
  setInterval(() => rosFs.publish('time', null, Date.now()), 1000);
  rosFs.subscribe('topic2', null, console.log);
};

run();

console.log('now edit /tmp/transitive-ros-fs/topic2');
