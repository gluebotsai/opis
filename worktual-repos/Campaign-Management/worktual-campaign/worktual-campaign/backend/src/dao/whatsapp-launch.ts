// @ts-nocheck — worktual_bigint Prisma BigInt ids; runtime coerced to string in plugins/prisma.ts
import type { Prisma } from "@prisma/client";
import { prisma } from "../plugins/prisma.js";
import type { CampaignSessionUser } from "../types/auth.js";
import { AppError } from "../helpers/response-builders.js";
import { toAgentChannel } from "../helpers/channel-ids.js";
import { MAX_WHATSAPP_SEND_ATTEMPTS } from "../helpers/email-send-constants.js";
import {
  buildSubmitComponentsFromAgentFields,
  normalizeWhatsAppDraftForMetaSubmit,
} from "../helpers/whatsapp-template-map.js";
import {
  readApprovalFromFields,
  resolveAgentWhatsAppTemplateName,
} from "../services/whatsapp-template-approval.js";
import { resolveWhatsAppChannelConfigId } from "./whatsapp-channel-config.js";
import { upsertRegulatedWhatsAppFromCampaignDao } from "./regulated-template.js";
import { listContactPhonesByIdsDao } from "./contact.js";
import { planWhatsAppSendBatchesDao } from "./whatsapp-send-runner.js";
import { canPlanLaunchBatches } from "../helpers/launch-send-plan.js";
import {
  mapMetaStatusToLocal,
  socialGetTemplateApprovalStatus,
  socialSubmitTemplateApproval,
} from "../services/social-whatsapp.js";

export type WhatsAppLaunchMeta = {
  template_id: string;
  template_name: string;
  provider_template_id: string | null;
  language: string;
  category: string;
  status: "pending" | "approved" | "rejected" | "paused" | "disabled";
  channel_config_id: string;
  body_placeholders: string[];
  url_button_send_specs?: Array<{ index: number; placeholderKeys: string[] }>;
  submitted_at: string;
  last_status_checked_at: string | null;
  /** Set once when Meta moves the template to approved (for in-app notifications). */
  approved_at?: string | null;
  rejected_reason?: string | null;
  /** Fact line for create-campaign agent memory (synced on status change). */
  agent_memory_line?: string | null;
};

function readWhatsAppMeta(launchPlan: unknown): WhatsAppLaunchMeta | null {
  if (!launchPlan || typeof launchPlan !== "object") return null;
  const wa = (launchPlan as Record<string, unknown>).whatsapp;
  if (!wa || typeof wa !== "object") return null;
  const row = wa as Record<string, unknown>;
  if (!row.template_name || !row.template_id) return null;
  return {
    template_id: String(row.template_id),
    template_name: String(row.template_name),
    provider_template_id: row.provider_template_id
      ? String(row.provider_template_id)
      : null,
    language: String(row.language || "en"),
    category: String(row.category || "MARKETING"),
    status: (String(row.status || "pending") as WhatsAppLaunchMeta["status"]),
    channel_config_id: String(row.channel_config_id || ""),
    body_placeholders: Array.isArray(row.body_placeholders)
      ? row.body_placeholders.map((p) => String(p))
      : [],
    url_button_send_specs: Array.isArray(row.url_button_send_specs)
      ? row.url_button_send_specs.map((s) => ({
          index: Number((s as { index?: number }).index) || 0,
          placeholderKeys: Array.isArray((s as { placeholderKeys?: unknown }).placeholderKeys)
            ? ((s as { placeholderKeys: unknown[] }).placeholderKeys).map((k) =>
                String(k),
              )
            : [],
        }))
      : [],
    submitted_at: String(row.submitted_at || ""),
    last_status_checked_at: row.last_status_checked_at
      ? String(row.last_status_checked_at)
      : null,
    approved_at: row.approved_at ? String(row.approved_at) : null,
    rejected_reason: row.rejected_reason ? String(row.rejected_reason) : null,
    agent_memory_line: row.agent_memory_line
      ? String(row.agent_memory_line)
      : null,
  };
}

async function persistWhatsAppMeta(
  campaignId: string,
  launchPlan: unknown,
  meta: WhatsAppLaunchMeta,
) {
  const prev =
    launchPlan && typeof launchPlan === "object"
      ? ({ ...(launchPlan as object) } as Record<string, unknown>)
      : {};
  await prisma.campaign.update({
    where: { id: campaignId },
    data: {
      launchPlan: {
        ...prev,
        whatsapp: meta,
        max_send_attempts: MAX_WHATSAPP_SEND_ATTEMPTS,
      } as Prisma.InputJsonValue,
    },
  });
}

async function syncCampaignMetaToTemplateLibrary(args: {
  organizationId: string;
  userId?: string | null;
  meta: WhatsAppLaunchMeta;
  fields?: Record<string, unknown>;
  campaignName?: string | null;
  goal?: string | null;
  objective?: string | null;
  sourceCampaignId?: string | null;
}) {
  try {
    await upsertRegulatedWhatsAppFromCampaignDao({
      organizationId: args.organizationId,
      userId: args.userId,
      name: args.meta.template_name,
      language: args.meta.language,
      category: args.meta.category,
      fields: args.fields,
      status: args.meta.status,
      providerTemplateId: args.meta.provider_template_id,
      channelConfigId: args.meta.channel_config_id || null,
      rejectedReason: args.meta.rejected_reason || null,
      submittedAt: args.meta.submitted_at || null,
      campaignName: args.campaignName,
      goal: args.goal,
      objective: args.objective,
      sourceCampaignId: args.sourceCampaignId,
    });
  } catch {
    // Library sync must never block launch / status poll.
  }
}

/**
 * Submit agent WhatsApp template to Meta (if needed) and freeze phone audience
 * into send batches (1 or N). Batches stay queued until status is approved.
 */
export async function scheduleWhatsAppCampaignBatchesDao(
  session: CampaignSessionUser,
  campaignId: string,
) {
  const campaign = await prisma.campaign.findFirst({
    where: {
      id: campaignId,
      organizationId: session.organizationId,
      branchId: session.branchId,
    },
    include: {
      channels: true,
      audience: { select: { contactId: true } },
    },
  });
  if (!campaign) throw new AppError("Campaign not found.", 404);

  const waChannel = campaign.channels.find(
    (c) => toAgentChannel(c.channel) === "whatsapp",
  );
  if (!waChannel) {
    return { scheduled: false, reason: "no_whatsapp_channel" as const };
  }

  if (!canPlanLaunchBatches(campaign.status)) {
    return { scheduled: false, reason: "not_scheduled" as const };
  }

  if (!waChannel.templateId) {
    throw new AppError(
      "WhatsApp channel has no agent template. Generate a WhatsApp template before launching.",
      400,
    );
  }

  const template = await prisma.campaignChannelTemplate.findFirst({
    where: { id: waChannel.templateId, organizationId: session.organizationId },
  });
  if (!template) {
    throw new AppError("WhatsApp agent template not found.", 404);
  }

  const fields =
    template.fields && typeof template.fields === "object"
      ? (template.fields as Record<string, unknown>)
      : {};

  const normalizedFields = normalizeWhatsAppDraftForMetaSubmit(fields, {
    goal: campaign.goal || undefined,
    objective: campaign.objective || undefined,
  });
  const mapped = buildSubmitComponentsFromAgentFields(normalizedFields, {
    goal: campaign.goal || undefined,
    objective: campaign.objective || undefined,
  });
  const channelConfigId = await resolveWhatsAppChannelConfigId(session.organizationId);
  const agentName = resolveAgentWhatsAppTemplateName(fields, template.id);
  const fieldApproval = readApprovalFromFields(fields);

  let meta = readWhatsAppMeta(campaign.launchPlan);
  const sameTemplate =
    meta &&
    meta.template_id === template.id &&
    (meta.template_name === agentName ||
      meta.template_name === String(fields.name || ""));

  const approvalStatus = String(fieldApproval?.status || "").toUpperCase();
  const contentEditedAfterSubmit =
    fieldApproval?.submitted === false ||
    approvalStatus === "DRAFT" ||
    approvalStatus === "EDITED";
  const providerFromFields = fieldApproval?.provider_template_id || null;
  const metaProviderStale =
    Boolean(meta && providerFromFields) &&
    String(meta.provider_template_id || "") !== String(providerFromFields);

  // Prefer prior Meta approval when still valid (same template + name + content).
  // Draft-only create never submits; first submit is here (or after edit / reject).
  if (
    (!sameTemplate || !meta || metaProviderStale) &&
    fieldApproval?.submitted &&
    fieldApproval.status !== "rejected" &&
    !contentEditedAfterSubmit
  ) {
    meta = {
      template_id: template.id,
      template_name: agentName,
      provider_template_id: fieldApproval.provider_template_id,
      language: mapped.language,
      category: mapped.category,
      status: mapMetaStatusToLocal(fieldApproval.status),
      channel_config_id: channelConfigId,
      body_placeholders: mapped.bodyPlaceholders,
      url_button_send_specs: mapped.urlButtonSendSpecs,
      submitted_at: fieldApproval.submitted_at || new Date().toISOString(),
      last_status_checked_at: null,
      approved_at:
        mapMetaStatusToLocal(fieldApproval.status) === "approved"
          ? new Date().toISOString()
          : null,
      agent_memory_line: `WhatsApp Meta: ${mapMetaStatusToLocal(fieldApproval.status).toUpperCase()} template "${agentName}".`,
    };
    await persistWhatsAppMeta(campaignId, campaign.launchPlan, meta);
  } else if (
    !sameTemplate ||
    !meta ||
    meta.status === "rejected" ||
    contentEditedAfterSubmit
  ) {
    // Submit / re-submit with current DB fields (latest edit wins).
    const submit = await socialSubmitTemplateApproval({
      channelConfigId,
      name: agentName,
      language: mapped.language,
      category: mapped.category,
      allowCategoryChange: false,
      components: mapped.components,
    });

    const submitStatus = mapMetaStatusToLocal(submit.status);
    const resolvedTemplateName = submit.templateName || agentName;
    meta = {
      template_id: template.id,
      template_name: resolvedTemplateName,
      provider_template_id: submit.templateId || null,
      language: mapped.language,
      category: mapped.category,
      status: submitStatus,
      channel_config_id: channelConfigId,
      body_placeholders: mapped.bodyPlaceholders,
      url_button_send_specs: mapped.urlButtonSendSpecs,
      submitted_at: new Date().toISOString(),
      last_status_checked_at: null,
      approved_at: submitStatus === "approved" ? new Date().toISOString() : null,
      agent_memory_line: `WhatsApp Meta: submitted for approval; status ${String(submit.status || submitStatus).toUpperCase()} template "${resolvedTemplateName}".`,
    };
    await persistWhatsAppMeta(campaignId, campaign.launchPlan, meta);

    // Keep template.fields.name stable and mirror approval for UI.
    const nextFields = {
      ...normalizedFields,
      name: meta.template_name,
      language: mapped.language,
      category: mapped.category,
      components: mapped.components,
      body_placeholders: mapped.bodyPlaceholders,
      url_button_send_specs: mapped.urlButtonSendSpecs,
      approval: {
        submitted: true,
        status: meta.status,
        provider_template_id: meta.provider_template_id,
        submitted_at: meta.submitted_at,
        error: null,
        message: `WhatsApp template "${meta.template_name}" was sent for Meta approval (status: ${String(submit.status || meta.status).toUpperCase()}).`,
      },
    };
    await prisma.campaignChannelTemplate.update({
      where: { id: template.id },
      data: { fields: nextFields as Prisma.InputJsonValue },
    });
  } else if (meta.status === "pending") {
    // Refresh once at schedule time (hourly worker continues after).
    // refreshCampaignWhatsAppStatus also syncs Template Library.
    const refreshed = await refreshCampaignWhatsAppStatus(campaignId, meta);
    meta = refreshed;
  }

  // Mirror Meta status into Template Library (Pending / Approved / Rejected).
  if (meta) {
    await syncCampaignMetaToTemplateLibrary({
      organizationId: session.organizationId,
      userId: session.id,
      meta,
      fields,
      campaignName: campaign.name,
      goal: campaign.goal,
      objective: campaign.objective,
      sourceCampaignId: campaign.id,
    });
  }

  const existing = await prisma.campaignSendBatch.count({
    where: {
      campaignId,
      organizationId: session.organizationId,
      channel: "whatsapp",
      status: { in: ["queued", "sending", "sent"] },
    },
  });
  if (existing > 0) {
    return {
      scheduled: false,
      reason: "already_planned" as const,
      existing,
      whatsapp: meta,
    };
  }

  const contactIds = campaign.audience.map((a) => a.contactId);
  const phoneRows = await listContactPhonesByIdsDao(session, contactIds);
  if (!phoneRows.length) {
    return {
      scheduled: false,
      reason: "no_destinations" as const,
      skipped_without_phone: contactIds.length,
      whatsapp: meta,
    };
  }

  const plan = await planWhatsAppSendBatchesDao(
    session,
    campaignId,
    phoneRows.map((r) => ({ contactId: r.contactId, phone: r.phone })),
  );

  // Re-read launchPlan after plan update and re-attach whatsapp meta.
  const after = await prisma.campaign.findFirst({
    where: { id: campaignId },
    select: { launchPlan: true },
  });
  if (meta) {
    await persistWhatsAppMeta(campaignId, after?.launchPlan, meta);
  }

  return {
    scheduled: true as const,
    plan,
    whatsapp: meta,
    skipped_without_phone: Math.max(0, contactIds.length - phoneRows.length),
    max_send_attempts: MAX_WHATSAPP_SEND_ATTEMPTS,
  };
}

/** Poll Meta approval for one campaign's WhatsApp template meta. */
export async function refreshCampaignWhatsAppStatus(
  campaignId: string,
  meta: WhatsAppLaunchMeta,
): Promise<WhatsAppLaunchMeta> {
  const campaign = await prisma.campaign.findFirst({
    where: { id: campaignId },
    select: {
      organizationId: true,
      launchPlan: true,
      name: true,
      goal: true,
      objective: true,
    },
  });
  const channelConfigId = await resolveWhatsAppChannelConfigId(
    campaign?.organizationId || "",
  );

  const result = await socialGetTemplateApprovalStatus({
    channelConfigId,
    templateId: meta.provider_template_id || undefined,
    templateName: meta.provider_template_id ? undefined : meta.template_name,
    language: meta.language || undefined,
  });

  const match =
    (result.templates || []).find(
      (t) =>
        (meta.provider_template_id && t.id === meta.provider_template_id) ||
        t.name === meta.template_name,
    ) || result.templates?.[0];

  const prevStatus = meta.status;
  const next: WhatsAppLaunchMeta = {
    ...meta,
    channel_config_id: channelConfigId,
    last_status_checked_at: new Date().toISOString(),
  };

  if (match) {
    next.status = mapMetaStatusToLocal(match.status);
    if (match.id) next.provider_template_id = match.id;
    if (match.language) next.language = match.language;
    if (match.category) next.category = match.category;
    const reason =
      (match as { rejectedReason?: string; reason?: string }).rejectedReason ||
      (match as { reason?: string }).reason;
    if (next.status === "rejected" && reason) {
      next.rejected_reason = String(reason);
    }
  }

  if (next.status === "approved") {
    if (prevStatus !== "approved" || !meta.approved_at) {
      next.approved_at = new Date().toISOString();
    } else {
      next.approved_at = meta.approved_at;
    }
  } else if (meta.approved_at) {
    next.approved_at = meta.approved_at;
  }

  if (prevStatus !== next.status) {
    const tpl = next.template_name || meta.template_name;
    if (next.status === "approved") {
      (next as Record<string, unknown>).agent_memory_line =
        `WhatsApp Meta: APPROVED template "${tpl}". Sends run at campaign launch time when audience batches are due.`;
    } else if (next.status === "rejected") {
      const why = next.rejected_reason ? ` (${next.rejected_reason})` : "";
      (next as Record<string, unknown>).agent_memory_line =
        `WhatsApp Meta: REJECTED template "${tpl}"${why}. Regenerate WhatsApp with a new template name.`;
    } else if (next.status === "pending") {
      (next as Record<string, unknown>).agent_memory_line =
        `WhatsApp Meta: PENDING approval for template "${tpl}".`;
    }
  } else if ((meta as Record<string, unknown>).agent_memory_line) {
    (next as Record<string, unknown>).agent_memory_line = (
      meta as Record<string, unknown>
    ).agent_memory_line;
  }

  await persistWhatsAppMeta(campaignId, campaign?.launchPlan, next);

  if (
    campaign?.organizationId &&
    next.status === "approved" &&
    prevStatus !== "approved"
  ) {
    try {
      const { notifyWhatsAppApproved } = await import(
        "../services/app-notifications.js"
      );
      await notifyWhatsAppApproved({
        campaignId,
        campaignName: campaign.name || "Campaign",
        organizationId: campaign.organizationId,
        templateName: next.template_name,
        approvedAt: next.approved_at || new Date().toISOString(),
      });
    } catch {
      /* ignore */
    }
  }

  if (campaign?.organizationId) {
    let fields: Record<string, unknown> | undefined;
    if (meta.template_id) {
      const tpl = await prisma.campaignChannelTemplate.findFirst({
        where: { id: meta.template_id },
        select: { fields: true },
      });
      if (tpl?.fields && typeof tpl.fields === "object") {
        fields = tpl.fields as Record<string, unknown>;
      }
    }
    await syncCampaignMetaToTemplateLibrary({
      organizationId: campaign.organizationId,
      meta: next,
      fields,
      campaignName: campaign.name,
      goal: campaign.goal,
      objective: campaign.objective,
      sourceCampaignId: campaignId,
    });
  }

  return next;
}

export type WhatsAppApprovalNotification = {
  id: string;
  campaign_id: string;
  campaign_name: string;
  template_name: string;
  status: "approved";
  approved_at: string;
  href: string;
};

/** In-app bell feed: WhatsApp templates approved (Meta) for this tenant. */
export async function listWhatsAppApprovalNotificationsDao(
  session: CampaignSessionUser,
): Promise<WhatsAppApprovalNotification[]> {
  const campaigns = await prisma.campaign.findMany({
    where: {
      organizationId: session.organizationId,
      status: { in: ["scheduled", "live", "completed", "draft"] },
      channels: { some: { channel: "whatsapp" } },
    },
    select: {
      id: true,
      name: true,
      launchPlan: true,
    },
    orderBy: { updatedAt: "desc" },
    take: 80,
  });

  const out: WhatsAppApprovalNotification[] = [];
  for (const row of campaigns) {
    const meta = readWhatsAppMeta(row.launchPlan);
    if (!meta || meta.status !== "approved" || !meta.approved_at) continue;
    out.push({
      id: `wa-approved:${row.id}`,
      campaign_id: row.id,
      campaign_name: row.name || "Campaign",
      template_name: meta.template_name,
      status: "approved",
      approved_at: meta.approved_at,
      href: `/campaigns/${row.id}`,
    });
  }
  return out;
}

export function getCampaignWhatsAppMeta(
  launchPlan: unknown,
): WhatsAppLaunchMeta | null {
  return readWhatsAppMeta(launchPlan);
}
