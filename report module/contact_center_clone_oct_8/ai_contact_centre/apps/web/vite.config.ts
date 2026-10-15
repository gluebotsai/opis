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
  },
  optimizeDeps: {
    include: ["jssip"],
  },
});
