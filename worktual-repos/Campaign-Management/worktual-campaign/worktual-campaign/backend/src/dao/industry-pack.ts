// @ts-nocheck — worktual_bigint Prisma BigInt ids; runtime coerced to string in plugins/prisma.ts
/**
 * Per-tenant industry pack — get-or-seed, rules/fields CRUD, learn-from-custom-fields.
 */

import { prisma } from "../plugins/prisma.js";
import type { CampaignSessionUser } from "../types/auth.js";
import {
  buildSeedPayload,
  newRuleId,
  normalizePayload,
  slugFieldKey,
  type IndustryPackPayload,
  type PackField,
  type PackRule,
} from "../helpers/industry-pack-seed.js";

export type PublicIndustryPack = {
  organizationId: string;
  packId: string;
  seedIndustryType: string;
  payload: IndustryPackPayload;
  createdAt: string;
  updatedAt: string;
};

function toPublic(row: {
  organizationId: string;
  packId: string;
  seedIndustryType: string;
  payload: unknown;
  createdAt: Date;
  updatedAt: Date;
}): PublicIndustryPack {
  return {
    organizationId: String(row.organizationId),
    packId: row.packId,
    seedIndustryType: row.seedIndustryType,
    payload: normalizePayload(row.payload),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function packIdForMode(mode: "b2b" | "b2c"): string {
  return mode === "b2c" ? "generic-b2c" : "generic-b2b";
}

async function savePayload(
  session: CampaignSessionUser,
  payload: IndustryPackPayload,
): Promise<PublicIndustryPack> {
  const row = await prisma.tenantIndustryPack.update({
    where: { organizationId: session.organizationId },
    data: {
      payload,
      seedIndustryType: payload.seedIndustryType,
      packId: packIdForMode(payload.mode),
    },
  });
  return toPublic(row);
}

/** Get existing pack or seed from session mode + industryType. */
export async function getOrSeedIndustryPackDao(
  session: CampaignSessionUser,
): Promise<PublicIndustryPack> {
  const existing = await prisma.tenantIndustryPack.findUnique({
    where: { organizationId: session.organizationId },
  });
  if (existing) return toPublic(existing);

  const mode = session.mode === "b2c" ? "b2c" : "b2b";
  const seed = buildSeedPayload({
    mode,
    industryType: session.industryType,
  });
  const created = await prisma.tenantIndustryPack.create({
    data: {
      organizationId: session.organizationId,
      packId: packIdForMode(mode),
      seedIndustryType: seed.seedIndustryType,
      payload: seed,
    },
  });
  return toPublic(created);
}

export async function addPackRuleDao(
  session: CampaignSessionUser,
  input: { text: string; source?: "user" | "agent" },
): Promise<PublicIndustryPack> {
  const pack = await getOrSeedIndustryPackDao(session);
  const text = String(input.text || "").trim();
  if (!text) throw new Error("Rule text is required");
  const rule: PackRule = {
    id: newRuleId(),
    text: text.slice(0, 1000),
    source: input.source === "agent" ? "agent" : "user",
    createdAt: new Date().toISOString(),
  };
  const payload: IndustryPackPayload = {
    ...pack.payload,
    rules: [...pack.payload.rules, rule],
  };
  return savePayload(session, payload);
}

export async function updatePackRuleDao(
  session: CampaignSessionUser,
  ruleId: string,
  input: { text: string },
): Promise<PublicIndustryPack | null> {
  const pack = await getOrSeedIndustryPackDao(session);
  const id = String(ruleId || "").trim();
  const text = String(input.text || "").trim().slice(0, 1000);
  if (!id || !text) return null;
  let found = false;
  const rules = pack.payload.rules.map((r) => {
    if (r.id !== id) return r;
    found = true;
    return { ...r, text, updatedAt: new Date().toISOString() };
  });
  if (!found) return null;
  return savePayload(session, { ...pack.payload, rules });
}

export async function deletePackRuleDao(
  session: CampaignSessionUser,
  ruleId: string,
): Promise<PublicIndustryPack | null> {
  const pack = await getOrSeedIndustryPackDao(session);
  const id = String(ruleId || "").trim();
  const before = pack.payload.rules.length;
  const rules = pack.payload.rules.filter((r) => r.id !== id);
  if (rules.length === before) return null;
  return savePayload(session, { ...pack.payload, rules });
}

export async function upsertPackFieldDao(
  session: CampaignSessionUser,
  input: {
    key: string;
    label?: string;
    type?: "string" | "number";
    ask?: "optional" | "recommended";
    status?: "active" | "suggested";
    source?: "user" | "learned" | "seed";
  },
): Promise<PublicIndustryPack> {
  const pack = await getOrSeedIndustryPackDao(session);
  const key = slugFieldKey(input.key);
  if (!key) throw new Error("Field key is required");
  const fields = [...pack.payload.fields];
  const idx = fields.findIndex((f) => f.key === key);
  const next: PackField = {
    key,
    label:
      String(input.label || fields[idx]?.label || key.replace(/_/g, " ")).trim() ||
      key,
    type: input.type === "number" || fields[idx]?.type === "number" ? "number" : "string",
    ask:
      input.ask === "recommended" || fields[idx]?.ask === "recommended"
        ? "recommended"
        : "optional",
    source: input.source || fields[idx]?.source || "user",
    status: input.status || fields[idx]?.status || "active",
  };
  if (idx >= 0) fields[idx] = { ...fields[idx], ...next };
  else fields.push(next);
  return savePayload(session, { ...pack.payload, fields });
}

export async function updatePackFieldDao(
  session: CampaignSessionUser,
  keyRaw: string,
  input: {
    label?: string;
    type?: "string" | "number";
    ask?: "optional" | "recommended";
    status?: "active" | "suggested";
  },
): Promise<PublicIndustryPack | null> {
  const pack = await getOrSeedIndustryPackDao(session);
  const key = slugFieldKey(keyRaw);
  const idx = pack.payload.fields.findIndex((f) => f.key === key);
  if (idx < 0) return null;
  const prev = pack.payload.fields[idx];
  const fields = [...pack.payload.fields];
  fields[idx] = {
    ...prev,
    ...(input.label != null
      ? { label: String(input.label).trim() || prev.label }
      : {}),
    ...(input.type ? { type: input.type } : {}),
    ...(input.ask ? { ask: input.ask } : {}),
    ...(input.status ? { status: input.status } : {}),
  };
  return savePayload(session, { ...pack.payload, fields });
}

export async function deletePackFieldDao(
  session: CampaignSessionUser,
  keyRaw: string,
): Promise<PublicIndustryPack | null> {
  const pack = await getOrSeedIndustryPackDao(session);
  const key = slugFieldKey(keyRaw);
  const before = pack.payload.fields.length;
  const fields = pack.payload.fields.filter((f) => f.key !== key);
  if (fields.length === before) return null;
  return savePayload(session, { ...pack.payload, fields });
}

/**
 * Soft-learn volunteered custom_fields keys as suggested pack fields.
 * Never auto-activates — user/agent must confirm.
 */
export async function learnPackFieldsDao(
  session: CampaignSessionUser,
  customFields: Record<string, unknown> | null | undefined,
): Promise<{ pack: PublicIndustryPack; suggested: string[] }> {
  const pack = await getOrSeedIndustryPackDao(session);
  if (!customFields || typeof customFields !== "object") {
    return { pack, suggested: [] };
  }
  const fields = [...pack.payload.fields];
  const suggested: string[] = [];
  for (const [rawKey, value] of Object.entries(customFields)) {
    const key = slugFieldKey(rawKey);
    if (!key || value == null || value === "") continue;
    const existing = fields.find((f) => f.key === key);
    if (existing) continue;
    const asNum =
      typeof value === "number" ||
      (typeof value === "string" && value.trim() !== "" && !Number.isNaN(Number(value)));
    fields.push({
      key,
      label: key.replace(/_/g, " "),
      type: asNum ? "number" : "string",
      ask: "optional",
      source: "learned",
      status: "suggested",
    });
    suggested.push(key);
  }
  if (!suggested.length) return { pack, suggested: [] };
  const next = await savePayload(session, { ...pack.payload, fields });
  return { pack: next, suggested };
}
