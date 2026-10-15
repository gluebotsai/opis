/**
 * Lead nurture outbound: Campaign personalised-crm (primary) → CRM bot email (fallback).
 */

import { createContactActivity } from "@/dao/contacts/contact-activity-service";
import {
  backfillUnownedEmailActivityUserIdsOnce,
  resolveContactOwnerUserId,
} from "@/dao/inbox/email-activity-user";
import { notifyAdminsAsync } from "@/dao/notifications/notify-admins";
import { triggerLeadLifecycle } from "@/service/ai/lead-lifecycle-trigger";
import { enqueueLeadScoring } from "@/service/ai/lead-scoring-job";
/** Minimal contact context for nurture send (avoids circular import with lead-nurture-job). */
export type NurtureSendContext = {
  organizationId: string;
  contactId: string;
  displayName: string;
  firstName: string;
  email: string;
  secondaryEmails: string[];
  /** Phone on the contact. Enables WhatsApp when email is missing or after cooldown. */
  phone?: string | null;
  secondaryPhones?: string[];
  /** Set once a nurture touch has already gone out. */
  lastSentAt?: Date | null;
  companyName: string | null;
  ownerUserId: string | null;
  hasCrmBotMailbox: boolean;
};

export type NurtureChannel = "email" | "whatsapp";

/**
 * First touch uses email when one exists, otherwise the channel on file.
 * After the cooling period, a later touch may add another channel that exists.
 */
export function selectNurtureChannels(input: {
  email: string | null;
  phone: string | null;
  afterCooldown: boolean;
}): NurtureChannel[] {
  const email = input.email?.trim() || null;
  const phone = input.phone?.trim() || null;
  if (email && !input.afterCooldown) return ["email"];
  if (!email && phone) return ["whatsapp"];
  if (email && input.afterCooldown) {
    return phone ? ["email", "whatsapp"] : ["email"];
  }
  return [];
}

/** Primary email with secondary fallback — same resolution as contact detail UI. */
/** Primary phone with secondary fallback. */
export function resolveNurturePhone(
  phone: string | null | undefined,
  secondaryPhones?: string[] | null,
): string | null {
  const primary = phone?.trim();
  if (primary && primary.replace(/\D/g, "").length >= 7) return primary;
  for (const raw of secondaryPhones ?? []) {
    const value = raw?.trim();
    if (value && value.replace(/\D/g, "").length >= 7) return value;
  }
  return null;
}

export function resolveNurtureEmail(
  email: string | null | undefined,
  secondaryEmails?: string[] | null,
): string | null {
  const primary = email?.trim();
  if (primary?.includes("@")) return primary;
  for (const raw of secondaryEmails ?? []) {
    const value = raw?.trim();
    if (value?.includes("@")) return value;
  }
  return null;
}
import { sendCrmBotEmail } from "@/service/email/send-crm-bot-email";
import { writeNurtureApiLog } from "@/service/ai/nurture-api-log";
import {
  mintCampaignHandoffJwt,
  resolveCampaignHandoffScope,
} from "@/service/integrations/campaign-handoff";
import {
  createPersonalisedCrmAutomationRun,
  createPersonalisedCrmRun,
  isCampaignApiConfigured,
  isCampaignAutomationConfigured,
} from "@/service/integrations/marketing-ms";

export type NurtureOutboundCopy = {
  brief?: string | null;
  campaignName?: string | null;
  goal?: string | null;
  /** LLM-authored, evidence-grounded guidance for the cc-core voice bot. */
  voiceInstruction?: string | null;
  subject?: string | null;
  body?: string | null;
};

export type NurtureCampaignTransport = "campaign" | "campaign_automation";

export type NurtureOutboundResult =
  | {
      ok: true;
      transport: NurtureCampaignTransport;
      runId: string;
      campaignStatus?: string | null;
      warnings?: string[];
    }
  | {
      ok: true;
      transport: "voice_auto_bot";
      sessionId: string;
      channel?: string | null;
      cli?: string | null;
    }
  | {
      ok: true;
      transport: "fallback";
      subject: string;
      via?: string | null;
      fromEmail?: string | null;
      messageId?: string | null;
      threadId?: string | null;
      rfcMessageId?: string | null;
    }
  | {
      ok: false;
      error: string;
      reason:
        | "campaign_failed"
        | "no_transport"
        | "missing_brief"
        | "missing_email_copy"
        | "no_email"
        | "no_channel"
        | "send_failed"
        | "needs_connect";
    };

function clipBrief(text: string, max = 8000): string {
  const cleaned = text.trim();
  if (cleaned.length <= max) return cleaned;
  return cleaned.slice(0, max - 1).trimEnd() + "…";
}

function defaultCampaignName(ctx: NurtureSendContext): string {
  const who = ctx.displayName?.trim() || ctx.firstName?.trim() || "Lead";
  return `Nurture — ${who}`.slice(0, 200);
}

function personalisedCrmAudience(ctx: NurtureSendContext) {
  const toEmail = resolveNurtureEmail(ctx.email, ctx.secondaryEmails);
  const phone = ctx.phone?.trim() || null;
  const channels = selectNurtureChannels({
    email: toEmail,
    phone,
    afterCooldown: Boolean(ctx.lastSentAt),
  });
  const person: {
    email?: string;
    phone?: string;
    contact_id: string;
  } = { contact_id: ctx.contactId };
  if (toEmail && channels.includes("email")) person.email = toEmail;
  if (phone && channels.includes("whatsapp")) person.phone = phone;
  const people = channels.length ? [person] : undefined;
  return {
    name: (copy: NurtureOutboundCopy) =>
      (copy.campaignName?.trim() || defaultCampaignName(ctx)).slice(0, 200),
    brief: (copy: NurtureOutboundCopy) => clipBrief(copy.brief!.trim()),
    goal: (copy: NurtureOutboundCopy) =>
      copy.goal?.trim()?.slice(0, 400) || null,
    channels,
    contact_ids: [ctx.contactId],
    people,
  };
}

function acceptCampaignResult(
  result: Awaited<ReturnType<typeof createPersonalisedCrmRun>>,
):
  | { ok: true; runId: string; campaignStatus?: string | null; warnings?: string[] }
  | { ok: false; error: string } {
  if (!result.ok) {
    return { ok: false, error: result.error };
  }
  const runId = result.data.run_id;
  if (runId == null || String(runId).trim() === "") {
    return { ok: false, error: "campaign_missing_run_id" };
  }
  return {
    ok: true,
    runId: String(runId),
    campaignStatus: result.data.status ?? null,
    warnings: Array.isArray(result.data.warnings)
      ? result.data.warnings.map(String)
      : undefined,
  };
}

async function tryCampaignSend(
  ctx: NurtureSendContext,
  copy: NurtureOutboundCopy,
): Promise<
  | {
      ok: true;
      path: NurtureCampaignTransport;
      runId: string;
      campaignStatus?: string | null;
      warnings?: string[];
    }
  | { ok: false; error: string }
> {
  const brief = copy.brief?.trim();
  if (!brief) {
    return { ok: false, error: "missing_brief" };
  }

  const audience = personalisedCrmAudience(ctx);
  if (audience.channels.length === 0) {
    return { ok: false, error: "no_channel" };
  }
  const sendBody = {
    name: audience.name(copy),
    brief: audience.brief(copy),
    goal: audience.goal(copy),
    channels: audience.channels,
    contact_ids: audience.contact_ids,
    people: audience.people,
  };

  const errors: string[] = [];

  if (isCampaignAutomationConfigured()) {
    const automation = await createPersonalisedCrmAutomationRun({
      ...sendBody,
      organization_id: ctx.organizationId,
    });
    const accepted = acceptCampaignResult(automation);
    if (accepted.ok) {
      return { ...accepted, path: "campaign_automation" };
    }
    errors.push(`automation: ${accepted.error}`);
  }

  const scope = await resolveCampaignHandoffScope(ctx.organizationId);
  const jwt = scope ? mintCampaignHandoffJwt(scope) : null;
  if (jwt) {
    const jwtResult = await createPersonalisedCrmRun(jwt, sendBody);
    const accepted = acceptCampaignResult(jwtResult);
    if (accepted.ok) {
      return { ...accepted, path: "campaign" };
    }
    errors.push(`jwt: ${accepted.error}`);
  } else if (!isCampaignAutomationConfigured()) {
    errors.push("jwt_not_configured");
  }

  return {
    ok: false,
    error: errors.length > 0 ? errors.join("; ") : "campaign_not_configured",
  };
}

async function tryCrmBotSend(
  ctx: NurtureSendContext,
  copy: NurtureOutboundCopy,
): Promise<
  | {
      ok: true;
      subject: string;
      via?: string | null;
      fromEmail?: string | null;
      messageId?: string | null;
      threadId?: string | null;
      rfcMessageId?: string | null;
    }
  | { ok: false; error: string; needsConnect?: boolean }
> {
  const subject = copy.subject?.trim();
  const body = copy.body?.trim();
  if (!subject || !body) {
    return { ok: false, error: "missing_email_copy" };
  }

  const to = resolveNurtureEmail(ctx.email, ctx.secondaryEmails);
  if (!to) {
    return { ok: false, error: "no_email" };
  }

  const sent = await sendCrmBotEmail({
    organizationId: ctx.organizationId,
    to,
    subject,
    body,
  });

  writeNurtureApiLog({
    nurtureKind: "email",
    service: "crm-bot",
    operation: "crm-bot-fallback-email",
    method: "POST",
    url: "crm-bot://mailbox/send",
    request: {
      organizationId: ctx.organizationId,
      contactId: ctx.contactId,
      to,
      subject,
      body,
    },
    response: sent.ok
      ? {
          via: sent.via,
          fromEmail: sent.fromEmail,
          messageId: sent.messageId,
          threadId: sent.threadId,
        }
      : { error: sent.error, needsConnect: sent.needsConnect },
    status: sent.ok ? 200 : null,
    ok: sent.ok,
    organizationId: ctx.organizationId,
    contactId: ctx.contactId,
    error: sent.ok ? null : sent.error,
  });

  if (!sent.ok) {
    return {
      ok: false,
      error: sent.error,
      needsConnect: sent.needsConnect,
    };
  }

  return {
    ok: true,
    subject,
    via: sent.via,
    fromEmail: sent.fromEmail ?? null,
    messageId: sent.messageId ?? null,
    threadId: sent.threadId ?? null,
    rfcMessageId: sent.rfcMessageId ?? null,
  };
}

export async function sendNurtureOutbound(
  ctx: NurtureSendContext,
  copy: NurtureOutboundCopy,
): Promise<NurtureOutboundResult> {
  if (isCampaignApiConfigured()) {
    const campaign = await tryCampaignSend(ctx, copy);
    if (campaign.ok) {
      return {
        ok: true,
        transport: campaign.path,
        runId: campaign.runId,
        campaignStatus: campaign.campaignStatus,
        warnings: campaign.warnings,
      };
    }
    if (campaign.error === "no_channel") {
      return {
        ok: false,
        error: "This contact has no email or other channel.",
        reason: "no_channel",
      };
    }
    if (ctx.hasCrmBotMailbox && resolveNurtureEmail(ctx.email, ctx.secondaryEmails)) {
      const fallback = await tryCrmBotSend(ctx, copy);
      if (fallback.ok) {
        return {
          ok: true,
          transport: "fallback",
          subject: fallback.subject,
          via: fallback.via,
          fromEmail: fallback.fromEmail,
          messageId: fallback.messageId,
          threadId: fallback.threadId,
          rfcMessageId: fallback.rfcMessageId,
        };
      }
      return {
        ok: false,
        error: `${campaign.error}; fallback: ${fallback.error}`,
        reason: fallback.needsConnect ? "needs_connect" : "send_failed",
      };
    }
    return {
      ok: false,
      error: campaign.error,
      reason: "campaign_failed",
    };
  }

  if (!ctx.hasCrmBotMailbox) {
    return {
      ok: false,
      error: "Campaign API and CRM bot mailbox are not configured.",
      reason: "no_transport",
    };
  }

  const fallback = await tryCrmBotSend(ctx, copy);
  if (!fallback.ok) {
    return {
      ok: false,
      error: fallback.error,
      reason: fallback.needsConnect ? "needs_connect" : "send_failed",
    };
  }
  return {
    ok: true,
    transport: "fallback",
    subject: fallback.subject,
    via: fallback.via,
    fromEmail: fallback.fromEmail,
    messageId: fallback.messageId,
    threadId: fallback.threadId,
    rfcMessageId: fallback.rfcMessageId,
  };
}

export async function recordNurtureOutboundSent(input: {
  ctx: NurtureSendContext;
  score: number;
  rationale: string;
  fallbackBody?: string | null;
  outbound: Extract<NurtureOutboundResult, { ok: true }>;
}): Promise<void> {
  const { ctx, score, rationale, outbound, fallbackBody } = input;
  const emailUserId =
    ctx.ownerUserId?.trim() ||
    (await resolveContactOwnerUserId(ctx.contactId));
  void backfillUnownedEmailActivityUserIdsOnce();

  if (outbound.transport === "voice_auto_bot") {
    const activity = await createContactActivity(ctx.contactId, {
      type: "call",
      subject: "Nurture voice bot call",
      body: [
        "Nurture agent triggered an autonomous voice bot call via cc-core.",
        outbound.channel ? `Channel: ${outbound.channel}` : null,
        outbound.cli ? `CLI: ${outbound.cli}` : null,
      ]
        .filter((line) => line != null)
        .join("\n"),
      folder: "sent",
      createdByUserId: null,
      organizationId: ctx.organizationId,
    });
    const triggeredAt = new Date();
    const { recordNurtureVoiceCall } = await import(
      "@/service/voice/nurture-call-transcript"
    );
    await recordNurtureVoiceCall({
      organizationId: ctx.organizationId,
      contactId: ctx.contactId,
      activityId: activity.id,
      sessionId: outbound.sessionId,
      triggeredAt,
    }).catch((error) => {
      console.warn(
        "[nurture-voice] session link save failed",
        error instanceof Error ? error.message : error,
      );
    });
  } else if (
    outbound.transport === "campaign" ||
    outbound.transport === "campaign_automation"
  ) {
    // Campaign delivers the email on its own. Mailbox sync logs that sent
    // message. A second "run id" row here is not the email the customer got,
    // so the contact timeline showed two logs for one send.
  } else if (outbound.transport === "fallback") {
    await createContactActivity(ctx.contactId, {
      type: "email",
      subject: outbound.subject,
      body: [
        "Nurture agent (autonomous re-engage, CRM bot fallback).",
        outbound.fromEmail ? `From: ${outbound.fromEmail}` : null,
        "",
        fallbackBody ?? "",
      ]
        .filter((line) => line != null)
        .join("\n"),
      folder: "sent",
      emailDirection: "outbound",
      createdByUserId: emailUserId,
      gmailMessageId: outbound.messageId ?? null,
      gmailThreadId: outbound.threadId ?? null,
      rfcMessageId: outbound.rfcMessageId ?? null,
    });
  }

  triggerLeadLifecycle({
    contactId: ctx.contactId,
    organizationId: ctx.organizationId,
    triggerReason: "nurture_sent",
  });

  void enqueueLeadScoring({
    contactId: ctx.contactId,
    organizationId: ctx.organizationId,
    triggerReason: "nurture_sent",
    processImmediately: true,
  }).catch((err) => console.error("scoring after nurture send failed", err));

  const emailed = Boolean(resolveNurtureEmail(ctx.email, ctx.secondaryEmails));
  const channels =
    outbound.transport === "voice_auto_bot"
      ? []
      : selectNurtureChannels({
          email: emailed ? resolveNurtureEmail(ctx.email, ctx.secondaryEmails) : null,
          phone: ctx.phone?.trim() || null,
          afterCooldown: Boolean(ctx.lastSentAt),
        });
  const detail =
    outbound.transport === "voice_auto_bot"
      ? `Nurture call started. Session ${outbound.sessionId}`
      : outbound.transport === "fallback"
        ? `Subject: ${outbound.subject}`
        : channels.includes("email")
          ? `Campaign run ${outbound.runId}`
          : channels.includes("whatsapp")
            ? `WhatsApp nurture started. Campaign run ${outbound.runId}`
            : `Campaign run ${outbound.runId}`;

  notifyAdminsAsync({
    kind: "lead_nurtured",
    organizationId: ctx.organizationId,
    contactId: ctx.contactId,
    contactName: ctx.displayName,
    companyName: ctx.companyName,
    ownerUserId: ctx.ownerUserId,
    actorUserId: null,
    href: `/contact/${ctx.contactId}`,
    detail,
    excludeUserId: null,
    metadata: {
      score,
      rationale,
      transport: outbound.transport,
      emailed: outbound.transport === "fallback" ? true : emailed && channels.includes("email"),
      channels,
      runId:
        outbound.transport === "campaign" ||
        outbound.transport === "campaign_automation"
          ? outbound.runId
          : undefined,
      sessionId:
        outbound.transport === "voice_auto_bot"
          ? outbound.sessionId
          : undefined,
      subject: outbound.transport === "fallback" ? outbound.subject : undefined,
    },
  });
}
