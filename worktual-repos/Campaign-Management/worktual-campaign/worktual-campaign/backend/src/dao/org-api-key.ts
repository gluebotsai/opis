// @ts-nocheck
import { createHash, randomBytes } from "node:crypto";
import { prisma } from "../plugins/prisma.js";
import type { CampaignSessionUser } from "../types/auth.js";
import { AppError } from "../helpers/response-builders.js";
import { env } from "../config/env.js";
import { toStableDbId } from "../helpers/id-schema.js";

export const ORG_API_KEY_PURPOSE_APP_PUSH = "app_push";
export const ORG_API_KEY_PREFIX = "wk_ap_";

function hashOrgApiKey(plain: string): string {
  const pepper = env.jwtSecret || "campaign-api-key-pepper";
  return createHash("sha256")
    .update(`${pepper}:${plain}`)
    .digest("hex");
}

function orgIdParam(organizationId: string): bigint {
  return BigInt(toStableDbId(organizationId));
}

export function generateOrgApiKeyPlain(): string {
  return `${ORG_API_KEY_PREFIX}${randomBytes(24).toString("base64url")}`;
}

export function orgApiKeyPrefix(plain: string): string {
  const s = String(plain || "").trim();
  if (s.length <= 16) return s;
  return `${s.slice(0, 12)}…${s.slice(-4)}`;
}

/** Resolve organization id from X-Api-Key (active app_push key). */
export async function resolveOrganizationIdFromApiKey(
  plainKey: string,
): Promise<string | null> {
  const trimmed = String(plainKey || "").trim();
  if (!trimmed.startsWith(ORG_API_KEY_PREFIX)) return null;
  const keyHash = hashOrgApiKey(trimmed);
  const row = await prisma.organizationApiKey.findFirst({
    where: {
      keyHash,
      active: true,
      purpose: ORG_API_KEY_PURPOSE_APP_PUSH,
    },
  });
  if (!row) return null;
  await prisma.organizationApiKey.update({
    where: { id: row.id },
    data: { lastUsedAt: new Date() },
  });
  return String(row.organizationId);
}

export async function getOrgApiKeyStatusDao(
  session: CampaignSessionUser,
  purpose = ORG_API_KEY_PURPOSE_APP_PUSH,
) {
  const organizationId = orgIdParam(session.organizationId);
  const row = await prisma.organizationApiKey.findUnique({
    where: {
      organizationId_purpose: { organizationId, purpose },
    },
  });
  if (!row || !row.active) {
    return {
      configured: false,
      purpose,
      key_prefix: null as string | null,
      created_at: null as string | null,
      last_used_at: null as string | null,
    };
  }
  return {
    configured: true,
    purpose: row.purpose,
    key_prefix: row.keyPrefix,
    created_at: row.createdAt.toISOString(),
    last_used_at: row.lastUsedAt?.toISOString() ?? null,
  };
}

/** Mint or rotate org integration key. Plain key returned once. */
export async function rotateOrgApiKeyDao(
  session: CampaignSessionUser,
  purpose = ORG_API_KEY_PURPOSE_APP_PUSH,
) {
  const organizationId = orgIdParam(session.organizationId);
  const plain = generateOrgApiKeyPlain();
  const keyHash = hashOrgApiKey(plain);
  const keyPrefix = orgApiKeyPrefix(plain);

  const row = await prisma.organizationApiKey.upsert({
    where: {
      organizationId_purpose: { organizationId, purpose },
    },
    create: {
      organizationId,
      purpose,
      keyHash,
      keyPrefix,
      active: true,
    },
    update: {
      keyHash,
      keyPrefix,
      active: true,
      lastUsedAt: null,
    },
  });

  return {
    id: String(row.id),
    purpose: row.purpose,
    api_key: plain,
    key_prefix: keyPrefix,
    message:
      "Copy this key now — it will not be shown again. Send it as X-Api-Key on POST /api/app-push/endpoints.",
  };
}

/** Internal onboarding: mint key for any organization id. */
export async function rotateOrgApiKeyForOrganizationDao(
  organizationId: string,
  purpose = ORG_API_KEY_PURPOSE_APP_PUSH,
) {
  const org = String(organizationId || "").trim();
  if (!org) throw new AppError("organizationId is required.", 400);
  const synthetic: CampaignSessionUser = {
    id: "internal",
    email: "internal@worktual.local",
    name: "Internal",
    role: "Admin",
    initials: "IN",
    organizationId: org,
    branchId: org,
    orgName: "",
    mode: "b2b",
    industry: "generic-b2b",
    businessType: "B2B",
    industryType: null,
  };
  return rotateOrgApiKeyDao(synthetic, purpose);
}
