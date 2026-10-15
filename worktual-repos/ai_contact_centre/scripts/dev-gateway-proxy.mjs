/**
 * Local dev reverse proxy for a single ngrok gateway URL.
 * Routes social-service paths to :3004; everything else (incl. WebSocket) to :3002.
 */
import http from "node:http";

const PROXY_PORT = Number.parseInt(process.env.GATEWAY_PROXY_PORT ?? "8080", 10);
const CHAT_PORT = Number.parseInt(process.env.CHAT_SERVICE_PORT ?? "3002", 10);
const SOCIAL_PORT = Number.parseInt(process.env.SOCIAL_SERVICE_PORT ?? "3004", 10);

/** @param {string | undefined} url */
function socialPortFor(url) {
  if (!url) return CHAT_PORT;
  const path = url.split("?")[0] ?? url;
  if (
    path.startsWith("/social-api/") ||
    path.startsWith("/webhooks/") ||
    path.startsWith("/internal/v1/whatsapp/") ||
    path.startsWith("/internal/v1/facebook/") ||
    path.startsWith("/internal/v1/instagram/")
  ) {
    return SOCIAL_PORT;
  }
  return CHAT_PORT;
}

/** @param {import("node:http").IncomingMessage} req */
function targetPort(req) {
  return socialPortFor(req.url);
}

const server = http.createServer((req, res) => {
  const port = targetPort(req);
  const proxyReq = http.request(
    {
      hostname: "127.0.0.1",
      port,
      path: req.url,
      method: req.method,
      headers: req.headers,
    },
    (proxyRes) => {
      res.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers);
      proxyRes.pipe(res);
    },
  );
  proxyReq.on("error", (error) => {
    if (!res.headersSent) {
      res.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
    }
    res.end(`Bad Gateway (${port}): ${error.message}`);
  });
  req.pipe(proxyReq);
});

server.on("upgrade", (req, socket, head) => {
  const port = socialPortFor(req.url);
  const headers = { ...req.headers, host: `127.0.0.1:${port}` };

  const proxyReq = http.request({
    hostname: "127.0.0.1",
    port,
    path: req.url,
    method: req.method,
    headers,
  });

  proxyReq.on("upgrade", (proxyRes, proxySocket, proxyHead) => {
    const responseHeaders = Object.entries(proxyRes.headers).flatMap(([key, value]) => {
      if (value === undefined) return [];
      return Array.isArray(value)
        ? value.map((entry) => `${key}: ${entry}`)
        : [`${key}: ${value}`];
    });
    socket.write(
      `HTTP/1.1 ${proxyRes.statusCode ?? 101} ${proxyRes.statusMessage ?? "Switching Protocols"}\r\n${responseHeaders.join("\r\n")}\r\n\r\n`,
    );
    if (proxyHead.length > 0) proxySocket.unshift(proxyHead);
    if (head.length > 0) socket.unshift(head);
    proxySocket.pipe(socket).pipe(proxySocket);
  });

  proxyReq.on("response", (proxyRes) => {
    if (proxyRes.statusCode === 101) return;
    const responseHeaders = Object.entries(proxyRes.headers).flatMap(([key, value]) => {
      if (value === undefined) return [];
      return Array.isArray(value)
        ? value.map((entry) => `${key}: ${entry}`)
        : [`${key}: ${value}`];
    });
    socket.write(
      `HTTP/1.1 ${proxyRes.statusCode ?? 502} ${proxyRes.statusMessage ?? "Error"}\r\n${responseHeaders.join("\r\n")}\r\n\r\n`,
    );
    proxyRes.pipe(socket);
  });

  proxyReq.on("error", () => socket.destroy());
  socket.on("error", () => proxyReq.destroy());
  proxyReq.end();
});

server.listen(PROXY_PORT, "127.0.0.1", () => {
  console.log(
    `[dev-gateway-proxy] listening on http://127.0.0.1:${PROXY_PORT} (chat:${CHAT_PORT}, social:${SOCIAL_PORT})`,
  );
});
