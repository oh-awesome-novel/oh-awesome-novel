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
    platform: "node",
    deps: {
      neverBundle: [/^@electron-forge\//, /^listr2$/, /^tsdown$/],
    },
    outExtensions: () => ({
      js: ".js",
      dts: ".d.ts",
    }),
  },
});
