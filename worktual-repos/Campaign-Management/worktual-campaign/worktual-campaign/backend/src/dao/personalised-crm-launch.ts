// @ts-nocheck — worktual_bigint Prisma BigInt ids; runtime coerced to string in plugins/prisma.ts
import type { Prisma } from "@prisma/client";
import { prisma } from "../plugins/prisma.js";
import type { CampaignSessionUser } from "../types/auth.js";
import { AppError } from "../helpers/response-builders.js";
import { toAgentChannel } from "../helpers/channel-ids.js";
import {
  isPersonalisedCrmLaunchPlan,
  isSendableLaunchChannel,
  PERSONALISED_CRM_LAUNCH_FLAG,
  personalisedCrmLaunchPlanPrismaFilter,
} from "../helpers/launch-send-plan.js";
import {
  DEFAULT_LAUNCH_TIMEZONE,
  localPartsInZone,
  normalizeTimezone,
} from "../helpers/campaign-timezone.js";
import { resolvePersonalisedCrmSendAt } from "../helpers/personalised-crm-schedule.js";
import {
  assertEmailSendPipelineReady,
  isEmailSendPipelineFailure,
} from "../helpers/email-send-pipeline-ready.js";
import { resolveWhatsAppChannelConfigId } from "./whatsapp-channel-config.js";
import {
  engagementRatesForChannel,
  loadCampaignMetricsMap,
  type CampaignMetricTotals,
} from "./campaign-metrics.js";
import { scheduleEmailCampaignBatchesDao } from "./email-launch.js";
import { schedulePushCampaignBatchesDao } from "./push-launch.js";
import { scheduleWhatsAppCampaignBatchesDao } from "./whatsapp-launch.js";
import { markCampaignSendPlannedDao } from "./launch-send.js";
import {
  getCampaignRecipientsDao,
  type CampaignRecipientsReport,
} from "./campaign-recipients.js";
import {
  requireEmailDestinations,
  resolveOnDemandContacts,
} from "./on-demand-launch.js";
import { ON_DEMAND_CONTACT_LOOKUP_OPTS } from "./contact.js";
import {
  preparePersonalisedCrmViaAgents,
  type OnDemandPreparedTemplate,
} from "../services/personalised-crm-prepare.js";

export type PersonalisedCrmPerson = {
  contact_id?: string;
  customer_id?: string;
  id?: string;
  email?: string;
  phone?: string;
};

export type PersonalisedCrmLaunchInput = {
  name?: string | null;
  brief?: string | null;
  goal?: string | null;
  objective?: string | null;
  channels: string[];
  emails?: string[];
  phones?: string[];
  contact_ids?: string[];
  customer_ids?: string[];
  people?: PersonalisedCrmPerson[];
  send_at?: string | null;
  timezone?: string | null;
};

export type PersonalisedCrmChannelMetricView = {
  channel: string;
  sent: number;
  delivered: number;
  opens: number;
  clicks: number;
  openRate: number | null;
  clickRate: number | null;
};

export type PersonalisedCrmRunView = {
  id: string;
  title: string;
  status: string;
  origin: "crm";
  channels: string[];
  audienceCount: number;
  audienceHint: string;
  sent: number;
  failed: number;
  pending: number;
  opens: number;
  clicks: number;
  openRate: number | null;
  clickRate: number | null;
  channelMetrics: PersonalisedCrmChannelMetricView[];
  brief: string;
  subject: string;
  bodyPreview: string;
  createdAt: string;
  updatedAt: string;
  scheduledAt: string | null;
  sendAt: string | null;
  timezone: string;
  warnings: string[];
};

function flattenIdentities(input: PersonalisedCrmLaunchInput): {
  emails: string[];
  phones: string[];
  customerIds: string[];
} {
  const emails = new Set<string>();
  const phones = new Set<string>();
  const customerIds = new Set<string>();
  for (const e of input.emails || []) {
    const v = String(e || "").trim().toLowerCase();
    if (v) emails.add(v);
  }
  for (const p of input.phones || []) {
    const v = String(p || "").trim();
    if (v) phones.add(v);
  }
  for (const id of [...(input.contact_ids || []), ...(input.customer_ids || [])]) {
    const v = String(id || "").trim();
    if (v) customerIds.add(v);
  }
  for (const row of input.people || []) {
    const email = String(row.email || "").trim().toLowerCase();
    const phone = String(row.phone || "").trim();
    const cid = String(
      row.contact_id || row.customer_id || row.id || "",
    ).trim();
    if (email) emails.add(email);
    if (phone) phones.add(phone);
    if (cid) customerIds.add(cid);
  }
  return {
    emails: [...emails],
    phones: [...phones],
    customerIds: [...customerIds],
  };
}

function normalizeChannels(raw: string[] | undefined): string[] {
  const list = (raw || [])
    .map((c) => toAgentChannel(String(c || "")))
    .filter((c) => isSendableLaunchChannel(c));
  return [...new Set(list)];
}

function fieldsForChannel(
  templates: OnDemandPreparedTemplate[],
  channel: string,
): Record<string, unknown> {
  const hit = templates.find(
    (t) => toAgentChannel(t.channel) === toAgentChannel(channel),
  );
  return hit?.fields && typeof hit.fields === "object" ? hit.fields : {};
}

function emailBodyPreview(fields: Record<string, unknown>): string {
  const paragraphs = Array.isArray(fields.paragraphs)
    ? fields.paragraphs.map((p) => String(p)).filter(Boolean)
    : [];
  if (paragraphs.length) return paragraphs.join("\n\n");
  const sections = Array.isArray(fields.sections) ? fields.sections : [];
  return sections
    .flatMap((raw) => {
      if (!raw || typeof raw !== "object") return [];
      const section = raw as Record<string, unknown>;
      const content = String(section.content || "").trim();
      const items = Array.isArray(section.items)
        ? section.items.map((item) => String(item)).filter(Boolean)
        : [];
      const label = String(section.label || "").trim();
      return [content, ...items, label].filter(Boolean);
    })
    .join("\n\n");
}

async function requireChannelReadiness(
  session: CampaignSessionUser,
  channels: string[],
): Promise<void> {
  const wantsEmail = channels.some((c) => toAgentChannel(c) === "email");
  const wantsWhatsApp = channels.some((c) => toAgentChannel(c) === "whatsapp");
  if (wantsEmail) {
    await assertEmailSendPipelineReady(session);
  }
  if (wantsWhatsApp) {
    await resolveWhatsAppChannelConfigId(String(session.organizationId));
  }
}

/**
 * CRM Personalised CRM: structured people + channels + send_at.
 * Isolated from Hub on-demand and from Live / Scheduled / Past.
 */
export async function createPersonalisedCrmLaunchDao(
  session: CampaignSessionUser,
  input: PersonalisedCrmLaunchInput,
) {
  const channels = normalizeChannels(input.channels);
  if (!channels.length) {
    throw new AppError(
      "channels is required (email, whatsapp, push, and/or web).",
      400,
    );
  }

  const identities = flattenIdentities(input);
  if (
    !identities.emails.length &&
    !identities.phones.length &&
    !identities.customerIds.length
  ) {
    throw new AppError(
      "Provide at least one contact email, phone, or customer/contact id.",
      400,
    );
  }

  const schedule = resolvePersonalisedCrmSendAt({
    send_at: input.send_at,
    timezone: input.timezone,
  });
  const timezone = normalizeTimezone(schedule.timezone || DEFAULT_LAUNCH_TIMEZONE);
  const local = localPartsInZone(schedule.sendAt, timezone);

  await requireChannelReadiness(session, channels);

  let resolved: {
    contactIds: string[];
    cdpIds: string[];
    resolvedHints: string[];
    emailsOnFile: string[];
  };
  try {
    const early = await resolveOnDemandContacts(session, identities);
    const emailGate = await requireEmailDestinations(
      session,
      early.contactIds,
      channels,
      early.resolvedHints,
      ON_DEMAND_CONTACT_LOOKUP_OPTS,
      undefined,
      {
        cdpLookupIds: early.cdpIds,
        requestEmails: identities.emails,
        trustRequestEmails: true,
      },
    );
    resolved = {
      contactIds: emailGate.contactIds,
      cdpIds: early.cdpIds,
      resolvedHints: emailGate.resolvedHints,
      emailsOnFile: emailGate.emailsOnFile,
    };
  } catch (err) {
    if (err instanceof AppError) {
      throw new AppError(
        err.message
          .replace(/On-demand plan/gi, "Personalised CRM request")
          .replace(/on-demand plan/gi, "Personalised CRM request")
          .replace(/on-demand run/gi, "Personalised CRM run"),
        err.statusCode,
        err.code,
      );
    }
    throw err;
  }

  await requireChannelReadiness(session, channels);

  const brief =
    String(input.brief || input.objective || input.goal || "").trim() ||
    "Personalised CRM follow-up";
  const name =
    String(input.name || "").trim() ||
    `Personalised CRM — ${resolved.resolvedHints[0] || `${resolved.contactIds.length} contacts`}`;

  const prepare = await preparePersonalisedCrmViaAgents({
    name,
    brief,
    goal: input.goal,
    objective: input.objective,
    channels,
    emails: identities.emails.length
      ? identities.emails
      : resolved.emailsOnFile,
    phones: identities.phones,
    contact_ids: identities.customerIds,
    customer_ids: identities.customerIds,
    organization_id: String(session.organizationId || ""),
  });

  if (!prepare.ok) {
    throw new AppError(
      prepare.error || "Personalised CRM template creation failed.",
      prepare.error_code === "missing_contact_identity" ||
        prepare.error_code === "missing_channels" ||
        String(prepare.error || "").includes("No contact email")
        ? 400
        : 502,
    );
  }

  const templates: OnDemandPreparedTemplate[] = Array.isArray(prepare.templates)
    ? prepare.templates.filter((t) => t && !t.fallback && t.fields)
    : [];

  const missingChannels = channels.filter(
    (ch) =>
      !templates.some((t) => toAgentChannel(t.channel) === toAgentChannel(ch)),
  );
  if (missingChannels.length) {
    throw new AppError(
      "Creation agent did not produce usable templates for: " +
        missingChannels.join(", ") +
        ". Retry once agents are healthy.",
      502,
    );
  }

  const emailFields = fieldsForChannel(templates, "email");
  const pushFields =
    fieldsForChannel(templates, "push") || fieldsForChannel(templates, "web");
  const subject = String(emailFields.subject || "").trim();
  const bodyPreview =
    emailBodyPreview(emailFields) ||
    String(pushFields.body || "").trim() ||
    brief;

  const launchPlan: Record<string, unknown> = {
    [PERSONALISED_CRM_LAUNCH_FLAG]: true,
    origin: "crm",
    source: "crm",
    brief,
    schedule_mode: schedule.scheduleMode,
    send_at: schedule.sendAt.toISOString(),
    contact_ids: identities.customerIds,
    audience_cdp_ids: resolved.cdpIds,
    launch_channels: [...channels],
    prepared_channels: [...channels],
    template_source: "creation_agent",
    send_strategy: {
      mode: "broadcast",
      t0_channels: [...channels],
      narrative: [
        "Send strategy: CRM-requested channels",
        `Fires at ${schedule.sendAt.toISOString()}: ${channels.join(", ")}`,
      ],
    },
  };

  const created = await prisma.$transaction(async (tx) => {
    const agentSession = await tx.campaignAgentSession.create({
      data: {
        organizationId: session.organizationId,
        branchId: session.branchId,
        createdByUserId: session.id,
        module: "personalised_crm",
        stage: "launched",
        payload: {
          brief,
          channels,
          emails: identities.emails,
          phones: identities.phones,
          send_at: schedule.sendAt.toISOString(),
        } as Prisma.InputJsonValue,
      },
    });

    const templateIds: Record<string, string> = {};
    for (const channel of channels) {
      const prepared = templates.find(
        (t) => toAgentChannel(t.channel) === toAgentChannel(channel),
      );
      if (!prepared?.fields || !Object.keys(prepared.fields).length) {
        throw new AppError(
          `Missing creation-agent template for channel ${channel}.`,
          502,
        );
      }
      const tmpl = await tx.campaignChannelTemplate.create({
        data: {
          sessionId: agentSession.id,
          organizationId: session.organizationId,
          branchId: session.branchId,
          channel,
          howItWorks:
            prepared.how_it_works || `Personalised CRM ${channel}`,
          fields: prepared.fields as Prisma.InputJsonValue,
        },
      });
      templateIds[channel] = String(tmpl.id);
    }

    const campaign = await tx.campaign.create({
      data: {
        organizationId: session.organizationId,
        branchId: session.branchId,
        sessionId: agentSession.id,
        name: name.slice(0, 200),
        description: brief.slice(0, 500),
        goal: String(input.goal || prepare.campaign?.goal || brief).slice(0, 240),
        objective: String(
          input.objective || prepare.campaign?.objective || brief,
        ).slice(0, 400),
        status: schedule.status,
        startsAt: schedule.sendAt,
        sourceChannel: "crm_marketing",
        createdByUserId: session.id,
        audienceSummary: resolved.resolvedHints.slice(0, 8).join(", ") || null,
        audienceCount: resolved.contactIds.length,
        launchPlan: launchPlan as Prisma.InputJsonValue,
        timezone,
        launchLocalDate: local.date,
        launchLocalTime: local.time,
      },
    });

    await tx.campaignChannel.createMany({
      data: channels.map((channel) => ({
        campaignId: campaign.id,
        organizationId: session.organizationId,
        channel,
        templateId: templateIds[channel] || null,
        howItWorks: "Personalised CRM (CRM-requested channels)",
        status: "ready",
      })),
    });

    await tx.campaignAudience.createMany({
      data: resolved.contactIds.map((contactId) => ({
        campaignId: campaign.id,
        contactId,
      })),
      skipDuplicates: true,
    });

    return {
      campaignId: String(campaign.id),
      channels,
      audienceCount: resolved.contactIds.length,
      audienceHint: resolved.resolvedHints.slice(0, 5).join(", "),
      subject,
      bodyPreview,
      name,
      createdAt: new Date().toISOString(),
    };
  });

  const warnings: string[] = [];
  let emailDestinationsFailed = false;

  try {
    const emailPlan = await scheduleEmailCampaignBatchesDao(
      session,
      created.campaignId,
    );
    const planObj =
      emailPlan && typeof emailPlan === "object"
        ? (emailPlan as { scheduled?: boolean; reason?: string })
        : null;
    if (
      channels.includes("email") &&
      planObj &&
      planObj.scheduled === false &&
      planObj.reason === "no_destinations"
    ) {
      emailDestinationsFailed = true;
      warnings.push(
        "No email destinations on file for the audience — nothing was queued to send.",
      );
    }
  } catch (err) {
    if (isEmailSendPipelineFailure(err)) throw err;
    warnings.push(
      err instanceof Error ? err.message : "Failed to plan email batches",
    );
  }

  try {
    await schedulePushCampaignBatchesDao(session, created.campaignId);
  } catch (err) {
    warnings.push(
      err instanceof Error ? err.message : "Failed to plan push batches",
    );
  }

  try {
    await scheduleWhatsAppCampaignBatchesDao(session, created.campaignId);
  } catch (err) {
    warnings.push(
      err instanceof Error ? err.message : "Failed to plan WhatsApp batches",
    );
  }

  if (emailDestinationsFailed) {
    await prisma.campaign
      .update({
        where: { id: created.campaignId },
        data: { status: "cancelled" },
      })
      .catch(() => undefined);
    throw new AppError(
      "Resolved contact(s) have no email on file. Email channel could not be queued — nothing was sent.",
      400,
    );
  }

  await markCampaignSendPlannedDao(created.campaignId).catch(() => undefined);

  return {
    run_id: created.campaignId,
    status: schedule.status,
    send_at: schedule.sendAt.toISOString(),
    timezone,
    channels: created.channels,
    audience_count: created.audienceCount,
    warnings,
  };
}

async function toPersonalisedCrmView(
  session: CampaignSessionUser,
  row: {
    id: bigint | string;
    name: string;
    status: string;
    description: string | null;
    audienceSummary: string | null;
    audienceCount: number;
    launchPlan: unknown;
    startsAt: Date | null;
    timezone?: string | null;
    createdAt: Date;
    updatedAt: Date;
    channels: Array<{ channel: string; templateId: bigint | string | null }>;
  },
  metrics?: CampaignMetricTotals | null,
): Promise<PersonalisedCrmRunView> {
  const id = String(row.id);
  const channels = row.channels.map((c) => toAgentChannel(c.channel));
  const plan =
    row.launchPlan && typeof row.launchPlan === "object"
      ? (row.launchPlan as Record<string, unknown>)
      : {};
  const brief =
    typeof plan.brief === "string"
      ? plan.brief
      : row.description || "";

  let subject = "Personalised CRM message";
  let bodyPreview = brief;
  const emailCh = row.channels.find(
    (c) => toAgentChannel(c.channel) === "email" && c.templateId,
  );
  if (emailCh?.templateId) {
    const tmpl = await prisma.campaignChannelTemplate.findFirst({
      where: {
        id: emailCh.templateId,
        organizationId: session.organizationId,
      },
    });
    if (tmpl?.fields && typeof tmpl.fields === "object") {
      const fields = tmpl.fields as Record<string, unknown>;
      subject = String(fields.subject || subject);
      bodyPreview = emailBodyPreview(fields) || bodyPreview;
    }
  }

  const sent = metrics?.sent ?? 0;
  const failed = metrics?.failed ?? 0;
  const pending = Math.max(0, row.audienceCount - sent - failed);
  const channelMetrics: PersonalisedCrmChannelMetricView[] = (
    metrics?.channels || []
  ).map((ch) => {
    const rates = engagementRatesForChannel(ch.channel, {
      delivered: ch.delivered,
      opens: ch.opens,
      clicks: ch.clicks,
    });
    return {
      channel: ch.channel,
      sent: ch.sent,
      delivered: ch.delivered,
      opens: ch.opens,
      clicks: ch.clicks,
      openRate: rates.openRate,
      clickRate: rates.clickRate,
    };
  });

  const sendAt =
    typeof plan.send_at === "string"
      ? plan.send_at
      : row.startsAt
        ? row.startsAt.toISOString()
        : null;

  return {
    id,
    title: row.name,
    status: row.status,
    origin: "crm",
    channels,
    audienceCount: row.audienceCount,
    audienceHint: row.audienceSummary || "",
    sent,
    failed,
    pending,
    opens: metrics?.opens ?? 0,
    clicks: metrics?.clicks ?? 0,
    openRate: metrics?.openRate ?? null,
    clickRate: metrics?.clickRate ?? null,
    channelMetrics,
    brief,
    subject,
    bodyPreview,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    scheduledAt: row.startsAt ? row.startsAt.toISOString() : null,
    sendAt,
    timezone: row.timezone || DEFAULT_LAUNCH_TIMEZONE,
    warnings: [],
  };
}

export async function listPersonalisedCrmRunsDao(session: CampaignSessionUser) {
  const rows = await prisma.campaign.findMany({
    where: {
      organizationId: session.organizationId,
      branchId: session.branchId,
      ...personalisedCrmLaunchPlanPrismaFilter,
    },
    include: {
      channels: { select: { channel: true, templateId: true } },
    },
    orderBy: { updatedAt: "desc" },
    take: 100,
  });
  const metricsMap = await loadCampaignMetricsMap(
    rows.map((r) => ({
      id: String(r.id),
      launchPlan: r.launchPlan,
      audienceCount: r.audienceCount,
      channels: r.channels,
    })),
  );
  const views: PersonalisedCrmRunView[] = [];
  for (const row of rows) {
    views.push(
      await toPersonalisedCrmView(
        session,
        row,
        metricsMap.get(String(row.id)) || null,
      ),
    );
  }
  return views;
}

export async function getPersonalisedCrmRunDao(
  session: CampaignSessionUser,
  campaignId: string,
) {
  const row = await prisma.campaign.findFirst({
    where: {
      id: campaignId,
      organizationId: session.organizationId,
      branchId: session.branchId,
    },
    include: {
      channels: { select: { channel: true, templateId: true } },
    },
  });
  if (!row || !isPersonalisedCrmLaunchPlan(row.launchPlan)) {
    throw new AppError("Personalised CRM send not found.", 404);
  }
  const metricsMap = await loadCampaignMetricsMap([
    {
      id: String(row.id),
      launchPlan: row.launchPlan,
      audienceCount: row.audienceCount,
      channels: row.channels,
    },
  ]);
  return toPersonalisedCrmView(
    session,
    row,
    metricsMap.get(String(row.id)) || null,
  );
}

export async function getPersonalisedCrmRecipientsDao(
  session: CampaignSessionUser,
  campaignId: string,
  opts?: { channel?: string | null; limit?: number },
): Promise<CampaignRecipientsReport> {
  const row = await prisma.campaign.findFirst({
    where: {
      id: campaignId,
      organizationId: session.organizationId,
      branchId: session.branchId,
    },
    select: { id: true, launchPlan: true },
  });
  if (!row || !isPersonalisedCrmLaunchPlan(row.launchPlan)) {
    throw new AppError("Personalised CRM send not found.", 404);
  }
  return getCampaignRecipientsDao(session, campaignId, opts);
}
