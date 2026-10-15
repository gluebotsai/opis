/**
 * Lead enrichment snapshot — seniority, domain type, conflicts (CRM-owned).
 */

import { randomBytes } from "node:crypto";
import { getPrismaClient } from "@/dao/db/prisma";
import type { Prisma } from "@prisma/client";

export type EnrichmentSnapshotInput = {
  organizationId: string;
  contactId: string;
  companyName?: string | null;
  companySize?: string | null;
  industry?: string | null;
  companyDescription?: string | null;
  products?: string | null;
  revenueBand?: string | null;
  seniorityTier?: string | null;
  geography?: string | null;
  emailDomainType?: string | null;
  enrichmentConfidence?: number | null;
  enrichmentSource?: string | null;
  conflictFlags?: Prisma.InputJsonValue | null;
};

function cuidLike(): string {
  return `les_${randomBytes(12).toString("hex")}`;
}

export async function upsertLeadEnrichmentSnapshot(
  input: EnrichmentSnapshotInput,
): Promise<void> {
  const prisma = getPrismaClient();
  const id = cuidLike();
  const flagsJson =
    input.conflictFlags == null
      ? null
      : JSON.stringify(input.conflictFlags);
  await prisma.$executeRawUnsafe(
    `
    INSERT INTO lead_enrichment_snapshots (
      id, organization_id, contact_id,
      company_name, company_size, industry, company_description, products,
      revenue_band, seniority_tier, geography, email_domain_type,
      enrichment_confidence, enrichment_source, conflict_flags,
      enrichment_timestamp, created_at, updated_at
    ) VALUES (
      $1, $2::bigint, $3::text,
      $4, $5, $6, $7, $8,
      $9, $10, $11, $12,
      $13, $14, $15::jsonb,
      NOW(), NOW(), NOW()
    )
    ON CONFLICT (organization_id, contact_id) DO UPDATE SET
      company_name = COALESCE(EXCLUDED.company_name, lead_enrichment_snapshots.company_name),
      company_size = COALESCE(EXCLUDED.company_size, lead_enrichment_snapshots.company_size),
      industry = COALESCE(EXCLUDED.industry, lead_enrichment_snapshots.industry),
      company_description = COALESCE(EXCLUDED.company_description, lead_enrichment_snapshots.company_description),
      products = COALESCE(EXCLUDED.products, lead_enrichment_snapshots.products),
      revenue_band = COALESCE(EXCLUDED.revenue_band, lead_enrichment_snapshots.revenue_band),
      seniority_tier = COALESCE(EXCLUDED.seniority_tier, lead_enrichment_snapshots.seniority_tier),
      geography = COALESCE(EXCLUDED.geography, lead_enrichment_snapshots.geography),
      email_domain_type = COALESCE(EXCLUDED.email_domain_type, lead_enrichment_snapshots.email_domain_type),
      enrichment_confidence = COALESCE(EXCLUDED.enrichment_confidence, lead_enrichment_snapshots.enrichment_confidence),
      enrichment_source = COALESCE(EXCLUDED.enrichment_source, lead_enrichment_snapshots.enrichment_source),
      conflict_flags = COALESCE(EXCLUDED.conflict_flags, lead_enrichment_snapshots.conflict_flags),
      enrichment_timestamp = NOW(),
      updated_at = NOW()
    `,
    id,
    input.organizationId,
    input.contactId,
    input.companyName ?? null,
    input.companySize ?? null,
    input.industry ?? null,
    input.companyDescription ?? null,
    input.products ?? null,
    input.revenueBand ?? null,
    input.seniorityTier ?? null,
    input.geography ?? null,
    input.emailDomainType ?? null,
    input.enrichmentConfidence ?? null,
    input.enrichmentSource ?? null,
    flagsJson,
  );
}

export async function findLeadEnrichmentSnapshot(
  organizationId: string,
  contactId: string,
): Promise<Record<string, unknown> | null> {
  const prisma = getPrismaClient();
  const rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
    `
    SELECT * FROM lead_enrichment_snapshots
    WHERE organization_id = $1::bigint AND contact_id = $2::text
    LIMIT 1
    `,
    organizationId,
    contactId,
  );
  return rows[0] ?? null;
}
