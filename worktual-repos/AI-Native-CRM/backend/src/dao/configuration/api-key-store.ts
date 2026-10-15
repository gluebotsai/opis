import { createHash, randomBytes } from "crypto";
import { prisma } from "@/dao/db/prisma";
import {
  normalizeApiKeyScopes,
  type ApiKeyScope,
} from "@/lib/api-key-scopes";

export type ApiKeyRow = {
  id: string;
  organizationId: string;
  name: string;
  keyPrefix: string;
  scopes: string[];
  createdByUserId: string;
  createdAt: Date;
  revokedAt: Date | null;
  lastUsedAt: Date | null;
};

export type ResolvedApiKey = {
  id: string;
  organizationId: string;
  scopes: ApiKeyScope[];
  createdByUserId: string;
};

function hashSecret(secret: string): string {
  return createHash("sha256").update(secret, "utf8").digest("hex");
}

/** crm_live_<12 hex>_<32 hex secret> */
export function generateApiKeySecret(): {
  secret: string;
  prefix: string;
  hash: string;
} {
  const prefixRand = randomBytes(6).toString("hex");
  const secretRand = randomBytes(24).toString("hex");
  const prefix = `crm_live_${prefixRand}`;
  const secret = `${prefix}_${secretRand}`;
  return { secret, prefix, hash: hashSecret(secret) };
}

export function hashApiKeySecret(secret: string): string {
  return hashSecret(secret.trim());
}

export async function listApiKeysForOrg(
  organizationId: string,
): Promise<ApiKeyRow[]> {
  const rows = await prisma.apiKey.findMany({
    where: { organizationId, revokedAt: null },
    orderBy: { createdAt: "desc" },
  });
  return rows.map((r) => ({
    id: r.id,
    organizationId: r.organizationId,
    name: r.name,
    keyPrefix: r.keyPrefix,
    scopes: r.scopes,
    createdByUserId: r.createdByUserId,
    createdAt: r.createdAt,
    revokedAt: r.revokedAt,
    lastUsedAt: r.lastUsedAt,
  }));
}

export async function createApiKey(input: {
  organizationId: string;
  name: string;
  scopes: ApiKeyScope[];
  createdByUserId: string;
}): Promise<{ row: ApiKeyRow; secret: string }> {
  const name = input.name.trim().slice(0, 120);
  if (!name) throw new Error("Name is required.");
  const scopes = normalizeApiKeyScopes(input.scopes);
  if (scopes.length === 0) {
    throw new Error("Select at least one scope.");
  }
  const { secret, prefix, hash } = generateApiKeySecret();
  const row = await prisma.apiKey.create({
    data: {
      organizationId: input.organizationId,
      name,
      keyPrefix: prefix,
      keyHash: hash,
      scopes,
      createdByUserId: input.createdByUserId,
    },
  });
  return {
    secret,
    row: {
      id: row.id,
      organizationId: row.organizationId,
      name: row.name,
      keyPrefix: row.keyPrefix,
      scopes: row.scopes,
      createdByUserId: row.createdByUserId,
      createdAt: row.createdAt,
      revokedAt: row.revokedAt,
      lastUsedAt: row.lastUsedAt,
    },
  };
}

export async function revokeApiKey(input: {
  organizationId: string;
  id: string;
}): Promise<boolean> {
  const result = await prisma.apiKey.updateMany({
    where: {
      id: input.id,
      organizationId: input.organizationId,
      revokedAt: null,
    },
    data: { revokedAt: new Date() },
  });
  return result.count > 0;
}

export async function resolveApiKeyBySecret(
  secret: string,
): Promise<ResolvedApiKey | null> {
  const trimmed = secret.trim();
  if (!trimmed.startsWith("crm_live_") && !trimmed.startsWith("crm_test_")) {
    return null;
  }
  const hash = hashApiKeySecret(trimmed);
  const row = await prisma.apiKey.findFirst({
    where: { keyHash: hash, revokedAt: null },
  });
  if (!row) return null;
  return {
    id: row.id,
    organizationId: row.organizationId,
    scopes: normalizeApiKeyScopes(row.scopes),
    createdByUserId: row.createdByUserId,
  };
}

export async function touchApiKeyLastUsed(id: string): Promise<void> {
  await prisma.apiKey
    .update({
      where: { id },
      data: { lastUsedAt: new Date() },
    })
    .catch(() => undefined);
}
