export default {
  entry: { 'utils-web': './index.ts' },
  format: ['cjs', 'esm'],
  dts: true,
  clean: true,
  outDir: 'dist',
  fixedExtension: true,
  platform: 'browser',
  target: ['chrome110', 'firefox110', 'safari15', 'edge110'],
  sourcemap: true,
  minify: false,
  deps: { neverBundle: true, onlyBundle: false },
};
