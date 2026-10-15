/**
 * Lead scoring job persistence via raw SQL so Turbopack-stale Prisma clients
 * cannot break the agent after schema adds.
 */

import { randomBytes } from "node:crypto";
import { getPrismaClient } from "@/dao/db/prisma";
import type { Prisma } from "@prisma/client";

export type LeadScoringStatus = "pending" | "scoring" | "scored" | "failed";

export type ScoringJobRow = {
  id: string;
  organizationId: string;
  contactId: string;
  status: LeadScoringStatus;
  score: number | null;
  fitScore: number | null;
  intentScore: number | null;
  grade: string | null;
  band: string | null;
  rationale: string | null;
  factors: Prisma.JsonValue | null;
  nextBestAction: string | null;
  triggerReason: string | null;
  previousScore: number | null;
  attempts: number;
  maxAttempts: number;
  nextRetryAt: Date | null;
  lastError: string | null;
  resultSummary: Prisma.JsonValue | null;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
};

function cuidLike(): string {
  return `lsj_${randomBytes(12).toString("hex")}`;
}

function mapRow(r: Record<string, unknown>): ScoringJobRow {
  return {
    id: String(r.id),
    organizationId: String(r.organization_id),
    contactId: String(r.contact_id),
    status: r.status as LeadScoringStatus,
    score: r.score == null ? null : Number(r.score),
    fitScore: r.fit_score == null ? null : Number(r.fit_score),
    intentScore: r.intent_score == null ? null : Number(r.intent_score),
    grade: r.grade == null ? null : String(r.grade),
    band: r.band == null ? null : String(r.band),
    rationale: r.rationale == null ? null : String(r.rationale),
    factors: (r.factors as Prisma.JsonValue) ?? null,
    nextBestAction:
      r.next_best_action == null ? null : String(r.next_best_action),
    triggerReason: r.trigger_reason == null ? null : String(r.trigger_reason),
    previousScore: r.previous_score == null ? null : Number(r.previous_score),
    attempts: Number(r.attempts ?? 0),
    maxAttempts: Number(r.max_attempts ?? 5),
    nextRetryAt: r.next_retry_at ? new Date(String(r.next_retry_at)) : null,
    lastError: r.last_error == null ? null : String(r.last_error),
    resultSummary: (r.result_summary as Prisma.JsonValue) ?? null,
    createdAt: new Date(String(r.created_at)),
    updatedAt: new Date(String(r.updated_at)),
    completedAt: r.completed_at ? new Date(String(r.completed_at)) : null,
  };
}

export async function upsertScoringJob(input: {
  organizationId: string;
  contactId: string;
  triggerReason?: string | null;
  maxAttempts?: number;
}): Promise<ScoringJobRow> {
  const prisma = getPrismaClient();
  const id = cuidLike();
  const maxAttempts = input.maxAttempts ?? 5;
  const rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
    `
    INSERT INTO lead_scoring_jobs (
      id, organization_id, contact_id, status, score, fit_score, intent_score,
      grade, band, rationale,
      factors, next_best_action, trigger_reason, previous_score,
      attempts, max_attempts, next_retry_at, last_error, result_summary,
      created_at, updated_at, completed_at
    ) VALUES (
      $1, $2::bigint, $3::text, 'pending', NULL, NULL, NULL,
      NULL, NULL, NULL,
      NULL, NULL, $4, NULL,
      0, $5, NOW(), NULL, NULL,
      NOW(), NOW(), NULL
    )
    ON CONFLICT (organization_id, contact_id) DO UPDATE SET
      status = CASE
        WHEN lead_scoring_jobs.next_retry_at > NOW() + INTERVAL '1 year'
          THEN lead_scoring_jobs.status
        WHEN lead_scoring_jobs.status = 'scoring' THEN lead_scoring_jobs.status
        ELSE 'pending'
      END,
      previous_score = COALESCE(lead_scoring_jobs.score, lead_scoring_jobs.previous_score),
      trigger_reason = COALESCE($4, lead_scoring_jobs.trigger_reason),
      attempts = CASE
        WHEN lead_scoring_jobs.status = 'scoring' THEN lead_scoring_jobs.attempts
        ELSE 0
      END,
      next_retry_at = CASE
        WHEN lead_scoring_jobs.next_retry_at > NOW() + INTERVAL '1 year'
          THEN lead_scoring_jobs.next_retry_at
        WHEN lead_scoring_jobs.status = 'scoring' THEN lead_scoring_jobs.next_retry_at
        ELSE NOW()
      END,
      last_error = NULL,
      completed_at = CASE
        WHEN lead_scoring_jobs.next_retry_at > NOW() + INTERVAL '1 year'
          THEN lead_scoring_jobs.completed_at
        WHEN lead_scoring_jobs.status = 'scoring' THEN lead_scoring_jobs.completed_at
        ELSE NULL
      END,
      updated_at = NOW()
    RETURNING *
    `,
    id,
    input.organizationId,
    input.contactId,
    input.triggerReason ?? null,
    maxAttempts,
  );
  return mapRow(rows[0]!);
}

export async function findScoringJobByOrgContact(
  organizationId: string,
  contactId: string,
): Promise<ScoringJobRow | null> {
  const prisma = getPrismaClient();
  const rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
    `
    SELECT * FROM lead_scoring_jobs
    WHERE organization_id = $1::bigint AND contact_id = $2::text
    LIMIT 1
    `,
    organizationId,
    contactId,
  );
  return rows[0] ? mapRow(rows[0]) : null;
}

export async function findScoringJobByContactId(
  contactId: string,
): Promise<ScoringJobRow | null> {
  const prisma = getPrismaClient();
  const rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
    `
    SELECT * FROM lead_scoring_jobs
    WHERE contact_id = $1::text
    ORDER BY updated_at DESC
    LIMIT 1
    `,
    contactId,
  );
  return rows[0] ? mapRow(rows[0]) : null;
}

export async function findScoringJobById(
  id: string,
): Promise<ScoringJobRow | null> {
  const prisma = getPrismaClient();
  const rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
    `
    SELECT * FROM lead_scoring_jobs WHERE id = $1 LIMIT 1
    `,
    id,
  );
  return rows[0] ? mapRow(rows[0]) : null;
}

/** Jobs stuck in `scoring` (crashed worker, hung LLM) block all re-runs until reclaimed. */
export async function reclaimStaleScoringJobs(
  staleSeconds = 120,
): Promise<number> {
  const prisma = getPrismaClient();
  const rows = await prisma.$queryRawUnsafe<{ id: string }[]>(
    `
    UPDATE lead_scoring_jobs
    SET
      status = 'pending',
      next_retry_at = NOW(),
      last_error = COALESCE(last_error, 'stale_scoring_reclaimed'),
      updated_at = NOW()
    WHERE status = 'scoring'
      AND updated_at < NOW() - make_interval(secs => $1::int)
      AND (next_retry_at IS NULL OR next_retry_at <= NOW() + INTERVAL '1 year')
    RETURNING id
    `,
    staleSeconds,
  );
  return rows.length;
}

export async function claimScoringJob(id: string): Promise<boolean> {
  const prisma = getPrismaClient();
  const rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
    `
    UPDATE lead_scoring_jobs
    SET status = 'scoring', updated_at = NOW()
    WHERE id = $1
      AND status IN ('pending', 'failed')
      AND (next_retry_at IS NULL OR next_retry_at <= NOW())
    RETURNING id
    `,
    id,
  );
  return rows.length > 0;
}

export async function updateScoringJob(
  id: string,
  data: {
    status?: LeadScoringStatus;
    score?: number | null;
    fitScore?: number | null;
    intentScore?: number | null;
    grade?: string | null;
    band?: string | null;
    rationale?: string | null;
    factors?: Prisma.InputJsonValue | null;
    nextBestAction?: string | null;
    triggerReason?: string | null;
    previousScore?: number | null;
    attempts?: number;
    lastError?: string | null;
    nextRetryAt?: Date | null;
    completedAt?: Date | null;
    resultSummary?: Prisma.InputJsonValue | null;
  },
): Promise<ScoringJobRow> {
  const prisma = getPrismaClient();
  const factorsJson =
    data.factors === undefined ? null : JSON.stringify(data.factors ?? null);
  const summaryJson =
    data.resultSummary === undefined
      ? null
      : JSON.stringify(data.resultSummary ?? null);

  const rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
    `
    UPDATE lead_scoring_jobs SET
      status = CASE
        WHEN next_retry_at > NOW() + INTERVAL '1 year' THEN status
        WHEN $2::text IS NULL THEN status
        ELSE $2::"LeadScoringStatus"
      END,
      score = CASE WHEN $16::boolean THEN $3 ELSE score END,
      grade = CASE WHEN $17::boolean THEN $4 ELSE grade END,
      band = CASE WHEN $18::boolean THEN $5 ELSE band END,
      rationale = CASE WHEN $19::boolean THEN $6 ELSE rationale END,
      factors = CASE WHEN $20::boolean THEN $7::jsonb ELSE factors END,
      next_best_action = CASE WHEN $21::boolean THEN $8 ELSE next_best_action END,
      trigger_reason = CASE WHEN $22::boolean THEN $9 ELSE trigger_reason END,
      previous_score = CASE WHEN $23::boolean THEN $10 ELSE previous_score END,
      attempts = COALESCE($11, attempts),
      last_error = CASE WHEN $24::boolean THEN $12 ELSE last_error END,
      next_retry_at = CASE
        WHEN next_retry_at > NOW() + INTERVAL '1 year' THEN next_retry_at
        WHEN $25::boolean THEN $13
        ELSE next_retry_at
      END,
      completed_at = CASE
        WHEN next_retry_at > NOW() + INTERVAL '1 year' THEN completed_at
        WHEN $26::boolean THEN $14
        ELSE completed_at
      END,
      result_summary = CASE WHEN $27::boolean THEN $15::jsonb ELSE result_summary END,
      fit_score = CASE WHEN $28::boolean THEN $29 ELSE fit_score END,
      intent_score = CASE WHEN $30::boolean THEN $31 ELSE intent_score END,
      updated_at = NOW()
    WHERE id = $1
    RETURNING *
    `,
    id,
    data.status ?? null,
    data.score === undefined ? null : data.score,
    data.grade === undefined ? null : data.grade,
    data.band === undefined ? null : data.band,
    data.rationale === undefined ? null : data.rationale,
    factorsJson,
    data.nextBestAction === undefined ? null : data.nextBestAction,
    data.triggerReason === undefined ? null : data.triggerReason,
    data.previousScore === undefined ? null : data.previousScore,
    data.attempts ?? null,
    data.lastError === undefined ? null : data.lastError,
    data.nextRetryAt === undefined ? null : data.nextRetryAt,
    data.completedAt === undefined ? null : data.completedAt,
    summaryJson,
    data.score !== undefined,
    data.grade !== undefined,
    data.band !== undefined,
    data.rationale !== undefined,
    data.factors !== undefined,
    data.nextBestAction !== undefined,
    data.triggerReason !== undefined,
    data.previousScore !== undefined,
    data.lastError !== undefined,
    data.nextRetryAt !== undefined,
    data.completedAt !== undefined,
    data.resultSummary !== undefined,
    data.fitScore !== undefined,
    data.fitScore === undefined ? null : data.fitScore,
    data.intentScore !== undefined,
    data.intentScore === undefined ? null : data.intentScore,
  );
  if (!rows[0]) throw new Error("Scoring job not found after update.");
  return mapRow(rows[0]);
}

const DUE_SCORING_WHERE = `
  (
    status = 'pending'
    AND (next_retry_at IS NULL OR next_retry_at <= NOW())
  )
  OR (
    status = 'failed'
    AND attempts < $1
    AND next_retry_at IS NOT NULL
    AND next_retry_at <= NOW()
  )
`;

/** Organizations that currently have a due scoring job. */
export async function listDueScoringOrganizationIds(
  maxAttempts: number,
): Promise<string[]> {
  const prisma = getPrismaClient();
  const rows = await prisma.$queryRawUnsafe<{ organization_id: unknown }[]>(
    `
    SELECT DISTINCT organization_id::text AS organization_id
    FROM lead_scoring_jobs
    WHERE ${DUE_SCORING_WHERE}
    `,
    maxAttempts,
  );
  return rows
    .map((row) => String(row.organization_id ?? "").trim())
    .filter((id) => id.length > 0);
}

export async function listDueScoringJobs(
  limit: number,
  maxAttempts: number,
  organizationId: string,
): Promise<ScoringJobRow[]> {
  const prisma = getPrismaClient();
  const rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
    `
    SELECT * FROM lead_scoring_jobs
    WHERE organization_id = $3::bigint
      AND (${DUE_SCORING_WHERE})
    ORDER BY updated_at ASC
    LIMIT $2
    `,
    maxAttempts,
    limit,
    organizationId,
  );
  return rows.map(mapRow);
}

/** Paginated scoring job history for the dedicated "Recent runs" page. */
export async function listScoringJobsPage(
  organizationId: string,
  opts: {
    limit?: number;
    offset?: number;
    status?: LeadScoringStatus | null;
    since: Date;
    until: Date;
  },
): Promise<{ rows: ScoringJobRow[]; total: number }> {
  const prisma = getPrismaClient();
  const limit = Math.min(100, Math.max(1, opts.limit ?? 25));
  const offset = Math.max(0, opts.offset ?? 0);
  const status = opts.status ?? null;

  const [rows, countRows] = await Promise.all([
    prisma.$queryRawUnsafe<Record<string, unknown>[]>(
      `
      SELECT * FROM lead_scoring_jobs
      WHERE organization_id = $1::bigint
        AND ($2::text IS NULL OR status = $2::"LeadScoringStatus")
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
      SELECT count(*)::bigint AS count FROM lead_scoring_jobs
      WHERE organization_id = $1::bigint
        AND ($2::text IS NULL OR status = $2::"LeadScoringStatus")
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

/** Scored leads eligible for nightly intent decay. */
export async function listScoredJobsForDecay(
  limit = 200,
): Promise<ScoringJobRow[]> {
  const prisma = getPrismaClient();
  const rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
    `
    SELECT * FROM lead_scoring_jobs
    WHERE status = 'scored'
      AND score IS NOT NULL
    ORDER BY completed_at ASC NULLS FIRST
    LIMIT $1
    `,
    limit,
  );
  return rows.map(mapRow);
}
