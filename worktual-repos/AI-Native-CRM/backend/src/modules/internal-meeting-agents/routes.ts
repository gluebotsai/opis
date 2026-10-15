/**
 * Internal CRM ↔ ai-service step-trace bridges for the meeting agents that
 * have no persisted job table (meeting_miss_escalation, meeting_mom,
 * post_meeting_process). All CRM context is packed by TypeScript into the
 * `callAiServiceAgent` payload directly, so these routes only need to
 * accept the curated step trace — no GET context route required.
 *
 * Paths mirror ai-service CrmClient:
 *   /api/internal/{meeting-miss,meeting-mom,post-meeting}/:activityId/steps
 */
import type { FastifyInstance, FastifyPluginAsync, FastifyRequest } from "fastify";
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

/**
 * Shared step-trace handler for the three job-less meeting agents below.
 * `jobId` is the ephemeral run id ai-service generates at the top of
 * `run()` — there is no job row to look up.
 */
function registerStepsRoute(app: FastifyInstance, agent: string) {
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
        agent,
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
}

const authHook: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", async (request, reply) => {
    if (!isInternalAuthorized(request)) {
      return sendError(reply, RESPONSE.unauthorized, 401);
    }
  });
};

export const internalMeetingMissRoutes: FastifyPluginAsync = async (app) => {
  await app.register(authHook);
  registerStepsRoute(app, "meeting_miss_escalation");
};

export const internalMeetingMomRoutes: FastifyPluginAsync = async (app) => {
  await app.register(authHook);
  registerStepsRoute(app, "meeting_mom");
};

export const internalPostMeetingRoutes: FastifyPluginAsync = async (app) => {
  await app.register(authHook);
  registerStepsRoute(app, "post_meeting_process");
};
