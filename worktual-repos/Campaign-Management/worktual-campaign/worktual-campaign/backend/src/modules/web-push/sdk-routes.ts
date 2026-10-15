import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";
import { env } from "../../config/env.js";
import { SERVICE_PATH } from "../../helpers/constants.js";

const dir = dirname(fileURLToPath(import.meta.url));

/** Public SDK base path (under API prefix so edge nginx /api proxy works). */
export function publicWebPushSdkBasePath(): string {
  const api = SERVICE_PATH.replace(/\/$/, "") || "/api";
  return `${api}/sdk`;
}

function sdkFile(name: string): string {
  return readFileSync(join(dir, "sdk", name), "utf8");
}

function publicOrigin(): string {
  return env.apiPublicUrl.replace(/\/$/, "");
}

export default async function webPushSdkRoutes(server: FastifyInstance) {
  server.get("/web-push.js", async (_request, reply) => {
    return reply
      .type("application/javascript; charset=utf-8")
      .header("Cache-Control", "public, max-age=300")
      .header("Access-Control-Allow-Origin", "*")
      .send(sdkFile("web-push.js"));
  });

  server.get("/web-push-sw.js", async (_request, reply) => {
    return reply
      .type("application/javascript; charset=utf-8")
      .header("Cache-Control", "public, max-age=300")
      .header("Access-Control-Allow-Origin", "*")
      .header("Service-Worker-Allowed", "/")
      .send(sdkFile("web-push-sw.js"));
  });

  /** Tiny file customers copy to their site root as /worktual-web-push-sw.js */
  server.get("/worktual-web-push-sw.js", async (_request, reply) => {
    const importUrl = `${publicOrigin()}${publicWebPushSdkBasePath()}/web-push-sw.js`;
    const body = `importScripts(${JSON.stringify(importUrl)});\n`;
    return reply
      .type("application/javascript; charset=utf-8")
      .header("Cache-Control", "public, max-age=120")
      .header("Access-Control-Allow-Origin", "*")
      .send(body);
  });
}
