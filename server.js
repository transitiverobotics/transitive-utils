
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

module.exports = {
  findPath
};
