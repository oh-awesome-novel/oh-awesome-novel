import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";
import vue from "@vitejs/plugin-vue";

const backendProxyTarget =
  process.env.VITE_OAN_BACKEND_PROXY_TARGET ??
  `http://${process.env.OAN_HTTP_HOST ?? "127.0.0.1"}:${process.env.OAN_HTTP_PORT ?? "3210"}`;

// https://vite.dev/config/
export default defineConfig({
  base: "./",
  plugins: [tailwindcss(), vue()],
  server: {
    proxy: {
      "/api": {
        target: backendProxyTarget,
        changeOrigin: true,
      },
    },
  },
});
