/**
 * Internal CRM ↔ ai-service bridge for the Pipeline Forecast Auditor agent.
 * Paths mirror ai-service CrmClient: /api/internal/forecast/:dealId[/steps]
 */
import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import {
  buildForecastContext,
  persistForecastDecision,
  isForecastCategory,
} from "@/service/ai/pipeline-forecast-context";
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

export const internalForecastRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", async (request, reply) => {
    if (!isInternalAuthorized(request)) {
      return sendError(reply, RESPONSE.unauthorized, 401);
    }
  });

  app.get<{ Params: { dealId: string } }>(
    "/:dealId",
    async (request, reply) => {
      const organizationId = orgFromRequest(request);
      if (!organizationId) return sendError(reply, "organizationId required", 400);
      const ctx = await buildForecastContext(request.params.dealId, organizationId);
      if (!ctx) return sendError(reply, "Deal not found.", 404);
      return sendSuccess(reply, ctx);
    },
  );

  app.post<{
    Params: { dealId: string };
    Body: {
      category?: string;
      confidencePercent?: number;
      flagged?: boolean;
      reason?: string;
      organizationId?: string | null;
    };
  }>("/:dealId", async (request, reply) => {
    const organizationId = orgFromRequest(request) ?? request.body?.organizationId;
    if (!organizationId) return sendError(reply, "organizationId required", 400);
    const category = request.body?.category;
    if (!isForecastCategory(category)) {
      return sendError(reply, "category required", 400);
    }
    const reason = String(request.body?.reason || "").trim();
    if (!reason) return sendError(reply, "reason required", 400);

    const result = await persistForecastDecision(request.params.dealId, organizationId, {
      category,
      confidencePercent: Number(request.body?.confidencePercent ?? 0),
      flagged: Boolean(request.body?.flagged),
      reason,
    });
    if (!result.applied) {
      return sendSuccess(reply, { status: "skipped", reason: "deal_not_found" });
    }
    return sendSuccess(reply, { status: "applied" });
  });

  /**
   * Curated step trace for the live "what is the agent doing" timeline.
   * `pipeline_forecast` is job-less (ephemeral): ai-service generates the
   * run id at the top of `run()` and reuses it for every step.
   */
  app.post<{ Params: { dealId: string }; Body: AgentStepBody }>(
    "/:dealId/steps",
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
        agent: "pipeline_forecast",
        jobId,
        contactId: null,
        step,
        label,
        status,
        detail: {
          ...(request.body?.detail && typeof request.body.detail === "object"
            ? (request.body.detail as Record<string, unknown>)
            : {}),
          dealId: request.params.dealId,
        },
        errorReason: request.body?.errorReason ?? null,
      });

      return sendSuccess(reply, { ok: true });
    },
  );
};
