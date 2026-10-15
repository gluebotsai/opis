import fs from "node:fs";
import path from "node:path";

import type { FastifyInstance } from "fastify";

import { workspaceRoot } from "../config/runtime-paths.js";

const CONTENT_TYPES: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".gif": "image/gif",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

function resolveSafeFile(root: string, requestPath: string): string | null {
  const decoded = decodeURIComponent((requestPath || "/").split("?")[0] || "/");
  const relative = decoded === "/" ? "index.html" : decoded.replace(/^\/+/, "");
  const rootResolved = path.resolve(root);
  const absolute = path.resolve(root, relative);
  if (absolute !== rootResolved && !absolute.startsWith(rootResolved + path.sep)) {
    return null;
  }
  return absolute;
}

/**
 * Serve the Vite SPA from workspace-root/dist when SERVE_FRONTEND is enabled.
 * Deploy copies frontend/dist → dist/ and writes deploy-meta.json there.
 */
export async function registerSpaStatic(app: FastifyInstance): Promise<void> {
  if (process.env.SERVE_FRONTEND === "false") {
    return;
  }

  const distDir = path.join(workspaceRoot, "dist");
  const indexPath = path.join(distDir, "index.html");
  if (!fs.existsSync(indexPath)) {
    app.log.warn(`SPA dist missing at ${distDir} — API-only mode`);
    return;
  }

  app.log.info(`Serving frontend from ${distDir}`);

  app.setNotFoundHandler(async (request, reply) => {
    if (
      (request.method !== "GET" && request.method !== "HEAD") ||
      (request.url || "").startsWith("/api")
    ) {
      return reply.code(404).send({ error: "Not found." });
    }

    const candidate = resolveSafeFile(distDir, request.url || "/");
    if (candidate && fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      const ext = path.extname(candidate).toLowerCase();
      reply.type(CONTENT_TYPES[ext] || "application/octet-stream");
      if (ext === ".html" || path.basename(candidate) === "deploy-meta.json") {
        reply.header("Cache-Control", "no-store, no-cache, must-revalidate");
      } else {
        reply.header("Cache-Control", "public, max-age=31536000, immutable");
      }
      return reply.send(fs.readFileSync(candidate));
    }

    const pathname = (request.url || "/").split("?")[0] || "/";
    if (path.extname(pathname) === "") {
      reply.type("text/html; charset=utf-8");
      reply.header("Cache-Control", "no-store, no-cache, must-revalidate");
      return reply.send(fs.readFileSync(indexPath));
    }

    return reply.code(404).send({ error: "Not found." });
  });
}
