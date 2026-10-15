// @ts-nocheck — worktual_bigint Prisma BigInt ids; runtime coerced to string in plugins/prisma.ts
import type { Prisma } from "@prisma/client";
import { prisma } from "../plugins/prisma.js";
import type { CampaignSessionUser } from "../types/auth.js";
import { AppError } from "../helpers/response-builders.js";
import { toStableDbId } from "../helpers/id-schema.js";
import {
  fieldsPassQuality,
  isEmptyFields,
  resolveTemplateFields,
} from "../helpers/template-html.js";
import { resolveAgentWhatsAppTemplateName } from "../services/whatsapp-template-approval.js";
import { mergeTemplateFields } from "../helpers/template-fields-merge.js";
import { canonicalizeEmailTemplateFields } from "../helpers/email-template-canonical.js";
import {
  buildSubmitComponentsFromAgentFields,
  normalizeWhatsAppDraftForMetaSubmit,
} from "../helpers/whatsapp-template-map.js";
import { getOrCreateAgentSessionDao } from "./agent-session.js";

export type TemplateFields = Record<string, unknown>;

export type CreateTemplateInput = {
  template_id?: string;
  channel: string;
  logo?: string | null;
  launch_at?: string | null;
  how_it_works?: string | null;
  fields?: TemplateFields;
  /** Legacy HTML from pre-structured cards; converted to fields on write. */
  preview?: string | null;
};

const WHATSAPP_DRAFT_APPROVAL = {
  submitted: false,
  status: "DRAFT",
  provider_template_id: null,
  submitted_at: null,
  error: null,
  message:
    "Draft saved. Meta approval starts when you confirm launch.",
} as const;

function toCard(row: {
  id: string;
  sessionId: string;
  channel: string;
  logo: string | null;
  launchAt: string | null;
  howItWorks: string | null;
  fields: Prisma.JsonValue;
  generationBatchId: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  const fields = (
    row.fields && typeof row.fields === "object" ? row.fields : {}
  ) as TemplateFields;
  const approval =
    fields.approval && typeof fields.approval === "object"
      ? (fields.approval as Record<string, unknown>)
      : null;
  return {
    template_id: row.id,
    session_id: row.sessionId,
    channel: row.channel,
    logo: row.logo ?? row.channel,
    launch_at: row.launchAt,
    how_it_works: row.howItWorks,
    fields,
    approval,
    generation_batch_id: row.generationBatchId,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
}

function toMessage(row: {
  id: string;
  templateId: string;
  role: string;
  seq: number;
  kind: string;
  payload: Prisma.JsonValue;
  createdAt: Date;
}) {
  return {
    id: row.id,
    template_id: row.templateId,
    role: row.role,
    seq: row.seq,
    kind: row.kind,
    payload:
      row.payload && typeof row.payload === "object"
        ? (row.payload as Record<string, unknown>)
        : {},
    created_at: row.createdAt.toISOString(),
  };
}

/** Create campaign_agent_sessions shell when missing (new create-campaign draft URLs). */
async function ensureSessionAccess(
  session: CampaignSessionUser,
  sessionId: string,
) {
  const stableId = toStableDbId(sessionId);
  await getOrCreateAgentSessionDao(session, stableId, "create_campaign");
  const row = await prisma.campaignAgentSession.findFirst({
    where: { id: stableId, organizationId: session.organizationId },
    select: { id: true, createdByUserId: true, branchId: true, organizationId: true },
  });
  if (!row) {
    throw new AppError("Agent session not found.", 404);
  }
  if (row.createdByUserId !== session.id) {
    throw new AppError("You do not have access to this campaign session.", 403);
  }
  return row;
}

async function assertTemplateAccess(
  session: CampaignSessionUser,
  templateId: string,
) {
  const row = await prisma.campaignChannelTemplate.findFirst({
    where: { id: templateId, organizationId: session.organizationId },
  });
  if (!row) {
    throw new AppError("Template not found.", 404);
  }
  await ensureSessionAccess(session, row.sessionId);
  return row;
}

/** Rebuild Meta submit components[] from named draft fields (body keeps {{first_name}}, etc.). */
export function syncWhatsAppSubmitPayload(
  fields: TemplateFields,
  ctx?: { goal?: string; objective?: string },
): TemplateFields {
  let next = normalizeWhatsAppDraftForMetaSubmit(fields, ctx);
  try {
    const built = buildSubmitComponentsFromAgentFields(next, ctx);
    next.components = built.components;
    next.body_placeholders = built.bodyPlaceholders;
    next.url_button_send_specs = built.urlButtonSendSpecs;
  } catch {
    // Empty body during partial edit — leave components unchanged.
  }
  return next;
}

/** Ensure WhatsApp fields.name is set once (stable Meta name) + draft approval. */
function prepareWhatsAppDraftFields(
  templateId: string,
  fields: TemplateFields,
): TemplateFields {
  let next = { ...fields };
  const name = resolveAgentWhatsAppTemplateName(next, templateId);
  next.name = name;
  next.approval = { ...WHATSAPP_DRAFT_APPROVAL };
  next = syncWhatsAppSubmitPayload(next);
  return next;
}

/** Regulated library / approved-template runs — keep Meta provider id and approved status. */
function isWhatsAppLibraryApprovedFields(fields: TemplateFields): boolean {
  if (fields.meta_approved === true) return true;
  const raw = fields.approval;
  if (!raw || typeof raw !== "object") return false;
  const a = raw as Record<string, unknown>;
  const status = String(a.status || "").trim().toLowerCase();
  const provider = a.provider_template_id
    ? String(a.provider_template_id).trim()
    : "";
  return (
    status === "approved" &&
    Boolean(provider || a.submitted === true)
  );
}

function finalizeWhatsAppFieldsForPersist(
  templateId: string,
  fields: TemplateFields,
): TemplateFields {
  if (isWhatsAppLibraryApprovedFields(fields)) {
    const next = { ...fields };
    const name = resolveAgentWhatsAppTemplateName(next, templateId);
    next.name = name;
    const raw = next.approval;
    const a =
      raw && typeof raw === "object"
        ? (raw as Record<string, unknown>)
        : {};
    next.approval = {
      submitted: a.submitted !== false,
      status: String(a.status || "approved"),
      provider_template_id: a.provider_template_id
        ? String(a.provider_template_id)
        : null,
      submitted_at: a.submitted_at ? String(a.submitted_at) : null,
      error: a.error != null ? String(a.error) : null,
      message: String(
        a.message || "Pre-approved Meta template from library.",
      ),
    };
    next.meta_approved = true;
    return next;
  }
  return prepareWhatsAppDraftFields(templateId, fields);
}

function asDbId(value: unknown): string {
  return String(value ?? "").trim();
}

async function writeTemplateMessage(
  tx: Prisma.TransactionClient,
  templateId: string,
  fieldsJson: Prisma.InputJsonValue,
) {
  const existingMsg = await tx.campaignTemplateMessage.findFirst({
    where: { templateId, seq: 0, kind: "template" },
    select: { id: true },
  });
  const payload = { fields: fieldsJson } as Prisma.InputJsonValue;
  if (existingMsg) {
    await tx.campaignTemplateMessage.update({
      where: { id: existingMsg.id },
      data: { payload },
    });
    return;
  }
  await tx.campaignTemplateMessage.create({
    data: {
      templateId,
      role: "assistant",
      seq: 0,
      kind: "template",
      payload,
    },
  });
}

export async function createTemplatesBatchDao(
  session: CampaignSessionUser,
  sessionId: string,
  templates: CreateTemplateInput[],
  generationBatchId?: string | null,
) {
  const stableSessionId = toStableDbId(sessionId);
  const agentSession = await ensureSessionAccess(session, stableSessionId);
  const batchIdRaw = generationBatchId?.trim() || "";
  const batchId = batchIdRaw ? toStableDbId(batchIdRaw) : null;

  const created = await prisma.$transaction(async (tx) => {
    const out = [];
    for (const item of templates) {
      const channel = String(item.channel || "")
        .trim()
        .toLowerCase();
      if (!channel) continue;
      let explicitId = item.template_id?.trim()
        ? toStableDbId(item.template_id)
        : null;
      let fields = resolveTemplateFields(
        channel,
        item.fields,
        item.preview,
      );
      if (isEmptyFields(fields)) {
        continue;
      }
      // Soft gate: skip greeting-only / empty-body, but do not drop otherwise-valid
      // agent cards (hard quality used to silently return zero templates).
      if (channel === "whatsapp" || channel === "sms") {
        const body = String(fields.body || "").trim();
        if (!body || (body.length < 20 && /^(hi|hello|hey)\b/i.test(body))) {
          continue;
        }
      } else if (!fieldsPassQuality(channel, fields)) {
        continue;
      }
      if (channel === "whatsapp" && explicitId) {
        fields = finalizeWhatsAppFieldsForPersist(explicitId, fields);
      }

      const clash = explicitId
        ? await tx.campaignChannelTemplate.findUnique({
            where: { id: explicitId },
            select: {
              id: true,
              sessionId: true,
              organizationId: true,
            },
          })
        : null;
      const sameOwner =
        clash &&
        asDbId(clash.sessionId) === asDbId(stableSessionId) &&
        asDbId(clash.organizationId) === asDbId(agentSession.organizationId);
      if (clash && !sameOwner) {
        explicitId = null;
      }

      const fieldsJson = fields as Prisma.InputJsonValue;
      const data = {
        sessionId: stableSessionId,
        organizationId: agentSession.organizationId,
        branchId: agentSession.branchId,
        channel,
        logo: item.logo ?? channel,
        launchAt: item.launch_at ?? null,
        howItWorks: item.how_it_works ?? null,
        fields: fieldsJson,
        ...(batchId ? { generationBatchId: batchId } : {}),
      };

      let row;
      if (sameOwner && explicitId) {
        row = await tx.campaignChannelTemplate.update({
          where: { id: explicitId },
          data,
        });
      } else {
        row = await tx.campaignChannelTemplate.create({
          data: {
            ...(explicitId ? { id: explicitId } : {}),
            ...data,
          },
        });
      }
      const templateId = asDbId(row.id);
      if (channel === "whatsapp" && !item.template_id?.trim()) {
        const prepared = finalizeWhatsAppFieldsForPersist(templateId, fields);
        await tx.campaignChannelTemplate.update({
          where: { id: row.id },
          data: { fields: prepared as Prisma.InputJsonValue },
        });
        fields = prepared;
      }
      const finalFieldsJson = fields as Prisma.InputJsonValue;
      await writeTemplateMessage(tx, templateId, finalFieldsJson);
      out.push(row);
    }
    return out;
  });

  // Draft only — Meta submit happens on CONFIRM_LAUNCH / scheduleWhatsAppCampaignBatchesDao.
  return {
    generation_batch_id: batchId,
    templates: created.map(toCard),
  };
}

/**
 * Insert session cards missing from DB and repair rows saved with empty
 * fields (cards created before templates became structured). Idempotent.
 */
export async function syncSessionTemplatesDao(
  session: CampaignSessionUser,
  sessionId: string,
  templates: CreateTemplateInput[],
  generationBatchId?: string | null,
) {
  const stableSessionId = toStableDbId(sessionId);
  await ensureSessionAccess(session, stableSessionId);
  const existing = await prisma.campaignChannelTemplate.findMany({
    where: { sessionId: stableSessionId, organizationId: session.organizationId },
    select: { id: true, fields: true },
  });
  const existingById = new Map(
    existing.map((row) => [asDbId(row.id), row]),
  );

  const missing: CreateTemplateInput[] = [];
  const repairs: Array<{ id: string; fields: TemplateFields }> = [];

  for (const item of templates) {
    const rawId = item.template_id?.trim();
    const id = rawId ? toStableDbId(rawId) : "";
    const channel = String(item.channel || "")
      .trim()
      .toLowerCase();
    if (!channel) continue;

    const row = id ? existingById.get(id) : undefined;
    if (!row) {
      missing.push(item);
      continue;
    }
    if (!isEmptyFields(row.fields)) continue;

    const resolved = resolveTemplateFields(channel, item.fields, item.preview);
    if (!isEmptyFields(resolved) && fieldsPassQuality(channel, resolved)) {
      repairs.push({
        id: row.id,
        fields:
          channel === "whatsapp"
            ? finalizeWhatsAppFieldsForPersist(row.id, resolved)
            : resolved,
      });
    }
  }

  for (const repair of repairs) {
    await prisma.$transaction(async (tx) => {
      await tx.campaignChannelTemplate.update({
        where: { id: repair.id },
        data: { fields: repair.fields as Prisma.InputJsonValue },
      });
      await tx.campaignTemplateMessage.updateMany({
        where: { templateId: repair.id, seq: 0, kind: "template" },
        data: {
          payload: { fields: repair.fields } as Prisma.InputJsonValue,
        },
      });
    });
  }

  let batchId = generationBatchId ?? null;
  let createdCount = 0;
  if (missing.length > 0) {
    const created = await createTemplatesBatchDao(
      session,
      sessionId,
      missing,
      generationBatchId,
    );
    batchId = created.generation_batch_id;
    createdCount = created.templates.length;
  }

  const all = await listTemplatesForSessionDao(session, sessionId);
  return {
    generation_batch_id: batchId,
    created_count: createdCount,
    repaired_count: repairs.length,
    templates: all.templates,
  };
}

export async function listTemplatesForSessionDao(
  session: CampaignSessionUser,
  sessionId: string,
) {
  const stableId = toStableDbId(sessionId);
  await ensureSessionAccess(session, stableId);
  const rows = await prisma.campaignChannelTemplate.findMany({
    where: { sessionId: stableId, organizationId: session.organizationId },
    orderBy: { createdAt: "asc" },
  });
  return { templates: rows.map(toCard) };
}

/** Recent channel templates for org — creative fingerprint rotation. */
export async function listRecentOrgTemplatesDao(
  session: CampaignSessionUser,
  opts: { channel?: string; limit?: number } = {},
) {
  const limit = Math.min(Math.max(opts.limit ?? 20, 1), 50);
  const channel = String(opts.channel || "").trim().toLowerCase();
  const rows = await prisma.campaignChannelTemplate.findMany({
    where: {
      organizationId: session.organizationId,
      ...(channel ? { channel } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  return { templates: rows.map(toCard) };
}

export async function getTemplateDao(
  session: CampaignSessionUser,
  templateId: string,
) {
  const row = await assertTemplateAccess(session, templateId);
  const messages = await prisma.campaignTemplateMessage.findMany({
    where: { templateId },
    orderBy: { seq: "asc" },
  });
  return {
    template: toCard(row),
    messages: messages.map(toMessage),
  };
}

export async function updateTemplateFieldsDao(
  session: CampaignSessionUser,
  templateId: string,
  fields: TemplateFields,
) {
  const existing = await assertTemplateAccess(session, templateId);
  const prior: TemplateFields =
    existing.fields && typeof existing.fields === "object"
      ? (existing.fields as TemplateFields)
      : {};
  let nextFields: TemplateFields = mergeTemplateFields(prior, fields || {});
  const channel = String(existing.channel || "")
    .trim()
    .toLowerCase();
  if (channel === "email") {
    nextFields = canonicalizeEmailTemplateFields(nextFields);
  }
  if (channel === "whatsapp") {
    // Keep Meta name stable; mark draft so launch re-submits latest content.
    if (prior.name && !nextFields.name) {
      nextFields.name = prior.name;
    }
    nextFields = finalizeWhatsAppFieldsForPersist(templateId, nextFields);
  }
  const row = await prisma.campaignChannelTemplate.update({
    where: { id: templateId },
    data: { fields: nextFields as Prisma.InputJsonValue },
  });
  return { template: toCard(row) };
}

export async function appendTemplateMessagesDao(
  session: CampaignSessionUser,
  templateId: string,
  messages: Array<{
    role: string;
    kind: string;
    payload: Record<string, unknown>;
  }>,
) {
  await assertTemplateAccess(session, templateId);
  const last = await prisma.campaignTemplateMessage.findFirst({
    where: { templateId },
    orderBy: { seq: "desc" },
    select: { seq: true },
  });
  let seq = (last?.seq ?? -1) + 1;
  const created = await prisma.$transaction(async (tx) => {
    const out = [];
    for (const msg of messages) {
      const row = await tx.campaignTemplateMessage.create({
        data: {
          templateId,
          role: msg.role,
          seq,
          kind: msg.kind,
          payload: msg.payload as Prisma.InputJsonValue,
        },
      });
      seq += 1;
      out.push(row);
    }
    return out;
  });
  return { messages: created.map(toMessage) };
}
