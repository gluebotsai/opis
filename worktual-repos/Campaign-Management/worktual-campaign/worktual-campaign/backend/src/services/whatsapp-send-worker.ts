// @ts-nocheck — worktual_bigint Prisma BigInt ids; runtime coerced to string in plugins/prisma.ts
import type { Prisma } from "@prisma/client";
import { prisma } from "../plugins/prisma.js";
import { env } from "../config/env.js";
import { MAX_WHATSAPP_SEND_ATTEMPTS } from "../helpers/email-send-constants.js";
import {
  buildSendTemplateComponents,
  phoneToWhatsAppTo,
  whatsappLanguageCandidates,
} from "../helpers/whatsapp-template-map.js";
import { listContactFirstNamesByIdsDao } from "../dao/contact.js";
import {
  getCampaignWhatsAppMeta,
  type WhatsAppLaunchMeta,
} from "../dao/whatsapp-launch.js";
import { resolveWhatsAppChannelConfigId } from "../dao/whatsapp-channel-config.js";
import type { CampaignSessionUser } from "../types/auth.js";
import {
  abortBatchIfCampaignStopped,
  reconcileCampaignSendLifecycle,
} from "./campaign-send-lifecycle.js";
import { socialSendApprovedTemplate } from "./social-whatsapp.js";
import {
  buildMergeMapsForContacts,
  isDynamicOfferEnabled,
} from "./personalization/index.js";

type Logger = {
  info: (obj: unknown, msg?: string) => void;
  warn: (obj: unknown, msg?: string) => void;
  error: (obj: unknown, msg?: string) => void;
};

function sessionForTenant(
  organizationId: string,
  branchId: string,
): CampaignSessionUser {
  return {
    id: "00000000-0000-4000-8000-000000000097",
    organizationId,
    branchId,
    email: "whatsapp-worker@local",
    name: "WhatsApp worker",
    role: "system",
    initials: "WW",
    orgName: "system",
  };
}

function readMaxAttempts(launchPlan: unknown): number {
  if (!launchPlan || typeof launchPlan !== "object") {
    return MAX_WHATSAPP_SEND_ATTEMPTS;
  }
  const plan = launchPlan as Record<string, unknown>;
  const n = plan.max_send_attempts;
  if (typeof n === "number" && n >= 1 && n <= 10) return Math.floor(n);
  return MAX_WHATSAPP_SEND_ATTEMPTS;
}

async function processWhatsAppBatch(batchId: string, log: Logger) {
  const batch = await prisma.campaignSendBatch.findUnique({
    where: { id: batchId },
    include: {
      recipients: { where: { status: "pending" } },
      campaign: true,
    },
  });
  if (!batch || batch.status !== "queued") return;
  if (batch.channel !== "whatsapp") return;
  if (await abortBatchIfCampaignStopped(batch.id, batch.campaignId, log)) {
    return;
  }

  let meta = getCampaignWhatsAppMeta(batch.campaign.launchPlan);
  if (!meta) {
    log.warn({ batchId }, "WhatsApp batch has no launchPlan.whatsapp meta");
    return;
  }

  if (meta.status === "pending") {
    log.info(
      { batchId, campaignId: batch.campaignId, template: meta.template_name },
      "WhatsApp template still pending approval — leaving batch queued",
    );
    return;
  }

  if (meta.status === "rejected" || meta.status === "paused" || meta.status === "disabled") {
    await prisma.campaignSendBatch.update({
      where: { id: batch.id },
      data: { status: "failed" },
    });
    await prisma.campaignSendRecipient.updateMany({
      where: { batchId: batch.id, status: "pending" },
      data: {
        status: "failed",
        skipFailReason: `template_${meta.status}`,
        attemptCount: MAX_WHATSAPP_SEND_ATTEMPTS,
      },
    });
    await reconcileCampaignSendLifecycle(batch.campaignId, log);
    return;
  }

  if (meta.status !== "approved") {
    return;
  }

  const plan =
    batch.campaign.launchPlan && typeof batch.campaign.launchPlan === "object"
      ? (batch.campaign.launchPlan as Record<string, unknown>)
      : {};
  const maxAttempts = readMaxAttempts(plan);
  const runMap =
    plan.channel_run && typeof plan.channel_run === "object"
      ? (plan.channel_run as Record<string, unknown>)
      : {};
  const channelRun =
    runMap.whatsapp && typeof runMap.whatsapp === "object"
      ? (runMap.whatsapp as Record<string, unknown>)
      : {};
  if (channelRun.paused === true) {
    log.info({ batchId }, "Skip WhatsApp batch — paused");
    return;
  }

  await prisma.campaignSendBatch.update({
    where: { id: batch.id },
    data: { status: "sending" },
  });
  await reconcileCampaignSendLifecycle(batch.campaignId, log);

  const workerSession = sessionForTenant(
    batch.organizationId,
    batch.campaign.branchId,
  );
  const contactIds = batch.recipients
    .map((r) => r.contactId)
    .filter((id): id is string => Boolean(id));
  const identityById = new Map<
    string,
    { firstName?: string; company?: string; city?: string }
  >();
  if (contactIds.length) {
    try {
      const rows = await listContactFirstNamesByIdsDao(
        workerSession,
        contactIds,
      );
      for (const row of rows) {
        identityById.set(row.contactId, {
          firstName: row.firstName || "",
          company: row.company || "",
          city: row.city || "",
        });
      }
    } catch (err) {
      log.warn({ err, batchId }, "Could not load merge fields for WhatsApp");
    }
  }

  // Dynamic offers only fill placeholders already on the approved template.
  const dynamicOffer = isDynamicOfferEnabled(plan);
  let mergeByContactId = new Map<string, Record<string, string>>();
  try {
    mergeByContactId = await buildMergeMapsForContacts(
      contactIds,
      identityById,
      {
        dynamicOffer,
        defaultCampaignUrl: env.appUrl,
      },
    );
  } catch (err) {
    log.warn({ err, batchId }, "Personalization adapter failed for WhatsApp");
  }

  let sent = 0;
  let failed = 0;
  let channelConfigId = meta.channel_config_id || "";
  try {
    channelConfigId = await resolveWhatsAppChannelConfigId(batch.organizationId);
  } catch (err) {
    log.warn(
      { err, batchId, fallback: meta.channel_config_id },
      "Could not resolve WhatsApp channel config; using launchPlan meta",
    );
  }
  if (!channelConfigId) {
    await prisma.campaignSendBatch.update({
      where: { id: batch.id },
      data: {
        status: "failed",
        skipFailReason: "whatsapp_not_configured",
      },
    });
    await reconcileCampaignSendLifecycle(batch.campaignId, log);
    return;
  }

  for (const recipient of batch.recipients) {
    if (await abortBatchIfCampaignStopped(batch.id, batch.campaignId, log)) {
      return;
    }
    const to = phoneToWhatsAppTo(recipient.destination);
    if (!to) {
      failed += 1;
      await prisma.campaignSendRecipient.update({
        where: { id: recipient.id },
        data: {
          status: "failed",
          attemptCount: maxAttempts,
          skipFailReason: "missing_phone",
        },
      });
      continue;
    }

    const merge = recipient.contactId
      ? mergeByContactId.get(recipient.contactId)
      : undefined;
    const identity = recipient.contactId
      ? identityById.get(recipient.contactId)
      : undefined;
    const mergeCtx = {
      firstName: identity?.firstName || merge?.first_name,
      company: identity?.company || merge?.company,
      city: identity?.city || merge?.city,
      campaignUrl: merge?.campaign_url || merge?.product_url || env.appUrl,
      map: merge,
    };
    const components = buildSendTemplateComponents({
      bodyPlaceholders: meta.body_placeholders,
      urlButtonSendSpecs: meta.url_button_send_specs,
      merge: mergeCtx,
    });

    try {
      const languageCandidates = whatsappLanguageCandidates(meta.language);
      let result: Awaited<ReturnType<typeof socialSendApprovedTemplate>> | null =
        null;
      let lastErr: unknown = null;
      for (const languageCode of languageCandidates) {
        try {
          result = await socialSendApprovedTemplate({
            channelConfigId,
            to,
            templateName: meta.template_name,
            languageCode,
            components,
          });
          break;
        } catch (err) {
          lastErr = err;
          const msg = err instanceof Error ? err.message : String(err);
          const looksLikeLanguage =
            /language|locale|template.*not.*exist|does not exist|(#132001)|translation/i.test(
              msg,
            );
          if (
            !looksLikeLanguage ||
            languageCode === languageCandidates[languageCandidates.length - 1]
          ) {
            throw err;
          }
        }
      }
      if (!result) {
        throw lastErr instanceof Error ? lastErr : new Error("send_failed");
      }

      await prisma.campaignSendRecipient.update({
        where: { id: recipient.id },
        data: {
          status: "sent",
          attemptCount: (recipient.attemptCount || 0) + 1,
          providerMessageId: result.providerMessageId || null,
          skipFailReason: null,
        },
      });
      sent += 1;
    } catch (err) {
      const attempts = (recipient.attemptCount || 0) + 1;
      const permanent = attempts >= maxAttempts;
      failed += 1;
      await prisma.campaignSendRecipient.update({
        where: { id: recipient.id },
        data: {
          status: permanent ? "failed" : "pending",
          attemptCount: attempts,
          skipFailReason:
            err instanceof Error ? err.message.slice(0, 500) : "send_failed",
        },
      });
      log.warn(
        { err, batchId, to, attempts },
        "WhatsApp send failed for recipient",
      );
    }
  }

  const stillPending = await prisma.campaignSendRecipient.count({
    where: { batchId: batch.id, status: "pending" },
  });

  await prisma.campaignSendBatch.update({
    where: { id: batch.id },
    data: {
      status: stillPending > 0 ? "queued" : failed && !sent ? "failed" : "sent",
    },
  });

  const nextPlan = { ...plan };
  const nextRun = { ...runMap };
  const prev =
    nextRun.whatsapp && typeof nextRun.whatsapp === "object"
      ? (nextRun.whatsapp as Record<string, unknown>)
      : {};
  nextRun.whatsapp = {
    ...prev,
    sent: (typeof prev.sent === "number" ? prev.sent : 0) + sent,
    failed: (typeof prev.failed === "number" ? prev.failed : 0) + failed,
    max_send_attempts: maxAttempts,
    last_batch_at: new Date().toISOString(),
  };
  nextPlan.channel_run = nextRun;
  nextPlan.max_send_attempts = maxAttempts;
  // Preserve whatsapp template meta
  if (meta) nextPlan.whatsapp = meta;

  await prisma.campaign.update({
    where: { id: batch.campaignId },
    data: { launchPlan: nextPlan as Prisma.InputJsonValue },
  });
  await reconcileCampaignSendLifecycle(batch.campaignId, log);

  log.info(
    { batchId, sent, failed, template: meta.template_name },
    "WhatsApp batch processed",
  );
}

function isApprovedTemplatePollOnly(launchPlan: unknown): boolean {
  if (!launchPlan || typeof launchPlan !== "object") return false;
  return Boolean(
    (launchPlan as Record<string, unknown>).approved_template_poll_30m,
  );
}

export async function processDueWhatsAppBatches(log: Logger) {
  const due = await prisma.campaignSendBatch.findMany({
    where: {
      status: "queued",
      channel: "whatsapp",
      scheduledFor: { lte: new Date() },
    },
    orderBy: { scheduledFor: "asc" },
    take: 40,
    select: {
      id: true,
      campaign: { select: { launchPlan: true } },
    },
  });

  const immediate = due
    .filter((row) => !isApprovedTemplatePollOnly(row.campaign?.launchPlan))
    .slice(0, 5);

  for (const row of immediate) {
    try {
      await processWhatsAppBatch(row.id, log);
    } catch (err) {
      log.error({ err, batchId: row.id }, "WhatsApp batch processing error");
      await prisma.campaignSendBatch
        .update({
          where: { id: row.id },
          data: { status: "failed" },
        })
        .catch(() => undefined);
    }
  }

  return immediate.length;
}

/** Every 30 minutes: start approved-template sends whose scheduled time is due or already passed. */
export async function processDueApprovedTemplatePollBatches(log: Logger) {
  const due = await prisma.campaignSendBatch.findMany({
    where: {
      status: "queued",
      channel: "whatsapp",
      scheduledFor: { lte: new Date() },
    },
    orderBy: { scheduledFor: "asc" },
    take: 40,
    select: {
      id: true,
      campaign: { select: { launchPlan: true } },
    },
  });

  const deferred = due
    .filter((row) => isApprovedTemplatePollOnly(row.campaign?.launchPlan))
    .slice(0, 5);

  for (const row of deferred) {
    try {
      await processWhatsAppBatch(row.id, log);
    } catch (err) {
      log.error(
        { err, batchId: row.id },
        "Approved-template scheduled batch processing error",
      );
      await prisma.campaignSendBatch
        .update({
          where: { id: row.id },
          data: { status: "failed" },
        })
        .catch(() => undefined);
    }
  }

  return deferred.length;
}

export function startWhatsAppSendWorker(log: Logger) {
  const interval = Math.max(5_000, env.social.workerIntervalMs);
  log.info(
    {
      intervalMs: interval,
      maxSendAttempts: MAX_WHATSAPP_SEND_ATTEMPTS,
      channelConfigId: env.social.whatsappChannelConfigId
        ? "static"
        : "accounts_db",
    },
    "WhatsApp send worker started",
  );

  const tick = async () => {
    try {
      await processDueWhatsAppBatches(log);
    } catch (err) {
      log.error({ err }, "WhatsApp worker tick failed");
    }
  };

  void tick();
  return setInterval(() => void tick(), interval);
}

export function startApprovedTemplateScheduleWorker(log: Logger) {
  const interval = Math.max(60_000, env.social.approvedTemplatePollIntervalMs);
  log.info(
    { intervalMs: interval },
    "Approved-template schedule checker started",
  );

  const tick = async () => {
    try {
      const n = await processDueApprovedTemplatePollBatches(log);
      if (n) {
        log.info({ batches: n }, "Approved-template due batches processed");
      }
    } catch (err) {
      log.error({ err }, "Approved-template schedule checker failed");
    }
  };

  void tick();
  return setInterval(() => void tick(), interval);
}

/** Re-export type for status worker. */
export type { WhatsAppLaunchMeta };
