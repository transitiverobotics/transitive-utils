const assert = require('assert');

const { ROSs, getForVersion } = require('../index');

test('loads', () => {
  expect(ROSs).toBeDefined();
  expect(getForVersion(1)).toBeDefined();
  expect(getForVersion(2)).toBeDefined();
});

[1, 2].forEach(version => {

  describe(`ROS ${version}`, function() {

    const topic = '/utils_ros/test1';
    const type = version == 1 ? 'std_msgs/String' : 'std_msgs/msg/String';

    let ros;
    let interval;
    beforeAll(async () => {
      ros = getForVersion(version);
      await ros.init();
      interval = setInterval(() => {
        ros.publish(topic, type, {data: String(Date.now())});
      });
    });

    afterAll(() => {
      interval && clearInterval(interval);
      ros.shutdown?.();
    });

    test('inits', async () => {
      expect(() => { ros.requireInit(); }).not.toThrow();
    });

    test('gets topics', async () => {
      const list = await ros.getTopics();
      expect(list.length > 0).toBeTruthy();
    });

    test('can subscribe and get topic messages', (done) => {
      let first = true;
      const sub = ros.subscribe(topic, type, (msg) => {
        first && expect(Number(msg.data) > 0).toBeTruthy();
        first && done();
        ros.unsubscribe(topic);
        sub.shutdown();
        first = false;
      });
    });

  });

  });