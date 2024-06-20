const assert = require('assert');
const _ = require('lodash');

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
        ros.unsubscribe(topic);
        sub.shutdown();
        first && done();
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

    test('can publish messages with typed arrays', () => {
      const topic = '/test_nav';
      const typeList = `nav_msgs/${version == 1 ? '' : 'msg/'}GridCells`;
      ros.publish(topic, type,
        ros.getTypeTemplate('nav_msgs', 'msg', 'GridCells'));
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
      assert(template.data instanceof Array);
    });

    test('can get type templates with non-primitive arrays', () => {
      const template = ros.getTypeTemplate('nav_msgs', 'msg', 'GridCells');
      // check a few fields
      assert.equal(typeof template.cell_width, 'number');
      assert(template.cells instanceof Array);
    });

    test('can get type template for service', () => {
      const template = ros.getTypeTemplate('turtlesim', 'srv', 'Spawn');
      // check a few fields
      assert.equal(typeof template.x, 'number');
      assert.equal(typeof template.name, 'string');
    });

    test('can get type template for service with msg field', () => {
      const template = ros.rosVersion == 2 ?
        ros.getTypeTemplate('rcl_interfaces', 'srv', 'SetParameters') :
        ros.getTypeTemplate('sensor_msgs', 'srv', 'SetCameraInfo');
      // console.log(template);
    });

    test('get services', async () => {
      const services = await ros.getServices();
      // check some known services that should always be present
      console.log('services', ros.rosVersion, services);
      if (ros.rosVersion == 1) {
        assert.equal(services['/rosout/get_loggers'].type, 'roscpp/GetLoggers');
      } else {
        const key = _.findKey(services, (o, key) => key.endsWith('/get_parameters'));
        assert(key);
        assert.equal(services[key].type, 'rcl_interfaces/srv/GetParameters');
      }
    });

  });
});