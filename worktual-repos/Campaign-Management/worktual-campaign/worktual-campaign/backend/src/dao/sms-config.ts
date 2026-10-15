// @ts-nocheck — worktual_bigint Prisma BigInt ids; runtime coerced to string in plugins/prisma.ts
import { prisma } from "../plugins/prisma.js";
import type { CampaignSessionUser } from "../types/auth.js";
import type { Prisma } from "@prisma/client";

const SMS_FIELDS = [
  "provider",
  "sender_id",
  "entity_id",
  "api_key",
  "base_url",
] as const;

const SECRET_KEYS = new Set(["api_key"]);

function asRecord(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (v == null) continue;
    out[k] = String(v).trim();
  }
  return out;
}

function maskSecret(value: string): string {
  if (!value) return "";
  if (value.length <= 8) return "••••••••";
  return `${"•".repeat(8)}${value.slice(-4)}`;
}

export function computeSmsChecklist(s: Record<string, string>) {
  return {
    provider: Boolean(s.provider),
    sender_id: Boolean(s.sender_id),
    entity_id: Boolean(s.entity_id),
    api_key: Boolean(s.api_key),
  };
}

export function smsStatusFromChecklist(
  s: Record<string, string>,
): "not_started" | "in_progress" | "ready" {
  const c = computeSmsChecklist(s);
  // Ready when sender + provider set; api_key optional if stub provider
  const provider = (s.provider || "stub").toLowerCase();
  if (provider === "stub") {
    if (c.sender_id) return "ready";
    if (c.provider || c.sender_id || c.entity_id) return "in_progress";
    return "not_started";
  }
  const vals = [c.provider, c.sender_id, c.api_key];
  if (vals.every(Boolean)) return "ready";
  if (vals.some(Boolean) || c.entity_id) return "in_progress";
  return "not_started";
}

function publicSettings(raw: Record<string, string>) {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    out[k] = SECRET_KEYS.has(k) ? (v ? maskSecret(v) : "") : v;
  }
  return out;
}

export async function getCampaignSmsStatusDao(
  organizationId: string,
): Promise<"not_started" | "in_progress" | "ready" | "blocked"> {
  try {
    const row = await prisma.smsChannelSettings.findUnique({
      where: { organizationId },
    });
    if (!row) return "not_started";
    const status = String(row.status).toLowerCase();
    if (
      status === "ready" ||
      status === "in_progress" ||
      status === "blocked" ||
      status === "not_started"
    ) {
      return status as "not_started" | "in_progress" | "ready" | "blocked";
    }
    return smsStatusFromChecklist(asRecord(row.settings));
  } catch (err) {
    // Table may not exist until migrate deploy
    const code =
      err && typeof err === "object" && "code" in err
        ? String((err as { code: unknown }).code)
        : "";
    if (code === "P2021" || code === "P2022") return "not_started";
    throw err;
  }
}

export async function getSmsSettingsRawDao(organizationId: string) {
  const row = await prisma.smsChannelSettings.findUnique({
    where: { organizationId },
  });
  const settings = asRecord(row?.settings);
  return {
    settings,
    status: row
      ? smsStatusFromChecklist(settings)
      : ("not_started" as const),
  };
}

export async function getSmsConfigBundleDao(session: CampaignSessionUser) {
  const row = await prisma.smsChannelSettings.findUnique({
    where: { organizationId: session.organizationId },
  });
  const settings = asRecord(row?.settings);
  const status = row
    ? smsStatusFromChecklist(settings)
    : ("not_started" as const);
  return {
    channel: "sms" as const,
    label: "SMS",
    read_only: false,
    source: "campaign_db",
    status,
    checklist: computeSmsChecklist(settings),
    fields: [...SMS_FIELDS],
    settings: publicSettings(settings),
    secrets_set: Object.fromEntries(
      [...SECRET_KEYS].map((k) => [k, Boolean(settings[k])]),
    ),
    updated_at: row?.updatedAt?.toISOString() ?? null,
  };
}

export async function saveSmsConfigDao(
  session: CampaignSessionUser,
  input: Record<string, unknown>,
) {
  const allowed = new Set<string>(SMS_FIELDS);
  const existing = await prisma.smsChannelSettings.findUnique({
    where: { organizationId: session.organizationId },
  });
  const prev = asRecord(existing?.settings);
  const next: Record<string, string> = { ...prev };

  for (const [k, v] of Object.entries(input)) {
    if (!allowed.has(k)) continue;
    const str = v == null ? "" : String(v).trim();
    if (SECRET_KEYS.has(k)) {
      // Keep previous secret if FE sent masked placeholder
      if (!str || str.includes("•")) continue;
    }
    next[k] = str;
  }
  if (!next.provider) next.provider = "stub";

  const status = smsStatusFromChecklist(next);
  await prisma.smsChannelSettings.upsert({
    where: { organizationId: session.organizationId },
    create: {
      organizationId: session.organizationId,
      settings: next as Prisma.InputJsonValue,
      status,
    },
    update: {
      settings: next as Prisma.InputJsonValue,
      status,
    },
  });

  return getSmsConfigBundleDao(session);
}

export async function assertSmsReadyToSend(organizationId: string) {
  const { settings, status } = await getSmsSettingsRawDao(organizationId);
  if (status !== "ready") {
    const { AppError } = await import("../helpers/response-builders.js");
    throw new AppError(
      "SMS is not configured. Open Configuration → SMS and set sender ID (and provider) before sending.",
      400,
      "SMS_NOT_CONFIGURED",
    );
  }
  return settings;
}
