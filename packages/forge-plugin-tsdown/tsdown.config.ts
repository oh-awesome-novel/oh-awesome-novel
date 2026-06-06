import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
  },
  format: 'cjs',
  outDir: 'dist',
  dts: true,
  sourcemap: true,
  clean: true,
  platform: 'node',
  deps: {
    neverBundle: [/^@electron-forge\//, /^listr2$/, /^tsdown$/],
  },
  outputOptions: {
    exports: 'named',
  },
  outExtensions: () => ({
    js: '.cjs',
    dts: '.d.cts',
  }),
});
