/**
 * Internal CRM ↔ ai-service bridges for lead agents.
 * Paths mirror ai-service CrmClient:
 *   /api/internal/{enrichment,scoring,summary,nurture,lifecycle}/:contactId
 *   /api/internal/auto-reply/:activityId
 *   /api/internal/meeting-brief/:activityId
 */
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { buildLeadEnrichmentContext } from "@/service/ai/lead-enrichment-job";
import { persistLeadEnrichment } from "@/dao/ai/lead-enrichment-persist";
import { findEnrichmentJobByOrgContact } from "@/dao/ai/lead-enrichment-store";
import { recordAgentStep } from "@/dao/ai/agent-step-events";
import { publishEnrichmentStepEvent } from "@/service/ai/lead-enrichment-events";
import { buildLeadScoreContext } from "@/service/ai/lead-scoring-job";
import { findScoringJobByOrgContact } from "@/dao/ai/lead-scoring-store";
import {
  buildLeadSummaryContext,
  clampLeadSummaryCitations,
  computeSignature,
  deriveLeadIntent,
  omniChannelHash,
} from "@/service/ai/lead-summary-agent";
import { deriveProcessNextAction } from "@/service/ai/lead-next-action";
import { upsertLeadSummary } from "@/dao/ai/lead-summary-store";
import { buildNurtureContext } from "@/service/ai/lead-nurture-job";
import { findNurtureJobByOrgContact } from "@/dao/ai/lead-nurture-store";
import {
  buildLifecycleContext,
} from "@/service/ai/lead-lifecycle-context";
import {
  applyLifecycleDecision,
  auditLifecycleMove,
} from "@/service/ai/lead-lifecycle-apply";
import { findLifecycleJobByOrgContact } from "@/dao/ai/lead-lifecycle-store";
import {
  enforceCommercialWinFromDb,
  isHighRisk,
  shouldBypassHighRiskCloseWon,
  withLifecycleReason,
  type LifecycleDecision,
} from "@/service/ai/lead-lifecycle-decide";
import { enforceEvidenceBar } from "@/service/ai/lead-lifecycle-evidence";
import { enqueueLifecycleHighRiskIfNeeded } from "@/service/ai/post-meeting-process";
import {
  buildAutoReplyContext,
  applyAutoReplyDecision,
  type AutoReplyDecision,
} from "@/service/ai/email-auto-reply-job";
import { findAutoReplyJobByActivity } from "@/dao/ai/email-auto-reply-store";
import { buildMeetingBriefContext } from "@/service/ai/meeting-brief";
import { sendHubOutboundEmail } from "@/service/ai/hub-outbound-email";
import type { LeadEnrichmentPayload } from "@/service/ai/lead-enrichment-types";
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

/**
 * Curated step trace for the live "what is the agent doing" timeline,
 * shared by every LangGraph agent's internal steps route below.
 * Fire-and-forget from ai-service — never blocks/fails the agent run.
 *
 * `jobId` is set by job-less agents (summary, assignment, meeting agents):
 * ai-service generates an ephemeral run id at the top of `run()` and reuses
 * it for every step of that run, so the route below does not need to look
 * up a job row. Job-backed agents (enrichment/scoring/nurture/lifecycle/
 * auto-reply) leave it unset — the route resolves the real job itself.
 */
type AgentStepBody = {
  agent?: string;
  step?: string;
  label?: string;
  status?: "started" | "ok" | "failed" | "skipped";
  detail?: unknown;
  errorReason?: string | null;
  contactId?: string;
  companyId?: string;
  jobId?: string;
};

async function persistAgentStep(
  reply: FastifyReply,
  body: AgentStepBody | undefined,
  ctx: {
    organizationId: string | null;
    agent: string;
    jobId: string | null;
    contactId: string | null;
  },
) {
  const step = String(body?.step || "").trim();
  const label = String(body?.label || "").trim();
  const status = body?.status;
  if (!ctx.organizationId || !step || !label || !status) {
    return sendError(reply, "step, label, status, organizationId required", 400);
  }
  if (!ctx.jobId) return sendError(reply, "Job not found.", 404);

  await recordAgentStep({
    organizationId: ctx.organizationId,
    agent: ctx.agent,
    jobId: ctx.jobId,
    contactId: ctx.contactId,
    step,
    label,
    status,
    detail: body?.detail,
    errorReason: body?.errorReason ?? null,
  });

  return sendSuccess(reply, { ok: true });
}

/** Ephemeral jobId from the request body — the correlation key for every
 * job-less agent (no `find<X>JobByOrgContact` lookup needed). */
function ephemeralJobId(body: AgentStepBody | undefined): string | null {
  return String(body?.jobId || "").trim() || null;
}

const authHook: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", async (request, reply) => {
    if (!isInternalAuthorized(request)) {
      return sendError(reply, RESPONSE.unauthorized, 401);
    }
  });
};

export const internalEnrichmentRoutes: FastifyPluginAsync = async (app) => {
  await app.register(authHook);

  app.get<{ Params: { contactId: string } }>(
    "/:contactId",
    async (request, reply) => {
      const organizationId = orgFromRequest(request);
      const ctx = await buildLeadEnrichmentContext(
        request.params.contactId,
        organizationId,
      );
      if (!ctx) return sendError(reply, "Contact not found.", 404);
      return sendSuccess(reply, ctx);
    },
  );

  app.post<{ Params: { contactId: string }; Body: LeadEnrichmentPayload }>(
    "/:contactId",
    async (request, reply) => {
      const organizationId = orgFromRequest(request);
      const body = request.body ?? ({} as LeadEnrichmentPayload);
      const payload: LeadEnrichmentPayload = {
        ...body,
        contactId: request.params.contactId,
      };
      const result = await persistLeadEnrichment(payload, { organizationId });
      return sendSuccess(reply, result);
    },
  );

  /**
   * Curated step trace for the live "what is the agent doing" timeline.
   * Fire-and-forget from ai-service — never blocks/fails the agent run.
   */
  app.post<{
    Params: { contactId: string };
    Body: {
      step?: string;
      label?: string;
      status?: "started" | "ok" | "failed" | "skipped";
      detail?: unknown;
      errorReason?: string | null;
    };
  }>("/:contactId/steps", async (request, reply) => {
    const organizationId = orgFromRequest(request);
    const contactId = request.params.contactId;
    const step = String(request.body?.step || "").trim();
    const label = String(request.body?.label || "").trim();
    const status = request.body?.status;
    if (!organizationId || !step || !label || !status) {
      return sendError(reply, "step, label, status, organizationId required", 400);
    }
    const job = await findEnrichmentJobByOrgContact(organizationId, contactId);
    if (!job) return sendError(reply, "Enrichment job not found.", 404);

    const row = await recordAgentStep({
      organizationId,
      agent: "lead_enrichment",
      jobId: job.id,
      contactId,
      step,
      label,
      status,
      detail: request.body?.detail,
      errorReason: request.body?.errorReason ?? null,
    });

    publishEnrichmentStepEvent({
      contactId,
      jobId: job.id,
      step: row.step,
      label: row.label,
      status: row.status,
      detail: row.detail,
      errorReason: row.errorReason,
    });

    return sendSuccess(reply, { ok: true });
  });
};

export const internalScoringRoutes: FastifyPluginAsync = async (app) => {
  await app.register(authHook);

  app.get<{ Params: { contactId: string } }>(
    "/:contactId",
    async (request, reply) => {
      const organizationId = orgFromRequest(request);
      const ctx = await buildLeadScoreContext(
        request.params.contactId,
        organizationId,
      );
      if (!ctx) return sendError(reply, "Contact not found.", 404);
      return sendSuccess(reply, ctx);
    },
  );

  app.post<{ Params: { contactId: string }; Body: AgentStepBody }>(
    "/:contactId/steps",
    async (request, reply) => {
      const organizationId = orgFromRequest(request);
      const contactId = request.params.contactId;
      const job = organizationId
        ? await findScoringJobByOrgContact(organizationId, contactId)
        : null;
      return persistAgentStep(reply, request.body, {
        organizationId,
        agent: "lead_scoring",
        jobId: job?.id ?? null,
        contactId,
      });
    },
  );
};

export const internalSummaryRoutes: FastifyPluginAsync = async (app) => {
  await app.register(authHook);

  app.get<{ Params: { contactId: string } }>(
    "/:contactId",
    async (request, reply) => {
      const organizationId = orgFromRequest(request);
      const ctx = await buildLeadSummaryContext(
        request.params.contactId,
        organizationId,
      );
      if (!ctx) return sendError(reply, "Contact not found.", 404);
      return sendSuccess(reply, ctx);
    },
  );

  app.post<{
    Params: { contactId: string };
    Body: {
      summary?: string;
      intent?: string | null;
      source?: string;
      force?: boolean;
      contactId?: string;
      recommendedAction?: string | null;
      flags?: unknown;
    };
  }>("/:contactId", async (request, reply) => {
    const organizationId = orgFromRequest(request);
    const contactId = request.params.contactId;
    const ctx = await buildLeadSummaryContext(contactId, organizationId);
    if (!ctx) return sendError(reply, "Contact not found.", 404);
    const summary = String(request.body?.summary || "").trim();
    if (!summary) return sendError(reply, "summary required", 400);
    if (request.body?.source && request.body.source !== "ai") {
      return sendError(reply, "Lead summaries must be AI-sourced.", 400);
    }
    const incomingFlags =
      request.body?.flags && typeof request.body.flags === "object"
        ? (request.body.flags as { citations?: unknown })
        : {};
    const citations = clampLeadSummaryCitations(incomingFlags.citations, ctx);
    if (!citations.length) {
      return sendError(reply, "Each summary line must cite a source.", 400);
    }
    const saved = await upsertLeadSummary({
      organizationId: ctx.organizationId,
      contactId,
      summary: citations.map((line) => line.text).join("\n\n"),
      headline: null,
      intent: request.body?.intent?.trim() || deriveLeadIntent(ctx),
      recommendedAction: deriveProcessNextAction(
        ctx,
        request.body?.recommendedAction?.trim() || ctx.nextBestAction || null,
      ),
      flags: {
        ...incomingFlags,
        citations,
        omniHash: omniChannelHash(ctx.omniChannelSummary),
        fitScore: ctx.fitScore,
        intentScore: ctx.intentScore,
        band: ctx.band,
        score: ctx.score,
      },
      signature: computeSignature(ctx),
      source: "ai",
      model: "ai-service",
    });
    return sendSuccess(reply, {
      summary: saved.summary,
      intent: saved.intent,
      source: saved.source,
      recommendedAction: saved.recommendedAction,
      flags: saved.flags,
      updatedAt: saved.updatedAt.toISOString(),
    });
  });

  app.post<{ Params: { contactId: string }; Body: AgentStepBody }>(
    "/:contactId/steps",
    async (request, reply) => {
      const organizationId = orgFromRequest(request);
      const contactId = request.params.contactId;
      return persistAgentStep(reply, request.body, {
        organizationId,
        agent: "lead_summary",
        jobId: ephemeralJobId(request.body),
        contactId,
      });
    },
  );
};

export const internalNurtureRoutes: FastifyPluginAsync = async (app) => {
  await app.register(authHook);

  app.get<{ Params: { contactId: string } }>(
    "/:contactId",
    async (request, reply) => {
      const organizationId = orgFromRequest(request);
      const ctx = await buildNurtureContext(
        request.params.contactId,
        organizationId,
      );
      if (!ctx) return sendError(reply, "Contact not found.", 404);
      return sendSuccess(reply, ctx);
    },
  );

  // Nurture decisions are returned to processLeadNurtureJob. They must never
  // persist or send through an ai-service callback because that can bypass the
  // local live-conversation, summary, and post-conversation scoring gates.
  app.post<{ Params: { contactId: string } }>(
    "/:contactId",
    async (_request, reply) =>
      sendError(
        reply,
        "Nurture decisions must be applied by the CRM nurture job.",
        409,
      ),
  );

  app.post<{ Params: { contactId: string }; Body: AgentStepBody }>(
    "/:contactId/steps",
    async (request, reply) => {
      const organizationId = orgFromRequest(request);
      const contactId = request.params.contactId;
      const job = organizationId
        ? await findNurtureJobByOrgContact(organizationId, contactId)
        : null;
      return persistAgentStep(reply, request.body, {
        organizationId,
        agent: "lead_nurture",
        jobId: job?.id ?? null,
        contactId,
      });
    },
  );
};

export const internalLifecycleRoutes: FastifyPluginAsync = async (app) => {
  await app.register(authHook);

  app.get<{ Params: { contactId: string } }>(
    "/:contactId",
    async (request, reply) => {
      const organizationId = orgFromRequest(request);
      const ctx = await buildLifecycleContext(
        request.params.contactId,
        organizationId,
      );
      if (!ctx) return sendError(reply, "Contact not found.", 404);
      return sendSuccess(reply, ctx);
    },
  );

  app.post<{
    Params: { contactId: string };
    Body: {
      contactId?: string;
      decision?: LifecycleDecision;
      organizationId?: string | null;
    };
  }>("/:contactId", async (request, reply) => {
    const organizationId = orgFromRequest(request);
    const rawDecision = request.body?.decision;
    if (!rawDecision?.action?.kind) {
      return sendError(reply, "decision required", 400);
    }
    const decision = withLifecycleReason(rawDecision);

    const ctx = await buildLifecycleContext(
      request.params.contactId,
      organizationId ?? request.body?.organizationId,
    );
    if (!ctx) {
      return sendSuccess(reply, {
        status: "skipped",
        decision: "skip",
        reason: "contact_not_found",
        blocked: "contact_not_found",
      });
    }

    const gated = enforceEvidenceBar(
      ctx,
      enforceCommercialWinFromDb(ctx, decision),
    );

    if (gated.action.kind === "skip") {
      return sendSuccess(reply, {
        status: "skipped",
        decision: "skip",
        ladder: "none",
        from: null,
        to: null,
        reason: gated.reason,
      });
    }

    if (gated.action.kind === "wait") {
      const hours = Math.max(
        1,
        Math.min(72, Number(gated.action.waitHours ?? 24)),
      );
      return sendSuccess(reply, {
        status: "waited",
        decision: "wait",
        ladder: "none",
        from: null,
        to: null,
        reason: gated.reason,
        waitHours: hours,
      });
    }

    if (gated.action.kind === "flag_for_review") {
      const outcome = await applyLifecycleDecision(ctx, gated);
      return sendSuccess(reply, {
        status: outcome.applied ? "applied" : "skipped",
        decision: "flag_for_review",
        ladder: "none",
        from: gated.from,
        to: gated.to,
        reason: gated.reason,
        blocked: outcome.blocked,
      });
    }

    if (
      isHighRisk(gated.action) &&
      !(
        gated.action.kind === "close_won" &&
        shouldBypassHighRiskCloseWon(ctx)
      )
    ) {
      const hr = await enqueueLifecycleHighRiskIfNeeded(ctx, gated);
      return sendSuccess(reply, {
        status: "waited",
        decision: gated.action.kind,
        ladder: gated.ladder,
        from: gated.from,
        to: gated.to,
        reason: hr.queued
          ? `Awaiting contact-owner confirmation (${gated.action.kind})`
          : gated.reason,
        waitHours: 12,
        blocked: hr.queued ? "awaiting_owner_confirmation" : null,
      });
    }

    const ownerUserId =
      typeof (gated as { ownerUserId?: string }).ownerUserId === "string"
        ? (gated as { ownerUserId?: string }).ownerUserId
        : null;
    const assignment =
      (gated as { assignment?: { userId?: string } | null }).assignment ??
      null;

    const outcome = await applyLifecycleDecision(ctx, gated, {
      ownerUserId: ownerUserId ?? assignment?.userId ?? null,
      assignment: assignment as never,
    }).catch((err) => {
      console.error("applyLifecycleDecision failed", ctx.contactId, err);
      return {
        applied: false,
        ladder: gated.ladder,
        from: gated.from,
        to: gated.to,
        reason: gated.reason,
        dealId: null,
        quoteId: null,
        blocked: err instanceof Error ? err.message : "apply_failed",
      };
    });

    if (!outcome.applied) {
      return sendSuccess(reply, {
        status: "skipped",
        decision: gated.action.kind,
        ladder: gated.ladder,
        from: gated.from,
        to: gated.to,
        reason: outcome.blocked ?? gated.reason,
        blocked: outcome.blocked,
      });
    }

    await auditLifecycleMove(ctx, outcome);
    return sendSuccess(reply, {
      status: "applied",
      decision: gated.action.kind,
      ladder: gated.ladder,
      from: gated.from,
      to: gated.to,
      reason: gated.reason,
      dealId: outcome.dealId,
      quoteId: outcome.quoteId,
    });
  });

  app.post<{ Params: { contactId: string }; Body: AgentStepBody }>(
    "/:contactId/steps",
    async (request, reply) => {
      const organizationId = orgFromRequest(request);
      const contactId = request.params.contactId;
      const job = organizationId
        ? await findLifecycleJobByOrgContact(organizationId, contactId)
        : null;
      return persistAgentStep(reply, request.body, {
        organizationId,
        agent: "lead_lifecycle",
        jobId: job?.id ?? null,
        contactId,
      });
    },
  );
};

export const internalAutoReplyRoutes: FastifyPluginAsync = async (app) => {
  await app.register(authHook);

  app.get<{ Params: { activityId: string } }>(
    "/:activityId",
    async (request, reply) => {
      const organizationId = orgFromRequest(request);
      const ctx = await buildAutoReplyContext(
        request.params.activityId,
        organizationId,
      );
      if (!ctx) return sendError(reply, "Activity not found.", 404);
      return sendSuccess(reply, ctx);
    },
  );

  app.post<{
    Params: { activityId: string };
    Body: {
      decision?: AutoReplyDecision;
      sensitivity?: string;
      category?: string;
      reason?: string;
      replySubject?: string | null;
      replyBody?: string | null;
      requestedStartIso?: string | null;
      chosenSlotIso?: string | null;
      timeZone?: string | null;
      organizationId?: string | null;
    };
  }>("/:activityId", async (request, reply) => {
    const organizationId = orgFromRequest(request);
    const decision = request.body?.decision;
    if (!decision) return sendError(reply, "decision required", 400);
    const result = await applyAutoReplyDecision(request.params.activityId, {
      organizationId: organizationId ?? request.body?.organizationId,
      decision,
      sensitivity:
        request.body?.sensitivity === "sensitive"
          ? "sensitive"
          : request.body?.sensitivity === "unknown"
            ? "unknown"
            : "safe",
      category: String(request.body?.category || "unknown"),
      reason: String(request.body?.reason || ""),
      replySubject: request.body?.replySubject ?? null,
      replyBody: request.body?.replyBody ?? null,
      requestedStartIso: request.body?.requestedStartIso ?? null,
      chosenSlotIso: request.body?.chosenSlotIso ?? null,
      timeZone: request.body?.timeZone ?? null,
    });
    return sendSuccess(reply, result);
  });

  app.post<{ Params: { activityId: string }; Body: AgentStepBody }>(
    "/:activityId/steps",
    async (request, reply) => {
      const organizationId = orgFromRequest(request);
      const activityId = request.params.activityId;
      const contactId = String(request.body?.contactId || "").trim();
      if (!contactId) return sendError(reply, "contactId required", 400);
      const job = await findAutoReplyJobByActivity(activityId);
      return persistAgentStep(reply, request.body, {
        organizationId,
        agent: "email_auto_reply",
        jobId: job?.id ?? null,
        contactId,
      });
    },
  );
};

/**
 * Hub A2A compose→send only. Not used by coworker, inbox, nurture, or auto-reply.
 */
export const internalHubOutboundRoutes: FastifyPluginAsync = async (app) => {
  await app.register(authHook);

  app.post<{
    Params: { contactId: string };
    Body: {
      subject?: string;
      body?: string;
      organizationId?: string | null;
      reason?: string | null;
    };
  }>("/:contactId", async (request, reply) => {
    const organizationId = orgFromRequest(request);
    const subject = String(request.body?.subject || "").trim();
    const body = String(request.body?.body || "").trim();
    if (!subject || !body) {
      return sendError(reply, "subject and body required", 400);
    }
    const result = await sendHubOutboundEmail(request.params.contactId, {
      organizationId: organizationId ?? request.body?.organizationId,
      subject,
      body,
      reason: request.body?.reason ?? null,
    });
    return sendSuccess(reply, result);
  });
};

const MEETING_BRIEF_AGENT_IDS = new Set(["meeting_brief", "meeting_reminder"]);

export const internalMeetingBriefRoutes: FastifyPluginAsync = async (app) => {
  await app.register(authHook);

  app.get<{ Params: { activityId: string } }>(
    "/:activityId",
    async (request, reply) => {
      const organizationId = orgFromRequest(request);
      const ctx = await buildMeetingBriefContext(
        request.params.activityId,
        organizationId,
      );
      if (!ctx) return sendError(reply, "Activity not found.", 404);
      return sendSuccess(reply, ctx);
    },
  );

  /**
   * One LangGraph module serves two dashboard-visible agents (a booking
   * brief vs. a T-24h/T-1h reminder) — ai-service tells us which via
   * `body.agent` instead of a route-hardcoded value.
   */
  app.post<{ Params: { activityId: string }; Body: AgentStepBody }>(
    "/:activityId/steps",
    async (request, reply) => {
      const organizationId = orgFromRequest(request);
      const requestedAgent = String(request.body?.agent || "").trim();
      const agent = MEETING_BRIEF_AGENT_IDS.has(requestedAgent)
        ? requestedAgent
        : "meeting_brief";
      return persistAgentStep(reply, request.body, {
        organizationId,
        agent,
        jobId: ephemeralJobId(request.body),
        contactId: request.body?.contactId ?? null,
      });
    },
  );
};
