#!/bin/bash

# Script to test in a ROS2 jazzy docker contrainer

FILE=/tmp/tmp.sh

cat > $FILE <<EOF
. /opt/ros/jazzy/setup.bash

export PATH=$PATH:/transitive-preinstalled/usr/bin
cd /ros
EOF

chmod +x $FILE

docker run --rm -it --entrypoint=bash -v $PWD:/ros -v $FILE:/bashrc transitiverobotics/try_jazzy -rcfile /bashrc
