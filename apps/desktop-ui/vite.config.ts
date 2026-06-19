import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";
import vue from "@vitejs/plugin-vue";
import { fileURLToPath, URL } from "node:url";

const backendProxyTarget =
  process.env.VITE_OAN_BACKEND_PROXY_TARGET ??
  `http://${process.env.OAN_HTTP_HOST ?? "127.0.0.1"}:${process.env.OAN_HTTP_PORT ?? "3210"}`;

// https://vite.dev/config/
export default defineConfig({
  base: "./",
  plugins: [tailwindcss(), vue()],
  resolve: {
    alias: {
      "@oh-awesome-novel/client": fileURLToPath(
        new URL("../../packages/client/src/index.ts", import.meta.url),
      ),
    },
  },
  server: {
    proxy: {
      "/api": {
        target: backendProxyTarget,
        changeOrigin: true,
      },
    },
  },
});
