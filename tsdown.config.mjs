export default {
  entry: {
    index: './index.ts',
  },
  format: ['cjs', 'esm'],
  dts: false,
  clean: true,
  outDir: 'dist',
  fixedExtension: true,
  target: 'node18',
};
