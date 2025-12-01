#!/bin/bash

# Script to test in a ROS noetic docker contrainer

FILE=/tmp/noetic_entrypoint.sh
cat > $FILE <<EOF
#!/bin/bash
set -e

# setup ros environment
source "/opt/ros/\$ROS_DISTRO/setup.bash" --
roscore > /dev/null 2>&1 &
rosrun actionlib_tutorials fibonacci_server > /dev/null 2>&1 &

exec "\$@"
EOF

chmod +x $FILE

docker build -t utils-ros-test-noetic -f - . <<EOF
FROM ros:noetic

# for actions
RUN apt update && apt install ros-noetic-actionlib-tutorials

COPY --from=transitiverobotics/try_noetic /tmp/transitive_nodejs20.deb /tmp
RUN dpkg -i /tmp/transitive_nodejs20.deb
EOF

docker run --rm -it -v $PWD:/ros -v $FILE:/entrypoint.sh \
--entrypoint=/entrypoint.sh \
utils-ros-test-noetic bash

