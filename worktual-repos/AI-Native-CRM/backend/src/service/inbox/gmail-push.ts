/**
 * Gmail users.watch → Google Pub/Sub → CRM incremental inbox sync.
 *
 * Ops: create a Pub/Sub topic, grant publish to
 * `gmail-api-push@system.gserviceaccount.com`, push-subscribe to
 * POST /api/webhooks/gmail/push, set GMAIL_PUBSUB_TOPIC.
 */

import { prisma } from "@/dao/db/prisma";
import { getCalendarConnection } from "@/dao/calendar/token-repository";
import { resolveCrmBotMailbox } from "@/dao/account/crm-bot-mailbox";
import { getSetupUserById } from "@/service/account/setup-users";
import {
  findGmailPushWatchByEmail,
  listGmailPushWatchesExpiringSoon,
  updateGmailPushWatchHistoryId,
  upsertGmailPushWatch,
  type GmailPushWatchRow,
} from "@/dao/inbox/gmail-push-store";
import { syncGmailMessageIdsForUser } from "@/dao/inbox/sync-gmail-inbox";
import { syncGmailMessageIdsForCrmBot } from "@/dao/inbox/sync-crm-bot-inbox";
import { listMailReadableUserIds } from "@/dao/inbox/sync-mailboxes";
import {
  googleHasGmailReadScope,
  getValidGoogleAccessToken,
} from "@/service/google/access-token";
import {
  listGmailHistoryAddedMessages,
  registerGmailWatch,
} from "@/service/google/gmail";
import { getValidOauthAccessToken } from "@/service/email/send-crm-bot-email";
import {
  enqueueMissingAutoReplyJobsForBotInbox,
  enqueueMissingAutoReplyJobsForMailbox,
  processDueEmailAutoReplyJobs,
} from "@/service/ai/email-auto-reply-job";
import { accountQuery } from "@/dao/db/account-pool";

type PubSubPushBody = {
  message?: {
    data?: string;
    messageId?: string;
    attributes?: Record<string, string>;
  };
  subscription?: string;
};

type GmailPushPayload = {
  emailAddress?: string;
  historyId?: string | number;
};

const mailboxSyncChains = new Map<string, Promise<unknown>>();

export function isGmailPushConfigured(): boolean {
  return Boolean(process.env.GMAIL_PUBSUB_TOPIC?.trim());
}

function gmailPubSubTopic(): string | null {
  const topic = process.env.GMAIL_PUBSUB_TOPIC?.trim();
  return topic || null;
}

function decodePubSubData(data: string): GmailPushPayload | null {
  try {
    const json = Buffer.from(data, "base64").toString("utf8");
    return JSON.parse(json) as GmailPushPayload;
  } catch {
    return null;
  }
}

function serializeMailboxSync<T>(
  accountEmail: string,
  fn: () => Promise<T>,
): Promise<T> {
  const key = accountEmail.trim().toLowerCase();
  const prev = mailboxSyncChains.get(key) ?? Promise.resolve();
  const next = prev.catch(() => undefined).then(fn);
  mailboxSyncChains.set(key, next);
  void next.finally(() => {
    if (mailboxSyncChains.get(key) === next) {
      mailboxSyncChains.delete(key);
    }
  });
  return next;
}

async function getAccessTokenForWatch(
  watch: GmailPushWatchRow,
): Promise<string | null> {
  if (watch.watchKind === "crm_bot") {
    const orgId = watch.organizationId?.trim();
    if (!orgId) return null;
    const mailbox = await resolveCrmBotMailbox(orgId).catch(() => null);
    if (!mailbox || mailbox.oauthProvider !== "google") return null;
    const token = await getValidOauthAccessToken(mailbox);
    return token.ok ? token.accessToken : null;
  }
  const userId = watch.userId?.trim();
  if (!userId) return null;
  try {
    return await getValidGoogleAccessToken(userId);
  } catch {
    return null;
  }
}

async function importFromHistory(
  watch: GmailPushWatchRow,
  notificationHistoryId: string,
): Promise<{ imported: number; detail: string }> {
  const accessToken = await getAccessTokenForWatch(watch);
  if (!accessToken) {
    return { imported: 0, detail: "No valid OAuth token for watch" };
  }

  const storedHistoryId = watch.historyId?.trim();
  if (!storedHistoryId) {
    await updateGmailPushWatchHistoryId(watch.id, notificationHistoryId);
    return { imported: 0, detail: "Initialized history cursor" };
  }

  if (BigInt(notificationHistoryId) <= BigInt(storedHistoryId)) {
    return { imported: 0, detail: "Already up to date" };
  }

  let messageIds: string[] = [];
  let newestHistoryId = notificationHistoryId;

  try {
    const history = await listGmailHistoryAddedMessages({
      accessToken,
      startHistoryId: storedHistoryId,
    });
    messageIds = history.messageIds;
    if (history.historyId) newestHistoryId = history.historyId;
  } catch (err) {
    const code = (err as Error & { code?: string }).code;
    if (code === "GMAIL_HISTORY_EXPIRED") {
      await updateGmailPushWatchHistoryId(watch.id, notificationHistoryId);
      return {
        imported: 0,
        detail: "History expired — cursor reset; next poll/push will catch up",
      };
    }
    throw err;
  }

  let imported = 0;
  if (messageIds.length > 0) {
    if (watch.watchKind === "crm_bot" && watch.organizationId) {
      const res = await syncGmailMessageIdsForCrmBot(
        watch.organizationId,
        messageIds,
      );
      imported = res.imported;
      try {
        await enqueueMissingAutoReplyJobsForBotInbox(watch.organizationId, 15);
      } catch (enqueueErr) {
        console.error("[gmail-push] bot auto-reply enqueue failed", enqueueErr);
      }
    } else if (watch.userId) {
      const res = await syncGmailMessageIdsForUser(watch.userId, messageIds);
      imported = res.imported;
      try {
        await enqueueMissingAutoReplyJobsForMailbox(watch.userId, 15);
      } catch (enqueueErr) {
        console.error("[gmail-push] user auto-reply enqueue failed", enqueueErr);
      }
    }
  }

  await updateGmailPushWatchHistoryId(watch.id, newestHistoryId);

  void processDueEmailAutoReplyJobs(5).catch((err) => {
    console.error("[gmail-push] auto-reply drain failed", err);
  });

  return {
    imported,
    detail: `history ${storedHistoryId}→${newestHistoryId}, messages=${messageIds.length}`,
  };
}

export async function handleGmailPubSubPush(
  body: unknown,
): Promise<{ ok: boolean; detail: string; imported?: number }> {
  if (!isGmailPushConfigured()) {
    return { ok: false, detail: "GMAIL_PUBSUB_TOPIC not configured" };
  }

  const push = (body || {}) as PubSubPushBody;
  const dataB64 = push.message?.data;
  if (!dataB64) {
    return { ok: false, detail: "Missing Pub/Sub message.data" };
  }

  const payload = decodePubSubData(dataB64);
  const emailAddress = payload?.emailAddress?.trim().toLowerCase();
  const historyId = payload?.historyId != null ? String(payload.historyId) : "";
  if (!emailAddress || !historyId) {
    return {
      ok: false,
      detail: `Invalid Gmail push payload: ${JSON.stringify(payload).slice(0, 200)}`,
    };
  }

  const watch = await findGmailPushWatchByEmail(emailAddress);
  if (!watch) {
    return { ok: false, detail: `No watch registered for ${emailAddress}` };
  }

  const result = await serializeMailboxSync(emailAddress, () =>
    importFromHistory(watch, historyId),
  );

  return {
    ok: true,
    imported: result.imported,
    detail: result.detail,
  };
}

export async function registerGmailPushWatchForUser(
  userId: string,
): Promise<{ ok: boolean; detail: string }> {
  const topic = gmailPubSubTopic();
  if (!topic) {
    return { ok: false, detail: "GMAIL_PUBSUB_TOPIC not set" };
  }

  const conn = await getCalendarConnection(userId, "google");
  if (!conn?.accountEmail || !googleHasGmailReadScope(conn.scope)) {
    return { ok: false, detail: "User has no Gmail-readable Google connection" };
  }

  const accessToken = await getValidGoogleAccessToken(userId);
  if (!accessToken) {
    return { ok: false, detail: "Could not refresh Google access token" };
  }

  const watch = await registerGmailWatch({ accessToken, topicName: topic });
  const setupUser = await getSetupUserById(userId);
  await upsertGmailPushWatch({
    organizationId: setupUser?.organization_id ?? undefined,
    userId,
    accountEmail: conn.accountEmail,
    watchKind: "user",
    historyId: watch.historyId,
    expiration: watch.expiration,
  });

  return {
    ok: true,
    detail: `watch ${conn.accountEmail} until ${watch.expiration.toISOString()}`,
  };
}

async function listCrmBotOrganizationIds(limit = 25): Promise<string[]> {
  return accountQuery<{ organization_id: string }>(
    `SELECT c.organization_id::text AS organization_id,
            MAX(c.updated_at) AS last_updated
     FROM accounts.setup_channel_configs c
     INNER JOIN accounts.setup_email_configs e
       ON e.channel_config_id = c.id
     WHERE c.channel_type = 'email'
       AND lower(c.status) = 'active'
       AND c.product_ids @> '["crm"]'::jsonb
       AND lower(COALESCE(e.oauth_provider, '')) = 'google'
     GROUP BY c.organization_id
     ORDER BY last_updated DESC
     LIMIT $1`,
    [limit],
  )
    .then((r) => r.rows.map((x) => x.organization_id).filter(Boolean))
    .catch(() => []);
}

export async function registerGmailPushWatchForCrmBot(
  organizationId: string,
): Promise<{ ok: boolean; detail: string }> {
  const topic = gmailPubSubTopic();
  if (!topic) {
    return { ok: false, detail: "GMAIL_PUBSUB_TOPIC not set" };
  }

  const orgId = organizationId?.trim();
  if (!orgId) return { ok: false, detail: "organizationId required" };

  const mailbox = await resolveCrmBotMailbox(orgId).catch(() => null);
  if (!mailbox || mailbox.oauthProvider !== "google") {
    return { ok: false, detail: "No Google CRM bot mailbox" };
  }

  const email = (mailbox.accountEmail || mailbox.senderEmail)?.trim();
  if (!email) {
    return { ok: false, detail: "CRM bot mailbox has no account email" };
  }

  const token = await getValidOauthAccessToken(mailbox);
  if (!token.ok) {
    return { ok: false, detail: token.error || "CRM bot token unavailable" };
  }

  const watch = await registerGmailWatch({
    accessToken: token.accessToken,
    topicName: topic,
  });
  await upsertGmailPushWatch({
    organizationId: orgId,
    accountEmail: email,
    watchKind: "crm_bot",
    historyId: watch.historyId,
    expiration: watch.expiration,
  });

  return {
    ok: true,
    detail: `watch ${email} until ${watch.expiration.toISOString()}`,
  };
}

/** Register watches for all Gmail-readable user connections + CRM bot mailboxes. */
export async function bootstrapGmailPushWatches(): Promise<{
  registered: number;
  skipped: number;
  errors: string[];
}> {
  if (!isGmailPushConfigured()) {
    return { registered: 0, skipped: 0, errors: ["GMAIL_PUBSUB_TOPIC not set"] };
  }

  let registered = 0;
  let skipped = 0;
  const errors: string[] = [];

  const userIds = await listMailReadableUserIds(100);
  for (const userId of userIds) {
    const conn = await getCalendarConnection(userId, "google");
    if (!conn || !googleHasGmailReadScope(conn.scope)) {
      skipped += 1;
      continue;
    }
    try {
      const res = await registerGmailPushWatchForUser(userId);
      if (res.ok) registered += 1;
      else {
        skipped += 1;
        errors.push(`user ${userId}: ${res.detail}`);
      }
    } catch (err) {
      skipped += 1;
      errors.push(
        `user ${userId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  const orgIds = await listCrmBotOrganizationIds(50);
  for (const orgId of orgIds) {
    try {
      const res = await registerGmailPushWatchForCrmBot(orgId);
      if (res.ok) registered += 1;
      else {
        skipped += 1;
        errors.push(`org ${orgId}: ${res.detail}`);
      }
    } catch (err) {
      skipped += 1;
      errors.push(
        `org ${orgId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  return { registered, skipped, errors };
}

/** Renew watches expiring within 48h (Gmail max ~7 days). */
export async function renewExpiringGmailPushWatches(): Promise<{
  renewed: number;
  errors: string[];
}> {
  if (!isGmailPushConfigured()) {
    return { renewed: 0, errors: [] };
  }

  const expiring = await listGmailPushWatchesExpiringSoon();
  let renewed = 0;
  const errors: string[] = [];

  for (const row of expiring) {
    try {
      const res =
        row.watchKind === "crm_bot" && row.organizationId
          ? await registerGmailPushWatchForCrmBot(row.organizationId)
          : row.userId
            ? await registerGmailPushWatchForUser(row.userId)
            : { ok: false, detail: "Watch missing user/org id" };
      if (res.ok) renewed += 1;
      else errors.push(`${row.accountEmail}: ${res.detail}`);
    } catch (err) {
      errors.push(
        `${row.accountEmail}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  return { renewed, errors };
}

/** Stop push when a user disconnects Google. */
export async function stopGmailPushWatchForUser(userId: string): Promise<void> {
  const conn = await prisma.userIntegrationConnection.findFirst({
    where: { userId: BigInt(userId), provider: "google" },
    select: { accountEmail: true },
  });
  if (!conn?.accountEmail) return;

  const watch = await findGmailPushWatchByEmail(conn.accountEmail);
  if (!watch) return;

  const accessToken = await getValidGoogleAccessToken(userId);
  if (accessToken) {
    const { stopGmailWatch } = await import("@/service/google/gmail");
    await stopGmailWatch(accessToken).catch(() => undefined);
  }

  await prisma.gmailPushWatch.delete({ where: { id: watch.id } }).catch(() => undefined);
}
