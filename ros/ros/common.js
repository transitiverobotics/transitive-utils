
// ROS2 goal statuses, which we also map from ROS1
const goalStatuses = [
  'UNKNOWN',   // 0: The goal has been accepted and is awaiting execution.
  'ACCEPTED',  // 1: The goal is currently being executed by the action server.
  'EXECUTING', // 2: The client has requested that the goal be canceled and the
  // action server has accepted the cancel request.
  'CANCELING', // 3: The goal was achieved successfully by the action server.
  'SUCCEEDED', // 4: The goal was canceled after an external request from an
  // action client.
  'CANCELED',  // 5: The goal was terminated by the action server without an
  // external request.
  'ABORTED',   // 6
];

module.exports = { goalStatuses };