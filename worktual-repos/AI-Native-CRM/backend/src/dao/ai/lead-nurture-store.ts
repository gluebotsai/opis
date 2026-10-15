/**
 * Lead nurture job persistence via raw SQL so Turbopack-stale Prisma clients
 * cannot break the agent after schema adds.
 */

import { randomBytes } from "node:crypto";
import { getPrismaClient } from "@/dao/db/prisma";
import type { LeadNurtureStatus, Prisma } from "@prisma/client";

export type NurtureJobRow = {
  id: string;
  organizationId: string;
  contactId: string;
  status: LeadNurtureStatus;
  decision: string | null;
  attempts: number;
  maxAttempts: number;
  nextRetryAt: Date | null;
  lastError: string | null;
  resultSummary: Prisma.JsonValue | null;
  lastSentAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
};

function cuidLike(): string {
  return `lnj_${randomBytes(12).toString("hex")}`;
}

function mapRow(r: Record<string, unknown>): NurtureJobRow {
  return {
    id: String(r.id),
    organizationId: String(r.organization_id),
    contactId: String(r.contact_id),
    status: r.status as LeadNurtureStatus,
    decision: r.decision == null ? null : String(r.decision),
    attempts: Number(r.attempts ?? 0),
    maxAttempts: Number(r.max_attempts ?? 5),
    nextRetryAt: r.next_retry_at ? new Date(String(r.next_retry_at)) : null,
    lastError: r.last_error == null ? null : String(r.last_error),
    resultSummary: (r.result_summary as Prisma.JsonValue) ?? null,
    lastSentAt: r.last_sent_at ? new Date(String(r.last_sent_at)) : null,
    createdAt: new Date(String(r.created_at)),
    updatedAt: new Date(String(r.updated_at)),
    completedAt: r.completed_at ? new Date(String(r.completed_at)) : null,
  };
}

export async function upsertNurtureJob(input: {
  organizationId: string;
  contactId: string;
  maxAttempts?: number;
}): Promise<NurtureJobRow> {
  const prisma = getPrismaClient();
  const id = cuidLike();
  const maxAttempts = input.maxAttempts ?? 5;
  const rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
    `
    INSERT INTO lead_nurture_jobs (
      id, organization_id, contact_id, status, decision, attempts, max_attempts,
      next_retry_at, last_error, result_summary, last_sent_at,
      created_at, updated_at, completed_at
    ) VALUES (
      $1, $2::bigint, $3::text, 'pending', NULL, 0, $4,
      NOW(), NULL, NULL, NULL, NOW(), NOW(), NULL
    )
    ON CONFLICT (organization_id, contact_id) DO UPDATE SET
      status = CASE
        WHEN lead_nurture_jobs.status IN ('analyzing') THEN lead_nurture_jobs.status
        WHEN lead_nurture_jobs.status = 'waited'
          AND lead_nurture_jobs.result_summary->>'callTouchEligibleAt' IS NOT NULL
          THEN lead_nurture_jobs.status
        WHEN lead_nurture_jobs.status IN ('waited', 'failed', 'sent', 'skipped')
          AND lead_nurture_jobs.next_retry_at > NOW()
          THEN lead_nurture_jobs.status
        ELSE 'pending'
      END,
      next_retry_at = CASE
        WHEN lead_nurture_jobs.status IN ('analyzing') THEN lead_nurture_jobs.next_retry_at
        WHEN lead_nurture_jobs.status = 'waited'
          AND lead_nurture_jobs.result_summary->>'callTouchEligibleAt' IS NOT NULL
          THEN lead_nurture_jobs.next_retry_at
        WHEN lead_nurture_jobs.status IN ('waited', 'failed', 'sent', 'skipped')
          AND lead_nurture_jobs.next_retry_at > NOW()
          THEN lead_nurture_jobs.next_retry_at
        ELSE NOW()
      END,
      updated_at = NOW()
    RETURNING *
    `,
    id,
    input.organizationId,
    input.contactId,
    maxAttempts,
  );
  return mapRow(rows[0]!);
}

export async function findNurtureJobByOrgContact(
  organizationId: string,
  contactId: string,
): Promise<NurtureJobRow | null> {
  const prisma = getPrismaClient();
  const rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
    `
    SELECT * FROM lead_nurture_jobs
    WHERE organization_id = $1::bigint AND contact_id = $2::text
    LIMIT 1
    `,
    organizationId,
    contactId,
  );
  return rows[0] ? mapRow(rows[0]) : null;
}

export async function findNurtureJobById(
  id: string,
): Promise<NurtureJobRow | null> {
  const prisma = getPrismaClient();
  const rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
    `
    SELECT * FROM lead_nurture_jobs WHERE id = $1 LIMIT 1
    `,
    id,
  );
  return rows[0] ? mapRow(rows[0]) : null;
}

export async function claimNurtureJob(id: string): Promise<boolean> {
  const prisma = getPrismaClient();
  const rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
    `
    UPDATE lead_nurture_jobs
    SET status = 'analyzing', updated_at = NOW()
    WHERE id = $1
      AND status IN ('pending', 'waited', 'failed')
      AND (
        attempts < max_attempts
        OR (
          status = 'waited'
          AND (
            result_summary->>'callTouchEligibleAt' IS NOT NULL
            OR result_summary->'conversationGate' IS NOT NULL
            OR result_summary->'voiceOutcomePending' IS NOT NULL
          )
          AND (next_retry_at IS NULL OR next_retry_at <= NOW())
        )
      )
      AND (next_retry_at IS NULL OR next_retry_at <= NOW())
    RETURNING id
    `,
    id,
  );
  return rows.length > 0;
}

/** A restart can leave a claimed job in analyzing. Put it back so the gate can retry. */
export async function reclaimStaleAnalyzingNurtureJobs(
  staleSeconds = 240,
): Promise<number> {
  const prisma = getPrismaClient();
  const rows = await prisma.$queryRawUnsafe<{ id: string }[]>(
    `
    UPDATE lead_nurture_jobs
    SET
      status = CASE
        WHEN result_summary->'conversationGate' IS NOT NULL THEN 'waited'::"LeadNurtureStatus"
        ELSE 'pending'::"LeadNurtureStatus"
      END,
      next_retry_at = NOW(),
      updated_at = NOW()
    WHERE status = 'analyzing'
      AND updated_at < NOW() - make_interval(secs => $1::int)
    RETURNING id
    `,
    staleSeconds,
  );
  return rows.length;
}

export async function updateNurtureJob(
  id: string,
  data: {
    status?: LeadNurtureStatus;
    decision?: string | null;
    attempts?: number;
    lastError?: string | null;
    nextRetryAt?: Date | null;
    completedAt?: Date | null;
    lastSentAt?: Date | null;
    resultSummary?: Prisma.InputJsonValue | null;
  },
): Promise<NurtureJobRow> {
  const prisma = getPrismaClient();
  const summaryJson =
    data.resultSummary === undefined
      ? null
      : JSON.stringify(data.resultSummary ?? null);

  const rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
    `
    UPDATE lead_nurture_jobs SET
      status = CASE WHEN $2::text IS NULL THEN status ELSE $2::"LeadNurtureStatus" END,
      decision = CASE WHEN $10::boolean THEN $3 ELSE decision END,
      attempts = COALESCE($4, attempts),
      last_error = CASE WHEN $11::boolean THEN $5 ELSE last_error END,
      next_retry_at = CASE WHEN $12::boolean THEN $6 ELSE next_retry_at END,
      completed_at = CASE WHEN $13::boolean THEN $7 ELSE completed_at END,
      last_sent_at = CASE WHEN $14::boolean THEN $8 ELSE last_sent_at END,
      result_summary = CASE WHEN $15::boolean THEN $9::jsonb ELSE result_summary END,
      updated_at = NOW()
    WHERE id = $1
    RETURNING *
    `,
    id,
    data.status ?? null,
    data.decision === undefined ? null : data.decision,
    data.attempts ?? null,
    data.lastError === undefined ? null : data.lastError,
    data.nextRetryAt === undefined ? null : data.nextRetryAt,
    data.completedAt === undefined ? null : data.completedAt,
    data.lastSentAt === undefined ? null : data.lastSentAt,
    summaryJson,
    data.decision !== undefined,
    data.lastError !== undefined,
    data.nextRetryAt !== undefined,
    data.completedAt !== undefined,
    data.lastSentAt !== undefined,
    data.resultSummary !== undefined,
  );
  if (!rows[0]) throw new Error("Nurture job not found after update.");
  return mapRow(rows[0]);
}

const DUE_NURTURE_WHERE = `
  (
    status IN ('pending', 'waited')
    AND (
      attempts < max_attempts
      OR (
        status = 'waited'
        AND result_summary->>'callTouchEligibleAt' IS NOT NULL
      )
    )
    AND (next_retry_at IS NULL OR next_retry_at <= NOW())
  )
  OR (
    status = 'failed'
    AND attempts < $1
    AND next_retry_at IS NOT NULL
    AND next_retry_at <= NOW()
  )
`;

/** Organizations that currently have a due nurture send. */
export async function listDueNurtureOrganizationIds(
  maxAttempts: number,
): Promise<string[]> {
  const prisma = getPrismaClient();
  const rows = await prisma.$queryRawUnsafe<{ organization_id: unknown }[]>(
    `
    SELECT DISTINCT organization_id::text AS organization_id
    FROM lead_nurture_jobs
    WHERE ${DUE_NURTURE_WHERE}
    `,
    maxAttempts,
  );
  return rows
    .map((row) => String(row.organization_id ?? "").trim())
    .filter((id) => id.length > 0);
}

export async function listDueNurtureJobs(
  limit: number,
  maxAttempts: number,
  organizationId: string,
): Promise<NurtureJobRow[]> {
  const prisma = getPrismaClient();
  const rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
    `
    SELECT * FROM lead_nurture_jobs
    WHERE organization_id = $3::bigint
      AND (${DUE_NURTURE_WHERE})
    ORDER BY
      -- scheduled nurture calls first, so the configured call delay is honoured
      (result_summary->>'callTouchEligibleAt' IS NOT NULL) DESC,
      next_retry_at ASC NULLS FIRST,
      updated_at ASC
    LIMIT $2
    `,
    maxAttempts,
    limit,
    organizationId,
  );
  return rows.map(mapRow);
}

/** Jobs waiting on nurture voice delay — re-arm in-process timers after restart. */
export async function listVoiceScheduledNurtureJobs(
  limit = 200,
): Promise<NurtureJobRow[]> {
  const prisma = getPrismaClient();
  const rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
    `
    SELECT * FROM lead_nurture_jobs
    WHERE status = 'waited'
      AND result_summary->>'callTouchEligibleAt' IS NOT NULL
      AND attempts < max_attempts
    ORDER BY next_retry_at ASC NULLS LAST
    LIMIT $1
    `,
    limit,
  );
  return rows.map(mapRow);
}

const DEFERRED_CONVERSATION_WHERE = `
  status = 'waited'
  AND result_summary->'conversationGate' IS NOT NULL
  AND (next_retry_at IS NULL OR next_retry_at <= NOW())
`;

/** Organizations with a nurture job held by the conversation gate. */
export async function listConversationDeferredOrganizationIds(): Promise<
  string[]
> {
  const prisma = getPrismaClient();
  const rows = await prisma.$queryRawUnsafe<{ organization_id: unknown }[]>(
    `
    SELECT DISTINCT organization_id::text AS organization_id
    FROM lead_nurture_jobs
    WHERE ${DEFERRED_CONVERSATION_WHERE}
    `,
  );
  return rows
    .map((row) => String(row.organization_id ?? "").trim())
    .filter((id) => id.length > 0);
}

/** Jobs held by the live-conversation/omnichannel-summary hard gate. */
export async function listConversationDeferredNurtureJobs(
  limit = 50,
  organizationId?: string,
): Promise<NurtureJobRow[]> {
  const prisma = getPrismaClient();
  const rows = organizationId
    ? await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
        `
        SELECT * FROM lead_nurture_jobs
        WHERE organization_id = $2::bigint
          AND ${DEFERRED_CONVERSATION_WHERE}
        ORDER BY next_retry_at ASC NULLS FIRST
        LIMIT $1
        `,
        limit,
        organizationId,
      )
    : await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
        `
        SELECT * FROM lead_nurture_jobs
        WHERE ${DEFERRED_CONVERSATION_WHERE}
        ORDER BY next_retry_at ASC NULLS FIRST
        LIMIT $1
        `,
        limit,
      );
  return rows.map(mapRow);
}

/** Paginated nurture job history for the dedicated "Recent runs" page. */
export async function listNurtureJobsPage(
  organizationId: string,
  opts: {
    limit?: number;
    offset?: number;
    status?: LeadNurtureStatus | null;
    since: Date;
    until: Date;
  },
): Promise<{ rows: NurtureJobRow[]; total: number }> {
  const prisma = getPrismaClient();
  const limit = Math.min(100, Math.max(1, opts.limit ?? 25));
  const offset = Math.max(0, opts.offset ?? 0);
  const status = opts.status ?? null;

  const [rows, countRows] = await Promise.all([
    prisma.$queryRawUnsafe<Record<string, unknown>[]>(
      `
      SELECT * FROM lead_nurture_jobs
      WHERE organization_id = $1::bigint
        AND ($2::text IS NULL OR status = $2::"LeadNurtureStatus")
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
      SELECT count(*)::bigint AS count FROM lead_nurture_jobs
      WHERE organization_id = $1::bigint
        AND ($2::text IS NULL OR status = $2::"LeadNurtureStatus")
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

/** After CRM bot Gmail reconnect, retry sends that failed on reauth. */
export async function requeueFailedCrmBotNurtureJobs(
  organizationId: string,
): Promise<number> {
  const prisma = getPrismaClient();
  const rows = await prisma.$queryRawUnsafe<{ count: bigint }[]>(
    `
    WITH updated AS (
      UPDATE lead_nurture_jobs
      SET status = 'pending',
          last_error = NULL,
          next_retry_at = NOW(),
          updated_at = NOW()
      WHERE organization_id = $1::bigint
        AND status = 'failed'
        AND (
          last_error ILIKE '%crm_bot_gmail_reauth%'
          OR last_error ILIKE '%mailbox needs re-authentication%'
          OR last_error ILIKE '%unauthorized_client%'
          OR last_error ILIKE '%needs_connect%'
        )
      RETURNING 1
    )
    SELECT count(*)::bigint AS count FROM updated
    `,
    organizationId,
  );
  return Number(rows[0]?.count ?? 0n);
}

