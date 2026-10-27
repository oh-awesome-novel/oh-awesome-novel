import { defineConfig } from "vite-plus";

export default defineConfig({
  fmt: {},
  lint: {
    jsPlugins: [{ name: "vite-plus", specifier: "vite-plus/oxlint-plugin" }],
    rules: { "vite-plus/prefer-vite-plus-imports": "error" },
    // Keep the existing tsc/vue-tsc production and renderer checks in npm run typecheck.
    options: { typeAware: true, typeCheck: false },
  },
});
