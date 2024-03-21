#! /bin/bash

# usage: newWindow NAME COMMAND [DIRECTORY]
function newWindow() {
  tmux new-window
  run "$@"
}

# usage: run NAME COMMAND [DIRECTORY]
function run() {
  tmux rename-window $1
  if [[ $# > 2 ]]; then
    tmux send "cd \"$3\"" C-m
  fi;
  tmux send "$2" C-m
}

# -----------------------------------

NAME=$(npm pkg get name)
NAME_UNQUOTED=${NAME//[\"\@]}
NAME_DOT=${NAME_UNQUOTED//\//\.}
VERSION=$(npm pkg get version)

BASENAME=$(basename $PWD)
echo -e "\033]0;$BASENAME\007"

tmux new-session -s "$BASENAME" -d
sleep 0.25
run "robot" "npx transitiveDev robot"
newWindow "web" "npx transitiveDev web"
newWindow "cloud" "npx transitiveDev cloud"

tmux a
