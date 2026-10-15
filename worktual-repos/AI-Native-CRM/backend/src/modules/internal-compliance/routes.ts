/**
 * Internal CRM ↔ ai-service step-trace bridge for the compliance-privacy
 * agent, which has no persisted job table. All CRM context is packed by
 * TypeScript into the `callAiServiceAgent` payload directly (see
 * `compliance-privacy-assess.ts`), so this route only needs to accept the
 * curated step trace — no GET context / POST persist route required.
 *
 * Path mirrors ai-service CrmClient: /api/internal/compliance/:activityId/steps
 */
import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import { recordAgentStep } from "@/dao/ai/agent-step-events";
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

type StepsBody = {
  step?: string;
  label?: string;
  status?: "started" | "ok" | "failed" | "skipped";
  detail?: unknown;
  errorReason?: string | null;
  contactId?: string | null;
  jobId?: string;
};

export const internalComplianceRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", async (request, reply) => {
    if (!isInternalAuthorized(request)) {
      return sendError(reply, RESPONSE.unauthorized, 401);
    }
  });

  app.post<{ Params: { activityId: string }; Body: StepsBody }>(
    "/:activityId/steps",
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
        agent: "compliance_privacy",
        jobId,
        contactId: request.body?.contactId?.trim() || null,
        step,
        label,
        status,
        detail: request.body?.detail,
        errorReason: request.body?.errorReason ?? null,
      });

      return sendSuccess(reply, { ok: true });
    },
  );
};
