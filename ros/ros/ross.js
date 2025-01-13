/* A factory, pronounced ROS-s, for requiring/importing the right ROS
* class(es). */

const fs = require('node:fs');

// const { getLogger, constants } = require('@transitive-sdk/utils');
// const log = getLogger('ROSs');
// log.setLevel('info');


const log = {
  warn: console.warn,
  info: console.log,
  debug: console.log,
  // debug: () => {}, //console.log,
};

const constants = {
  rosReleases: {
    kinetic: { rosVersion: 1, ubuntuCodename: 'xenial' },
    melodic: { rosVersion: 1, ubuntuCodename: 'bionic' },
    noetic: { rosVersion: 1, ubuntuCodename: 'focal' },
    dashing: { rosVersion: 2 },
    eloquent: { rosVersion: 2 },
    foxy: { rosVersion: 2 },
    galactic: { rosVersion: 2 },
    humble: { rosVersion: 2 },
    iron: { rosVersion: 2 },
    rolling: { rosVersion: 2 },
  }
};

const config = JSON.parse(process.env.TRCONFIG || '{}');
log.debug('using config', config, constants);

// determine available and configured ROS releases
let available = [];
try {
  available = fs.readdirSync('/opt/ros').filter(name => name != 'rolling');
} catch (e) {}
const active = !config.global?.rosReleases ? available :
  available.filter(release => config.global.rosReleases.includes(release));

/* check which ROS versions (1 or 2 or both) we are configured to use */
const releases = {};
active.forEach(rosRelease =>
  releases[constants.rosReleases[rosRelease]?.rosVersion] = true);

const ROSs = [];

if (releases[1]) {
  log.debug('using ROS1');
  try {
    const ros = require('./ros');
    ROSs.push(ros);
  } catch (e) {
    log.warn('Unable to load rosnodejs (ros1).', e.message);
  }
}

if (releases[2]) {
  log.debug('using ROS2');
  try {
    const ros = require('./ros2');
    ROSs.push(ros);
  } catch (e) {
    log.warn('Unable to load rclnodejs (ros2):', e.message);
  }
}

/** Get the correct instance for the given ROS version (1 or 2). */
const getForVersion = (version) => {
  log.debug('getForVersion', version, ROSs);
  return ROSs.find(ros => ros.rosVersion == version);
};

module.exports = { ROSs, getForVersion };