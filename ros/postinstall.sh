#!/bin/bash

# Post install script to conditionally install rclnodejs. This is different
# from an optionalDependency because we want this to fail if installation should
# succeed, namely when ROS2 is installed and sourced, and not even try otherwise.
# See #442.

if [[ $ROS_VERSION == 2 ]]; then
  echo Found ROS2, installing rclnodejs
  $NODE $npm_execpath i rclnodejs@0.25.0
else
  echo ROS2 not found
fi
