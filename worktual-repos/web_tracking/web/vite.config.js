import path from 'path';
import { fileURLToPath } from 'url';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, repoRoot, '');
  const port = parseInt(env.WEB_PORT || '7862', 10);
  const host = env.SERVICE_HOST || '0.0.0.0';
  const apiPort = parseInt(env.API_PORT || '7861', 10);
  const chatPort = parseInt(env.AI_CHAT_PORT || '7863', 10);
  const apiTarget = `http://127.0.0.1:${apiPort}`;
  const chatTarget = `http://127.0.0.1:${chatPort}`;
  const allowedHosts = env.VITE_ALLOWED_HOSTS
    ? env.VITE_ALLOWED_HOSTS.split(',').map((h) => h.trim()).filter(Boolean)
    : ['qatracking.worktual.com', 'backend_qatracking', '.worktual.com'];

  return {
    envDir: repoRoot,
    plugins: [react()],
    server: {
      host,
      port,
      allowedHosts,
      // When VITE_API_URL is unset, the dashboard calls same-origin /api/* and Vite proxies to the Node API.
      proxy: {
        '/api': {
          target: apiTarget,
          changeOrigin: true,
          timeout: 0,
          proxyTimeout: 0,
          configure: (proxy) => {
            proxy.on('proxyReq', (proxyReq, req) => {
              if (String(req.url || '').includes('/live/stream')) {
                proxyReq.setHeader('Accept', 'text/event-stream');
                proxyReq.setHeader('Cache-Control', 'no-cache');
              }
            });
          },
        },
        '/health': { target: apiTarget, changeOrigin: true },
        '/docs': { target: apiTarget, changeOrigin: true },
        // Co-worker chat WebSocket — same origin as dashboard (nginx → Vite → AI_CHAT)
        '/chat': {
          target: chatTarget,
          changeOrigin: true,
          ws: true,
          rewrite: (path) => path.replace(/^\/chat/, ''),
        },
      },
    },
    preview: {
      host,
      port,
      allowedHosts,
      proxy: {
        '/api': {
          target: apiTarget,
          changeOrigin: true,
          timeout: 0,
          proxyTimeout: 0,
        },
        '/health': { target: apiTarget, changeOrigin: true },
        '/docs': { target: apiTarget, changeOrigin: true },
        '/chat': {
          target: chatTarget,
          changeOrigin: true,
          ws: true,
          rewrite: (path) => path.replace(/^\/chat/, ''),
        },
      },
    },
  };
});
