/**
 * Domain enrichment cache (30-day TTL) — CRM-owned, avoids repeat scrapes.
 */

import { randomBytes } from "node:crypto";
import { getPrismaClient } from "@/dao/db/prisma";
import type { Prisma } from "@prisma/client";
import { isFreeMailDomain } from "@/service/ai/lead-enrichment-types";

const TTL_MS = 30 * 24 * 60 * 60_000;

export type DomainCacheRow = {
  id: string;
  organizationId: string;
  domain: string;
  payload: Prisma.JsonValue;
  source: string | null;
  expiresAt: Date;
};

function cuidLike(): string {
  return `dec_${randomBytes(12).toString("hex")}`;
}

export function normalizeEnrichmentDomain(raw: string | null | undefined): string | null {
  if (!raw?.trim()) return null;
  const d = raw
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split("/")[0]
    ?.split("@")
    .pop();
  return d || null;
}

export async function getDomainEnrichmentCache(
  organizationId: string,
  domain: string,
): Promise<DomainCacheRow | null> {
  const normalized = normalizeEnrichmentDomain(domain);
  if (!normalized || isFreeMailDomain(normalized)) return null;
  const prisma = getPrismaClient();
  const rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
    `
    SELECT * FROM domain_enrichment_cache
    WHERE organization_id = $1::bigint
      AND domain = $2
      AND expires_at > NOW()
    LIMIT 1
    `,
    organizationId,
    normalized,
  );
  const r = rows[0];
  if (!r) return null;
  return {
    id: String(r.id),
    organizationId: String(r.organization_id),
    domain: String(r.domain),
    payload: r.payload as Prisma.JsonValue,
    source: r.source == null ? null : String(r.source),
    expiresAt: new Date(String(r.expires_at)),
  };
}

export async function upsertDomainEnrichmentCache(input: {
  organizationId: string;
  domain: string;
  payload: Prisma.InputJsonValue;
  source?: string | null;
  ttlMs?: number;
}): Promise<DomainCacheRow | null> {
  const normalized = normalizeEnrichmentDomain(input.domain);
  if (!normalized || isFreeMailDomain(normalized)) return null;
  const prisma = getPrismaClient();
  const id = cuidLike();
  const ttl = input.ttlMs ?? TTL_MS;
  const expiresAt = new Date(Date.now() + ttl);
  const payloadJson = JSON.stringify(input.payload ?? {});
  const rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
    `
    INSERT INTO domain_enrichment_cache (
      id, organization_id, domain, payload, source, expires_at, created_at, updated_at
    ) VALUES (
      $1, $2::bigint, $3, $4::jsonb, $5, $6, NOW(), NOW()
    )
    ON CONFLICT (organization_id, domain) DO UPDATE SET
      payload = EXCLUDED.payload,
      source = EXCLUDED.source,
      expires_at = EXCLUDED.expires_at,
      updated_at = NOW()
    RETURNING *
    `,
    id,
    input.organizationId,
    normalized,
    payloadJson,
    input.source ?? null,
    expiresAt,
  );
  const r = rows[0];
  if (!r) return null;
  return {
    id: String(r.id),
    organizationId: String(r.organization_id),
    domain: String(r.domain),
    payload: r.payload as Prisma.JsonValue,
    source: r.source == null ? null : String(r.source),
    expiresAt: new Date(String(r.expires_at)),
  };
}
