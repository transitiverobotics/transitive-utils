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

    test('can publish messages with headers', () => {
      const topic = '/test_diag';
      const type = version == 1 ? 'diagnostic_msgs/DiagnosticArray' :
        'diagnostic_msgs/msg/DiagnosticArray';

      ros.publish(topic, type, {
        level: 0,
        name: 'test',
        message: 'all good',
        hardware_id: 1,
      });
    });

    test('can get types', () => {
      const types = ros.getAvailableTypes();
      assert(types.std_msgs.msg.includes('String'));
    });

    test('can get type templates', () => {
      const template = ros.getTypeTemplate('nav_msgs', 'msg', 'OccupancyGrid');
      // check a few fields
      assert.equal(typeof template.info.origin.position.x, 'number');
      assert.equal(typeof template.info.origin.orientation.x, 'number');
      assert.equal(typeof template.header.frame_id, 'string');
    });
  });
});