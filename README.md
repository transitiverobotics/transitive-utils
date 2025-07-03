<p align="center">
  <a href="https://transitiverobotics.com">
    <img src="https://transitiverobotics.com/img/logo.svg" style="height: 64px">
  </a>
</p>

## Transitive Node.js SDK

The node.js SDK used by the [Transitive Robotics](https://transitiverobotics.com) framework and its capabilities on the back-end, i.e., robots, on-prem devices, and cloud.

[Documentation](https://transitiverobotics.com/docs/sdk/server/)


## Changelog

### v0.14
- `DataCache` is now available directly via `@transitive-sdk/datacache`. It is still included in `@transitive-sdk/utils` though.
#### Breaking Changes
- `Mongo` is no longer part of `@transitive-sdk/utils`, please use `@transitive-sdk/mongo` instead.
