import { z } from "zod";

import type { DbClient } from "../lib/rls.js";
import { entityIdSchema, serializeEntityIdOptional } from "../lib/id-schema.js";

const uuidArraySchema = z.array(entityIdSchema).max(100);

export const upsertEmailMailboxPolicySchema = z.object({
  connectionId: entityIdSchema,
  accountEmail: z.string().email(),
  botEnabled: z.boolean().default(false),
  liveAgentEnabled: z.boolean().default(true),
  shadowMode: z.boolean().default(true),
  autoSendEnabled: z.boolean().default(false),
  confidenceThreshold: z.number().min(0).max(1).default(0.85),
  defaultQueueId: entityIdSchema.nullable().default(null),
  allowedQueueIds: uuidArraySchema.default([]),
  approvedServiceMessage: z.string().max(2000).nullable().default(null),
});

export const upsertQueueRoutingProfileSchema = z.object({
  description: z.string().trim().min(1).max(4000),
  supportedIntents: z.array(z.string().trim().min(1).max(128)).max(100).default([]),
  examplePhrases: z.array(z.string().trim().min(1).max(500)).max(200).default([]),
  languageCodes: z.array(z.string().trim().min(2).max(16)).min(1).max(20).default(["en"]),
  skillMapping: z.record(z.string(), z.array(z.string().trim().min(1).max(128))).default({}),
  classifierVersion: z.string().trim().min(1).max(64).default("v1"),
});

type PolicyRow = {
  organization_id: string;
  connection_id: string;
  account_email: string;
  bot_enabled: boolean;
  live_agent_enabled: boolean;
  shadow_mode: boolean;
  auto_send_enabled: boolean;
  confidence_threshold: unknown;
  default_queue_id: string | null;
  allowed_queue_ids: unknown;
  approved_service_message: string | null;
  policy_version: number;
};

type QueueProfileRow = {
  key: string;
  queue_id: string;
  name: string;
  description: string;
  supported_intents: unknown;
  skill_mapping: unknown;
  classifier_version: string;
};

export type EmailMailboxPolicy = {
  organizationId: string;
  connectionId: string;
  accountEmail: string;
  botEnabled: boolean;
  liveAgentEnabled: boolean;
  shadowMode: boolean;
  autoSendEnabled: boolean;
  confidenceThreshold: number;
  defaultQueueId: string | null;
  allowedQueueIds: string[];
  approvedServiceMessage: string | null;
  policyVersion: number;
};

export type EmailQueueProfile = {
  key: string;
  queueId: string;
  name: string;
  description: string;
  intents: string[];
  skills: string[];
  classifierVersion: string;
};

export type EmailTenantContext = {
  companyName: string | null;
  industryType: string | null;
  businessType: string | null;
  websiteUrl: string | null;
  publicEmail: string | null;
  publicPhone: string | null;
  locations: unknown[];
  capabilities: string[];
};

export type EmailChannelConfig = {
  channelConfigId: string;
  accountEmail: string;
  ccaasHandler: string | null;
};

export type ResolvedEmailMailboxPolicy = EmailMailboxPolicy & {
  source: "persisted" | "channel_default";
};

export function toEmailMailboxPolicy(
  resolved: ResolvedEmailMailboxPolicy | null,
): EmailMailboxPolicy | null {
  if (!resolved) return null;
  const { source: _source, ...policy } = resolved;
  return policy;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function mapPolicy(row: PolicyRow): EmailMailboxPolicy {
  return {
    organizationId: serializeEntityIdOptional(row.organization_id)!,
    connectionId: serializeEntityIdOptional(row.connection_id)!,
    accountEmail: row.account_email,
    botEnabled: row.bot_enabled,
    liveAgentEnabled: row.live_agent_enabled,
    shadowMode: row.shadow_mode,
    autoSendEnabled: row.auto_send_enabled,
    confidenceThreshold: Number(row.confidence_threshold),
    defaultQueueId: serializeEntityIdOptional(row.default_queue_id),
    allowedQueueIds: Array.isArray(row.allowed_queue_ids)
      ? row.allowed_queue_ids.map((id) => String(id))
      : [],
    approvedServiceMessage: row.approved_service_message,
    policyVersion: Number(row.policy_version),
  };
}

function mapQueueProfile(row: QueueProfileRow): EmailQueueProfile {
  const mapping =
    row.skill_mapping && typeof row.skill_mapping === "object" && !Array.isArray(row.skill_mapping)
      ? Object.keys(row.skill_mapping as Record<string, unknown>)
      : [];
  const queueId = serializeEntityIdOptional(row.queue_id)!;
  return {
    key: queueId,
    queueId,
    name: row.name,
    description: row.description,
    intents: stringArray(row.supported_intents),
    skills: mapping,
    classifierVersion: row.classifier_version,
  };
}

export async function getEmailMailboxPolicy(
  db: DbClient,
  organizationId: string,
  input: { connectionId?: string | null; accountEmail: string },
): Promise<EmailMailboxPolicy | null> {
  const rows = await db.$queryRaw<PolicyRow[]>`
    SELECT *
    FROM ccass.email_mailbox_policies
    WHERE organization_id = ${organizationId}::bigint
      AND status = 'active'
      AND (
        (${input.connectionId ?? null}::bigint IS NOT NULL
          AND connection_id = ${input.connectionId ?? null}::bigint)
        OR lower(account_email) = lower(${input.accountEmail})
      )
    ORDER BY
      CASE WHEN connection_id = ${input.connectionId ?? null}::bigint THEN 0 ELSE 1 END,
      updated_at DESC
    LIMIT 1
  `;
  return rows[0] ? mapPolicy(rows[0]) : null;
}

export function deriveMailboxPolicyFromCcaasHandler(input: {
  organizationId: string;
  connectionId: string | number | bigint;
  accountEmail: string;
  ccaasHandler: string | null;
}): EmailMailboxPolicy {
  const connectionId = serializeEntityIdOptional(input.connectionId)!;
  const handler = (input.ccaasHandler ?? "bot_then_human").trim().toLowerCase();
  if (handler === "human") {
    return {
      organizationId: input.organizationId,
      connectionId,
      accountEmail: input.accountEmail,
      botEnabled: false,
      liveAgentEnabled: true,
      shadowMode: true,
      autoSendEnabled: false,
      confidenceThreshold: 0.85,
      defaultQueueId: null,
      allowedQueueIds: [],
      approvedServiceMessage: null,
      policyVersion: 0,
    };
  }
  if (handler === "bot") {
    return {
      organizationId: input.organizationId,
      connectionId,
      accountEmail: input.accountEmail,
      botEnabled: true,
      liveAgentEnabled: true,
      shadowMode: false,
      autoSendEnabled: true,
      confidenceThreshold: 0.85,
      defaultQueueId: null,
      allowedQueueIds: [],
      approvedServiceMessage: null,
      policyVersion: 0,
    };
  }
  return {
    organizationId: input.organizationId,
    connectionId,
    accountEmail: input.accountEmail,
    botEnabled: true,
    liveAgentEnabled: true,
    shadowMode: true,
    autoSendEnabled: false,
    confidenceThreshold: 0.85,
    defaultQueueId: null,
    allowedQueueIds: [],
    approvedServiceMessage: null,
    policyVersion: 0,
  };
}

export async function getEmailChannelConfig(
  db: DbClient,
  organizationId: string,
  input: { connectionId?: string | null; accountEmail: string },
): Promise<EmailChannelConfig | null> {
  const rows = await db.$queryRaw<
    Array<{
      channel_config_id: string;
      account_email: string;
      ccaas_handler: string | null;
    }>
  >`
    SELECT
      cc.id AS channel_config_id,
      COALESCE(NULLIF(trim(ec.sender_email), ''), oauth.account_email) AS account_email,
      ec.ccaas_handler
    FROM accounts.setup_channel_configs cc
    INNER JOIN accounts.setup_email_configs ec
      ON ec.channel_config_id = cc.id
    LEFT JOIN accounts.mail_oauth_connections oauth
      ON oauth.id = ec.oauth_connection_id
    WHERE cc.organization_id = ${organizationId}::bigint
      AND cc.channel_type = 'email'
      AND cc.status = 'active'
      AND (
        (${input.connectionId ?? null}::bigint IS NOT NULL AND cc.id = ${input.connectionId ?? null}::bigint)
        OR lower(COALESCE(ec.sender_email, oauth.account_email, '')) = lower(${input.accountEmail})
        OR lower(oauth.account_email) = lower(${input.accountEmail})
      )
    ORDER BY
      CASE WHEN cc.id = ${input.connectionId ?? null}::bigint THEN 0 ELSE 1 END,
      cc.updated_at DESC
    LIMIT 1
  `;
  const row = rows[0];
  if (!row?.account_email) return null;
  return {
    channelConfigId: serializeEntityIdOptional(row.channel_config_id)!,
    accountEmail: row.account_email,
    ccaasHandler: row.ccaas_handler,
  };
}

export async function resolveEmailMailboxPolicy(
  db: DbClient,
  organizationId: string,
  input: { connectionId?: string | null; accountEmail: string },
): Promise<ResolvedEmailMailboxPolicy | null> {
  const persisted = await getEmailMailboxPolicy(db, organizationId, input);
  if (persisted) {
    return { ...persisted, source: "persisted" };
  }
  const channel = await getEmailChannelConfig(db, organizationId, input);
  if (!channel) return null;
  return {
    ...deriveMailboxPolicyFromCcaasHandler({
      organizationId,
      connectionId: channel.channelConfigId,
      accountEmail: channel.accountEmail,
      ccaasHandler: channel.ccaasHandler,
    }),
    source: "channel_default",
  };
}

export async function listEmailQueueProfiles(
  db: DbClient,
  organizationId: string,
  allowedQueueIds: string[] = [],
): Promise<EmailQueueProfile[]> {
  const rows = await db.$queryRaw<QueueProfileRow[]>`
    SELECT
      q.id::text AS key,
      q.id AS queue_id,
      q.name,
      COALESCE(profile.description, q.name) AS description,
      COALESCE(profile.supported_intents, '[]'::jsonb) AS supported_intents,
      COALESCE(profile.skill_mapping, '{}'::jsonb) AS skill_mapping,
      COALESCE(profile.classifier_version, 'v1') AS classifier_version
    FROM ccass.queues q
    LEFT JOIN ccass.queue_routing_profiles profile ON profile.queue_id = q.id
    WHERE q.organization_id = ${organizationId}::bigint
      AND q.status = 'active'
      AND (
        ${JSON.stringify(allowedQueueIds)}::jsonb = '[]'::jsonb
        OR q.id::text IN (
          SELECT jsonb_array_elements_text(${JSON.stringify(allowedQueueIds)}::jsonb)
        )
      )
      AND EXISTS (
        SELECT 1 FROM ccass.queue_members member
        WHERE member.queue_id = q.id AND member.handles_email = TRUE
      )
    ORDER BY q.name ASC
  `;
  return rows.map(mapQueueProfile);
}

export async function isEmailQueueAllowedForMailbox(
  db: DbClient,
  organizationId: string,
  mailboxConnectionId: string | null,
  queueId: string,
): Promise<boolean> {
  const rows = await db.$queryRaw<{ eligible: boolean }[]>`
    SELECT EXISTS (
      SELECT 1
      FROM ccass.queues queue
      WHERE queue.id = ${queueId}::bigint
        AND queue.organization_id = ${organizationId}::bigint
        AND queue.status = 'active'
        AND EXISTS (
          SELECT 1
          FROM ccass.queue_members member
          WHERE member.queue_id = queue.id
            AND member.handles_email = TRUE
        )
        AND NOT EXISTS (
          SELECT 1
          FROM ccass.email_mailbox_policies policy
          WHERE policy.organization_id = ${organizationId}::bigint
            AND policy.connection_id = ${mailboxConnectionId}::bigint
            AND policy.status = 'active'
            AND policy.allowed_queue_ids <> '[]'::jsonb
            AND NOT policy.allowed_queue_ids ? ${queueId}
        )
    ) AS eligible
  `;
  return rows[0]?.eligible ?? false;
}

export async function resolveEmailHandoffQueueId(
  db: DbClient,
  organizationId: string,
  input: {
    mailboxConnectionId: string | null;
    preferredQueueId?: string | null;
    allowedQueueIds?: string[];
    defaultQueueId?: string | null;
  },
): Promise<string | null> {
  const allowedQueueIds = input.allowedQueueIds ?? [];
  const candidates: string[] = [];
  const addCandidate = (queueId: string | number | bigint | null | undefined) => {
    const normalized = serializeEntityIdOptional(queueId);
    if (normalized && !candidates.includes(normalized)) {
      candidates.push(normalized);
    }
  };

  addCandidate(input.preferredQueueId);
  addCandidate(input.defaultQueueId);
  for (const queueId of allowedQueueIds) {
    addCandidate(queueId);
  }

  const profiles = await listEmailQueueProfiles(db, organizationId, allowedQueueIds);
  for (const profile of profiles) {
    addCandidate(profile.queueId);
  }

  for (const queueId of candidates) {
    if (await isEmailQueueAllowedForMailbox(db, organizationId, input.mailboxConnectionId, queueId)) {
      return queueId;
    }
  }
  return null;
}

export async function getEmailTenantContext(
  db: DbClient,
  organizationId: string,
): Promise<EmailTenantContext> {
  const rows = await db.$queryRaw<
    Array<{
      company_name: string | null;
      industry_type: string | null;
      business_type: string | null;
      website_url: string | null;
      work_email: string | null;
      mobile_country_code: string | null;
      mobile_number: string | null;
      locations: unknown;
    }>
  >`
    SELECT
      org.company_name,
      org.industry_type,
      org.business_type,
      org.website_url,
      org.work_email,
      org.mobile_country_code,
      org.mobile_number,
      COALESCE(
        (
          SELECT jsonb_agg(
            jsonb_build_object(
              'label', location.label,
              'address', location.address,
              'city', location.city,
              'country', location.country,
              'timezone', location.timezone
            )
            ORDER BY location.is_primary DESC, location.label ASC
          )
          FROM accounts.organization_locations location
          WHERE location.organization_id = org.id
            AND location.status = 'active'
        ),
        '[]'::jsonb
      ) AS locations
    FROM accounts.organizations org
    WHERE org.id = ${organizationId}::bigint
    LIMIT 1
  `;
  const row = rows[0];
  if (!row) {
    return {
      companyName: null,
      industryType: null,
      businessType: null,
      websiteUrl: null,
      publicEmail: null,
      publicPhone: null,
      locations: [],
      capabilities: [],
    };
  }
  return {
    companyName: row.company_name,
    industryType: row.industry_type,
    businessType: row.business_type,
    websiteUrl: row.website_url,
    publicEmail: row.work_email,
    publicPhone: row.mobile_number
      ? `${row.mobile_country_code ? `${row.mobile_country_code} ` : ""}${row.mobile_number}`
      : null,
    locations: Array.isArray(row.locations) ? row.locations : [],
    capabilities: [],
  };
}

export async function upsertEmailMailboxPolicy(
  db: DbClient,
  organizationId: string,
  input: z.infer<typeof upsertEmailMailboxPolicySchema>,
): Promise<EmailMailboxPolicy> {
  const payload = upsertEmailMailboxPolicySchema.parse(input);
  const allowedQueueIds = [
    ...new Set([
      ...payload.allowedQueueIds,
      ...(payload.defaultQueueId ? [payload.defaultQueueId] : []),
    ]),
  ];
  const queueIds = [...allowedQueueIds];
  if (queueIds.length > 0) {
    const rows = await db.$queryRaw<{ id: string }[]>`
      SELECT q.id
      FROM ccass.queues q
      WHERE q.organization_id = ${organizationId}::bigint
        AND q.status = 'active'
        AND q.id::text IN (
          SELECT jsonb_array_elements_text(${JSON.stringify(queueIds)}::jsonb)
        )
        AND EXISTS (
          SELECT 1 FROM ccass.queue_members member
          WHERE member.queue_id = q.id AND member.handles_email = TRUE
        )
    `;
    if (rows.length !== queueIds.length) {
      throw Object.assign(new Error("Every configured queue must be an active email queue"), {
        status: 400,
      });
    }
  }

  const rows = await db.$queryRaw<PolicyRow[]>`
    INSERT INTO ccass.email_mailbox_policies (
      organization_id, connection_id, account_email, bot_enabled, live_agent_enabled,
      shadow_mode, auto_send_enabled, confidence_threshold, default_queue_id,
      allowed_queue_ids, approved_service_message
    ) VALUES (
      ${organizationId}::bigint,
      ${payload.connectionId}::bigint,
      ${payload.accountEmail},
      ${payload.botEnabled},
      ${payload.liveAgentEnabled},
      ${payload.shadowMode},
      ${payload.autoSendEnabled},
      ${payload.confidenceThreshold},
      ${payload.defaultQueueId}::bigint,
      ${JSON.stringify(allowedQueueIds)}::jsonb,
      ${payload.approvedServiceMessage}
    )
    ON CONFLICT (organization_id, connection_id) DO UPDATE
    SET
      account_email = EXCLUDED.account_email,
      bot_enabled = EXCLUDED.bot_enabled,
      live_agent_enabled = EXCLUDED.live_agent_enabled,
      shadow_mode = EXCLUDED.shadow_mode,
      auto_send_enabled = EXCLUDED.auto_send_enabled,
      confidence_threshold = EXCLUDED.confidence_threshold,
      default_queue_id = EXCLUDED.default_queue_id,
      allowed_queue_ids = EXCLUDED.allowed_queue_ids,
      approved_service_message = EXCLUDED.approved_service_message,
      policy_version = ccass.email_mailbox_policies.policy_version + 1,
      updated_at = NOW()
    RETURNING *
  `;
  return mapPolicy(rows[0]!);
}

export async function upsertQueueRoutingProfile(
  db: DbClient,
  organizationId: string,
  queueId: string,
  input: z.infer<typeof upsertQueueRoutingProfileSchema>,
): Promise<EmailQueueProfile> {
  const payload = upsertQueueRoutingProfileSchema.parse(input);
  const queueRows = await db.$queryRaw<{ id: string }[]>`
    SELECT id
    FROM accounts.setup_ccaas_queues
    WHERE id = ${queueId}::bigint
      AND organization_id = ${organizationId}::bigint
    LIMIT 1
  `;
  if (!queueRows[0]) {
    throw Object.assign(new Error("Queue not found"), { status: 404 });
  }
  await db.$executeRaw`
    INSERT INTO accounts.setup_queue_routing_profiles (
      organization_id, queue_id, description, supported_intents, example_phrases,
      language_codes, skill_mapping, classifier_version
    ) VALUES (
      ${organizationId}::bigint,
      ${queueId}::bigint,
      ${payload.description},
      ${JSON.stringify(payload.supportedIntents)}::jsonb,
      ${JSON.stringify(payload.examplePhrases)}::jsonb,
      ${JSON.stringify(payload.languageCodes)}::jsonb,
      ${JSON.stringify(payload.skillMapping)}::jsonb,
      ${payload.classifierVersion}
    )
    ON CONFLICT (queue_id) DO UPDATE
    SET
      description = EXCLUDED.description,
      supported_intents = EXCLUDED.supported_intents,
      example_phrases = EXCLUDED.example_phrases,
      language_codes = EXCLUDED.language_codes,
      skill_mapping = EXCLUDED.skill_mapping,
      classifier_version = EXCLUDED.classifier_version,
      updated_at = NOW()
  `;
  await db.$executeRaw`
    INSERT INTO ccass.queue_routing_profiles (
      organization_id, queue_id, description, supported_intents, example_phrases,
      language_codes, skill_mapping, classifier_version
    )
    SELECT
      source.organization_id,
      runtime.id,
      source.description,
      source.supported_intents,
      source.example_phrases,
      source.language_codes,
      source.skill_mapping,
      source.classifier_version
    FROM accounts.setup_queue_routing_profiles source
    INNER JOIN ccass.queues runtime
      ON runtime.setup_queue_id = source.queue_id
      AND runtime.organization_id = source.organization_id
    WHERE source.organization_id = ${organizationId}::bigint
      AND source.queue_id = ${queueId}::bigint
    ON CONFLICT (queue_id) DO UPDATE
    SET
      description = EXCLUDED.description,
      supported_intents = EXCLUDED.supported_intents,
      example_phrases = EXCLUDED.example_phrases,
      language_codes = EXCLUDED.language_codes,
      skill_mapping = EXCLUDED.skill_mapping,
      classifier_version = EXCLUDED.classifier_version,
      updated_at = NOW()
  `;
  const profiles = await listEmailQueueProfiles(db, organizationId, [queueId]);
  if (!profiles[0]) {
    throw Object.assign(new Error("Queue must be published and email-enabled"), { status: 409 });
  }
  return profiles[0];
}

export async function getEmailAutomationMetrics(
  db: DbClient,
  organizationId: string,
  windowHours: number,
): Promise<Record<string, number>> {
  const rows = await db.$queryRaw<
    Array<{
      provider_events: bigint;
      provider_failures: bigint;
      nlp_turns: bigint;
      grounded_turns: bigint;
      handoff_turns: bigint;
      deliveries_sent: bigint;
      deliveries_failed: bigint;
      sla_breaches: bigint;
      average_nlp_latency_ms: unknown;
    }>
  >`
    SELECT
      (
        SELECT COUNT(*) FROM ccass.email_provider_events event
        WHERE event.organization_id = ${organizationId}::bigint
          AND event.created_at >= NOW() - (${windowHours} * INTERVAL '1 hour')
      ) AS provider_events,
      (
        SELECT COUNT(*) FROM ccass.email_provider_events event
        WHERE event.organization_id = ${organizationId}::bigint
          AND event.status = 'failed'
          AND event.created_at >= NOW() - (${windowHours} * INTERVAL '1 hour')
      ) AS provider_failures,
      (
        SELECT COUNT(*) FROM ccass.nlp_turns turn
        INNER JOIN ccass.nlp_conversations conversation
          ON conversation.id = turn.nlp_conversation_id
        WHERE turn.organization_id = ${organizationId}::bigint
          AND conversation.runtime_type = 'email_bot'
          AND turn.created_at >= NOW() - (${windowHours} * INTERVAL '1 hour')
      ) AS nlp_turns,
      (
        SELECT COUNT(*) FROM ccass.nlp_turns turn
        INNER JOIN ccass.nlp_conversations conversation
          ON conversation.id = turn.nlp_conversation_id
        WHERE turn.organization_id = ${organizationId}::bigint
          AND conversation.runtime_type = 'email_bot'
          AND turn.grounded = TRUE
          AND turn.guard_passed = TRUE
          AND turn.created_at >= NOW() - (${windowHours} * INTERVAL '1 hour')
      ) AS grounded_turns,
      (
        SELECT COUNT(*) FROM ccass.nlp_turns turn
        INNER JOIN ccass.nlp_conversations conversation
          ON conversation.id = turn.nlp_conversation_id
        WHERE turn.organization_id = ${organizationId}::bigint
          AND conversation.runtime_type = 'email_bot'
          AND turn.handoff_recommended = TRUE
          AND turn.created_at >= NOW() - (${windowHours} * INTERVAL '1 hour')
      ) AS handoff_turns,
      (
        SELECT COUNT(*) FROM ccass.email_delivery_outbox delivery
        WHERE delivery.organization_id = ${organizationId}::bigint
          AND delivery.status = 'sent'
          AND delivery.created_at >= NOW() - (${windowHours} * INTERVAL '1 hour')
      ) AS deliveries_sent,
      (
        SELECT COUNT(*) FROM ccass.email_delivery_outbox delivery
        WHERE delivery.organization_id = ${organizationId}::bigint
          AND delivery.status IN ('failed', 'bounced')
          AND delivery.created_at >= NOW() - (${windowHours} * INTERVAL '1 hour')
      ) AS deliveries_failed,
      (
        SELECT COUNT(*) FROM ccass.conversations conversation
        WHERE conversation.organization_id = ${organizationId}::bigint
          AND conversation.channel = 'email'
          AND (
            conversation.sla_status LIKE '%breached'
            OR (
              conversation.resolution_due_at IS NOT NULL
              AND conversation.resolved_at IS NULL
              AND NOW() > conversation.resolution_due_at
            )
          )
          AND conversation.created_at >= NOW() - (${windowHours} * INTERVAL '1 hour')
      ) AS sla_breaches
      ,
      (
        SELECT COALESCE(AVG(turn.latency_ms), 0)
        FROM ccass.nlp_turns turn
        INNER JOIN ccass.nlp_conversations conversation
          ON conversation.id = turn.nlp_conversation_id
        WHERE turn.organization_id = ${organizationId}::bigint
          AND conversation.runtime_type = 'email_bot'
          AND turn.created_at >= NOW() - (${windowHours} * INTERVAL '1 hour')
      ) AS average_nlp_latency_ms
  `;
  const row = rows[0]!;
  const metrics = Object.fromEntries(
    Object.entries(row).map(([key, value]) => [key, Number(value)]),
  ) as Record<string, number>;
  metrics.groundedRate = metrics.nlp_turns
    ? (metrics.grounded_turns ?? 0) / metrics.nlp_turns
    : 0;
  metrics.handoffRate = metrics.nlp_turns
    ? (metrics.handoff_turns ?? 0) / metrics.nlp_turns
    : 0;
  return metrics;
}

