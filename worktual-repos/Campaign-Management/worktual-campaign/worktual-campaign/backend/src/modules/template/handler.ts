// @ts-nocheck — worktual_bigint Prisma BigInt ids; runtime coerced to string in plugins/prisma.ts
import type { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { requireSession } from "../../middlewares/authendication.js";
import { AppError, sendSuccess } from "../../helpers/response-builders.js";
import { RESPONSE } from "../../helpers/constants.js";
import {
  createRegulatedTemplateDao,
  deleteRegulatedTemplateDao,
  getRegulatedTemplateDao,
  listRegulatedTemplatesDao,
  markRegulatedSubmittedDao,
  publicRegulatedTemplate,
  setRegulatedStatusManualDao,
  updateRegulatedDraftDao,
  type RegulatedChannel,
} from "../../dao/regulated-template.js";
import { resolveWhatsAppChannelConfigId } from "../../dao/whatsapp-channel-config.js";
import { listContactPhonesByIdsDao } from "../../dao/contact.js";
import {
  assertSmsReadyToSend,
  getCampaignSmsStatusDao,
} from "../../dao/sms-config.js";
import {
  phoneToWhatsAppTo,
  whatsappLanguageCandidates,
} from "../../helpers/whatsapp-template-map.js";
import {
  mapMetaStatusToLocal,
  socialSendApprovedTemplate,
  socialSubmitTemplateApproval,
} from "../../services/social-whatsapp.js";
import { refreshRegulatedWhatsAppStatus } from "../../services/regulated-whatsapp-status.js";
import { syncMetaWhatsAppTemplatesToLibrary } from "../../services/sync-meta-whatsapp-templates.js";
import { sendSmsMessage } from "../../services/sms-send.js";
import { dbIdParam, zContactId } from "../../helpers/id-schema.js";

const channelQuery = z.enum(["sms", "whatsapp"]);

const createBody = z.object({
  channel: channelQuery,
  name: z.string().min(1),
  externalId: z.string().optional(),
  language: z.string().optional(),
  category: z.string().optional(),
  header: z.string().optional(),
  body: z.string().min(1),
  footer: z.string().optional(),
  buttons: z.string().optional(),
  /** SMS: create already approved with DLT id */
  asApproved: z.boolean().optional(),
});

const updateBody = z.object({
  name: z.string().min(1).optional(),
  externalId: z.string().optional(),
  language: z.string().optional(),
  category: z.string().optional(),
  header: z.string().optional(),
  body: z.string().min(1).optional(),
  footer: z.string().optional(),
  buttons: z.string().optional(),
});

const statusBody = z.object({
  status: z.enum(["pending", "approved", "rejected"]),
  rejectedReason: z.string().optional(),
});

const phoneDigits = z
  .string()
  .min(8)
  .regex(/^\d+$/, "Phone must be digits only with country code");

const sendBody = z
  .object({
    /** Single recipient (digits + country code). */
    to: phoneDigits.optional(),
    /** Multiple recipients — same rules as `to`. */
    tos: z.array(phoneDigits).min(1).max(500).optional(),
    /** Resolve phones from audience contact IDs (WhatsApp / SMS). */
    contactIds: z.array(zContactId).min(1).max(500).optional(),
    /** Optional body variable values in order for {{1}}, {{2}}, … */
    bodyParams: z.array(z.string()).optional(),
  })
  .refine(
    (b) =>
      Boolean(b.to) ||
      (b.tos && b.tos.length > 0) ||
      (b.contactIds && b.contactIds.length > 0),
    {
      message:
        "Provide `to` (single), `tos` (phones), or `contactIds` (selected contacts).",
    },
  );

function buildWhatsAppComponents(row: {
  header: string;
  body: string;
  footer: string;
  buttons: string;
}): Array<Record<string, unknown>> {
  const components: Array<Record<string, unknown>> = [];
  if (row.header.trim()) {
    components.push({
      type: "HEADER",
      format: "TEXT",
      text: row.header.trim(),
    });
  }
  components.push({
    type: "BODY",
    text: row.body.trim(),
  });
  if (row.footer.trim()) {
    components.push({
      type: "FOOTER",
      text: row.footer.trim(),
    });
  }
  const buttonLines = row.buttons
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 3);
  if (buttonLines.length) {
    components.push({
      type: "BUTTONS",
      buttons: buttonLines.map((text) => ({
        type: "QUICK_REPLY",
        text: text.slice(0, 25),
      })),
    });
  }
  return components;
}

function buildSendBodyComponents(bodyParams?: string[]) {
  if (!bodyParams?.length) return undefined;
  return [
    {
      type: "body",
      parameters: bodyParams.map((text) => ({ type: "text", text })),
    },
  ];
}

export async function listRegulatedTemplatesHandler(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const session = requireSession(request);
  const q = z
    .object({
      channel: channelQuery.optional(),
      status: z
        .enum(["draft", "pending", "approved", "rejected", "paused", "disabled"])
        .optional(),
    })
    .parse(request.query);
  const templates = await listRegulatedTemplatesDao(
    session.organizationId,
    q.channel,
    q.status,
  );
  return sendSuccess(reply, RESPONSE.success_message, { templates });
}

export async function createRegulatedTemplateHandler(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const session = requireSession(request);
  const body = createBody.parse(request.body);
  const asApproved = Boolean(body.asApproved && body.channel === "sms");
  if (asApproved && !body.externalId?.trim()) {
    throw new AppError("DLT Template ID is required for approved SMS.", 400);
  }
  const row = await createRegulatedTemplateDao({
    organizationId: session.organizationId,
    userId: session.id,
    channel: body.channel as RegulatedChannel,
    name: body.name,
    externalId: body.externalId,
    language: body.language,
    category: body.category,
    header: body.header,
    body: body.body,
    footer: body.footer,
    buttons: body.buttons,
    status: asApproved ? "approved" : "draft",
    submittedAt: asApproved ? new Date() : null,
  });
  return sendSuccess(
    reply,
    RESPONSE.success_message,
    { template: publicRegulatedTemplate(row) },
    201,
  );
}

export async function updateRegulatedTemplateHandler(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const session = requireSession(request);
  const { id } = dbIdParam().parse(request.params);
  const body = updateBody.parse(request.body);
  const row = await updateRegulatedDraftDao(session.organizationId, id, body);
  return sendSuccess(reply, RESPONSE.success_message, {
    template: publicRegulatedTemplate(row),
  });
}

export async function deleteRegulatedTemplateHandler(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const session = requireSession(request);
  const { id } = dbIdParam().parse(request.params);
  await deleteRegulatedTemplateDao(session.organizationId, id);
  return sendSuccess(reply, RESPONSE.success_message, { deleted: true });
}

export async function setRegulatedStatusHandler(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const session = requireSession(request);
  const { id } = dbIdParam().parse(request.params);
  const body = statusBody.parse(request.body);
  const row = await setRegulatedStatusManualDao(
    session.organizationId,
    id,
    body.status,
    body.rejectedReason,
  );
  return sendSuccess(reply, RESPONSE.success_message, {
    template: publicRegulatedTemplate(row),
  });
}

/** WhatsApp: submit draft to Meta via social-service. */
export async function submitWhatsAppApprovalHandler(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const session = requireSession(request);
  const { id } = dbIdParam().parse(request.params);
  const row = await getRegulatedTemplateDao(session.organizationId, id);
  if (row.channel !== "whatsapp") {
    throw new AppError("Only WhatsApp templates can be submitted to Meta.", 400);
  }
  if (row.status !== "draft") {
    throw new AppError(
      row.status === "pending"
        ? "This template is already waiting on Meta. Use Refresh status."
        : row.status === "rejected"
          ? "Rejected templates cannot be resubmitted. Create a new template with a new name."
          : `Cannot submit a template in status "${row.status}".`,
      400,
    );
  }

  const channelConfigId = await resolveWhatsAppChannelConfigId(session.organizationId);
  const category = (row.category || "MARKETING").toUpperCase();
  const result = await socialSubmitTemplateApproval({
    channelConfigId,
    name: row.name,
    language: row.language || "en",
    category:
      category === "UTILITY" || category === "AUTHENTICATION"
        ? category
        : "MARKETING",
    allowCategoryChange: false,
    components: buildWhatsAppComponents(row),
  });

  const metaStatus = mapMetaStatusToLocal(result.status);
  const updated = await markRegulatedSubmittedDao(row.id, {
    status: metaStatus,
    providerTemplateId: result.templateId || null,
    externalId: result.templateName || row.name,
    channelConfigId,
    rejectedReason:
      metaStatus === "rejected" ? "Rejected by Meta on submit" : null,
  });

  return sendSuccess(reply, RESPONSE.success_message, {
    template: publicRegulatedTemplate(updated),
    meta: {
      submitted: result.submitted ?? true,
      status: result.status || "PENDING",
      localStatus: metaStatus,
    },
  });
}

/** WhatsApp: poll Meta approval status. */
export async function refreshWhatsAppStatusHandler(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const session = requireSession(request);
  const { id } = dbIdParam().parse(request.params);
  const result = await refreshRegulatedWhatsAppStatus({
    organizationId: session.organizationId,
    templateId: id,
  });

  return sendSuccess(reply, RESPONSE.success_message, {
    template: result.template,
    meta: result.meta,
  });
}

/** Send approved SMS or WhatsApp template to phones and/or selected contacts. */
export async function sendRegulatedTemplateHandler(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const session = requireSession(request);
  const { id } = dbIdParam().parse(request.params);
  const body = sendBody.parse(request.body);
  const row = await getRegulatedTemplateDao(session.organizationId, id);
  if (row.status !== "approved") {
    throw new AppError("Template must be approved before sending.", 400);
  }

  const fromContacts = body.contactIds?.length
    ? await listContactPhonesByIdsDao(session, body.contactIds)
    : [];
  const contactPhones = fromContacts
    .map((c) => phoneToWhatsAppTo(c.phone))
    .filter((v): v is string => Boolean(v));

  // Normalize pasted `to`/`tos` the same way (fixes double country-code like 9191…).
  const pastedPhones = [
    ...(body.to ? [body.to] : []),
    ...(body.tos || []),
  ]
    .map((p) => phoneToWhatsAppTo(p))
    .filter((v): v is string => Boolean(v));

  const recipients = [...pastedPhones, ...contactPhones].filter(
    (v, i, arr) => arr.indexOf(v) === i,
  );

  if (!recipients.length) {
    throw new AppError(
      "No eligible phone numbers. Provide `to`/`tos` or contacts with WhatsApp phones.",
      400,
    );
  }

  if (row.channel === "sms") {
    const settings = await assertSmsReadyToSend(session.organizationId);
    const results = [];
    for (const to of recipients) {
      const result = await sendSmsMessage({
        to,
        body: row.body,
        dltTemplateId: row.externalId || undefined,
        senderId: settings.sender_id,
        entityId: settings.entity_id || undefined,
        provider: settings.provider || "stub",
        apiKey: settings.api_key || undefined,
        baseUrl: settings.base_url || undefined,
      });
      results.push({ to, ...result });
    }
    return sendSuccess(reply, RESPONSE.success_message, {
      sent: results.every((r) => r.sent),
      results,
      providerMessageId: results[0]?.providerMessageId ?? null,
      stub: results[0]?.stub,
      recipient_count: results.length,
      template: publicRegulatedTemplate(row),
    });
  }

  if (row.channel !== "whatsapp") {
    throw new AppError("Unsupported channel for send.", 400);
  }

  const channelConfigId =
    row.channelConfigId ||
    (await resolveWhatsAppChannelConfigId(session.organizationId));

  const languageCandidates = whatsappLanguageCandidates(row.language);
  const components = buildSendBodyComponents(body.bodyParams);

  const results = [];
  for (const to of recipients) {
    let lastErr: unknown = null;
    let sentResult: {
      to: string;
      sent: boolean;
      providerMessageId: string | null;
      languageCode?: string;
    } | null = null;

    for (const languageCode of languageCandidates) {
      try {
        const result = await socialSendApprovedTemplate({
          channelConfigId,
          to,
          templateName: row.name,
          languageCode,
          components,
        });
        sentResult = {
          to,
          sent: result.sent ?? true,
          providerMessageId: result.providerMessageId || null,
          languageCode,
        };
        break;
      } catch (err) {
        lastErr = err;
        const msg = err instanceof Error ? err.message : String(err);
        const looksLikeLanguage =
          /language|locale|template.*not.*exist|does not exist|(#132001)|translation/i.test(
            msg,
          );
        // Only try the next language candidate on language/template-locale errors
        if (
          !looksLikeLanguage ||
          languageCode === languageCandidates[languageCandidates.length - 1]
        ) {
          throw err;
        }
      }
    }

    if (!sentResult) {
      throw lastErr instanceof Error
        ? lastErr
        : new AppError("WhatsApp send failed.", 502);
    }
    results.push(sentResult);
  }

  return sendSuccess(reply, RESPONSE.success_message, {
    sent: results.every((r) => r.sent),
    results,
    providerMessageId: results[0]?.providerMessageId ?? null,
    recipient_count: results.length,
    languageCode: results[0]?.languageCode ?? languageCandidates[0],
    template: publicRegulatedTemplate(row),
  });
}

/** Soft check: is SMS configured? */
export async function smsConfigReadyHandler(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const session = requireSession(request);
  const status = await getCampaignSmsStatusDao(session.organizationId);
  if (status === "ready") {
    return sendSuccess(reply, RESPONSE.success_message, {
      ready: true,
      message: "SMS channel is configured.",
    });
  }
  return sendSuccess(reply, RESPONSE.success_message, {
    ready: false,
    message:
      "SMS is not configured. Open Configuration → SMS and set sender ID before sending.",
  });
}

/** Soft check: is WhatsApp configured? (no UUID returned) */
export async function whatsappConfigReadyHandler(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const session = requireSession(request);
  try {
    await resolveWhatsAppChannelConfigId(session.organizationId);
    return sendSuccess(reply, RESPONSE.success_message, {
      ready: true,
      message: "WhatsApp channel is configured.",
    });
  } catch (err) {
    if (err instanceof AppError && err.code === "WHATSAPP_NOT_CONFIGURED") {
      return sendSuccess(reply, RESPONSE.success_message, {
        ready: false,
        message: err.message,
      });
    }
    throw err;
  }
}

/**
 * Pull Meta WABA templates (list + components) into library Pending / Approved / Rejected.
 */
export async function syncMetaWhatsAppTemplatesHandler(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const session = requireSession(request);
  const result = await syncMetaWhatsAppTemplatesToLibrary({
    organizationId: session.organizationId,
    userId: session.id,
  });
  const templates = await listRegulatedTemplatesDao(
    session.organizationId,
    "whatsapp",
  );
  return sendSuccess(reply, RESPONSE.success_message, {
    sync: result,
    templates,
  });
}
