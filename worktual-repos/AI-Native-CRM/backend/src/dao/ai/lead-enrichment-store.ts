/**
 * Lead enrichment job persistence via SQL so it works even when a long-lived
 * Next.js process still has a PrismaClient generated before LeadEnrichmentJob
 * existed (delegate missing). Uses $queryRaw / $executeRaw only.
 */

import { randomBytes } from "node:crypto";
import { getPrismaClient } from "@/dao/db/prisma";
import type { LeadEnrichmentStatus, Prisma } from "@prisma/client";

export type EnrichmentJobRow = {
  id: string;
  organizationId: string;
  contactId: string;
  companyId: string | null;
  status: LeadEnrichmentStatus;
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
  return `cej${randomBytes(12).toString("hex")}`;
}

function mapRow(r: Record<string, unknown>): EnrichmentJobRow {
  return {
    id: String(r.id),
    organizationId: String(r.organization_id),
    contactId: String(r.contact_id),
    companyId: r.company_id == null ? null : String(r.company_id),
    status: r.status as LeadEnrichmentStatus,
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

export async function upsertEnrichmentJob(input: {
  organizationId: string;
  contactId: string;
  companyId?: string | null;
  maxAttempts?: number;
}): Promise<EnrichmentJobRow> {
  const prisma = getPrismaClient();
  const id = cuidLike();
  const maxAttempts = input.maxAttempts ?? 5;
  const rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
    `
    INSERT INTO lead_enrichment_jobs (
      id, organization_id, contact_id, company_id, status, attempts, max_attempts,
      next_retry_at, last_error, result_summary, created_at, updated_at, completed_at
    ) VALUES (
      $1, $2::bigint, $3::text, $4, 'pending', 0, $5,
      NOW(), NULL, NULL, NOW(), NOW(), NULL
    )
    ON CONFLICT (organization_id, contact_id) DO UPDATE SET
      company_id = EXCLUDED.company_id,
      status = 'pending',
      next_retry_at = NOW(),
      last_error = NULL,
      completed_at = NULL,
      updated_at = NOW()
    RETURNING *
    `,
    id,
    input.organizationId,
    input.contactId,
    input.companyId ?? null,
    maxAttempts,
  );
  const job = mapRow(rows[0]!);
  await prisma.$executeRawUnsafe(
    `SELECT pg_notify('crm_lead_enrichment', $1::text)`,
    input.organizationId,
  );
  return job;
}

export async function findEnrichmentJobByOrgContact(
  organizationId: string,
  contactId: string,
): Promise<EnrichmentJobRow | null> {
  const prisma = getPrismaClient();
  const rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
    `
    SELECT * FROM lead_enrichment_jobs
    WHERE organization_id = $1::bigint AND contact_id = $2::text
    LIMIT 1
    `,
    organizationId,
    contactId,
  );
  return rows[0] ? mapRow(rows[0]) : null;
}

export async function findEnrichmentJobById(
  id: string,
): Promise<EnrichmentJobRow | null> {
  const prisma = getPrismaClient();
  const rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
    `
    SELECT * FROM lead_enrichment_jobs WHERE id = $1 LIMIT 1
    `,
    id,
  );
  return rows[0] ? mapRow(rows[0]) : null;
}

export async function claimEnrichmentJob(id: string): Promise<boolean> {
  const prisma = getPrismaClient();
  const rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
    `
    UPDATE lead_enrichment_jobs
    SET status = 'running', updated_at = NOW()
    WHERE id = $1 AND status IN ('pending', 'failed')
    RETURNING id
    `,
    id,
  );
  return rows.length > 0;
}

export async function updateEnrichmentJob(
  id: string,
  data: {
    status?: LeadEnrichmentStatus;
    attempts?: number;
    companyId?: string | null;
    lastError?: string | null;
    nextRetryAt?: Date | null;
    completedAt?: Date | null;
    resultSummary?: Prisma.InputJsonValue | null;
  },
): Promise<EnrichmentJobRow> {
  const prisma = getPrismaClient();
  const summaryJson =
    data.resultSummary === undefined
      ? null
      : JSON.stringify(data.resultSummary ?? null);

  const rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
    `
    UPDATE lead_enrichment_jobs SET
      status = CASE WHEN $2::text IS NULL THEN status ELSE $2::"LeadEnrichmentStatus" END,
      attempts = COALESCE($3, attempts),
      company_id = CASE WHEN $9::boolean THEN $4 ELSE company_id END,
      last_error = CASE WHEN $10::boolean THEN $5 ELSE last_error END,
      next_retry_at = CASE WHEN $11::boolean THEN $6 ELSE next_retry_at END,
      completed_at = CASE WHEN $12::boolean THEN $7 ELSE completed_at END,
      result_summary = CASE WHEN $13::boolean THEN $8::jsonb ELSE result_summary END,
      updated_at = NOW()
    WHERE id = $1
    RETURNING *
    `,
    id,
    data.status ?? null,
    data.attempts ?? null,
    data.companyId ?? null,
    data.lastError === undefined ? null : data.lastError,
    data.nextRetryAt === undefined ? null : data.nextRetryAt,
    data.completedAt === undefined ? null : data.completedAt,
    summaryJson,
    data.companyId !== undefined,
    data.lastError !== undefined,
    data.nextRetryAt !== undefined,
    data.completedAt !== undefined,
    data.resultSummary !== undefined,
  );
  if (!rows[0]) throw new Error("Enrichment job not found after update.");
  return mapRow(rows[0]);
}

const DUE_ENRICHMENT_WHERE = `
  (status = 'pending' AND (next_retry_at IS NULL OR next_retry_at <= NOW()))
  OR (
    status = 'failed'
    AND attempts < $1
    AND next_retry_at IS NOT NULL
    AND next_retry_at <= NOW()
  )
`;

/** Organizations that currently have a due enrichment job. */
export async function listDueEnrichmentOrganizationIds(
  maxAttempts: number,
): Promise<string[]> {
  const prisma = getPrismaClient();
  const rows = await prisma.$queryRawUnsafe<{ organization_id: unknown }[]>(
    `
    SELECT DISTINCT organization_id::text AS organization_id
    FROM lead_enrichment_jobs
    WHERE ${DUE_ENRICHMENT_WHERE}
    `,
    maxAttempts,
  );
  return rows
    .map((row) => String(row.organization_id ?? "").trim())
    .filter((id) => id.length > 0);
}

export async function listDueEnrichmentJobs(
  limit: number,
  maxAttempts: number,
  organizationId: string,
): Promise<EnrichmentJobRow[]> {
  const prisma = getPrismaClient();
  const rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
    `
    SELECT * FROM lead_enrichment_jobs
    WHERE organization_id = $3::bigint
      AND (${DUE_ENRICHMENT_WHERE})
    ORDER BY updated_at ASC
    LIMIT $2
    `,
    maxAttempts,
    limit,
    organizationId,
  );
  return rows.map(mapRow);
}

/** Most recent enrichment job runs for the Agents dashboard drill-down. */
/** Paginated enrichment job history for the dedicated "Recent runs" page. */
export async function listEnrichmentJobsPage(
  organizationId: string,
  opts: {
    limit?: number;
    offset?: number;
    status?: LeadEnrichmentStatus | null;
    since: Date;
    until: Date;
  },
): Promise<{ rows: EnrichmentJobRow[]; total: number }> {
  const prisma = getPrismaClient();
  const limit = Math.min(100, Math.max(1, opts.limit ?? 25));
  const offset = Math.max(0, opts.offset ?? 0);
  const status = opts.status ?? null;

  const [rows, countRows] = await Promise.all([
    prisma.$queryRawUnsafe<Record<string, unknown>[]>(
      `
      SELECT * FROM lead_enrichment_jobs
      WHERE organization_id = $1::bigint
        AND ($2::text IS NULL OR status = $2::"LeadEnrichmentStatus")
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
      SELECT count(*)::bigint AS count FROM lead_enrichment_jobs
      WHERE organization_id = $1::bigint
        AND ($2::text IS NULL OR status = $2::"LeadEnrichmentStatus")
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

/** Profiles with no enrichment job row (external insert missed trigger / legacy). */
export async function listContactProfilesMissingEnrichmentJob(limit: number): Promise<
  Array<{
    organizationId: string;
    contactId: string;
    companyId: string | null;
  }>
> {
  const prisma = getPrismaClient();
  const rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
    `
    SELECT
      p.organization_id,
      p.account_contact_id,
      p.company_id
    FROM contact_profiles p
    JOIN cdp.customer_profile cdp
      ON cdp.cdp_id::text = p.account_contact_id::text
    LEFT JOIN lead_enrichment_jobs j
      ON j.organization_id = p.organization_id
     AND j.contact_id = p.account_contact_id
    WHERE j.id IS NULL
      AND p.organization_id IS NOT NULL
      AND p.crm_status <> 'archived'
      AND lower(coalesce(cdp.contact_type, 'contact')) = 'lead'
      AND p.created_at >= NOW() - INTERVAL '30 days'
    ORDER BY p.created_at DESC
    LIMIT $1
    `,
    Math.min(500, Math.max(1, limit)),
  );
  return rows.map((r) => ({
    organizationId: String(r.organization_id),
    contactId: String(r.account_contact_id),
    companyId: r.company_id == null ? null : String(r.company_id),
  }));
}

/**
 * CDP customers (person identity) with no enrichment job — primary ingest path
 * when connectors write cdp.customer_profile without going through CRM HTTP.
 */
export async function listCdpCustomersMissingEnrichmentJob(limit: number): Promise<
  Array<{
    organizationId: string;
    contactId: string;
    acquisitionChannel: string | null;
  }>
> {
  const prisma = getPrismaClient();
  const rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
    `
    SELECT
      p.organization_id::text AS organization_id,
      p.cdp_id::text AS contact_id,
      NULLIF(BTRIM(p.acquisition_channel), '') AS acquisition_channel
    FROM cdp.customer_profile p
    LEFT JOIN lead_enrichment_jobs j
      ON j.organization_id = p.organization_id
     AND j.contact_id::text = p.cdp_id::text
    WHERE j.id IS NULL
      AND p.organization_id IS NOT NULL
      AND lower(coalesce(p.contact_type, 'contact')) = 'lead'
      AND p.created_at >= NOW() - INTERVAL '30 days'
    ORDER BY p.created_at DESC
    LIMIT $1
    `,
    Math.min(500, Math.max(1, limit)),
  );
  return rows.map((r) => ({
    organizationId: String(r.organization_id),
    contactId: String(r.contact_id),
    acquisitionChannel:
      r.acquisition_channel == null ? null : String(r.acquisition_channel),
  }));
}
