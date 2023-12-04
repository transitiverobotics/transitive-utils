# ROS utils for Transitive

## Install

```
npm i @transitive-sdk/utils-ros
```

## Example

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

demo(1);
demo(2);
```

## Running Tests

Before you can run tests you need to make sure all optional dependencies are installed which requires you to first source a ROS2 distribution (e.g., `. /opt/ros/galactic/setup/.bash` followed by `npm i`).

To run tests, start a `roscore`, then:
```bash
npm test
```