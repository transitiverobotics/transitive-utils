/* A script that uses the documentation.js npm package to generate Markdown
documentation from jsdoc comments in the code. */

import { build, formats } from 'documentation';
import fs from 'fs';

build('index.js', {
  sortOrder: ['kind', 'alpha'],
  inferPrivate: '^_',
  markdownToc: true,
  markdownTocMaxDepth: 3,
}).then(formats.md).then(output => {
    const header = fs.readFileSync('README_header.md', {encoding: 'utf-8'});
    fs.writeFileSync('README.md', header + output);
  });
