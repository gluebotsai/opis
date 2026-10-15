/**
 * Generates contact-center schema reference markdown from live PostgreSQL introspection.
 *
 * Outputs:
 *   docs/ccaas/CONTACT_CENTER_SCHEMA.md
 *
 * Run: npx tsx packages/db-cc/scripts/generate-schema-docs.ts
 */
import { spawnSync } from "node:child_process";
import { unlinkSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import "@ai-contact-center/config/load-root-env";
import { PrismaClient } from "../src/generated/index.js";

type ColumnRow = {
  table_name: string;
  column_name: string;
  data_type: string;
  udt_name: string;
  is_nullable: string;
  column_default: string | null;
  character_maximum_length: number | null;
  numeric_precision: number | null;
  numeric_scale: number | null;
};

type FkRow = {
  table_name: string;
  column_name: string;
  foreign_table_schema: string;
  foreign_table_name: string;
  foreign_column_name: string;
};

type UniqueRow = {
  table_name: string;
  constraint_name: string;
  columns: string;
};

type SchemaConfig = {
  schema: string;
  outFile: string;
  title: string;
  intro: string;
  tableFilter?: Set<string>;
  tableDescriptions: Record<string, string>;
};

const CCASS_TABLE_DESCRIPTIONS: Record<string, string> = {
  agents:
    "Operational agent profile published from setup; links a platform user to CCaaS routing and workspace identity.",
  queues:
    "Published routing queue snapshot from accounts setup; holds team, skills, and business-hours metadata for live routing.",
  queue_members:
    "Agent membership in a queue with per-channel concurrency limits and channel-handling flags.",
  agent_presence:
    "Current presence state for each agent (ready, busy, offline, etc.) used by routing and supervisor views.",
  agent_presence_history:
    "Append-only history of agent presence transitions for auditing and reporting.",
  presence_reason_codes:
    "Organization-configurable reason codes mapped to presence states (e.g. break, training).",
  agent_capacity:
    "Per-agent, per-channel active and reserved conversation counts against max concurrency.",
  agent_missed_contacts:
    "Missed or abandoned contact notifications when an agent does not answer an offer or routing fails.",
  agent_not_ready_escalations:
    "Supervisor escalation after repeated Not Ready presence dismissals.",
  skills: "Skill catalog used for skill-based routing and queue requirements.",
  agent_skills: "Skills assigned to agents with proficiency, priority, and optional expiry.",
  queue_skills: "Required or preferred skills for a queue with minimum proficiency and weight.",
  queue_routing_profiles:
    "NLP/routing metadata for a queue: intents, keywords, example phrases, and skill mapping.",
  routing_policies:
    "Queue routing strategy configuration (strategy, offer timeout, overflow, after-contact work).",
  routing_cursors: "Round-robin cursor state per queue for fair agent rotation.",
  routing_attempts:
    "Log of routing attempts for a conversation including candidate scores and outcomes.",
  missed_contact_reasons:
    "Lookup of missed-contact reason codes and display labels.",
  onboarding_dashboard_codes:
    "Hashed single-use codes for Accounts set-password → Contact Center dashboard deep-link.",
  proactive_callback_attempts:
    "Audit log for co-worker proactive missed-callback auto-assign attempts.",
  conversations:
    "Core omnichannel conversation session: channel, assignment, lifecycle status, and contact linkage.",
  webchat_sessions:
    "Webchat visitor session bound to a conversation (token, page context, connection state).",
  conversation_participants:
    "Participants in a conversation (customer, visitor, agent identities) by reference key.",
  conversation_messages:
    "All messages in a conversation across channels with direction, visibility, and delivery state.",
  conversation_message_attachments:
    "File attachments linked to conversation messages with storage metadata.",
  conversation_sentiment_turns:
    "Per-message dual-axis sentiment (customer + agent) for live workspace sessions.",
  message_receipts:
    "Read/delivery receipts for messages (customer or agent recipients).",
  message_delivery_attempts:
    "Outbound delivery attempt log for channel providers (retries, errors).",
  conversation_assignments:
    "Agent offer/accept/reject/end lifecycle for conversation ownership.",
  conversation_transfers:
    "Warm/blind transfer requests between queues or agents with state tracking.",
  conversation_dispositions:
    "Disposition codes applied when resolving or closing conversations.",
  dispositions:
    "Organization disposition catalog (codes, labels, categories) for wrap-up.",
  conversation_notes:
    "Agent notes attached to a conversation (customer-visible or internal).",
  conversation_memory:
    "Persisted NLP/context memory snippets associated with a conversation.",
  conversation_sla_state:
    "Active SLA timers (first response, resolution) and breach markers for a conversation.",
  sla_policies: "SLA policy definitions (thresholds, warning percentages) referenced by queues.",
  nlp_conversations:
    "NLP runtime session bound to a conversation (bot type, external NLP thread id).",
  nlp_turns:
    "Individual NLP turns (customer/agent/bot) with intent, sentiment, and extracted facts.",
  nlp_skills: "Registered NLP skills available to bots and copilot.",
  nlp_skill_versions: "Versioned skill definitions with prompts and configuration.",
  nlp_skill_bindings: "Bindings between NLP skills and channels/queues/bots.",
  nlp_skill_tools: "MCP/tool definitions exposed to an NLP skill version.",
  nlp_skill_activation_history: "Audit log of skill activations during NLP runs.",
  copilot_sessions: "Agent copilot chat sessions in the workspace.",
  copilot_turns: "Turns within a copilot session (user prompts and assistant responses).",
  copilot_memory: "Long-lived copilot memory entries scoped to agent or organization.",
  copilot_skill_executions:
    "Record of copilot skill/tool invocations with inputs and results.",
  channel_automation_policies:
    "Per-channel automation policy (bot enabled, confidence threshold, handoff behavior).",
  email_mailbox_policies:
    "Email mailbox automation: bot, queue defaults, allowed queues, and routing rules.",
  email_provider_events:
    "Inbound email provider webhook/pubsub events for idempotent processing.",
  email_delivery_outbox:
    "Reliable outbound email send queue with retry scheduling.",
  whatsapp_channel_policies:
    "WhatsApp-specific channel policy overrides (default queue, bot settings).",
  agent_tasks:
    "Agent task inbox items (callbacks, follow-ups, co-worker suggestions) linked to contacts/conversations.",
  scheduled_reports: "Scheduled admin performance PDF report definitions.",
  scheduled_report_runs: "Execution history and artifacts for scheduled reports.",
  workspace_common_notes:
    "Shared notes visible across the agent workspace (not tied to one conversation).",
  audit_log: "Operational audit trail for sensitive CCaaS actions.",
  schema_migrations: "Applied SQL migration ledger for the ccass schema.",
};

const CDP_TABLE_DESCRIPTIONS: Record<string, string> = {
  contacts: "Canonical customer record; logical target of conversations.contact_id.",
  contact_identities:
    "Channel identity (email, phone, visitor id) mapped to a canonical contact.",
  customer_profile:
    "Enriched customer profile (name, location, custom fields) keyed by cdp_id.",
  identity_keys:
    "Typed identity keys (email, phone, whatsapp) used for contact resolution and merge.",
  interactions:
    "Projected conversation summary row — one per ccass conversation for analytics/CRM.",
  interaction_events:
    "Timeline events projected from conversation lifecycle (message, handoff, resolve).",
  customer_journey: "Aggregated journey stages across channels for a contact.",
  journey_states: "Journey state machine nodes for customer lifecycle analytics.",
  gold_customer_metrics: "Pre-aggregated customer KPIs for reporting dashboards.",
};

const ACCOUNTS_TABLE_DESCRIPTIONS: Record<string, string> = {
  organizations: "Tenant organization; root scope for all setup and runtime data.",
  setup_users: "Platform users (agents, admins) configured in My Account setup.",
  setup_teams: "Teams used to group agents and assign queue ownership.",
  setup_roles: "Role definitions and permissions for setup users.",
  setup_channel_configs:
    "Parent channel configuration row (webchat, email, social, voice).",
  setup_webchat_configs: "Webchat widget settings linked to a channel config.",
  setup_email_configs: "Email mailbox OAuth and routing settings.",
  setup_social_configs: "WhatsApp/Instagram/Facebook connector settings.",
  setup_ccaas_queues: "Queue definitions authored in setup; published to ccass.queues.",
  setup_ccaas_queue_agents:
    "Agent membership on a setup queue; published to ccass.queue_members.",
  setup_queue_routing_profiles: "Classifier metadata (intents, keywords) for a setup queue.",
  setup_business_hours: "Business hours profiles referenced by queues.",
  setup_business_hour_shifts: "Shift windows within a business hours profile.",
  setup_holiday_calendars: "Holiday calendar definitions for queue availability.",
  setup_holidays: "Individual holiday dates within a calendar.",
  setup_knowledge_documents: "Knowledge base documents for bot/copilot retrieval.",
  setup_knowledge_org_profiles: "Org-level knowledge/RAG profile settings.",
  routing_profile_types:
    "Global lookup of organization routing types (1 long wait, 2 sticky, 3 skill).",
  setup_organization_routing_profiles:
    "One routing profile per organization; independent of queue classifier profiles.",
  setup_organization_recording_settings:
    "Organization-level voice recording: master switch, inbound/outbound, consent notice, prompt, and agent access.",
  setup_crm_channel_agents: "CRM channel agent assignments on a channel config.",
  setup_user_product_access: "Product access grants for setup users.",
  setup_user_invite_tokens: "Pending user invite tokens for onboarding.",
};

const ACCOUNTS_CCAAS_TABLES = new Set(Object.keys(ACCOUNTS_TABLE_DESCRIPTIONS));

const COLUMN_DESCRIPTIONS: Record<string, string> = {
  "conversations.status":
    "Legacy authoritative lifecycle status (bot_active, queued, assigned, active, resolved, closed).",
  "conversations.lifecycle_state":
    "Normalized lifecycle state (bot, waiting, offered, connected, wrap_up, ended) parallel to status.",
  "conversations.external_thread_id":
    "Channel-specific session/thread identifier; unique per org+channel.",
  "conversations.provider_thread_id":
    "Provider-native thread id (email Message-Id chain, WhatsApp wa_id thread, etc.).",
  "conversations.previous_conversation_id":
    "Prior closed conversation in the same customer thread when a new session is opened.",
  "conversations.visitor_id":
    "Channel visitor identifier (webchat visitor id, email address, social psid, etc.).",
  "conversations.contact_id": "Link to cdp.contacts canonical customer record when resolved.",
  "conversations.bot_active": "Whether the AI bot is currently handling the conversation.",
  "conversations.channel_config_id":
    "Reference to accounts.setup_channel_configs for channel-specific settings.",
  "conversation_assignments.state":
    "Assignment state: offered, accepted, rejected, ended.",
  "conversation_assignments.expires_at": "Offer expiry for ringing/accept-timeout flows.",
  "agent_tasks.task_type": "Task category: follow_up, callback, escalation, suggestion.",
  "agent_tasks.source": "Origin: self, admin, coworker, system.",
  "agent_presence.presence_state":
    "Enterprise presence state (offline, ready, busy, not_ready, after_contact_work).",
  "agent_presence.status": "Legacy simplified presence used by older routing paths.",
  "routing_profile_types.id":
    "Routing type number stored on the organization profile (1 long wait, 2 sticky, 3 skill).",
  "routing_profile_types.code": "Stable machine-readable code (long_wait, sticky, skill).",
  "routing_profile_types.sort_order": "Display order in the Routing tab (ascending).",
  "setup_organization_routing_profiles.routing_type_id":
    "Selected routing type number (1 long wait, 2 sticky, 3 skill).",
  "setup_organization_routing_profiles.long_wait_seconds":
    "Wait threshold in seconds when type is 1; NULL for other types.",
  "setup_organization_recording_settings.recording_enabled":
    "Master voice recording switch for the organization.",
  "setup_organization_recording_settings.inbound_enabled":
    "Record inbound voice calls when recording is on.",
  "setup_organization_recording_settings.outbound_enabled":
    "Record outbound voice calls when recording is on.",
  "setup_organization_recording_settings.consent_notice_enabled":
    "Play a consent notice (prompt) before recording.",
  "setup_organization_recording_settings.consent_prompt_id":
    "Voice prompt profile played as the consent notice; NULL when unset.",
  "setup_organization_recording_settings.agent_access_enabled":
    "Whether agents can access recordings for this organization.",
  "conversations.direction":
    "Conversation direction: inbound (customer-initiated) or outbound (agent callback).",
  "routing_policies.strategy":
    "Routing algorithm key (e.g. skill_round_robin, longest_idle).",
  "routing_policies.missed_callback_grace_minutes":
    "Minutes after a miss before co-worker auto-assigns a callback task (NULL=off).",
  "nlp_turns.intent": "Classified customer intent for the turn.",
  "email_delivery_outbox.status": "Outbox send state: pending, sending, sent, failed.",
  "agent_missed_contacts.reason":
    "Missed-contact reason code (FK to missed_contact_reasons): no_agent_available or offer_timeout.",
  "interactions.conversation_id": "Source ccass.conversations.id for this projection.",
  "contact_identities.identity_type": "Channel identity type (email, phone, webchat_visitor, social_psid).",
  "customer_profile.cdp_id": "Primary customer profile key; same as contacts.id when unified.",
  "customer_profile.blocked":
    "When true, inbound and outbound voice for this contact should be blocked.",
};

const COMMON_COLUMN_DESCRIPTIONS: Record<string, string> = {
  id: "Surrogate primary key.",
  organization_id: "Tenant scope; references accounts.organizations.",
  created_at: "Row creation timestamp (UTC).",
  updated_at: "Last update timestamp (UTC).",
  version: "Optimistic concurrency / change counter.",
  metadata: "Flexible JSONB payload for extensibility.",
  status: "Domain-specific status enum for this entity.",
  state: "Workflow state for this entity.",
  reason: "Human-readable reason or trigger for the action.",
  notes: "Free-text notes.",
  title: "Short display title.",
  summary: "Longer text summary or description.",
  priority: "Relative priority (higher = more urgent where applicable).",
  channel: "Omnichannel identifier (webchat, email, whatsapp, instagram, facebook, voice).",
  channel_type: "Setup channel type (web_chat, email, social, voice).",
  source: "Origin system or actor that created the record.",
  body: "Primary text content (message body, note text, etc.).",
  subject: "Conversation or email subject line.",
  external_id: "Provider-external identifier for idempotent ingest.",
  identity_ref: "Participant identity key (email, visitor id, psid, etc.).",
  participant_type: "Participant role (customer, visitor, agent, system).",
  sender_type: "Message sender role (customer, agent, bot, system).",
  direction: "Message direction: inbound or outbound.",
  visibility: "Audience visibility (customer, internal, system).",
  delivery_state: "Delivery pipeline state for the message.",
  proficiency: "Skill proficiency level (integer scale).",
  attempt_number: "Sequential attempt counter for retries/routing.",
  outcome: "Result of the attempt or routing decision.",
  expires_at: "Expiry timestamp after which the record is stale.",
  ended_at: "Timestamp when the session/assignment/history ended.",
  started_at: "Timestamp when the session or interval started.",
  accepted_at: "Timestamp when an offer or transfer was accepted.",
  rejected_at: "Timestamp when an offer was rejected.",
  offered_at: "Timestamp when an offer was presented to an agent.",
  queued_at: "Timestamp when the conversation entered queue.",
  assigned_at: "Timestamp when an agent was assigned.",
  resolved_at: "Timestamp when the conversation was resolved.",
  closed_at: "Timestamp when the conversation was closed.",
  first_response_at: "Timestamp of the first agent response (SLA metric).",
  contact_id: "Canonical customer contact in cdp when linked.",
  conversation_id: "Parent conversation this row belongs to.",
  agent_id: "Agent referenced in ccass.agents.",
  queue_id: "Queue referenced in ccass.queues or accounts.setup_ccaas_queues.",
  message_id: "Message referenced in ccass.conversation_messages.",
  skill_id: "Skill referenced in ccass.skills.",
  setup_user_id: "Platform user id from accounts.setup_users.",
  setup_queue_id: "Source queue id from accounts.setup_ccaas_queues.",
  task_type: "Task category: follow_up, callback, escalation, suggestion.",
  due_at: "Task due date/time for agent inbox sorting.",
  completed_at: "Timestamp when the task was completed.",
  dismissed_at: "Timestamp when the task was dismissed.",
  assigned_user_id: "Platform user id of the assigned agent.",
  assigned_by_label: "Display label for who assigned the task.",
  bot_active: "Whether the AI bot is actively handling the conversation.",
  nlp_enabled: "Whether NLP processing is enabled for the conversation.",
  live_agent_enabled: "Whether live-agent handoff is allowed for the conversation.",
  handoff_reason: "Reason the conversation was handed off from bot to queue/agent.",
  lifecycle_state: "Normalized lifecycle state parallel to legacy status.",
  provider_thread_id: "Native provider thread identifier for session continuity.",
  external_thread_id: "Channel session/thread id; unique per org+channel.",
  visitor_id: "Channel-specific visitor/customer identifier.",
  webchat_id: "Webchat widget configuration id.",
  channel_config_id: "Reference to accounts.setup_channel_configs.",
  mailbox_connection_id: "Email mailbox connection for email-channel rows.",
  policy_version: "Version stamp of the automation policy applied.",
  automation_policy_version: "Version of channel/mailbox automation policy in effect.",
  rfc_message_id: "Email RFC Message-Id header value.",
  next_attempt_at: "Scheduled time for the next retry attempt.",
  error_message: "Last error message from a failed operation.",
  provider_response: "Raw JSON response from an external provider.",
  candidate_scores: "JSON array of routing candidate scores.",
  skip_reasons: "JSON array explaining why candidates were skipped.",
  supported_intents: "JSON array of intents this queue handles.",
  example_phrases: "JSON array of routing classifier example phrases.",
  keywords: "JSON array of routing keywords.",
  language_codes: "JSON array of supported ISO language codes.",
  skill_mapping: "JSON map of skill keys to routing weights.",
  shift_types: "JSON array of shift types configured on the queue.",
  skills: "JSON array of skill keys published with the queue.",
  prechat_answers: "JSON object of webchat pre-chat form answers.",
  consent: "JSON object capturing visitor consent selections.",
  page_origin: "Webchat page origin URL host.",
  page_url: "Full page URL where webchat was opened.",
  token_hash: "Hashed session token for webchat authentication.",
  connection_state: "Webchat websocket connection state.",
  important_facts: "JSON array of extracted facts from NLP turn.",
  knowledge_references: "JSON array of knowledge base citations.",
  intent: "Classified customer intent for the NLP turn.",
  sentiment: "Detected sentiment for the NLP turn.",
  runtime_type: "NLP runtime profile (webchat_bot, whatsapp_bot, copilot, etc.).",
  disposition_code: "Applied wrap-up disposition code.",
  resolution_code: "Applied resolution code.",
  is_active: "Soft-active flag; inactive rows are hidden from pickers.",
  is_final: "Whether this disposition/resolution closes the conversation.",
  requires_note: "Whether selecting this reason code requires a note.",
  label: "Human-readable display label.",
  code: "Stable machine-readable code key.",
  name: "Display name.",
  description: "Longer descriptive text.",
  published_at: "Timestamp when the queue snapshot was published to ccass.",
  team_id: "Team owning the queue (accounts.setup_teams).",
  business_hours_id: "Business hours profile applied to the queue.",
  missed_callback_grace_minutes:
    "Minutes after miss before co-worker callback auto-assign (NULL=off, 0=immediate).",
  missed_contact_id: "Source ccass.agent_missed_contacts row for proactive callback.",
  acknowledged_at: "Timestamp when the agent or supervisor acknowledged the notification.",
  missed_at: "Timestamp when the contact was missed or abandoned.",
  customer_name: "Display name captured at time of miss.",
  customer_email: "Customer email captured at time of miss.",
  customer_phone: "Customer phone captured at time of miss.",
  assignment_id: "Related ccass.conversation_assignments.id when applicable.",
  event_type: "Interaction event type (message, handoff, resolve, transfer, etc.).",
  event_sequence: "Monotonic sequence for ordering projected events.",
  cdp_id: "Customer data platform profile identifier.",
  identity_type: "Type of channel identity key.",
  identity_value: "Normalized identity value (email, phone, visitor id).",
  custom_fields: "JSONB extensibility bag on customer profile.",
  mergedInto: "Winner contact id when this profile was merged (in custom_fields).",
  product_ids: "JSON array of product ids enabled on this channel config.",
};

function columnDescription(
  table: string,
  col: ColumnRow,
  fk: string | undefined,
): string {
  const key = `${table}.${col.column_name}`;
  if (COLUMN_DESCRIPTIONS[key]) return COLUMN_DESCRIPTIONS[key];
  if (COMMON_COLUMN_DESCRIPTIONS[col.column_name]) return COMMON_COLUMN_DESCRIPTIONS[col.column_name]!;
  if (fk) return `FK → \`${fk}\`.`;
  return "";
}

function formatType(col: ColumnRow): string {
  if (col.data_type === "character varying" && col.character_maximum_length) {
    return `varchar(${col.character_maximum_length})`;
  }
  if (col.data_type === "numeric" && col.numeric_precision) {
    return col.numeric_scale
      ? `numeric(${col.numeric_precision},${col.numeric_scale})`
      : `numeric(${col.numeric_precision})`;
  }
  if (col.data_type === "ARRAY") return `${col.udt_name.replace(/^_/, "")}[]`;
  if (col.data_type === "USER-DEFINED") return col.udt_name;
  return col.data_type;
}

function buildMarkdown(
  config: SchemaConfig,
  data: {
    tables: { table_name: string }[];
    cols: ColumnRow[];
    pk: { table_name: string; column_name: string }[];
    fks: FkRow[];
    unique: UniqueRow[];
  },
): string {
  const pkByTable = new Map<string, string[]>();
  for (const row of data.pk) {
    const list = pkByTable.get(row.table_name) ?? [];
    list.push(row.column_name);
    pkByTable.set(row.table_name, list);
  }

  const fkByTableCol = new Map<string, string>();
  for (const row of data.fks) {
    fkByTableCol.set(
      `${row.table_name}.${row.column_name}`,
      `${row.foreign_table_schema}.${row.foreign_table_name}.${row.foreign_column_name}`,
    );
  }

  const uniqueByTable = new Map<string, string[]>();
  for (const row of data.unique) {
    const list = uniqueByTable.get(row.table_name) ?? [];
    list.push(row.columns);
    uniqueByTable.set(row.table_name, list);
  }

  const colsByTable = new Map<string, ColumnRow[]>();
  for (const col of data.cols) {
    const list = colsByTable.get(col.table_name) ?? [];
    list.push(col);
    colsByTable.set(col.table_name, list);
  }

  const defaultDesc = `${config.schema} table used by the contact center.`;

  const lines: string[] = [
    config.title,
    "",
    config.intro,
    "",
    "Generated from live PostgreSQL introspection. Regenerate with:",
    "",
    "```bash",
    "npx tsx packages/db-cc/scripts/generate-schema-docs.ts",
    "```",
    "",
    "## Table Index",
    "",
    ...data.tables.map(
      (t) =>
        `- [\`${t.table_name}\`](#${t.table_name.replace(/_/g, "-")}) — ${config.tableDescriptions[t.table_name] ?? defaultDesc}`,
    ),
    "",
  ];

  for (const { table_name } of data.tables) {
    const columns = colsByTable.get(table_name) ?? [];
    const pkCols = pkByTable.get(table_name) ?? [];
    const uniques = uniqueByTable.get(table_name) ?? [];

    lines.push(`## ${table_name}`, "");
    lines.push(
      `**Description:** ${config.tableDescriptions[table_name] ?? defaultDesc}`,
      "",
    );

    if (pkCols.length) {
      lines.push(`**Primary key:** \`${pkCols.join("`, `")}\``, "");
    }
    if (uniques.length) {
      lines.push("**Unique constraints:**", "");
      for (const u of uniques) {
        lines.push(`- \`(${u})\``);
      }
      lines.push("");
    }

    lines.push("### Columns", "");
    lines.push("| Column | Type | Nullable | Default | Description |");
    lines.push("| --- | --- | --- | --- | --- |");

    for (const col of columns) {
      const key = `${table_name}.${col.column_name}`;
      const fk = fkByTableCol.get(key);
      const desc = columnDescription(table_name, col, fk);
      const nullable = col.is_nullable === "YES" ? "yes" : "no";
      const def = col.column_default
        ? `\`${col.column_default.replace(/\s+/g, " ").slice(0, 80)}\``
        : "";
      lines.push(
        `| \`${col.column_name}\` | ${formatType(col)} | ${nullable} | ${def} | ${desc} |`,
      );
    }

    lines.push("");
  }

  return lines.join("\n");
}

async function introspectSchema(db: PrismaClient, schema: string, tableFilter?: Set<string>) {
  const allTables = await db.$queryRaw<{ table_name: string }[]>`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = ${schema} AND table_type = 'BASE TABLE'
    ORDER BY table_name
  `;
  const tables = tableFilter
    ? allTables.filter((t) => tableFilter.has(t.table_name))
    : allTables;

  const tableNames = tables.map((t) => t.table_name);
  if (tableNames.length === 0) {
    return { tables, cols: [], pk: [], fks: [], unique: [] };
  }

  const cols = await db.$queryRaw<ColumnRow[]>`
    SELECT table_name, column_name, data_type, udt_name, is_nullable, column_default,
           character_maximum_length, numeric_precision, numeric_scale
    FROM information_schema.columns
    WHERE table_schema = ${schema}
    ORDER BY table_name, ordinal_position
  `;

  const pk = await db.$queryRaw<{ table_name: string; column_name: string }[]>`
    SELECT tc.table_name, kcu.column_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
    WHERE tc.table_schema = ${schema} AND tc.constraint_type = 'PRIMARY KEY'
    ORDER BY tc.table_name, kcu.ordinal_position
  `;

  const fks = await db.$queryRaw<FkRow[]>`
    SELECT tc.table_name, kcu.column_name,
           ccu.table_schema AS foreign_table_schema,
           ccu.table_name AS foreign_table_name,
           ccu.column_name AS foreign_column_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
    JOIN information_schema.constraint_column_usage ccu
      ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
    WHERE tc.table_schema = ${schema} AND tc.constraint_type = 'FOREIGN KEY'
    ORDER BY tc.table_name, kcu.column_name
  `;

  const unique = await db.$queryRaw<UniqueRow[]>`
    SELECT tc.table_name, tc.constraint_name,
           string_agg(kcu.column_name, ', ' ORDER BY kcu.ordinal_position) AS columns
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
    WHERE tc.table_schema = ${schema} AND tc.constraint_type = 'UNIQUE'
    GROUP BY tc.table_name, tc.constraint_name
    ORDER BY tc.table_name
  `;

  const allowed = new Set(tableNames);
  const filterRows = <T extends { table_name: string }>(rows: T[]) =>
    rows.filter((r) => allowed.has(r.table_name));

  return {
    tables,
    cols: filterRows(cols),
    pk: filterRows(pk),
    fks: filterRows(fks),
    unique: filterRows(unique),
  };
}

const SCHEMA_CONFIGS: SchemaConfig[] = [
  {
    schema: "ccass",
    outFile: "docs/ccaas/ccass-schema.md",
    title: "# CCaaS Schema (`ccass`) Reference",
    intro:
      "Operational contact-center runtime schema: conversations, routing, presence, NLP/copilot, email/social delivery, and agent workspace data.",
    tableDescriptions: CCASS_TABLE_DESCRIPTIONS,
  },
  {
    schema: "cdp",
    outFile: "docs/ccaas/cdp-schema.md",
    title: "# Customer Data Platform Schema (`cdp`) Reference",
    intro:
      "Customer projection and interaction history for CRM, contacts UI, reporting, and co-worker. Derived from ccass via projection jobs — do not drive routing from CDP.",
    tableDescriptions: CDP_TABLE_DESCRIPTIONS,
  },
  {
    schema: "accounts",
    outFile: "docs/ccaas/accounts-schema.md",
    title: "# Accounts Setup Schema (`accounts`) — Contact Center Tables",
    intro:
      "Tenant configuration tables used by the contact center: organizations, users, channels, queues, and business hours. Published into `ccass` at runtime.",
    tableFilter: ACCOUNTS_CCAAS_TABLES,
    tableDescriptions: ACCOUNTS_TABLE_DESCRIPTIONS,
  },
];

async function main(): Promise<void> {
  const db = new PrismaClient();
  const docsRoot = resolve(process.cwd(), "docs/ccaas");

  try {
    for (const config of SCHEMA_CONFIGS) {
      const data = await introspectSchema(db, config.schema, config.tableFilter);
      const markdown = buildMarkdown(config, data);
      const outPath = resolve(process.cwd(), config.outFile);
      writeFileSync(outPath, markdown, "utf8");
      console.log(
        `Wrote snapshot ${outPath} (${data.tables.length} tables, ${data.cols.length} columns)`,
      );
    }
    const convert = spawnSync(
      "python3",
      [resolve(process.cwd(), "packages/db-cc/scripts/convert_schema_docs.py")],
      { stdio: "inherit", cwd: process.cwd() },
    );
    if (convert.status !== 0) {
      throw new Error("Failed to assemble CONTACT_CENTER_SCHEMA.md");
    }
    for (const config of SCHEMA_CONFIGS) {
      unlinkSync(resolve(process.cwd(), config.outFile));
    }
    console.log(`\nDocs: ${docsRoot}/CONTACT_CENTER_SCHEMA.md`);
  } finally {
    await db.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
