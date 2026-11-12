const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const isDevelopment = (process.env.npm_lifecycle_event != 'prepare');

const copyDeclarations = (sourceDir, destinationDir) => {
  for (const entry of fs.readdirSync(sourceDir, {withFileTypes: true})) {
    const sourcePath = path.join(sourceDir, entry.name);
    const destinationPath = path.join(destinationDir, entry.name);

    if (entry.isDirectory()) {
      copyDeclarations(sourcePath, destinationPath);
    } else if (entry.name.endsWith('.d.ts')) {
      fs.mkdirSync(destinationDir, {recursive: true});
      fs.copyFileSync(sourcePath, destinationPath);
    }
  }
};

const config = {
  entryPoints: [{in: './index.ts', out: 'utils-web'}],
  bundle: true,
  format: 'cjs',
  preserveSymlinks: true, // this allows us to use symlinks
  // Do *NOT* minify, it would remove "magic webpack comments" that are required
  // by users that use webpack for bundling.
  // minify: !isDevelopment,
  sourcemap: isDevelopment,
  target: ['chrome110', 'firefox110', 'safari15', 'edge110'],
  packages: 'external',
  outdir: 'dist',
  loader: {
    '.js': 'jsx',
    '.svg': 'text',
    // '.wasm': 'file',
    // '.css': 'local-css',
  },
  plugins: [{
      name: 'rebuild-notify',
      setup(build) {
        build.onEnd(result => {
          console.log(new Date(), build.initialOptions.format,
            `build ended with ${result.errors.length} errors`);
        })
      },
    }
  ],
};

const run = async () => {
  // const ctx = await esbuild.context(config);

  const formats = [
    { format: 'cjs' },
    // { format: 'esm', outExtension: {'.js': '.esm.mjs'}}
    // not in use yet, because utils-web imports functions from utils (cjs), which
    // will hence not be exported (`export`s need to be static).
    // reenable
  ];

  for (let overwrites of formats) {
    const ctx = await esbuild.context({...config, ...overwrites});

    if (isDevelopment) {
      await ctx.watch();
    } else {
      await ctx.rebuild();
      fs.mkdirSync(path.join(__dirname, 'dist'), {recursive: true});
      copyDeclarations(
        path.resolve(__dirname, '../common'),
        path.join(__dirname, 'dist/common')
      );
    }
  }

  if (!isDevelopment) {
    process.exit(0);
  }

  // const formats = [
  //   { format: 'cjs' },
  //   { format: 'esm', outExtension: {'.js': '.esm.mjs'}}
  // ];

  // for (let overwrites of formats) {
  //   const ctx = await esbuild.context({...config, ...overwrites});
  //   isDevelopment ? ctx.watch() : await ctx.rebuild();
  // }
  // !isDevelopment && process.exit(0);
};

run();

// in dev we also compile the test app
if (isDevelopment) {
  require('./test/esbuild.js');
}
