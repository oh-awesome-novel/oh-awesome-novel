import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
  },
  format: 'esm',
  outDir: 'dist',
  dts: true,
  sourcemap: true,
  clean: true,
  platform: 'node',
  deps: {
    neverBundle: [/^ai$/, /^yaml$/],
  },
});
