#!/bin/bash

set -e

if [[ $# > 0 ]]; then
  if ( read -p "Creating new version of type $1. Enter if sure [Ctrl-C to cancel]" ); then
    echo 'ok';
  fi;
fi;

TYPE=${1:-patch}

npm version $TYPE
npm publish

cd web
npm version $TYPE
npm publish
