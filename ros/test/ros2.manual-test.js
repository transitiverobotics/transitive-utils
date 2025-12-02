let rclnodejs;
try {
  rclnodejs = require('rclnodejs');
} catch (e) {
  console.error('Unable to load rclnodejs, did you source your ROS2 env?');
  process.exit(1);
}

const topic1 = '/chat1';
const topic2 = '/chat2';
const type = 'std_msgs/msg/String';

// create mock
rclnodejs.init().then(() => {
  const node = rclnodejs.createNode('subscription_example_node');

  node.createSubscription(type, topic1, (msg) => {
    console.log(`Received message: ${typeof msg}`, msg);
  });

  const pub = node.createPublisher(type, topic2);
  setInterval(() => pub.publish(topic2, type, 'hello2!'), 1000);

  rclnodejs.spin(node);
});


const run = async () => {
  const ROS2 = require('./ros2');
  await ROS2.init();

  console.log('topics:', await ROS2.getTopics());
  const imageTopics = await ROS2.getTopics('sensor_msgs/Image')
  console.log('image topics:', imageTopics);
  console.log('subscribed topics:', await ROS2.getSubscribedTopics());

  ROS2.subscribe(topic2, type, console.log);

  imageTopics.length > 0 &&
  ROS2.subscribe(imageTopics[0], 'sensor_msgs/Image', console.log);

  setInterval(() => ROS2.publish(topic1, type, {data: 'hello1!'}), 1000);

  // action
  setTimeout(async () => {
      const actions = ROS2.getActions();
      console.log(actions);
      // console.log(ROS2.getAvailableTypes());
      const goals = {};
      for (let name in actions) {
        const type = actions[name];
        // console.log(name, ROS2.getTypeTemplate(...type.split('/')));
        // const TypeClass = rclnodejs.require(type);
        // console.log(TypeClass, Object.keys(TypeClass),
        //   ROS2.getActionTemplate(type));
        const template = ROS2.getTypeTemplate(...type.split('/'));
        console.log(type, template);
        template.theta = Math.random() * 2 * Math.PI;
        goals[name] = await ROS2.callAction(name, type, template, console.log);
      }

      // setInterval(() => console.log(Object.values(goals).map(g => g.status)),
      //   100);
      Object.values(goals).forEach(async g => {
        console.log(await g.getResult());
        console.log(g.getStatus(), g.isSucceeded(), g.getStatusName());
      });


    }, 2000);
}

setTimeout(run, 1000);