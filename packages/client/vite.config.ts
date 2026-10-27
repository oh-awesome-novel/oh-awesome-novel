import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: {
    entry: {
      index: "src/index.ts",
    },
    format: "esm",
    outDir: "dist",
    dts: true,
    sourcemap: true,
    clean: true,
    platform: "browser",
    deps: {
      neverBundle: [/^ai$/],
    },
    outExtensions: () => ({
      js: ".mjs",
      dts: ".d.mts",
    }),
  },
});
