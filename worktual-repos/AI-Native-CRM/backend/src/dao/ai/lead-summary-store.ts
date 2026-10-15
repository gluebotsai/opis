/**
 * Lead summary persistence via raw SQL so it works even when a long-lived
 * Next.js dev process holds a PrismaClient generated before LeadSummary existed.
 * Uses $queryRawUnsafe / $executeRawUnsafe only.
 */

import { randomBytes } from "node:crypto";
import { getPrismaClient } from "@/dao/db/prisma";

export type LeadSummaryRow = {
  id: string;
  organizationId: string;
  contactId: string;
  summary: string;
  headline: string | null;
  intent: string | null;
  recommendedAction: string | null;
  flags: unknown;
  signature: string;
  source: string;
  model: string | null;
  createdAt: Date;
  updatedAt: Date;
};

function cuidLike(): string {
  return `ls_${randomBytes(12).toString("hex")}`;
}

function mapRow(r: Record<string, unknown>): LeadSummaryRow {
  return {
    id: String(r.id),
    organizationId: String(r.organization_id),
    contactId: String(r.contact_id),
    summary: String(r.summary ?? ""),
    headline: r.headline == null ? null : String(r.headline),
    intent: r.intent == null ? null : String(r.intent),
    recommendedAction:
      r.recommended_action == null ? null : String(r.recommended_action),
    flags: r.flags ?? null,
    signature: String(r.signature ?? ""),
    source: String(r.source ?? "ai"),
    model: r.model == null ? null : String(r.model),
    createdAt: new Date(String(r.created_at)),
    updatedAt: new Date(String(r.updated_at)),
  };
}

export async function findLeadSummary(
  organizationId: string,
  contactId: string,
): Promise<LeadSummaryRow | null> {
  const prisma = getPrismaClient();
  const rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
    `
    SELECT * FROM lead_summaries
    WHERE organization_id = $1::bigint AND contact_id = $2::text
    LIMIT 1
    `,
    organizationId,
    contactId,
  );
  return rows[0] ? mapRow(rows[0]) : null;
}

export async function upsertLeadSummary(input: {
  organizationId: string;
  contactId: string;
  summary: string;
  headline: string | null;
  intent: string | null;
  recommendedAction?: string | null;
  flags?: unknown;
  signature: string;
  source: string;
  model: string | null;
}): Promise<LeadSummaryRow> {
  const prisma = getPrismaClient();
  const id = cuidLike();
  const flagsJson =
    input.flags === undefined || input.flags === null
      ? null
      : JSON.stringify(input.flags);
  const rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
    `
    INSERT INTO lead_summaries (
      id, organization_id, contact_id, summary, headline, intent,
      recommended_action, flags,
      signature, source, model, created_at, updated_at
    ) VALUES (
      $1, $2::bigint, $3::text, $4, $5, $6,
      $7, $8::jsonb,
      $9, $10, $11, NOW(), NOW()
    )
    ON CONFLICT (organization_id, contact_id) DO UPDATE SET
      summary = EXCLUDED.summary,
      headline = EXCLUDED.headline,
      intent = EXCLUDED.intent,
      recommended_action = COALESCE(EXCLUDED.recommended_action, lead_summaries.recommended_action),
      flags = COALESCE(EXCLUDED.flags, lead_summaries.flags),
      signature = EXCLUDED.signature,
      source = EXCLUDED.source,
      model = EXCLUDED.model,
      updated_at = NOW()
    RETURNING *
    `,
    id,
    input.organizationId,
    input.contactId,
    input.summary,
    input.headline,
    input.intent,
    input.recommendedAction ?? null,
    flagsJson,
    input.signature,
    input.source,
    input.model,
  );
  return mapRow(rows[0]!);
}
