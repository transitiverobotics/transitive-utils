const esbuild = require('esbuild');
const fs = require('fs');
const { execSync } = require('child_process');

const { getPackageVersionNamespace } = require('@transitive-sdk/utils');

if (!process.env.npm_package_version || !process.env.npm_package_name) {
  console.error('This build script must be run from npm.');
  process.exit(1);
}

const entryPoints = fs.readdirSync('./web', {withFileTypes: true})
    .filter(item => !item.isDirectory())
    .filter(item => !item.isSymbolicLink())
    .filter(({name}) => name.search('test.js') == -1)
    .map(({name}) => `./web/${name}`);

const isDevelopment = (process.env.npm_lifecycle_event != 'prepare');

const config = {
  entryPoints,
  metafile: true, // for bundle analyser
  bundle: true,
  preserveSymlinks: true, // this allows us to use symlinks to ../shared
  minify: !isDevelopment,
  sourcemap: isDevelopment,
  outdir: 'dist',
  target: ['es2022'],
  format: 'iife', // will be overwritten, see `formats` below
  // splitting: true,
  // external: ['react', 'react-dom'],
  define: {
    TR_PKG_VERSION: JSON.stringify(process.env.npm_package_version),
    TR_PKG_NAME: JSON.stringify(process.env.npm_package_name),
    TR_PKG_VERSION_NS: JSON.stringify(getPackageVersionNamespace()),
  },
  loader: {
    '.svg': 'text',
    '.wasm': 'file',
    // '.css': 'local-css',
  },
  plugins: [{
    name: 'rebuild-notify',
    setup(build) {
      build.onEnd(result => {
        console.log(new Date(), build.initialOptions.format,
          `build ended with ${result.errors.length} errors`);

        const dir = `/tmp/caps/${process.env.npm_package_name}`;
        isDevelopment &&
          execSync(`mkdir -p ${dir} && cp -r package.json dist ${dir}`);

        const metaName = [process.env.npm_package_name.replace(/\//, '-'),
            isDevelopment ? 'dev' : 'prod'
          ].join('.');
        fs.writeFileSync(`/tmp/${metaName}.meta.json`,
          JSON.stringify(result.metafile));
      })
    },
  }],
};


const run = async () => {

  // define multiple config overwrites, for multiple outputs
  const formats = [
    { format: 'iife' },
    { format: 'esm', outExtension: {'.js': '.esm.js'}}
  ];

  for (let overwrites of formats) {
    const ctx = await esbuild.context({...config, ...overwrites});
    isDevelopment ? ctx.watch() : await ctx.rebuild();
  }

  !isDevelopment && process.exit(0);
};

run();