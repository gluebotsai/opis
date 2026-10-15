/**
 * Internal CRM ↔ ai-service bridge for the Company Collection Risk agent.
 * Paths mirror ai-service CrmClient: /api/internal/company-collection-risk/:companyId[/steps]
 */
import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import {
  buildCollectionRiskContext,
  persistCollectionRiskDecision,
  isCollectionRiskLevel,
} from "@/service/ai/company-collection-risk-context";
import { recordAgentStep, type AgentStepStatus } from "@/dao/ai/agent-step-events";
import { sendError, sendSuccess } from "../../helpers/response.js";
import { RESPONSE } from "../../helpers/constants.js";

function isInternalAuthorized(request: FastifyRequest): boolean {
  const secret =
    process.env.ENRICH_INTERNAL_SECRET?.trim() ||
    process.env.CRON_SECRET?.trim() ||
    "";
  if (!secret) return process.env.NODE_ENV !== "production";
  return request.headers["x-internal-secret"] === secret;
}

function orgFromRequest(request: FastifyRequest): string | null {
  const header = request.headers["x-organization-id"];
  return typeof header === "string" && header.trim() ? header.trim() : null;
}

type AgentStepBody = {
  step?: string;
  label?: string;
  status?: AgentStepStatus;
  detail?: unknown;
  errorReason?: string | null;
  jobId?: string;
};

export const internalCompanyCollectionRiskRoutes: FastifyPluginAsync = async (
  app,
) => {
  app.addHook("preHandler", async (request, reply) => {
    if (!isInternalAuthorized(request)) {
      return sendError(reply, RESPONSE.unauthorized, 401);
    }
  });

  app.get<{ Params: { companyId: string } }>(
    "/:companyId",
    async (request, reply) => {
      const organizationId = orgFromRequest(request);
      if (!organizationId) return sendError(reply, "organizationId required", 400);
      const ctx = await buildCollectionRiskContext(
        request.params.companyId,
        organizationId,
      );
      if (!ctx) return sendError(reply, "Company not found.", 404);
      return sendSuccess(reply, ctx);
    },
  );

  app.post<{
    Params: { companyId: string };
    Body: { riskLevel?: string; reason?: string; organizationId?: string | null };
  }>("/:companyId", async (request, reply) => {
    const organizationId = orgFromRequest(request) ?? request.body?.organizationId;
    if (!organizationId) return sendError(reply, "organizationId required", 400);
    const riskLevel = request.body?.riskLevel;
    if (!isCollectionRiskLevel(riskLevel)) {
      return sendError(reply, "riskLevel required", 400);
    }
    const reason = String(request.body?.reason || "").trim();
    if (!reason) return sendError(reply, "reason required", 400);

    const result = await persistCollectionRiskDecision(
      request.params.companyId,
      organizationId,
      { riskLevel, reason },
    );
    if (!result.applied) {
      return sendSuccess(reply, { status: "skipped", reason: "company_not_found" });
    }
    return sendSuccess(reply, { status: "applied" });
  });

  /** Curated step trace for the live "what is the agent doing" timeline. */
  app.post<{ Params: { companyId: string }; Body: AgentStepBody }>(
    "/:companyId/steps",
    async (request, reply) => {
      const organizationId = orgFromRequest(request);
      const step = String(request.body?.step || "").trim();
      const label = String(request.body?.label || "").trim();
      const status = request.body?.status;
      const jobId = String(request.body?.jobId || "").trim();
      if (!organizationId || !step || !label || !status || !jobId) {
        return sendError(
          reply,
          "step, label, status, jobId, organizationId required",
          400,
        );
      }

      await recordAgentStep({
        organizationId,
        agent: "company_collection_risk",
        jobId,
        contactId: null,
        step,
        label,
        status,
        detail: {
          ...(request.body?.detail && typeof request.body.detail === "object"
            ? (request.body.detail as Record<string, unknown>)
            : {}),
          companyId: request.params.companyId,
        },
        errorReason: request.body?.errorReason ?? null,
      });

      return sendSuccess(reply, { ok: true });
    },
  );
};
