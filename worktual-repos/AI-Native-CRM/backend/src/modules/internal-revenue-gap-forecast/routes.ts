/**
 * Internal CRM ↔ ai-service bridge for the Revenue Gap Forecast agent.
 * Paths mirror ai-service CrmClient: /api/internal/revenue-gap-forecast/:organizationId[/steps]
 */
import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import {
  buildRevenueGapContext,
  persistRevenueGapDecision,
} from "@/service/ai/revenue-gap-forecast-context";
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

type AgentStepBody = {
  step?: string;
  label?: string;
  status?: AgentStepStatus;
  detail?: unknown;
  errorReason?: string | null;
  jobId?: string;
};

export const internalRevenueGapForecastRoutes: FastifyPluginAsync = async (
  app,
) => {
  app.addHook("preHandler", async (request, reply) => {
    if (!isInternalAuthorized(request)) {
      return sendError(reply, RESPONSE.unauthorized, 401);
    }
  });

  app.get<{ Params: { organizationId: string } }>(
    "/:organizationId",
    async (request, reply) => {
      const ctx = await buildRevenueGapContext(request.params.organizationId);
      if (!ctx) return sendError(reply, "Organization not found.", 404);
      return sendSuccess(reply, ctx);
    },
  );

  app.post<{
    Params: { organizationId: string };
    Body: {
      hasTarget?: boolean;
      narrative?: string;
      atRiskInvoiceIds?: string[];
      gapScenario?: string;
    };
  }>("/:organizationId", async (request, reply) => {
    const narrative = String(request.body?.narrative || "").trim();
    if (!narrative) return sendError(reply, "narrative required", 400);

    const result = await persistRevenueGapDecision(
      request.params.organizationId,
      {
        hasTarget: Boolean(request.body?.hasTarget),
        narrative,
        atRiskInvoiceIds: Array.isArray(request.body?.atRiskInvoiceIds)
          ? request.body.atRiskInvoiceIds.filter(
              (id): id is string => typeof id === "string",
            )
          : [],
        gapScenario: String(request.body?.gapScenario || ""),
      },
    );
    if (!result.applied) {
      return sendSuccess(reply, { status: "skipped", reason: "org_not_found" });
    }
    return sendSuccess(reply, { status: "applied" });
  });

  /** Curated step trace for the live "what is the agent doing" timeline. */
  app.post<{ Params: { organizationId: string }; Body: AgentStepBody }>(
    "/:organizationId/steps",
    async (request, reply) => {
      const step = String(request.body?.step || "").trim();
      const label = String(request.body?.label || "").trim();
      const status = request.body?.status;
      const jobId = String(request.body?.jobId || "").trim();
      const organizationId = request.params.organizationId;
      if (!organizationId || !step || !label || !status || !jobId) {
        return sendError(
          reply,
          "step, label, status, jobId, organizationId required",
          400,
        );
      }

      await recordAgentStep({
        organizationId,
        agent: "revenue_gap_forecast",
        jobId,
        contactId: null,
        step,
        label,
        status,
        detail: {
          ...(request.body?.detail && typeof request.body.detail === "object"
            ? (request.body.detail as Record<string, unknown>)
            : {}),
          organizationId,
        },
        errorReason: request.body?.errorReason ?? null,
      });

      return sendSuccess(reply, { ok: true });
    },
  );
};
