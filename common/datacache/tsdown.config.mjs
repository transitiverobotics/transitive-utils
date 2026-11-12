export default {
  entry: { index: './index.ts' },
  format: ['cjs', 'esm'],
  dts: true,
  clean: true,
  outDir: 'dist',
  target: 'node18',
};
