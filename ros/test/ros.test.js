const assert = require('assert');
const _ = require('lodash');

const { ROSs, getForVersion } = require('../index');

test('loads', () => {
  expect(ROSs).toBeDefined();
  expect(getForVersion(1)).toBeDefined();
  expect(getForVersion(2)).toBeDefined();
});

[1, 2].forEach(version => {
  const ros = getForVersion(version);
  if (!ros) {
    console.warn(`ROS ${version} not found`);
    return;
  }

  describe(`ROS ${version}`, function() {

    const type = 'std_msgs/String';
    const topic = '/utils_ros/testtopic';

    let interval;
    beforeAll(async () => {
      await ros.init();
      interval = setInterval(() => {
        ros.publish(topic, type, {data: String(Date.now())});
      }, 10);
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

    test('can subscribe and receive new messages', (done) => {
      let first = true;
      const sub = ros.subscribe(topic, type, (msg) => {
        first && expect(Number(msg.data) > 0).toBeTruthy();
        ros.unsubscribe(topic);
        sub.shutdown();
        first && done();
        first = false;
      });
    });

    test('can receive latched messages', (done) => {
      const topic = '/utils_ros/testlatchedmessages';
      let receivedMsgs = 0;

      ros.publish(topic, type, {data: 'latched'}, true);
      // sleep for a bit and subscribe later to ensure message is latched
      setTimeout(() => {
        const sub = ros.subscribe(topic, type, (msg) => {
          if (receivedMsgs == 0) {
            expect(msg.data).toEqual('latched');
          }
          if (receivedMsgs == 1) {
            expect(msg.data).toEqual('volatile');
            sub.shutdown();
            done();
          }
          receivedMsgs++;
        });
        // we then publish a volatile message to check that it is received
        setTimeout(() => {
          ros.publish(topic, type, {data: 'volatile'}, false);
        }, 500);
      }, 500);
    });

    test('can handle multiple subscribers on same topic', (done) => {
      const topic = '/utils_ros/testmultisubscribers';
      const type = version == 1 ? 'std_msgs/String' : 'std_msgs/msg/String';
      let receivedMsgs = 0;

      const wrapUp = () => {
        receivedMsgs++;
        if(receivedMsgs == 3) {
          done();
        }
      }

      const sub1 = ros.subscribe(topic, type, (msg) => {
        console.log('received message on sub1', msg);
        expect(msg.data).toEqual('multisubscribers');
        sub1.shutdown();
        wrapUp();
      });

      const sub2 = ros.subscribe(topic, type, (msg) => {
        console.log('received message on sub2', msg);
        expect(msg.data).toEqual('multisubscribers');
        sub2.shutdown();
        wrapUp();
      });

      const sub3 = ros.subscribe(topic, type, (msg) => {
        console.log('received message on sub3', msg);
        expect(msg.data).toEqual('multisubscribers');
        sub3.shutdown();
        wrapUp();
      });

      ros.publish(topic, type, {data: 'multisubscribers'}, false);
    });

    test('can publish messages with headers', () => {
      const topic = '/test_diag';
      const type = 'diagnostic_msgs/DiagnosticArray';

      ros.publish(topic, type, {
        level: 0,
        name: 'test',
        message: 'all good',
        hardware_id: 1,
      });
    });

    test('can publish messages with typed arrays', () => {
      const topic = '/test_nav';
      const typeList = `nav_msgs/GridCells`;
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
    });

    test('get services', async () => {
      const services = await ros.getServices();
      // check some known services that should always be present
      if (ros.rosVersion == 1) {
        assert(services.includes('/rosout/get_loggers'));
      } else {
        assert(services.find(s => s.endsWith('/get_parameters')));
      }
    });

    test('get service types', async () => {
      if (ros.rosVersion == 1) {
        assert.equal(await ros.getServiceType('/rosout/get_loggers'),
          'roscpp/GetLoggers');
      } else {
        const services = await ros.getServices();
        const service = services.find(s => s.endsWith('/get_parameters'));
        assert.equal(await ros.getServiceType(service),
          'rcl_interfaces/srv/GetParameters');
      }
    });

  });
});