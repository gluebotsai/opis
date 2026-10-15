# CCaaS Schema (`ccass`) Reference

Operational contact-center runtime schema: conversations, routing, presence, NLP/copilot, email/social delivery, and agent workspace data.

Generated from live PostgreSQL introspection. Regenerate with:

```bash
npx tsx packages/db-cc/scripts/generate-ccass-schema-doc.ts
```

## Table Index

- [`agent_capacity`](#agent-capacity) — Per-agent, per-channel active and reserved conversation counts against max concurrency.
- [`agent_presence`](#agent-presence) — Current presence state for each agent (ready, busy, offline, etc.) used by routing and supervisor views.
- [`agent_presence_history`](#agent-presence-history) — Append-only history of agent presence transitions for auditing and reporting.
- [`agent_skills`](#agent-skills) — Skills assigned to agents with proficiency, priority, and optional expiry.
- [`agent_tasks`](#agent-tasks) — Agent task inbox items (callbacks, follow-ups, co-worker suggestions) linked to contacts/conversations.
- [`agents`](#agents) — Operational agent profile published from setup; links a platform user to CCaaS routing and workspace identity.
- [`audit_log`](#audit-log) — Operational audit trail for sensitive CCaaS actions.
- [`channel_automation_policies`](#channel-automation-policies) — Per-channel automation policy (bot enabled, confidence threshold, handoff behavior).
- [`conversation_assignments`](#conversation-assignments) — Agent offer/accept/reject/end lifecycle for conversation ownership.
- [`conversation_dispositions`](#conversation-dispositions) — Disposition codes applied when resolving or closing conversations.
- [`conversation_memory`](#conversation-memory) — Persisted NLP/context memory snippets associated with a conversation.
- [`conversation_message_attachments`](#conversation-message-attachments) — File attachments linked to conversation messages with storage metadata.
- [`conversation_messages`](#conversation-messages) — All messages in a conversation across channels with direction, visibility, and delivery state.
- [`conversation_notes`](#conversation-notes) — Agent notes attached to a conversation (customer-visible or internal).
- [`conversation_participants`](#conversation-participants) — Participants in a conversation (customer, visitor, agent identities) by reference key.
- [`conversation_sla_state`](#conversation-sla-state) — Active SLA timers (first response, resolution) and breach markers for a conversation.
- [`conversation_transfers`](#conversation-transfers) — Warm/blind transfer requests between queues or agents with state tracking.
- [`conversations`](#conversations) — Core omnichannel conversation session: channel, assignment, lifecycle status, and contact linkage.
- [`copilot_memory`](#copilot-memory) — Long-lived copilot memory entries scoped to agent or organization.
- [`copilot_sessions`](#copilot-sessions) — Agent copilot chat sessions in the workspace.
- [`copilot_skill_executions`](#copilot-skill-executions) — Record of copilot skill/tool invocations with inputs and results.
- [`copilot_turns`](#copilot-turns) — Turns within a copilot session (user prompts and assistant responses).
- [`dispositions`](#dispositions) — Organization disposition catalog (codes, labels, categories) for wrap-up.
- [`email_delivery_outbox`](#email-delivery-outbox) — Reliable outbound email send queue with retry scheduling.
- [`email_mailbox_policies`](#email-mailbox-policies) — Email mailbox automation: bot, queue defaults, allowed queues, and routing rules.
- [`email_provider_events`](#email-provider-events) — Inbound email provider webhook/pubsub events for idempotent processing.
- [`message_delivery_attempts`](#message-delivery-attempts) — Outbound delivery attempt log for channel providers (retries, errors).
- [`message_receipts`](#message-receipts) — Read/delivery receipts for messages (customer or agent recipients).
- [`nlp_conversations`](#nlp-conversations) — NLP runtime session bound to a conversation (bot type, external NLP thread id).
- [`nlp_skill_activation_history`](#nlp-skill-activation-history) — Audit log of skill activations during NLP runs.
- [`nlp_skill_bindings`](#nlp-skill-bindings) — Bindings between NLP skills and channels/queues/bots.
- [`nlp_skill_tools`](#nlp-skill-tools) — MCP/tool definitions exposed to an NLP skill version.
- [`nlp_skill_versions`](#nlp-skill-versions) — Versioned skill definitions with prompts and configuration.
- [`nlp_skills`](#nlp-skills) — Registered NLP skills available to bots and copilot.
- [`nlp_turns`](#nlp-turns) — Individual NLP turns (customer/agent/bot) with intent, sentiment, and extracted facts.
- [`presence_reason_codes`](#presence-reason-codes) — Organization-configurable reason codes mapped to presence states (e.g. break, training).
- [`queue_members`](#queue-members) — Agent membership in a queue with per-channel concurrency limits and channel-handling flags.
- [`queue_routing_profiles`](#queue-routing-profiles) — NLP/routing metadata for a queue: intents, keywords, example phrases, and skill mapping.
- [`queue_skills`](#queue-skills) — Required or preferred skills for a queue with minimum proficiency and weight.
- [`queues`](#queues) — Published routing queue snapshot from accounts setup; holds team, skills, and business-hours metadata for live routing.
- [`routing_attempts`](#routing-attempts) — Log of routing attempts for a conversation including candidate scores and outcomes.
- [`routing_cursors`](#routing-cursors) — Round-robin cursor state per queue for fair agent rotation.
- [`routing_policies`](#routing-policies) — Queue routing strategy configuration (strategy, offer timeout, overflow, after-contact work).
- [`schema_migrations`](#schema-migrations) — Applied SQL migration ledger for the ccass schema.
- [`skills`](#skills) — Skill catalog used for skill-based routing and queue requirements.
- [`sla_policies`](#sla-policies) — SLA policy definitions (thresholds, warning percentages) referenced by queues.
- [`webchat_sessions`](#webchat-sessions) — Webchat visitor session bound to a conversation (token, page context, connection state).
- [`whatsapp_channel_policies`](#whatsapp-channel-policies) — WhatsApp-specific channel policy overrides (default queue, bot settings).
- [`workspace_common_notes`](#workspace-common-notes) — Shared notes visible across the agent workspace (not tied to one conversation).

## agent_capacity

**Description:** Per-agent, per-channel active and reserved conversation counts against max concurrency.

**Primary key:** `id`

**Unique constraints:**

- `(agent_id, channel)`

### Columns

| Column | Type | Nullable | Default | Description |
| --- | --- | --- | --- | --- |
| `id` | uuid | no | `gen_random_uuid()` | Surrogate primary key (UUID). |
| `organization_id` | uuid | no |  | Tenant scope; references accounts.organizations. |
| `agent_id` | uuid | no |  | Agent referenced in ccass.agents. |
| `channel` | varchar(32) | no | `'chat'::character varying` | Omnichannel identifier (webchat, email, whatsapp, instagram, facebook, voice). |
| `max_concurrency` | integer | no | `1` |  |
| `reserved_count` | integer | no | `0` |  |
| `active_count` | integer | no | `0` |  |
| `version` | integer | no | `1` | Optimistic concurrency / change counter. |
| `updated_at` | timestamp with time zone | no | `now()` | Last update timestamp (UTC). |

## agent_presence

**Description:** Current presence state for each agent (ready, busy, offline, etc.) used by routing and supervisor views.

**Primary key:** `id`

**Unique constraints:**

- `(agent_id)`

### Columns

| Column | Type | Nullable | Default | Description |
| --- | --- | --- | --- | --- |
| `id` | uuid | no | `gen_random_uuid()` | Surrogate primary key (UUID). |
| `organization_id` | uuid | no |  | Tenant scope; references accounts.organizations. |
| `agent_id` | uuid | no |  | Agent referenced in ccass.agents. |
| `status` | varchar(32) | no | `'offline'::character varying` | Legacy simplified presence used by older routing paths. |
| `updated_at` | timestamp with time zone | no | `now()` | Last update timestamp (UTC). |
| `presence_state` | varchar(32) | no | `'offline'::character varying` | Enterprise presence state (offline, ready, busy, not_ready, after_contact_work). |
| `reason_code` | varchar(64) | yes |  |  |
| `heartbeat_at` | timestamp with time zone | yes |  |  |
| `lease_expires_at` | timestamp with time zone | yes |  |  |
| `version` | integer | no | `1` | Optimistic concurrency / change counter. |
| `source` | varchar(32) | no | `'system'::character varying` | Origin system or actor that created the record. |

## agent_presence_history

**Description:** Append-only history of agent presence transitions for auditing and reporting.

**Primary key:** `id`

### Columns

| Column | Type | Nullable | Default | Description |
| --- | --- | --- | --- | --- |
| `id` | uuid | no | `gen_random_uuid()` | Surrogate primary key (UUID). |
| `organization_id` | uuid | no |  | Tenant scope; references accounts.organizations. |
| `agent_id` | uuid | no |  | Agent referenced in ccass.agents. |
| `previous_state` | varchar(32) | yes |  |  |
| `new_state` | varchar(32) | no |  |  |
| `reason_code` | varchar(64) | yes |  |  |
| `source` | varchar(32) | no | `'agent'::character varying` | Origin system or actor that created the record. |
| `started_at` | timestamp with time zone | no | `now()` | Timestamp when the session or interval started. |
| `ended_at` | timestamp with time zone | yes |  | Timestamp when the session/assignment/history ended. |

## agent_skills

**Description:** Skills assigned to agents with proficiency, priority, and optional expiry.

**Primary key:** `id`

**Unique constraints:**

- `(agent_id, skill_id)`

### Columns

| Column | Type | Nullable | Default | Description |
| --- | --- | --- | --- | --- |
| `id` | uuid | no | `gen_random_uuid()` | Surrogate primary key (UUID). |
| `organization_id` | uuid | no |  | Tenant scope; references accounts.organizations. |
| `agent_id` | uuid | no |  | Agent referenced in ccass.agents. |
| `skill_id` | uuid | no |  | Skill referenced in ccass.skills. |
| `proficiency` | integer | no | `1` | Skill proficiency level (integer scale). |
| `priority` | integer | no | `0` | Relative priority (higher = more urgent where applicable). |
| `verified_at` | timestamp with time zone | yes |  |  |
| `expires_at` | timestamp with time zone | yes |  | Expiry timestamp after which the record is stale. |
| `created_at` | timestamp with time zone | no | `now()` | Row creation timestamp (UTC). |

## agent_tasks

**Description:** Agent task inbox items (callbacks, follow-ups, co-worker suggestions) linked to contacts/conversations.

**Primary key:** `id`

### Columns

| Column | Type | Nullable | Default | Description |
| --- | --- | --- | --- | --- |
| `id` | uuid | no | `gen_random_uuid()` | Surrogate primary key (UUID). |
| `organization_id` | uuid | no |  | Tenant scope; references accounts.organizations. |
| `assigned_user_id` | uuid | no |  | Platform user id of the assigned agent. |
| `created_by_user_id` | uuid | yes |  |  |
| `contact_id` | uuid | yes |  | Canonical customer contact in cdp.contacts when linked. |
| `conversation_id` | uuid | yes |  | Parent conversation this row belongs to. |
| `task_type` | varchar(32) | no |  | Task category: follow_up, callback, escalation, suggestion. |
| `status` | varchar(32) | no | `'open'::character varying` | Domain-specific status enum for this entity. |
| `priority` | varchar(16) | no | `'normal'::character varying` | Relative priority (higher = more urgent where applicable). |
| `source` | varchar(16) | no |  | Origin: self, admin, coworker, system. |
| `title` | text | no |  | Short display title. |
| `summary` | text | no |  | Longer text summary or description. |
| `notes` | text | yes |  | Free-text notes. |
| `channel` | varchar(32) | yes |  | Omnichannel identifier (webchat, email, whatsapp, instagram, facebook, voice). |
| `due_at` | timestamp with time zone | yes |  | Task due date/time for agent inbox sorting. |
| `completed_at` | timestamp with time zone | yes |  | Timestamp when the task was completed. |
| `dismissed_at` | timestamp with time zone | yes |  | Timestamp when the task was dismissed. |
| `assigned_by_user_id` | uuid | yes |  |  |
| `assigned_by_label` | text | yes |  | Display label for who assigned the task. |
| `metadata` | jsonb | no | `'{}'::jsonb` | Flexible JSONB payload for extensibility. |
| `created_at` | timestamp with time zone | no | `now()` | Row creation timestamp (UTC). |
| `updated_at` | timestamp with time zone | no | `now()` | Last update timestamp (UTC). |

## agents

**Description:** Operational agent profile published from setup; links a platform user to CCaaS routing and workspace identity.

**Primary key:** `id`

**Unique constraints:**

- `(setup_user_id)`

### Columns

| Column | Type | Nullable | Default | Description |
| --- | --- | --- | --- | --- |
| `id` | uuid | no | `gen_random_uuid()` | Surrogate primary key (UUID). |
| `organization_id` | uuid | no |  | Tenant scope; references accounts.organizations. |
| `display_name` | varchar(255) | no |  |  |
| `email` | varchar(255) | yes |  |  |
| `status` | varchar(32) | no | `'active'::character varying` | Domain-specific status enum for this entity. |
| `created_at` | timestamp with time zone | no | `now()` | Row creation timestamp (UTC). |
| `updated_at` | timestamp with time zone | no | `now()` | Last update timestamp (UTC). |
| `setup_user_id` | uuid | yes |  | Platform user id from accounts.setup_users. |

## audit_log

**Description:** Operational audit trail for sensitive CCaaS actions.

**Primary key:** `id`

### Columns

| Column | Type | Nullable | Default | Description |
| --- | --- | --- | --- | --- |
| `id` | uuid | no | `gen_random_uuid()` | Surrogate primary key (UUID). |
| `organization_id` | uuid | no |  | Tenant scope; references accounts.organizations. |
| `actor_user_id` | uuid | yes |  |  |
| `actor_type` | varchar(32) | no | `'system'::character varying` |  |
| `action` | varchar(128) | no |  |  |
| `entity_type` | varchar(64) | no |  |  |
| `entity_id` | uuid | yes |  |  |
| `before_state` | jsonb | yes |  |  |
| `after_state` | jsonb | yes |  |  |
| `trace_id` | varchar(128) | yes |  |  |
| `created_at` | timestamp with time zone | no | `now()` | Row creation timestamp (UTC). |

## channel_automation_policies

**Description:** Per-channel automation policy (bot enabled, confidence threshold, handoff behavior).

**Primary key:** `id`

**Unique constraints:**

- `(organization_id, channel_config_id)`

### Columns

| Column | Type | Nullable | Default | Description |
| --- | --- | --- | --- | --- |
| `id` | uuid | no | `gen_random_uuid()` | Surrogate primary key (UUID). |
| `organization_id` | uuid | no |  | Tenant scope; references accounts.organizations. |
| `channel_config_id` | uuid | no |  | Reference to accounts.setup_channel_configs. |
| `channel` | varchar(32) | no |  | Omnichannel identifier (webchat, email, whatsapp, instagram, facebook, voice). |
| `bot_enabled` | boolean | no | `true` |  |
| `live_agent_enabled` | boolean | no | `true` | Whether live-agent handoff is allowed for the conversation. |
| `automation_mode` | varchar(32) | no | `'auto_send'::character varying` |  |
| `confidence_threshold` | numeric(4,3) | no | `0.850` |  |
| `default_queue_id` | uuid | yes |  |  |
| `allowed_queue_ids` | uuid[] | no | `'{}'::uuid[]` |  |
| `handoff_message` | text | yes |  |  |
| `no_agent_behavior` | varchar(32) | no | `'queue_and_notify'::character varying` |  |
| `inactivity_close_seconds` | integer | no | `86400` |  |
| `shadow_mode` | boolean | no | `false` |  |
| `policy_version` | integer | no | `1` | Version stamp of the automation policy applied. |
| `status` | varchar(16) | no | `'active'::character varying` | Domain-specific status enum for this entity. |
| `channel_settings` | jsonb | no | `'{}'::jsonb` |  |
| `source_metadata` | jsonb | no | `'{}'::jsonb` |  |
| `created_at` | timestamp with time zone | no | `now()` | Row creation timestamp (UTC). |
| `updated_at` | timestamp with time zone | no | `now()` | Last update timestamp (UTC). |

## conversation_assignments

**Description:** Agent offer/accept/reject/end lifecycle for conversation ownership.

**Primary key:** `id`

### Columns

| Column | Type | Nullable | Default | Description |
| --- | --- | --- | --- | --- |
| `id` | uuid | no | `gen_random_uuid()` | Surrogate primary key (UUID). |
| `organization_id` | uuid | no |  | Tenant scope; references accounts.organizations. |
| `conversation_id` | uuid | no |  | Parent conversation this row belongs to. |
| `queue_id` | uuid | yes |  | Queue referenced in ccass.queues. |
| `agent_id` | uuid | yes |  | Agent referenced in ccass.agents. |
| `routing_attempt_id` | uuid | yes |  | FK → `ccass.routing_attempts.id`. |
| `state` | varchar(32) | no | `'offered'::character varying` | Assignment state: offered, accepted, rejected, ended. |
| `reason` | varchar(128) | yes |  | Human-readable reason or trigger for the action. |
| `offered_at` | timestamp with time zone | no | `now()` | Timestamp when an offer was presented to an agent. |
| `accepted_at` | timestamp with time zone | yes |  | Timestamp when an offer or transfer was accepted. |
| `rejected_at` | timestamp with time zone | yes |  | Timestamp when an offer was rejected. |
| `expired_at` | timestamp with time zone | yes |  |  |
| `ended_at` | timestamp with time zone | yes |  | Timestamp when the session/assignment/history ended. |
| `expires_at` | timestamp with time zone | yes |  | Offer expiry for ringing/accept-timeout flows. |

## conversation_dispositions

**Description:** Disposition codes applied when resolving or closing conversations.

**Primary key:** `id`

### Columns

| Column | Type | Nullable | Default | Description |
| --- | --- | --- | --- | --- |
| `id` | uuid | no | `gen_random_uuid()` | Surrogate primary key (UUID). |
| `organization_id` | uuid | no |  | Tenant scope; references accounts.organizations. |
| `conversation_id` | uuid | no |  | Parent conversation this row belongs to. |
| `disposition_id` | uuid | no |  | FK → `ccass.dispositions.id`. |
| `agent_id` | uuid | yes |  | Agent referenced in ccass.agents. |
| `note` | text | yes |  |  |
| `applied_at` | timestamp with time zone | no | `now()` |  |
| `applied_by_user_id` | uuid | yes |  |  |
| `source` | varchar(32) | no | `'agent'::character varying` | Origin system or actor that created the record. |
| `resolution_code` | varchar(64) | yes |  | Applied resolution code. |
| `resolution_data` | jsonb | no | `'{}'::jsonb` |  |
| `is_final` | boolean | no | `false` | Whether this disposition/resolution closes the conversation. |
| `updated_at` | timestamp with time zone | no | `now()` | Last update timestamp (UTC). |

## conversation_memory

**Description:** Persisted NLP/context memory snippets associated with a conversation.

**Primary key:** `id`

**Unique constraints:**

- `(conversation_id)`

### Columns

| Column | Type | Nullable | Default | Description |
| --- | --- | --- | --- | --- |
| `id` | uuid | no | `gen_random_uuid()` | Surrogate primary key (UUID). |
| `organization_id` | uuid | no |  | Tenant scope; references accounts.organizations. |
| `conversation_id` | uuid | no |  | Parent conversation this row belongs to. |
| `rolling_summary` | text | yes |  |  |
| `extracted_facts` | jsonb | no | `'[]'::jsonb` |  |
| `latest_summarized_message_id` | uuid | yes |  | FK → `ccass.conversation_messages.id`. |
| `model_name` | varchar(128) | yes |  |  |
| `token_estimate` | integer | yes |  |  |
| `version` | integer | no | `1` | Optimistic concurrency / change counter. |
| `updated_at` | timestamp with time zone | no | `now()` | Last update timestamp (UTC). |

## conversation_message_attachments

**Description:** File attachments linked to conversation messages with storage metadata.

**Primary key:** `id`

**Unique constraints:**

- `(organization_id, external_id)`

### Columns

| Column | Type | Nullable | Default | Description |
| --- | --- | --- | --- | --- |
| `id` | uuid | no | `gen_random_uuid()` | Surrogate primary key (UUID). |
| `organization_id` | uuid | no |  | Tenant scope; references accounts.organizations. |
| `conversation_id` | uuid | no |  | Parent conversation this row belongs to. |
| `message_id` | uuid | no |  | Message referenced in ccass.conversation_messages. |
| `external_id` | varchar(512) | yes |  | Provider-external identifier for idempotent ingest. |
| `storage_key` | text | no |  |  |
| `file_name` | varchar(512) | no |  |  |
| `content_type` | varchar(255) | no |  |  |
| `byte_size` | bigint | no |  |  |
| `checksum_sha256` | varchar(64) | yes |  |  |
| `download_url` | text | yes |  |  |
| `status` | varchar(32) | no | `'available'::character varying` | Domain-specific status enum for this entity. |
| `metadata` | jsonb | no | `'{}'::jsonb` | Flexible JSONB payload for extensibility. |
| `created_at` | timestamp with time zone | no | `now()` | Row creation timestamp (UTC). |

## conversation_messages

**Description:** All messages in a conversation across channels with direction, visibility, and delivery state.

**Primary key:** `id`

**Unique constraints:**

- `(organization_id, external_id)`

### Columns

| Column | Type | Nullable | Default | Description |
| --- | --- | --- | --- | --- |
| `id` | uuid | no | `gen_random_uuid()` | Surrogate primary key (UUID). |
| `organization_id` | uuid | no |  | Tenant scope; references accounts.organizations. |
| `conversation_id` | uuid | no |  | Parent conversation this row belongs to. |
| `external_id` | varchar(512) | yes |  | Provider-external identifier for idempotent ingest. |
| `sender_type` | varchar(32) | no |  | Message sender role (customer, agent, bot, system). |
| `recipient_type` | varchar(32) | yes |  |  |
| `direction` | varchar(16) | no | `'inbound'::character varying` | Message direction: inbound or outbound. |
| `visibility` | varchar(16) | no | `'customer'::character varying` | Audience visibility (customer, internal, system). |
| `body` | text | no |  | Primary text content (message body, note text, etc.). |
| `attachments` | jsonb | no | `'[]'::jsonb` |  |
| `reply_to_message_id` | uuid | yes |  | FK → `ccass.conversation_messages.id`. |
| `delivery_state` | varchar(32) | no | `'delivered'::character varying` | Delivery pipeline state for the message. |
| `model_metadata` | jsonb | yes |  |  |
| `created_at` | timestamp with time zone | no | `now()` | Row creation timestamp (UTC). |
| `delivered_at` | timestamp with time zone | yes |  |  |
| `message_type` | varchar(32) | no | `'text'::character varying` |  |
| `attachment_count` | integer | no | `0` |  |
| `sent_at` | timestamp with time zone | yes |  |  |
| `rfc_message_id` | varchar(998) | yes |  | Email RFC Message-Id header value. |
| `in_reply_to` | varchar(998) | yes |  |  |
| `references_header` | text | yes |  |  |
| `provider_received_at` | timestamp with time zone | yes |  |  |
| `provider_headers` | jsonb | no | `'{}'::jsonb` |  |

## conversation_notes

**Description:** Agent notes attached to a conversation (customer-visible or internal).

**Primary key:** `id`

### Columns

| Column | Type | Nullable | Default | Description |
| --- | --- | --- | --- | --- |
| `id` | uuid | no | `gen_random_uuid()` | Surrogate primary key (UUID). |
| `organization_id` | uuid | no |  | Tenant scope; references accounts.organizations. |
| `conversation_id` | uuid | no |  | Parent conversation this row belongs to. |
| `author_user_id` | uuid | no |  |  |
| `body` | text | no |  | Primary text content (message body, note text, etc.). |
| `created_at` | timestamp with time zone | no | `now()` | Row creation timestamp (UTC). |
| `updated_at` | timestamp with time zone | no | `now()` | Last update timestamp (UTC). |

## conversation_participants

**Description:** Participants in a conversation (customer, visitor, agent identities) by reference key.

**Primary key:** `id`

### Columns

| Column | Type | Nullable | Default | Description |
| --- | --- | --- | --- | --- |
| `id` | uuid | no | `gen_random_uuid()` | Surrogate primary key (UUID). |
| `organization_id` | uuid | no |  | Tenant scope; references accounts.organizations. |
| `conversation_id` | uuid | no |  | Parent conversation this row belongs to. |
| `participant_type` | varchar(32) | no |  | Participant role (customer, visitor, agent, system). |
| `identity_ref` | varchar(128) | no |  | Participant identity key (email, visitor id, psid, etc.). |
| `joined_at` | timestamp with time zone | no | `now()` |  |
| `left_at` | timestamp with time zone | yes |  |  |

## conversation_sla_state

**Description:** Active SLA timers (first response, resolution) and breach markers for a conversation.

**Primary key:** `id`

**Unique constraints:**

- `(conversation_id)`

### Columns

| Column | Type | Nullable | Default | Description |
| --- | --- | --- | --- | --- |
| `id` | uuid | no | `gen_random_uuid()` | Surrogate primary key (UUID). |
| `organization_id` | uuid | no |  | Tenant scope; references accounts.organizations. |
| `conversation_id` | uuid | no |  | Parent conversation this row belongs to. |
| `sla_policy_id` | uuid | yes |  | FK → `ccass.sla_policies.id`. |
| `first_response_due_at` | timestamp with time zone | yes |  |  |
| `resolution_due_at` | timestamp with time zone | yes |  |  |
| `first_response_warning_at` | timestamp with time zone | yes |  |  |
| `resolution_warning_at` | timestamp with time zone | yes |  |  |
| `breached_at` | timestamp with time zone | yes |  |  |
| `updated_at` | timestamp with time zone | no | `now()` | Last update timestamp (UTC). |

## conversation_transfers

**Description:** Warm/blind transfer requests between queues or agents with state tracking.

**Primary key:** `id`

### Columns

| Column | Type | Nullable | Default | Description |
| --- | --- | --- | --- | --- |
| `id` | uuid | no | `gen_random_uuid()` | Surrogate primary key (UUID). |
| `organization_id` | uuid | no |  | Tenant scope; references accounts.organizations. |
| `conversation_id` | uuid | no |  | Parent conversation this row belongs to. |
| `from_queue_id` | uuid | yes |  | FK → `ccass.queues.id`. |
| `from_agent_id` | uuid | yes |  | FK → `ccass.agents.id`. |
| `from_user_id` | uuid | yes |  |  |
| `to_queue_id` | uuid | no |  | FK → `ccass.queues.id`. |
| `requested_agent_id` | uuid | yes |  | FK → `ccass.agents.id`. |
| `offered_agent_id` | uuid | yes |  | FK → `ccass.agents.id`. |
| `requested_by_user_id` | uuid | yes |  |  |
| `state` | varchar(32) | no | `'requested'::character varying` | Workflow state for this entity. |
| `notes` | text | yes |  | Free-text notes. |
| `disposition_code` | varchar(64) | yes |  | Applied wrap-up disposition code. |
| `resolution_code` | varchar(64) | yes |  | Applied resolution code. |
| `resolution_data` | jsonb | no | `'{}'::jsonb` |  |
| `routing_attempt_id` | uuid | yes |  | FK → `ccass.routing_attempts.id`. |
| `requested_at` | timestamp with time zone | no | `now()` |  |
| `offered_at` | timestamp with time zone | yes |  | Timestamp when an offer was presented to an agent. |
| `accepted_at` | timestamp with time zone | yes |  | Timestamp when an offer or transfer was accepted. |
| `completed_at` | timestamp with time zone | yes |  | Timestamp when the task was completed. |
| `cancelled_at` | timestamp with time zone | yes |  |  |
| `updated_at` | timestamp with time zone | no | `now()` | Last update timestamp (UTC). |

## conversations

**Description:** Core omnichannel conversation session: channel, assignment, lifecycle status, and contact linkage.

**Primary key:** `id`

**Unique constraints:**

- `(organization_id, channel, external_thread_id)`

### Columns

| Column | Type | Nullable | Default | Description |
| --- | --- | --- | --- | --- |
| `id` | uuid | no | `gen_random_uuid()` | Surrogate primary key (UUID). |
| `organization_id` | uuid | no |  | Tenant scope; references accounts.organizations. |
| `channel` | varchar(32) | no | `'webchat'::character varying` | Omnichannel identifier (webchat, email, whatsapp, instagram, facebook, voice). |
| `external_thread_id` | varchar(128) | no |  | Channel-specific session/thread identifier; unique per org+channel. |
| `webchat_id` | varchar(64) | yes |  | Webchat widget configuration id. |
| `visitor_id` | varchar(128) | yes |  | Channel visitor identifier (webchat visitor id, email address, social psid, etc.). |
| `contact_id` | uuid | yes |  | Link to cdp.contacts canonical customer record when resolved. |
| `profile_id` | uuid | yes |  |  |
| `queue_id` | uuid | yes |  | Queue referenced in ccass.queues. |
| `assigned_agent_id` | uuid | yes |  | FK → `ccass.agents.id`. |
| `assigned_user_id` | uuid | yes |  | Platform user id of the assigned agent. |
| `status` | varchar(32) | no | `'bot_active'::character varying` | Legacy authoritative lifecycle status (bot_active, queued, assigned, active, resolved, closed). |
| `priority` | integer | no | `0` | Relative priority (higher = more urgent where applicable). |
| `subject` | varchar(512) | yes |  | Conversation or email subject line. |
| `handoff_reason` | varchar(128) | yes |  | Reason the conversation was handed off from bot to queue/agent. |
| `bot_active` | boolean | no | `true` | Whether the AI bot is currently handling the conversation. |
| `nlp_enabled` | boolean | no | `true` | Whether NLP processing is enabled for the conversation. |
| `live_agent_enabled` | boolean | no | `true` | Whether live-agent handoff is allowed for the conversation. |
| `version` | integer | no | `1` | Optimistic concurrency / change counter. |
| `created_at` | timestamp with time zone | no | `now()` | Row creation timestamp (UTC). |
| `updated_at` | timestamp with time zone | no | `now()` | Last update timestamp (UTC). |
| `queued_at` | timestamp with time zone | yes |  | Timestamp when the conversation entered queue. |
| `assigned_at` | timestamp with time zone | yes |  | Timestamp when an agent was assigned. |
| `first_response_at` | timestamp with time zone | yes |  | Timestamp of the first agent response (SLA metric). |
| `resolved_at` | timestamp with time zone | yes |  | Timestamp when the conversation was resolved. |
| `closed_at` | timestamp with time zone | yes |  | Timestamp when the conversation was closed. |
| `lifecycle_state` | varchar(32) | no | `'bot'::character varying` | Normalized lifecycle state (bot, waiting, offered, connected, wrap_up, ended) parallel to status. |
| `lifecycle_version` | integer | no | `1` |  |
| `ended_at` | timestamp with time zone | yes |  | Timestamp when the session/assignment/history ended. |
| `end_reason` | varchar(128) | yes |  |  |
| `end_actor` | varchar(32) | yes |  |  |
| `transferred_at` | timestamp with time zone | yes |  |  |
| `disposition_code` | varchar(64) | yes |  | Applied wrap-up disposition code. |
| `disposition_note` | text | yes |  |  |
| `resolution_code` | varchar(64) | yes |  | Applied resolution code. |
| `resolution_summary` | text | yes |  |  |
| `resolution_data` | jsonb | no | `'{}'::jsonb` |  |
| `mailbox_connection_id` | uuid | yes |  | Email mailbox connection for email-channel rows. |
| `automation_policy_version` | integer | yes |  | Version of channel/mailbox automation policy in effect. |
| `first_response_due_at` | timestamp with time zone | yes |  |  |
| `resolution_due_at` | timestamp with time zone | yes |  |  |
| `first_agent_response_at` | timestamp with time zone | yes |  |  |
| `sla_status` | varchar(32) | no | `'not_started'::character varying` |  |
| `provider_thread_id` | varchar(128) | yes |  | Provider-native thread id (email Message-Id chain, WhatsApp wa_id thread, etc.). |
| `previous_conversation_id` | uuid | yes |  | Prior closed conversation in the same customer thread when a new session is opened. |
| `channel_config_id` | uuid | yes |  | Reference to accounts.setup_channel_configs for channel-specific settings. |
| `event_sequence` | bigint | no | `0` |  |
| `visitor_session_token` | text | yes |  |  |

## copilot_memory

**Description:** Long-lived copilot memory entries scoped to agent or organization.

**Primary key:** `id`

### Columns

| Column | Type | Nullable | Default | Description |
| --- | --- | --- | --- | --- |
| `id` | uuid | no | `gen_random_uuid()` | Surrogate primary key (UUID). |
| `organization_id` | uuid | no |  | Tenant scope; references accounts.organizations. |
| `user_id` | uuid | yes |  |  |
| `conversation_id` | uuid | yes |  | Parent conversation this row belongs to. |
| `memory_type` | varchar(32) | no |  |  |
| `content` | jsonb | no | `'{}'::jsonb` |  |
| `provenance` | varchar(64) | yes |  |  |
| `expires_at` | timestamp with time zone | yes |  | Expiry timestamp after which the record is stale. |
| `version` | integer | no | `1` | Optimistic concurrency / change counter. |
| `updated_at` | timestamp with time zone | no | `now()` | Last update timestamp (UTC). |

## copilot_sessions

**Description:** Agent copilot chat sessions in the workspace.

**Primary key:** `id`

### Columns

| Column | Type | Nullable | Default | Description |
| --- | --- | --- | --- | --- |
| `id` | uuid | no | `gen_random_uuid()` | Surrogate primary key (UUID). |
| `organization_id` | uuid | no |  | Tenant scope; references accounts.organizations. |
| `user_id` | uuid | no |  |  |
| `role` | varchar(32) | no | `'agent'::character varying` |  |
| `active_surface` | varchar(64) | yes |  |  |
| `status` | varchar(32) | no | `'active'::character varying` | Domain-specific status enum for this entity. |
| `started_at` | timestamp with time zone | no | `now()` | Timestamp when the session or interval started. |
| `last_activity_at` | timestamp with time zone | no | `now()` |  |
| `ended_at` | timestamp with time zone | yes |  | Timestamp when the session/assignment/history ended. |

## copilot_skill_executions

**Description:** Record of copilot skill/tool invocations with inputs and results.

**Primary key:** `id`

### Columns

| Column | Type | Nullable | Default | Description |
| --- | --- | --- | --- | --- |
| `id` | uuid | no | `gen_random_uuid()` | Surrogate primary key (UUID). |
| `organization_id` | uuid | no |  | Tenant scope; references accounts.organizations. |
| `session_id` | uuid | yes |  | FK → `ccass.copilot_sessions.id`. |
| `turn_id` | uuid | yes |  | FK → `ccass.copilot_turns.id`. |
| `skill_key` | varchar(128) | no |  |  |
| `tool_key` | varchar(128) | yes |  |  |
| `status` | varchar(32) | no | `'started'::character varying` | Domain-specific status enum for this entity. |
| `token_usage` | jsonb | yes |  |  |
| `latency_ms` | integer | yes |  |  |
| `error_message` | text | yes |  | Last error message from a failed operation. |
| `trace_id` | varchar(128) | yes |  |  |
| `created_at` | timestamp with time zone | no | `now()` | Row creation timestamp (UTC). |

## copilot_turns

**Description:** Turns within a copilot session (user prompts and assistant responses).

**Primary key:** `id`

### Columns

| Column | Type | Nullable | Default | Description |
| --- | --- | --- | --- | --- |
| `id` | uuid | no | `gen_random_uuid()` | Surrogate primary key (UUID). |
| `organization_id` | uuid | no |  | Tenant scope; references accounts.organizations. |
| `session_id` | uuid | no |  | FK → `ccass.copilot_sessions.id`. |
| `conversation_id` | uuid | yes |  | Parent conversation this row belongs to. |
| `surface` | varchar(64) | yes |  |  |
| `turn_type` | varchar(32) | no | `'chat'::character varying` |  |
| `agent_input` | text | yes |  |  |
| `copilot_response` | text | yes |  |  |
| `suggestion_text` | text | yes |  |  |
| `final_text` | text | yes |  |  |
| `accepted` | boolean | yes |  |  |
| `sent_message_id` | uuid | yes |  | FK → `ccass.conversation_messages.id`. |
| `skill_key` | varchar(128) | yes |  |  |
| `model_name` | varchar(128) | yes |  |  |
| `latency_ms` | integer | yes |  |  |
| `status` | varchar(32) | no | `'completed'::character varying` | Domain-specific status enum for this entity. |
| `created_at` | timestamp with time zone | no | `now()` | Row creation timestamp (UTC). |

## dispositions

**Description:** Organization disposition catalog (codes, labels, categories) for wrap-up.

**Primary key:** `id`

**Unique constraints:**

- `(organization_id, code)`

### Columns

| Column | Type | Nullable | Default | Description |
| --- | --- | --- | --- | --- |
| `id` | uuid | no | `gen_random_uuid()` | Surrogate primary key (UUID). |
| `organization_id` | uuid | no |  | Tenant scope; references accounts.organizations. |
| `code` | varchar(64) | no |  | Stable machine-readable code key. |
| `label` | varchar(255) | no |  | Human-readable display label. |
| `requires_note` | boolean | no | `false` | Whether selecting this reason code requires a note. |
| `is_active` | boolean | no | `true` | Soft-active flag; inactive rows are hidden from pickers. |
| `created_at` | timestamp with time zone | no | `now()` | Row creation timestamp (UTC). |
| `description` | text | yes |  | Longer descriptive text. |
| `category` | varchar(64) | no | `'general'::character varying` |  |
| `outcome` | varchar(64) | yes |  | Result of the attempt or routing decision. |
| `requires_resolution` | boolean | no | `false` |  |
| `sort_order` | integer | no | `0` |  |
| `updated_at` | timestamp with time zone | no | `now()` | Last update timestamp (UTC). |

## email_delivery_outbox

**Description:** Reliable outbound email send queue with retry scheduling.

**Primary key:** `id`

**Unique constraints:**

- `(message_id)`

### Columns

| Column | Type | Nullable | Default | Description |
| --- | --- | --- | --- | --- |
| `id` | uuid | no | `gen_random_uuid()` | Surrogate primary key (UUID). |
| `organization_id` | uuid | no |  | Tenant scope; references accounts.organizations. |
| `conversation_id` | uuid | no |  | Parent conversation this row belongs to. |
| `message_id` | uuid | no |  | Message referenced in ccass.conversation_messages. |
| `source_message_id` | uuid | no |  | FK → `ccass.conversation_messages.id`. |
| `connection_id` | uuid | no |  |  |
| `recipient_email` | varchar(320) | no |  |  |
| `subject` | varchar(512) | no |  | Conversation or email subject line. |
| `provider_thread_id` | varchar(255) | yes |  | Native provider thread identifier for session continuity. |
| `in_reply_to` | varchar(998) | yes |  |  |
| `references_header` | text | yes |  |  |
| `status` | varchar(32) | no | `'pending'::character varying` | Outbox send state: pending, sending, sent, failed. |
| `attempt_count` | integer | no | `0` |  |
| `next_attempt_at` | timestamp with time zone | no | `now()` | Scheduled time for the next retry attempt. |
| `provider_message_id` | varchar(255) | yes |  |  |
| `provider_rfc_message_id` | varchar(998) | yes |  |  |
| `last_error` | text | yes |  |  |
| `created_at` | timestamp with time zone | no | `now()` | Row creation timestamp (UTC). |
| `updated_at` | timestamp with time zone | no | `now()` | Last update timestamp (UTC). |
| `delivered_at` | timestamp with time zone | yes |  |  |

## email_mailbox_policies

**Description:** Email mailbox automation: bot, queue defaults, allowed queues, and routing rules.

**Primary key:** `id`

**Unique constraints:**

- `(organization_id, connection_id)`
- `(organization_id, account_email)`

### Columns

| Column | Type | Nullable | Default | Description |
| --- | --- | --- | --- | --- |
| `id` | uuid | no | `gen_random_uuid()` | Surrogate primary key (UUID). |
| `organization_id` | uuid | no |  | Tenant scope; references accounts.organizations. |
| `connection_id` | uuid | no |  |  |
| `account_email` | varchar(255) | no |  |  |
| `bot_enabled` | boolean | no | `false` |  |
| `live_agent_enabled` | boolean | no | `true` | Whether live-agent handoff is allowed for the conversation. |
| `shadow_mode` | boolean | no | `true` |  |
| `auto_send_enabled` | boolean | no | `false` |  |
| `confidence_threshold` | numeric(4,3) | no | `0.850` |  |
| `default_queue_id` | uuid | yes |  | FK → `ccass.queues.id`. |
| `allowed_queue_ids` | jsonb | no | `'[]'::jsonb` |  |
| `approved_service_message` | text | yes |  |  |
| `business_hours_mode` | varchar(32) | no | `'queue_policy'::character varying` |  |
| `policy_version` | integer | no | `1` | Version stamp of the automation policy applied. |
| `status` | varchar(32) | no | `'active'::character varying` | Domain-specific status enum for this entity. |
| `created_at` | timestamp with time zone | no | `now()` | Row creation timestamp (UTC). |
| `updated_at` | timestamp with time zone | no | `now()` | Last update timestamp (UTC). |
| `inactivity_close_hours` | integer | no | `72` |  |

## email_provider_events

**Description:** Inbound email provider webhook/pubsub events for idempotent processing.

**Primary key:** `id`

**Unique constraints:**

- `(organization_id, provider, event_id)`

### Columns

| Column | Type | Nullable | Default | Description |
| --- | --- | --- | --- | --- |
| `id` | uuid | no | `gen_random_uuid()` | Surrogate primary key (UUID). |
| `organization_id` | uuid | no |  | Tenant scope; references accounts.organizations. |
| `connection_id` | uuid | yes |  |  |
| `provider` | varchar(32) | no | `'gmail'::character varying` |  |
| `event_id` | varchar(255) | no |  |  |
| `mailbox_email` | varchar(255) | no |  |  |
| `status` | varchar(32) | no | `'processing'::character varying` | Domain-specific status enum for this entity. |
| `attempt_count` | integer | no | `1` |  |
| `last_error` | text | yes |  |  |
| `processing_started_at` | timestamp with time zone | no | `now()` |  |
| `processed_at` | timestamp with time zone | yes |  |  |
| `created_at` | timestamp with time zone | no | `now()` | Row creation timestamp (UTC). |
| `updated_at` | timestamp with time zone | no | `now()` | Last update timestamp (UTC). |

## message_delivery_attempts

**Description:** Outbound delivery attempt log for channel providers (retries, errors).

**Primary key:** `id`

### Columns

| Column | Type | Nullable | Default | Description |
| --- | --- | --- | --- | --- |
| `id` | uuid | no | `gen_random_uuid()` | Surrogate primary key (UUID). |
| `organization_id` | uuid | no |  | Tenant scope; references accounts.organizations. |
| `message_id` | uuid | no |  | Message referenced in ccass.conversation_messages. |
| `destination` | varchar(64) | no |  |  |
| `attempt_number` | integer | no | `1` | Sequential attempt counter for retries/routing. |
| `status` | varchar(32) | no | `'pending'::character varying` | Domain-specific status enum for this entity. |
| `provider_response` | jsonb | yes |  | Raw JSON response from an external provider. |
| `error_message` | text | yes |  | Last error message from a failed operation. |
| `attempted_at` | timestamp with time zone | no | `now()` |  |
| `delivered_at` | timestamp with time zone | yes |  |  |

## message_receipts

**Description:** Read/delivery receipts for messages (customer or agent recipients).

**Primary key:** `id`

**Unique constraints:**

- `(organization_id, message_id, recipient_type, recipient_ref)`

### Columns

| Column | Type | Nullable | Default | Description |
| --- | --- | --- | --- | --- |
| `id` | uuid | no | `gen_random_uuid()` | Surrogate primary key (UUID). |
| `organization_id` | uuid | no |  | Tenant scope; references accounts.organizations. |
| `conversation_id` | uuid | no |  | Parent conversation this row belongs to. |
| `message_id` | uuid | no |  | Message referenced in ccass.conversation_messages. |
| `recipient_type` | varchar(32) | no |  |  |
| `recipient_ref` | varchar(128) | no | `''::character varying` |  |
| `status` | varchar(16) | no | `'sent'::character varying` | Domain-specific status enum for this entity. |
| `sent_at` | timestamp with time zone | yes |  |  |
| `delivered_at` | timestamp with time zone | yes |  |  |
| `read_at` | timestamp with time zone | yes |  |  |
| `created_at` | timestamp with time zone | no | `now()` | Row creation timestamp (UTC). |
| `updated_at` | timestamp with time zone | no | `now()` | Last update timestamp (UTC). |

## nlp_conversations

**Description:** NLP runtime session bound to a conversation (bot type, external NLP thread id).

**Primary key:** `id`

**Unique constraints:**

- `(conversation_id)`

### Columns

| Column | Type | Nullable | Default | Description |
| --- | --- | --- | --- | --- |
| `id` | uuid | no | `gen_random_uuid()` | Surrogate primary key (UUID). |
| `organization_id` | uuid | no |  | Tenant scope; references accounts.organizations. |
| `conversation_id` | uuid | no |  | Parent conversation this row belongs to. |
| `runtime_type` | varchar(32) | no | `'webchat_bot'::character varying` | NLP runtime profile (webchat_bot, whatsapp_bot, copilot, etc.). |
| `skill_version_id` | uuid | yes |  | FK → `ccass.nlp_skill_versions.id`. |
| `status` | varchar(32) | no | `'active'::character varying` | Domain-specific status enum for this entity. |
| `started_at` | timestamp with time zone | no | `now()` | Timestamp when the session or interval started. |
| `ended_at` | timestamp with time zone | yes |  | Timestamp when the session/assignment/history ended. |
| `end_reason` | varchar(128) | yes |  |  |
| `created_at` | timestamp with time zone | no | `now()` | Row creation timestamp (UTC). |
| `updated_at` | timestamp with time zone | no | `now()` | Last update timestamp (UTC). |

## nlp_skill_activation_history

**Description:** Audit log of skill activations during NLP runs.

**Primary key:** `id`

### Columns

| Column | Type | Nullable | Default | Description |
| --- | --- | --- | --- | --- |
| `id` | uuid | no | `gen_random_uuid()` | Surrogate primary key (UUID). |
| `organization_id` | uuid | no |  | Tenant scope; references accounts.organizations. |
| `skill_id` | uuid | no |  | Skill referenced in ccass.skills. |
| `skill_version_id` | uuid | yes |  | FK → `ccass.nlp_skill_versions.id`. |
| `action` | varchar(32) | no |  |  |
| `actor_user_id` | uuid | yes |  |  |
| `metadata` | jsonb | no | `'{}'::jsonb` | Flexible JSONB payload for extensibility. |
| `created_at` | timestamp with time zone | no | `now()` | Row creation timestamp (UTC). |

## nlp_skill_bindings

**Description:** Bindings between NLP skills and channels/queues/bots.

**Primary key:** `id`

### Columns

| Column | Type | Nullable | Default | Description |
| --- | --- | --- | --- | --- |
| `id` | uuid | no | `gen_random_uuid()` | Surrogate primary key (UUID). |
| `organization_id` | uuid | no |  | Tenant scope; references accounts.organizations. |
| `skill_version_id` | uuid | no |  | FK → `ccass.nlp_skill_versions.id`. |
| `role` | varchar(32) | yes |  |  |
| `surface` | varchar(64) | yes |  |  |
| `channel` | varchar(32) | yes |  | Omnichannel identifier (webchat, email, whatsapp, instagram, facebook, voice). |
| `priority` | integer | no | `0` | Relative priority (higher = more urgent where applicable). |
| `effective_from` | timestamp with time zone | no | `now()` |  |
| `effective_to` | timestamp with time zone | yes |  |  |
| `enabled` | boolean | no | `true` |  |
| `overrides` | jsonb | no | `'{}'::jsonb` |  |
| `created_at` | timestamp with time zone | no | `now()` | Row creation timestamp (UTC). |

## nlp_skill_tools

**Description:** MCP/tool definitions exposed to an NLP skill version.

**Primary key:** `id`

**Unique constraints:**

- `(skill_version_id, tool_key)`

### Columns

| Column | Type | Nullable | Default | Description |
| --- | --- | --- | --- | --- |
| `id` | uuid | no | `gen_random_uuid()` | Surrogate primary key (UUID). |
| `organization_id` | uuid | no |  | Tenant scope; references accounts.organizations. |
| `skill_version_id` | uuid | no |  | FK → `ccass.nlp_skill_versions.id`. |
| `tool_key` | varchar(128) | no |  |  |
| `permission_class` | varchar(32) | no | `'tool_call'::character varying` |  |
| `requires_confirmation` | boolean | no | `false` |  |
| `created_at` | timestamp with time zone | no | `now()` | Row creation timestamp (UTC). |

## nlp_skill_versions

**Description:** Versioned skill definitions with prompts and configuration.

**Primary key:** `id`

**Unique constraints:**

- `(skill_id, version_number)`

### Columns

| Column | Type | Nullable | Default | Description |
| --- | --- | --- | --- | --- |
| `id` | uuid | no | `gen_random_uuid()` | Surrogate primary key (UUID). |
| `organization_id` | uuid | no |  | Tenant scope; references accounts.organizations. |
| `skill_id` | uuid | no |  | Skill referenced in ccass.skills. |
| `version_number` | integer | no |  |  |
| `prompt_template` | text | no |  |  |
| `input_schema` | jsonb | no | `'{}'::jsonb` |  |
| `output_schema` | jsonb | no | `'{}'::jsonb` |  |
| `model_policy` | jsonb | no | `'{}'::jsonb` |  |
| `context_policy` | jsonb | no | `'{}'::jsonb` |  |
| `safety_policy` | jsonb | no | `'{}'::jsonb` |  |
| `checksum` | varchar(128) | no |  |  |
| `state` | varchar(32) | no | `'draft'::character varying` | Workflow state for this entity. |
| `published_at` | timestamp with time zone | yes |  | Timestamp when the queue snapshot was published to ccass. |
| `created_at` | timestamp with time zone | no | `now()` | Row creation timestamp (UTC). |

## nlp_skills

**Description:** Registered NLP skills available to bots and copilot.

**Primary key:** `id`

**Unique constraints:**

- `(organization_id, skill_key)`

### Columns

| Column | Type | Nullable | Default | Description |
| --- | --- | --- | --- | --- |
| `id` | uuid | no | `gen_random_uuid()` | Surrogate primary key (UUID). |
| `organization_id` | uuid | no |  | Tenant scope; references accounts.organizations. |
| `skill_key` | varchar(128) | no |  |  |
| `name` | varchar(255) | no |  | Display name. |
| `description` | text | yes |  | Longer descriptive text. |
| `skill_type` | varchar(32) | no |  |  |
| `owner_user_id` | uuid | yes |  |  |
| `state` | varchar(32) | no | `'draft'::character varying` | Workflow state for this entity. |
| `created_at` | timestamp with time zone | no | `now()` | Row creation timestamp (UTC). |
| `updated_at` | timestamp with time zone | no | `now()` | Last update timestamp (UTC). |

## nlp_turns

**Description:** Individual NLP turns (customer/agent/bot) with intent, sentiment, and extracted facts.

**Primary key:** `id`

**Unique constraints:**

- `(nlp_conversation_id, turn_number)`

### Columns

| Column | Type | Nullable | Default | Description |
| --- | --- | --- | --- | --- |
| `id` | uuid | no | `gen_random_uuid()` | Surrogate primary key (UUID). |
| `organization_id` | uuid | no |  | Tenant scope; references accounts.organizations. |
| `nlp_conversation_id` | uuid | no |  | FK → `ccass.nlp_conversations.id`. |
| `conversation_id` | uuid | no |  | Parent conversation this row belongs to. |
| `turn_number` | integer | no |  |  |
| `customer_message_id` | uuid | yes |  | FK → `ccass.conversation_messages.id`. |
| `bot_message_id` | uuid | yes |  | FK → `ccass.conversation_messages.id`. |
| `customer_text` | text | no |  |  |
| `bot_reply` | text | yes |  |  |
| `confidence` | numeric(5,4) | yes |  |  |
| `intent` | varchar(128) | yes |  | Classified customer intent for the turn. |
| `candidate_skills` | jsonb | no | `'[]'::jsonb` |  |
| `handoff_recommended` | boolean | no | `false` |  |
| `handoff_reason` | varchar(128) | yes |  | Reason the conversation was handed off from bot to queue/agent. |
| `skill_key` | varchar(128) | yes |  |  |
| `model_name` | varchar(128) | yes |  |  |
| `trace_id` | varchar(128) | yes |  |  |
| `latency_ms` | integer | yes |  |  |
| `status` | varchar(32) | no | `'completed'::character varying` | Domain-specific status enum for this entity. |
| `created_at` | timestamp with time zone | no | `now()` | Row creation timestamp (UTC). |
| `summary` | text | yes |  | Longer text summary or description. |
| `sentiment` | varchar(50) | yes |  | Detected sentiment for the NLP turn. |
| `important_facts` | jsonb | no | `'[]'::jsonb` | JSON array of extracted facts from NLP turn. |
| `selected_queue_key` | varchar(255) | yes |  |  |
| `queue_profile_version` | varchar(64) | yes |  |  |
| `grounded` | boolean | yes |  |  |
| `guard_passed` | boolean | yes |  |  |
| `guard_reasons` | jsonb | no | `'[]'::jsonb` |  |
| `knowledge_references` | jsonb | no | `'[]'::jsonb` | JSON array of knowledge base citations. |
| `delivery_message_id` | uuid | yes |  |  |

## presence_reason_codes

**Description:** Organization-configurable reason codes mapped to presence states (e.g. break, training).

**Primary key:** `id`

**Unique constraints:**

- `(organization_id, code)`

### Columns

| Column | Type | Nullable | Default | Description |
| --- | --- | --- | --- | --- |
| `id` | uuid | no | `gen_random_uuid()` | Surrogate primary key (UUID). |
| `organization_id` | uuid | no |  | Tenant scope; references accounts.organizations. |
| `code` | varchar(64) | no |  | Stable machine-readable code key. |
| `label` | varchar(255) | no |  | Human-readable display label. |
| `presence_state` | varchar(32) | no | `'not_ready'::character varying` |  |
| `requires_note` | boolean | no | `false` | Whether selecting this reason code requires a note. |
| `is_active` | boolean | no | `true` | Soft-active flag; inactive rows are hidden from pickers. |
| `created_at` | timestamp with time zone | no | `now()` | Row creation timestamp (UTC). |
| `updated_at` | timestamp with time zone | no | `now()` | Last update timestamp (UTC). |

## queue_members

**Description:** Agent membership in a queue with per-channel concurrency limits and channel-handling flags.

**Primary key:** `id`

**Unique constraints:**

- `(queue_id, agent_id, shift_type)`

### Columns

| Column | Type | Nullable | Default | Description |
| --- | --- | --- | --- | --- |
| `id` | uuid | no | `gen_random_uuid()` | Surrogate primary key (UUID). |
| `queue_id` | uuid | no |  | Queue referenced in ccass.queues. |
| `agent_id` | uuid | no |  | Agent referenced in ccass.agents. |
| `setup_user_id` | uuid | no |  | Platform user id from accounts.setup_users. |
| `shift_type` | varchar(32) | no | `'Regular'::character varying` |  |
| `handles_calls` | boolean | no | `false` |  |
| `handles_email` | boolean | no | `false` |  |
| `handles_social` | boolean | no | `false` |  |
| `handles_chat` | boolean | no | `false` |  |
| `chat_concurrency` | integer | no | `1` |  |
| `email_concurrency` | integer | no | `1` |  |
| `social_concurrency` | integer | no | `1` |  |
| `handles_whatsapp` | boolean | no | `false` |  |
| `handles_instagram` | boolean | no | `false` |  |
| `handles_facebook` | boolean | no | `false` |  |
| `whatsapp_concurrency` | integer | no | `1` |  |
| `instagram_concurrency` | integer | no | `1` |  |
| `facebook_concurrency` | integer | no | `1` |  |
| `call_type` | varchar(16) | no | `'both'::character varying` |  |
| `created_at` | timestamp with time zone | no | `now()` | Row creation timestamp (UTC). |

## queue_routing_profiles

**Description:** NLP/routing metadata for a queue: intents, keywords, example phrases, and skill mapping.

**Primary key:** `id`

**Unique constraints:**

- `(queue_id)`

### Columns

| Column | Type | Nullable | Default | Description |
| --- | --- | --- | --- | --- |
| `id` | uuid | no | `gen_random_uuid()` | Surrogate primary key (UUID). |
| `organization_id` | uuid | no |  | Tenant scope; references accounts.organizations. |
| `queue_id` | uuid | no |  | Queue referenced in ccass.queues. |
| `description` | text | no | `''::text` | Longer descriptive text. |
| `supported_intents` | jsonb | no | `'[]'::jsonb` | JSON array of intents this queue handles. |
| `example_phrases` | jsonb | no | `'[]'::jsonb` | JSON array of routing classifier example phrases. |
| `keywords` | jsonb | no | `'[]'::jsonb` | JSON array of routing keywords. |
| `language_codes` | jsonb | no | `'["en"]'::jsonb` | JSON array of supported ISO language codes. |
| `skill_mapping` | jsonb | no | `'{}'::jsonb` | JSON map of skill keys to routing weights. |
| `classifier_version` | varchar(32) | no | `'v1'::character varying` |  |
| `updated_at` | timestamp with time zone | no | `now()` | Last update timestamp (UTC). |

## queue_skills

**Description:** Required or preferred skills for a queue with minimum proficiency and weight.

**Primary key:** `id`

**Unique constraints:**

- `(queue_id, skill_id)`

### Columns

| Column | Type | Nullable | Default | Description |
| --- | --- | --- | --- | --- |
| `id` | uuid | no | `gen_random_uuid()` | Surrogate primary key (UUID). |
| `organization_id` | uuid | no |  | Tenant scope; references accounts.organizations. |
| `queue_id` | uuid | no |  | Queue referenced in ccass.queues. |
| `skill_id` | uuid | no |  | Skill referenced in ccass.skills. |
| `requirement_type` | varchar(16) | no | `'required'::character varying` |  |
| `min_proficiency` | integer | no | `1` |  |
| `weight` | integer | no | `1` |  |
| `created_at` | timestamp with time zone | no | `now()` | Row creation timestamp (UTC). |

## queues

**Description:** Published routing queue snapshot from accounts setup; holds team, skills, and business-hours metadata for live routing.

**Primary key:** `id`

**Unique constraints:**

- `(setup_queue_id)`

### Columns

| Column | Type | Nullable | Default | Description |
| --- | --- | --- | --- | --- |
| `id` | uuid | no |  | Surrogate primary key (UUID). |
| `organization_id` | uuid | no |  | Tenant scope; references accounts.organizations. |
| `setup_queue_id` | uuid | no |  | Source queue id from accounts.setup_ccaas_queues. |
| `name` | varchar(255) | no |  | Display name. |
| `team_id` | uuid | no |  | Team owning the queue (accounts.setup_teams). |
| `business_hours_id` | uuid | yes |  | Business hours profile applied to the queue. |
| `shift_types` | jsonb | no | `'[]'::jsonb` | JSON array of shift types configured on the queue. |
| `skills` | jsonb | no | `'[]'::jsonb` | JSON array of skill keys published with the queue. |
| `status` | varchar(32) | no | `'active'::character varying` | Domain-specific status enum for this entity. |
| `published_at` | timestamp with time zone | no | `now()` | Timestamp when the queue snapshot was published to ccass. |
| `updated_at` | timestamp with time zone | no | `now()` | Last update timestamp (UTC). |

## routing_attempts

**Description:** Log of routing attempts for a conversation including candidate scores and outcomes.

**Primary key:** `id`

### Columns

| Column | Type | Nullable | Default | Description |
| --- | --- | --- | --- | --- |
| `id` | uuid | no | `gen_random_uuid()` | Surrogate primary key (UUID). |
| `organization_id` | uuid | no |  | Tenant scope; references accounts.organizations. |
| `conversation_id` | uuid | no |  | Parent conversation this row belongs to. |
| `queue_id` | uuid | no |  | Queue referenced in ccass.queues. |
| `agent_id` | uuid | yes |  | Agent referenced in ccass.agents. |
| `attempt_number` | integer | no | `1` | Sequential attempt counter for retries/routing. |
| `outcome` | varchar(32) | no | `'pending'::character varying` | Result of the attempt or routing decision. |
| `candidate_scores` | jsonb | no | `'[]'::jsonb` | JSON array of routing candidate scores. |
| `skip_reasons` | jsonb | no | `'[]'::jsonb` | JSON array explaining why candidates were skipped. |
| `created_at` | timestamp with time zone | no | `now()` | Row creation timestamp (UTC). |
| `completed_at` | timestamp with time zone | yes |  | Timestamp when the task was completed. |

## routing_cursors

**Description:** Round-robin cursor state per queue for fair agent rotation.

**Primary key:** `id`

**Unique constraints:**

- `(queue_id)`

### Columns

| Column | Type | Nullable | Default | Description |
| --- | --- | --- | --- | --- |
| `id` | uuid | no | `gen_random_uuid()` | Surrogate primary key (UUID). |
| `organization_id` | uuid | no |  | Tenant scope; references accounts.organizations. |
| `queue_id` | uuid | no |  | Queue referenced in ccass.queues. |
| `cursor_index` | integer | no | `0` |  |
| `last_agent_id` | uuid | yes |  | FK → `ccass.agents.id`. |
| `updated_at` | timestamp with time zone | no | `now()` | Last update timestamp (UTC). |

## routing_policies

**Description:** Queue routing strategy configuration (strategy, offer timeout, overflow, after-contact work).

**Primary key:** `id`

**Unique constraints:**

- `(queue_id)`

### Columns

| Column | Type | Nullable | Default | Description |
| --- | --- | --- | --- | --- |
| `id` | uuid | no | `gen_random_uuid()` | Surrogate primary key (UUID). |
| `organization_id` | uuid | no |  | Tenant scope; references accounts.organizations. |
| `queue_id` | uuid | no |  | Queue referenced in ccass.queues. |
| `strategy` | varchar(32) | no | `'skill_round_robin'::character varying` | Routing algorithm key (e.g. skill_round_robin, longest_idle). |
| `priority` | integer | no | `0` | Relative priority (higher = more urgent where applicable). |
| `offer_timeout_seconds` | integer | no | `30` |  |
| `max_attempts` | integer | no | `3` |  |
| `overflow_queue_id` | uuid | yes |  | FK → `ccass.queues.id`. |
| `after_contact_work_seconds` | integer | no | `60` |  |
| `created_at` | timestamp with time zone | no | `now()` | Row creation timestamp (UTC). |
| `updated_at` | timestamp with time zone | no | `now()` | Last update timestamp (UTC). |
| `email_offer_timeout_seconds` | integer | no | `3600` |  |
| `email_first_response_sla_seconds` | integer | no | `14400` |  |
| `email_resolution_sla_seconds` | integer | no | `86400` |  |
| `email_after_contact_work_seconds` | integer | no | `0` |  |

## schema_migrations

**Description:** Applied SQL migration ledger for the ccass schema.

**Primary key:** `id`

**Unique constraints:**

- `(name)`

### Columns

| Column | Type | Nullable | Default | Description |
| --- | --- | --- | --- | --- |
| `id` | integer | no | `nextval('schema_migrations_id_seq'::regclass)` | Surrogate primary key (UUID). |
| `name` | varchar(255) | no |  | Display name. |
| `checksum` | varchar(64) | no |  |  |
| `applied_at` | timestamp with time zone | no | `now()` |  |

## skills

**Description:** Skill catalog used for skill-based routing and queue requirements.

**Primary key:** `id`

**Unique constraints:**

- `(organization_id, key)`

### Columns

| Column | Type | Nullable | Default | Description |
| --- | --- | --- | --- | --- |
| `id` | uuid | no | `gen_random_uuid()` | Surrogate primary key (UUID). |
| `organization_id` | uuid | no |  | Tenant scope; references accounts.organizations. |
| `key` | varchar(128) | no |  |  |
| `name` | varchar(255) | no |  | Display name. |
| `description` | text | yes |  | Longer descriptive text. |
| `is_active` | boolean | no | `true` | Soft-active flag; inactive rows are hidden from pickers. |
| `created_at` | timestamp with time zone | no | `now()` | Row creation timestamp (UTC). |
| `updated_at` | timestamp with time zone | no | `now()` | Last update timestamp (UTC). |

## sla_policies

**Description:** SLA policy definitions (thresholds, warning percentages) referenced by queues.

**Primary key:** `id`

### Columns

| Column | Type | Nullable | Default | Description |
| --- | --- | --- | --- | --- |
| `id` | uuid | no | `gen_random_uuid()` | Surrogate primary key (UUID). |
| `organization_id` | uuid | no |  | Tenant scope; references accounts.organizations. |
| `name` | varchar(255) | no |  | Display name. |
| `first_response_seconds` | integer | no | `120` |  |
| `resolution_seconds` | integer | no | `3600` |  |
| `warning_threshold_pct` | integer | no | `80` |  |
| `business_hours_mode` | varchar(32) | no | `'queue'::character varying` |  |
| `escalation_policy` | jsonb | no | `'{}'::jsonb` |  |
| `is_active` | boolean | no | `true` | Soft-active flag; inactive rows are hidden from pickers. |
| `created_at` | timestamp with time zone | no | `now()` | Row creation timestamp (UTC). |
| `updated_at` | timestamp with time zone | no | `now()` | Last update timestamp (UTC). |

## webchat_sessions

**Description:** Webchat visitor session bound to a conversation (token, page context, connection state).

**Primary key:** `id`

**Unique constraints:**

- `(conversation_id)`

### Columns

| Column | Type | Nullable | Default | Description |
| --- | --- | --- | --- | --- |
| `id` | uuid | no | `gen_random_uuid()` | Surrogate primary key (UUID). |
| `organization_id` | uuid | no |  | Tenant scope; references accounts.organizations. |
| `conversation_id` | uuid | no |  | Parent conversation this row belongs to. |
| `webchat_id` | varchar(64) | no |  | Webchat widget configuration id. |
| `visitor_id` | varchar(128) | no |  | Channel-specific visitor/customer identifier. |
| `token_hash` | varchar(128) | yes |  | Hashed session token for webchat authentication. |
| `page_origin` | varchar(512) | yes |  | Webchat page origin URL host. |
| `page_url` | text | yes |  | Full page URL where webchat was opened. |
| `consent` | jsonb | yes |  | JSON object capturing visitor consent selections. |
| `prechat_answers` | jsonb | yes |  | JSON object of webchat pre-chat form answers. |
| `connection_state` | varchar(32) | no | `'connected'::character varying` | Webchat websocket connection state. |
| `expires_at` | timestamp with time zone | yes |  | Expiry timestamp after which the record is stale. |
| `connected_at` | timestamp with time zone | no | `now()` |  |
| `disconnected_at` | timestamp with time zone | yes |  |  |
| `created_at` | timestamp with time zone | no | `now()` | Row creation timestamp (UTC). |
| `updated_at` | timestamp with time zone | no | `now()` | Last update timestamp (UTC). |
| `ended_at` | timestamp with time zone | yes |  | Timestamp when the session/assignment/history ended. |
| `end_reason` | varchar(128) | yes |  |  |
| `ended_by` | varchar(32) | yes |  |  |

## whatsapp_channel_policies

**Description:** WhatsApp-specific channel policy overrides (default queue, bot settings).

**Primary key:** `id`

**Unique constraints:**

- `(organization_id, channel_config_id)`

### Columns

| Column | Type | Nullable | Default | Description |
| --- | --- | --- | --- | --- |
| `id` | uuid | no | `gen_random_uuid()` | Surrogate primary key (UUID). |
| `organization_id` | uuid | no |  | Tenant scope; references accounts.organizations. |
| `channel_config_id` | uuid | no |  | Reference to accounts.setup_channel_configs. |
| `bot_enabled` | boolean | no | `false` |  |
| `live_agent_enabled` | boolean | no | `true` | Whether live-agent handoff is allowed for the conversation. |
| `confidence_threshold` | numeric(4,3) | no | `0.500` |  |
| `default_queue_id` | uuid | yes |  | FK → `ccass.queues.id`. |
| `approved_handoff_message` | text | yes |  |  |
| `inactivity_close_hours` | integer | no | `24` |  |
| `status` | varchar(32) | no | `'active'::character varying` | Domain-specific status enum for this entity. |
| `created_at` | timestamp with time zone | no | `now()` | Row creation timestamp (UTC). |
| `updated_at` | timestamp with time zone | no | `now()` | Last update timestamp (UTC). |

## workspace_common_notes

**Description:** Shared notes visible across the agent workspace (not tied to one conversation).

**Primary key:** `id`

### Columns

| Column | Type | Nullable | Default | Description |
| --- | --- | --- | --- | --- |
| `id` | uuid | no | `gen_random_uuid()` | Surrogate primary key (UUID). |
| `organization_id` | uuid | no |  | Tenant scope; references accounts.organizations. |
| `author_user_id` | uuid | no |  |  |
| `body` | text | no |  | Primary text content (message body, note text, etc.). |
| `created_at` | timestamp with time zone | no | `now()` | Row creation timestamp (UTC). |
| `updated_at` | timestamp with time zone | no | `now()` | Last update timestamp (UTC). |
