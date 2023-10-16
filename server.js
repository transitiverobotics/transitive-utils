
const fs = require('fs');
const path = require('path');

/** walk up the directory tree until we find a file or directory called basename
 */
const findPath = (basename) => {
  let lastDir = null;
  let dir = process.cwd();
  while (dir != lastDir) {
    if (fs.existsSync(`${dir}/${basename}`)) {
      return `${dir}/${basename}`;
    }
    lastDir = dir;
    dir = path.dirname(dir);
  }
  return null;
};

const versionScopes = ['major', 'minor', 'patch'];
/** Get from package info the version namespace we should use, e.g.,
{version: '1.2.3', config.versionNamespace: 'minor'} => '1.2' */
const getPackageVersionNamespace = () => {
  let versionScope =
    versionScopes.indexOf(process.env.npm_package_config_versionNamespace || 'patch');
  versionScope < 0 && (versionScope = 2);
  return process.env.npm_package_version?.split('.')
      .slice(0, versionScope + 1).join('.');
};

module.exports = {
  findPath, getPackageVersionNamespace
};
