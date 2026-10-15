import { z } from "zod";

import type { DbClient } from "../lib/rls.js";
import { entityIdSchema, serializeEntityIdOptional } from "../lib/id-schema.js";

export type WhatsAppChannelPolicy = {
  id: string;
  organizationId: string;
  channelConfigId: string;
  botEnabled: boolean;
  liveAgentEnabled: boolean;
  confidenceThreshold: number;
  defaultQueueId: string | null;
  approvedHandoffMessage: string | null;
  inactivityCloseHours: number;
  status: string;
};

type PolicyRow = {
  id: string;
  organization_id: string;
  channel_config_id: string;
  bot_enabled: boolean;
  live_agent_enabled: boolean;
  confidence_threshold: number;
  default_queue_id: string | null;
  approved_handoff_message: string | null;
  inactivity_close_hours: number;
  status: string;
};

function mapPolicy(row: PolicyRow): WhatsAppChannelPolicy {
  return {
    id: serializeEntityIdOptional(row.id)!,
    organizationId: serializeEntityIdOptional(row.organization_id)!,
    channelConfigId: serializeEntityIdOptional(row.channel_config_id)!,
    botEnabled: row.bot_enabled,
    liveAgentEnabled: row.live_agent_enabled,
    confidenceThreshold: Number(row.confidence_threshold),
    defaultQueueId: serializeEntityIdOptional(row.default_queue_id),
    approvedHandoffMessage: row.approved_handoff_message,
    inactivityCloseHours: row.inactivity_close_hours,
    status: row.status,
  };
}

export async function getWhatsAppChannelPolicy(
  db: DbClient,
  organizationId: string,
  channelConfigId: string,
): Promise<WhatsAppChannelPolicy | null> {
  const rows = await db.$queryRaw<PolicyRow[]>`
    SELECT *
    FROM ccass.whatsapp_channel_policies
    WHERE organization_id = ${organizationId}::bigint
      AND channel_config_id = ${channelConfigId}::bigint
      AND status = 'active'
    LIMIT 1
  `;
  return rows[0] ? mapPolicy(rows[0]) : null;
}

export async function upsertWhatsAppChannelPolicy(
  db: DbClient,
  organizationId: string,
  input: z.infer<typeof upsertWhatsAppChannelPolicySchema>,
): Promise<WhatsAppChannelPolicy> {
  const payload = upsertWhatsAppChannelPolicySchema.parse(input);
  const rows = await db.$queryRaw<PolicyRow[]>`
    INSERT INTO ccass.whatsapp_channel_policies (
      organization_id, channel_config_id,
      bot_enabled, live_agent_enabled, confidence_threshold,
      default_queue_id, approved_handoff_message, inactivity_close_hours, status
    ) VALUES (
      ${organizationId}::bigint,
      ${payload.channelConfigId}::bigint,
      ${payload.botEnabled ?? true},
      ${payload.liveAgentEnabled ?? true},
      ${payload.confidenceThreshold ?? 0.85},
      ${payload.defaultQueueId ?? null}::bigint,
      ${payload.approvedHandoffMessage ?? null},
      ${payload.inactivityCloseHours ?? 24},
      ${payload.status ?? "active"}
    )
    ON CONFLICT (organization_id, channel_config_id) DO UPDATE SET
      bot_enabled = COALESCE(${payload.botEnabled ?? null}, whatsapp_channel_policies.bot_enabled),
      live_agent_enabled = COALESCE(${payload.liveAgentEnabled ?? null}, whatsapp_channel_policies.live_agent_enabled),
      confidence_threshold = COALESCE(${payload.confidenceThreshold ?? null}, whatsapp_channel_policies.confidence_threshold),
      default_queue_id = COALESCE(${payload.defaultQueueId ?? null}::bigint, whatsapp_channel_policies.default_queue_id),
      approved_handoff_message = COALESCE(${payload.approvedHandoffMessage ?? null}, whatsapp_channel_policies.approved_handoff_message),
      inactivity_close_hours = COALESCE(${payload.inactivityCloseHours ?? null}, whatsapp_channel_policies.inactivity_close_hours),
      status = COALESCE(${payload.status ?? null}, whatsapp_channel_policies.status),
      updated_at = NOW()
    RETURNING *
  `;
  return mapPolicy(rows[0]!);
}

export const upsertWhatsAppChannelPolicySchema = z.object({
  channelConfigId: entityIdSchema,
  botEnabled: z.boolean().optional(),
  liveAgentEnabled: z.boolean().optional(),
  confidenceThreshold: z.number().min(0).max(1).optional(),
  defaultQueueId: entityIdSchema.nullable().optional(),
  approvedHandoffMessage: z.string().max(2000).nullable().optional(),
  inactivityCloseHours: z.number().int().min(1).max(720).optional(),
  status: z.enum(["active", "inactive"]).optional(),
});
