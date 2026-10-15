/**
 * Expose the web push demo on a public HTTPS URL (ngrok).
 * Testers open the link — no cert import, nothing to run on their PC.
 *
 * Prereqs: npm run dev:backend && npm run dev:webpush (HTTP tunnel port 5501)
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tunnelUrlFile = path.join(__dirname, ".tunnel-url");

const TUNNEL_PORT = Number(process.env.WEBPUSH_TUNNEL_PORT || 5501);
const NGROK_BIN = process.env.NGROK_BIN || "ngrok";

function waitForPort(port, host = "127.0.0.1", timeoutMs = 15000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      const sock = net.connect({ port, host }, () => {
        sock.end();
        resolve(undefined);
      });
      sock.on("error", () => {
        if (Date.now() - started > timeoutMs) {
          reject(new Error(`Nothing listening on http://${host}:${port}. Run: npm run dev:webpush`));
          return;
        }
        setTimeout(tick, 400);
      });
    };
    tick();
  });
}

function fetchNgrokHttpsUrl(timeoutMs = 30000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const poll = () => {
      http
        .get("http://127.0.0.1:4040/api/tunnels", (res) => {
          let body = "";
          res.on("data", (c) => {
            body += c;
          });
          res.on("end", () => {
            try {
              const json = JSON.parse(body);
              const tunnels = json.tunnels || [];
              const httpsTunnel = tunnels.find((t) =>
                String(t.public_url || "").startsWith("https://"),
              );
              if (httpsTunnel?.public_url) {
                resolve(httpsTunnel.public_url);
                return;
              }
            } catch {
              /* retry */
            }
            if (Date.now() - started > timeoutMs) {
              reject(new Error("Timed out waiting for ngrok public URL."));
              return;
            }
            setTimeout(poll, 500);
          });
        })
        .on("error", () => {
          if (Date.now() - started > timeoutMs) {
            reject(new Error("Timed out waiting for ngrok API on :4040."));
            return;
          }
          setTimeout(poll, 500);
        });
    };
    setTimeout(poll, 800);
  });
}

await waitForPort(TUNNEL_PORT);

console.log(`Starting ngrok → http://127.0.0.1:${TUNNEL_PORT}`);

const ngrok = spawn(NGROK_BIN, ["http", String(TUNNEL_PORT), "--log=stdout"], {
  stdio: ["ignore", "pipe", "pipe"],
});

ngrok.stdout.on("data", (chunk) => process.stdout.write(chunk));
ngrok.stderr.on("data", (chunk) => process.stderr.write(chunk));

ngrok.on("exit", (code) => process.exit(code ?? 1));

try {
  const url = await fetchNgrokHttpsUrl();
  fs.writeFileSync(tunnelUrlFile, `${url}\n`, "utf8");
  console.log("\n========================================");
  console.log("Share with testers (any device, no setup):");
  console.log(url);
  console.log("========================================");
  console.log("Do NOT share https://192.168.x.x:5500 — use the link above.");
  console.log("Keep this terminal open. Also run: npm run dev:backend\n");
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
}

process.on("SIGINT", () => {
  try {
    fs.unlinkSync(tunnelUrlFile);
  } catch {
    /* ignore */
  }
  ngrok.kill("SIGTERM");
  process.exit(0);
});

process.on("exit", () => {
  try {
    fs.unlinkSync(tunnelUrlFile);
  } catch {
    /* ignore */
  }
});
