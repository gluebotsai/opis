/**
 * Internal CRM ↔ ai-service bridge for the Invoice Dunning agent.
 * Paths mirror ai-service CrmClient: /api/internal/invoice-dunning/:invoiceId[/steps]
 */
import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import {
  buildInvoiceDunningContext,
  persistInvoiceDunningDecision,
  isDunningStage,
} from "@/service/ai/invoice-dunning-context";
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

export const internalInvoiceDunningRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", async (request, reply) => {
    if (!isInternalAuthorized(request)) {
      return sendError(reply, RESPONSE.unauthorized, 401);
    }
  });

  app.get<{ Params: { invoiceId: string } }>(
    "/:invoiceId",
    async (request, reply) => {
      const organizationId = orgFromRequest(request);
      if (!organizationId) return sendError(reply, "organizationId required", 400);
      const ctx = await buildInvoiceDunningContext(
        request.params.invoiceId,
        organizationId,
      );
      if (!ctx) return sendError(reply, "Invoice not found.", 404);
      return sendSuccess(reply, ctx);
    },
  );

  app.post<{
    Params: { invoiceId: string };
    Body: {
      nextStage?: string;
      reason?: string;
      message?: string;
      organizationId?: string | null;
    };
  }>("/:invoiceId", async (request, reply) => {
    const organizationId = orgFromRequest(request) ?? request.body?.organizationId;
    if (!organizationId) return sendError(reply, "organizationId required", 400);
    const nextStage = request.body?.nextStage;
    if (!isDunningStage(nextStage)) {
      return sendError(reply, "nextStage required", 400);
    }
    const reason = String(request.body?.reason || "").trim();
    if (!reason) return sendError(reply, "reason required", 400);

    const result = await persistInvoiceDunningDecision(
      request.params.invoiceId,
      organizationId,
      {
        nextStage,
        reason,
        message: String(request.body?.message || ""),
      },
    );
    if (!result.applied) {
      return sendSuccess(reply, { status: "skipped", reason: "invoice_not_found" });
    }
    return sendSuccess(reply, { status: "applied" });
  });

  /** Curated step trace for the live "what is the agent doing" timeline. */
  app.post<{ Params: { invoiceId: string }; Body: AgentStepBody }>(
    "/:invoiceId/steps",
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
        agent: "invoice_dunning",
        jobId,
        contactId: null,
        step,
        label,
        status,
        detail: {
          ...(request.body?.detail && typeof request.body.detail === "object"
            ? (request.body.detail as Record<string, unknown>)
            : {}),
          invoiceId: request.params.invoiceId,
        },
        errorReason: request.body?.errorReason ?? null,
      });

      return sendSuccess(reply, { ok: true });
    },
  );
};
