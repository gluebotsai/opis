/**
 * HTTPS static server + /api proxy → backend :3001
 * Uses mkcert certs when present (npm run webpush:trust).
 */
import { execFileSync, execSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.WEBPUSH_PORT || 5500);
const TUNNEL_PORT = Number(process.env.WEBPUSH_TUNNEL_PORT || 5501);
const HOST = process.env.WEBPUSH_HOST || "0.0.0.0";
const API_ORIGIN = process.env.CAMPAIGN_API_ORIGIN || "http://127.0.0.1:3001";

const certDir = path.join(__dirname, ".certs");
const tunnelUrlFile = path.join(__dirname, ".tunnel-url");
const keyPath = path.join(certDir, "key.pem");
const certPath = path.join(certDir, "cert.pem");
const mkcertMarker = path.join(certDir, ".mkcert");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

function mkcertBin() {
  const local = path.join(os.homedir(), ".local", "bin", "mkcert");
  if (fs.existsSync(local)) return local;
  try {
    execSync("mkcert -version", { stdio: "ignore" });
    return "mkcert";
  } catch {
    return null;
  }
}

function ensureOpenSslCerts() {
  fs.mkdirSync(certDir, { recursive: true });
  const san = "IP:127.0.0.1,IP:192.168.11.31,DNS:localhost";
  execSync(
    `openssl req -x509 -newkey rsa:2048 -nodes -keyout "${keyPath}" -out "${certPath}" -days 825 -subj "/CN=localhost" -addext "subjectAltName=${san}"`,
    { stdio: "inherit" },
  );
}

function ensureCerts() {
  if (fs.existsSync(keyPath) && fs.existsSync(certPath)) return;
  const bin = mkcertBin();
  if (bin) {
    fs.mkdirSync(certDir, { recursive: true });
    execFileSync(
      bin,
      ["-key-file", keyPath, "-cert-file", certPath, "localhost", "127.0.0.1", "192.168.11.31"],
      { stdio: "inherit" },
    );
    fs.writeFileSync(mkcertMarker, `${new Date().toISOString()}\n`);
    return;
  }
  ensureOpenSslCerts();
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

async function proxyToBackend(req, res) {
  const targetPath = req.url || "/";
  const body =
    req.method === "GET" || req.method === "HEAD" ? undefined : await readBody(req);
  const headers = { ...req.headers, host: "127.0.0.1:3001" };
  delete headers.connection;

  const upstream = http.request(
    `${API_ORIGIN}${targetPath}`,
    { method: req.method, headers },
    (upRes) => {
      res.writeHead(upRes.statusCode || 502, upRes.headers);
      upRes.pipe(res);
    },
  );
  upstream.on("error", () => {
    res.writeHead(502, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        message:
          "Cannot reach Campaign API on :3001. Start the backend (npm run dev:backend), then retry.",
      }),
    );
  });
  if (body?.length) upstream.write(body);
  upstream.end();
}

function serveFile(req, res) {
  let rel = decodeURIComponent((req.url || "/").split("?")[0]);
  if (rel === "/") rel = "/index.html";
  const filePath = path.normalize(path.join(__dirname, rel));
  if (!filePath.startsWith(__dirname)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    res.writeHead(404);
    res.end("Not found");
    return;
  }
  const ext = path.extname(filePath).toLowerCase();
  res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
  fs.createReadStream(filePath).pipe(res);
}

async function handler(req, res) {
  const urlPath = (req.url || "").split("?")[0];
  if (urlPath === "/share-url.json") {
    let shareUrl = "";
    try {
      if (fs.existsSync(tunnelUrlFile)) {
        shareUrl = fs.readFileSync(tunnelUrlFile, "utf8").trim();
      }
    } catch {
      /* ignore */
    }
    res.writeHead(200, {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    });
    res.end(JSON.stringify({ share_url: shareUrl || null }));
    return;
  }
  if ((req.url || "").startsWith("/api/")) {
    await proxyToBackend(req, res);
    return;
  }
  serveFile(req, res);
}

ensureCerts();
const key = fs.readFileSync(keyPath);
const cert = fs.readFileSync(certPath);
const trusted = fs.existsSync(mkcertMarker);

https.createServer({ key, cert }, (req, res) => {
  void handler(req, res);
}).listen(PORT, HOST, () => {
  console.log(`Web push demo (HTTPS): https://localhost:${PORT}/`);
  console.log(`LAN: https://192.168.11.31:${PORT}/`);
  if (trusted) {
    console.log("Using mkcert certificates (trusted after npm run webpush:trust).");
  } else {
    console.log("Using self-signed OpenSSL cert — run: npm run webpush:trust");
  }
  console.log(`API proxy → ${API_ORIGIN}/api`);
});

http.createServer((req, res) => {
  void handler(req, res);
}).listen(TUNNEL_PORT, "127.0.0.1", () => {
  console.log(`Tunnel target (HTTP): http://127.0.0.1:${TUNNEL_PORT}/ → npm run dev:webpush:tunnel`);
});
