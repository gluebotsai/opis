// @ts-nocheck — worktual_bigint Prisma BigInt ids; runtime coerced to string in plugins/prisma.ts
import type { Prisma, RegulatedTemplateStatus } from "@prisma/client";
import { prisma } from "../plugins/prisma.js";
import { AppError } from "../helpers/response-builders.js";

export type RegulatedChannel = "sms" | "whatsapp";

export function publicRegulatedTemplate(
  row: {
    id: string;
    organizationId: string;
    channel: string;
    name: string;
    externalId: string;
    providerTemplateId: string | null;
    language: string;
    category: string;
    header: string;
    body: string;
    footer: string;
    buttons: string;
    status: RegulatedTemplateStatus;
    rejectedReason: string | null;
    campaignName?: string;
    goal?: string;
    objective?: string;
    sourceCampaignId?: string | null;
    submittedAt: Date | null;
    lastStatusCheckedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  },
) {
  return {
    id: row.id,
    channel: row.channel,
    name: row.name,
    externalId: row.externalId,
    providerTemplateId: row.providerTemplateId,
    language: row.language,
    category: row.category,
    header: row.header,
    body: row.body,
    footer: row.footer,
    buttons: row.buttons,
    status: row.status,
    rejectedReason: row.rejectedReason,
    campaignName: row.campaignName || "",
    goal: row.goal || "",
    objective: row.objective || "",
    sourceCampaignId: row.sourceCampaignId ?? null,
    submittedAt: row.submittedAt?.toISOString() ?? null,
    lastStatusCheckedAt: row.lastStatusCheckedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    locked: row.status !== "draft",
  };
}

export async function listRegulatedTemplatesDao(
  organizationId: string,
  channel?: RegulatedChannel,
  status?: RegulatedTemplateStatus,
) {
  const where: Prisma.RegulatedChannelTemplateWhereInput = { organizationId };
  if (channel) where.channel = channel;
  if (status) where.status = status;
  const rows = await prisma.regulatedChannelTemplate.findMany({
    where,
    orderBy: { updatedAt: "desc" },
  });
  return rows.map(publicRegulatedTemplate);
}

export async function getRegulatedTemplateDao(
  organizationId: string,
  id: string,
) {
  const row = await prisma.regulatedChannelTemplate.findFirst({
    where: { id, organizationId },
  });
  if (!row) throw new AppError("Template not found.", 404);
  return row;
}

export async function createRegulatedTemplateDao(input: {
  organizationId: string;
  userId?: string;
  channel: RegulatedChannel;
  name: string;
  externalId?: string;
  language?: string;
  category?: string;
  header?: string;
  body: string;
  footer?: string;
  buttons?: string;
  status?: RegulatedTemplateStatus;
  channelConfigId?: string | null;
  submittedAt?: Date | null;
}) {
  if (input.channel === "whatsapp" && !/^[a-z0-9_]+$/.test(input.name.trim())) {
    throw new AppError(
      "WhatsApp template name must use lowercase letters, numbers, and underscores only.",
      400,
    );
  }
  const row = await prisma.regulatedChannelTemplate.create({
    data: {
      organizationId: input.organizationId,
      createdByUserId: input.userId || null,
      channel: input.channel,
      name: input.name.trim(),
      externalId: (input.externalId || "").trim(),
      language: (input.language || "en").trim(),
      category: (input.category || "").trim(),
      header: (input.header || "").trim(),
      body: input.body.trim(),
      footer: (input.footer || "").trim(),
      buttons: (input.buttons || "").trim(),
      status: input.status || "draft",
      channelConfigId: input.channelConfigId || null,
      submittedAt: input.submittedAt ?? null,
    },
  });
  return row;
}

export async function updateRegulatedDraftDao(
  organizationId: string,
  id: string,
  patch: {
    name?: string;
    externalId?: string;
    language?: string;
    category?: string;
    header?: string;
    body?: string;
    footer?: string;
    buttons?: string;
  },
) {
  const row = await getRegulatedTemplateDao(organizationId, id);
  if (row.status !== "draft") {
    throw new AppError("Submitted templates cannot be edited. Create a new template.", 400);
  }
  const name = patch.name?.trim() ?? row.name;
  if (row.channel === "whatsapp" && !/^[a-z0-9_]+$/.test(name)) {
    throw new AppError(
      "WhatsApp template name must use lowercase letters, numbers, and underscores only.",
      400,
    );
  }
  return prisma.regulatedChannelTemplate.update({
    where: { id },
    data: {
      name,
      externalId: patch.externalId?.trim() ?? row.externalId,
      language: patch.language?.trim() ?? row.language,
      category: patch.category?.trim() ?? row.category,
      header: patch.header?.trim() ?? row.header,
      body: patch.body?.trim() ?? row.body,
      footer: patch.footer?.trim() ?? row.footer,
      buttons: patch.buttons?.trim() ?? row.buttons,
    },
  });
}

/** SMS-only: manually set approved/rejected/pending from draft or pending. */
export async function setRegulatedStatusManualDao(
  organizationId: string,
  id: string,
  status: RegulatedTemplateStatus,
  rejectedReason?: string,
) {
  const row = await getRegulatedTemplateDao(organizationId, id);
  if (row.channel !== "sms") {
    throw new AppError(
      "WhatsApp status is updated from Meta. Use Refresh status instead.",
      400,
    );
  }
  if (!["pending", "approved", "rejected"].includes(status)) {
    throw new AppError("Invalid status for SMS.", 400);
  }
  return prisma.regulatedChannelTemplate.update({
    where: { id },
    data: {
      status,
      rejectedReason:
        status === "rejected"
          ? rejectedReason || row.rejectedReason || "Marked rejected"
          : null,
      submittedAt: row.submittedAt ?? new Date(),
    },
  });
}

export async function deleteRegulatedTemplateDao(organizationId: string, id: string) {
  await getRegulatedTemplateDao(organizationId, id);
  await prisma.regulatedChannelTemplate.delete({ where: { id } });
}

export async function markRegulatedSubmittedDao(
  id: string,
  data: {
    status: RegulatedTemplateStatus;
    providerTemplateId?: string | null;
    externalId?: string;
    channelConfigId: string;
    rejectedReason?: string | null;
  },
) {
  return prisma.regulatedChannelTemplate.update({
    where: { id },
    data: {
      status: data.status,
      providerTemplateId: data.providerTemplateId ?? undefined,
      externalId: data.externalId ?? undefined,
      channelConfigId: data.channelConfigId,
      rejectedReason: data.rejectedReason ?? null,
      submittedAt: new Date(),
      lastStatusCheckedAt: new Date(),
    },
  });
}

export async function applyMetaStatusDao(
  id: string,
  data: {
    status: RegulatedTemplateStatus;
    providerTemplateId?: string | null;
    rejectedReason?: string | null;
    category?: string | null;
  },
) {
  return prisma.regulatedChannelTemplate.update({
    where: { id },
    data: {
      status: data.status,
      providerTemplateId: data.providerTemplateId ?? undefined,
      rejectedReason: data.rejectedReason ?? null,
      category: data.category?.trim() || undefined,
      lastStatusCheckedAt: new Date(),
    },
  });
}

function buttonsFromAgentFields(fields: Record<string, unknown>): string {
  const raw = fields.buttons;
  if (Array.isArray(raw)) {
    return raw
      .map((b) => {
        if (typeof b === "string") return b.trim();
        if (b && typeof b === "object") {
          const row = b as Record<string, unknown>;
          return String(row.label || row.text || "").trim();
        }
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  if (typeof raw === "string") return raw.trim();
  return "";
}

/**
 * Mirror a campaign WhatsApp Meta template into Template Library so
 * Pending / Approved / Rejected sections stay in sync with launch + status cron.
 */
export async function upsertRegulatedWhatsAppFromCampaignDao(input: {
  organizationId: string;
  userId?: string | null;
  name: string;
  language?: string;
  category?: string;
  header?: string;
  body?: string;
  footer?: string;
  buttons?: string;
  fields?: Record<string, unknown>;
  status: RegulatedTemplateStatus;
  providerTemplateId?: string | null;
  channelConfigId?: string | null;
  rejectedReason?: string | null;
  submittedAt?: string | null;
  campaignName?: string | null;
  goal?: string | null;
  objective?: string | null;
  sourceCampaignId?: string | null;
}) {
  const name = String(input.name || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
  if (!name) return null;

  const fields = input.fields || {};
  const body =
    (input.body || String(fields.body || "")).trim() ||
    "(Synced from campaign WhatsApp template)";
  const header = (input.header || String(fields.header || "")).trim();
  const footer = (input.footer || String(fields.footer || "")).trim();
  const buttons =
    input.buttons?.trim() ||
    buttonsFromAgentFields(fields);
  const language = (input.language || String(fields.language || "en")).trim() || "en";
  const category = (
    input.category ||
    String(fields.category || "MARKETING")
  )
    .trim()
    .toUpperCase();
  const campaignName = String(
    input.campaignName || fields.campaign_name || fields.campaignName || "",
  ).trim();
  const goal = String(input.goal || fields.goal || "").trim();
  const objective = String(input.objective || fields.objective || "").trim();
  const sourceCampaignId =
    input.sourceCampaignId ||
    (typeof fields.source_campaign_id === "string"
      ? fields.source_campaign_id
      : null) ||
    null;

  const existing = await prisma.regulatedChannelTemplate.findFirst({
    where: {
      organizationId: input.organizationId,
      channel: "whatsapp",
      OR: [
        { name },
        ...(input.providerTemplateId
          ? [{ providerTemplateId: input.providerTemplateId }]
          : []),
      ],
    },
    orderBy: { updatedAt: "desc" },
  });

  const submittedAt = input.submittedAt
    ? new Date(input.submittedAt)
    : new Date();

  if (existing) {
    return prisma.regulatedChannelTemplate.update({
      where: { id: existing.id },
      data: {
        name,
        externalId: name,
        providerTemplateId:
          input.providerTemplateId ?? existing.providerTemplateId,
        language,
        category: category || existing.category,
        header: header || existing.header,
        body,
        footer,
        buttons: buttons || existing.buttons,
        status: input.status,
        rejectedReason:
          input.status === "rejected"
            ? input.rejectedReason || existing.rejectedReason
            : null,
        channelConfigId:
          input.channelConfigId ?? existing.channelConfigId,
        campaignName: campaignName || existing.campaignName,
        goal: goal || existing.goal,
        objective: objective || existing.objective,
        sourceCampaignId: sourceCampaignId || existing.sourceCampaignId,
        submittedAt: existing.submittedAt ?? submittedAt,
        lastStatusCheckedAt: new Date(),
      },
    });
  }

  return prisma.regulatedChannelTemplate.create({
    data: {
      organizationId: input.organizationId,
      createdByUserId: input.userId || null,
      channel: "whatsapp",
      name,
      externalId: name,
      providerTemplateId: input.providerTemplateId || null,
      language,
      category: category || "MARKETING",
      header,
      body,
      footer,
      buttons,
      status: input.status,
      rejectedReason:
        input.status === "rejected" ? input.rejectedReason || null : null,
      channelConfigId: input.channelConfigId || null,
      campaignName,
      goal,
      objective,
      sourceCampaignId,
      submittedAt,
      lastStatusCheckedAt: new Date(),
    },
  });
}
