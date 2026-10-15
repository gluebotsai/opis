import { z } from "zod";

import type { DbClient } from "../lib/rls.js";
import { deriveMailboxPolicyFromCcaasHandler, getEmailMailboxPolicy } from "./email-policies.js";
import { getWhatsAppChannelPolicy } from "./whatsapp-policies.js";
import { entityIdSchema, serializeEntityIdOptional } from "../lib/id-schema.js";

export const DEFAULT_POLICY = {
  botEnabled: true,
  liveAgentEnabled: true,
  automationMode: "auto_send" as const,
  confidenceThreshold: 0.85,
  noAgentBehavior: "queue_and_notify" as const,
  inactivityCloseSeconds: 86400,
  shadowMode: false,
};

export type AutomationMode = "auto_send" | "draft_only" | "disabled";
export type NoAgentBehavior = "queue_and_notify" | "bot_continue" | "close_with_message";
export type PolicySource =
  | "canonical"
  | "email_persisted"
  | "whatsapp_persisted"
  | "setup"
  | "default";

export type ChannelAutomationPolicy = {
  organizationId: string;
  channelConfigId: string;
  channel: "webchat" | "email" | "whatsapp" | "instagram" | "facebook";
  botEnabled: boolean;
  liveAgentEnabled: boolean;
  automationMode: AutomationMode;
  confidenceThreshold: number;
  defaultQueueId: string | null;
  allowedQueueIds: string[];
  handoffMessage: string | null;
  noAgentBehavior: NoAgentBehavior;
  inactivityCloseSeconds: number;
  shadowMode: boolean;
  policyVersion: number;
  status: "active" | "inactive";
  channelSettings: Record<string, unknown>;
};

export type ResolvedChannelPolicy = ChannelAutomationPolicy & {
  source: PolicySource;
};

type CanonicalRow = {
  organization_id: string;
  channel_config_id: string;
  channel: string;
  bot_enabled: boolean;
  live_agent_enabled: boolean;
  automation_mode: string;
  confidence_threshold: unknown;
  default_queue_id: string | null;
  allowed_queue_ids: unknown;
  handoff_message: string | null;
  no_agent_behavior: string;
  inactivity_close_seconds: number;
  shadow_mode: boolean;
  policy_version: number;
  status: string;
  channel_settings: unknown;
};

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function mapCanonical(row: CanonicalRow): ChannelAutomationPolicy {
  return {
    organizationId: serializeEntityIdOptional(row.organization_id)!,
    channelConfigId: serializeEntityIdOptional(row.channel_config_id)!,
    channel: row.channel as ChannelAutomationPolicy["channel"],
    botEnabled: row.bot_enabled,
    liveAgentEnabled: row.live_agent_enabled,
    automationMode: row.automation_mode as AutomationMode,
    confidenceThreshold: Number(row.confidence_threshold),
    defaultQueueId: serializeEntityIdOptional(row.default_queue_id),
    allowedQueueIds: stringArray(row.allowed_queue_ids).map((id) => String(id)),
    handoffMessage: row.handoff_message,
    noAgentBehavior: row.no_agent_behavior as NoAgentBehavior,
    inactivityCloseSeconds: row.inactivity_close_seconds,
    shadowMode: row.shadow_mode,
    policyVersion: row.policy_version,
    status: row.status as "active" | "inactive",
    channelSettings:
      row.channel_settings && typeof row.channel_settings === "object"
        ? (row.channel_settings as Record<string, unknown>)
        : {},
  };
}

function defaultPolicy(
  organizationId: string,
  channelConfigId: string,
  channel: ChannelAutomationPolicy["channel"],
): ChannelAutomationPolicy {
  return {
    organizationId,
    channelConfigId,
    channel,
    ...DEFAULT_POLICY,
    defaultQueueId: null,
    allowedQueueIds: [],
    handoffMessage: null,
    policyVersion: 0,
    status: "active",
    channelSettings: {},
  };
}

async function getCanonicalPolicy(
  db: DbClient,
  organizationId: string,
  channelConfigId: string,
): Promise<ChannelAutomationPolicy | null> {
  const rows = await db.$queryRaw<CanonicalRow[]>`
    SELECT *
    FROM ccass.channel_automation_policies
    WHERE organization_id = ${organizationId}::bigint
      AND channel_config_id = ${channelConfigId}::bigint
      AND status = 'active'
    LIMIT 1
  `;
  return rows[0] ? mapCanonical(rows[0]) : null;
}

async function resolveWebchatSetupPolicy(
  db: DbClient,
  organizationId: string,
  channelConfigId: string,
): Promise<ChannelAutomationPolicy | null> {
  const rows = await db.$queryRaw<
    Array<{
      channel_config_id: string;
      routing_queue_id: string | null;
      personalisation: unknown;
    }>
  >`
    SELECT wc.channel_config_id, wc.routing_queue_id, wc.personalisation
    FROM accounts.setup_webchat_configs wc
    JOIN accounts.setup_channel_configs cc ON cc.id = wc.channel_config_id
    WHERE cc.organization_id = ${organizationId}::bigint
      AND wc.channel_config_id = ${channelConfigId}::bigint
      AND cc.status = 'active'
    LIMIT 1
  `;
  const row = rows[0];
  if (!row) return null;

  const personalisation =
    row.personalisation && typeof row.personalisation === "object"
      ? (row.personalisation as Record<string, unknown>)
      : {};

  const botEnabled = personalisation.botEnabled !== false;
  const liveAgentEnabled = personalisation.liveAgentEnabled !== false;

  return {
    ...defaultPolicy(organizationId, channelConfigId, "webchat"),
    botEnabled,
    liveAgentEnabled,
    defaultQueueId: serializeEntityIdOptional(row.routing_queue_id),
    policyVersion: 1,
  };
}

async function resolveSocialSetupPolicy(
  db: DbClient,
  organizationId: string,
  channelConfigId: string,
  channel: "whatsapp" | "instagram" | "facebook",
): Promise<ChannelAutomationPolicy | null> {
  if (channel === "whatsapp") {
    const persisted = await getWhatsAppChannelPolicy(db, organizationId, channelConfigId);
    if (persisted) {
      return {
        organizationId,
        channelConfigId,
        channel: "whatsapp",
        botEnabled: persisted.botEnabled,
        liveAgentEnabled: persisted.liveAgentEnabled,
        automationMode: "auto_send",
        confidenceThreshold: persisted.confidenceThreshold,
        defaultQueueId: persisted.defaultQueueId,
        allowedQueueIds: [],
        handoffMessage: persisted.approvedHandoffMessage,
        noAgentBehavior: "queue_and_notify",
        inactivityCloseSeconds: persisted.inactivityCloseHours * 3600,
        shadowMode: false,
        policyVersion: 1,
        status: persisted.status as "active" | "inactive",
        channelSettings: {},
      };
    }
  }

  const rows = await db.$queryRaw<
    Array<{ channel_config_id: string; bot_enabled: boolean | null; provider: string }>
  >`
    SELECT sc.channel_config_id, sc.bot_enabled, sc.provider
    FROM accounts.setup_social_configs sc
    JOIN accounts.setup_channel_configs cc ON cc.id = sc.channel_config_id
    WHERE cc.organization_id = ${organizationId}::bigint
      AND sc.channel_config_id = ${channelConfigId}::bigint
      AND sc.provider = ${channel}
      AND cc.status = 'active'
    LIMIT 1
  `;
  const row = rows[0];
  if (!row) return null;

  // Match WhatsApp: bind a default routing queue for Instagram/Facebook so live-agent
  // handoff has a queue even when no canonical policy row exists yet.
  const queueRows = await db.$queryRaw<{ id: string }[]>`
    SELECT q.id
    FROM ccass.queues q
    INNER JOIN ccass.queue_members qm ON qm.queue_id = q.id
    WHERE q.organization_id = ${organizationId}::bigint
      AND q.status = 'active'
      AND (
        (${channel} = 'instagram' AND qm.handles_instagram = TRUE)
        OR (${channel} = 'facebook' AND qm.handles_facebook = TRUE)
        OR (${channel} = 'whatsapp' AND qm.handles_whatsapp = TRUE)
      )
    GROUP BY q.id, q.published_at
    ORDER BY q.published_at ASC NULLS LAST, q.id ASC
    LIMIT 1
  `;

  return {
    ...defaultPolicy(organizationId, channelConfigId, channel),
    botEnabled: row.bot_enabled ?? true,
    liveAgentEnabled: true,
    defaultQueueId: serializeEntityIdOptional(queueRows[0]?.id),
    policyVersion: 1,
  };
}

async function resolveEmailSetupPolicy(
  db: DbClient,
  organizationId: string,
  channelConfigId: string,
  accountEmail?: string,
): Promise<ChannelAutomationPolicy | null> {
  const persisted = accountEmail
    ? await getEmailMailboxPolicy(db, organizationId, { connectionId: channelConfigId, accountEmail })
    : null;

  if (persisted) {
    return {
      organizationId,
      channelConfigId,
      channel: "email",
      botEnabled: persisted.botEnabled,
      liveAgentEnabled: persisted.liveAgentEnabled,
      automationMode: persisted.autoSendEnabled ? "auto_send" : "draft_only",
      confidenceThreshold: persisted.confidenceThreshold,
      defaultQueueId: persisted.defaultQueueId,
      allowedQueueIds: persisted.allowedQueueIds,
      handoffMessage: persisted.approvedServiceMessage,
      noAgentBehavior: "queue_and_notify",
      inactivityCloseSeconds: 86400,
      shadowMode: persisted.shadowMode,
      policyVersion: persisted.policyVersion,
      status: "active",
      channelSettings: {},
    };
  }

  const rows = await db.$queryRaw<
    Array<{ channel_config_id: string; ccaas_handler: string | null }>
  >`
    SELECT ec.channel_config_id, ec.ccaas_handler
    FROM accounts.setup_email_configs ec
    JOIN accounts.setup_channel_configs cc ON cc.id = ec.channel_config_id
    WHERE cc.organization_id = ${organizationId}::bigint
      AND ec.channel_config_id = ${channelConfigId}::bigint
      AND cc.status = 'active'
    LIMIT 1
  `;
  const row = rows[0];
  if (!row) return null;

  const derived = deriveMailboxPolicyFromCcaasHandler({
    organizationId,
    connectionId: channelConfigId,
    accountEmail: accountEmail ?? "",
    ccaasHandler: row.ccaas_handler,
  });

  return {
    organizationId,
    channelConfigId,
    channel: "email",
    botEnabled: derived.botEnabled,
    liveAgentEnabled: derived.liveAgentEnabled,
    automationMode: derived.autoSendEnabled ? "auto_send" : "draft_only",
    confidenceThreshold: derived.confidenceThreshold,
    defaultQueueId: derived.defaultQueueId,
    allowedQueueIds: derived.allowedQueueIds,
    handoffMessage: derived.approvedServiceMessage,
    noAgentBehavior: "queue_and_notify",
    inactivityCloseSeconds: 86400,
    shadowMode: derived.shadowMode,
    policyVersion: derived.policyVersion,
    status: "active",
    channelSettings: {},
  };
}

export const resolveChannelPolicyInputSchema = z.object({
  channelConfigId: entityIdSchema,
  channel: z.enum(["webchat", "email", "whatsapp", "instagram", "facebook"]),
  accountEmail: z.string().email().optional(),
});

export async function resolveChannelPolicy(
  db: DbClient,
  organizationId: string,
  input: z.infer<typeof resolveChannelPolicyInputSchema>,
): Promise<ResolvedChannelPolicy> {
  const payload = resolveChannelPolicyInputSchema.parse(input);

  const canonical = await getCanonicalPolicy(db, organizationId, payload.channelConfigId);
  if (canonical) {
    return { ...canonical, source: "canonical" };
  }

  let legacy: ChannelAutomationPolicy | null = null;
  let source: PolicySource = "default";

  switch (payload.channel) {
    case "webchat":
      legacy = await resolveWebchatSetupPolicy(db, organizationId, payload.channelConfigId);
      source = "setup";
      break;
    case "email":
      legacy = await resolveEmailSetupPolicy(
        db,
        organizationId,
        payload.channelConfigId,
        payload.accountEmail,
      );
      source = legacy ? "email_persisted" : "setup";
      break;
    case "whatsapp":
    case "instagram":
    case "facebook":
      legacy = await resolveSocialSetupPolicy(
        db,
        organizationId,
        payload.channelConfigId,
        payload.channel,
      );
      source = legacy && payload.channel === "whatsapp" ? "whatsapp_persisted" : "setup";
      break;
  }

  if (legacy) {
    return { ...legacy, source };
  }

  return {
    ...defaultPolicy(organizationId, payload.channelConfigId, payload.channel),
    source: "default",
  };
}

export const upsertChannelPolicySchema = z.object({
  channelConfigId: entityIdSchema,
  channel: z.enum(["webchat", "email", "whatsapp", "instagram", "facebook"]),
  botEnabled: z.boolean().optional(),
  liveAgentEnabled: z.boolean().optional(),
  automationMode: z.enum(["auto_send", "draft_only", "disabled"]).optional(),
  confidenceThreshold: z.number().min(0).max(1).optional(),
  defaultQueueId: entityIdSchema.nullable().optional(),
  allowedQueueIds: z.array(entityIdSchema).optional(),
  handoffMessage: z.string().max(2000).nullable().optional(),
  noAgentBehavior: z.enum(["queue_and_notify", "bot_continue", "close_with_message"]).optional(),
  inactivityCloseSeconds: z.number().int().min(60).max(2_592_000).optional(),
  shadowMode: z.boolean().optional(),
  channelSettings: z.record(z.unknown()).optional(),
  expectedVersion: z.number().int().optional(),
});

export async function upsertChannelPolicy(
  db: DbClient,
  organizationId: string,
  input: z.infer<typeof upsertChannelPolicySchema>,
): Promise<ChannelAutomationPolicy> {
  const payload = upsertChannelPolicySchema.parse(input);
  const existing = await getCanonicalPolicy(db, organizationId, payload.channelConfigId);
  const nextVersion = (existing?.policyVersion ?? 0) + 1;

  if (payload.expectedVersion !== undefined && existing?.policyVersion !== payload.expectedVersion) {
    throw new Error(
      `Policy version conflict: expected ${payload.expectedVersion}, current ${existing?.policyVersion ?? 0}`,
    );
  }

  const allowedQueueIds = payload.allowedQueueIds ?? existing?.allowedQueueIds ?? [];

  const rows = await db.$queryRaw<CanonicalRow[]>`
    INSERT INTO ccass.channel_automation_policies (
      organization_id, channel_config_id, channel,
      bot_enabled, live_agent_enabled, automation_mode,
      confidence_threshold, default_queue_id, allowed_queue_ids,
      handoff_message, no_agent_behavior, inactivity_close_seconds,
      shadow_mode, policy_version, channel_settings, updated_at
    ) VALUES (
      ${organizationId}::bigint,
      ${payload.channelConfigId}::bigint,
      ${payload.channel},
      ${payload.botEnabled ?? existing?.botEnabled ?? DEFAULT_POLICY.botEnabled},
      ${payload.liveAgentEnabled ?? existing?.liveAgentEnabled ?? DEFAULT_POLICY.liveAgentEnabled},
      ${payload.automationMode ?? existing?.automationMode ?? DEFAULT_POLICY.automationMode},
      ${payload.confidenceThreshold ?? existing?.confidenceThreshold ?? DEFAULT_POLICY.confidenceThreshold},
      ${payload.defaultQueueId !== undefined ? payload.defaultQueueId : (existing?.defaultQueueId ?? null)}::bigint,
      ${allowedQueueIds}::bigint[],
      ${payload.handoffMessage !== undefined ? payload.handoffMessage : (existing?.handoffMessage ?? null)},
      ${payload.noAgentBehavior ?? existing?.noAgentBehavior ?? DEFAULT_POLICY.noAgentBehavior},
      ${payload.inactivityCloseSeconds ?? existing?.inactivityCloseSeconds ?? DEFAULT_POLICY.inactivityCloseSeconds},
      ${payload.shadowMode ?? existing?.shadowMode ?? DEFAULT_POLICY.shadowMode},
      ${nextVersion},
      ${JSON.stringify(payload.channelSettings ?? existing?.channelSettings ?? {})}::jsonb,
      NOW()
    )
    ON CONFLICT (organization_id, channel_config_id) DO UPDATE SET
      channel = EXCLUDED.channel,
      bot_enabled = EXCLUDED.bot_enabled,
      live_agent_enabled = EXCLUDED.live_agent_enabled,
      automation_mode = EXCLUDED.automation_mode,
      confidence_threshold = EXCLUDED.confidence_threshold,
      default_queue_id = EXCLUDED.default_queue_id,
      allowed_queue_ids = EXCLUDED.allowed_queue_ids,
      handoff_message = EXCLUDED.handoff_message,
      no_agent_behavior = EXCLUDED.no_agent_behavior,
      inactivity_close_seconds = EXCLUDED.inactivity_close_seconds,
      shadow_mode = EXCLUDED.shadow_mode,
      policy_version = EXCLUDED.policy_version,
      channel_settings = EXCLUDED.channel_settings,
      updated_at = NOW()
    RETURNING *
  `;

  return mapCanonical(rows[0]!);
}
