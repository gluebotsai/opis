// @ts-nocheck — worktual_bigint Prisma BigInt ids; runtime coerced to string in plugins/prisma.ts
import type { Prisma } from "@prisma/client";
import { prisma } from "../plugins/prisma.js";
import { greetingFirstName } from "../helpers/contact-validation.js";
import { MAX_PUSH_SEND_ATTEMPTS } from "../helpers/email-send-constants.js";
import { isPushAgentChannel, toAgentChannel } from "../helpers/channel-ids.js";
import { personalizePushContent } from "../helpers/email-render.js";
import { listContactFirstNamesByIdsDao } from "../dao/contact.js";
import { loadWebsiteWebPushAuthKeysDao } from "../dao/website-contacts.js";
import type { CampaignSessionUser } from "../types/auth.js";
import {
  abortBatchIfCampaignStopped,
  reconcileCampaignSendLifecycle,
} from "./campaign-send-lifecycle.js";
import { sendPushViaProvider } from "./push-providers.js";
import { uniquePushDestinations } from "../helpers/unique-push-destinations.js";
import {
  AccountsChannelError,
  evaluateCampaignCompliance,
  loadPushSendSettings,
} from "./accounts-campaign-channels.js";
import { getPushSettingsRawDao } from "../dao/push-config.js";
import { env } from "../config/env.js";
import { isStubProviderMessageId } from "../helpers/send-status.js";
import {
  isStubPushDestination,
  normalizeAppPushPlatform,
} from "../helpers/push-token.js";
import {
  pushCampaignDataPayload,
  resolvePushClickDest,
} from "../helpers/email-track.js";
import {
  buildMergeMapsForContacts,
  isDynamicOfferEnabled,
} from "./personalization/index.js";
import { logCampaignId } from "../helpers/send-log-id.js";

type Logger = {
  info: (obj: unknown, msg?: string) => void;
  warn: (obj: unknown, msg?: string) => void;
  error: (obj: unknown, msg?: string) => void;
};

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function sessionForTenant(
  organizationId: string,
  branchId: string,
): CampaignSessionUser {
  return {
    id: "00000000-0000-4000-8000-000000000098",
    organizationId,
    branchId,
    email: "push-worker@local",
    name: "Push worker",
    role: "system",
    initials: "PW",
    orgName: "system",
  };
}

function readMaxAttempts(launchPlan: unknown): number {
  if (!launchPlan || typeof launchPlan !== "object") {
    return MAX_PUSH_SEND_ATTEMPTS;
  }
  const plan = launchPlan as Record<string, unknown>;
  const n = plan.max_send_attempts;
  if (typeof n === "number" && n >= 1 && n <= 10) return Math.floor(n);
  return MAX_PUSH_SEND_ATTEMPTS;
}

async function loadPushContent(campaignId: string, organizationId: string, channel: string) {
  const channels = await prisma.campaignChannel.findMany({
    where: { campaignId, organizationId },
  });
  const match = channels.find(
    (c) => toAgentChannel(c.channel) === toAgentChannel(channel),
  );
  if (!match?.templateId) {
    return { title: "Notification", body: "", cta_label: "", cta_url: "" };
  }
  const template = await prisma.campaignChannelTemplate.findFirst({
    where: { id: match.templateId, organizationId },
  });
  const fields =
    template?.fields && typeof template.fields === "object"
      ? (template.fields as Record<string, unknown>)
      : {};
  return {
    title: String(fields.title || "").trim() || "Notification",
    body: String(fields.body || "").trim(),
    cta_label: String(fields.cta_label || "").trim(),
    cta_url: String(fields.cta_url || "").trim(),
  };
}

async function loadWebAuthKeys(
  organizationId: string,
  endpoint: string,
): Promise<Record<string, unknown> | null> {
  const row = await prisma.pushEndpoint.findFirst({
    where: { organizationId,
      channel: "web",
      endpoint,
      active: true,
    },
    select: { authKeys: true },
  });
  if (row?.authKeys && typeof row.authKeys === "object") {
    return row.authKeys as Record<string, unknown>;
  }
  return loadWebsiteWebPushAuthKeysDao(organizationId, endpoint);
}

/** Dev-only stub when destination is stub:// or PUSH_FORCE_STUB=true. */
async function sendPushStub(args: {
  channel: string;
  destination: string;
}): Promise<string> {
  if (env.push.failStub) {
    throw new Error("push_stub_forced_failure");
  }
  return `stub-push-${args.channel}-${Date.now()}`;
}

async function deliverOne(args: {
  organizationId: string;
  channel: "push" | "web";
  destination: string;
  platform: string | null;
  title: string;
  body: string;
  cta: string;
  track?: {
    recipient_id: string;
    campaign_id: string;
    channel: "push" | "web";
    click_url?: string;
  };
}): Promise<{ provider: string; messageId: string }> {
  const isStubDest = isStubPushDestination(args.destination);
  if (isStubDest && !env.push.forceStub) {
    throw new Error(
      "Stub push destination rejected — register a real FCM/APNs token (same as Configuration → Run test).",
    );
  }
  if (env.push.forceStub || isStubDest) {
    if (!env.push.allowStubSend && isStubDest) {
      throw new Error(
        "Stub push destination rejected — register a real device token (PUSH_ALLOW_STUB_SEND=false)",
      );
    }
    const messageId = await sendPushStub({
      channel: args.channel,
      destination: args.destination,
    });
    return { provider: "stub", messageId };
  }

  const authKeys =
    args.channel === "web"
      ? await loadWebAuthKeys(args.organizationId, args.destination)
      : null;

  const result = await sendPushViaProvider({
    organizationId: args.organizationId,
    agentChannel: args.channel,
    destination: args.destination,
    platform: normalizeAppPushPlatform(args.platform, args.destination),
    authKeys,
    payload: {
      title: args.title,
      body: args.body,
      cta: args.cta,
      track: args.track,
    },
  });
  return { provider: result.provider, messageId: result.messageId };
}

async function processPushBatch(batchId: string, log: Logger) {
  const peek = await prisma.campaignSendBatch.findUnique({
    where: { id: batchId },
    include: { campaign: true },
  });
  if (!peek || peek.status !== "queued") return;
  if (!isPushAgentChannel(peek.channel)) return;
  const campaignId = logCampaignId(peek.campaignId);

  const peekPlan =
    peek.campaign.launchPlan && typeof peek.campaign.launchPlan === "object"
      ? (peek.campaign.launchPlan as Record<string, unknown>)
      : {};
  const peekRunMap =
    peekPlan.channel_run && typeof peekPlan.channel_run === "object"
      ? (peekPlan.channel_run as Record<string, unknown>)
      : {};
  const peekRunKey = peek.channel === "push" ? "push" : "web";
  const peekChannelRun =
    peekRunMap[peekRunKey] && typeof peekRunMap[peekRunKey] === "object"
      ? (peekRunMap[peekRunKey] as Record<string, unknown>)
      : {};
  if (peekChannelRun.paused === true) {
    log.info(
      {
        event: "push_launch_skipped",
        campaignId,
        batchId,
        channel: peek.channel,
      },
      "[push-launch] skip batch — channel paused",
    );
    return;
  }

  const claimed = await prisma.campaignSendBatch.updateMany({
    where: {
      id: batchId,
      status: "queued",
      channel: { in: ["push", "web"] },
    },
    data: { status: "sending" },
  });
  if (claimed.count === 0) return;

  const batch = await prisma.campaignSendBatch.findUnique({
    where: { id: batchId },
    include: {
      recipients: { where: { status: "pending" } },
      campaign: true,
    },
  });
  if (!batch || !isPushAgentChannel(batch.channel)) return;
  if (await abortBatchIfCampaignStopped(batch.id, batch.campaignId, log)) {
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
  const runKey = batch.channel === "push" ? "push" : "web";

  const complianceChannel =
    batch.channel === "push" ? "app_push" : "web_push";
  try {
    let country = "GB";
    try {
      const org = await prisma.emailOrgProfile.findUnique({
        where: { organizationId: batch.organizationId },
        select: { country: true },
      });
      const c = String(org?.country || "").trim();
      if (/^[A-Za-z]{2}$/.test(c)) country = c.toUpperCase();
    } catch {
      /* keep GB */
    }
    await evaluateCampaignCompliance({
      organizationId: String(batch.organizationId),
      channel: complianceChannel,
      country,
    });
  } catch (err) {
    if (err instanceof AccountsChannelError && err.code === "compliance_denied") {
      log.warn(
        {
          event: "push_launch_compliance_denied",
          campaignId,
          batchId,
          channel: batch.channel,
          err: err.message,
        },
        "[push-launch] batch blocked — compliance_denied",
      );
      await prisma.campaignSendRecipient.updateMany({
        where: { batchId: batch.id, status: "pending" },
        data: {
          status: "failed",
          skipFailReason: "compliance_denied",
        },
      });
      await prisma.campaignSendBatch.update({
        where: { id: batch.id },
        data: { status: "failed" },
      });
      await reconcileCampaignSendLifecycle(batch.campaignId, log);
      return;
    }
    log.warn(
      { err, campaignId, batchId, channel: batch.channel },
      "[push-launch] compliance evaluate skipped for batch",
    );
  }

  await reconcileCampaignSendLifecycle(batch.campaignId, log);

  const keepers = uniquePushDestinations(
    batch.recipients.map((r) => ({
      id: r.id,
      contactId: r.contactId,
      destination: String(r.destination || ""),
      platform: r.platform,
    })),
  );
  const keepIds = new Set(keepers.map((k) => k.id));
  const dupes = batch.recipients.filter((r) => !keepIds.has(r.id));
  if (dupes.length) {
    await prisma.campaignSendRecipient.updateMany({
      where: { id: { in: dupes.map((r) => r.id) } },
      data: {
        status: "failed",
        skipFailReason: "duplicate_push_destination",
      },
    });
    log.info(
      {
        event: "push_launch_deduped",
        campaignId,
        batchId,
        skipped: dupes.length,
      },
      "[push-launch] skipped duplicate tokens / extra devices for same contact",
    );
  }
  const recipients = batch.recipients.filter((r) => keepIds.has(r.id));

  log.info(
    {
      event: "push_launch_batch_start",
      campaignId,
      batchId,
      channel: batch.channel,
      recipientCount: recipients.length,
      maxAttempts,
    },
    "[push-launch] batch start",
  );

  const content = await loadPushContent(
    batch.campaignId,
    batch.organizationId,
    batch.channel,
  );

  let defaultClickUrl = "";
  try {
    const loaded = await loadPushSendSettings({
      organizationId: String(batch.organizationId),
      channel: complianceChannel,
      loadLocal: () =>
        getPushSettingsRawDao(String(batch.organizationId), complianceChannel),
    });
    defaultClickUrl = String(loaded.settings.default_click_url || "").trim();
  } catch (err) {
    log.warn(
      { err, campaignId, batchId, channel: batch.channel },
      "[push-launch] could not load Accounts default click URL",
    );
  }

  const workerSession = sessionForTenant(
    batch.organizationId,
    batch.campaign.branchId,
  );
  const contactIds = recipients
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
      log.warn(
        { err, campaignId, batchId, channel: batch.channel },
        "[push-launch] could not load contact merge fields",
      );
    }
  }

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
    log.warn(
      { err, campaignId, batchId, channel: batch.channel },
      "[push-launch] personalization adapter failed",
    );
    for (const [id, idn] of identityById) {
      mergeByContactId.set(id, {
        first_name: greetingFirstName(idn.firstName),
        company: idn.company || "",
        city: idn.city || "",
        campaign_url: env.appUrl,
      });
    }
  }

  let sent = 0;
  let failed = 0;

  for (let i = 0; i < recipients.length; i += 1) {
    if (await abortBatchIfCampaignStopped(batch.id, batch.campaignId, log)) {
      return;
    }
    const recipient = recipients[i]!;
    const destination = recipient.destination || "";
    if (!destination) {
      failed += 1;
      await prisma.campaignSendRecipient.update({
        where: { id: recipient.id },
        data: {
          status: "failed",
          attemptCount: maxAttempts,
          skipFailReason: "missing_destination",
        },
      });
      continue;
    }

    const merge = recipient.contactId
      ? mergeByContactId.get(recipient.contactId)
      : undefined;
    const personalized = personalizePushContent(
      {
        title: content.title,
        body: content.body,
        cta_label: content.cta_label,
        cta_url: content.cta_url,
      },
      merge || {
        first_name: "there",
        campaign_url: env.appUrl,
      },
    );
    const destUrl = resolvePushClickDest({
      ctaUrl: personalized.cta_url,
      campaignUrl: merge?.campaign_url,
      defaultClickUrl,
      appUrl: env.appUrl,
    });
    const track = pushCampaignDataPayload({
      apiBase: env.apiPublicUrl,
      recipientId: String(recipient.id),
      campaignId: String(batch.campaignId),
      channel: batch.channel as "push" | "web",
      destUrl,
    });

    let attempt = recipient.attemptCount;
    let delivered = false;
    let messageId = "";
    let lastError: unknown = null;

    while (attempt < maxAttempts && !delivered) {
      attempt += 1;
      try {
        const result = await deliverOne({
          organizationId: batch.organizationId,
          channel: batch.channel as "push" | "web",
          destination,
          platform: recipient.platform,
          title: personalized.title,
          body: personalized.body,
          cta: personalized.cta_label,
          track,
        });
        messageId = result.messageId;
        delivered = true;
      } catch (err) {
        lastError = err;
        await prisma.campaignSendRecipient.update({
          where: { id: recipient.id },
          data: {
            attemptCount: attempt,
            skipFailReason:
              err instanceof Error ? err.message.slice(0, 500) : "send_failed",
            status: attempt >= maxAttempts ? "failed" : "pending",
          },
        });
        log.warn(
          {
            event:
              attempt >= maxAttempts
                ? "push_launch_recipient_failed"
                : "push_launch_recipient_retry",
            err,
            campaignId,
            destination: destination.slice(0, 48),
            batchId,
            recipientId: recipient.id,
            attempt,
            maxAttempts,
            channel: batch.channel,
          },
          attempt >= maxAttempts
            ? "[push-launch] recipient permanently failed after max attempts"
            : "[push-launch] recipient failed — will retry",
        );
        if (attempt < maxAttempts) {
          await sleep(Math.min(1500 * attempt, 4000));
        }
      }
    }

    if (delivered) {
      const stub = isStubProviderMessageId(messageId);
      await prisma.campaignSendRecipient.update({
        where: { id: recipient.id },
        data: {
          status: stub ? "stub_sent" : "sent",
          attemptCount: attempt,
          providerMessageId: messageId,
          skipFailReason: stub ? "stub_not_delivered" : null,
        },
      });
      if (!stub) sent += 1;
    } else {
      failed += 1;
      log.error(
        {
          event: "push_launch_recipient_failed",
          campaignId,
          batchId,
          recipientId: recipient.id,
          channel: batch.channel,
          destination: destination.slice(0, 48),
          detail:
            lastError instanceof Error
              ? lastError.message.slice(0, 300)
              : "send_failed",
        },
        "[push-launch] FAILED — recipient not delivered",
      );
      if (attempt < maxAttempts) {
        await prisma.campaignSendRecipient.update({
          where: { id: recipient.id },
          data: {
            status: "failed",
            attemptCount: Math.max(attempt, maxAttempts),
            skipFailReason:
              lastError instanceof Error
                ? lastError.message.slice(0, 500)
                : "send_failed",
          },
        });
      }
    }
  }

  await prisma.campaignSendBatch.update({
    where: { id: batch.id },
    data: { status: failed && !sent ? "failed" : "sent" },
  });

  const nextPlan = { ...plan };
  const nextRun = { ...runMap };
  const prev =
    nextRun[runKey] && typeof nextRun[runKey] === "object"
      ? (nextRun[runKey] as Record<string, unknown>)
      : {};
  nextRun[runKey] = {
    ...prev,
    sent: (typeof prev.sent === "number" ? prev.sent : 0) + sent,
    failed: (typeof prev.failed === "number" ? prev.failed : 0) + failed,
    max_send_attempts: maxAttempts,
    last_batch_at: new Date().toISOString(),
  };
  nextPlan.channel_run = nextRun;
  nextPlan.max_send_attempts = maxAttempts;
  await prisma.campaign.update({
    where: { id: batch.campaignId },
    data: { launchPlan: nextPlan as Prisma.InputJsonValue },
  });
  await reconcileCampaignSendLifecycle(batch.campaignId, log);

  log.info(
    {
      event: "push_launch_batch_done",
      campaignId,
      batchId,
      channel: batch.channel,
      sent,
      failed,
      maxAttempts,
    },
    "[push-launch] batch done",
  );
}

export async function processDuePushBatches(log: Logger) {
  const due = await prisma.campaignSendBatch.findMany({
    where: {
      status: "queued",
      channel: { in: ["push", "web"] },
      scheduledFor: { lte: new Date() },
    },
    orderBy: { scheduledFor: "asc" },
    take: 5,
    select: { id: true },
  });

  for (const row of due) {
    try {
      await processPushBatch(row.id, log);
    } catch (err) {
      const failedBatch = await prisma.campaignSendBatch.findUnique({
        where: { id: row.id },
        select: { campaignId: true, channel: true },
      });
      log.error(
        {
          err,
          event: "push_launch_batch_error",
          batchId: row.id,
          campaignId: logCampaignId(failedBatch?.campaignId),
          channel: failedBatch?.channel ?? "push",
        },
        "[push-launch] batch processing error",
      );
      await prisma.campaignSendBatch
        .update({
          where: { id: row.id },
          data: { status: "failed" },
        })
        .catch(() => undefined);
    }
  }

  return due.length;
}

export function startPushSendWorker(log: Logger) {
  const interval = Math.max(5_000, env.push.workerIntervalMs);
  log.info(
    {
      intervalMs: interval,
      maxSendAttempts: MAX_PUSH_SEND_ATTEMPTS,
      stubAudience: env.push.stubAudience,
      allowStubSend: env.push.allowStubSend,
      forceStub: env.push.forceStub,
      providers: ["fcm", "apns", "web_push"],
    },
    "Push send worker started",
  );

  let tickRunning = false;
  const tick = async () => {
    if (tickRunning) return;
    tickRunning = true;
    try {
      await processDuePushBatches(log);
    } catch (err) {
      log.error({ err }, "Push worker tick failed");
    } finally {
      tickRunning = false;
    }
  };

  void tick();
  return setInterval(() => void tick(), interval);
}
