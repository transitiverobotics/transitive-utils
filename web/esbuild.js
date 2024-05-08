const esbuild = require('esbuild');
const fs = require('fs');

const isDevelopment = (process.env.npm_lifecycle_event != 'prepare');

const config = {
  entryPoints: [{in: './index.js', out: 'utils-web'}],
  bundle: true,
  format: 'cjs',
  preserveSymlinks: true, // this allows us to use symlinks
  minify: !isDevelopment,
  sourcemap: isDevelopment,
  // minify: true,
  // sourcemap: false,
  target: ['chrome110', 'firefox110', 'safari15', 'edge110'],
  // target: ['es2022'],
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
          console.log(new Date(),
            `build ended with ${result.errors.length} errors`);
        })
      },
    }
  ],
};

const run = async () => {
  const ctx = await esbuild.context(config);
  if (isDevelopment) {
    await ctx.watch();
  } else {
    await ctx.rebuild();
    process.exit(0);
  }
};

run();

// in dev we also compile the test app
if (isDevelopment) {
  require('./test/esbuild.js');
}
