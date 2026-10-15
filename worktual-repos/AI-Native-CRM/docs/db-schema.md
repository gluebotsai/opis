# Database schema reference (CRM-used tables)

> **Database:** `worktual_bigint` (shared Worktual Postgres)  
> **Scope:** Tables referenced by Prisma, backend TypeScript, and ai-service — **not** unused B2C/commerce tables present in DB  
> **Excluded:** `campaign` schema; unused `crm.b2c_*` / `commerce_*` tables; unused `accounts.*` tables

## Overview

| Schema | Tables in this doc | Notes |
|---|---|---|
| `crm` | 46+ | Prisma-managed CRM tables (no product table). |
| `inventory` | 1 | Shared product catalog (`inventory.products` only). CRM DML; no DDL. |
| `cdp` | 3 | Person identity + product registry (no CRM DDL) |
| `accounts` | 4 | Auth, org, roles (no CRM DDL) |

### ID conventions

| Column pattern | PostgreSQL type | Notes |
|---|---|---|
| `organization_id`, `*_user_id` | `bigint` | Cast `::bigint` in raw SQL |
| `companies.id`, `deals.id`, `company_id`, … | `text` | CRM cuid primary/foreign keys |
| `cdp.customer_profile.cdp_id`, `contact_id`, `account_contact_id` | `text` | Person key; CRM FKs equal `cdp_id` |

Related: [`bigint-ids.md`](./bigint-ids.md) · [`cdp-customer-identity.md`](./cdp-customer-identity.md) · [`multi-tenancy-common-model.md`](./multi-tenancy-common-model.md)

## crm schema

### `crm.agent_memories`

Hydrated into coworker context alongside client STM.

| Column | Type | Null | Default | Description |
|---|---|---|---|---|
| `id` | text | required | — | Primary key. |
| `organization_id` | bigint | required | — | Tenant (organization) this row belongs to. |
| `scope_type` | varchar(16) | required | — | org | user | contact | deal |
| `scope_id` | varchar(64) | required | `''::character varying` | Empty string for org-wide; otherwise user/contact/deal id. |
| `slot_key` | varchar(64) | required | — | slot key. |
| `slot_value` | jsonb | required | — | slot value. |
| `source` | varchar(32) | nullable | — | source. |
| `expires_at` | timestamp with time zone | nullable | — | expires at. |
| `created_at` | timestamp with time zone | required | `now()` | Row creation timestamp. |
| `updated_at` | timestamp with time zone | required | `now()` | Last update timestamp. |

### `crm.api_keys`

Tenant integration API keys (admin-created). Secret stored as hash only.

| Column | Type | Null | Default | Description |
|---|---|---|---|---|
| `id` | text | required | — | Primary key. |
| `organization_id` | bigint | required | — | Tenant (organization) this row belongs to. |
| `name` | varchar(120) | required | — | name. |
| `key_prefix` | varchar(32) | required | — | Public hint, e.g. crm_live_ab12cd34 |
| `key_hash` | varchar(64) | required | — | key hash. |
| `scopes` | ARRAY | required | `'{}'::text[]` | contacts | companies | deals | activities | products | quotes | invoices | commerce |
| `created_by_user_id` | bigint | required | — | User who created the row. |
| `created_at` | timestamp with time zone | required | `now()` | Row creation timestamp. |
| `revoked_at` | timestamp with time zone | nullable | — | revoked at. |
| `last_used_at` | timestamp with time zone | nullable | — | last used at. |

### `crm.audit_logs`

CRM-used table.

| Column | Type | Null | Default | Description |
|---|---|---|---|---|
| `id` | text | required | — | Primary key. |
| `organization_id` | bigint | required | — | Tenant (organization) this row belongs to. |
| `actor_user_id` | bigint | nullable | — | actor user ID. |
| `action` | USER-DEFINED | required | — | action. |
| `entity_type` | text | required | — | entity type. |
| `entity_id` | text | required | — | entity ID. |
| `meta` | jsonb | nullable | — | meta. |
| `created_at` | timestamp without time zone | required | `CURRENT_TIMESTAMP` | Row creation timestamp. |

### `crm.catalog_integration_connections`

Org-level catalog connectors (Shopify, WooCommerce, custom JSON feed).

| Column | Type | Null | Default | Description |
|---|---|---|---|---|
| `id` | text | required | — | Primary key. |
| `organization_id` | bigint | required | — | Tenant (organization) this row belongs to. |
| `provider` | USER-DEFINED | required | — | provider. |
| `status` | USER-DEFINED | required | `'disconnected'::crm.CatalogConnectionStatus` | Workflow status for this record. |
| `store_url` | text | nullable | — | Shop domain or storefront base URL |
| `api_key` | text | nullable | — | Access token / consumer key (treat as secret) |
| `api_secret` | text | nullable | — | Consumer secret or secondary credential |
| `last_sync_at` | timestamp without time zone | nullable | — | last sync at. |
| `last_sync_status` | text | nullable | — | last sync status. |
| `last_sync_message` | text | nullable | — | last sync message. |
| `created_by_user_id` | bigint | nullable | — | User who created the row. |
| `created_at` | timestamp without time zone | required | `CURRENT_TIMESTAMP` | Row creation timestamp. |
| `updated_at` | timestamp without time zone | required | — | Last update timestamp. |

### `crm.companies`

CRM-used table.

| Column | Type | Null | Default | Description |
|---|---|---|---|---|
| `id` | text | required | — | Primary key. |
| `name` | text | required | — | name. |
| `industry` | text | nullable | — | industry. |
| `employee_count` | integer | nullable | — | employee count. |
| `owner_user_id` | bigint | nullable | — | CRM owner user (accounts.setup_users.id). |
| `created_at` | timestamp without time zone | required | `CURRENT_TIMESTAMP` | Row creation timestamp. |
| `updated_at` | timestamp without time zone | required | — | Last update timestamp. |
| `organization_id` | bigint | required | — | Tenant (organization) this row belongs to. |
| `domain` | text | nullable | — | domain. |
| `linkedin_url` | text | nullable | — | linkedin url. |
| `logo_url` | text | nullable | — | logo url. |
| `channel_role` | USER-DEFINED | required | `'standard'::crm.CompanyChannelRole` | channel role. |
| `parent_company_id` | text | nullable | — | parent company ID. |

### `crm.company_locations`

CRM-used table.

| Column | Type | Null | Default | Description |
|---|---|---|---|---|
| `id` | text | required | — | Primary key. |
| `company_id` | text | required | — | FK to crm.companies.id. |
| `name` | text | required | — | name. |
| `type` | USER-DEFINED | required | `'branch'::crm.LocationType` | type. |
| `address` | text | nullable | — | address. |
| `city` | text | nullable | — | city. |
| `industry` | text | nullable | — | industry. |
| `employee_count` | integer | nullable | — | employee count. |
| `created_at` | timestamp without time zone | required | `CURRENT_TIMESTAMP` | Row creation timestamp. |
| `updated_at` | timestamp without time zone | required | — | Last update timestamp. |
| `owner_user_id` | bigint | nullable | — | CRM owner user (accounts.setup_users.id). |
| `organization_id` | bigint | required | — | Tenant (organization) this row belongs to. |

### `crm.contact_activities`

Contact timeline rows. contactId is a cross-DB UUID into my_account_qa.contacts.

| Column | Type | Null | Default | Description |
|---|---|---|---|---|
| `id` | text | required | — | Primary key. |
| `contact_id` | text | required | — | CDP person key (`customer_profile.cdp_id`). |
| `type` | USER-DEFINED | required | — | type. |
| `subject` | text | required | — | subject. |
| `body` | text | nullable | — | body. |
| `due_at` | timestamp without time zone | nullable | — | due at. |
| `completed_at` | timestamp without time zone | nullable | — | When processing completed successfully. |
| `created_by_user_id` | bigint | nullable | — | User who created the row. |
| `created_at` | timestamp without time zone | required | `CURRENT_TIMESTAMP` | Row creation timestamp. |
| `updated_at` | timestamp without time zone | required | — | Last update timestamp. |
| `folder` | USER-DEFINED | required | `'inbox'::crm.InboxFolder` | folder. |
| `thread_id` | text | nullable | — | Groups replies into one conversation in the Inbox UI |
| `gmail_message_id` | text | nullable | — | gmail message ID. |
| `gmail_thread_id` | text | nullable | — | gmail thread ID. |
| `email_direction` | USER-DEFINED | nullable | — | email direction. |
| `rfc_message_id` | text | nullable | — | RFC Message-ID header — required for client-side reply threading |
| `reminder_sent_at` | timestamp without time zone | nullable | — | Legacy 1-hour reminder flag (mirrored to reminder1hSentAt for back-compat) |
| `organization_id` | bigint | required | — | Tenant (organization) this row belongs to. |
| `task_status` | USER-DEFINED | nullable | — | Task workflow status (null for non-task activities). Overdue is derived. |
| `assignee_user_id` | bigint | nullable | — | Task assignee (required for type=task) |
| `transcript_text` | text | nullable | — | Meeting / call transcript text once a provider (or manual upload) supplies it |
| `transcript_source` | text | nullable | — | transcript source. |
| `transcript_analyzed_at` | timestamp without time zone | nullable | — | transcript analyzed at. |
| `transcript_insights` | jsonb | nullable | — | Extracted signals: intent, commitments, objections, BANT hints |
| `provider_message_id` | text | nullable | — | Provider-agnostic message id (Gmail id or Graph message id) for dedupe |
| `provider_thread_id` | text | nullable | — | Provider-agnostic conversation id (Gmail threadId or Graph conversationId) |
| `mail_provider` | USER-DEFINED | nullable | — | mail provider. |
| `needs_manual_response` | boolean | required | `false` | Set by the auto-reply agent when a human must answer (sensitive content) |
| `reminder_24h_sent_at` | timestamp without time zone | nullable | — | Set when the T−24h owner + customer reminder legs completed (or permanently skipped) |
| `reminder_1h_sent_at` | timestamp without time zone | nullable | — | Set when the T−1h owner + customer reminder legs completed (or permanently skipped) |
| `miss_escalated_at` | timestamp without time zone | nullable | — | Set when admins were escalated that this meeting was not conducted (no transcript) |
| `mom_sent_at` | timestamp without time zone | nullable | — | Set when Minutes of Meeting email was sent after transcript attach |

### `crm.contact_profiles`

CRM-only fields for a shared my_account_qa.contacts person (cross-DB by UUID).

| Column | Type | Null | Default | Description |
|---|---|---|---|---|
| `id` | text | required | — | Primary key. |
| `account_contact_id` | text | required | — | CDP person key (`cdp.customer_profile.cdp_id`). |
| `organization_id` | bigint | required | — | Tenant (organization) this row belongs to. |
| `company_id` | text | nullable | — | FK to crm.companies.id. |
| `location_id` | text | nullable | — | FK to crm.company_locations.id. |
| `owner_user_id` | bigint | nullable | — | CRM owner user (accounts.setup_users.id). |
| `lifecycle_stage` | varchar(32) | required | `'lead'::character varying` | lifecycle stage. |
| `lead_source` | varchar(128) | nullable | — | lead source. |
| `lead_status` | varchar(32) | required | `'new'::character varying` | lead status. |
| `disqualify_reason` | varchar(64) | nullable | — | disqualify reason. |
| `bant_budget` | boolean | nullable | — | bant budget. |
| `bant_authority` | boolean | nullable | — | bant authority. |
| `bant_need` | boolean | nullable | — | bant need. |
| `bant_timeline` | boolean | nullable | — | bant timeline. |
| `converted_deal_id` | text | nullable | — | converted deal ID. |
| `tags` | ARRAY | required | `ARRAY[]::text[]` | tags. |
| `crm_status` | varchar(32) | required | `'active'::character varying` | crm status. |
| `notes` | text | nullable | — | notes. |
| `is_pinned` | boolean | required | `false` | is pinned. |
| `created_at` | timestamp without time zone | required | `CURRENT_TIMESTAMP` | Row creation timestamp. |
| `updated_at` | timestamp without time zone | required | — | Last update timestamp. |
| `assignment_reason` | text | nullable | — | Assignment Agent ownership (score-gated route) |
| `sla_deadline` | timestamp without time zone | nullable | — | sla deadline. |
| `assigned_at` | timestamp without time zone | nullable | — | assigned at. |
| `assignment_escalated` | boolean | required | `false` | assignment escalated. |
| `nurture_status` | varchar(32) | nullable | — | Nurturing Agent ownership overlay |
| `nurture_sequence_step` | integer | nullable | — | nurture sequence step. |
| `nurture_started_at` | timestamp without time zone | nullable | — | nurture started at. |
| `nurture_last_touch_at` | timestamp without time zone | nullable | — | nurture last touch at. |
| `flagged_for_review` | boolean | required | `false` | Lifecycle Agent review flag (ambiguous evidence / stall) |
| `flag_reason` | varchar(500) | nullable | — | flag reason. |
| `lifecycle_last_action` | varchar(64) | nullable | — | lifecycle last action. |
| `lifecycle_last_reason` | text | nullable | — | lifecycle last reason. |
| `lifecycle_last_run_at` | timestamp with time zone | nullable | — | lifecycle last run at. |
| `custom_attributes` | jsonb | nullable | — | Vertical pack field values (CRM overlay — never CDP columns). |

### `crm.contracts`

CRM-used table.

| Column | Type | Null | Default | Description |
|---|---|---|---|---|
| `id` | text | required | — | Primary key. |
| `organization_id` | bigint | required | — | Tenant (organization) this row belongs to. |
| `company_id` | text | required | — | FK to crm.companies.id. |
| `deal_id` | text | nullable | — | FK to crm.deals.id. |
| `title` | text | required | — | title. |
| `starts_at` | timestamp without time zone | required | — | starts at. |
| `ends_at` | timestamp without time zone | required | — | ends at. |
| `arr` | numeric(12) | nullable | — | arr. |
| `renew_deal_id` | text | nullable | — | renew deal ID. |
| `renewal_reminded_at` | timestamp without time zone | nullable | — | renewal reminded at. |
| `created_at` | timestamp without time zone | required | `CURRENT_TIMESTAMP` | Row creation timestamp. |
| `updated_at` | timestamp without time zone | required | — | Last update timestamp. |

### `crm.deal_activities`

CRM-used table.

| Column | Type | Null | Default | Description |
|---|---|---|---|---|
| `id` | text | required | — | Primary key. |
| `deal_id` | text | required | — | FK to crm.deals.id. |
| `type` | USER-DEFINED | required | — | type. |
| `subject` | text | required | — | subject. |
| `body` | text | nullable | — | body. |
| `due_at` | timestamp without time zone | nullable | — | due at. |
| `completed_at` | timestamp without time zone | nullable | — | When processing completed successfully. |
| `created_by_user_id` | bigint | nullable | — | User who created the row. |
| `created_at` | timestamp without time zone | required | `CURRENT_TIMESTAMP` | Row creation timestamp. |
| `updated_at` | timestamp without time zone | required | — | Last update timestamp. |
| `organization_id` | bigint | required | — | Tenant (organization) this row belongs to. |

### `crm.deals`

CRM-used table.

| Column | Type | Null | Default | Description |
|---|---|---|---|---|
| `id` | text | required | — | Primary key. |
| `title` | text | required | — | title. |
| `stage` | USER-DEFINED | required | `'qualification'::crm.DealStage` | stage. |
| `amount` | numeric(12) | nullable | — | amount. |
| `company_id` | text | required | — | FK to crm.companies.id. |
| `location_id` | text | required | — | FK to crm.company_locations.id. |
| `contact_id` | text | nullable | — | CDP person key (`customer_profile.cdp_id`). |
| `contact_name` | text | nullable | — | contact name. |
| `contact_email` | text | nullable | — | contact email. |
| `owner_user_id` | bigint | nullable | — | CRM owner user (accounts.setup_users.id). |
| `notes` | text | nullable | — | notes. |
| `closed_at` | timestamp without time zone | nullable | — | closed at. |
| `created_at` | timestamp without time zone | required | `CURRENT_TIMESTAMP` | Row creation timestamp. |
| `updated_at` | timestamp without time zone | required | — | Last update timestamp. |
| `expected_close_date` | timestamp without time zone | nullable | — | expected close date. |
| `lost_reason` | text | nullable | — | lost reason. |
| `organization_id` | bigint | required | — | Tenant (organization) this row belongs to. |

### `crm.domain_enrichment_cache`

Cached firmographic enrichments per email/company domain (30-day TTL).

| Column | Type | Null | Default | Description |
|---|---|---|---|---|
| `id` | text | required | — | Primary key. |
| `organization_id` | bigint | required | — | Tenant (organization) this row belongs to. |
| `domain` | varchar(255) | required | — | domain. |
| `payload` | jsonb | required | — | payload. |
| `source` | text | nullable | — | source. |
| `expires_at` | timestamp without time zone | required | — | expires at. |
| `created_at` | timestamp without time zone | required | `CURRENT_TIMESTAMP` | Row creation timestamp. |
| `updated_at` | timestamp without time zone | required | `CURRENT_TIMESTAMP` | Last update timestamp. |

### `crm.email_auto_reply_jobs`

an autonomous reply; sensitive mail is escalated to the owner (or admin).

| Column | Type | Null | Default | Description |
|---|---|---|---|---|
| `id` | text | required | — | Primary key. |
| `organization_id` | bigint | required | — | Tenant (organization) this row belongs to. |
| `contact_id` | text | required | — | CDP person key (`customer_profile.cdp_id`). |
| `inbound_activity_id` | text | required | — | Inbound ContactActivity that triggered this job |
| `mailbox_user_id` | bigint | nullable | — | Mailbox owner whose OAuth connection received the mail |
| `status` | USER-DEFINED | required | `'pending'::crm.EmailAutoReplyStatus` | Workflow status for this record. |
| `decision` | text | nullable | — | decision. |
| `sensitivity` | text | nullable | — | safe | sensitive | unknown |
| `category` | text | nullable | — | category. |
| `reason` | text | nullable | — | reason. |
| `reply_activity_id` | text | nullable | — | Outbound ContactActivity created after an auto-reply send |
| `escalated_to_user_id` | bigint | nullable | — | escalated to user ID. |
| `attempts` | integer | required | `0` | Number of processing attempts. |
| `max_attempts` | integer | required | `3` | Maximum retry attempts before permanent failure. |
| `next_retry_at` | timestamp without time zone | nullable | — | When the job should be retried. |
| `last_error` | text | nullable | — | Last error message from processing. |
| `result_summary` | jsonb | nullable | — | JSON summary of agent/job outcome. |
| `created_at` | timestamp without time zone | required | `CURRENT_TIMESTAMP` | Row creation timestamp. |
| `updated_at` | timestamp without time zone | required | `CURRENT_TIMESTAMP` | Last update timestamp. |
| `completed_at` | timestamp without time zone | nullable | — | When processing completed successfully. |

### `crm.invoice_lines`

CRM-used table.

| Column | Type | Null | Default | Description |
|---|---|---|---|---|
| `id` | text | required | — | Primary key. |
| `invoice_id` | text | required | — | invoice ID. |
| `kind` | USER-DEFINED | required | `'product'::crm.InvoiceLineKind` | kind. |
| `product_id` | text | nullable | — | Product identifier (crm product cuid or cdp.products.product_id). |
| `addon_id` | text | nullable | — | addon ID. |
| `name` | text | required | — | name. |
| `description` | text | nullable | — | description. |
| `quantity` | numeric(12) | required | `1` | quantity. |
| `unit_price` | numeric(12) | required | — | unit price. |
| `tax_percent` | numeric(5) | required | `0` | tax percent. |
| `amount` | numeric(12) | required | — | amount. |
| `sort_order` | integer | required | `0` | sort order. |
| `created_at` | timestamp without time zone | required | `CURRENT_TIMESTAMP` | Row creation timestamp. |
| `updated_at` | timestamp without time zone | required | — | Last update timestamp. |
| `organization_id` | bigint | required | — | Tenant (organization) this row belongs to. |

### `crm.invoice_templates`

CRM-used table.

| Column | Type | Null | Default | Description |
|---|---|---|---|---|
| `id` | text | required | — | Primary key. |
| `organization_id` | bigint | required | — | Tenant (organization) this row belongs to. |
| `name` | text | required | — | name. |
| `code` | text | nullable | — | code. |
| `kind` | USER-DEFINED | required | `'standard'::crm.InvoiceTemplateKind` | kind. |
| `sections` | jsonb | required | — | sections. |
| `blueprint` | jsonb | nullable | — | blueprint. |
| `assets` | jsonb | nullable | — | assets. |
| `is_default` | boolean | required | `false` | is default. |
| `created_at` | timestamp without time zone | required | `CURRENT_TIMESTAMP` | Row creation timestamp. |
| `updated_at` | timestamp without time zone | required | — | Last update timestamp. |

### `crm.invoices`

CRM-used table.

| Column | Type | Null | Default | Description |
|---|---|---|---|---|
| `id` | text | required | — | Primary key. |
| `organization_id` | bigint | required | — | Tenant (organization) this row belongs to. |
| `order_id` | text | nullable | — | order ID. |
| `company_id` | text | nullable | — | FK to crm.companies.id. |
| `number` | text | required | — | number. |
| `status` | USER-DEFINED | required | `'draft'::crm.InvoiceStatus` | Workflow status for this record. |
| `currency` | text | required | `'USD'::text` | currency. |
| `total` | numeric(12) | required | `0` | total. |
| `due_at` | timestamp without time zone | nullable | — | due at. |
| `paid_at` | timestamp without time zone | nullable | — | paid at. |
| `created_by_user_id` | bigint | nullable | — | User who created the row. |
| `created_at` | timestamp without time zone | required | `CURRENT_TIMESTAMP` | Row creation timestamp. |
| `updated_at` | timestamp without time zone | required | — | Last update timestamp. |
| `deal_id` | text | nullable | — | FK to crm.deals.id. |
| `discount_amount` | numeric(12) | required | `0` | discount amount. |
| `tax_amount` | numeric(12) | required | `0` | tax amount. |
| `issue_date` | timestamp without time zone | nullable | — | issue date. |
| `payment_terms` | text | nullable | — | payment terms. |
| `notes` | text | nullable | — | notes. |
| `billing_address` | text | nullable | — | billing address. |
| `lead_email` | text | nullable | — | lead email. |
| `lead_phone` | text | nullable | — | lead phone. |
| `tax_id` | text | nullable | — | tax ID. |
| `tax_details` | jsonb | nullable | — | tax details. |
| `template_id` | text | nullable | — | template ID. |
| `sections` | jsonb | nullable | — | sections. |
| `blueprint` | jsonb | nullable | — | blueprint. |
| `assets` | jsonb | nullable | — | assets. |
| `approved_by_user_id` | bigint | nullable | — | approved by user ID. |
| `approved_at` | timestamp with time zone | nullable | — | approved at. |
| `approval_status` | varchar(32) | required | `'drafting'::character varying` | approval status. |

### `crm.lead_enrichment_jobs`

Operational queue for lead firmographic enrichment (not customer data).

| Column | Type | Null | Default | Description |
|---|---|---|---|---|
| `id` | text | required | — | Primary key. |
| `organization_id` | bigint | required | — | Tenant (organization) this row belongs to. |
| `contact_id` | text | required | — | CDP person key (`customer_profile.cdp_id`). |
| `company_id` | text | nullable | — | FK to crm.companies.id. |
| `status` | USER-DEFINED | required | `'pending'::crm.LeadEnrichmentStatus` | Workflow status for this record. |
| `attempts` | integer | required | `0` | Number of processing attempts. |
| `max_attempts` | integer | required | `5` | Maximum retry attempts before permanent failure. |
| `next_retry_at` | timestamp without time zone | nullable | — | When the job should be retried. |
| `last_error` | text | nullable | — | Last error message from processing. |
| `result_summary` | jsonb | nullable | — | JSON summary of agent/job outcome. |
| `created_at` | timestamp without time zone | required | `CURRENT_TIMESTAMP` | Row creation timestamp. |
| `updated_at` | timestamp without time zone | required | — | Last update timestamp. |
| `completed_at` | timestamp without time zone | nullable | — | When processing completed successfully. |

### `crm.lead_enrichment_snapshots`

Enrichment Agent owned snapshot per contact (never overwrites user data silently).

| Column | Type | Null | Default | Description |
|---|---|---|---|---|
| `id` | text | required | — | Primary key. |
| `organization_id` | bigint | required | — | Tenant (organization) this row belongs to. |
| `contact_id` | text | required | — | CDP person key (`customer_profile.cdp_id`). |
| `company_name` | text | nullable | — | Display name of the organization. |
| `company_size` | text | nullable | — | company size. |
| `industry` | text | nullable | — | industry. |
| `revenue_band` | text | nullable | — | revenue band. |
| `seniority_tier` | varchar(32) | nullable | — | seniority tier. |
| `geography` | text | nullable | — | geography. |
| `email_domain_type` | varchar(16) | nullable | — | email domain type. |
| `enrichment_confidence` | float8 | nullable | — | enrichment confidence. |
| `enrichment_source` | text | nullable | — | enrichment source. |
| `conflict_flags` | jsonb | nullable | — | conflict flags. |
| `enrichment_timestamp` | timestamp without time zone | required | `CURRENT_TIMESTAMP` | enrichment timestamp. |
| `created_at` | timestamp without time zone | required | `CURRENT_TIMESTAMP` | Row creation timestamp. |
| `updated_at` | timestamp without time zone | required | `CURRENT_TIMESTAMP` | Last update timestamp. |
| `company_description` | text | nullable | — | company description. |
| `products` | text | nullable | — | products. |

### `crm.lead_lifecycle_jobs`

stage, and sales pipeline stage progression from CRM signals. crm_qa only.

| Column | Type | Null | Default | Description |
|---|---|---|---|---|
| `id` | text | required | — | Primary key. |
| `organization_id` | bigint | required | — | Tenant (organization) this row belongs to. |
| `contact_id` | text | required | — | CDP person key (`customer_profile.cdp_id`). |
| `status` | USER-DEFINED | required | `'pending'::crm.LeadLifecycleStatus` | Workflow status for this record. |
| `ladder` | text | nullable | — | Which ladder moved: lead_status | lifecycle | pipeline | none |
| `from_stage` | text | nullable | — | from stage. |
| `to_stage` | text | nullable | — | to stage. |
| `decision` | text | nullable | — | decision. |
| `reason` | text | nullable | — | reason. |
| `trigger_reason` | text | nullable | — | trigger reason. |
| `deal_id` | text | nullable | — | FK to crm.deals.id. |
| `attempts` | integer | required | `0` | Number of processing attempts. |
| `max_attempts` | integer | required | `5` | Maximum retry attempts before permanent failure. |
| `next_retry_at` | timestamp without time zone | nullable | — | When the job should be retried. |
| `last_error` | text | nullable | — | Last error message from processing. |
| `result_summary` | jsonb | nullable | — | JSON summary of agent/job outcome. |
| `last_applied_at` | timestamp without time zone | nullable | — | last applied at. |
| `created_at` | timestamp without time zone | required | `CURRENT_TIMESTAMP` | Row creation timestamp. |
| `updated_at` | timestamp without time zone | required | — | Last update timestamp. |
| `completed_at` | timestamp without time zone | nullable | — | When processing completed successfully. |

### `crm.lead_nurture_jobs`

CRM-used table.

| Column | Type | Null | Default | Description |
|---|---|---|---|---|
| `id` | text | required | — | Primary key. |
| `organization_id` | bigint | required | — | Tenant (organization) this row belongs to. |
| `contact_id` | text | required | — | CDP person key (`customer_profile.cdp_id`). |
| `status` | USER-DEFINED | required | `'pending'::crm.LeadNurtureStatus` | Workflow status for this record. |
| `decision` | text | nullable | — | decision. |
| `attempts` | integer | required | `0` | Number of processing attempts. |
| `max_attempts` | integer | required | `5` | Maximum retry attempts before permanent failure. |
| `next_retry_at` | timestamp without time zone | nullable | — | When the job should be retried. |
| `last_error` | text | nullable | — | Last error message from processing. |
| `result_summary` | jsonb | nullable | — | JSON summary of agent/job outcome. |
| `last_sent_at` | timestamp without time zone | nullable | — | last sent at. |
| `created_at` | timestamp without time zone | required | `CURRENT_TIMESTAMP` | Row creation timestamp. |
| `updated_at` | timestamp without time zone | required | — | Last update timestamp. |
| `completed_at` | timestamp without time zone | nullable | — | When processing completed successfully. |
| `nurture_status` | varchar(32) | nullable | — | nurture status. |
| `current_sequence_step` | integer | nullable | — | current sequence step. |
| `sequence_started_at` | timestamp without time zone | nullable | — | sequence started at. |

### `crm.lead_scoring_jobs`

recalculates when engagement signals change. crm_qa only.

| Column | Type | Null | Default | Description |
|---|---|---|---|---|
| `id` | text | required | — | Primary key. |
| `organization_id` | bigint | required | — | Tenant (organization) this row belongs to. |
| `contact_id` | text | required | — | CDP person key (`customer_profile.cdp_id`). |
| `status` | USER-DEFINED | required | `'pending'::crm.LeadScoringStatus` | Workflow status for this record. |
| `score` | integer | nullable | — | score. |
| `grade` | text | nullable | — | grade. |
| `band` | text | nullable | — | band. |
| `rationale` | text | nullable | — | rationale. |
| `factors` | jsonb | nullable | — | factors. |
| `next_best_action` | text | nullable | — | next best action. |
| `trigger_reason` | text | nullable | — | trigger reason. |
| `previous_score` | integer | nullable | — | previous score. |
| `attempts` | integer | required | `0` | Number of processing attempts. |
| `max_attempts` | integer | required | `5` | Maximum retry attempts before permanent failure. |
| `next_retry_at` | timestamp without time zone | nullable | — | When the job should be retried. |
| `last_error` | text | nullable | — | Last error message from processing. |
| `result_summary` | jsonb | nullable | — | JSON summary of agent/job outcome. |
| `created_at` | timestamp without time zone | required | `CURRENT_TIMESTAMP` | Row creation timestamp. |
| `updated_at` | timestamp without time zone | required | `CURRENT_TIMESTAMP` | Last update timestamp. |
| `completed_at` | timestamp without time zone | nullable | — | When processing completed successfully. |
| `fit_score` | integer | nullable | — | fit score. |
| `intent_score` | integer | nullable | — | intent score. |

### `crm.lead_summaries`

signature (activities, stage, firmographics) changes. crm_qa only.

| Column | Type | Null | Default | Description |
|---|---|---|---|---|
| `id` | text | required | — | Primary key. |
| `organization_id` | bigint | required | — | Tenant (organization) this row belongs to. |
| `contact_id` | text | required | — | CDP person key (`customer_profile.cdp_id`). |
| `summary` | text | required | — | summary. |
| `headline` | text | nullable | — | headline. |
| `intent` | text | nullable | — | intent. |
| `signature` | text | required | — | signature. |
| `source` | text | required | `'heuristic'::text` | source. |
| `model` | text | nullable | — | model. |
| `created_at` | timestamp without time zone | required | `CURRENT_TIMESTAMP` | Row creation timestamp. |
| `updated_at` | timestamp without time zone | required | — | Last update timestamp. |
| `recommended_action` | text | nullable | — | recommended action. |
| `flags` | jsonb | nullable | — | flags. |

### `crm.meeting_analyses`

Meeting Analysis Agent — structured evidence for Lifecycle (never raw transcript).

| Column | Type | Null | Default | Description |
|---|---|---|---|---|
| `id` | text | required | — | Primary key. |
| `organization_id` | bigint | required | — | Tenant (organization) this row belongs to. |
| `activity_id` | text | required | — | activity ID. |
| `contact_id` | text | nullable | — | CDP person key (`customer_profile.cdp_id`). |
| `deal_id` | text | nullable | — | FK to crm.deals.id. |
| `outcome` | varchar(32) | nullable | — | outcome. |
| `bant_budget` | boolean | nullable | — | bant budget. |
| `bant_authority` | boolean | nullable | — | bant authority. |
| `bant_need` | boolean | nullable | — | bant need. |
| `bant_timeline_text` | varchar(256) | nullable | — | bant timeline text. |
| `next_step_agreed` | text | nullable | — | next step agreed. |
| `objections_raised` | jsonb | required | `'[]'::jsonb` | objections raised. |
| `confidence` | float8 | required | `0` | confidence. |
| `evidence` | jsonb | required | `'[]'::jsonb` | evidence. |
| `analyzed_at` | timestamp with time zone | required | `now()` | analyzed at. |
| `created_at` | timestamp with time zone | required | `now()` | Row creation timestamp. |

### `crm.meeting_assist_sessions`

ContactActivity.transcriptText for lifecycle analysis.

| Column | Type | Null | Default | Description |
|---|---|---|---|---|
| `id` | text | required | — | Primary key. |
| `organization_id` | bigint | required | — | Tenant (organization) this row belongs to. |
| `contact_id` | text | required | — | CDP person key (`customer_profile.cdp_id`). |
| `activity_id` | text | required | — | activity ID. |
| `provider` | USER-DEFINED | required | `'other'::crm.meeting_assist_provider` | provider. |
| `external_meeting_id` | text | nullable | — | external meeting ID. |
| `join_url` | text | nullable | — | join url. |
| `host_user_id` | bigint | nullable | — | host user ID. |
| `status` | USER-DEFINED | required | `'active'::crm.meeting_assist_status` | Workflow status for this record. |
| `started_at` | timestamp without time zone | required | `CURRENT_TIMESTAMP` | started at. |
| `ended_at` | timestamp without time zone | nullable | — | ended at. |
| `last_assist_at` | timestamp without time zone | nullable | — | last assist at. |
| `last_suggestions` | jsonb | nullable | — | last suggestions. |
| `meta` | jsonb | nullable | — | meta. |
| `created_at` | timestamp without time zone | required | `CURRENT_TIMESTAMP` | Row creation timestamp. |
| `updated_at` | timestamp without time zone | required | — | Last update timestamp. |

### `crm.meeting_transcript_chunks`

CRM-used table.

| Column | Type | Null | Default | Description |
|---|---|---|---|---|
| `id` | text | required | — | Primary key. |
| `session_id` | text | required | — | session ID. |
| `seq` | integer | required | — | seq. |
| `speaker` | text | nullable | — | speaker. |
| `text` | text | required | — | text. |
| `spoken_at` | timestamp without time zone | nullable | — | spoken at. |
| `source` | text | required | `'live_push'::text` | source. |
| `created_at` | timestamp without time zone | required | `CURRENT_TIMESTAMP` | Row creation timestamp. |
| `organization_id` | bigint | required | — | Tenant (organization) this row belongs to. |

### `crm.notifications`

Recipients are account-DB user UUIDs; no FK to my_account_qa.

| Column | Type | Null | Default | Description |
|---|---|---|---|---|
| `id` | text | required | — | Primary key. |
| `organization_id` | bigint | required | — | Tenant (organization) this row belongs to. |
| `recipient_user_id` | bigint | required | — | recipient user ID. |
| `actor_user_id` | bigint | nullable | — | actor user ID. |
| `kind` | text | required | — | kind. |
| `title` | text | required | — | title. |
| `body` | text | nullable | — | body. |
| `href` | text | nullable | — | href. |
| `entity_type` | text | nullable | — | entity type. |
| `entity_id` | text | nullable | — | entity ID. |
| `contact_id` | text | nullable | — | CDP person key (`customer_profile.cdp_id`). |
| `metadata` | jsonb | nullable | — | metadata. |
| `read_at` | timestamp without time zone | nullable | — | read at. |
| `created_at` | timestamp without time zone | required | `CURRENT_TIMESTAMP` | Row creation timestamp. |

### `crm.order_lines`

CRM-used table.

| Column | Type | Null | Default | Description |
|---|---|---|---|---|
| `id` | text | required | — | Primary key. |
| `order_id` | text | required | — | order ID. |
| `product_id` | text | nullable | — | Product identifier (crm product cuid or cdp.products.product_id). |
| `name` | text | required | — | name. |
| `quantity` | numeric(12) | required | `1` | quantity. |
| `unit_price` | numeric(12) | required | — | unit price. |
| `amount` | numeric(12) | required | — | amount. |
| `sort_order` | integer | required | `0` | sort order. |
| `created_at` | timestamp without time zone | required | `CURRENT_TIMESTAMP` | Row creation timestamp. |
| `updated_at` | timestamp without time zone | required | — | Last update timestamp. |
| `organization_id` | bigint | required | — | Tenant (organization) this row belongs to. |

### `crm.org_assignment_settings`

Per-org sales assignment thresholds (deal-size → seniority routing).

| Column | Type | Null | Default | Description |
|---|---|---|---|---|
| `id` | text | required | — | Primary key. |
| `organization_id` | bigint | required | — | Tenant (organization) this row belongs to. |
| `senior_amount_threshold` | integer | required | `50000` | senior amount threshold. |
| `updated_by_user_id` | bigint | nullable | — | updated by user ID. |
| `created_at` | timestamp without time zone | required | `CURRENT_TIMESTAMP` | Row creation timestamp. |
| `updated_at` | timestamp without time zone | required | — | Last update timestamp. |
| `lead_icp` | jsonb | nullable | — | ICP knobs for Fit scoring: { targetIndustries, sizeTiers, serviceableGeos } |

### `crm.organization_profiles`

CRM-owned optional pack config. Tenant industry itself is `accounts.organizations.industry_type` (read-only in CRM). `vertical` on this table is not the source of truth.

| Column | Type | Null | Default | Description |
|---|---|---|---|---|
| `organization_id` | bigint | required | — | Tenant (organization) this row belongs to. |
| `vertical` | USER-DEFINED | required | `'general'::crm.OrganizationVertical` | vertical. |
| `vertical_config` | jsonb | required | `'{}'::jsonb` | vertical config. |
| `created_at` | timestamp without time zone | required | `CURRENT_TIMESTAMP` | Row creation timestamp. |
| `updated_at` | timestamp without time zone | required | `CURRENT_TIMESTAMP` | Last update timestamp. |

### `crm.password_reset_tokens`

Password reset tokens (CRM-owned; created on first use).

| Column | Type | Null | Default | Description |
|---|---|---|---|---|
| `id` | uuid | required | `gen_random_uuid()` | Primary key. |
| `user_id` | uuid | required | — | User (accounts.setup_users.id) — note: may be bigint on worktual_bigint. |
| `email` | varchar(255) | required | — | Email address the reset was requested for. |
| `token_hash` | text | required | — | SHA-256 hash of the reset token. |
| `expires_at` | timestamptz | required | — | Token expiry time. |
| `used_at` | timestamptz | nullable | — | When the token was consumed. |
| `created_at` | timestamptz | required | `now()` | Row creation timestamp. |

### `crm.price_book_entries`

List price for a product, offer, or addon within a price book (exactly one target).

| Column | Type | Null | Default | Description |
|---|---|---|---|---|
| `id` | text | required | — | Primary key. |
| `organization_id` | bigint | required | — | Tenant (organization) this row belongs to. |
| `price_book_id` | text | required | — | price book ID. |
| `product_id` | text | nullable | — | Product identifier (crm product cuid or cdp.products.product_id). |
| `offer_id` | text | nullable | — | offer ID. |
| `addon_id` | text | nullable | — | addon ID. |
| `amount` | numeric(12) | required | — | amount. |
| `billing_frequency` | USER-DEFINED | nullable | — | billing frequency. |
| `created_at` | timestamp without time zone | required | `CURRENT_TIMESTAMP` | Row creation timestamp. |
| `updated_at` | timestamp without time zone | required | — | Last update timestamp. |

### `crm.price_books`

Org-level rate card (region / market / currency list).

| Column | Type | Null | Default | Description |
|---|---|---|---|---|
| `id` | text | required | — | Primary key. |
| `organization_id` | bigint | required | — | Tenant (organization) this row belongs to. |
| `name` | text | required | — | name. |
| `code` | text | nullable | — | code. |
| `currency` | text | required | `'USD'::text` | currency. |
| `is_default` | boolean | required | `false` | is default. |
| `created_at` | timestamp without time zone | required | `CURRENT_TIMESTAMP` | Row creation timestamp. |
| `updated_at` | timestamp without time zone | required | — | Last update timestamp. |

### `crm.process_confirmations`

Owner approval gate for B2B post-meeting process agent (email/proposal/close).

| Column | Type | Null | Default | Description |
|---|---|---|---|---|
| `id` | text | required | — | Primary key. |
| `organization_id` | bigint | required | — | Tenant (organization) this row belongs to. |
| `contact_id` | text | required | — | CDP person key (`customer_profile.cdp_id`). |
| `owner_user_id` | bigint | required | — | CRM owner user (accounts.setup_users.id). |
| `activity_id` | text | nullable | — | activity ID. |
| `deal_id` | text | nullable | — | FK to crm.deals.id. |
| `action_kind` | text | required | — | email_proposal | book_meeting | close_won | close_lost | quote_send | quote_accept |
| `title` | text | required | — | title. |
| `summary` | text | nullable | — | summary. |
| `payload` | jsonb | required | — | payload. |
| `status` | USER-DEFINED | required | `'pending'::crm.ProcessConfirmationStatus` | Workflow status for this record. |
| `decided_at` | timestamp without time zone | nullable | — | decided at. |
| `decided_by_user_id` | bigint | nullable | — | decided by user ID. |
| `result_note` | text | nullable | — | result note. |
| `created_at` | timestamp without time zone | required | `CURRENT_TIMESTAMP` | Row creation timestamp. |
| `updated_at` | timestamp without time zone | required | `CURRENT_TIMESTAMP` | Last update timestamp. |

### `crm.product_addon_tiers`

Quantity bands for tiered addon pricing.

| Column | Type | Null | Default | Description |
|---|---|---|---|---|
| `id` | text | required | — | Primary key. |
| `addon_id` | text | required | — | addon ID. |
| `min_qty` | integer | required | — | min qty. |
| `max_qty` | integer | nullable | — | max qty. |
| `unit_price` | numeric(12) | required | — | unit price. |
| `created_at` | timestamp without time zone | required | `CURRENT_TIMESTAMP` | Row creation timestamp. |
| `updated_at` | timestamp without time zone | required | — | Last update timestamp. |
| `organization_id` | bigint | required | — | Tenant (organization) this row belongs to. |

### `crm.product_addons`

Optional add-on sold with a customizable product (1:N).

| Column | Type | Null | Default | Description |
|---|---|---|---|---|
| `id` | text | required | — | Primary key. |
| `organization_id` | bigint | required | — | Tenant (organization) this row belongs to. |
| `product_id` | text | required | — | Product identifier (crm product cuid or cdp.products.product_id). |
| `name` | text | required | — | name. |
| `unit_label` | text | nullable | — | unit label. |
| `pricing_model` | USER-DEFINED | required | — | pricing model. |
| `flat_price` | numeric(12) | nullable | — | flat price. |
| `unit_price` | numeric(12) | nullable | — | unit price. |
| `step_size` | integer | nullable | — | step size. |
| `step_price` | numeric(12) | nullable | — | step price. |
| `sort_order` | integer | required | `0` | sort order. |
| `created_at` | timestamp without time zone | required | `CURRENT_TIMESTAMP` | Row creation timestamp. |
| `updated_at` | timestamp without time zone | required | — | Last update timestamp. |
| `meter_key` | USER-DEFINED | nullable | — | meter key. |
| `is_overage` | boolean | required | `false` | is overage. |

### `crm.product_offers`

Named commercial package under a product (plan, edition, or usage pack).

| Column | Type | Null | Default | Description |
|---|---|---|---|---|
| `id` | text | required | — | Primary key. |
| `organization_id` | bigint | required | — | Tenant (organization) this row belongs to. |
| `product_id` | text | required | — | Product identifier (crm product cuid or cdp.products.product_id). |
| `name` | text | required | — | name. |
| `code` | text | nullable | — | code. |
| `billing_type` | USER-DEFINED | nullable | — | billing type. |
| `billing_frequency` | USER-DEFINED | nullable | — | billing frequency. |
| `included_qty` | integer | nullable | — | included qty. |
| `meter_key` | USER-DEFINED | nullable | — | meter key. |
| `sort_order` | integer | required | `0` | sort order. |
| `status` | USER-DEFINED | required | `'active'::crm.ProductStatus` | Workflow status for this record. |
| `created_at` | timestamp without time zone | required | `CURRENT_TIMESTAMP` | Row creation timestamp. |
| `updated_at` | timestamp without time zone | required | — | Last update timestamp. |

### `crm.products`

Removed. Catalog is **`inventory.products` only** (Prisma `@@schema("inventory")`). Do not recreate this as a table or view.

### `crm.proposal_templates`

CRM-used table.

| Column | Type | Null | Default | Description |
|---|---|---|---|---|
| `id` | text | required | — | Primary key. |
| `organization_id` | bigint | required | — | Tenant (organization) this row belongs to. |
| `name` | text | required | — | name. |
| `code` | text | nullable | — | code. |
| `kind` | USER-DEFINED | required | `'standard'::crm.ProposalTemplateKind` | kind. |
| `sections` | jsonb | required | — | sections. |
| `is_default` | boolean | required | `false` | is default. |
| `created_at` | timestamp without time zone | required | `CURRENT_TIMESTAMP` | Row creation timestamp. |
| `updated_at` | timestamp without time zone | required | — | Last update timestamp. |
| `blueprint` | jsonb | nullable | — | blueprint. |
| `assets` | jsonb | nullable | — | assets. |

### `crm.proposals`

CRM-used table.

| Column | Type | Null | Default | Description |
|---|---|---|---|---|
| `id` | text | required | — | Primary key. |
| `organization_id` | bigint | required | — | Tenant (organization) this row belongs to. |
| `deal_id` | text | required | — | FK to crm.deals.id. |
| `number` | text | required | — | number. |
| `title` | text | required | — | title. |
| `summary` | text | nullable | — | summary. |
| `version` | integer | required | `1` | version. |
| `status` | USER-DEFINED | required | `'draft'::crm.ProposalStatus` | Workflow status for this record. |
| `attachment_url` | text | nullable | — | attachment url. |
| `shared_at` | timestamp without time zone | nullable | — | shared at. |
| `created_by_user_id` | bigint | nullable | — | User who created the row. |
| `created_at` | timestamp without time zone | required | `CURRENT_TIMESTAMP` | Row creation timestamp. |
| `updated_at` | timestamp without time zone | required | — | Last update timestamp. |
| `template_id` | text | nullable | — | template ID. |
| `sections` | jsonb | nullable | — | sections. |
| `customer_name` | text | nullable | — | customer name. |
| `blueprint` | jsonb | nullable | — | blueprint. |
| `assets` | jsonb | nullable | — | assets. |
| `approved_by_user_id` | bigint | nullable | — | approved by user ID. |
| `approved_at` | timestamp with time zone | nullable | — | approved at. |
| `approval_status` | varchar(32) | required | `'drafting'::character varying` | approval status. |

### `crm.quote_lines`

CRM-used table.

| Column | Type | Null | Default | Description |
|---|---|---|---|---|
| `id` | text | required | — | Primary key. |
| `quote_id` | text | required | — | quote ID. |
| `product_id` | text | nullable | — | Product identifier (crm product cuid or cdp.products.product_id). |
| `name` | text | required | — | name. |
| `quantity` | numeric(12) | required | `1` | quantity. |
| `unit_price` | numeric(12) | required | — | unit price. |
| `amount` | numeric(12) | required | — | amount. |
| `sort_order` | integer | required | `0` | sort order. |
| `created_at` | timestamp without time zone | required | `CURRENT_TIMESTAMP` | Row creation timestamp. |
| `updated_at` | timestamp without time zone | required | — | Last update timestamp. |
| `organization_id` | bigint | required | — | Tenant (organization) this row belongs to. |

### `crm.quote_templates`

CRM-used table.

| Column | Type | Null | Default | Description |
|---|---|---|---|---|
| `id` | text | required | — | Primary key. |
| `organization_id` | bigint | required | — | Tenant (organization) this row belongs to. |
| `name` | text | required | — | name. |
| `code` | text | nullable | — | code. |
| `kind` | USER-DEFINED | required | `'standard'::crm.QuoteTemplateKind` | kind. |
| `sections` | jsonb | required | — | sections. |
| `is_default` | boolean | required | `false` | is default. |
| `created_at` | timestamp without time zone | required | `CURRENT_TIMESTAMP` | Row creation timestamp. |
| `updated_at` | timestamp without time zone | required | — | Last update timestamp. |
| `blueprint` | jsonb | nullable | — | blueprint. |
| `assets` | jsonb | nullable | — | assets. |

### `crm.quotes`

CRM-used table.

| Column | Type | Null | Default | Description |
|---|---|---|---|---|
| `id` | text | required | — | Primary key. |
| `organization_id` | bigint | required | — | Tenant (organization) this row belongs to. |
| `deal_id` | text | required | — | FK to crm.deals.id. |
| `number` | text | required | — | number. |
| `version` | integer | required | `1` | version. |
| `status` | USER-DEFINED | required | `'draft'::crm.QuoteStatus` | Workflow status for this record. |
| `currency` | text | required | `'USD'::text` | currency. |
| `subtotal` | numeric(12) | required | `0` | subtotal. |
| `discount_pct` | numeric(5) | required | `0` | discount pct. |
| `total` | numeric(12) | required | `0` | total. |
| `valid_until` | timestamp without time zone | nullable | — | valid until. |
| `notes` | text | nullable | — | notes. |
| `sent_at` | timestamp without time zone | nullable | — | sent at. |
| `accepted_at` | timestamp without time zone | nullable | — | accepted at. |
| `created_by_user_id` | bigint | nullable | — | User who created the row. |
| `created_at` | timestamp without time zone | required | `CURRENT_TIMESTAMP` | Row creation timestamp. |
| `updated_at` | timestamp without time zone | required | — | Last update timestamp. |
| `proposal_id` | text | nullable | — | proposal ID. |
| `template_id` | text | nullable | — | template ID. |
| `document_sections` | jsonb | nullable | — | document sections. |
| `customer_name` | text | nullable | — | customer name. |
| `company_name` | text | nullable | — | Display name of the organization. |
| `vendor_name` | text | nullable | — | vendor name. |
| `blueprint` | jsonb | nullable | — | blueprint. |
| `assets` | jsonb | nullable | — | assets. |
| `approved_by_user_id` | bigint | nullable | — | approved by user ID. |
| `approved_at` | timestamp with time zone | nullable | — | approved at. |
| `approval_status` | varchar(32) | required | `'drafting'::character varying` | approval status. |

### `crm.report_snapshots`

Async report rollup snapshot (Phase 3 analytics without live OLTP scans).

| Column | Type | Null | Default | Description |
|---|---|---|---|---|
| `id` | text | required | — | Primary key. |
| `organization_id` | bigint | required | — | Tenant (organization) this row belongs to. |
| `kind` | text | required | — | kind. |
| `payload` | jsonb | required | — | payload. |
| `generated_at` | timestamp without time zone | required | `CURRENT_TIMESTAMP` | generated at. |

### `crm.sales_orders`

CRM-used table.

| Column | Type | Null | Default | Description |
|---|---|---|---|---|
| `id` | text | required | — | Primary key. |
| `organization_id` | bigint | required | — | Tenant (organization) this row belongs to. |
| `deal_id` | text | nullable | — | FK to crm.deals.id. |
| `quote_id` | text | nullable | — | quote ID. |
| `company_id` | text | nullable | — | FK to crm.companies.id. |
| `number` | text | required | — | number. |
| `status` | USER-DEFINED | required | `'confirmed'::crm.OrderStatus` | Workflow status for this record. |
| `currency` | text | required | `'USD'::text` | currency. |
| `total` | numeric(12) | required | `0` | total. |
| `confirmed_at` | timestamp without time zone | nullable | — | confirmed at. |
| `created_by_user_id` | bigint | nullable | — | User who created the row. |
| `created_at` | timestamp without time zone | required | `CURRENT_TIMESTAMP` | Row creation timestamp. |
| `updated_at` | timestamp without time zone | required | — | Last update timestamp. |
| `contact_id` | text | nullable | — | CDP person key (`customer_profile.cdp_id`). |

### `crm.sales_user_assignment_profiles`

Per-rep CRM overlay for assignment capacity, PTO, tier, and territory.

| Column | Type | Null | Default | Description |
|---|---|---|---|---|
| `id` | text | required | — | Primary key. |
| `organization_id` | bigint | required | — | Tenant (organization) this row belongs to. |
| `user_id` | bigint | required | — | User (accounts.setup_users.id). |
| `accepting_leads` | boolean | required | `true` | accepting leads. |
| `max_open_deals` | integer | nullable | — | max open deals. |
| `seniority_tier` | USER-DEFINED | nullable | — | seniority tier. |
| `on_pto_until` | date | nullable | — | on pto until. |
| `country` | varchar(128) | nullable | — | country. |
| `created_at` | timestamp without time zone | required | `CURRENT_TIMESTAMP` | Row creation timestamp. |
| `updated_at` | timestamp without time zone | required | — | Last update timestamp. |

### `crm.service_tickets`

CRM-used table.

| Column | Type | Null | Default | Description |
|---|---|---|---|---|
| `id` | text | required | — | Primary key. |
| `organization_id` | bigint | required | — | Tenant (organization) this row belongs to. |
| `company_id` | text | required | — | FK to crm.companies.id. |
| `deal_id` | text | nullable | — | FK to crm.deals.id. |
| `contact_id` | text | nullable | — | CDP person key (`customer_profile.cdp_id`). |
| `subject` | text | required | — | subject. |
| `status` | USER-DEFINED | required | `'open'::crm.TicketStatus` | Workflow status for this record. |
| `assignee_user_id` | bigint | nullable | — | assignee user ID. |
| `created_at` | timestamp without time zone | required | `CURRENT_TIMESTAMP` | Row creation timestamp. |
| `updated_at` | timestamp without time zone | required | — | Last update timestamp. |

### `crm.user_integration_connections`

Per-user OAuth for Email (Gmail send) and Calendar. Lives in crm_qa only.

| Column | Type | Null | Default | Description |
|---|---|---|---|---|
| `id` | text | required | — | Primary key. |
| `user_id` | bigint | required | — | User (accounts.setup_users.id). |
| `provider` | USER-DEFINED | required | — | provider. |
| `account_email` | text | nullable | — | account email. |
| `access_token` | text | required | — | access token. |
| `refresh_token` | text | nullable | — | refresh token. |
| `token_expires_at` | timestamp without time zone | nullable | — | token expires at. |
| `scope` | text | nullable | — | scope. |
| `created_at` | timestamp without time zone | required | `CURRENT_TIMESTAMP` | Row creation timestamp. |
| `updated_at` | timestamp without time zone | required | — | Last update timestamp. |
| `organization_id` | bigint | required | — | Tenant (organization) this row belongs to. |

## inventory schema

Shared product catalog. CRM **SELECT / INSERT / UPDATE / DELETE** existing columns only. No `ALTER`. Field changes require inventory owners first.

### `inventory.products`

Common catalog for B2B, B2C, and B2B2C. Motion gates sell path (quotes vs commerce), not table. Accessed only via `inventory.products` (no `crm.products`).

| Column | Type | Null | Default | Description |
|---|---|---|---|---|
| `id` | text | required | — | Primary key. |
| `name` | text | required | — | name. |
| `tagline` | text | nullable | — | Short line shown on cards |
| `description` | text | nullable | — | description. |
| `specifications` | text | nullable | — | Full specifications / details (long text) |
| `image_url` | text | nullable | — | image url. |
| `gallery_urls` | jsonb | nullable | — | Extra image URLs (JSON string array) |
| `product_url` | text | nullable | — | Product page / PDP / datasheet. Not an image. |
| `sku` | text | nullable | — | sku. |
| `brand` | text | nullable | — | Retail / commerce brand (optional on B2B). |
| `subcategory` | text | nullable | — | Retail / commerce subcategory. |
| `stock_on_hand` | integer | nullable | — | Warehouse units. Null = not inventory-tracked. Decremented on confirmed orders. |
| `price` | numeric(12) | nullable | — | price. |
| `max_discount_percent` | numeric(5,2) | nullable | — | Quote line discount cap; above this requires Finance approval. |
| `currency` | text | required | `'USD'::text` | currency. |
| `status` | USER-DEFINED | required | `'draft'::crm.ProductStatus` | Workflow status for this record. |
| `category` | text | nullable | — | category. |
| `tags` | text | nullable | — | Comma-separated or freeform tags |
| `created_at` | timestamp without time zone | required | `CURRENT_TIMESTAMP` | Row creation timestamp. |
| `updated_at` | timestamp without time zone | required | — | Last update timestamp. |
| `organization_id` | bigint | required | — | Tenant (organization) this row belongs to. |
| `billing_type` | USER-DEFINED | required | `'one_time'::crm.ProductBillingType` | billing type. |
| `billing_frequency` | USER-DEFINED | nullable | — | billing frequency. |
| `unit_of_measure` | USER-DEFINED | required | `'flat'::crm.ProductUnitOfMeasure` | unit of measure. |
| `pricing_tiers` | jsonb | nullable | — | Legacy volume tiers on product (prefer Addon / AddonTier for customizable) |
| `product_type` | USER-DEFINED | required | `'fixed'::crm.ProductType` | product type. |
| `custom_attributes` | jsonb | nullable | — | Non-pricing industry labels/notes (not used for quote math). |

## cdp schema

### `cdp.customer_profile`

Shared person/firmographic profile (CDP identity).

| Column | Type | Null | Default | Description |
|---|---|---|---|---|
| `cdp_id` | text | required | — | CDP person primary key (text). |
| `first_name` | varchar(128) | nullable | — | first name. |
| `last_name` | varchar(128) | nullable | — | last name. |
| `gender` | varchar(32) | nullable | — | gender. |
| `date_of_birth` | date | nullable | — | date of birth. |
| `company` | varchar(255) | nullable | — | company. |
| `city` | varchar(128) | nullable | — | city. |
| `region` | varchar(128) | nullable | — | region. |
| `country` | varchar(128) | nullable | — | country. |
| `language` | varchar(64) | nullable | — | language. |
| `timezone` | varchar(64) | nullable | — | timezone. |
| `acquisition_channel` | varchar(128) | nullable | — | acquisition channel. |
| `acquisition_date` | date | nullable | — | acquisition date. |
| `first_referrer` | text | nullable | — | first referrer. |
| `first_seen_at` | timestamp with time zone | nullable | — | first seen at. |
| `last_seen_at` | timestamp with time zone | nullable | — | last seen at. |
| `created_at` | timestamp with time zone | required | `now()` | Row creation timestamp. |
| `updated_at` | timestamp with time zone | required | `now()` | Last update timestamp. |
| `organization_id` | bigint | required | — | Tenant (organization) this row belongs to. |
| `custom_fields` | jsonb | required | `'{}'::jsonb` | custom fields. |
| `tenant_id` | text | required | `'default'::text` | tenant ID. |
| `preferences_json` | jsonb | required | `'{}'::jsonb` | preferences json. |
| `consent_json` | jsonb | required | `'{}'::jsonb` | consent json. |
| `traits_json` | jsonb | required | `'{}'::jsonb` | traits json. |

### `cdp.identity_keys`

Emails, phones, and other identity keys for a person.

| Column | Type | Null | Default | Description |
|---|---|---|---|---|
| `identity_id` | text | required | — | identity ID. |
| `cdp_id` | text | required | — | CDP person primary key (text). |
| `key_type` | varchar(64) | required | — | Identity key type (email, phone, etc.). |
| `key_value` | varchar(255) | required | — | Normalized identity value. |
| `source_system` | varchar(255) | nullable | — | source system. |
| `confidence_score` | numeric(5) | nullable | — | confidence score. |
| `verified` | boolean | required | `false` | verified. |
| `created_at` | timestamp with time zone | required | `now()` | Row creation timestamp. |
| `organization_id` | bigint | required | — | Tenant (organization) this row belongs to. |
| `custom_fields` | jsonb | required | `'{}'::jsonb` | custom fields. |

### `cdp.products`

Shared Worktual product registry (not the CRM Product module store). CRM catalog is `inventory.products` for all motions. Do not ALTER this table from CRM.

| Column | Type | Null | Default | Description |
|---|---|---|---|---|
| `product_id` | bigint | required | `nextval('cdp.products_product_id_seq'::regclass)` | Product identifier (crm product cuid or cdp.products.product_id). |
| `sku` | varchar(128) | required | — | sku. |
| `product_name` | varchar(255) | required | — | product name. |
| `brand` | varchar(128) | nullable | — | brand. |
| `category` | varchar(255) | nullable | — | category. |
| `subcategory` | varchar(255) | nullable | — | subcategory. |
| `price` | numeric(14) | required | `0.00` | price. |
| `currency` | varchar(8) | required | `'USD'::character varying` | currency. |
| `status` | varchar(64) | required | `'active'::character varying` | Workflow status for this record. |
| `active` | boolean | required | `true` | active. |
| `created_at` | timestamp with time zone | required | `now()` | Row creation timestamp. |
| `updated_at` | timestamp with time zone | required | `now()` | Last update timestamp. |
| `organization_id` | bigint | required | — | Tenant (organization) this row belongs to. |
| `custom_fields` | jsonb | required | `'{}'::jsonb` | custom fields. |

## accounts schema

### `accounts.organizations`

Tenant org record (business_type, company_name).

| Column | Type | Null | Default | Description |
|---|---|---|---|---|
| `tenant_id` | varchar(16) | required | — | tenant ID. |
| `company_name` | varchar(255) | nullable | — | Display name of the organization. |
| `industry_type` | varchar(128) | nullable | — | industry type. |
| `contact_name` | varchar(255) | nullable | — | contact name. |
| `designation` | varchar(128) | nullable | — | designation. |
| `work_email` | varchar(255) | nullable | — | Login email for the user. |
| `admin_email` | varchar(255) | nullable | — | admin email. |
| `tax_number` | varchar(64) | nullable | — | tax number. |
| `billing_address` | text | nullable | — | billing address. |
| `website_url` | varchar(512) | nullable | — | website url. |
| `country` | varchar(128) | nullable | — | country. |
| `company_size` | varchar(64) | nullable | — | company size. |
| `mobile_country_code` | varchar(8) | nullable | — | mobile country code. |
| `mobile_number` | varchar(32) | nullable | — | mobile number. |
| `lifecycle_status` | varchar(32) | required | `'active'::character varying` | lifecycle status. |
| `converted_at` | timestamp with time zone | required | `now()` | converted at. |
| `created_at` | timestamp with time zone | required | `now()` | Row creation timestamp. |
| `updated_at` | timestamp with time zone | required | `now()` | Last update timestamp. |
| `business_type` | varchar(64) | nullable | — | Tenant motion: b2b, b2c, or b2b2c. |
| `support_portal_slug` | varchar(63) | nullable | — | support portal slug. |
| `support_portal_enabled` | boolean | required | `false` | support portal enabled. |
| `support_portal_welcome` | text | nullable | — | support portal welcome. |
| `id` | bigint | required | — | Primary key. |
| `reseller_id` | bigint | nullable | — | reseller ID. |
| `source_lead_id` | bigint | nullable | — | source lead ID. |

### `accounts.setup_roles`

Named roles for product access.

| Column | Type | Null | Default | Description |
|---|---|---|---|---|
| `name` | varchar(255) | required | — | name. |
| `description` | text | nullable | — | description. |
| `accessible_products` | jsonb | required | `'[]'::jsonb` | accessible products. |
| `module_permission` | varchar(128) | nullable | — | module permission. |
| `can_view` | boolean | required | `true` | can view. |
| `can_create` | boolean | required | `false` | can create. |
| `can_edit` | boolean | required | `false` | can edit. |
| `can_delete` | boolean | required | `false` | can delete. |
| `can_export` | boolean | required | `false` | can export. |
| `can_approve` | boolean | required | `false` | can approve. |
| `created_at` | timestamp with time zone | required | `now()` | Row creation timestamp. |
| `updated_at` | timestamp with time zone | required | `now()` | Last update timestamp. |
| `product_id` | varchar(128) | nullable | — | Product identifier (crm product cuid or cdp.products.product_id). |
| `module_permissions` | jsonb | nullable | — | module permissions. |
| `id` | bigint | required | — | Primary key. |
| `organization_id` | bigint | required | — | Tenant (organization) this row belongs to. |

### `accounts.setup_user_product_access`

Maps user → product (crm) → role.

| Column | Type | Null | Default | Description |
|---|---|---|---|---|
| `product_id` | varchar(128) | required | — | Product identifier (crm product cuid or cdp.products.product_id). |
| `created_at` | timestamp with time zone | required | `now()` | Row creation timestamp. |
| `id` | bigint | required | — | Primary key. |
| `organization_id` | bigint | required | — | Tenant (organization) this row belongs to. |
| `role_id` | bigint | required | — | FK to accounts.setup_roles.id. |
| `user_id` | bigint | required | — | User (accounts.setup_users.id). |

### `accounts.setup_users`

Worktual user accounts (login, org membership).

| Column | Type | Null | Default | Description |
|---|---|---|---|---|
| `employee_id` | varchar(64) | nullable | — | employee ID. |
| `first_name` | varchar(128) | required | — | first name. |
| `last_name` | varchar(128) | required | — | last name. |
| `work_email` | varchar(255) | required | — | Login email for the user. |
| `mobile_number` | varchar(32) | nullable | — | mobile number. |
| `primary_language` | varchar(64) | nullable | — | primary language. |
| `secondary_language` | varchar(64) | nullable | — | secondary language. |
| `location_id` | varchar(128) | nullable | — | FK to crm.company_locations.id. |
| `status` | varchar(32) | required | `'active'::character varying` | Workflow status for this record. |
| `created_at` | timestamp with time zone | required | `now()` | Row creation timestamp. |
| `updated_at` | timestamp with time zone | required | `now()` | Last update timestamp. |
| `shift_types` | jsonb | nullable | — | shift types. |
| `password_hash` | text | nullable | — | Bcrypt password hash. |
| `invite_status` | varchar(32) | nullable | — | invite status. |
| `password_set_at` | timestamp with time zone | nullable | — | password set at. |
| `invited_at` | timestamp with time zone | nullable | — | invited at. |
| `skills` | jsonb | required | `'[]'::jsonb` | skills. |
| `city` | varchar(128) | nullable | — | city. |
| `state` | varchar(128) | nullable | — | state. |
| `country` | varchar(128) | nullable | — | country. |
| `business_hours_id` | bigint | nullable | — | business hours ID. |
| `id` | bigint | required | — | Primary key. |
| `organization_id` | bigint | required | — | Tenant (organization) this row belongs to. |
| `team_id` | bigint | nullable | — | team ID. |

### `accounts.a2a_spoke_clients`

Hub OAuth client + live tokens for one A2A spoke (`a2a_server_name`). Hub reads `access_token`; the spoke replaces access and refresh after `POST /token`. Approved CRM exception; not Prisma-mapped.

| Column | Type | Null | Default | Description |
|---|---|---|---|---|
| `id` | bigint | required | identity | Primary key. |
| `a2a_server_name` | varchar(64) | required | — | Agent Card `id`, e.g. `worktual-crm`. Unique. |
| `client_id` | varchar(128) | required | — | Hub client for this spoke only. Unique. |
| `client_secret` | text | required | — | Hub-readable secret for `/token`. |
| `access_token` | text | nullable | — | Current access JWT (6 hours). |
| `access_expires_at` | timestamptz | nullable | — | Access expiry. |
| `refresh_token` | text | nullable | — | Current refresh (≈2 months). |
| `refresh_expires_at` | timestamptz | nullable | — | Refresh expiry. |
| `skill_version` | varchar(64) | nullable | — | Card `skillVersion` snapshot. |
| `created_at` | timestamptz | required | `now()` | Row creation timestamp. |
| `updated_at` | timestamptz | required | `now()` | Last update timestamp. |

## CRM enums (PostgreSQL / Prisma)

- **`LocationType`:** `hq`, `branch`
- **`CompanyChannelRole`:** `standard`, `franchise`, `owned_store`, `brand_hq`
- **`OrganizationVertical`:** `general`, `ecommerce`, `healthcare`, `finance`, `telecom`
- **`DealStage`:** `qualification`, `discover`, `propose`, `negotiate`, `closed_won`, `closed_lost`
- **`ActivityType`:** `call`, `meeting`, `email`, `sms`, `note`, `task`
- **`TaskStatus`:** `open`, `in_progress`, `completed`
- **`InboxFolder`:** `inbox`, `sent`, `draft`, `trash`
- **`EmailDirection`:** `outbound`, `inbound`
- **`IntegrationProvider`:** `google`, `microsoft`, `zoom`, `yahoo`
- **`ProductStatus`:** `draft`, `active`, `archived`
- **`ProductType`:** `fixed`, `customizable`
- **`ProductBillingType`:** `one_time`, `recurring`
- **`ProductBillingFrequency`:** `monthly`, `quarterly`, `annual`
- **`ProductUnitOfMeasure`:** `per_seat`, `per_agent`, `per_ticket`, `flat`
- **`AddonPricingModel`:** `flat`, `per_unit`, `stepped`, `tiered`
- **`AddonMeterKey`:** `seat`, `minute`, `session`, `email`, `agent`, `flat`, `custom`
- **`CatalogSyncProvider`:** `shopify`, `woocommerce`, `custom_feed`
- **`CatalogConnectionStatus`:** `disconnected`, `connected`, `error`
- **`QuoteStatus`:** `draft`, `sent`, `accepted`, `rejected`, `void`
- **`ProposalStatus`:** `draft`, `shared`, `accepted`, `declined`
- **`ProposalTemplateKind`:** `standard`
- **`QuoteTemplateKind`:** `standard`
- **`InvoiceTemplateKind`:** `standard`
- **`OrderStatus`:** `draft`, `confirmed`, `fulfilled`, `cancelled`
- **`InvoiceStatus`:** `draft`, `sent`, `paid`, `void`, `overdue`
- **`InvoiceLineKind`:** `product`, `addon`
- **`TicketStatus`:** `open`, `in_progress`, `resolved`, `closed`
- **`AuditAction`:** `create`, `update`, `delete`, `stage_change`, `assign`, `convert`, `merge`, `quote_sent`, `quote_accepted`, `order_created`, `invoice_created`
- **`LeadEnrichmentStatus`:** `pending`, `running`, `enriched`, `skipped`, `failed`
- **`LeadNurtureStatus`:** `pending`, `analyzing`, `sent`, `waited`, `skipped`, `failed`
- **`LeadScoringStatus`:** `pending`, `scoring`, `scored`, `failed`
- **`LeadLifecycleStatus`:** `pending`, `analyzing`, `applied`, `waited`, `skipped`, `failed`
- **`EmailAutoReplyStatus`:** `pending`, `analyzing`, `replied`, `awaiting_demo`, `escalated`, `skipped`, `failed`
- **`MailProvider`:** `google`, `microsoft`
- **`SalesSeniorityTier`:** `junior`, `mid`, `senior`
- **`MeetingAssistStatus`:** `active`, `ended`, `failed`
- **`MeetingAssistProvider`:** `google_meet`, `zoom`, `teams`, `other`
- **`ProcessConfirmationStatus`:** `pending`, `approved`, `rejected`, `expired`
