import { z } from "zod";

import type { DbClient } from "../lib/rls.js";

export const ROUTING_TYPE_LONG_WAIT = 1;
export const ROUTING_TYPE_STICKY = 2;
export const ROUTING_TYPE_SKILL = 3;
export const DEFAULT_ROUTING_TYPE_ID = ROUTING_TYPE_SKILL;
export const DEFAULT_LONG_WAIT_SECONDS = 300;

export const upsertOrganizationRoutingProfileSchema = z
  .object({
    routingTypeId: z.coerce.number().int().min(1).max(3),
    longWaitSeconds: z.coerce.number().int().min(1).max(86_400).nullable().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.routingTypeId === ROUTING_TYPE_LONG_WAIT && value.longWaitSeconds == null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "longWaitSeconds is required for long wait time based routing",
        path: ["longWaitSeconds"],
      });
    }
  });

function parseConsentPromptId(value: unknown): string | null {
  if (value == null || value === "") return null;
  return String(value);
}

export const upsertOrganizationRecordingSchema = z
  .object({
    recordingEnabled: z.boolean(),
    inboundEnabled: z.boolean().optional().default(true),
    outboundEnabled: z.boolean().optional().default(true),
    consentNoticeEnabled: z.boolean().optional().default(false),
    consentPromptId: z
      .union([z.string(), z.number()])
      .nullable()
      .optional()
      .transform(parseConsentPromptId),
    agentAccessEnabled: z.boolean().optional().default(false),
  })
  .superRefine((value, ctx) => {
    if (value.recordingEnabled && !value.inboundEnabled && !value.outboundEnabled) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Select inbound, outbound, or both when voice recording is on",
        path: ["inboundEnabled"],
      });
    }
  });

export type OrganizationRoutingType = {
  id: number;
  code: string;
  name: string;
  description: string;
  sortOrder: number;
};

export type OrganizationRoutingProfile = {
  routingTypeId: number;
  routingTypeCode: string;
  routingTypeName: string;
  longWaitSeconds: number | null;
  updatedAt: string | null;
};

export type OrganizationVoicePromptOption = {
  id: string;
  name: string;
};

export type OrganizationRecordingSettings = {
  recordingEnabled: boolean;
  inboundEnabled: boolean;
  outboundEnabled: boolean;
  consentNoticeEnabled: boolean;
  consentPromptId: string | null;
  agentAccessEnabled: boolean;
  updatedAt: string | null;
};

export type OrganizationRecordingResponse = {
  recording: OrganizationRecordingSettings;
  prompts: OrganizationVoicePromptOption[];
};

type RoutingTypeRow = {
  id: number;
  code: string;
  name: string;
  description: string;
  sort_order: number;
};

type RoutingProfileRow = {
  routing_type_id: number;
  routing_type_code: string;
  routing_type_name: string;
  long_wait_seconds: number | null;
  updated_at: Date | string | null;
};

type RecordingRow = {
  recording_enabled: boolean;
  inbound_enabled: boolean;
  outbound_enabled: boolean;
  consent_notice_enabled: boolean;
  consent_prompt_id: bigint | number | string | null;
  agent_access_enabled: boolean;
  updated_at: Date | string | null;
};

type VoicePromptRow = {
  id: bigint | number | string;
  name: string;
};

function asIso(value: Date | string | null | undefined): string | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export function mapRoutingTypeRow(row: RoutingTypeRow): OrganizationRoutingType {
  return {
    id: Number(row.id),
    code: row.code,
    name: row.name,
    description: row.description,
    sortOrder: Number(row.sort_order),
  };
}

export function resolveLongWaitSeconds(
  routingTypeId: number,
  longWaitSeconds: number | null | undefined,
): number | null {
  if (routingTypeId !== ROUTING_TYPE_LONG_WAIT) return null;
  return longWaitSeconds ?? DEFAULT_LONG_WAIT_SECONDS;
}

export function defaultRoutingProfile(
  types: OrganizationRoutingType[],
): OrganizationRoutingProfile {
  const selected =
    types.find((type) => type.id === DEFAULT_ROUTING_TYPE_ID) ?? types[0] ?? {
      id: DEFAULT_ROUTING_TYPE_ID,
      code: "skill",
      name: "Skill based routing",
      description: "",
      sortOrder: 3,
    };
  return {
    routingTypeId: selected.id,
    routingTypeCode: selected.code,
    routingTypeName: selected.name,
    longWaitSeconds: null,
    updatedAt: null,
  };
}

export function defaultRecordingSettings(): OrganizationRecordingSettings {
  return {
    recordingEnabled: false,
    inboundEnabled: true,
    outboundEnabled: true,
    consentNoticeEnabled: false,
    consentPromptId: null,
    agentAccessEnabled: false,
    updatedAt: null,
  };
}

export function mapRecordingRow(row: RecordingRow): OrganizationRecordingSettings {
  return {
    recordingEnabled: Boolean(row.recording_enabled),
    inboundEnabled: Boolean(row.inbound_enabled),
    outboundEnabled: Boolean(row.outbound_enabled),
    consentNoticeEnabled: Boolean(row.consent_notice_enabled),
    consentPromptId: row.consent_prompt_id == null ? null : String(row.consent_prompt_id),
    agentAccessEnabled: Boolean(row.agent_access_enabled),
    updatedAt: asIso(row.updated_at),
  };
}

function mapVoicePromptRow(row: VoicePromptRow): OrganizationVoicePromptOption {
  return { id: String(row.id), name: row.name };
}

export async function listRoutingProfileTypes(db: DbClient): Promise<OrganizationRoutingType[]> {
  const rows = await db.$queryRaw<RoutingTypeRow[]>`
    SELECT id, code, name, description, sort_order
    FROM accounts.routing_profile_types
    ORDER BY sort_order ASC, id ASC
  `;
  return rows.map(mapRoutingTypeRow);
}

export async function getOrganizationRoutingProfile(
  db: DbClient,
  organizationId: string,
): Promise<{ profile: OrganizationRoutingProfile; types: OrganizationRoutingType[] }> {
  const types = await listRoutingProfileTypes(db);
  const rows = await db.$queryRaw<RoutingProfileRow[]>`
    SELECT
      profile.routing_type_id,
      type.code AS routing_type_code,
      type.name AS routing_type_name,
      profile.long_wait_seconds,
      profile.updated_at
    FROM accounts.setup_organization_routing_profiles profile
    JOIN accounts.routing_profile_types type ON type.id = profile.routing_type_id
    WHERE profile.organization_id = ${organizationId}::bigint
    LIMIT 1
  `;
  const row = rows[0];
  if (!row) {
    return { profile: defaultRoutingProfile(types), types };
  }
  return {
    profile: {
      routingTypeId: Number(row.routing_type_id),
      routingTypeCode: row.routing_type_code,
      routingTypeName: row.routing_type_name,
      longWaitSeconds: row.long_wait_seconds == null ? null : Number(row.long_wait_seconds),
      updatedAt: asIso(row.updated_at),
    },
    types,
  };
}

export async function upsertOrganizationRoutingProfile(
  db: DbClient,
  organizationId: string,
  input: z.infer<typeof upsertOrganizationRoutingProfileSchema>,
): Promise<{ profile: OrganizationRoutingProfile; types: OrganizationRoutingType[] }> {
  const payload = upsertOrganizationRoutingProfileSchema.parse(input);
  const types = await listRoutingProfileTypes(db);
  if (!types.some((type) => type.id === payload.routingTypeId)) {
    throw Object.assign(new Error("Unknown routing type"), { status: 400 });
  }
  const longWaitSeconds = resolveLongWaitSeconds(payload.routingTypeId, payload.longWaitSeconds);
  await db.$executeRaw`
    INSERT INTO accounts.setup_organization_routing_profiles (
      organization_id, routing_type_id, long_wait_seconds
    ) VALUES (
      ${organizationId}::bigint,
      ${payload.routingTypeId},
      ${longWaitSeconds}
    )
    ON CONFLICT (organization_id) DO UPDATE
    SET
      routing_type_id = EXCLUDED.routing_type_id,
      long_wait_seconds = EXCLUDED.long_wait_seconds,
      updated_at = NOW()
  `;
  return getOrganizationRoutingProfile(db, organizationId);
}

async function listVoicePromptOptions(
  db: DbClient,
  organizationId: string,
): Promise<OrganizationVoicePromptOption[]> {
  const rows = await db.$queryRaw<VoicePromptRow[]>`
    SELECT id, name
    FROM accounts.setup_voice_prompt_profiles
    WHERE organization_id = ${organizationId}::bigint
    ORDER BY name ASC, id ASC
  `;
  return rows.map(mapVoicePromptRow);
}

async function assertConsentPrompt(
  db: DbClient,
  organizationId: string,
  consentPromptId: string | null,
): Promise<void> {
  if (consentPromptId == null) return;
  const rows = await db.$queryRaw<{ id: bigint | number | string }[]>`
    SELECT id
    FROM accounts.setup_voice_prompt_profiles
    WHERE organization_id = ${organizationId}::bigint
      AND id = ${consentPromptId}::bigint
    LIMIT 1
  `;
  if (!rows[0]) {
    throw Object.assign(new Error("Unknown consent prompt"), { status: 400 });
  }
}

export async function getOrganizationRecordingSettings(
  db: DbClient,
  organizationId: string,
): Promise<OrganizationRecordingResponse> {
  const [prompts, rows] = await Promise.all([
    listVoicePromptOptions(db, organizationId),
    db.$queryRaw<RecordingRow[]>`
      SELECT
        recording_enabled,
        inbound_enabled,
        outbound_enabled,
        consent_notice_enabled,
        consent_prompt_id,
        agent_access_enabled,
        updated_at
      FROM accounts.setup_organization_recording_settings
      WHERE organization_id = ${organizationId}::bigint
      LIMIT 1
    `,
  ]);
  const row = rows[0];
  return {
    recording: row ? mapRecordingRow(row) : defaultRecordingSettings(),
    prompts,
  };
}

export async function upsertOrganizationRecordingSettings(
  db: DbClient,
  organizationId: string,
  input: z.infer<typeof upsertOrganizationRecordingSchema>,
): Promise<OrganizationRecordingResponse> {
  const payload = upsertOrganizationRecordingSchema.parse(input);
  await assertConsentPrompt(db, organizationId, payload.consentPromptId);
  await db.$executeRaw`
    INSERT INTO accounts.setup_organization_recording_settings (
      organization_id,
      recording_enabled,
      inbound_enabled,
      outbound_enabled,
      consent_notice_enabled,
      consent_prompt_id,
      agent_access_enabled
    ) VALUES (
      ${organizationId}::bigint,
      ${payload.recordingEnabled},
      ${payload.inboundEnabled},
      ${payload.outboundEnabled},
      ${payload.consentNoticeEnabled},
      ${payload.consentPromptId}::bigint,
      ${payload.agentAccessEnabled}
    )
    ON CONFLICT (organization_id) DO UPDATE
    SET
      recording_enabled = EXCLUDED.recording_enabled,
      inbound_enabled = EXCLUDED.inbound_enabled,
      outbound_enabled = EXCLUDED.outbound_enabled,
      consent_notice_enabled = EXCLUDED.consent_notice_enabled,
      consent_prompt_id = EXCLUDED.consent_prompt_id,
      agent_access_enabled = EXCLUDED.agent_access_enabled,
      updated_at = NOW()
  `;
  return getOrganizationRecordingSettings(db, organizationId);
}
