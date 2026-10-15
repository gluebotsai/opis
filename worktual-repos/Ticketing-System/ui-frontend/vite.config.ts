import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { fileURLToPath } from 'url';
import { defineConfig, loadEnv } from 'vite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, path.resolve(__dirname, '..'), '');
  const apiTarget =
    env.TICKETING_API_URL ||
    env.VITE_TICKETING_API_URL ||
    'http://127.0.0.1:3001';

  return {
    root: __dirname,
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // 0.0.0.0 = reachable on LAN (e.g. http://192.168.x.x:5173). Override with VITE_DEV_HOST=127.0.0.1 for local-only.
      host: process.env.VITE_DEV_HOST || '0.0.0.0',
      port: 5173,
      strictPort: true,
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
      headers: {
        'Content-Security-Policy':
          process.env.TICKETING_FRAME_ANCESTORS || "frame-ancestors 'self' *",
      },
      proxy: {
        '/api': {
          target: apiTarget,
          changeOrigin: true,
          configure: (proxy) => {
            // So Express can set non-Secure cookies for LAN http://IP:5173 logins
            // even when APP_URL is https://… (Secure cookies are dropped on HTTP).
            proxy.on('proxyReq', (proxyReq, req) => {
              const host = req.headers.host;
              if (host) proxyReq.setHeader('x-forwarded-host', String(host));
              proxyReq.setHeader('x-forwarded-proto', 'http');
            });
          },
        },
        '/uploads': {
          target: apiTarget,
          changeOrigin: true,
          configure: (proxy) => {
            proxy.on('proxyReq', (proxyReq, req) => {
              const host = req.headers.host;
              if (host) proxyReq.setHeader('x-forwarded-host', String(host));
              proxyReq.setHeader('x-forwarded-proto', 'http');
            });
          },
        },
      },
    },
  };
});
