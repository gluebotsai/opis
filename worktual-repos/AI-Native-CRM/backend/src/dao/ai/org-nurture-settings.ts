/**
 * Per-org lead nurture settings (CRM DB) — raw SQL for stale Prisma clients.
 */
import { randomBytes } from "node:crypto";
import { getPrismaClient } from "@/dao/db/prisma";

export type OrgNurtureSettingsView = {
  organizationId: string;
  nurtureCallEnabled: boolean;
  nurtureCallDelayMinutes: number;
  ccCoreVoiceConfigured: boolean;
  updatedAt: string;
  updatedByUserId: string | null;
};

export type PatchOrgNurtureSettingsInput = {
  nurtureCallEnabled?: boolean;
  nurtureCallDelayMinutes?: number;
};

const DEFAULT_DELAY_MINUTES = 15;
const MIN_DELAY_MINUTES = 1;
const MAX_DELAY_MINUTES = 7 * 24 * 60;

function ccCoreVoiceConfigured(): boolean {
  const base = process.env.CC_CORE_API_BASE_URL?.trim();
  const key = process.env.CC_CORE_INTERNAL_SERVICE_KEY?.trim();
  return Boolean(base && key);
}

function clampDelayMinutes(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_DELAY_MINUTES;
  return Math.max(
    MIN_DELAY_MINUTES,
    Math.min(MAX_DELAY_MINUTES, Math.round(value)),
  );
}

function cuidLike(): string {
  return `ons_${randomBytes(12).toString("hex")}`;
}

function mapRow(r: Record<string, unknown>): Omit<OrgNurtureSettingsView, "ccCoreVoiceConfigured"> {
  return {
    organizationId: String(r.organization_id),
    nurtureCallEnabled: Boolean(r.nurture_call_enabled),
    nurtureCallDelayMinutes: Number(r.nurture_call_delay_minutes ?? DEFAULT_DELAY_MINUTES),
    updatedAt: new Date(String(r.updated_at)).toISOString(),
    updatedByUserId:
      r.updated_by_user_id == null ? null : String(r.updated_by_user_id),
  };
}

async function selectRow(
  organizationId: string,
): Promise<Omit<OrgNurtureSettingsView, "ccCoreVoiceConfigured"> | null> {
  const prisma = getPrismaClient();
  const rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
    `
    SELECT
      organization_id,
      nurture_call_enabled,
      nurture_call_delay_minutes,
      updated_at,
      updated_by_user_id
    FROM org_nurture_settings
    WHERE organization_id = $1::bigint
    LIMIT 1
    `,
    organizationId,
  );
  const row = rows[0];
  return row ? mapRow(row) : null;
}

function toView(
  row: Omit<OrgNurtureSettingsView, "ccCoreVoiceConfigured">,
): OrgNurtureSettingsView {
  return { ...row, ccCoreVoiceConfigured: ccCoreVoiceConfigured() };
}

export async function getOrCreateOrgNurtureSettings(
  organizationId: string,
): Promise<OrgNurtureSettingsView> {
  const existing = await selectRow(organizationId);
  if (existing) return toView(existing);

  const prisma = getPrismaClient();
  const id = cuidLike();
  await prisma.$executeRawUnsafe(
    `
    INSERT INTO org_nurture_settings (
      id, organization_id, nurture_call_enabled, nurture_call_delay_minutes,
      updated_by_user_id, created_at, updated_at
    ) VALUES (
      $1, $2::bigint, false, $3, NULL, NOW(), NOW()
    )
    ON CONFLICT (organization_id) DO NOTHING
    `,
    id,
    organizationId,
    DEFAULT_DELAY_MINUTES,
  );

  const created = await selectRow(organizationId);
  if (!created) {
    throw new Error("Failed to initialize org nurture settings.");
  }
  return toView(created);
}

export async function updateOrgNurtureSettings(
  organizationId: string,
  input: PatchOrgNurtureSettingsInput,
  updatedByUserId: string | null,
): Promise<OrgNurtureSettingsView> {
  await getOrCreateOrgNurtureSettings(organizationId);

  const sets: string[] = ["updated_at = NOW()"];
  const params: unknown[] = [];
  let idx = 1;

  if (input.nurtureCallEnabled !== undefined) {
    sets.push(`nurture_call_enabled = $${idx++}`);
    params.push(input.nurtureCallEnabled);
  }
  if (input.nurtureCallDelayMinutes !== undefined) {
    sets.push(`nurture_call_delay_minutes = $${idx++}`);
    params.push(clampDelayMinutes(input.nurtureCallDelayMinutes));
  }
  sets.push(`updated_by_user_id = $${idx++}`);
  params.push(updatedByUserId ? BigInt(updatedByUserId) : null);
  params.push(organizationId);

  const prisma = getPrismaClient();
  await prisma.$executeRawUnsafe(
    `
    UPDATE org_nurture_settings
    SET ${sets.join(", ")}
    WHERE organization_id = $${idx}::bigint
    `,
    ...params,
  );

  const updated = await selectRow(organizationId);
  if (!updated) {
    throw new Error("Failed to load org nurture settings after update.");
  }
  return toView(updated);
}

export { ccCoreVoiceConfigured };
