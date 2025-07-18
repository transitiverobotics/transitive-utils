#!/bin/bash


# Script to run cloud caps in docker. This tries to replicate what we do in
# cloud/app/docker.js, just for dev.
# Usage: invoked by subScript via `npm start` (part of utils-caps)

set -e

BASE_PORT=1234

# The directory where this script lives
DIR=$(dirname $0)

# find an available port we can use
function findOffset() {
  local PORT=$BASE_PORT
  local OFFSET=0
  while (nc -z 127.0.0.1 $PORT); do
    OFFSET=$(( $OFFSET + 1 ));
    PORT=$(( $BASE_PORT + $OFFSET ));
  done
  echo $OFFSET
}

OFFSET=$(findOffset)
PORT=$(( $BASE_PORT + $OFFSET ))
# not in use by any capabilities right now:
# MIN_PORT=$((60000 + $OFFSET * 100))
# MAX_PORT=$((60080 + $OFFSET * 100))

# echo "using port offset $OFFSET, i.e., port $PORT and port range $MIN_PORT-$MAX_PORT"
echo "using port $PORT"

CAP_NAME=$(npm pkg get name)
VERSION=$(node -e "console.log(require('@transitive-sdk/utils').getPackageVersionNamespace())")
FULL_NAME=${CAP_NAME/\//.}.${VERSION}
FULL_NAME2=${FULL_NAME//\"/}
CONTAINER_NAME=${FULL_NAME2//@/}
TAG="transitive-robotics/$(basename $PWD):${VERSION//\"/}"
TMP=${CAP_NAME//[\"@]/};
SAFE_NAME=${TMP//\//_} # e.g., transitive-robotics-webrtc-video

echo Building $TAG and running as $CONTAINER_NAME

$DIR/generate_certs.sh
mkdir -p cloud/certs
mv client.* cloud/certs

# copy with -L (symlink resolution) into tmp dir for building
TMPDIR=/tmp/_tr_build/$TAG
mkdir -p $TMPDIR
echo "copying to $TMPDIR"
cp -aLu . $TMPDIR

# docker build -f $SCRIPT_PATH/Dockerfile -t $TAG \
docker build -f $DIR/Dockerfile -t $TAG \
--add-host=registry.homedesk.local:host-gateway \
$TMPDIR

mkdir -p /tmp/pers/common
mkdir -p /tmp/pers/$TAG

# bind mounts for all .js files in capability root folder
jsFiles=$(for n in *.js; do echo -v $PWD/$n:/app/$n; done)

docker run -it --rm --init \
--env MQTT_URL=mqtts://mosquitto \
--env PUBLIC_PORT=$PORT \
--env MONGO_DB="cap_$SAFE_NAME" \
--env MONGO_URL="mongodb://mongodb" \
-p $PORT:1000 -p $PORT:1000/udp \
-v /tmp/pers/common:/persistent/common \
-v /tmp/pers/${TAG//:/.}:/persistent/self \
-v $PWD/cloud:/app/cloud \
$jsFiles \
--network=cloud_caps \
--name $CONTAINER_NAME \
$TAG $@

# not in use by any capabilities right now:
# --env MIN_PORT=$MIN_PORT \
# --env MAX_PORT=$MAX_PORT \
# -p $MIN_PORT-$MAX_PORT:$MIN_PORT-$MAX_PORT -p $MIN_PORT-$MAX_PORT:$MIN_PORT-$MAX_PORT/udp \

# doesn't yet work: when using this, the npm script runs as the owning user,
# "node", because it has the same uid (1000) as us. But we want root.
# -v $PWD:/app \

rm -rf $TMPDIR