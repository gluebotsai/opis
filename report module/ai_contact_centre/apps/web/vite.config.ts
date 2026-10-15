import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

export default defineConfig({
  plugins: [
    react({
      // babel: {
      //   plugins: [
      //     [
      //       "@locator/babel-jsx/dist",
      //       {
      //         env: "development",
      //       },
      //     ],
      //   ],
      // },
    }),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    host: true,
    port: 5173,
    allowedHosts: ["emporium-alive-baboon.ngrok-free.dev"],
    proxy: {
      "/cc-core-api": {
        target: "http://127.0.0.1:3000",
        changeOrigin: true,
        ws: true,
      },
      "/platform-api": {
        target: "http://127.0.0.1:3001",
        changeOrigin: true,
      },
      "/nlp-api": {
        target: "http://127.0.0.1:8000",
        changeOrigin: true,
      },
      "/v1": {
        target: "http://127.0.0.1:3003",
        changeOrigin: true,
      },
    },
  },
  optimizeDeps: {
    include: ["jssip"],
  },
});
