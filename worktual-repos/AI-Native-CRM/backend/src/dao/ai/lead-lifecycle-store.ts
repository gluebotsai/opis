/**
 * Lead lifecycle job persistence via raw SQL so a Turbopack-stale Prisma client
 * cannot break the agent right after a schema add.
 */

import { randomBytes } from "node:crypto";
import { getPrismaClient } from "@/dao/db/prisma";
import type { LeadLifecycleStatus, Prisma } from "@prisma/client";

export type LifecycleJobRow = {
  id: string;
  organizationId: string;
  contactId: string;
  status: LeadLifecycleStatus;
  ladder: string | null;
  fromStage: string | null;
  toStage: string | null;
  decision: string | null;
  reason: string | null;
  triggerReason: string | null;
  dealId: string | null;
  attempts: number;
  maxAttempts: number;
  nextRetryAt: Date | null;
  lastError: string | null;
  resultSummary: Prisma.JsonValue | null;
  lastAppliedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
};

function jobId(): string {
  return `llj_${randomBytes(12).toString("hex")}`;
}

function mapRow(r: Record<string, unknown>): LifecycleJobRow {
  return {
    id: String(r.id),
    organizationId: String(r.organization_id),
    contactId: String(r.contact_id),
    status: r.status as LeadLifecycleStatus,
    ladder: r.ladder == null ? null : String(r.ladder),
    fromStage: r.from_stage == null ? null : String(r.from_stage),
    toStage: r.to_stage == null ? null : String(r.to_stage),
    decision: r.decision == null ? null : String(r.decision),
    reason: r.reason == null ? null : String(r.reason),
    triggerReason: r.trigger_reason == null ? null : String(r.trigger_reason),
    dealId: r.deal_id == null ? null : String(r.deal_id),
    attempts: Number(r.attempts ?? 0),
    maxAttempts: Number(r.max_attempts ?? 5),
    nextRetryAt: r.next_retry_at ? new Date(String(r.next_retry_at)) : null,
    lastError: r.last_error == null ? null : String(r.last_error),
    resultSummary: (r.result_summary as Prisma.JsonValue) ?? null,
    lastAppliedAt: r.last_applied_at
      ? new Date(String(r.last_applied_at))
      : null,
    createdAt: new Date(String(r.created_at)),
    updatedAt: new Date(String(r.updated_at)),
    completedAt: r.completed_at ? new Date(String(r.completed_at)) : null,
  };
}

/**
 * Re-arms the job for a fresh evaluation. Jobs already mid-flight stay put;
 * otherwise the next run is due immediately so CRM events stay proactive.
 */
export async function upsertLifecycleJob(input: {
  organizationId: string;
  contactId: string;
  triggerReason?: string | null;
  maxAttempts?: number;
}): Promise<LifecycleJobRow> {
  const prisma = getPrismaClient();
  const rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
    `
    INSERT INTO lead_lifecycle_jobs (
      id, organization_id, contact_id, status, trigger_reason,
      attempts, max_attempts, next_retry_at, created_at, updated_at
    ) VALUES (
      $1, $2::bigint, $3::text, 'pending', $4, 0, $5, NOW(), NOW(), NOW()
    )
    ON CONFLICT (organization_id, contact_id) DO UPDATE SET
      status = CASE
        WHEN lead_lifecycle_jobs.next_retry_at > NOW() + INTERVAL '1 year'
          THEN lead_lifecycle_jobs.status
        WHEN lead_lifecycle_jobs.status = 'analyzing'
          AND lead_lifecycle_jobs.updated_at >= NOW() - INTERVAL '3 minutes'
          THEN lead_lifecycle_jobs.status
        WHEN lead_lifecycle_jobs.status = 'analyzing'
          THEN 'pending'
        -- Cron safety sweep must not wake jobs still in backoff (stops note spam).
        WHEN COALESCE($4, '') = 'cron_sweep'
          AND lead_lifecycle_jobs.next_retry_at IS NOT NULL
          AND lead_lifecycle_jobs.next_retry_at > NOW()
          AND lead_lifecycle_jobs.status IN ('applied', 'skipped', 'waited', 'failed')
          THEN lead_lifecycle_jobs.status
        ELSE 'pending'
      END,
      trigger_reason = CASE
        WHEN lead_lifecycle_jobs.next_retry_at > NOW() + INTERVAL '1 year'
          THEN lead_lifecycle_jobs.trigger_reason
        WHEN lead_lifecycle_jobs.status = 'analyzing'
          AND lead_lifecycle_jobs.updated_at >= NOW() - INTERVAL '3 minutes'
          AND (COALESCE($4, '') = '' OR COALESCE($4, '') = 'cron_sweep')
          THEN lead_lifecycle_jobs.trigger_reason
        WHEN lead_lifecycle_jobs.status = 'analyzing'
          AND lead_lifecycle_jobs.updated_at >= NOW() - INTERVAL '3 minutes'
          THEN $4
        WHEN COALESCE($4, '') = 'cron_sweep'
          AND lead_lifecycle_jobs.next_retry_at IS NOT NULL
          AND lead_lifecycle_jobs.next_retry_at > NOW()
          AND lead_lifecycle_jobs.status IN ('applied', 'skipped', 'waited', 'failed')
          THEN lead_lifecycle_jobs.trigger_reason
        ELSE COALESCE($4, lead_lifecycle_jobs.trigger_reason)
      END,
      next_retry_at = CASE
        WHEN lead_lifecycle_jobs.next_retry_at > NOW() + INTERVAL '1 year'
          THEN lead_lifecycle_jobs.next_retry_at
        WHEN lead_lifecycle_jobs.status = 'analyzing'
          AND lead_lifecycle_jobs.updated_at >= NOW() - INTERVAL '3 minutes'
          THEN lead_lifecycle_jobs.next_retry_at
        WHEN COALESCE($4, '') = 'cron_sweep'
          AND lead_lifecycle_jobs.next_retry_at IS NOT NULL
          AND lead_lifecycle_jobs.next_retry_at > NOW()
          THEN lead_lifecycle_jobs.next_retry_at
        ELSE NOW()
      END,
      attempts = CASE
        WHEN lead_lifecycle_jobs.next_retry_at > NOW() + INTERVAL '1 year'
          THEN lead_lifecycle_jobs.attempts
        WHEN COALESCE($4, '') = 'cron_sweep'
          AND lead_lifecycle_jobs.next_retry_at IS NOT NULL
          AND lead_lifecycle_jobs.next_retry_at > NOW()
          AND lead_lifecycle_jobs.status IN ('applied', 'skipped', 'waited', 'failed')
          THEN lead_lifecycle_jobs.attempts
        WHEN lead_lifecycle_jobs.status IN ('applied', 'skipped', 'waited') THEN 0
        ELSE lead_lifecycle_jobs.attempts
      END,
      updated_at = NOW()
    RETURNING *
    `,
    jobId(),
    input.organizationId,
    input.contactId,
    input.triggerReason ?? null,
    input.maxAttempts ?? 5,
  );
  return mapRow(rows[0]!);
}

export async function findLifecycleJobById(
  id: string,
): Promise<LifecycleJobRow | null> {
  const prisma = getPrismaClient();
  const rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
    `SELECT * FROM lead_lifecycle_jobs WHERE id = $1 LIMIT 1`,
    id,
  );
  return rows[0] ? mapRow(rows[0]) : null;
}

export async function findLifecycleJobByOrgContact(
  organizationId: string,
  contactId: string,
): Promise<LifecycleJobRow | null> {
  const prisma = getPrismaClient();
  const rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
    `
    SELECT * FROM lead_lifecycle_jobs
    WHERE organization_id = $1::bigint AND contact_id = $2::text
    LIMIT 1
    `,
    organizationId,
    contactId,
  );
  return rows[0] ? mapRow(rows[0]) : null;
}

/** Reclaim jobs stuck in analyzing after a crash or hung ai-service call. */
export async function reclaimStaleAnalyzingLifecycleJobs(): Promise<number> {
  const prisma = getPrismaClient();
  const count = await prisma.$executeRawUnsafe(
    `
    UPDATE lead_lifecycle_jobs
    SET status = 'pending',
        next_retry_at = NOW(),
        last_error = COALESCE(last_error, 'stale_analyzing_reclaimed'),
        updated_at = NOW()
    WHERE status = 'analyzing'
      AND updated_at < NOW() - INTERVAL '3 minutes'
      AND (next_retry_at IS NULL OR next_retry_at <= NOW() + INTERVAL '1 year')
    `,
  );
  return Number(count);
}

export async function claimLifecycleJob(id: string): Promise<boolean> {
  await reclaimStaleAnalyzingLifecycleJobs();
  const prisma = getPrismaClient();
  const rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
    `
    UPDATE lead_lifecycle_jobs
    SET status = 'analyzing', updated_at = NOW()
    WHERE id = $1
      AND status IN ('pending', 'waited', 'failed', 'applied', 'skipped')
      AND (next_retry_at IS NULL OR next_retry_at <= NOW())
    RETURNING id
    `,
    id,
  );
  return rows.length > 0;
}

export async function updateLifecycleJob(
  id: string,
  data: {
    status?: LeadLifecycleStatus;
    ladder?: string | null;
    fromStage?: string | null;
    toStage?: string | null;
    decision?: string | null;
    reason?: string | null;
    dealId?: string | null;
    attempts?: number;
    lastError?: string | null;
    nextRetryAt?: Date | null;
    completedAt?: Date | null;
    lastAppliedAt?: Date | null;
    resultSummary?: Prisma.InputJsonValue | null;
  },
): Promise<LifecycleJobRow> {
  const prisma = getPrismaClient();
  const summaryJson =
    data.resultSummary === undefined
      ? null
      : JSON.stringify(data.resultSummary ?? null);

  const rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
    `
    UPDATE lead_lifecycle_jobs SET
      status = CASE
        WHEN next_retry_at > NOW() + INTERVAL '1 year' THEN status
        WHEN $2::text IS NULL THEN status
        ELSE $2::"LeadLifecycleStatus"
      END,
      ladder = CASE WHEN $13::boolean THEN $3 ELSE ladder END,
      from_stage = CASE WHEN $14::boolean THEN $4 ELSE from_stage END,
      to_stage = CASE WHEN $15::boolean THEN $5 ELSE to_stage END,
      decision = CASE WHEN $16::boolean THEN $6 ELSE decision END,
      reason = CASE WHEN $17::boolean THEN $7 ELSE reason END,
      deal_id = CASE WHEN $18::boolean THEN $8 ELSE deal_id END,
      attempts = COALESCE($9, attempts),
      last_error = CASE WHEN $19::boolean THEN $10 ELSE last_error END,
      next_retry_at = CASE
        WHEN next_retry_at > NOW() + INTERVAL '1 year' THEN next_retry_at
        WHEN $20::boolean THEN $11
        ELSE next_retry_at
      END,
      completed_at = CASE WHEN $21::boolean THEN $12 ELSE completed_at END,
      last_applied_at = CASE WHEN $22::boolean THEN $23 ELSE last_applied_at END,
      result_summary = CASE WHEN $24::boolean THEN $25::jsonb ELSE result_summary END,
      updated_at = NOW()
    WHERE id = $1
    RETURNING *
    `,
    id,
    data.status ?? null,
    data.ladder === undefined ? null : data.ladder,
    data.fromStage === undefined ? null : data.fromStage,
    data.toStage === undefined ? null : data.toStage,
    data.decision === undefined ? null : data.decision,
    data.reason === undefined ? null : data.reason,
    data.dealId === undefined ? null : data.dealId,
    data.attempts ?? null,
    data.lastError === undefined ? null : data.lastError,
    data.nextRetryAt === undefined ? null : data.nextRetryAt,
    data.completedAt === undefined ? null : data.completedAt,
    data.ladder !== undefined,
    data.fromStage !== undefined,
    data.toStage !== undefined,
    data.decision !== undefined,
    data.reason !== undefined,
    data.dealId !== undefined,
    data.lastError !== undefined,
    data.nextRetryAt !== undefined,
    data.completedAt !== undefined,
    data.lastAppliedAt !== undefined,
    data.lastAppliedAt === undefined ? null : data.lastAppliedAt,
    data.resultSummary !== undefined,
    summaryJson,
  );
  if (!rows[0]) throw new Error("Lifecycle job not found after update.");
  return mapRow(rows[0]);
}

const DUE_LIFECYCLE_WHERE = `
  (
    status IN ('pending', 'waited')
    AND (next_retry_at IS NULL OR next_retry_at <= NOW())
  )
  OR (
    status = 'failed'
    AND attempts < $1
    AND next_retry_at IS NOT NULL
    AND next_retry_at <= NOW()
  )
`;

/** Organizations that currently have a due lifecycle job. */
export async function listDueLifecycleOrganizationIds(
  maxAttempts: number,
): Promise<string[]> {
  const prisma = getPrismaClient();
  const rows = await prisma.$queryRawUnsafe<{ organization_id: unknown }[]>(
    `
    SELECT DISTINCT organization_id::text AS organization_id
    FROM lead_lifecycle_jobs
    WHERE ${DUE_LIFECYCLE_WHERE}
    `,
    maxAttempts,
  );
  return rows
    .map((row) => String(row.organization_id ?? "").trim())
    .filter((id) => id.length > 0);
}

export async function listDueLifecycleJobs(
  limit: number,
  maxAttempts: number,
  organizationId: string,
): Promise<LifecycleJobRow[]> {
  const prisma = getPrismaClient();
  const rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
    `
    SELECT * FROM lead_lifecycle_jobs
    WHERE organization_id = $3::bigint
      AND (${DUE_LIFECYCLE_WHERE})
    ORDER BY updated_at ASC
    LIMIT $2
    `,
    maxAttempts,
    limit,
    organizationId,
  );
  return rows.map(mapRow);
}

/** Paginated lifecycle job history for the dedicated "Recent runs" page. */
export async function listLifecycleJobsPage(
  organizationId: string,
  opts: {
    limit?: number;
    offset?: number;
    status?: LeadLifecycleStatus | null;
    since: Date;
    until: Date;
  },
): Promise<{ rows: LifecycleJobRow[]; total: number }> {
  const prisma = getPrismaClient();
  const limit = Math.min(100, Math.max(1, opts.limit ?? 25));
  const offset = Math.max(0, opts.offset ?? 0);
  const status = opts.status ?? null;

  const [rows, countRows] = await Promise.all([
    prisma.$queryRawUnsafe<Record<string, unknown>[]>(
      `
      SELECT * FROM lead_lifecycle_jobs
      WHERE organization_id = $1::bigint
        AND ($2::text IS NULL OR status = $2::"LeadLifecycleStatus")
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
      SELECT count(*)::bigint AS count FROM lead_lifecycle_jobs
      WHERE organization_id = $1::bigint
        AND ($2::text IS NULL OR status = $2::"LeadLifecycleStatus")
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
