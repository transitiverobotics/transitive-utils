#!/bin/bash

# Post install script to conditionally install rclnodejs. This is different
# from an optionalDependency because we want this to fail if installation should
# succeed, namely when ROS2 is installed and sourced, and not even try otherwise.
# See #442.

NPM="$NODE $npm_execpath"

if [[ $ROS_VERSION == 2 ]]; then
  echo 'Found ROS2, installing rclnodejs'
  $NPM i --no-save rclnodejs@0.27.0
else
  echo ROS2 not found
fi
