# ROS

ROS utils for use in Transitive robot capabilities. Supports both ROS 1 (using rosnodejs) and ROS 2 (using rclnodejs). The respective classes ROS1 and ROS2 have a unified interface, so that switching between ROS releases is trivial as can be seen in the example below.

## Install

```
npm i @transitive-sdk/utils-ros
```

## Example

This example requires a running `roscore` for ROS 1.

```js
const { ROSs, getForVersion } = require('@transitive-sdk/utils-ros');

const demo = async (version) => {
  const ros = getForVersion(version);
  await ros.init();

  const topic = '/utils_ros/test1';
  const type = version == 1 ? 'std_msgs/String' : 'std_msgs/msg/String';

  const interval = setInterval(() => {
    ros.publish(topic, type, {data: String(Date.now())});
  });

  const sub = ros.subscribe(topic, type, (msg) => {
    console.log('received', msg.data);
  });
};

demo(1); // run demo using ROS1
demo(2); // run demo using ROS2
```

