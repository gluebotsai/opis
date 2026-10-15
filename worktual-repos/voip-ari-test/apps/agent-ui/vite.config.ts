import { defineConfig, loadEnv, type PluginOption } from 'vite';
import react from '@vitejs/plugin-react';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Self-signed certs so HTTPS works without @vitejs/plugin-basic-ssl (openssl only). */
function loadHttpsOptions(): { key: Buffer; cert: Buffer } | undefined {
  const dir = path.join(__dirname, '.certs');
  const keyPath = path.join(dir, 'dev-key.pem');
  const certPath = path.join(dir, 'dev-cert.pem');

  if (!fs.existsSync(keyPath) || !fs.existsSync(certPath)) {
    fs.mkdirSync(dir, { recursive: true });
    try {
      execSync(
        `openssl req -x509 -newkey rsa:2048 -nodes ` +
          `-keyout "${keyPath}" -out "${certPath}" -days 825 ` +
          `-subj "/CN=localhost" ` +
          `-addext "subjectAltName=DNS:localhost,IP:127.0.0.1"`,
        { stdio: 'ignore' },
      );
    } catch {
      // Older openssl without -addext
      execSync(
        `openssl req -x509 -newkey rsa:2048 -nodes ` +
          `-keyout "${keyPath}" -out "${certPath}" -days 825 ` +
          `-subj "/CN=localhost"`,
        { stdio: 'ignore' },
      );
    }
  }

  return {
    key: fs.readFileSync(keyPath),
    cert: fs.readFileSync(certPath),
  };
}

/**
 * Serve agent-ui over HTTPS so browsers allow getUserMedia (mic).
 * Proxy API + Asterisk WS to same origin to avoid mixed-content blocks.
 */
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  // On the Asterisk host, prefer localhost. Override via .env when developing remotely.
  const apiTarget = env.VITE_PROXY_API || 'http://127.0.0.1:3000';
  const ariWsTarget = env.VITE_PROXY_ARI_WS || 'ws://127.0.0.1:8088';
  const https = loadHttpsOptions();

  const plugins: PluginOption[] = [react()];

  return {
    plugins,
    server: {
      port: 5174,
      host: true,
      https,
      proxy: {
        '/api': {
          target: apiTarget,
          changeOrigin: true,
        },
        '/socket.io': {
          target: apiTarget,
          changeOrigin: true,
          ws: true,
        },
        // Browser → wss://HOST:5174/asterisk-ws → Asterisk /ws
        '/asterisk-ws': {
          target: ariWsTarget,
          changeOrigin: true,
          ws: true,
          rewrite: (p) => p.replace(/^\/asterisk-ws/, '/ws'),
        },
      },
    },
  };
});
