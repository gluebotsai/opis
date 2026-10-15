import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import { processMeetingReminders } from "@/dao/calendar/meeting-reminders";
import { processMeetingMissEscalations } from "@/dao/calendar/meeting-miss-escalation";
import { reconcileDueMeetingCaptures } from "@/service/transcripts/meeting-capture";
import { syncAllConnectedCalendars } from "@/dao/calendar/sync-calendars";
import { syncAllConnectedMailboxes, syncLiveInboundMail } from "@/dao/inbox/sync-mailboxes";
import {
  processDueLeadEnrichmentJobs,
  reconcileMissingLeadEnrichmentJobs,
} from "@/service/ai/lead-enrichment-job";
import { processDueLeadScoringJobs } from "@/service/ai/lead-scoring-job";
import {
  processConversationDeferredNurtureJobs,
  processDueLeadNurtureJobs,
} from "@/service/ai/lead-nurture-job";
import { processDueLeadLifecycleJobs } from "@/service/ai/lead-lifecycle-job";
import { processLeadScoreDecay } from "@/service/ai/lead-score-decay";
import { processLifecycleStallFlags } from "@/service/ai/lead-lifecycle-stall";
import { processSalesExecutionEscalations } from "@/service/ai/sales-execution-escalations";
import { processLeadAssignmentFollowups } from "@/service/ai/lead-assignment-followup";
import { processLeadSummaryRefreshes } from "@/service/ai/lead-summary-refresh";
import { processDispositionSweep } from "@/service/ai/disposition-job";
import { processPipelineForecastSweep } from "@/service/ai/pipeline-forecast-job";
import { processInvoiceEscalationSweep } from "@/service/ai/invoice-escalation-job";
import { processCompanyCollectionRiskSweep } from "@/service/ai/company-collection-risk-job";
import { syncCompaniesFromContactsSweep } from "@/dao/companies/sync-from-contacts";
import { processRevenueGapForecastSweep } from "@/service/ai/revenue-gap-forecast-job";
import { processInvoiceDunningSweep } from "@/service/ai/invoice-dunning-job";
import { processExpansionMatcherSweep } from "@/service/ai/expansion-matcher-job";
import { sendError, sendSuccess } from "../../helpers/response.js";
import { RESPONSE } from "../../helpers/constants.js";

function isCronAuthorized(request: FastifyRequest): boolean {
  const secret =
    process.env.CRON_SECRET?.trim() ||
    process.env.ENRICH_INTERNAL_SECRET?.trim() ||
    "";
  if (!secret) return process.env.NODE_ENV !== "production";
  const bearer = String(request.headers.authorization || "");
  if (bearer === `Bearer ${secret}`) return true;
  return request.headers["x-internal-secret"] === secret;
}

function parseCronLimit(request: FastifyRequest): number | undefined {
  const raw = (request.query as { limit?: string } | undefined)?.limit;
  if (raw == null || raw === "") return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n)) return undefined;
  return Math.min(200, Math.max(1, Math.floor(n)));
}

/**
 * Prefix: /api/cron
 */
export const cronRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", async (request, reply) => {
    if (!isCronAuthorized(request)) {
      return sendError(reply, RESPONSE.unauthorized, 401);
    }
  });

  /** CRM bot inbox + auto-reply drain (~15s scheduler cadence). */
  app.post("/inbox-sync-live", async (_request, reply) => {
    const result = await syncLiveInboundMail();
    return sendSuccess(reply, result);
  });

  /** Inbox mail → contact_activities for known contacts. */
  app.post("/inbox-sync", async (_request, reply) => {
    const result = await syncAllConnectedMailboxes(25);
    return sendSuccess(reply, result);
  });

  /** Provider calendars → meeting activities (idempotent). */
  app.post("/calendar-inbound", async (_request, reply) => {
    const result = await syncAllConnectedCalendars(25);
    return sendSuccess(reply, result);
  });

  /** Pre-meeting reminder sweep. */
  app.post("/meeting-reminders", async (_request, reply) => {
    const result = await processMeetingReminders();
    return sendSuccess(reply, result);
  });

  /** Post-meeting miss escalation (no transcript after grace → notify admins). */
  app.post("/meeting-miss-escalations", async (_request, reply) => {
    const result = await processMeetingMissEscalations();
    return sendSuccess(reply, result);
  });

  /** Pull Recall transcripts when live webhooks were missed. */
  app.post("/meeting-capture-reconcile", async (_request, reply) => {
    const result = await reconcileDueMeetingCaptures();
    return sendSuccess(reply, result);
  });

  /** Drain lead enrichment queue. Optional `?limit=` caps batch size (e2e / manual drain). */
  app.post("/lead-enrichment", async (request, reply) => {
    const result = await processDueLeadEnrichmentJobs(parseCronLimit(request));
    return sendSuccess(reply, result);
  });

  /** Enqueue enrichment for recent contact_profiles missing a job row. */
  app.post("/lead-enrichment-reconcile", async (_request, reply) => {
    const result = await reconcileMissingLeadEnrichmentJobs(100);
    return sendSuccess(reply, result);
  });

  /** Drain lead scoring queue. Optional `?limit=` caps batch size (e2e / manual drain). */
  app.post("/lead-scoring", async (request, reply) => {
    const result = await processDueLeadScoringJobs(parseCronLimit(request));
    return sendSuccess(reply, result);
  });

  /** Drain lead nurture queue (also enqueues open cold leads). Optional `?limit=`. */
  app.post("/lead-nurture", async (request, reply) => {
    const result = await processDueLeadNurtureJobs(parseCronLimit(request));
    return sendSuccess(reply, result);
  });

  /** Recheck nurture jobs waiting for a live conversation or CDP summary. */
  app.post("/lead-nurture-conversation-gate", async (request, reply) => {
    const result = await processConversationDeferredNurtureJobs(
      parseCronLimit(request),
    );
    return sendSuccess(reply, result);
  });

  /** Drain lead lifecycle queue. */
  app.post("/lead-lifecycle", async (_request, reply) => {
    const result = await processDueLeadLifecycleJobs();
    return sendSuccess(reply, result);
  });

  /** Nightly intent decay + re-route (assign / going-cold). */
  app.post("/lead-score-decay", async (_request, reply) => {
    const result = await processLeadScoreDecay();
    return sendSuccess(reply, result);
  });

  /** Working-hours reminder: owner, then manager, then admin. Owner stays. */
  app.post("/lead-assignment-followup", async (_request, reply) => {
    const result = await processLeadAssignmentFollowups();
    return sendSuccess(reply, result);
  });

  /** Conversation summary: batch interactions for about a minute, then refresh. */
  app.post("/lead-summary-refresh", async (_request, reply) => {
    const result = await processLeadSummaryRefreshes();
    return sendSuccess(reply, result);
  });

  /** Disposition: one outcome word on each email, call, meeting, or message. */
  app.post("/disposition", async (_request, reply) => {
    const result = await processDispositionSweep();
    return sendSuccess(reply, result);
  });

  /** Stall detection — quiet leads / stuck deals → flag_for_review. */
  app.post("/lifecycle-stall", async (_request, reply) => {
    const [stall, salesExecution] = await Promise.all([
      processLifecycleStallFlags(),
      processSalesExecutionEscalations(),
    ]);
    return sendSuccess(reply, { ...stall, ...salesExecution });
  });

  /** Pipeline Forecast Auditor — judges stage/close-date realism per open deal. */
  app.post("/pipeline-forecast", async (_request, reply) => {
    const result = await processPipelineForecastSweep();
    return sendSuccess(reply, result);
  });

  /** Invoice Escalation — flips overdue invoices, then judges collections risk. */
  app.post("/invoice-escalation", async (_request, reply) => {
    const result = await processInvoiceEscalationSweep();
    return sendSuccess(reply, result);
  });

  /** Backfill companies from contact names. Not part of GET /api/companies. */
  app.post("/company-contact-sync", async (_request, reply) => {
    const result = await syncCompaniesFromContactsSweep();
    return sendSuccess(reply, result);
  });

  /** Company Collection Risk — aggregates a company's whole invoice history into a risk band. */
  app.post("/company-collection-risk", async (_request, reply) => {
    const result = await processCompanyCollectionRiskSweep();
    return sendSuccess(reply, result);
  });

  /** Revenue Gap Forecast — collected revenue vs. optional target + at-risk invoices. */
  app.post("/revenue-gap-forecast", async (_request, reply) => {
    const result = await processRevenueGapForecastSweep();
    return sendSuccess(reply, result);
  });

  /** Invoice Dunning — staged reminder->warning->pause_notice cadence. */
  app.post("/invoice-dunning", async (_request, reply) => {
    const result = await processInvoiceDunningSweep();
    return sendSuccess(reply, result);
  });

  /** Expansion & Revenue Matcher — judges upsell/cross-sell signal on closed-won accounts. */
  app.post("/expansion-matcher", async (_request, reply) => {
    const result = await processExpansionMatcherSweep();
    return sendSuccess(reply, result);
  });

  /** Contract renewals — create renewal deals (+ optional renewal quotes). */
  app.post<{ Querystring: { organizationId?: string } }>(
    "/contract-renewals",
    async (request, reply) => {
      const { processRenewals } = await import("@/dao/sales/renewal-service");
      const result = await processRenewals(request.query.organizationId);
      return sendSuccess(reply, result);
    },
  );

  /** Billing schedules — generate draft invoices from due schedule rows. */
  app.post<{ Querystring: { organizationId?: string } }>(
    "/billing-schedules",
    async (request, reply) => {
      const { processBillingSchedules } = await import(
        "@/dao/finance/billing-schedule-service"
      );
      const result = await processBillingSchedules(request.query.organizationId);
      return sendSuccess(reply, result);
    },
  );

  /** Renew Gmail Pub/Sub watches (expires ~7 days). */
  app.post("/gmail-push-renew", async (_request, reply) => {
    const { renewExpiringGmailPushWatches, bootstrapGmailPushWatches } =
      await import("@/service/inbox/gmail-push");
    const renewed = await renewExpiringGmailPushWatches();
    const bootstrap = await bootstrapGmailPushWatches();
    return sendSuccess(reply, { renewed, bootstrap });
  });

  /** Renew Google Calendar events.watch channels (expires ~7 days). */
  app.post("/calendar-push-renew", async (_request, reply) => {
    const {
      renewExpiringGoogleCalendarWatches,
      bootstrapGoogleCalendarWatches,
    } = await import("@/service/calendar/google-calendar-push");
    const renewed = await renewExpiringGoogleCalendarWatches();
    const bootstrap = await bootstrapGoogleCalendarWatches();
    return sendSuccess(reply, { renewed, bootstrap });
  });

  /** Semrush MCP → crm.seo_* cache (Monday 04:00 IST gate inside job). */
  app.post("/seo-semrush-sync", async (_request, reply) => {
    const { processSeoSemrushWeeklySweep } = await import(
      "@/service/seo/semrush-sync-job"
    );
    const result = await processSeoSemrushWeeklySweep();
    return sendSuccess(reply, result);
  });

  /** Due coworker customer emails (scheduled_outbound_emails.send_at). */
  app.post("/scheduled-outbound-email", async (_request, reply) => {
    const { processDueScheduledOutboundEmails } = await import(
      "@/service/inbox/scheduled-outbound-email"
    );
    const result = await processDueScheduledOutboundEmails();
    return sendSuccess(reply, result);
  });

  /** Due Digital Marketing social posts with scheduled_at. */
  app.post("/seo-social-publish", async (_request, reply) => {
    const { processDueSeoSocialPublishes } = await import(
      "@/service/seo/social-publish-job"
    );
    const result = await processDueSeoSocialPublishes();
    return sendSuccess(reply, result);
  });

  /** Bootstrap / force Semrush sync (ignores week/hour gate). */
  app.post<{
    Querystring: { organizationId?: string; adHocDomain?: string };
  }>("/seo-semrush-bootstrap", async (request, reply) => {
    const { processSeoSemrushBootstrap } = await import(
      "@/service/seo/semrush-sync-job"
    );
    const result = await processSeoSemrushBootstrap({
      organizationId: request.query.organizationId,
      adHocDomain: request.query.adHocDomain,
    });
    return sendSuccess(reply, result);
  });
};
