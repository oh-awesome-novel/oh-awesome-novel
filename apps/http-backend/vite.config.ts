import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: {
    entry: {
      index: "src/index.ts",
    },
    format: "esm",
    outDir: "dist",
    dts: false,
    sourcemap: true,
    clean: true,
    platform: "node",
    deps: {
      neverBundle: [/^@oh-awesome-novel\//],
    },
  },
});
