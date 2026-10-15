/**
 * Start web push demo + ngrok tunnel together.
 * Run with: npm run dev:backend (separate terminal), then npm run dev:webpush:share
 */
import { spawn } from "node:child_process";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TUNNEL_PORT = Number(process.env.WEBPUSH_TUNNEL_PORT || 5501);

function waitForPort(port, host = "127.0.0.1", timeoutMs = 20000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      const sock = net.connect({ port, host }, () => {
        sock.end();
        resolve(undefined);
      });
      sock.on("error", () => {
        if (Date.now() - started > timeoutMs) {
          reject(new Error(`Port ${port} not ready`));
          return;
        }
        setTimeout(tick, 300);
      });
    };
    tick();
  });
}

const webpush = spawn("node", [path.join(__dirname, "https-dev-server.mjs")], {
  stdio: "inherit",
});

webpush.on("exit", (code) => process.exit(code ?? 1));

await waitForPort(TUNNEL_PORT);

const tunnel = spawn("node", [path.join(__dirname, "tunnel.mjs")], {
  stdio: "inherit",
});

tunnel.on("exit", (code) => {
  webpush.kill("SIGTERM");
  process.exit(code ?? 1);
});

function shutdown() {
  tunnel.kill("SIGTERM");
  webpush.kill("SIGTERM");
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
