# Organization routing profile and recording

Additive **organization-level** setup tables. They do **not** replace queue classifier routing (`accounts.setup_queue_routing_profiles` / `ccass.queue_routing_profiles`) or per-queue offer / overflow / ACW (`ccass.routing_policies`). Live assignment in `apps/cc-core/src/services/routing.ts` still joins the queue tables.

| Surface | Path |
|---------|------|
| Routing UI | `/admin/workforce/queues?tab=routing` |
| Recording UI | `/admin/recording` |
| Routing API | `GET/PUT /api/v1/setup/organization/routing-profile` |
| Recording API | `GET/PUT /api/v1/setup/organization/recording` |
| Migration | `packages/db-cc/prisma/migrations/org_routing_recording_v1.sql` |
| Voice recording columns | `packages/db-cc/prisma/migrations/org_recording_voice_settings_v1.sql` |

**Defaults when no org row exists:** routing type `3` (skill); recording `false`; inbound and outbound `true`; consent notice `false`; agent access `false`.

**Recording GET/PUT body** includes `recordingEnabled`, `inboundEnabled`, `outboundEnabled`, `consentNoticeEnabled`, `consentPromptId`, `agentAccessEnabled`. GET also returns `prompts` from `accounts.setup_voice_prompt_profiles`. This setting is not applied to live media capture yet.

---

## Table Index

- [`accounts.routing_profile_types`](#accounts-routing_profile_types) — Global lookup of organization routing types (1 long wait, 2 sticky, 3 skill).
- [`accounts.setup_organization_routing_profiles`](#accounts-setup_organization_routing_profiles) — One routing profile per organization; stores the type number, not the name.
- [`accounts.setup_organization_recording_settings`](#accounts-setup_organization_recording_settings) — Organization-level voice recording (master switch, inbound/outbound, consent notice, prompt, agent access).

---

<a id="accounts-routing_profile_types"></a>

# Table: `routing_profile_types`

**Schema:** `accounts`

## Table Description

`accounts.routing_profile_types` is the global lookup of organization routing profile types. The organization row stores `routing_type_id` (the number). Labels and descriptions live here so the UI can show a reference table without hard-coding names.

## Fields

| Column Name | Column Purpose | Data Type |
| --- | --- | --- |
| `id` | Routing type number stored on the organization profile (`1`, `2`, `3`). | `integer NOT NULL PRIMARY KEY` |
| `code` | Stable machine-readable code (`long_wait`, `sticky`, `skill`). | `varchar(32) NOT NULL UNIQUE` |
| `name` | Display name shown in the Routing tab. | `varchar(128) NOT NULL` |
| `description` | Longer description shown in the type cards and reference table. | `text NOT NULL` |
| `sort_order` | Display order in the UI (ascending). | `integer NOT NULL` |

### `id`

**Column Purpose:**
Routing type number stored on the organization profile (`1`, `2`, `3`).

**Data Type:** `integer`

**Key / Constraint:** PRIMARY KEY; NOT NULL

### `code`

**Column Purpose:**
Stable machine-readable code (`long_wait`, `sticky`, `skill`).

**Data Type:** `varchar(32)`

**Key / Constraint:** UNIQUE; NOT NULL

### `name`

**Column Purpose:**
Display name shown in the Routing tab.

**Data Type:** `varchar(128)`

**Key / Constraint:** NOT NULL

### `description`

**Column Purpose:**
Longer description shown in the type cards and reference table.

**Data Type:** `text`

**Key / Constraint:** NOT NULL

### `sort_order`

**Column Purpose:**
Display order in the UI (ascending).

**Data Type:** `integer`

**Key / Constraint:** NOT NULL; default `0`

## Seeded rows

| `id` | `code` | `name` | `description` | `sort_order` |
| --- | --- | --- | --- | --- |
| `1` | `long_wait` | Long wait time based routing | Route conversations that have waited the longest toward available agents. | `1` |
| `2` | `sticky` | Sticky routing | Prefer the agent who last handled this customer when they are available. | `2` |
| `3` | `skill` | Skill based routing | Match conversations to agents by required skills. | `3` |

---

<a id="accounts-setup_organization_routing_profiles"></a>

# Table: `setup_organization_routing_profiles`

**Schema:** `accounts`

## Table Description

`accounts.setup_organization_routing_profiles` stores one routing profile per organization. The selected type is `routing_type_id` (FK to `accounts.routing_profile_types.id`). Optional `long_wait_seconds` applies only when the type is `1` (`long_wait`). Independent of `accounts.setup_queue_routing_profiles` (per-queue classifier intents / keywords).

**Primary key:** `organization_id` (one row per org).

## Fields

| Column Name | Column Purpose | Data Type |
| --- | --- | --- |
| `organization_id` | Tenant scope; references accounts.organizations. | `bigint NOT NULL PRIMARY KEY` |
| `routing_type_id` | Selected routing type number (`1` long wait, `2` sticky, `3` skill). | `integer NOT NULL` |
| `long_wait_seconds` | Wait threshold in seconds when type is `1`. NULL for other types. | `integer nullable` |
| `created_at` | Row creation timestamp (UTC). | `timestamp with time zone NOT NULL` |
| `updated_at` | Last update timestamp (UTC). | `timestamp with time zone NOT NULL` |

### `organization_id`

**Column Purpose:**
Tenant scope; references accounts.organizations.

**Data Type:** `bigint`

**Key / Constraint:** PRIMARY KEY; NOT NULL; FK → `accounts.organizations.id` ON DELETE CASCADE

### `routing_type_id`

**Column Purpose:**
Selected routing type number (`1` long wait, `2` sticky, `3` skill).

**Data Type:** `integer`

**Key / Constraint:** NOT NULL; FK → `accounts.routing_profile_types.id`

### `long_wait_seconds`

**Column Purpose:**
Wait threshold in seconds when type is `1`. NULL for other types. API requires a value (`1`–`86400`) when saving type `1`; default used by the service if omitted is `300`.

**Data Type:** `integer`

**Key / Constraint:** nullable; CHECK (`long_wait_seconds IS NULL OR long_wait_seconds > 0`)

### `created_at`

**Column Purpose:**
Row creation timestamp (UTC).

**Data Type:** `timestamp with time zone`

**Key / Constraint:** NOT NULL; default `NOW()`

### `updated_at`

**Column Purpose:**
Last update timestamp (UTC).

**Data Type:** `timestamp with time zone`

**Key / Constraint:** NOT NULL; default `NOW()`

---

<a id="accounts-setup_organization_recording_settings"></a>

# Table: `setup_organization_recording_settings`

**Schema:** `accounts`

## Table Description

`accounts.setup_organization_recording_settings` stores organization-level voice recording. One row per organization. Default is off (`recording_enabled = false`) when no row exists. Nested fields: inbound/outbound direction, consent notice, consent prompt (`consent_prompt_id` → `accounts.setup_voice_prompt_profiles`), and agent access. This setting is not applied to live media capture yet; it is persisted for the Recording module.

**Primary key:** `organization_id` (one row per org).

## Fields

| Column Name | Column Purpose | Data Type |
| --- | --- | --- |
| `organization_id` | Tenant scope; references accounts.organizations. | `bigint NOT NULL PRIMARY KEY` |
| `recording_enabled` | Master voice recording switch for the organization. | `boolean NOT NULL` |
| `inbound_enabled` | Record inbound voice calls when recording is on. | `boolean NOT NULL` |
| `outbound_enabled` | Record outbound voice calls when recording is on. | `boolean NOT NULL` |
| `consent_notice_enabled` | Play a consent notice (prompt) before recording. | `boolean NOT NULL` |
| `consent_prompt_id` | Voice prompt profile played as the consent notice. NULL when unset. | `bigint nullable` |
| `agent_access_enabled` | Whether agents can access recordings for this organization. | `boolean NOT NULL` |
| `created_at` | Row creation timestamp (UTC). | `timestamp with time zone NOT NULL` |
| `updated_at` | Last update timestamp (UTC). | `timestamp with time zone NOT NULL` |

### `organization_id`

**Column Purpose:**
Tenant scope; references accounts.organizations.

**Data Type:** `bigint`

**Key / Constraint:** PRIMARY KEY; NOT NULL; FK → `accounts.organizations.id` ON DELETE CASCADE

### `recording_enabled`

**Column Purpose:**
Master voice recording switch for the organization.

**Data Type:** `boolean`

**Key / Constraint:** NOT NULL; default `false`

### `inbound_enabled`

**Column Purpose:**
Record inbound voice calls when recording is on.

**Data Type:** `boolean`

**Key / Constraint:** NOT NULL; default `true`

### `outbound_enabled`

**Column Purpose:**
Record outbound voice calls when recording is on.

**Data Type:** `boolean`

**Key / Constraint:** NOT NULL; default `true`

### `consent_notice_enabled`

**Column Purpose:**
Play a consent notice (prompt) before recording.

**Data Type:** `boolean`

**Key / Constraint:** NOT NULL; default `false`

### `consent_prompt_id`

**Column Purpose:**
Voice prompt profile played as the consent notice. NULL when unset.

**Data Type:** `bigint`

**Key / Constraint:** nullable; FK → `accounts.setup_voice_prompt_profiles.id` ON DELETE SET NULL

### `agent_access_enabled`

**Column Purpose:**
Whether agents can access recordings for this organization.

**Data Type:** `boolean`

**Key / Constraint:** NOT NULL; default `false`

### `created_at`

**Column Purpose:**
Row creation timestamp (UTC).

**Data Type:** `timestamp with time zone`

**Key / Constraint:** NOT NULL; default `NOW()`

### `updated_at`

**Column Purpose:**
Last update timestamp (UTC).

**Data Type:** `timestamp with time zone`

**Key / Constraint:** NOT NULL; default `NOW()`

---

## Relationships

| From table | Column | Cardinality | To table | To column | Notes |
| --- | --- | --- | --- | --- | --- |
| `accounts.setup_organization_routing_profiles` | `organization_id` | Many-to-One | `accounts.organizations` | `id` | One routing profile row per org; ON DELETE CASCADE. |
| `accounts.setup_organization_routing_profiles` | `routing_type_id` | Many-to-One | `accounts.routing_profile_types` | `id` | Stores the type number; join for name/code/description. |
| `accounts.setup_organization_recording_settings` | `organization_id` | Many-to-One | `accounts.organizations` | `id` | One recording settings row per org; ON DELETE CASCADE. |
| `accounts.setup_organization_recording_settings` | `consent_prompt_id` | Many-to-One | `accounts.setup_voice_prompt_profiles` | `id` | Consent notice prompt; ON DELETE SET NULL. |

## Relationship Details

### `accounts.setup_organization_routing_profiles.organization_id` → `accounts.organizations.id`

Owning tenant. Primary key of the routing profile table.

### `accounts.setup_organization_routing_profiles.routing_type_id` → `accounts.routing_profile_types.id`

Selected routing type. Do not store the type name on the org row.

### `accounts.setup_organization_recording_settings.organization_id` → `accounts.organizations.id`

Owning tenant. Primary key of the recording settings table.

### `accounts.setup_organization_recording_settings.consent_prompt_id` → `accounts.setup_voice_prompt_profiles.id`

Consent notice prompt. Optional; cleared if the prompt profile is deleted.

---

## Not these tables

| Table | What it is |
| --- | --- |
| `accounts.setup_queue_routing_profiles` | Per-queue classifier metadata (intents, example phrases, skills). |
| `ccass.queue_routing_profiles` | Published runtime copy of the queue classifier profile. |
| `ccass.routing_policies` | Per-queue offer timeout, overflow, ACW. |
