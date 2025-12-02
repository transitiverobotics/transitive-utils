const { ROSs, getForVersion } = require('../index');
const _ = require('lodash');

const { getLogger } = require('@transitive-sdk/utils');
const log = getLogger('tests');
log.setLevel('debug');


const getAllPropertyNames = (obj) => {
  let result = {};
  while (obj) {
    const type = obj.constructor.name;
    result[type] = [];
    Object.getOwnPropertyNames(obj).forEach(p => result[type].push(p));
    obj = Object.getPrototypeOf(obj);
  }
  return result;
};



const run = async () => {
  const ros = getForVersion(1);
  await ros.init();
  ros.subscribe('/depth/color/image_raw', 'sensor_msgs/Image', (msg) => {
    console.log(msg.data.length);
  });

  const actions = await ros.getActions();
  log.debug('actions', actions);

  _.forEach(actions, async (type, action) => {
    const [pkg, subtype] = type.split('/');
    const template = ros.getTypeTemplate(pkg, 'action', subtype);
    // hard-coded for now
    // template.edges = 3;
    // template.radius = 2;
    // await ros.callAction(action, type, template);
    // const goal = await ros.callAction(action, type, {edges: 3, radius: 1},
    //   log.debug);

    // test with fibonacci_server from ROS tutorial (see docker_test_noetic)
    const goal = await ros.callAction(action, type, {order: 4},
      log.debug);
    // goal.on('transition', () => {
    //   const status = goal.getGoalStatus();
    //   log.warn(status, goal.getResult());
    // });
    log.debug({goal});
    log.debug(await goal.getResult());
    // log.debug(goal.getTerminalState(), goal.isSucceeded());
    log.debug(goal.getStatus(), goal.isSucceeded(), goal.getStatusName());
  });
};

run();