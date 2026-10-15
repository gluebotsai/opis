import fs from "node:fs";
import path from "node:path";

import type { FastifyPluginAsync } from "fastify";

import { workspaceRoot } from "../../config/runtime-paths.js";
import { pool } from "../../db/pool.js";
import { pingRedis } from "../../infra/redis.js";

function readDeployMeta(): { releaseId?: string } {
  try {
    // Deployment metadata is emitted at repo-root/dist/deploy-meta.json.
    const metaPath = path.join(workspaceRoot, "dist", "deploy-meta.json");
    if (!fs.existsSync(metaPath)) {
      return {};
    }
    const parsed = JSON.parse(fs.readFileSync(metaPath, "utf8")) as { releaseId?: string };
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * Health endpoint preserving the public response contract.
 */
export const legacyHealthRoutes: FastifyPluginAsync = async (app) => {
  app.get("/health", async (_request, reply) => {
    reply.header("x-route-host", "fastify");
    try {
      await pool.query("SELECT 1");
      const redis = await pingRedis();
      return reply.send({
        ok: true,
        fulfillment: "v2-customer-hub",
        database: { ok: true },
        redis,
        releaseId: readDeployMeta().releaseId || null,
        host: "fastify",
      });
    } catch (error) {
      return reply.status(503).send({
        ok: false,
        error: error instanceof Error ? error.message : "Health check failed.",
        host: "fastify",
      });
    }
  });
};
