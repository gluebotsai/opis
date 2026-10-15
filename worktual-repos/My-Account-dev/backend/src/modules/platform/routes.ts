import fs from "node:fs";
import path from "node:path";

import type {
  FastifyPluginAsync,
  FastifyReply,
  FastifyRequest,
} from "fastify";

import { workspaceRoot } from "../../config/runtime-paths.js";
import { getSession } from "../auth/session-auth.js";
import { verifyGstinRemote } from "./gstin-check.js";
import { getPaymentConfig } from "../payments/runtime-service.js";
import {
  getPricingCatalog,
  savePricingCatalog,
} from "../pricing/catalog-store.js";
import { validateGstin } from "./tax-number.js";

type AdminRequest = FastifyRequest & {
  adminUser?: {
    email: string;
    role: string;
    userId?: string | null;
  };
};

async function requireAdmin(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const authorization = request.headers.authorization || "";
  const token = authorization.startsWith("Bearer ")
    ? authorization.slice(7).trim()
    : "";
  const session = await getSession(token);

  if (!session) {
    await reply.code(401).send({ error: "Unauthorized." });
    return;
  }
  if (session.role !== "admin") {
    await reply.code(403).send({ error: "Admin access required." });
    return;
  }

  (request as AdminRequest).adminUser = {
    email: session.email,
    role: session.role,
    userId: session.userId,
  };
}

function readDeployMeta(): Record<string, unknown> {
  try {
    const metaPath = path.join(workspaceRoot, "dist", "deploy-meta.json");
    if (!fs.existsSync(metaPath)) {
      return {};
    }
    const parsed: unknown = JSON.parse(fs.readFileSync(metaPath, "utf8"));
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

export const platformRoutes: FastifyPluginAsync = async (app) => {
  app.get("/deploy-meta", async (_request, reply) => {
    const meta = readDeployMeta();
    reply.header("Cache-Control", "no-store, no-cache, must-revalidate");
    if (!meta.releaseId && !meta.gitSha) {
      return reply.code(404).send({
        ok: false,
        error: "Deploy meta not found.",
        host: "fastify",
      });
    }
    return reply.send({ ok: true, ...meta, host: "fastify" });
  });

  app.get("/payments/config", async (_request, reply) => {
    return reply.send({ ...getPaymentConfig(), host: "fastify" });
  });

  app.get("/pricing-catalog", async (_request, reply) => {
    try {
      const catalog = await getPricingCatalog();
      return reply.send({ catalog, host: "fastify" });
    } catch (error) {
      return reply.code(500).send({
        error:
          error instanceof Error
            ? error.message
            : "Could not load pricing catalog.",
      });
    }
  });

  app.put<{
    Body: {
      catalog?: Record<string, unknown>;
      scopeProductId?: string | null;
    };
  }>(
    "/admin/pricing-catalog",
    { preHandler: requireAdmin },
    async (request, reply) => {
      try {
        const scopeProductId = request.body?.scopeProductId
          ? String(request.body.scopeProductId)
          : null;
        const catalog = await savePricingCatalog(
          request.body?.catalog || {},
          (request as AdminRequest).adminUser?.email || "",
          ({ scopeProductId } as any),
        );
        return reply.send({ catalog, host: "fastify" });
      } catch (error) {
        return reply.code(400).send({
          error:
            error instanceof Error
              ? error.message
              : "Could not save pricing catalog.",
        });
      }
    },
  );

  app.post<{
    Body: { gstin?: string; taxNumber?: string; state?: string };
  }>("/v1/tax/gstin/validate", async (request, reply) => {
    try {
      const gstin = String(
        request.body?.gstin || request.body?.taxNumber || "",
      ).trim();
      const state = String(request.body?.state || "").trim();
      const local = validateGstin(gstin, { expectedStateName: state });

      if (!local.valid) {
        return reply.send({
          valid: false,
          reason: local.reason || "Enter a valid GSTIN.",
          gstin: local.gstin || gstin,
          host: "fastify",
        });
      }

      const normalizedGstin = local.gstin || gstin;
      const remote = await verifyGstinRemote(normalizedGstin);
      if (!remote.valid && remote.creditsExceeded) {
        return reply.send({
          valid: true,
          gstin: normalizedGstin,
          legalName: "",
          tradeName: "",
          status: "",
          fallback: true,
          reason:
            remote.reason ||
            "GSTIN verification credits exceeded; validated by format.",
          host: "fastify",
        });
      }

      if (!remote.valid) {
        return reply.send({
          valid: false,
          reason: remote.reason || "GSTIN not found or invalid.",
          gstin: normalizedGstin,
          host: "fastify",
        });
      }

      const data = (remote.data || {}) as Record<string, unknown>;
      return reply.send({
        valid: true,
        gstin: normalizedGstin,
        legalName: data.lgnm || "",
        tradeName: data.tradeNam || "",
        status: data.sts || "",
        skipped: remote.skipped === true,
        host: "fastify",
      });
    } catch (error) {
      return reply.code(500).send({
        error:
          error instanceof Error ? error.message : "Could not validate GSTIN.",
      });
    }
  });
};
