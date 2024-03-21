#!/bin/bash

if [[ $# -lt 1 ]]; then
  echo "need to provide command"
  exit 1;
fi;

# echo $0
# DIR=$(dirname $0)
DIR=node_modules/@transitive-sdk/utils-caps

declare -A commands
commands[env]="env | sort"
commands[robot]="$DIR/rundev.sh"
commands[web]="node $DIR/esbuild.js"
commands[cloud]="$DIR/docker.sh"
commands[tmux]="$DIR/tmux.sh"

commands[prepack]="if [ ${npm_command} = 'publish' ] &&  [ ! $TRANSITIVEDEV ]; then echo -e '\033[33m*** Please use \"npx transitiveDev publish [prod]\"\n\n'; exit 1; fi";
commands[publish]="$DIR/publish.sh $2"

commands[all]="(${commands[robot]} | sed 's/^/\r🤖 /' ) & (${commands[web]} | sed 's/^/\r🌐 /') & (${commands[cloud]} | sed 's/^/\r☁️: /') & wait"

cmd=${commands[$1]}
if [[ -z $cmd ]]; then
  echo "Unknown command: " $1
  exit 2
fi;

bash -c "$cmd"
