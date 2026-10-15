/**
 * Email auto-reply job persistence via raw SQL so a Turbopack-stale Prisma
 * client cannot break the agent right after a schema add.
 */

import { randomBytes } from "node:crypto";
import { getPrismaClient } from "@/dao/db/prisma";
import type { EmailAutoReplyStatus, Prisma } from "@prisma/client";

export type AutoReplyJobRow = {
  id: string;
  organizationId: string;
  contactId: string;
  inboundActivityId: string;
  mailboxUserId: string | null;
  status: EmailAutoReplyStatus;
  decision: string | null;
  sensitivity: string | null;
  category: string | null;
  reason: string | null;
  replyActivityId: string | null;
  escalatedToUserId: string | null;
  attempts: number;
  maxAttempts: number;
  nextRetryAt: Date | null;
  lastError: string | null;
  resultSummary: Prisma.JsonValue | null;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
};

function jobId(): string {
  return `earj_${randomBytes(12).toString("hex")}`;
}

function mapRow(r: Record<string, unknown>): AutoReplyJobRow {
  return {
    id: String(r.id),
    organizationId: String(r.organization_id),
    contactId: String(r.contact_id),
    inboundActivityId: String(r.inbound_activity_id),
    mailboxUserId: r.mailbox_user_id == null ? null : String(r.mailbox_user_id),
    status: r.status as EmailAutoReplyStatus,
    decision: r.decision == null ? null : String(r.decision),
    sensitivity: r.sensitivity == null ? null : String(r.sensitivity),
    category: r.category == null ? null : String(r.category),
    reason: r.reason == null ? null : String(r.reason),
    replyActivityId:
      r.reply_activity_id == null ? null : String(r.reply_activity_id),
    escalatedToUserId:
      r.escalated_to_user_id == null ? null : String(r.escalated_to_user_id),
    attempts: Number(r.attempts ?? 0),
    maxAttempts: Number(r.max_attempts ?? 3),
    nextRetryAt: r.next_retry_at ? new Date(String(r.next_retry_at)) : null,
    lastError: r.last_error == null ? null : String(r.last_error),
    resultSummary: (r.result_summary as Prisma.JsonValue) ?? null,
    createdAt: new Date(String(r.created_at)),
    updatedAt: new Date(String(r.updated_at)),
    completedAt: r.completed_at ? new Date(String(r.completed_at)) : null,
  };
}

/**
 * One job per inbound message. A repeat enqueue for the same message is a
 * no-op unless the prior attempt failed and is retryable.
 */
export async function upsertAutoReplyJob(input: {
  organizationId: string;
  contactId: string;
  inboundActivityId: string;
  mailboxUserId?: string | null;
  maxAttempts?: number;
  /**
   * Grace period (ms) to wait before this job becomes due. Gives a human a
   * chance to open and answer the mail before the agent auto-replies. The job
   * is created immediately but `next_retry_at` is pushed into the future.
   */
  graceMs?: number;
}): Promise<AutoReplyJobRow> {
  const prisma = getPrismaClient();
  const graceMs = Math.max(0, Math.trunc(input.graceMs ?? 0));
  const rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
    `
    INSERT INTO email_auto_reply_jobs (
      id, organization_id, contact_id, inbound_activity_id, mailbox_user_id,
      status, attempts, max_attempts, next_retry_at, created_at, updated_at
    ) VALUES (
      $1, $2::bigint, $3::text, $4, $5::bigint,
      'pending', 0, $6, NOW() + ($7 || ' milliseconds')::interval, NOW(), NOW()
    )
    ON CONFLICT (inbound_activity_id) DO UPDATE SET
      mailbox_user_id = COALESCE(email_auto_reply_jobs.mailbox_user_id, EXCLUDED.mailbox_user_id),
      updated_at = NOW()
    RETURNING *
    `,
    jobId(),
    input.organizationId,
    input.contactId,
    input.inboundActivityId,
    input.mailboxUserId ?? null,
    input.maxAttempts ?? 3,
    String(graceMs),
  );
  return mapRow(rows[0]!);
}

export async function findAutoReplyJobById(
  id: string,
): Promise<AutoReplyJobRow | null> {
  const prisma = getPrismaClient();
  const rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
    `SELECT * FROM email_auto_reply_jobs WHERE id = $1 LIMIT 1`,
    id,
  );
  return rows[0] ? mapRow(rows[0]) : null;
}

export async function findAutoReplyJobByActivity(
  inboundActivityId: string,
): Promise<AutoReplyJobRow | null> {
  const prisma = getPrismaClient();
  const rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
    `SELECT * FROM email_auto_reply_jobs WHERE inbound_activity_id = $1 LIMIT 1`,
    inboundActivityId,
  );
  return rows[0] ? mapRow(rows[0]) : null;
}

/** Skips that must not auto-retry (human already answered / nothing to send). */
const TERMINAL_SKIP_REASONS = [
  "human_already_replied",
  "activity_not_found",
  "automated_sender",
  "bulk_or_transactional_mail",
  "empty_body",
  "quote_only_body",
  "agent_skip",
  "no_mailbox_owner",
  "no_reply_address",
] as const;

/** Atomic claim so cron and the inline trigger cannot both send a reply. */
export async function claimAutoReplyJob(id: string): Promise<boolean> {
  const prisma = getPrismaClient();
  const rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
    `
    UPDATE email_auto_reply_jobs
    SET status = 'analyzing', attempts = attempts + 1, updated_at = NOW()
    WHERE id = $1
      AND reply_activity_id IS NULL
      AND (
        (status IN ('pending', 'failed') AND attempts < max_attempts)
        OR (
          status IN ('escalated', 'skipped')
          AND COALESCE(reason, '') <> ALL($2::text[])
          AND attempts < max_attempts + 1
        )
      )
      AND (next_retry_at IS NULL OR next_retry_at <= NOW())
    RETURNING id
    `,
    id,
    [...TERMINAL_SKIP_REASONS],
  );
  return rows.length > 0;
}

/** Put an unsent job back on the queue (false escalate / timeout / skip). */
export async function requeueUnsentAutoReplyJob(
  id: string,
): Promise<AutoReplyJobRow | null> {
  const prisma = getPrismaClient();
  const rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
    `
    UPDATE email_auto_reply_jobs
    SET status = 'pending',
        attempts = 0,
        next_retry_at = NOW(),
        last_error = NULL,
        completed_at = NULL,
        updated_at = NOW()
    WHERE id = $1
      AND reply_activity_id IS NULL
      AND status NOT IN ('replied', 'awaiting_demo', 'analyzing')
      AND NOT (
        status = 'skipped'
        AND COALESCE(reason, '') = ANY($2::text[])
      )
      AND (next_retry_at IS NULL OR next_retry_at <= NOW() + INTERVAL '1 year')
    RETURNING *
    `,
    id,
    [...TERMINAL_SKIP_REASONS],
  );
  return rows[0] ? mapRow(rows[0]) : null;
}

export async function updateAutoReplyJob(
  id: string,
  data: {
    status?: EmailAutoReplyStatus;
    decision?: string | null;
    sensitivity?: string | null;
    category?: string | null;
    reason?: string | null;
    replyActivityId?: string | null;
    escalatedToUserId?: string | null;
    nextRetryAt?: Date | null;
    lastError?: string | null;
    completedAt?: Date | null;
    resultSummary?: Prisma.InputJsonValue | null;
  },
): Promise<AutoReplyJobRow> {
  const prisma = getPrismaClient();
  const summaryJson =
    data.resultSummary === undefined
      ? null
      : JSON.stringify(data.resultSummary ?? null);

  const rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
    `
    UPDATE email_auto_reply_jobs SET
      status = CASE WHEN $2::text IS NULL THEN status ELSE $2::"EmailAutoReplyStatus" END,
      decision = CASE WHEN $12::boolean THEN $3 ELSE decision END,
      sensitivity = CASE WHEN $13::boolean THEN $4 ELSE sensitivity END,
      category = CASE WHEN $14::boolean THEN $5 ELSE category END,
      reason = CASE WHEN $15::boolean THEN $6 ELSE reason END,
      reply_activity_id = CASE WHEN $16::boolean THEN $7 ELSE reply_activity_id END,
      escalated_to_user_id = CASE WHEN $17::boolean THEN $8::bigint ELSE escalated_to_user_id END,
      next_retry_at = CASE WHEN $18::boolean THEN $9 ELSE next_retry_at END,
      last_error = CASE WHEN $19::boolean THEN $10 ELSE last_error END,
      completed_at = CASE WHEN $20::boolean THEN $11 ELSE completed_at END,
      result_summary = CASE WHEN $21::boolean THEN $22::jsonb ELSE result_summary END,
      updated_at = NOW()
    WHERE id = $1
    RETURNING *
    `,
    id,
    data.status ?? null,
    data.decision === undefined ? null : data.decision,
    data.sensitivity === undefined ? null : data.sensitivity,
    data.category === undefined ? null : data.category,
    data.reason === undefined ? null : data.reason,
    data.replyActivityId === undefined ? null : data.replyActivityId,
    data.escalatedToUserId === undefined ? null : data.escalatedToUserId,
    data.nextRetryAt === undefined ? null : data.nextRetryAt,
    data.lastError === undefined ? null : data.lastError,
    data.completedAt === undefined ? null : data.completedAt,
    data.decision !== undefined,
    data.sensitivity !== undefined,
    data.category !== undefined,
    data.reason !== undefined,
    data.replyActivityId !== undefined,
    data.escalatedToUserId !== undefined,
    data.nextRetryAt !== undefined,
    data.lastError !== undefined,
    data.completedAt !== undefined,
    data.resultSummary !== undefined,
    summaryJson,
  );
  if (!rows[0]) throw new Error("Auto-reply job not found after update.");
  return mapRow(rows[0]);
}

export async function listDueAutoReplyJobs(
  limit: number,
): Promise<AutoReplyJobRow[]> {
  const prisma = getPrismaClient();
  // Reclaim jobs stuck in analyzing after a crash mid-flight.
  await prisma.$executeRawUnsafe(
    `
    UPDATE email_auto_reply_jobs
    SET status = 'pending',
        next_retry_at = NOW(),
        last_error = COALESCE(last_error, 'stale_analyzing_reclaimed'),
        updated_at = NOW()
    WHERE reply_activity_id IS NULL
      AND status = 'analyzing'
      AND updated_at < NOW() - INTERVAL '3 minutes'
    `,
  );
  const rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
    `
    SELECT * FROM email_auto_reply_jobs
    WHERE reply_activity_id IS NULL
      AND (
        (status IN ('pending', 'failed') AND attempts < max_attempts)
        OR (
          status IN ('escalated', 'skipped')
          AND COALESCE(reason, '') <> ALL($2::text[])
          AND attempts < max_attempts + 1
        )
      )
      AND (next_retry_at IS NULL OR next_retry_at <= NOW())
    ORDER BY created_at ASC
    LIMIT $1
    `,
    limit,
    [...TERMINAL_SKIP_REASONS],
  );
  return rows.map(mapRow);
}

/** Paginated auto-reply job history for the dedicated "Recent runs" page. */
export async function listAutoReplyJobsPage(
  organizationId: string,
  opts: {
    limit?: number;
    offset?: number;
    status?: EmailAutoReplyStatus | null;
    since: Date;
    until: Date;
  },
): Promise<{ rows: AutoReplyJobRow[]; total: number }> {
  const prisma = getPrismaClient();
  const limit = Math.min(100, Math.max(1, opts.limit ?? 25));
  const offset = Math.max(0, opts.offset ?? 0);
  const status = opts.status ?? null;

  const [rows, countRows] = await Promise.all([
    prisma.$queryRawUnsafe<Record<string, unknown>[]>(
      `
      SELECT * FROM email_auto_reply_jobs
      WHERE organization_id = $1::bigint
        AND ($2::text IS NULL OR status = $2::"EmailAutoReplyStatus")
        AND COALESCE(completed_at, updated_at) >= $5
        AND COALESCE(completed_at, updated_at) <= $6
      ORDER BY updated_at DESC
      LIMIT $3 OFFSET $4
      `,
      organizationId,
      status,
      limit,
      offset,
      opts.since,
      opts.until,
    ),
    prisma.$queryRawUnsafe<{ count: bigint }[]>(
      `
      SELECT count(*)::bigint AS count FROM email_auto_reply_jobs
      WHERE organization_id = $1::bigint
        AND ($2::text IS NULL OR status = $2::"EmailAutoReplyStatus")
        AND COALESCE(completed_at, updated_at) >= $3
        AND COALESCE(completed_at, updated_at) <= $4
      `,
      organizationId,
      status,
      opts.since,
      opts.until,
    ),
  ]);

  return {
    rows: rows.map(mapRow),
    total: Number(countRows[0]?.count ?? 0n),
  };
}

/** Cancel bot auto-replies when a human sales owner takes the lead. */
export async function skipPendingAutoReplyForContact(
  contactId: string,
  reason: string,
): Promise<number> {
  const prisma = getPrismaClient();
  const rows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `
    UPDATE email_auto_reply_jobs SET
      status = 'skipped',
      decision = 'skip',
      reason = $2,
      completed_at = NOW(),
      updated_at = NOW()
    WHERE contact_id = $1::text
      AND status IN ('pending', 'analyzing', 'awaiting_demo')
    RETURNING id
    `,
    contactId,
    reason,
  );
  return rows.length;
}

/** True when this inbound already produced a sent auto-reply or open demo. */
export async function threadAlreadyHandled(
  threadActivityIds: string[],
): Promise<boolean> {
  if (threadActivityIds.length === 0) return false;
  const prisma = getPrismaClient();
  const rows = await prisma.$queryRawUnsafe<Array<{ count: number | bigint }>>(
    `
    SELECT COUNT(*)::int AS count
    FROM email_auto_reply_jobs
    WHERE inbound_activity_id = ANY($1::text[])
      AND (
        status = 'awaiting_demo'
        OR (status = 'replied' AND reply_activity_id IS NOT NULL)
      )
    `,
    threadActivityIds,
  );
  return Number(rows[0]?.count ?? 0) > 0;
}
