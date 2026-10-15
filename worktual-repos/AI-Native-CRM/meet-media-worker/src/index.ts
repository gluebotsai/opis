/**
 * Worktual Meet Media worker
 *
 * Production path for customer-only live Assist on Google Meet:
 *   Meet Media API (WebRTC) → filter host/sales audio → Worktual STT
 *   → POST /api/webhooks/google-meet/transcript
 *
 * Requires Google Workspace Developer Preview enrollment for Meet Media API.
 * See README.md.
 */

import { createServer } from "node:http";
import { startMediaJob, stopMediaJob, getMediaJob } from "./jobs.js";
import type { StartJobBody } from "./types.js";

const port = Number(process.env.MEET_MEDIA_WORKER_PORT || 4010);
const host = process.env.MEET_MEDIA_WORKER_HOST || "0.0.0.0";
const controlSecret =
  process.env.MEET_MEDIA_WORKER_SECRET?.trim() ||
  process.env.ENRICH_INTERNAL_SECRET?.trim() ||
  "";

function readJson(req: import("node:http").IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(Buffer.from(c)));
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        resolve(raw ? JSON.parse(raw) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

function send(
  res: import("node:http").ServerResponse,
  status: number,
  body: unknown,
) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

function authorized(req: import("node:http").IncomingMessage): boolean {
  if (!controlSecret) return process.env.NODE_ENV !== "production";
  return req.headers["x-internal-secret"] === controlSecret;
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

  if (req.method === "GET" && url.pathname === "/health") {
    return send(res, 200, {
      ok: true,
      service: "meet-media-worker",
      preview: true,
    });
  }

  if (!authorized(req)) {
    return send(res, 401, { ok: false, error: "Unauthorized" });
  }

  if (req.method === "POST" && url.pathname === "/jobs/start") {
    try {
      const body = (await readJson(req)) as StartJobBody;
      const job = await startMediaJob(body);
      return send(res, job.ok ? 200 : 400, job);
    } catch (err) {
      return send(res, 500, {
        ok: false,
        error: err instanceof Error ? err.message : "start failed",
      });
    }
  }

  if (req.method === "POST" && url.pathname === "/jobs/stop") {
    try {
      const body = (await readJson(req)) as { sessionId?: string };
      const job = await stopMediaJob(body.sessionId || "");
      return send(res, job.ok ? 200 : 404, job);
    } catch (err) {
      return send(res, 500, {
        ok: false,
        error: err instanceof Error ? err.message : "stop failed",
      });
    }
  }

  if (req.method === "GET" && url.pathname.startsWith("/jobs/")) {
    const sessionId = url.pathname.slice("/jobs/".length);
    const job = getMediaJob(sessionId);
    if (!job) return send(res, 404, { ok: false, error: "Not found" });
    return send(res, 200, { ok: true, job });
  }

  return send(res, 404, { ok: false, error: "Not found" });
});

server.listen(port, host, () => {
  console.log(`Meet Media worker listening on http://${host}:${port}`);
  console.log(
    "Developer Preview: Meet Media API requires Workspace DPP enrollment.",
  );
});
