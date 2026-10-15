import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const apiProxy = env.VITE_API_PROXY || "http://127.0.0.1:3002";

  return {
    plugins: [react()],
    server: {
      host: true,
      port: 5173,
      proxy: {
        "/api": {
          target: apiProxy,
          changeOrigin: true,
        },
      },
    },
    preview: {
      host: true,
      port: 5173,
      proxy: {
        "/api": {
          target: apiProxy,
          changeOrigin: true,
        },
      },
    },
  };
});
