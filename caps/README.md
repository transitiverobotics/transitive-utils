# @transitive-sdk/utils-caps

Utilities to build and run Transitive capabilities in dev.

This package is included as a dependency in new Transitive capabilities created using the capability initializer (`npm init @transitive-sdk@latest mycap`). It contains scripts to:
- run the robot component in development,
- build the web components using [esbuild](https://esbuild.github.io/),
- build and run the docker container for the cloud component in development.

You do not typically use this package directly, so we recommend to follow our documentation for creating your own capabilities.
