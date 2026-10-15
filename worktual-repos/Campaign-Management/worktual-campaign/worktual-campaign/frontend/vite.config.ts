import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

function parseEmbedOrigins(raw: string): string[] {
  return raw
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Mirror deploy/nginx.conf.template — changeOrigin required for Socket.IO WS upgrade. */
function rewriteAgentsOrigin(
  proxyReq: { setHeader: (name: string, value: string) => void },
) {
  // Browser Origin is the LAN URL (e.g. http://192.168.x.x:5173). Agents CORS
  // may lag behind IP changes; normalize to localhost so the Vite→agents proxy
  // always succeeds in local/LAN dev.
  proxyReq.setHeader("Origin", "http://127.0.0.1:5173");
  proxyReq.setHeader("Referer", "http://127.0.0.1:5173/");
}

function resolveApiProxyTarget(env: Record<string, string>): string {
  return (
    env.VITE_API_PROXY_TARGET?.trim() ||
    process.env.VITE_API_PROXY_TARGET?.trim() ||
    "http://127.0.0.1:3001"
  );
}

function buildDevProxy(apiTarget: string) {
  return {
    "/api": {
      target: apiTarget,
      changeOrigin: true,
    },
    "/socket-io": {
      target: "http://127.0.0.1:3002",
      changeOrigin: true,
      ws: true,
      secure: false,
    },
    "/agents-socket": {
      // Match agents AGENTS_PORT (dev-lan.sh starts :8005).
      target: "http://127.0.0.1:8005",
      changeOrigin: true,
      ws: true,
      secure: false,
      rewrite: (path: string) => path.replace(/^\/agents-socket/, "/socket-io"),
      configure: (proxy: {
        on: (event: string, fn: (...args: unknown[]) => void) => void;
      }) => {
        proxy.on("proxyReq", (proxyReq: unknown) => {
          rewriteAgentsOrigin(
            proxyReq as { setHeader: (name: string, value: string) => void },
          );
        });
        proxy.on("proxyReqWs", (proxyReq: unknown) => {
          rewriteAgentsOrigin(
            proxyReq as { setHeader: (name: string, value: string) => void },
          );
        });
      },
    },
    "/docs": {
      target: apiTarget,
      changeOrigin: true,
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, __dirname, "");
  const apiTarget = resolveApiProxyTarget(env);
  const publicProxy = buildDevProxy(apiTarget);
  const isPublicSite = mode === "public";
  const crmEmbedOrigins =
    env.VITE_CRM_EMBED_ORIGINS?.trim() ||
    "http://localhost:5173 http://127.0.0.1:5173";
  const frameAncestors = ["'self'", ...parseEmbedOrigins(crmEmbedOrigins)].join(
    " ",
  );

  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
    server: {
      host: "0.0.0.0",
      port: isPublicSite ? 4173 : 5173,
      // LAN access via http://<ip>:5173 (not only localhost)
      allowedHosts: true,
      headers: {
        "Content-Security-Policy": `frame-ancestors ${frameAncestors}`,
      },
      proxy: isPublicSite ? publicProxy : { ...publicProxy },
    },
    preview: {
      host: "0.0.0.0",
      port: 4173,
      headers: {
        "Content-Security-Policy": `frame-ancestors ${frameAncestors}`,
      },
      proxy: publicProxy,
    },
  };
});
