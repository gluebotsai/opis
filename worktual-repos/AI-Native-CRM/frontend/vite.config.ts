import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, path.resolve(__dirname, ".."), "");
  const campaignProxyTarget =
    env.CAMPAIGN_PROXY_TARGET?.trim() || "http://192.168.11.31:5173";
  const meetingServiceTarget =
    env.MEETING_SERVICE_URL?.trim() || "http://127.0.0.1:8030";

  return {
  plugins: [
    react({
      babel: {
        plugins: [
          [
            "@locator/babel-jsx/dist",
            {
              env: "development",
            },
          ],
        ],
      },
    }),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  server: {
    host: true,
    port: 5173,
    // Meet add-on / ngrok tunnels send Host: *.ngrok-free.dev
    allowedHosts: true,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:4000",
        changeOrigin: true,
        ws: true,
        timeout: 120_000,
        proxyTimeout: 120_000,
        // Meeting Assist SSE — avoid proxy buffering where possible
        configure: (proxy) => {
          proxy.on("proxyRes", (proxyRes, req) => {
            if (String(req.url || "").includes("/events")) {
              proxyRes.headers["cache-control"] = "no-cache, no-transform";
              proxyRes.headers["x-accel-buffering"] = "no";
            }
          });
        },
      },
      "/socket-io": {
        target: "http://127.0.0.1:4000",
        changeOrigin: true,
        ws: true,
      },
      "/health": {
        target: "http://127.0.0.1:4000",
        changeOrigin: true,
      },
      // Path B Meet add-on (meeting-service). Same origin as the SPA, like production nginx.
      "/addons/meet": {
        target: meetingServiceTarget,
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on("proxyRes", (proxyRes) => {
            delete proxyRes.headers["x-frame-options"];
          });
        },
      },
      "/v1/assist": {
        target: meetingServiceTarget,
        changeOrigin: true,
      },
      "/v1/meetings": {
        target: meetingServiceTarget,
        changeOrigin: true,
      },
      // Campaign UI embed — strips frame-blocking headers for LAN lab only.
      // Do NOT point CAMPAIGN_UI_URL here; iframe must load Campaign host directly
      // (Campaign Vite uses absolute /src asset paths).
      "/campaign-proxy": {
        target: campaignProxyTarget,
        changeOrigin: true,
        ws: true,
        rewrite: (p) => p.replace(/^\/campaign-proxy/, "") || "/",
        configure: (proxy) => {
          proxy.on("proxyRes", (proxyRes) => {
            delete proxyRes.headers["content-security-policy"];
            delete proxyRes.headers["x-frame-options"];
          });
        },
      },
    },
  },
  };
});
