/**
 * Provider-agnostic mailbox sync. Used by the Inbox UI poll, the fast
 * `inbox-sync-live` cron (CRM bot / nurture path), and the full `inbox-sync`
 * cron for rep-connected mailboxes.
 *
 * After sync: enqueue missing auto-reply jobs, then drain a few so replies /
 * escalations are written to the DB in the same request when possible.
 */

import { prisma } from "@/dao/db/prisma";
import { syncInboundGmailForUser } from "@/dao/inbox/sync-gmail-inbox";
import { syncInboundMicrosoftForUser } from "@/dao/inbox/sync-microsoft-inbox";
import { accountQuery } from "@/dao/db/account-pool";
import { syncCrmBotInboxForOrganization } from "@/dao/inbox/sync-crm-bot-inbox";
import { googleHasGmailReadScope } from "@/service/google/access-token";
import {
  isMicrosoftGuestMailbox,
  microsoftHasMailReadScope,
} from "@/service/microsoft/oauth";
import {
  enqueueMissingAutoReplyJobsForBotInbox,
  enqueueMissingAutoReplyJobsForMailbox,
  processDueEmailAutoReplyJobs,
} from "@/service/ai/email-auto-reply-job";

/** Fast path: CRM bot nurture inbox + auto-reply drain (default 15s cron). */
export const INBOX_SYNC_LIVE_INTERVAL_MS = (() => {
  const raw = Number(process.env.INBOX_SYNC_LIVE_INTERVAL_MS);
  return Number.isFinite(raw) && raw >= 10_000 ? Math.trunc(raw) : 15_000;
})();

/** Full rep-mailbox sweep interval (default 60s cron). */
export const INBOX_SYNC_FULL_INTERVAL_MS = (() => {
  const raw = Number(process.env.INBOX_SYNC_FULL_INTERVAL_MS);
  return Number.isFinite(raw) && raw >= 30_000 ? Math.trunc(raw) : 60_000;
})();

export type MailboxSyncResult = {
  imported: number;
  /** True when at least one provider had a usable read connection. */
  anyConnected: boolean;
  errors: string[];
  /** Auto-reply jobs created or processed in this pass. */
  autoReplyEnqueued: number;
  autoReplyProcessed: number;
};

export async function syncConnectedMailboxesForUser(
  userId: string,
  options?: {
    /**
     * When true (default for cron), drain due auto-reply jobs in this request.
     * Inbox UI polls should pass false — LLM auto-reply can take tens of seconds
     * and would block the sync response (and the UI reload that follows it).
     */
    processAutoReply?: boolean;
  },
): Promise<MailboxSyncResult> {
  let imported = 0;
  let anyConnected = false;
  const errors: string[] = [];
  const processAutoReply = options?.processAutoReply !== false;

  const google = await syncInboundGmailForUser(userId);
  if (google.ok) {
    imported += google.imported;
    if (!google.needsReconnect) anyConnected = true;
    else if (google.error) errors.push(google.error);
  } else {
    errors.push(google.error);
  }

  const microsoft = await syncInboundMicrosoftForUser(userId);
  if (microsoft.ok) {
    imported += microsoft.imported;
    if (!microsoft.needsReconnect) anyConnected = true;
    else if (microsoft.error) errors.push(microsoft.error);
  } else {
    errors.push(microsoft.error);
  }

  let autoReplyEnqueued = 0;
  let autoReplyProcessed = 0;
  if (anyConnected) {
    try {
      // Cover mail imported before the agent, or when upsert was dropped.
      autoReplyEnqueued = await enqueueMissingAutoReplyJobsForMailbox(
        userId,
        15,
      );
      if (processAutoReply) {
        const drained = await processDueEmailAutoReplyJobs(5);
        autoReplyProcessed = drained.processed;
      } else if (autoReplyEnqueued > 0) {
        // Non-blocking: cron / later poll will drain; don't stall inbox UI.
        void processDueEmailAutoReplyJobs(3).catch((err) => {
          console.error("background auto-reply drain failed", userId, err);
        });
      }
    } catch (err) {
      console.error("auto-reply after mailbox sync failed", userId, err);
    }
  }

  return {
    imported,
    anyConnected,
    errors,
    autoReplyEnqueued,
    autoReplyProcessed,
  };
}

/** Users with a mail-readable Google or Microsoft connection. */
export async function listMailReadableUserIds(limit = 50): Promise<string[]> {
  const rows = await prisma.userIntegrationConnection.findMany({
    where: { provider: { in: ["google", "microsoft"] } },
    select: {
      userId: true,
      provider: true,
      scope: true,
      accountEmail: true,
      updatedAt: true,
    },
    orderBy: { updatedAt: "desc" },
    take: limit * 4,
  });

  const userIds = new Set<string>();
  for (const row of rows) {
    const canRead =
      row.provider === "google"
        ? googleHasGmailReadScope(row.scope)
        : microsoftHasMailReadScope(row.scope) &&
          !isMicrosoftGuestMailbox(row.accountEmail);
    if (canRead) userIds.add(row.userId);
    if (userIds.size >= limit) break;
  }
  return [...userIds];
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
     GROUP BY c.organization_id
     ORDER BY last_updated DESC
     LIMIT $1`,
    [limit],
  )
    .then((r) => r.rows.map((x) => x.organization_id).filter(Boolean))
    .catch(() => []);
}

async function syncCrmBotInboxesForOrganizations(
  organizationIds: string[],
): Promise<{ imported: number; autoReplyEnqueued: number }> {
  let imported = 0;
  let autoReplyEnqueued = 0;
  for (const orgId of organizationIds) {
    try {
      const res = await syncCrmBotInboxForOrganization(orgId);
      imported += res.imported;
      try {
        autoReplyEnqueued += await enqueueMissingAutoReplyJobsForBotInbox(
          orgId,
          15,
        );
      } catch (err) {
        console.error("bot auto-reply enqueue failed", orgId, err);
      }
    } catch (err) {
      console.error("crm-bot inbox sync failed", orgId, err);
    }
  }
  return { imported, autoReplyEnqueued };
}

/**
 * Lightweight live sweep: CRM bot inbox(es) where nurture replies land,
 * then drain due auto-reply jobs. Runs every ~15s so customer mail is seen
 * without waiting for the full rep-mailbox sweep or someone opening Inbox.
 */
export async function syncLiveInboundMail(): Promise<{
  botOrganizations: number;
  imported: number;
  autoReplyEnqueued: number;
  autoReplyProcessed: number;
}> {
  const botOrganizationIds = await listCrmBotOrganizationIds();
  const { imported, autoReplyEnqueued } =
    await syncCrmBotInboxesForOrganizations(botOrganizationIds);

  let autoReplyProcessed = 0;
  try {
    const drained = await processDueEmailAutoReplyJobs(10);
    autoReplyProcessed = drained.processed;
  } catch (err) {
    console.error("processDueEmailAutoReplyJobs failed (live)", err);
  }

  return {
    botOrganizations: botOrganizationIds.length,
    imported,
    autoReplyEnqueued,
    autoReplyProcessed,
  };
}

/** Cron entry: sync every connected mailbox, then drain auto-reply jobs. */
export async function syncAllConnectedMailboxes(
  limit = 25,
  options?: { includeBotInboxes?: boolean },
): Promise<{
  users: number;
  imported: number;
  autoReplyEnqueued: number;
  autoReplyProcessed: number;
}> {
  const includeBot = options?.includeBotInboxes !== false;
  const botOrganizationIds = includeBot
    ? await listCrmBotOrganizationIds()
    : [];

  let imported = 0;
  let autoReplyEnqueued = 0;
  let autoReplyProcessed = 0;

  if (includeBot && botOrganizationIds.length > 0) {
    const bot = await syncCrmBotInboxesForOrganizations(botOrganizationIds);
    imported += bot.imported;
    autoReplyEnqueued += bot.autoReplyEnqueued;
  }

  const userIds = await listMailReadableUserIds(limit);
  for (const userId of userIds) {
    try {
      const result = await syncConnectedMailboxesForUser(userId);
      imported += result.imported;
      autoReplyEnqueued += result.autoReplyEnqueued;
      autoReplyProcessed += result.autoReplyProcessed;
    } catch (err) {
      console.error("mailbox sync failed", userId, err);
    }
  }

  // Always drain due auto-reply jobs (including CRM-bot-only jobs) even when
  // no mailbox connections were readable in this pass.
  try {
    const drained = await processDueEmailAutoReplyJobs(5);
    autoReplyProcessed += drained.processed;
  } catch (err) {
    console.error("processDueEmailAutoReplyJobs failed", err);
  }
  return {
    users: userIds.length,
    imported,
    autoReplyEnqueued,
    autoReplyProcessed,
  };
}
