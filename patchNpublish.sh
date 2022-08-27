#!/bin/bash

set -e

npm version patch
npm publish

cd web
npm version patch
npm publish
