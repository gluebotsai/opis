// @ts-nocheck — worktual_bigint Prisma BigInt ids; runtime coerced to string in plugins/prisma.ts
import type { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { requireSession } from "../../middlewares/authendication.js";
import {
  createCampaignDao,
  getCampaignByIdDao,
  getDashboardCountsDao,
  listCampaignsByBucketDao,
  type ListCampaignsOptions,
  saveCampaignFromSessionDao,
  setCampaignChannelRunStateDao,
  stopCampaignDao,
  type MonitorBucket,
} from "../../dao/campaign.js";
import {
  resolveCampaignDataScope,
  scopeAppliedLabel,
} from "../../helpers/campaign-visibility.js";
import {
  aggregatePortfolioFromListItems,
  portfolioTotalsAgentShape,
} from "../../dao/portfolio-metrics.js";
import {
  getCampaignLiveStatusDao,
  listActiveLiveSendsDao,
  listRecentSendFailuresDao,
} from "../../dao/campaign-live-status.js";
import { getCampaignOpsFeedDao } from "../../dao/campaign-ops-feed.js";
import { getPortfolioActivitySeriesDao } from "../../dao/portfolio-activity-series.js";
import { getPortfolioPerformanceDao } from "../../dao/portfolio-performance.js";
import { parseAllowedChannelsParam } from "../../helpers/portfolio-query.js";
import { resolveEmailAbWinnerDao } from "../../dao/email-ab-run.js";
import {
  markRecipientClicked,
  markRecipientOpened,
  markRecipientEmailUnsubscribed,
} from "../../dao/campaign-contact-engagement.js";
import {
  safeTrackRedirect,
  trackingPixelGif,
} from "../../helpers/email-track.js";
import { checkCampaignDesignDao } from "../../dao/campaign-design.js";
import { getSendTimeInsightDao } from "../../dao/send-time-insight.js";
import { listTemplateComplianceIssuesDao } from "../../dao/template-compliance.js";
import { planChannelOrchestrationDao } from "../../dao/channel-orchestration.js";
import { scheduleEmailCampaignBatchesDao } from "../../dao/email-launch.js";
import {
  assertEmailSendPipelineReady,
  isEmailSendPipelineFailure,
} from "../../helpers/email-send-pipeline-ready.js";
import { getCampaignRecipientsDao } from "../../dao/campaign-recipients.js";
import { sanitizeUserFacingError } from "../../helpers/user-facing-error.js";
import { schedulePushCampaignBatchesDao } from "../../dao/push-launch.js";
import { markCampaignSendPlannedDao } from "../../dao/launch-send.js";
import { isPushAgentChannel, toAgentChannel } from "../../helpers/channel-ids.js";
import {
  listWhatsAppApprovalNotificationsDao,
  scheduleWhatsAppCampaignBatchesDao,
} from "../../dao/whatsapp-launch.js";
import {
  abWinnerBodySchema,
  campaignIdParamSchema,
  channelRunStateBodySchema,
  channelRunStateParamSchema,
  createCampaignBodySchema,
  monitorBucketSchema,
  onDemandLaunchBodySchema,
  onDemandAcceptBodySchema,
  personalisedCrmLaunchBodySchema,
  personalisedCrmAutomationBodySchema,
  saveFromSessionBodySchema,
  sessionIdParamSchema,
  stopCampaignBodySchema,
} from "./schema.js";
import { AppError, sendSuccess } from "../../helpers/response-builders.js";
import { RESPONSE } from "../../helpers/constants.js";
import {
  acceptOnDemandFromHubDao,
  createOnDemandLaunchDao,
  getOnDemandRunDao,
  listOnDemandRunsDao,
} from "../../dao/on-demand-launch.js";
import {
  createPersonalisedCrmLaunchDao,
  getPersonalisedCrmRecipientsDao,
  getPersonalisedCrmRunDao,
  listPersonalisedCrmRunsDao,
} from "../../dao/personalised-crm-launch.js";
import { buildSessionFromCrmAutomation } from "../../dao/crm-session.js";
import { requireCrmIntegrationKey } from "../../helpers/internal-service-auth.js";

import { zContactId, zDbId } from "../../helpers/id-schema.js";

const designCheckBody = z.object({
  channels: z.array(z.string()).max(20).default([]),
  contact_ids: z.array(zContactId).max(5000).default([]),
  template_channels: z.array(z.string()).max(20).optional(),
});

const orchestrationCheckBody = z.object({
  channels: z.array(z.string()).max(20).default([]),
  primary_channel: z.string().trim().max(32).optional().nullable(),
  orchestration_mode: z
    .enum(["broadcast", "prefer_primary", "staggered"])
    .optional()
    .nullable(),
  audience_count: z.number().int().nonnegative().optional().nullable(),
  broadcast_confirmed: z.boolean().optional().nullable(),
});

/** Soft CDA — readiness warnings only; never blocks. */
export async function campaignDesignCheckHandler(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const session = requireSession(request);
  const parsed = designCheckBody.safeParse(request.body ?? {});
  if (!parsed.success) {
    throw new AppError(
      parsed.error.issues[0]?.message ?? RESPONSE.bad_request,
    );
  }
  const result = await checkCampaignDesignDao(session, {
    channels: parsed.data.channels,
    contactIds: parsed.data.contact_ids,
    templateChannels: parsed.data.template_channels,
  });
  return sendSuccess(reply, "Campaign design check", {
    design: result,
  });
}

export async function sendTimeInsightHandler(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const session = requireSession(request);
  const q = (request.query || {}) as { timezone?: string };
  const insight = await getSendTimeInsightDao(
    session.organizationId,
    q.timezone || null,
  );
  return sendSuccess(reply, RESPONSE.sendTimeInsightSuccess, { insight });
}

export async function templateComplianceHandler(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const session = requireSession(request);
  const all = await listTemplateComplianceIssuesDao();
  const issues = all.filter((i) => i.organizationId === session.organizationId);
  return sendSuccess(reply, RESPONSE.templateComplianceSuccess, {
    issues,
    count: issues.length,
  });
}

/** Soft PDOA — multi-channel overlap + send strategy; never blocks. */
export async function campaignOrchestrationCheckHandler(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const session = requireSession(request);
  const parsed = orchestrationCheckBody.safeParse(request.body ?? {});
  if (!parsed.success) {
    throw new AppError(
      parsed.error.issues[0]?.message ?? RESPONSE.bad_request,
    );
  }
  const result = await planChannelOrchestrationDao(session, {
    channels: parsed.data.channels,
    primaryChannel: parsed.data.primary_channel,
    orchestrationMode: parsed.data.orchestration_mode,
    audienceCount: parsed.data.audience_count,
    broadcastConfirmed: parsed.data.broadcast_confirmed,
  });
  return sendSuccess(reply, "Channel orchestration check", {
    orchestration: result,
  });
}

export async function createCampaignHandler(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const session = requireSession(request);
  const parsed = createCampaignBodySchema.safeParse(request.body);
  if (!parsed.success) {
    throw new AppError(parsed.error.issues[0]?.message ?? RESPONSE.bad_request);
  }
  const result = await createCampaignDao(session, parsed.data);
  return sendSuccess(reply, RESPONSE.insertCampaign, { id: result.id }, 200);
}

export async function saveCampaignFromSessionHandler(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const session = requireSession(request);
  const params = sessionIdParamSchema.safeParse(request.params);
  if (!params.success) {
    throw new AppError(params.error.issues[0]?.message ?? RESPONSE.bad_request);
  }
  const body = saveFromSessionBodySchema.safeParse(request.body ?? {});
  if (!body.success) {
    throw new AppError(body.error.issues[0]?.message ?? RESPONSE.bad_request);
  }

  const launchChannelsEarly = body.data.channels || [];
  const wantsEmailLaunch = launchChannelsEarly.some(
    (c) => toAgentChannel(c.channel) === "email",
  );
  const launchStatusEarly = String(body.data.status || "").toLowerCase();
  if (
    wantsEmailLaunch &&
    (launchStatusEarly === "live" || launchStatusEarly === "scheduled")
  ) {
    await assertEmailSendPipelineReady(session);
  }

  const result = await saveCampaignFromSessionDao(
    session,
    params.data.sessionId,
    body.data,
  );

  let email_send_plan: unknown = null;
  let email_send_warning: string | null = null;
  try {
    const planned = await scheduleEmailCampaignBatchesDao(session, result.id);
    email_send_plan = planned;
    if (
      planned &&
      typeof planned === "object" &&
      (planned as { reason?: string; skipped?: number }).reason ===
        "no_destinations"
    ) {
      const skipped = Number(
        (planned as { skipped?: number }).skipped || 0,
      );
      email_send_warning = skipped
        ? "No selected contacts have an email address. Email was skipped for this launch."
        : "No contacts were frozen on this campaign. Email was not queued.";
    }
  } catch (err) {
    if (isEmailSendPipelineFailure(err)) throw err;
    email_send_warning = sanitizeUserFacingError(
      err instanceof AppError
        ? err.message
        : err instanceof Error
          ? err.message
          : "Failed to plan email batches",
      "Failed to plan email batches",
    );
  }

  let push_send_plan: unknown = null;
  let push_send_warning: string | null = null;
  try {
    const planned = await schedulePushCampaignBatchesDao(session, result.id);
    push_send_plan = planned;
    if (planned.warnings?.length) {
      push_send_warning = sanitizeUserFacingError(
        planned.warnings.join(" "),
        "Push send warning",
      );
    }
  } catch (err) {
    push_send_warning = sanitizeUserFacingError(
      err instanceof AppError
        ? err.message
        : err instanceof Error
          ? err.message
          : "Failed to plan push batches",
      "Failed to plan push batches",
    );
  }

  const launchChannels = body.data.channels || [];
  const wantsEmail = launchChannels.some(
    (c) => toAgentChannel(c.channel) === "email",
  );
  const wantsWeb = launchChannels.some(
    (c) => toAgentChannel(c.channel) === "web",
  );
  const wantsApp = launchChannels.some(
    (c) => toAgentChannel(c.channel) === "push",
  );
  const wantsWhatsApp = launchChannels.some(
    (c) => toAgentChannel(c.channel) === "whatsapp",
  );
  const wantsPush = (body.data.channels || []).some((c) =>
    isPushAgentChannel(c.channel),
  );
  const launchStatus = String(body.data.status || "").toLowerCase();
  const emailPlan = email_send_plan as
    | {
        scheduled?: boolean;
        reason?: string;
        skipped?: number;
      }
    | null;
  const email_queued = wantsEmail
    ? Boolean(
        emailPlan?.scheduled || emailPlan?.reason === "already_planned",
      )
    : null;
  if (
    wantsEmail &&
    (launchStatus === "live" || launchStatus === "scheduled") &&
    !email_queued &&
    !email_send_warning
  ) {
    const reason = String(emailPlan?.reason || "").trim();
    email_send_warning =
      reason === "no_email_channel"
        ? "Email channel was missing on the saved campaign. Email was not queued."
        : reason === "not_scheduled"
          ? "Campaign status blocked email batch planning. Email was not queued."
          : reason
            ? `Email was not queued (${reason}).`
            : "Email was not queued — send planning failed.";
  }
  const pushPlan = push_send_plan as
    | {
        scheduled?: boolean;
        reason?: string;
        plans?: Array<{ scheduled?: boolean; reason?: string }>;
      }
    | null;
  const push_queued = wantsPush
    ? Boolean(
        pushPlan?.scheduled ||
          pushPlan?.reason === "already_planned" ||
          (pushPlan?.plans || []).some(
            (p) => p?.scheduled || p?.reason === "already_planned",
          ),
      )
    : null;
  if (
    wantsPush &&
    (launchStatus === "live" || launchStatus === "scheduled") &&
    !push_queued &&
    !push_send_warning
  ) {
    push_send_warning = wantsWeb && !wantsApp
      ? "Web Push was not queued. The contact needs Allow notifications on the website with the same email or phone."
      : "App Push was not queued. Register a real device token (same as Configuration → Run test) or try launch again.";
  }

  let whatsapp_send_plan: unknown = null;
  let whatsapp_send_warning: string | null = null;
  try {
    const planned = await scheduleWhatsAppCampaignBatchesDao(
      session,
      result.id,
    );
    whatsapp_send_plan = planned;
    if (
      planned &&
      typeof planned === "object" &&
      (planned as { reason?: string }).reason === "no_destinations"
    ) {
      whatsapp_send_warning =
        "No selected contacts have a phone number. WhatsApp was skipped for this launch.";
    }
  } catch (err) {
    whatsapp_send_warning = sanitizeUserFacingError(
      err instanceof AppError
        ? err.message
        : err instanceof Error
          ? err.message
          : "Failed to plan WhatsApp batches",
      "Failed to plan WhatsApp batches",
    );
  }

  const waPlan = whatsapp_send_plan as
    | { scheduled?: boolean; reason?: string }
    | null;
  const whatsapp_ok =
    !wantsWhatsApp ||
    Boolean(waPlan?.scheduled) ||
    waPlan?.reason === "already_planned" ||
    waPlan?.reason === "no_destinations" ||
    Boolean(whatsapp_send_warning);

  // Close planning grace only after every requested channel is queued,
  // already planned, or intentionally skipped (no destinations).
  // Transient plan failures keep grace open so lifecycle does not flip to Past.
  const emailPlanningDone =
    !wantsEmail ||
    Boolean(email_queued) ||
    emailPlan?.reason === "no_destinations";
  const pushPlanningDone =
    !wantsPush || Boolean(push_queued) || Boolean(push_send_warning);
  if (emailPlanningDone && pushPlanningDone && whatsapp_ok) {
    await markCampaignSendPlannedDao(result.id).catch(() => undefined);
  }

  return sendSuccess(reply, RESPONSE.saveCampaignFromSession, {
    campaign: result,
    email_send_plan,
    email_send_warning,
    email_queued,
    push_send_plan,
    push_send_warning,
    push_queued,
    whatsapp_send_plan,
    whatsapp_send_warning,
  });
}

export async function createOnDemandLaunchHandler(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const session = requireSession(request);
  const parsed = onDemandLaunchBodySchema.safeParse(request.body ?? {});
  if (!parsed.success) {
    throw new AppError(parsed.error.issues[0]?.message ?? RESPONSE.bad_request);
  }
  try {
    const result = await createOnDemandLaunchDao(session, parsed.data);
    return sendSuccess(reply, RESPONSE.onDemandLaunch, result);
  } catch (err) {
    if (err instanceof AppError) throw err;
    console.error("[on-demand-launch]", err);
    const detail =
      err instanceof Error ? err.message : "On-demand launch failed unexpectedly";
    throw new AppError(detail, 502, "ON_DEMAND_LAUNCH_FAILED");
  }
}

/** Hub/spoke: accept payload, ack received — no further hub communication. */
export async function acceptOnDemandFromHubHandler(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const session = requireSession(request);
  const parsed = onDemandAcceptBodySchema.safeParse(request.body ?? {});
  if (!parsed.success) {
    throw new AppError(parsed.error.issues[0]?.message ?? RESPONSE.bad_request);
  }
  const result = await acceptOnDemandFromHubDao(session, {
    ...parsed.data,
    request_text:
      parsed.data.request_text?.trim() ||
      `Hub on-demand for ${(parsed.data.customer_ids || parsed.data.contact_ids || []).join(", ") || "audience"}`,
  });
  return sendSuccess(reply, RESPONSE.onDemandAccepted, result, 202);
}

export async function listOnDemandRunsHandler(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const session = requireSession(request);
  const runs = await listOnDemandRunsDao(session);
  return sendSuccess(reply, RESPONSE.onDemandList, { runs });
}

export async function getOnDemandRunHandler(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const session = requireSession(request);
  const params = campaignIdParamSchema.safeParse(request.params);
  if (!params.success) {
    throw new AppError(params.error.issues[0]?.message ?? RESPONSE.bad_request);
  }
  const run = await getOnDemandRunDao(session, params.data.id);
  return sendSuccess(reply, RESPONSE.onDemandGet, { run });
}

export async function createPersonalisedCrmLaunchHandler(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const session = requireSession(request);
  const parsed = personalisedCrmLaunchBodySchema.safeParse(request.body ?? {});
  if (!parsed.success) {
    throw new AppError(parsed.error.issues[0]?.message ?? RESPONSE.bad_request);
  }
  try {
    const result = await createPersonalisedCrmLaunchDao(session, parsed.data);
    return sendSuccess(reply, RESPONSE.personalisedCrmAccepted, result, 202);
  } catch (err) {
    if (err instanceof AppError) throw err;
    console.error("[personalised-crm-launch]", err);
    const detail =
      err instanceof Error
        ? err.message
        : "Personalised CRM launch failed unexpectedly";
    throw new AppError(detail, 502, "PERSONALISED_CRM_LAUNCH_FAILED");
  }
}

/** CRM monitor/agent: X-Crm-Integration-Key + organization_id. acting_user_id optional. */
export async function createPersonalisedCrmAutomationHandler(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  requireCrmIntegrationKey(request);
  const parsed = personalisedCrmAutomationBodySchema.safeParse(
    request.body ?? {},
  );
  if (!parsed.success) {
    throw new AppError(parsed.error.issues[0]?.message ?? RESPONSE.bad_request);
  }
  const { organization_id, acting_user_id, ...input } = parsed.data;
  const session = await buildSessionFromCrmAutomation(
    organization_id,
    acting_user_id,
  );
  request.userSession = session;
  try {
    const result = await createPersonalisedCrmLaunchDao(session, input);
    return sendSuccess(reply, RESPONSE.personalisedCrmAccepted, result, 202);
  } catch (err) {
    if (err instanceof AppError) throw err;
    console.error("[personalised-crm-automation]", err);
    const detail =
      err instanceof Error
        ? err.message
        : "Personalised CRM launch failed unexpectedly";
    throw new AppError(detail, 502, "PERSONALISED_CRM_LAUNCH_FAILED");
  }
}

export async function listPersonalisedCrmRunsHandler(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const session = requireSession(request);
  const runs = await listPersonalisedCrmRunsDao(session);
  return sendSuccess(reply, RESPONSE.personalisedCrmList, { runs });
}

export async function getPersonalisedCrmRunHandler(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const session = requireSession(request);
  const params = campaignIdParamSchema.safeParse(request.params);
  if (!params.success) {
    throw new AppError(params.error.issues[0]?.message ?? RESPONSE.bad_request);
  }
  const run = await getPersonalisedCrmRunDao(session, params.data.id);
  return sendSuccess(reply, RESPONSE.personalisedCrmGet, { run });
}

export async function getPersonalisedCrmRecipientsHandler(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const session = requireSession(request);
  const params = campaignIdParamSchema.safeParse(request.params);
  if (!params.success) {
    throw new AppError(params.error.issues[0]?.message ?? RESPONSE.bad_request);
  }
  const q =
    typeof request.query === "object" && request.query
      ? (request.query as Record<string, unknown>)
      : {};
  const channel = q.channel != null ? String(q.channel) : null;
  let limit = 200;
  try {
    if (q.limit != null) limit = Number(q.limit);
  } catch {
    limit = 200;
  }
  const report = await getPersonalisedCrmRecipientsDao(
    session,
    params.data.id,
    { channel, limit },
  );
  return sendSuccess(reply, RESPONSE.personalisedCrmRecipients, report);
}

export async function listWhatsAppApprovalNotificationsHandler(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const session = requireSession(request);
  const notifications = await listWhatsAppApprovalNotificationsDao(session);
  return sendSuccess(reply, RESPONSE.whatsappApprovalNotifications, {
    notifications,
  });
}

function parseListCampaignQuery(q: Record<string, unknown>): ListCampaignsOptions & {
  bucket: MonitorBucket;
} {
  const bucketRaw = String(q.bucket ?? "live");
  const bucket = monitorBucketSchema.safeParse(bucketRaw);
  if (!bucket.success) {
    throw new AppError(
      "Invalid bucket. Use live | scheduled | past | draft | all | calendar.",
    );
  }
  const relativeRaw = q.relative != null ? String(q.relative) : null;
  const relative =
    relativeRaw &&
    ["today", "yesterday", "last_7_days", "last_month"].includes(relativeRaw)
      ? (relativeRaw as
          | "today"
          | "yesterday"
          | "last_7_days"
          | "last_month")
      : null;
  const lite =
    q.lite === "1" || q.lite === "true" || q.lite === "yes";
  return {
    bucket: bucket.data as MonitorBucket,
    fromDate: q.from != null ? String(q.from) : null,
    toDate: q.to != null ? String(q.to) : null,
    relative,
    lite,
  };
}

export async function listCampaignsHandler(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const session = requireSession(request);
  const q =
    typeof request.query === "object" && request.query
      ? (request.query as Record<string, unknown>)
      : {};
  const opts = parseListCampaignQuery(q);
  const items = await listCampaignsByBucketDao(session, opts);
  const includePortfolio =
    q.portfolio === "1" || q.portfolio === "true" || q.portfolio === "yes";
  const allowedChannels = parseAllowedChannelsParam(q.channels);
  const portfolioTotals = includePortfolio
    ? portfolioTotalsAgentShape(
        aggregatePortfolioFromListItems(items, {
          excludePpcOnly: true,
          allowedChannels,
        }),
      )
    : undefined;
  if (!items.length) {
    return sendSuccess(reply, RESPONSE.getCampaignSuccess, {
      getCampaignDetails: [],
      ...(portfolioTotals ? { portfolio_totals: portfolioTotals } : {}),
    });
  }
  return sendSuccess(reply, RESPONSE.getCampaignSuccess, {
    getCampaignDetails: items,
    ...(portfolioTotals ? { portfolio_totals: portfolioTotals } : {}),
  });
}

export async function portfolioMetricsHandler(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const session = requireSession(request);
  const q =
    typeof request.query === "object" && request.query
      ? (request.query as Record<string, unknown>)
      : {};
  const opts = parseListCampaignQuery({ ...q, bucket: q.bucket ?? "all" });
  const allowedChannels = parseAllowedChannelsParam(q.channels);
  const perf = await getPortfolioPerformanceDao(session, {
    mode: "launch",
    relative: opts.relative ?? (q.relative != null ? String(q.relative) : null),
    fromDate: opts.fromDate,
    toDate: opts.toDate,
    allowedChannels,
    listOpts: opts,
  });
  return sendSuccess(reply, RESPONSE.getCampaignSuccess, {
    portfolio_totals: perf.portfolio_totals,
    campaigns_matched: perf.campaigns_matched,
    scope_applied: perf.scope_applied,
    scope_label: perf.scope_label,
  });
}

export async function portfolioPerformanceHandler(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const session = requireSession(request);
  const q =
    typeof request.query === "object" && request.query
      ? (request.query as Record<string, unknown>)
      : {};
  const opts = parseListCampaignQuery({ ...q, bucket: q.bucket ?? "all" });
  const allowedChannels = parseAllowedChannelsParam(q.channels);
  const modeRaw = String(q.mode || "launch").trim().toLowerCase();
  const mode = modeRaw === "activity" ? "activity" : "launch";
  const activityFrom =
    q.activity_from != null ? String(q.activity_from) : null;
  const activityTo = q.activity_to != null ? String(q.activity_to) : null;
  const data = await getPortfolioPerformanceDao(session, {
    mode,
    relative: opts.relative ?? (q.relative != null ? String(q.relative) : null),
    fromDate: opts.fromDate,
    toDate: opts.toDate,
    activityFromDate: activityFrom,
    activityToDate: activityTo,
    allowedChannels,
    listOpts: opts,
  });
  return sendSuccess(reply, RESPONSE.getCampaignSuccess, data);
}

export async function campaignLiveStatusHandler(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const session = requireSession(request);
  const params = campaignIdParamSchema.safeParse(request.params);
  if (!params.success) {
    throw new AppError(params.error.issues[0]?.message ?? RESPONSE.bad_request);
  }
  const data = await getCampaignLiveStatusDao(session, params.data.id);
  return sendSuccess(reply, RESPONSE.getCampaignSuccess, data);
}

export async function recentSendFailuresHandler(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const session = requireSession(request);
  const q =
    typeof request.query === "object" && request.query
      ? (request.query as Record<string, unknown>)
      : {};
  const data = await listRecentSendFailuresDao(session, {
    campaignId: q.campaign_id != null ? String(q.campaign_id) : null,
    channel: q.channel != null ? String(q.channel) : null,
    limit: q.limit != null ? Number(q.limit) : undefined,
  });
  return sendSuccess(reply, RESPONSE.getCampaignSuccess, data);
}

export async function activeLiveSendsHandler(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const session = requireSession(request);
  const q =
    typeof request.query === "object" && request.query
      ? (request.query as Record<string, unknown>)
      : {};
  const limit = q.limit != null ? Number(q.limit) : 10;
  const data = await listActiveLiveSendsDao(session, limit);
  return sendSuccess(reply, RESPONSE.getCampaignSuccess, data);
}

export async function portfolioActivitySeriesHandler(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const session = requireSession(request);
  const q =
    typeof request.query === "object" && request.query
      ? (request.query as Record<string, unknown>)
      : {};
  const data = await getPortfolioActivitySeriesDao(session, {
    relative: q.relative != null ? String(q.relative) : null,
    fromDate: q.from != null ? String(q.from) : null,
    toDate: q.to != null ? String(q.to) : null,
    allowedChannels: parseAllowedChannelsParam(q.channels),
  });
  return sendSuccess(reply, RESPONSE.getCampaignSuccess, data);
}

function parseOpsFeedQuery(request: FastifyRequest) {
  const q =
    typeof request.query === "object" && request.query
      ? (request.query as Record<string, unknown>)
      : {};
  return {
    relative: q.relative != null ? String(q.relative) : null,
    fromDate: q.from != null ? String(q.from) : null,
    toDate: q.to != null ? String(q.to) : null,
    activityFromDate:
      q.activity_from != null ? String(q.activity_from) : null,
    activityToDate: q.activity_to != null ? String(q.activity_to) : null,
    allowedChannels: parseAllowedChannelsParam(q.channels),
    liveLimit: q.live_limit != null ? Number(q.live_limit) : undefined,
    failureLimit: q.failure_limit != null ? Number(q.failure_limit) : undefined,
  };
}

export async function campaignOpsFeedHandler(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const session = requireSession(request);
  const data = await getCampaignOpsFeedDao(session, parseOpsFeedQuery(request));
  return sendSuccess(reply, RESPONSE.getCampaignSuccess, data);
}

/** SSE push for Dashboard live ops — same payload as GET /ops-feed. */
export async function campaignOpsFeedStreamHandler(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const session = requireSession(request);
  const feedInput = parseOpsFeedQuery(request);

  reply.hijack();
  reply.raw.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  reply.raw.write(": connected\n\n");

  let closed = false;
  const onClose = () => {
    closed = true;
  };
  request.raw.on("close", onClose);
  request.raw.on("error", onClose);

  const push = async () => {
    if (closed) return;
    try {
      const data = await getCampaignOpsFeedDao(session, feedInput);
      const active = Array.isArray(data.active_sends)
        ? data.active_sends.length
        : 0;
      reply.raw.write("event: ops\n");
      reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
      return active;
    } catch {
      if (!closed) {
        reply.raw.write("event: error\n");
        reply.raw.write(`data: ${JSON.stringify({ message: "ops_feed_failed" })}\n\n`);
      }
      return 0;
    }
  };

  let tickMs = 30_000;
  let timer: ReturnType<typeof setInterval> | null = null;

  const schedule = (ms: number) => {
    if (timer) clearInterval(timer);
    tickMs = ms;
    timer = setInterval(() => {
      void push().then((active) => {
        if (closed || !timer) return;
        const next = active > 0 ? 8_000 : 30_000;
        if (next !== tickMs) schedule(next);
      });
    }, ms);
  };

  const initialActive = await push();
  schedule(initialActive > 0 ? 8_000 : 30_000);

  request.raw.on("close", () => {
    if (timer) clearInterval(timer);
  });
}

export async function getCampaignHandler(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const session = requireSession(request);
  const params = campaignIdParamSchema.safeParse(request.params);
  if (!params.success) {
    throw new AppError(params.error.issues[0]?.message ?? RESPONSE.bad_request);
  }
  const campaign = await getCampaignByIdDao(session, params.data.id);
  return sendSuccess(reply, RESPONSE.getCampaignSuccess, { campaign });
}

export async function getCampaignRecipientsHandler(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const session = requireSession(request);
  const params = campaignIdParamSchema.safeParse(request.params);
  if (!params.success) {
    throw new AppError(params.error.issues[0]?.message ?? RESPONSE.bad_request);
  }
  const q =
    typeof request.query === "object" && request.query
      ? (request.query as Record<string, unknown>)
      : {};
  const channel = q.channel != null ? String(q.channel) : null;
  let limit = 200;
  try {
    if (q.limit != null) limit = Number(q.limit);
  } catch {
    limit = 200;
  }
  const report = await getCampaignRecipientsDao(session, params.data.id, {
    channel,
    limit,
  });
  return sendSuccess(reply, RESPONSE.getCampaignRecipientsSuccess, report);
}

const recipientIdParam = z.object({
  recipientId: zDbId,
});

function applyPublicTrackHeaders(reply: FastifyReply) {
  reply.header("Access-Control-Allow-Origin", "*");
  reply.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  reply.header("Access-Control-Allow-Headers", "Content-Type");
  reply.header("Cache-Control", "no-store, no-cache, must-revalidate, private");
}

export async function trackPublicOptionsHandler(
  _request: FastifyRequest,
  reply: FastifyReply,
) {
  applyPublicTrackHeaders(reply);
  return reply.status(204).send();
}

/** Public 1×1 gif — records email open for A/B + metrics. */
export async function trackEmailOpenHandler(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const params = recipientIdParam.safeParse(request.params);
  if (params.success) {
    await markRecipientOpened(params.data.recipientId).catch(() => false);
  }
  applyPublicTrackHeaders(reply);
  reply.header("Content-Type", "image/gif");
  return reply.send(trackingPixelGif());
}

/** Public click redirect — records click then sends the user onward. */
export async function trackEmailClickHandler(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const params = recipientIdParam.safeParse(request.params);
  if (params.success) {
    await markRecipientClicked(params.data.recipientId).catch(() => false);
  }
  applyPublicTrackHeaders(reply);
  const query = (request.query || {}) as Record<string, unknown>;
  const dest =
    safeTrackRedirect(query.u) ||
    safeTrackRedirect(query.url) ||
    "/";
  return reply.redirect(dest, 302);
}

/** Public app/web tap — records click on that recipient's channel only. */
export async function trackPushClickHandler(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const params = recipientIdParam.safeParse(request.params);
  if (params.success) {
    await markRecipientClicked(params.data.recipientId).catch(() => false);
  }
  applyPublicTrackHeaders(reply);
  const query = (request.query || {}) as Record<string, unknown>;
  const dest = safeTrackRedirect(query.u) || safeTrackRedirect(query.url);
  if (dest) {
    return reply.redirect(dest, 302);
  }
  return reply.status(204).send();
}

/** Public email unsubscribe — engagement + suppression; HTML confirmation page. */
export async function trackEmailUnsubscribeHandler(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const params = recipientIdParam.safeParse(request.params);
  let ok = false;
  if (params.success) {
    ok = await markRecipientEmailUnsubscribed(params.data.recipientId).catch(
      () => false,
    );
  }
  applyPublicTrackHeaders(reply);
  reply.header("Content-Type", "text/html; charset=utf-8");
  const title = ok ? "Unsubscribed" : "Link unavailable";
  const body = ok
    ? "You have been unsubscribed from campaign emails from this organization. You will not receive further marketing email."
    : "This unsubscribe link is invalid or has expired.";
  return reply.send(`<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>${title}</title>
<style>body{font-family:system-ui,sans-serif;line-height:1.5;color:#111;max-width:32rem;margin:3rem auto;padding:0 1.25rem}h1{font-size:1.25rem;margin:0 0 .75rem}p{margin:0;color:#444}</style>
</head><body><h1>${title}</h1><p>${body}</p></body></html>`);
}

export async function pickEmailAbWinnerHandler(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const session = requireSession(request);
  const params = campaignIdParamSchema.safeParse(request.params);
  if (!params.success) {
    throw new AppError(params.error.issues[0]?.message ?? RESPONSE.bad_request);
  }
  const body = abWinnerBodySchema.safeParse(request.body ?? {});
  if (!body.success) {
    throw new AppError(body.error.issues[0]?.message ?? RESPONSE.bad_request);
  }
  const result = await resolveEmailAbWinnerDao(session, params.data.id, {
    winner: body.data.winner ?? null,
    force: body.data.force ?? true,
  });
  const campaign = await getCampaignByIdDao(session, params.data.id);
  return sendSuccess(reply, RESPONSE.abWinnerSuccess, { ...result, campaign });
}

export async function setChannelRunStateHandler(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const session = requireSession(request);
  const params = channelRunStateParamSchema.safeParse(request.params);
  if (!params.success) {
    throw new AppError(params.error.issues[0]?.message ?? RESPONSE.bad_request);
  }
  const body = channelRunStateBodySchema.safeParse(request.body ?? {});
  if (!body.success) {
    throw new AppError(body.error.issues[0]?.message ?? RESPONSE.bad_request);
  }
  const campaign = await setCampaignChannelRunStateDao(
    session,
    params.data.id,
    params.data.channel,
    body.data,
  );
  return sendSuccess(reply, RESPONSE.getCampaignSuccess, { campaign });
}

export async function stopCampaignHandler(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const session = requireSession(request);
  const params = campaignIdParamSchema.safeParse(request.params);
  if (!params.success) {
    throw new AppError(params.error.issues[0]?.message ?? RESPONSE.bad_request);
  }
  const body = stopCampaignBodySchema.safeParse(request.body ?? {});
  if (!body.success) {
    throw new AppError(body.error.issues[0]?.message ?? RESPONSE.bad_request);
  }
  const result = await stopCampaignDao(session, params.data.id, body.data);
  return sendSuccess(reply, RESPONSE.stopCampaignSuccess, result);
}

export async function dashboardHandler(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const session = requireSession(request);
  const counts = await getDashboardCountsDao(session);
  const scope = resolveCampaignDataScope(session);
  return sendSuccess(reply, RESPONSE.getDashboardSuccess, {
    counts,
    scope_applied: scope,
    scope_label: scopeAppliedLabel(scope),
  });
}
