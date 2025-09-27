#!/bin/bash

# A script for starting the robot component of a capability in development, i.e.
# establishing the same or similar runtime context as when the component is run
# on a robot/device in production.

if [[ ! -e ~/.transitive/.env ]]; then
  >&2 echo "** Error. It seems that the Transitive agent is not installed. Aborting."
  exit 1;
fi;

CAP=$(npm pkg get name | tr -d '"')
mkdir -p ~/.transitive/packages/$CAP
echo -n 1234 > ~/.transitive/packages/$CAP/password
. ~/.transitive/etc/env_local

# Use the node.js version installed locally in ~/.transitive
export PATH=~/.transitive/usr/bin:$PATH

getROSRelease() {
  case $(lsb_release -sc) in
    xenial) echo kinetic;;
    bionic) echo melodic;;
    focal) echo noetic;;
    *) echo noetic;;
  esac
}

tryToSourceROS() {
  ROS_RELEASE=$1
  if [ -e /opt/ros/$ROS_RELEASE/setup.bash ]; then
    echo "found ROS $ROS_RELEASE, sourcing it";
    . /opt/ros/$ROS_RELEASE/setup.bash;
  fi
}

# automatically decide which ROS1 release to source based on OS
tryToSourceROS $(getROSRelease)

# ROS 2:
tryToSourceROS foxy
tryToSourceROS galactic
tryToSourceROS humble
tryToSourceROS iron

# Make sure a config file exists
if [[ ! -e ~/.transitive/config.json ]]; then
  echo "{}" > ~/.transitive/config.json
fi;

env $(cat ~/.transitive/.env | grep -v ^\# | xargs) \
PASSWORD="1234" \
TRPACKAGE=$CAP \
TRCONFIG="$(cat ~/.transitive/config.json | tr -d '\n' | sed "s#$CAP#package#")" \
NODE_ARGS=$@ \
TRANSITIVE_IS_ROBOT=1 \
FORCE_COLOR=1 \
npm start "ignore, for monitoring: startPackage.sh $CAP" 2>&1 | tee -a ~/.transitive/packages/$CAP/log
