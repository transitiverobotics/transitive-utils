const esbuild = require('esbuild');
const startServer = require('./server.js');
const { spawn, execSync } = require('child_process');

const log = (...args) => console.log('[serve]', ...args);

const serve = async () => {

  // start build of mock capability
  spawn('npx', ['transitiveDev', 'web'], {
    cwd: 'test/static/running/@transitive-robotics/mock',
    stdio: 'inherit'
  });
  log('Started build of mock capability');

  const ctx = await esbuild.context({
    entryPoints: ['test/web/index.jsx'],
    outdir: 'test/dist',
    bundle: true,
    // plugins: [{
    //   name: 'copy-static',
    //   setup(build) {
    //     build.onEnd(result => {

    //       execSync('cp test/*.html css/* test-dist')
    //       log('copied html + css');
    //       execSync('ln -sf test/running/. test-dist/running')
    //       log('copied mock');
    //     })
    //   },
    // }],
   });

  await ctx.watch();

  startServer();
};

serve();
