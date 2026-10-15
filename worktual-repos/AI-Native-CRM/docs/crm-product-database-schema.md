# CRM product database schema

Column-level reference for every table this CRM product uses. Generated from `prisma/schema.prisma` (CRM-owned and `inventory.products`) plus the shared Worktual tables the app reads. Samples are fictional shapes, not live rows.

Database name in this environment: `worktual_bigint`.

## Connections

| Env | Schemas | How CRM uses it |
|---|---|---|
| `DATABASE_URL` | `crm`, `inventory` | Prisma. CRM owns `crm` DDL. `inventory.products` is DML only. |
| `ACCOUNT_DATABASE_URL` | `accounts`, `cdp` | `pg` pool in `backend/src/dao/db/account-pool.ts`. No CRM DDL, except the two approved exceptions below. |

Raw SQL in the backend often omits the schema name because the connection `search_path` includes `crm`. `accounts` and `cdp` are still written with a schema prefix.

## What lives where

| Need | Table | Do not use |
|---|---|---|
| Person name, city, company label, lifecycle | `cdp.customer_profile` | A CRM contacts table |
| Email and phone | `cdp.identity_keys` | Columns on `crm.contact_profiles` |
| Owner, lead status, BANT, tags, nurture | `crm.contact_profiles` (`account_contact_id` = `cdp_id`) | New CDP columns |
| Login user | `accounts.setup_users` | A CRM users table |
| CRM role | `accounts.setup_user_product_access` + `accounts.setup_roles` where `product_id = 'crm'` | Role on `setup_users` alone |
| Tenant, business type, industry | `accounts.organizations` | `crm.organization_profiles.vertical` as industry |
| Customer company (B2B account) | `crm.companies` | `cdp.customer_profile.company` (that is a label) |
| Sellable product | `inventory.products` | `crm.products` (removed) or `cdp.products` |
| Org bot mailbox | `accounts.setup_channel_configs` + `setup_email_configs` + `mail_oauth_connections` | `crm.user_integration_connections` for the bot |
| Rep mailbox OAuth | `crm.user_integration_connections` | Accounts mail tables |

### Join keys

| Column | Type | Points to |
|---|---|---|
| `organization_id` | bigint | `accounts.organizations.id` |
| `*_user_id` | bigint | `accounts.setup_users.id` |
| `account_contact_id`, most `contact_id` | text | `cdp.customer_profile.cdp_id` |
| CRM `id` | text cuid | That CRM table |
| `product_id` on quotes, orders, invoices, offers | text | `inventory.products.id` |
| `cdp.products.product_id` | bigint | CDP registry only, not the CRM catalog |

There is no database foreign key from `crm` to `accounts` or `cdp`. The application checks those ids.

### Ownership

| Schema | CRM may |
|---|---|
| `crm` | CREATE / ALTER / DROP via Prisma migrations, plus all DML |
| `inventory` | SELECT / INSERT / UPDATE / DELETE on existing `products` columns only |
| `cdp` | SELECT and DML on existing columns. No new columns. |
| `accounts` | SELECT and limited DML on existing columns. No DDL except the two exceptions below. |

Approved `accounts` / `cdp` exceptions:

- Trigger on `cdp.customer_profile` that writes only into `crm.contact_profiles` and `crm.lead_enrichment_jobs`, then `NOTIFY`. Migration `prisma/migrations/20260811033000_cdp_customer_enrich_trigger/`.
- `accounts.a2a_spoke_clients` — one Hub client id, secret, and live tokens per A2A spoke. Migration `prisma/migrations/20260827180000_a2a_spoke_clients/`.

Dropped and not to be recreated: `crm.products`, `catalog_integration_connections`, `service_tickets`, `password_reset_tokens`, unused `b2c_*` / `commerce_*` tables.

Legacy `cdp.contacts` is not used. Identity is `customer_profile` + `identity_keys`.

## Enums

Postgres enum type names match the Prisma enum unless `@@map` says otherwise. Values are stored as those labels.

- `crm.LocationType` (LocationType): `hq`, `branch`
- `crm.CompanyChannelRole` (CompanyChannelRole): `standard`, `franchise`, `owned_store`, `brand_hq`
- `crm.OrganizationVertical` (OrganizationVertical): `general`, `ecommerce`, `healthcare`, `finance`, `telecom`
- `crm.DealStage` (DealStage): `qualification`, `discover`, `propose`, `negotiate`, `closed_won`, `closed_lost`
- `crm.ActivityType` (ActivityType): `call`, `meeting`, `email`, `sms`, `note`, `task`
- `crm.TaskStatus` (TaskStatus): `open`, `in_progress`, `completed`
- `crm.InboxFolder` (InboxFolder): `inbox`, `sent`, `draft`, `trash`
- `crm.EmailDirection` (EmailDirection): `outbound`, `inbound`
- `crm.IntegrationProvider` (IntegrationProvider): `google`, `microsoft`, `zoom`, `yahoo`
- `crm.ProductStatus` (ProductStatus): `draft`, `active`, `archived`
- `crm.ProductType` (ProductType): `fixed`, `customizable`
- `crm.ProductBillingType` (ProductBillingType): `one_time`, `recurring`
- `crm.ProductBillingFrequency` (ProductBillingFrequency): `monthly`, `quarterly`, `annual`
- `crm.ProductUnitOfMeasure` (ProductUnitOfMeasure): `per_seat`, `per_agent`, `per_ticket`, `flat`
- `crm.AddonPricingModel` (AddonPricingModel): `flat`, `per_unit`, `stepped`, `tiered`
- `crm.AddonMeterKey` (AddonMeterKey): `seat`, `minute`, `session`, `email`, `agent`, `flat`, `custom`
- `crm.QuoteStatus` (QuoteStatus): `draft`, `sent`, `accepted`, `rejected`, `void`
- `crm.ProposalStatus` (ProposalStatus): `draft`, `shared`, `accepted`, `declined`
- `crm.ProposalTemplateKind` (ProposalTemplateKind): `standard`
- `crm.QuoteTemplateKind` (QuoteTemplateKind): `standard`
- `crm.InvoiceTemplateKind` (InvoiceTemplateKind): `standard`
- `crm.OrderStatus` (OrderStatus): `draft`, `confirmed`, `fulfilled`, `cancelled`
- `crm.InvoiceStatus` (InvoiceStatus): `draft`, `sent`, `paid`, `void`, `overdue`
- `crm.InvoiceLineKind` (InvoiceLineKind): `product`, `addon`
- `crm.InvoiceBillingKind` (InvoiceBillingKind): `standard`, `setup`, `subscription_start`, `renewal`, `amendment`, `adjustment`, `credit`
- `crm.ContractStatus` (ContractStatus): `active`, `expired`, `cancelled`
- `crm.ContractBillingScheduleStatus` (ContractBillingScheduleStatus): `scheduled`, `generated`, `cancelled`
- `crm.InvoicePaymentMethod` (InvoicePaymentMethod): `offline`, `manual`, `stripe`, `razorpay`
- `crm.InvoicePaymentProvider` (InvoicePaymentProvider): `stripe`, `razorpay`
- `crm.InvoicePaymentSessionStatus` (InvoicePaymentSessionStatus): `active`, `expired`, `paid`, `cancelled`
- `crm.PaymentGatewayProvider` (PaymentGatewayProvider): `stripe`, `razorpay`
- `crm.AuditAction` (AuditAction): `create`, `update`, `delete`, `stage_change`, `assign`, `convert`, `merge`, `quote_sent`, `quote_accepted`, `order_created`, `invoice_created`
- `crm.LeadEnrichmentStatus` (LeadEnrichmentStatus): `pending`, `running`, `enriched`, `skipped`, `failed`
- `crm.ProspectPullStatus` (ProspectPullStatus): `pending`, `searching`, `qualifying`, `personnel`, `ready_for_review`, `importing`, `imported`, `failed`, `cancelled`
- `crm.ResearchProvider` (ResearchProvider): `apollo`, `zoominfo`, `lusha`, `builtwith`
- `crm.ProposalCorpusBatchStatus` (ProposalCorpusBatchStatus): `uploading`, `processing`, `pending_review`, `failed`, `completed`
- `crm.ProposalCorpusItemKind` (ProposalCorpusItemKind): `requirement`, `proposal`
- `crm.ProposalCorpusItemStatus` (ProposalCorpusItemStatus): `pending`, `ingested`, `structured`, `failed`
- `crm.ProposalCorpusJobStatus` (ProposalCorpusJobStatus): `pending`, `ingesting`, `structuring`, `pairing`, `synthesizing`, `pending_review`, `failed`, `cancelled`
- `crm.ProposalPlaybookStatus` (ProposalPlaybookStatus): `draft`, `pending_review`, `approved`, `rejected`
- `crm.AgentStepStatus` (AgentStepStatus): `started`, `ok`, `failed`, `skipped`
- `crm.LeadNurtureStatus` (LeadNurtureStatus): `pending`, `analyzing`, `sent`, `waited`, `skipped`, `failed`
- `crm.LeadScoringStatus` (LeadScoringStatus): `pending`, `scoring`, `scored`, `failed`
- `crm.LeadLifecycleStatus` (LeadLifecycleStatus): `pending`, `analyzing`, `applied`, `waited`, `skipped`, `failed`
- `crm.EmailAutoReplyStatus` (EmailAutoReplyStatus): `pending`, `analyzing`, `replied`, `awaiting_demo`, `escalated`, `skipped`, `failed`
- `crm.MailProvider` (MailProvider): `google`, `microsoft`
- `crm.SalesSeniorityTier` (SalesSeniorityTier): `junior`, `mid`, `senior`
- `crm.GmailPushWatchKind` (GmailPushWatchKind): `user`, `crm_bot`
- `crm.CalendarMeetCaptureStatus` (CalendarMeetCaptureStatus): `pending`, `dispatched`, `cancelled`, `failed`
- `crm.meeting_assist_status` (MeetingAssistStatus): `active`, `ended`, `failed`
- `crm.meeting_assist_provider` (MeetingAssistProvider): `google_meet`, `zoom`, `teams`, `other`
- `crm.ProcessConfirmationStatus` (ProcessConfirmationStatus): `pending`, `approved`, `rejected`, `expired`
- `crm.appointment_status` (AppointmentStatus): `scheduled`, `canceled`, `completed`, `no_show`
- `crm.appointment_source` (AppointmentSource): `crm_ui`, `ccaas_webchat`, `demo_agent`

## CRM and inventory tables

85 Prisma models. 84 in `crm`, 1 in `inventory`.

| Schema | Table | Model |
|---|---|---|
| `crm` | `companies` | `Company` |
| `crm` | `company_locations` | `CompanyLocation` |
| `crm` | `contact_profiles` | `ContactProfile` |
| `crm` | `contact_buying_roles` | `ContactBuyingRole` |
| `crm` | `contact_relationships` | `ContactRelationship` |
| `crm` | `organization_profiles` | `OrganizationProfile` |
| `crm` | `deals` | `Deal` |
| `crm` | `deal_activities` | `DealActivity` |
| `crm` | `contact_activities` | `ContactActivity` |
| `crm` | `user_integration_connections` | `UserIntegrationConnection` |
| `crm` | `org_assignment_settings` | `OrgAssignmentSettings` |
| `crm` | `org_finance_settings` | `OrgFinanceSettings` |
| `crm` | `org_nurture_settings` | `OrgNurtureSettings` |
| `crm` | `payment_gateway_events` | `PaymentGatewayEvent` |
| `crm` | `sales_user_assignment_profiles` | `SalesUserAssignmentProfile` |
| `inventory` | `products` | `Product` |
| `crm` | `product_offers` | `ProductOffer` |
| `crm` | `price_books` | `PriceBook` |
| `crm` | `price_book_entries` | `PriceBookEntry` |
| `crm` | `product_addons` | `Addon` |
| `crm` | `product_addon_tiers` | `AddonTier` |
| `crm` | `proposal_templates` | `ProposalTemplate` |
| `crm` | `proposals` | `Proposal` |
| `crm` | `proposal_generation_runs` | `ProposalGenerationRun` |
| `crm` | `proposal_generation_leaves` | `ProposalGenerationLeaf` |
| `crm` | `quote_templates` | `QuoteTemplate` |
| `crm` | `quotes` | `Quote` |
| `crm` | `quote_lines` | `QuoteLine` |
| `crm` | `sales_orders` | `SalesOrder` |
| `crm` | `order_lines` | `OrderLine` |
| `crm` | `invoice_templates` | `InvoiceTemplate` |
| `crm` | `invoices` | `Invoice` |
| `crm` | `invoice_lines` | `InvoiceLine` |
| `crm` | `contracts` | `Contract` |
| `crm` | `contract_billing_schedules` | `ContractBillingSchedule` |
| `crm` | `audit_logs` | `AuditLog` |
| `crm` | `report_snapshots` | `ReportSnapshot` |
| `crm` | `domain_enrichment_cache` | `DomainEnrichmentCache` |
| `crm` | `lead_enrichment_snapshots` | `LeadEnrichmentSnapshot` |
| `crm` | `lead_enrichment_jobs` | `LeadEnrichmentJob` |
| `crm` | `agent_step_events` | `AgentStepEvent` |
| `crm` | `agent_input_fingerprints` | `AgentInputFingerprint` |
| `crm` | `lead_summaries` | `LeadSummary` |
| `crm` | `lead_summary_refresh_queue` | `LeadSummaryRefreshQueue` |
| `crm` | `notifications` | `Notification` |
| `crm` | `meeting_analyses` | `MeetingAnalysis` |
| `crm` | `coaching_insights` | `CoachingInsight` |
| `crm` | `daily_briefings` | `DailyBriefing` |
| `crm` | `privacy_requests` | `PrivacyRequest` |
| `crm` | `lead_nurture_jobs` | `LeadNurtureJob` |
| `crm` | `lead_lifecycle_jobs` | `LeadLifecycleJob` |
| `crm` | `email_auto_reply_jobs` | `EmailAutoReplyJob` |
| `crm` | `scheduled_outbound_emails` | `ScheduledOutboundEmail` |
| `crm` | `gmail_push_watches` | `GmailPushWatch` |
| `crm` | `google_calendar_watches` | `GoogleCalendarWatch` |
| `crm` | `calendar_meet_captures` | `CalendarMeetCapture` |
| `crm` | `lead_scoring_jobs` | `LeadScoringJob` |
| `crm` | `meeting_assist_sessions` | `MeetingAssistSession` |
| `crm` | `meeting_transcript_chunks` | `MeetingTranscriptChunk` |
| `crm` | `process_confirmations` | `ProcessConfirmation` |
| `crm` | `agent_memories` | `AgentMemory` |
| `crm` | `a2a_spoke_tasks` | `A2aSpokeTask` |
| `crm` | `appointments` | `Appointment` |
| `crm` | `api_keys` | `ApiKey` |
| `crm` | `org_research_provider_configs` | `OrgResearchProviderConfig` |
| `crm` | `prospect_pull_jobs` | `ProspectPullJob` |
| `crm` | `prospect_pull_candidates` | `ProspectPullCandidate` |
| `crm` | `prospect_provider_cache` | `ProspectProviderCache` |
| `crm` | `proposal_corpus_batches` | `ProposalCorpusBatch` |
| `crm` | `proposal_corpus_items` | `ProposalCorpusItem` |
| `crm` | `proposal_corpus_pairs` | `ProposalCorpusPair` |
| `crm` | `proposal_corpus_case_studies` | `ProposalCorpusCaseStudy` |
| `crm` | `proposal_content_playbooks` | `ProposalContentPlaybook` |
| `crm` | `proposal_corpus_jobs` | `ProposalCorpusJob` |
| `crm` | `proposal_playbooks` | `ProposalPlaybook` |
| `crm` | `seo_projects` | `SeoProject` |
| `crm` | `seo_tool_snapshots` | `SeoToolSnapshot` |
| `crm` | `seo_generated_content` | `SeoGeneratedContent` |
| `crm` | `seo_keyword_queries` | `SeoKeywordQuery` |
| `crm` | `seo_saved_keywords` | `SeoSavedKeyword` |
| `crm` | `seo_social_posts` | `SeoSocialPost` |
| `crm` | `voice_conversations` | `VoiceConversation` |
| `crm` | `call_transcript_sessions` | `CallTranscriptSession` |
| `crm` | `call_transcript_chunks` | `CallTranscriptChunk` |
| `crm` | `nurture_voice_calls` | `NurtureVoiceCall` |

### `crm.companies`

Prisma model `Company`.

| Column | App field | Type | Null | Default | Sample | Notes |
|---|---|---|---|---|---|---|
| `id` | `id` | `text` | no | `cuid()` | `cksample0001contact01` | primary key |
| `organization_id` | `organizationId` | `bigint` | no | — | `1000` | — |
| `name` | `name` | `text` | no | — | `Example` | — |
| `domain` | `domain` | `text` | yes | — | `example` | — |
| `industry` | `industry` | `text` | yes | — | `example` | — |
| `employee_count` | `employeeCount` | `integer` | yes | — | `1` | — |
| `linkedin_url` | `linkedinUrl` | `text` | yes | — | `example` | — |
| `logo_url` | `logoUrl` | `text` | yes | — | `example` | — |
| `owner_user_id` | `ownerUserId` | `bigint` | yes | — | `1015` | — |
| `channel_role` | `channelRole` | `CompanyChannelRole` | no | `standard` | `companychannelrole` | Channel hierarchy under the same tenant (franchise B2B2C). |
| `parent_company_id` | `parentCompanyId` | `text` | yes | — | `example` | — |
| `created_at` | `createdAt` | `timestamptz` | no | `now()` | `2026-10-08T09:30:00.000Z` | — |
| `updated_at` | `updatedAt` | `timestamptz` | no | — | `2026-10-08T09:30:00.000Z` | — |
| `expansion_signal` | `expansionSignal` | `varchar(16)` | yes | — | `example` | Expansion & Revenue Matcher overlay (HITL): agent only flags a signal + drafts outreach talking points on closed-won deal history; never creates a deal/quote or contacts the company itself (human-only send). |
| `expansion_reason` | `expansionReason` | `text` | yes | — | `example` | — |
| `expansion_draft` | `expansionDraft` | `text` | yes | — | `example` | — |
| `expansion_last_run_at` | `expansionLastRunAt` | `timestamptz` | yes | — | `2026-10-08T09:30:00.000Z` | — |
| `collection_risk_level` | `collectionRiskLevel` | `varchar(16)` | yes | — | `example` | Company Collection Risk Agent overlay (HITL): aggregates this company's whole invoice payment history into a risk band. Flag only — agent never blocks/pauses the account. |
| `collection_risk_reason` | `collectionRiskReason` | `text` | yes | — | `example` | — |
| `collection_risk_last_run_at` | `collectionRiskLastRunAt` | `timestamptz` | yes | — | `2026-10-08T09:30:00.000Z` | — |
| `locations` | `locations` | `CompanyLocation[]` | no | — | `["example"]` | — |
| `deals` | `deals` | `Deal[]` | no | — | `["example"]` | — |
| `orders` | `orders` | `SalesOrder[]` | no | — | `["example"]` | — |
| `invoices` | `invoices` | `Invoice[]` | no | — | `["example"]` | — |
| `contracts` | `contracts` | `Contract[]` | no | — | `["example"]` | — |
| `contact_profiles` | `contactProfiles` | `ContactProfile[]` | no | — | `["example"]` | — |

Indexes and constraints:

- `@@index([name])`
- `@@index([createdAt])`
- `@@index([organizationId])`
- `@@index([organizationId, updatedAt])`
- `@@index([ownerUserId, updatedAt])`
- `@@index([organizationId, channelRole])`
- `@@index([parentCompanyId])`
- `@@index([organizationId, expansionSignal])`
- `@@index([organizationId, collectionRiskLevel])`

### `crm.company_locations`

Prisma model `CompanyLocation`.

| Column | App field | Type | Null | Default | Sample | Notes |
|---|---|---|---|---|---|---|
| `id` | `id` | `text` | no | `cuid()` | `cksample0001contact01` | primary key |
| `organization_id` | `organizationId` | `bigint` | no | — | `1000` | — |
| `company_id` | `companyId` | `text` | no | — | `example` | — |
| `name` | `name` | `text` | no | — | `Example` | — |
| `type` | `type` | `LocationType` | no | `branch` | `locationtype` | — |
| `address` | `address` | `text` | yes | — | `example` | — |
| `city` | `city` | `text` | yes | — | `example` | — |
| `industry` | `industry` | `text` | yes | — | `example` | — |
| `employee_count` | `employeeCount` | `integer` | yes | — | `1` | — |
| `owner_user_id` | `ownerUserId` | `bigint` | yes | — | `1015` | — |
| `created_at` | `createdAt` | `timestamptz` | no | `now()` | `2026-10-08T09:30:00.000Z` | — |
| `updated_at` | `updatedAt` | `timestamptz` | no | — | `2026-10-08T09:30:00.000Z` | — |
| `deals` | `deals` | `Deal[]` | no | — | `["example"]` | — |
| `contact_profiles` | `contactProfiles` | `ContactProfile[]` | no | — | `["example"]` | — |

Indexes and constraints:

- `@@index([companyId])`
- `@@index([companyId, type])`
- `@@index([ownerUserId])`
- `@@index([organizationId])`
- `@@index([organizationId, companyId])`

### `crm.contact_profiles`

Prisma model `ContactProfile`.

| Column | App field | Type | Null | Default | Sample | Notes |
|---|---|---|---|---|---|---|
| `id` | `id` | `text` | no | `cuid()` | `cksample0001contact01` | primary key |
| `account_contact_id` | `accountContactId` | `text` | no | — | `CDP-crm-org1000-example` | unique. CDP person key (`cdp.customer_profile.cdp_id` text). |
| `organization_id` | `organizationId` | `bigint` | no | — | `1000` | — |
| `company_id` | `companyId` | `text` | yes | — | `example` | — |
| `location_id` | `locationId` | `text` | yes | — | `example` | — |
| `owner_user_id` | `ownerUserId` | `bigint` | yes | — | `1015` | — |
| `created_by_user_id` | `createdByUserId` | `bigint` | yes | — | `1015` | User who created the CRM overlay. Distinct from owner (score-gated assignment). |
| `assignment_reason` | `assignmentReason` | `text` | yes | — | `example` | Assignment Agent ownership (score-gated route) |
| `sla_deadline` | `slaDeadline` | `timestamptz` | yes | — | `2026-10-08T09:30:00.000Z` | — |
| `assigned_at` | `assignedAt` | `timestamptz` | yes | — | `2026-10-08T09:30:00.000Z` | — |
| `assignment_escalated` | `assignmentEscalated` | `boolean` | no | `false` | `false` | — |
| `assignment_followup_stage` | `assignmentFollowupStage` | `varchar(32)` | yes | — | `example` | owner_notified \| owner_reminded \| manager_notified \| admin_notified \| acted |
| `assignment_baseline_status` | `assignmentBaselineStatus` | `varchar(32)` | yes | — | `active` | lead_status at assignment, so a later status change counts as action |
| `nurture_status` | `nurtureStatus` | `varchar(32)` | yes | — | `active` | Nurturing Agent ownership overlay |
| `nurture_sequence_step` | `nurtureSequenceStep` | `integer` | yes | — | `1` | — |
| `nurture_started_at` | `nurtureStartedAt` | `timestamptz` | yes | — | `2026-10-08T09:30:00.000Z` | — |
| `nurture_last_touch_at` | `nurtureLastTouchAt` | `timestamptz` | yes | — | `2026-10-08T09:30:00.000Z` | — |
| `flagged_for_review` | `flaggedForReview` | `boolean` | no | `false` | `false` | Lifecycle Agent review flag (ambiguous evidence / stall) |
| `flag_reason` | `flagReason` | `varchar(500)` | yes | — | `example` | — |
| `lifecycle_last_action` | `lifecycleLastAction` | `varchar(64)` | yes | — | `example` | — |
| `lifecycle_last_reason` | `lifecycleLastReason` | `text` | yes | — | `example` | — |
| `lifecycle_last_run_at` | `lifecycleLastRunAt` | `timestamptz` | yes | — | `2026-10-08T09:30:00.000Z` | — |
| `lead_source` | `leadSource` | `varchar(128)` | yes | — | `example` | — |
| `lead_status` | `leadStatus` | `varchar(32)` | no | `"new"` | `new` | — |
| `disqualify_reason` | `disqualifyReason` | `varchar(64)` | yes | — | `example` | — |
| `bant_budget` | `bantBudget` | `boolean` | yes | — | `false` | — |
| `bant_authority` | `bantAuthority` | `boolean` | yes | — | `false` | — |
| `bant_need` | `bantNeed` | `boolean` | yes | — | `false` | — |
| `bant_timeline` | `bantTimeline` | `boolean` | yes | — | `false` | — |
| `bant_budget_detail` | `bantBudgetDetail` | `varchar(160)` | yes | — | `example` | Customer's own words when they named a budget, decision, need, or date. |
| `bant_authority_detail` | `bantAuthorityDetail` | `varchar(160)` | yes | — | `example` | — |
| `bant_need_detail` | `bantNeedDetail` | `varchar(160)` | yes | — | `example` | — |
| `bant_timeline_detail` | `bantTimelineDetail` | `varchar(160)` | yes | — | `example` | — |
| `converted_deal_id` | `convertedDealId` | `text` | yes | — | `example` | — |
| `tags` | `tags` | `text[]` | no | `[]` | `["example"]` | — |
| `crm_status` | `status` | `varchar(32)` | no | `"active"` | `active` | — |
| `notes` | `notes` | `text` | yes | — | `example` | — |
| `marketing_opt_out` | `marketingOptOut` | `boolean` | no | `false` | `false` | Compliance & Privacy Control Agent — durable marketing suppression. Enforced in lead-nurture-job.ts before any automated send. |
| `marketing_opt_out_at` | `marketingOptOutAt` | `timestamptz` | yes | — | `2026-10-08T09:30:00.000Z` | — |
| `custom_attributes` | `customAttributes` | `jsonb` | yes | — | `{}` | Vertical pack field values (CRM overlay — never CDP columns). |
| `is_pinned` | `isPinned` | `boolean` | no | `false` | `false` | — |
| `created_at` | `createdAt` | `timestamptz` | no | `now()` | `2026-10-08T09:30:00.000Z` | — |
| `updated_at` | `updatedAt` | `timestamptz` | no | — | `2026-10-08T09:30:00.000Z` | — |

Indexes and constraints:

- `@@index([leadStatus])`
- `@@index([status])`
- `@@index([companyId])`
- `@@index([locationId])`
- `@@index([ownerUserId, leadStatus])`
- `@@index([createdByUserId])`
- `@@index([isPinned, updatedAt])`
- `@@index([organizationId, updatedAt])`
- `@@index([organizationId, flaggedForReview])`

### `crm.contact_buying_roles`

Prisma model `ContactBuyingRole`.

| Column | App field | Type | Null | Default | Sample | Notes |
|---|---|---|---|---|---|---|
| `id` | `id` | `text` | no | `cuid()` | `cksample0001contact01` | primary key |
| `organization_id` | `organizationId` | `bigint` | no | — | `1000` | — |
| `contact_id` | `contactId` | `text` | no | — | `CDP-crm-org1000-example` | — |
| `company_id` | `companyId` | `text` | no | — | `example` | — |
| `deal_id` | `dealId` | `text` | yes | — | `example` | — |
| `role` | `role` | `varchar(40)` | no | — | `example` | — |
| `influence` | `influence` | `varchar(16)` | yes | — | `example` | — |
| `attitude` | `attitude` | `varchar(16)` | yes | — | `example` | — |
| `status` | `status` | `varchar(16)` | no | `"suggested"` | `suggested` | confirmed \| suggested \| rejected |
| `confidence` | `confidence` | `double precision` | yes | — | `0.25` | — |
| `evidence` | `evidence` | `text` | yes | — | `example` | — |
| `source` | `source` | `varchar(16)` | no | `"user"` | `user` | user \| ai |
| `created_at` | `createdAt` | `timestamptz` | no | `now()` | `2026-10-08T09:30:00.000Z` | — |
| `updated_at` | `updatedAt` | `timestamptz` | no | — | `2026-10-08T09:30:00.000Z` | — |

Indexes and constraints:

- `@@index([organizationId, companyId])`
- `@@index([organizationId, dealId])`
- `@@index([contactId])`

### `crm.contact_relationships`

Prisma model `ContactRelationship`.

| Column | App field | Type | Null | Default | Sample | Notes |
|---|---|---|---|---|---|---|
| `id` | `id` | `text` | no | `cuid()` | `cksample0001contact01` | primary key |
| `organization_id` | `organizationId` | `bigint` | no | — | `1000` | — |
| `company_id` | `companyId` | `text` | no | — | `example` | — |
| `from_contact_id` | `fromContactId` | `text` | no | — | `example` | — |
| `to_contact_id` | `toContactId` | `text` | no | — | `example` | — |
| `kind` | `kind` | `varchar(32)` | no | — | `example` | reports_to \| influences \| former_colleague \| introduced_by |
| `strength` | `strength` | `varchar(16)` | yes | — | `example` | — |
| `status` | `status` | `varchar(16)` | no | `"suggested"` | `suggested` | confirmed \| suggested \| rejected |
| `evidence` | `evidence` | `text` | yes | — | `example` | — |
| `source` | `source` | `varchar(16)` | no | `"user"` | `user` | — |
| `created_at` | `createdAt` | `timestamptz` | no | `now()` | `2026-10-08T09:30:00.000Z` | — |
| `updated_at` | `updatedAt` | `timestamptz` | no | — | `2026-10-08T09:30:00.000Z` | — |

Indexes and constraints:

- `@@index([organizationId, companyId])`

### `crm.organization_profiles`

Prisma model `OrganizationProfile`.

| Column | App field | Type | Null | Default | Sample | Notes |
|---|---|---|---|---|---|---|
| `organization_id` | `organizationId` | `bigint` | no | — | `1000` | primary key |
| `vertical` | `vertical` | `OrganizationVertical` | no | `general` | `organizationvertical` | — |
| `vertical_config` | `verticalConfig` | `jsonb` | no | `"{}"` | `{}` | — |
| `internal_domains` | `internalDomains` | `text[]` | no | `[]` | `["example"]` | Auto-derived (or admin-entered) email domains treated as "internal" for this org — foundation for future Internal Meeting Assist routing. Derived from `setup_users.work_email` via `emailDomainType()`, excluding free/public providers (gmail, yahoo, outlook, ...). |
| `internal_domains_mode` | `internalDomainsMode` | `varchar(16)` | no | `"derived"` | `derived` | derived \| manual \| needs_manual — see backend/src/service/account/internal-domains.ts |
| `internal_domain_overrides` | `internalDomainOverrides` | `text[]` | no | `[]` | `["example"]` | Specific email addresses always treated as internal regardless of domain (alias/personal-email edge case), admin-entered only. |
| `internal_domains_updated_at` | `internalDomainsUpdatedAt` | `timestamptz` | yes | — | `2026-10-08T09:30:00.000Z` | — |
| `created_at` | `createdAt` | `timestamptz` | no | `now()` | `2026-10-08T09:30:00.000Z` | — |
| `updated_at` | `updatedAt` | `timestamptz` | no | — | `2026-10-08T09:30:00.000Z` | — |

### `crm.deals`

Prisma model `Deal`.

| Column | App field | Type | Null | Default | Sample | Notes |
|---|---|---|---|---|---|---|
| `id` | `id` | `text` | no | `cuid()` | `cksample0001contact01` | primary key |
| `organization_id` | `organizationId` | `bigint` | no | — | `1000` | — |
| `title` | `title` | `text` | no | — | `Example` | — |
| `stage` | `stage` | `DealStage` | no | `qualification` | `dealstage` | — |
| `amount` | `amount` | `numeric(12, 2)` | yes | — | `1500.00` | — |
| `company_id` | `companyId` | `text` | no | — | `example` | — |
| `location_id` | `locationId` | `text` | no | — | `example` | — |
| `contact_id` | `contactId` | `text` | yes | — | `CDP-crm-org1000-example` | Optional CDP person key (`cdp.customer_profile.cdp_id`). |
| `contact_name` | `contactName` | `text` | yes | — | `Example` | — |
| `contact_email` | `contactEmail` | `text` | yes | — | `ada@example.com` | — |
| `owner_user_id` | `ownerUserId` | `bigint` | yes | — | `1015` | — |
| `notes` | `notes` | `text` | yes | — | `example` | — |
| `lost_reason` | `lostReason` | `text` | yes | — | `example` | — |
| `expected_close_date` | `expectedCloseDate` | `timestamptz` | yes | — | `2026-10-08T09:30:00.000Z` | — |
| `closed_at` | `closedAt` | `timestamptz` | yes | — | `2026-10-08T09:30:00.000Z` | — |
| `created_at` | `createdAt` | `timestamptz` | no | `now()` | `2026-10-08T09:30:00.000Z` | — |
| `updated_at` | `updatedAt` | `timestamptz` | no | — | `2026-10-08T09:30:00.000Z` | — |
| `forecast_category` | `forecastCategory` | `varchar(32)` | yes | — | `example` | Pipeline Forecast Auditor overlay — never mutates stage/expectedCloseDate itself. |
| `forecast_confidence_percent` | `forecastConfidencePercent` | `integer` | yes | — | `12` | — |
| `forecast_flagged` | `forecastFlagged` | `boolean` | no | `false` | `false` | — |
| `forecast_reason` | `forecastReason` | `text` | yes | — | `example` | — |
| `forecast_last_run_at` | `forecastLastRunAt` | `timestamptz` | yes | — | `2026-10-08T09:30:00.000Z` | — |
| `activities` | `activities` | `DealActivity[]` | no | — | `["example"]` | — |
| `proposals` | `proposals` | `Proposal[]` | no | — | `["example"]` | — |
| `quotes` | `quotes` | `Quote[]` | no | — | `["example"]` | — |
| `orders` | `orders` | `SalesOrder[]` | no | — | `["example"]` | — |
| `invoices` | `invoices` | `Invoice[]` | no | — | `["example"]` | — |

Indexes and constraints:

- `@@index([companyId])`
- `@@index([locationId])`
- `@@index([stage])`
- `@@index([stage, updatedAt])`
- `@@index([updatedAt])`
- `@@index([locationId, updatedAt])`
- `@@index([organizationId])`
- `@@index([organizationId, stage, updatedAt])`
- `@@index([ownerUserId, stage])`
- `@@index([companyId, stage])`
- `@@index([organizationId, forecastFlagged])`

### `crm.deal_activities`

Prisma model `DealActivity`.

| Column | App field | Type | Null | Default | Sample | Notes |
|---|---|---|---|---|---|---|
| `id` | `id` | `text` | no | `cuid()` | `cksample0001contact01` | primary key |
| `organization_id` | `organizationId` | `bigint` | no | — | `1000` | — |
| `deal_id` | `dealId` | `text` | no | — | `example` | — |
| `type` | `type` | `ActivityType` | no | — | `activitytype` | — |
| `subject` | `subject` | `text` | no | — | `Example` | — |
| `body` | `body` | `text` | yes | — | `example` | — |
| `due_at` | `dueAt` | `timestamptz` | yes | — | `2026-10-08T09:30:00.000Z` | — |
| `completed_at` | `completedAt` | `timestamptz` | yes | — | `2026-10-08T09:30:00.000Z` | — |
| `created_by_user_id` | `createdByUserId` | `bigint` | yes | — | `1015` | — |
| `created_at` | `createdAt` | `timestamptz` | no | `now()` | `2026-10-08T09:30:00.000Z` | — |
| `updated_at` | `updatedAt` | `timestamptz` | no | — | `2026-10-08T09:30:00.000Z` | — |

Indexes and constraints:

- `@@index([dealId])`
- `@@index([dealId, createdAt])`
- `@@index([organizationId])`
- `@@index([organizationId, dealId, createdAt])`

### `crm.contact_activities`

Prisma model `ContactActivity`.

| Column | App field | Type | Null | Default | Sample | Notes |
|---|---|---|---|---|---|---|
| `id` | `id` | `text` | no | `cuid()` | `cksample0001contact01` | primary key |
| `organization_id` | `organizationId` | `bigint` | no | — | `1000` | — |
| `contact_id` | `contactId` | `text` | no | — | `CDP-crm-org1000-example` | — |
| `type` | `type` | `ActivityType` | no | — | `activitytype` | — |
| `folder` | `folder` | `InboxFolder` | no | `inbox` | `inboxfolder` | — |
| `thread_id` | `threadId` | `text` | yes | — | `example` | Groups replies into one conversation in the Inbox UI |
| `gmail_message_id` | `gmailMessageId` | `text` | yes | — | `example` | unique |
| `gmail_thread_id` | `gmailThreadId` | `text` | yes | — | `example` | — |
| `provider_message_id` | `providerMessageId` | `text` | yes | — | `example` | unique. Provider-agnostic message id (Gmail id or Graph message id) for dedupe |
| `provider_thread_id` | `providerThreadId` | `text` | yes | — | `example` | Provider-agnostic conversation id (Gmail threadId or Graph conversationId) |
| `mail_provider` | `mailProvider` | `MailProvider` | yes | — | `mailprovider` | — |
| `rfc_message_id` | `rfcMessageId` | `text` | yes | — | `example` | RFC Message-ID header — required for client-side reply threading |
| `email_direction` | `emailDirection` | `EmailDirection` | yes | — | `ada@example.com` | — |
| `needs_manual_response` | `needsManualResponse` | `boolean` | no | `false` | `false` | Set by the auto-reply agent when a human must answer (sensitive content) |
| `subject` | `subject` | `text` | no | — | `Example` | — |
| `body` | `body` | `text` | yes | — | `example` | — |
| `due_at` | `dueAt` | `timestamptz` | yes | — | `2026-10-08T09:30:00.000Z` | — |
| `assignee_user_id` | `assigneeUserId` | `bigint` | yes | — | `1015` | Task assignee (required for type=task) |
| `task_status` | `taskStatus` | `TaskStatus` | yes | — | `active` | Task workflow status (null for non-task activities). Overdue is derived. |
| `reminder_sent_at` | `reminderSentAt` | `timestamptz` | yes | — | `2026-10-08T09:30:00.000Z` | Legacy 1-hour reminder flag (mirrored to reminder1hSentAt for back-compat) |
| `reminder_24h_sent_at` | `reminder24hSentAt` | `timestamptz` | yes | — | `2026-10-08T09:30:00.000Z` | Set when the T−24h owner + customer reminder legs completed (or permanently skipped) |
| `reminder_1h_sent_at` | `reminder1hSentAt` | `timestamptz` | yes | — | `2026-10-08T09:30:00.000Z` | Set when the T−1h owner + customer reminder legs completed (or permanently skipped) |
| `miss_escalated_at` | `missEscalatedAt` | `timestamptz` | yes | — | `2026-10-08T09:30:00.000Z` | Set when admins were escalated that this meeting was not conducted (no transcript) |
| `mom_sent_at` | `momSentAt` | `timestamptz` | yes | — | `2026-10-08T09:30:00.000Z` | Set when Minutes of Meeting email was sent after transcript attach |
| `transcript_text` | `transcriptText` | `text` | yes | — | `example` | Meeting / call transcript text once a provider (or manual upload) supplies it |
| `transcript_source` | `transcriptSource` | `text` | yes | — | `example` | — |
| `transcript_analyzed_at` | `transcriptAnalyzedAt` | `timestamptz` | yes | — | `2026-10-08T09:30:00.000Z` | — |
| `transcript_insights` | `transcriptInsights` | `jsonb` | yes | — | `{}` | Extracted signals: intent, commitments, objections, BANT hints |
| `disposition` | `disposition` | `varchar(48)` | yes | — | `example` | Outcome word for this touch, written by the disposition agent. Not a fixed list. |
| `disposition_text_hash` | `dispositionTextHash` | `varchar(64)` | yes | — | `example` | Hash of the text already judged, so the same transcript or email is not tagged again. |
| `completed_at` | `completedAt` | `timestamptz` | yes | — | `2026-10-08T09:30:00.000Z` | — |
| `created_by_user_id` | `createdByUserId` | `bigint` | yes | — | `1015` | — |
| `created_at` | `createdAt` | `timestamptz` | no | `now()` | `2026-10-08T09:30:00.000Z` | — |
| `updated_at` | `updatedAt` | `timestamptz` | no | — | `2026-10-08T09:30:00.000Z` | — |

Indexes and constraints:

- `@@index([contactId])`
- `@@index([contactId, createdAt])`
- `@@index([folder, createdAt])`
- `@@index([threadId, createdAt])`
- `@@index([gmailThreadId])`
- `@@index([providerThreadId])`
- `@@index([type, dueAt, reminderSentAt])`
- `@@index([type, dueAt, reminder24hSentAt])`
- `@@index([type, dueAt, reminder1hSentAt])`
- `@@index([type, dueAt, missEscalatedAt])`
- `@@index([type, dueAt, momSentAt])`
- `@@index([assigneeUserId, taskStatus, dueAt])`
- `@@index([organizationId, contactId, createdAt])`
- `@@index([organizationId, folder, createdAt])`

### `crm.user_integration_connections`

Prisma model `UserIntegrationConnection`.

| Column | App field | Type | Null | Default | Sample | Notes |
|---|---|---|---|---|---|---|
| `id` | `id` | `text` | no | `cuid()` | `cksample0001contact01` | primary key |
| `organization_id` | `organizationId` | `bigint` | no | — | `1000` | — |
| `user_id` | `userId` | `bigint` | no | — | `1015` | — |
| `provider` | `provider` | `IntegrationProvider` | no | — | `integrationprovider` | — |
| `account_email` | `accountEmail` | `text` | yes | — | `ada@example.com` | — |
| `access_token` | `accessToken` | `text` | no | — | `example` | — |
| `refresh_token` | `refreshToken` | `text` | yes | — | `example` | — |
| `token_expires_at` | `tokenExpiresAt` | `timestamptz` | yes | — | `2026-10-08T09:30:00.000Z` | — |
| `scope` | `scope` | `text` | yes | — | `example` | — |
| `created_at` | `createdAt` | `timestamptz` | no | `now()` | `2026-10-08T09:30:00.000Z` | — |
| `updated_at` | `updatedAt` | `timestamptz` | no | — | `2026-10-08T09:30:00.000Z` | — |

Indexes and constraints:

- `@@unique([userId, provider])`
- `@@index([userId])`
- `@@index([organizationId])`
- `@@index([organizationId, userId])`

### `crm.org_assignment_settings`

Prisma model `OrgAssignmentSettings`.

| Column | App field | Type | Null | Default | Sample | Notes |
|---|---|---|---|---|---|---|
| `id` | `id` | `text` | no | `cuid()` | `cksample0001contact01` | primary key |
| `organization_id` | `organizationId` | `bigint` | no | — | `1000` | unique |
| `senior_amount_threshold` | `seniorAmountThreshold` | `integer` | no | `50000` | `12` | — |
| `lead_icp` | `leadIcp` | `jsonb` | yes | — | `see JSON keys below` | ICP knobs for Fit scoring: { targetIndustries, sizeTiers, serviceableGeos } |
| `followup_policy` | `followupPolicy` | `jsonb` | yes | — | `{}` | Admin reminder cadence. Null uses product defaults (hot/warm/cold). |
| `updated_by_user_id` | `updatedByUserId` | `bigint` | yes | — | `1015` | — |
| `created_at` | `createdAt` | `timestamptz` | no | `now()` | `2026-10-08T09:30:00.000Z` | — |
| `updated_at` | `updatedAt` | `timestamptz` | no | — | `2026-10-08T09:30:00.000Z` | — |

### `crm.org_finance_settings`

Prisma model `OrgFinanceSettings`.

| Column | App field | Type | Null | Default | Sample | Notes |
|---|---|---|---|---|---|---|
| `id` | `id` | `text` | no | `cuid()` | `cksample0001contact01` | primary key |
| `organization_id` | `organizationId` | `bigint` | no | — | `1000` | unique |
| `default_payment_terms` | `defaultPaymentTerms` | `text` | no | `"Net 30"` | `Net 30` | — |
| `zero_amount_auto_paid` | `zeroAmountAutoPaid` | `boolean` | no | `true` | `false` | — |
| `offline_reference_min_len` | `offlineReferenceMinLen` | `integer` | no | `4` | `12` | — |
| `duplicate_invoice_guard` | `duplicateInvoiceGuard` | `boolean` | no | `true` | `false` | — |
| `online_payments_enabled` | `onlinePaymentsEnabled` | `boolean` | no | `true` | `false` | — |
| `payment_routing_rules` | `paymentRoutingRules` | `jsonb` | yes | — | `see JSON keys below` | { defaultProvider, rules: [{ currency, offlineOnlyAbove, allowedProviders }] } |
| `bank_details` | `bankDetails` | `jsonb` | yes | — | `see JSON keys below` | { accountName, bankName, accountNumber, ifsc, iban, swift, ... } |
| `invoice_number_prefix` | `invoiceNumberPrefix` | `text` | yes | — | `example` | — |
| `invoice_number_next_seq` | `invoiceNumberNextSeq` | `integer` | no | `1` | `1` | — |
| `stripe_publishable_key` | `stripePublishableKey` | `text` | yes | — | `example` | — |
| `stripe_secret_key_enc` | `stripeSecretKeyEnc` | `text` | yes | — | `example` | — |
| `stripe_webhook_secret_enc` | `stripeWebhookSecretEnc` | `text` | yes | — | `example` | — |
| `razorpay_key_id` | `razorpayKeyId` | `text` | yes | — | `example` | — |
| `razorpay_key_secret_enc` | `razorpayKeySecretEnc` | `text` | yes | — | `example` | — |
| `razorpay_webhook_secret_enc` | `razorpayWebhookSecretEnc` | `text` | yes | — | `example` | — |
| `billing_cutoff_day` | `billingCutoffDay` | `integer` | no | `20` | `12` | Day of month (1–28) used for subscription billing cutoff scheduling. |
| `renewal_window_days` | `renewalWindowDays` | `integer` | no | `30` | `12` | Days before contract end to create renewal deal. |
| `auto_renew_default` | `autoRenewDefault` | `boolean` | no | `false` | `false` | — |
| `renewal_quote_auto_create` | `renewalQuoteAutoCreate` | `boolean` | no | `true` | `false` | — |
| `revenue_target_monthly` | `revenueTargetMonthly` | `numeric(12, 2)` | yes | — | `1500.00` | Revenue Gap Forecast Agent — optional admin-set targets. Both optional; the agent degrades to an at-risk-only summary when neither is set. |
| `revenue_target_quarterly` | `revenueTargetQuarterly` | `numeric(12, 2)` | yes | — | `1500.00` | — |
| `revenue_forecast_last_run` | `revenueForecastLastRun` | `jsonb` | yes | — | `see JSON keys below` | Cached last forecast — { hasTarget, narrative, atRiskInvoiceIds, gapScenario, source }. |
| `revenue_forecast_last_run_at` | `revenueForecastLastRunAt` | `timestamptz` | yes | — | `2026-10-08T09:30:00.000Z` | — |
| `updated_by_user_id` | `updatedByUserId` | `bigint` | yes | — | `1015` | — |
| `created_at` | `createdAt` | `timestamptz` | no | `now()` | `2026-10-08T09:30:00.000Z` | — |
| `updated_at` | `updatedAt` | `timestamptz` | no | — | `2026-10-08T09:30:00.000Z` | — |

### `crm.org_nurture_settings`

Prisma model `OrgNurtureSettings`.

| Column | App field | Type | Null | Default | Sample | Notes |
|---|---|---|---|---|---|---|
| `id` | `id` | `text` | no | `cuid()` | `cksample0001contact01` | primary key |
| `organization_id` | `organizationId` | `bigint` | no | — | `1000` | unique |
| `nurture_call_enabled` | `nurtureCallEnabled` | `boolean` | no | `false` | `false` | — |
| `nurture_call_delay_minutes` | `nurtureCallDelayMinutes` | `integer` | no | `15` | `12` | — |
| `updated_by_user_id` | `updatedByUserId` | `bigint` | yes | — | `1015` | — |
| `created_at` | `createdAt` | `timestamptz` | no | `now()` | `2026-10-08T09:30:00.000Z` | — |
| `updated_at` | `updatedAt` | `timestamptz` | no | — | `2026-10-08T09:30:00.000Z` | — |

### `crm.payment_gateway_events`

Prisma model `PaymentGatewayEvent`.

| Column | App field | Type | Null | Default | Sample | Notes |
|---|---|---|---|---|---|---|
| `id` | `id` | `text` | no | `cuid()` | `cksample0001contact01` | primary key |
| `organization_id` | `organizationId` | `bigint` | no | — | `1000` | — |
| `provider` | `provider` | `PaymentGatewayProvider` | no | — | `paymentgatewayprovider` | — |
| `external_event_id` | `externalEventId` | `text` | no | — | `example` | — |
| `invoice_id` | `invoiceId` | `text` | yes | — | `example` | — |
| `payload` | `payload` | `jsonb` | yes | — | `{}` | — |
| `processed_at` | `processedAt` | `timestamptz` | no | `now()` | `2026-10-08T09:30:00.000Z` | — |

Indexes and constraints:

- `@@unique([provider, externalEventId])`
- `@@index([organizationId, processedAt])`
- `@@index([invoiceId])`

### `crm.sales_user_assignment_profiles`

Prisma model `SalesUserAssignmentProfile`.

| Column | App field | Type | Null | Default | Sample | Notes |
|---|---|---|---|---|---|---|
| `id` | `id` | `text` | no | `cuid()` | `cksample0001contact01` | primary key |
| `organization_id` | `organizationId` | `bigint` | no | — | `1000` | — |
| `user_id` | `userId` | `bigint` | no | — | `1015` | — |
| `accepting_leads` | `acceptingLeads` | `boolean` | no | `true` | `false` | — |
| `max_open_deals` | `maxOpenDeals` | `integer` | yes | — | `12` | — |
| `seniority_tier` | `seniorityTier` | `SalesSeniorityTier` | yes | — | `salessenioritytier` | — |
| `on_pto_until` | `onPtoUntil` | `Date` | yes | — | `2026-10-08T09:30:00.000Z` | — |
| `country` | `country` | `varchar(128)` | yes | — | `example` | — |
| `created_at` | `createdAt` | `timestamptz` | no | `now()` | `2026-10-08T09:30:00.000Z` | — |
| `updated_at` | `updatedAt` | `timestamptz` | no | — | `2026-10-08T09:30:00.000Z` | — |

Indexes and constraints:

- `@@unique([organizationId, userId])`
- `@@index([organizationId])`
- `@@index([userId])`

### `inventory.products`

Prisma model `Product`.

| Column | App field | Type | Null | Default | Sample | Notes |
|---|---|---|---|---|---|---|
| `id` | `id` | `text` | no | `cuid()` | `cksample0001contact01` | primary key |
| `organization_id` | `organizationId` | `bigint` | no | — | `1000` | — |
| `name` | `name` | `text` | no | — | `Example` | — |
| `tagline` | `tagline` | `text` | yes | — | `example` | Short line shown on cards |
| `description` | `description` | `text` | yes | — | `example` | — |
| `specifications` | `specifications` | `text` | yes | — | `example` | Full specifications / details (long text) |
| `image_url` | `imageUrl` | `text` | yes | — | `example` | — |
| `gallery_urls` | `galleryUrls` | `jsonb` | yes | — | `{}` | Extra image URLs (JSON string array) |
| `product_url` | `productUrl` | `text` | yes | — | `example` | Product page / PDP / datasheet. Not an image. Null = none. |
| `sku` | `sku` | `text` | yes | — | `example` | — |
| `brand` | `brand` | `text` | yes | — | `example` | Retail / commerce merchandising (optional on B2B). |
| `subcategory` | `subcategory` | `text` | yes | — | `example` | — |
| `stock_on_hand` | `stockOnHand` | `integer` | yes | — | `12` | Warehouse units. Null = not inventory-tracked (services, subscriptions). |
| `price` | `price` | `numeric(12, 2)` | yes | — | `1500.00` | — |
| `max_discount_percent` | `maxDiscountPercent` | `numeric(5, 2)` | yes | — | `1500.00` | Discount above this % on any quote line for this product requires Finance approval before send. Null = no cap. |
| `currency` | `currency` | `text` | no | `"USD"` | `USD` | — |
| `status` | `status` | `ProductStatus` | no | `draft` | `active` | — |
| `product_type` | `productType` | `ProductType` | no | `fixed` | `producttype` | — |
| `category` | `category` | `text` | yes | — | `example` | — |
| `tags` | `tags` | `text` | yes | — | `example` | Comma-separated or freeform tags |
| `billing_type` | `billingType` | `ProductBillingType` | no | `one_time` | `productbillingtype` | — |
| `billing_frequency` | `billingFrequency` | `ProductBillingFrequency` | yes | — | `productbillingfrequency` | — |
| `unit_of_measure` | `unitOfMeasure` | `ProductUnitOfMeasure` | no | `flat` | `productunitofmeasure` | — |
| `pricing_tiers` | `pricingTiers` | `jsonb` | yes | — | `{}` | Legacy volume tiers on product (prefer Addon / AddonTier for customizable) |
| `custom_attributes` | `customAttributes` | `jsonb` | yes | — | `{}` | Non-pricing industry labels/notes (not used for quote math). |
| `created_at` | `createdAt` | `timestamptz` | no | `now()` | `2026-10-08T09:30:00.000Z` | — |
| `updated_at` | `updatedAt` | `timestamptz` | no | — | `2026-10-08T09:30:00.000Z` | — |
| `addons` | `addons` | `Addon[]` | no | — | `["example"]` | — |
| `offers` | `offers` | `ProductOffer[]` | no | — | `["example"]` | — |
| `price_book_entries` | `priceBookEntries` | `PriceBookEntry[]` | no | — | `["example"]` | — |
| `quote_lines` | `quoteLines` | `QuoteLine[]` | no | — | `["example"]` | — |
| `order_lines` | `orderLines` | `OrderLine[]` | no | — | `["example"]` | — |
| `invoice_lines` | `invoiceLines` | `InvoiceLine[]` | no | — | `["example"]` | — |

Indexes and constraints:

- `@@index([name])`
- `@@index([status])`
- `@@index([category])`
- `@@index([createdAt])`
- `@@index([organizationId])`
- `@@index([organizationId, status])`
- `@@index([organizationId, sku])`
- `@@index([organizationId, productType])`
- `@@index([organizationId, brand])`

### `crm.product_offers`

Prisma model `ProductOffer`.

| Column | App field | Type | Null | Default | Sample | Notes |
|---|---|---|---|---|---|---|
| `id` | `id` | `text` | no | `cuid()` | `cksample0001contact01` | primary key |
| `organization_id` | `organizationId` | `bigint` | no | — | `1000` | — |
| `product_id` | `productId` | `text` | no | — | `example` | — |
| `name` | `name` | `text` | no | — | `Example` | — |
| `code` | `code` | `text` | yes | — | `example` | — |
| `billing_type` | `billingType` | `ProductBillingType` | yes | — | `productbillingtype` | — |
| `billing_frequency` | `billingFrequency` | `ProductBillingFrequency` | yes | — | `productbillingfrequency` | — |
| `included_qty` | `includedQty` | `integer` | yes | — | `12` | — |
| `meter_key` | `meterKey` | `AddonMeterKey` | yes | — | `addonmeterkey` | — |
| `sort_order` | `sortOrder` | `integer` | no | `0` | `12` | — |
| `status` | `status` | `ProductStatus` | no | `active` | `active` | — |
| `created_at` | `createdAt` | `timestamptz` | no | `now()` | `2026-10-08T09:30:00.000Z` | — |
| `updated_at` | `updatedAt` | `timestamptz` | no | — | `2026-10-08T09:30:00.000Z` | — |
| `price_book_entries` | `priceBookEntries` | `PriceBookEntry[]` | no | — | `["example"]` | — |

Indexes and constraints:

- `@@index([productId])`
- `@@index([organizationId])`
- `@@index([organizationId, productId])`

### `crm.price_books`

Prisma model `PriceBook`.

| Column | App field | Type | Null | Default | Sample | Notes |
|---|---|---|---|---|---|---|
| `id` | `id` | `text` | no | `cuid()` | `cksample0001contact01` | primary key |
| `organization_id` | `organizationId` | `bigint` | no | — | `1000` | — |
| `name` | `name` | `text` | no | — | `Example` | — |
| `code` | `code` | `text` | yes | — | `example` | — |
| `currency` | `currency` | `text` | no | `"USD"` | `USD` | — |
| `is_default` | `isDefault` | `boolean` | no | `false` | `false` | — |
| `created_at` | `createdAt` | `timestamptz` | no | `now()` | `2026-10-08T09:30:00.000Z` | — |
| `updated_at` | `updatedAt` | `timestamptz` | no | — | `2026-10-08T09:30:00.000Z` | — |
| `entries` | `entries` | `PriceBookEntry[]` | no | — | `["example"]` | — |

Indexes and constraints:

- `@@index([organizationId])`
- `@@index([organizationId, isDefault])`

### `crm.price_book_entries`

Prisma model `PriceBookEntry`.

| Column | App field | Type | Null | Default | Sample | Notes |
|---|---|---|---|---|---|---|
| `id` | `id` | `text` | no | `cuid()` | `cksample0001contact01` | primary key |
| `organization_id` | `organizationId` | `bigint` | no | — | `1000` | — |
| `price_book_id` | `priceBookId` | `text` | no | — | `example` | — |
| `product_id` | `productId` | `text` | yes | — | `example` | — |
| `offer_id` | `offerId` | `text` | yes | — | `example` | — |
| `addon_id` | `addonId` | `text` | yes | — | `example` | — |
| `amount` | `amount` | `numeric(12, 2)` | no | — | `1500.00` | — |
| `billing_frequency` | `billingFrequency` | `ProductBillingFrequency` | yes | — | `productbillingfrequency` | — |
| `created_at` | `createdAt` | `timestamptz` | no | `now()` | `2026-10-08T09:30:00.000Z` | — |
| `updated_at` | `updatedAt` | `timestamptz` | no | — | `2026-10-08T09:30:00.000Z` | — |

Indexes and constraints:

- `@@index([priceBookId])`
- `@@index([organizationId])`
- `@@index([productId])`
- `@@index([offerId])`
- `@@index([addonId])`
- `@@index([organizationId, priceBookId])`

### `crm.product_addons`

Prisma model `Addon`.

| Column | App field | Type | Null | Default | Sample | Notes |
|---|---|---|---|---|---|---|
| `id` | `id` | `text` | no | `cuid()` | `cksample0001contact01` | primary key |
| `organization_id` | `organizationId` | `bigint` | no | — | `1000` | — |
| `product_id` | `productId` | `text` | no | — | `example` | — |
| `name` | `name` | `text` | no | — | `Example` | — |
| `unit_label` | `unitLabel` | `text` | yes | — | `example` | — |
| `meter_key` | `meterKey` | `AddonMeterKey` | yes | — | `addonmeterkey` | — |
| `is_overage` | `isOverage` | `boolean` | no | `false` | `false` | — |
| `pricing_model` | `pricingModel` | `AddonPricingModel` | no | — | `addonpricingmodel` | — |
| `flat_price` | `flatPrice` | `numeric(12, 2)` | yes | — | `1500.00` | — |
| `unit_price` | `unitPrice` | `numeric(12, 4)` | yes | — | `1500.00` | — |
| `step_size` | `stepSize` | `integer` | yes | — | `12` | — |
| `step_price` | `stepPrice` | `numeric(12, 2)` | yes | — | `1500.00` | — |
| `sort_order` | `sortOrder` | `integer` | no | `0` | `12` | — |
| `created_at` | `createdAt` | `timestamptz` | no | `now()` | `2026-10-08T09:30:00.000Z` | — |
| `updated_at` | `updatedAt` | `timestamptz` | no | — | `2026-10-08T09:30:00.000Z` | — |
| `tiers` | `tiers` | `AddonTier[]` | no | — | `["example"]` | — |
| `invoice_lines` | `invoiceLines` | `InvoiceLine[]` | no | — | `["example"]` | — |
| `price_book_entries` | `priceBookEntries` | `PriceBookEntry[]` | no | — | `["example"]` | — |

Indexes and constraints:

- `@@index([productId])`
- `@@index([organizationId])`
- `@@index([organizationId, productId])`

### `crm.product_addon_tiers`

Prisma model `AddonTier`.

| Column | App field | Type | Null | Default | Sample | Notes |
|---|---|---|---|---|---|---|
| `id` | `id` | `text` | no | `cuid()` | `cksample0001contact01` | primary key |
| `organization_id` | `organizationId` | `bigint` | no | — | `1000` | — |
| `addon_id` | `addonId` | `text` | no | — | `example` | — |
| `min_qty` | `minQty` | `integer` | no | — | `12` | — |
| `max_qty` | `maxQty` | `integer` | yes | — | `12` | — |
| `unit_price` | `unitPrice` | `numeric(12, 4)` | no | — | `1500.00` | — |
| `created_at` | `createdAt` | `timestamptz` | no | `now()` | `2026-10-08T09:30:00.000Z` | — |
| `updated_at` | `updatedAt` | `timestamptz` | no | — | `2026-10-08T09:30:00.000Z` | — |

Indexes and constraints:

- `@@index([addonId])`
- `@@index([organizationId])`
- `@@index([organizationId, addonId])`

### `crm.proposal_templates`

Prisma model `ProposalTemplate`.

| Column | App field | Type | Null | Default | Sample | Notes |
|---|---|---|---|---|---|---|
| `id` | `id` | `text` | no | `cuid()` | `cksample0001contact01` | primary key |
| `organization_id` | `organizationId` | `bigint` | no | — | `1000` | — |
| `name` | `name` | `text` | no | — | `Example` | — |
| `code` | `code` | `text` | yes | — | `example` | — |
| `kind` | `kind` | `ProposalTemplateKind` | no | `standard` | `proposaltemplatekind` | — |
| `sections` | `sections` | `jsonb` | no | — | `see JSON keys below` | Sections: [{ id, key, title, body, sortOrder }] |
| `blueprint` | `blueprint` | `jsonb` | yes | — | `see JSON keys below` | HTML brand blueprint: { version, html, css, theme, slots } |
| `assets` | `assets` | `jsonb` | yes | — | `see JSON keys below` | Inline assets: [{ id, kind, mime, dataBase64 }] |
| `is_default` | `isDefault` | `boolean` | no | `false` | `false` | — |
| `created_at` | `createdAt` | `timestamptz` | no | `now()` | `2026-10-08T09:30:00.000Z` | — |
| `updated_at` | `updatedAt` | `timestamptz` | no | — | `2026-10-08T09:30:00.000Z` | — |
| `proposals` | `proposals` | `Proposal[]` | no | — | `["example"]` | — |

Indexes and constraints:

- `@@unique([organizationId, code])`
- `@@index([organizationId])`
- `@@index([organizationId, isDefault])`

### `crm.proposals`

Prisma model `Proposal`.

| Column | App field | Type | Null | Default | Sample | Notes |
|---|---|---|---|---|---|---|
| `id` | `id` | `text` | no | `cuid()` | `cksample0001contact01` | primary key |
| `organization_id` | `organizationId` | `bigint` | no | — | `1000` | — |
| `deal_id` | `dealId` | `text` | no | — | `example` | — |
| `template_id` | `templateId` | `text` | yes | — | `example` | — |
| `number` | `number` | `text` | no | — | `example` | — |
| `title` | `title` | `text` | no | — | `Example` | — |
| `summary` | `summary` | `text` | yes | — | `example` | — |
| `sections` | `sections` | `jsonb` | yes | — | `{}` | Customer-specific section bodies after merge/edit |
| `blueprint` | `blueprint` | `jsonb` | yes | — | `{}` | Cloned HTML blueprint from template (layout stays fixed) |
| `assets` | `assets` | `jsonb` | yes | — | `{}` | Cloned assets from template |
| `customer_name` | `customerName` | `text` | yes | — | `Example` | Display name used in the document (company or contact) |
| `version` | `version` | `integer` | no | `1` | `12` | — |
| `status` | `status` | `ProposalStatus` | no | `draft` | `active` | — |
| `attachment_url` | `attachmentUrl` | `text` | yes | — | `example` | — |
| `shared_at` | `sharedAt` | `timestamptz` | yes | — | `2026-10-08T09:30:00.000Z` | — |
| `approved_by_user_id` | `approvedByUserId` | `bigint` | yes | — | `1015` | Human approval gate — send/share requires both fields non-null |
| `approved_at` | `approvedAt` | `timestamptz` | yes | — | `2026-10-08T09:30:00.000Z` | — |
| `approval_status` | `approvalStatus` | `varchar(32)` | no | `"drafting"` | `drafting` | — |
| `created_by_user_id` | `createdByUserId` | `bigint` | yes | — | `1015` | — |
| `created_at` | `createdAt` | `timestamptz` | no | `now()` | `2026-10-08T09:30:00.000Z` | — |
| `updated_at` | `updatedAt` | `timestamptz` | no | — | `2026-10-08T09:30:00.000Z` | — |
| `quotes` | `quotes` | `Quote[]` | no | — | `["example"]` | — |
| `generation_runs` | `generationRuns` | `ProposalGenerationRun[]` | no | — | `["example"]` | — |

Indexes and constraints:

- `@@unique([organizationId, number, version])`
- `@@index([organizationId, dealId])`
- `@@index([organizationId, status, updatedAt])`
- `@@index([dealId])`
- `@@index([templateId])`

### `crm.proposal_generation_runs`

Prisma model `ProposalGenerationRun`.

| Column | App field | Type | Null | Default | Sample | Notes |
|---|---|---|---|---|---|---|
| `id` | `id` | `text` | no | `cuid()` | `cksample0001contact01` | primary key |
| `organization_id` | `organizationId` | `bigint` | no | — | `1000` | — |
| `deal_id` | `dealId` | `text` | no | — | `example` | — |
| `replaces_proposal_id` | `replacesProposalId` | `text` | yes | — | `example` | — |
| `base_proposal_updated_at` | `baseProposalUpdatedAt` | `timestamptz` | yes | — | `2026-10-08T09:30:00.000Z` | — |
| `pipeline_version` | `pipelineVersion` | `integer` | no | `2` | `12` | — |
| `proposal_id` | `proposalId` | `text` | yes | — | `example` | unique |
| `actor_user_id` | `actorUserId` | `text` | yes | — | `example` | — |
| `status` | `status` | `varchar(32)` | no | `"queued"` | `queued` | — |
| `input_hash` | `inputHash` | `text` | no | — | `example` | — |
| `prompt_version` | `promptVersion` | `text` | no | `"v2"` | `v2` | — |
| `playbook_id` | `playbookId` | `text` | yes | — | `example` | — |
| `content_playbook_id` | `contentPlaybookId` | `text` | yes | — | `example` | — |
| `requirement_text` | `requirementText` | `text` | no | `""` | `` | — |
| `input_json` | `inputJson` | `jsonb` | yes | — | `{}` | — |
| `requirement_profile` | `requirementProfile` | `jsonb` | yes | — | `{}` | — |
| `kb_snapshot` | `kbSnapshot` | `jsonb` | yes | — | `{}` | — |
| `catalog_snapshot` | `catalogSnapshot` | `jsonb` | yes | — | `{}` | — |
| `deal_plan` | `dealPlan` | `jsonb` | yes | — | `{}` | — |
| `outline` | `outline` | `jsonb` | yes | — | `{}` | — |
| `pricing_snapshot` | `pricingSnapshot` | `jsonb` | yes | — | `{}` | — |
| `pricing_issues` | `pricingIssues` | `jsonb` | yes | — | `{}` | — |
| `deal_brief` | `dealBrief` | `jsonb` | yes | — | `{}` | — |
| `qa_report` | `qaReport` | `jsonb` | yes | — | `{}` | — |
| `error` | `error` | `jsonb` | yes | — | `{}` | — |
| `tokens_in` | `tokensIn` | `integer` | no | `0` | `12` | — |
| `tokens_out` | `tokensOut` | `integer` | no | `0` | `12` | — |
| `cost_estimate` | `costEstimate` | `numeric(10, 4)` | yes | — | `1500.00` | — |
| `started_at` | `startedAt` | `timestamptz` | no | `now()` | `2026-10-08T09:30:00.000Z` | — |
| `finished_at` | `finishedAt` | `timestamptz` | yes | — | `2026-10-08T09:30:00.000Z` | — |
| `heartbeat_at` | `heartbeatAt` | `timestamptz` | yes | — | `2026-10-08T09:30:00.000Z` | — |
| `claimed_at` | `claimedAt` | `timestamptz` | yes | — | `2026-10-08T09:30:00.000Z` | — |
| `next_retry_at` | `nextRetryAt` | `timestamptz` | yes | — | `2026-10-08T09:30:00.000Z` | — |
| `max_tokens` | `maxTokens` | `integer` | yes | — | `12` | — |
| `expires_at` | `expiresAt` | `timestamptz` | yes | — | `2026-10-08T09:30:00.000Z` | — |
| `created_at` | `createdAt` | `timestamptz` | no | `now()` | `2026-10-08T09:30:00.000Z` | — |
| `updated_at` | `updatedAt` | `timestamptz` | no | — | `2026-10-08T09:30:00.000Z` | — |
| `leaves` | `leaves` | `ProposalGenerationLeaf[]` | no | — | `["example"]` | — |

Indexes and constraints:

- `@@index([organizationId, status])`
- `@@index([organizationId, inputHash])`
- `@@index([dealId, status])`
- `@@index([status, heartbeatAt])`
- `@@index([status, nextRetryAt])`

### `crm.proposal_generation_leaves`

Prisma model `ProposalGenerationLeaf`.

| Column | App field | Type | Null | Default | Sample | Notes |
|---|---|---|---|---|---|---|
| `id` | `id` | `text` | no | `cuid()` | `cksample0001contact01` | primary key |
| `run_id` | `runId` | `text` | no | — | `example` | — |
| `leaf_key` | `leafKey` | `text` | no | — | `example` | — |
| `section_type` | `sectionType` | `text` | no | `""` | `` | — |
| `title` | `title` | `text` | no | `""` | `` | — |
| `wave` | `wave` | `integer` | no | `1` | `12` | — |
| `status` | `status` | `varchar(32)` | no | `"pending"` | `pending` | — |
| `attempts` | `attempts` | `integer` | no | `0` | `12` | — |
| `error_class` | `errorClass` | `text` | yes | — | `example` | — |
| `next_retry_at` | `nextRetryAt` | `timestamptz` | yes | — | `2026-10-08T09:30:00.000Z` | — |
| `output_json` | `outputJson` | `jsonb` | yes | — | `{}` | — |
| `model_used` | `modelUsed` | `text` | yes | — | `example` | — |
| `latency_ms` | `latencyMs` | `integer` | yes | — | `12` | — |
| `tokens_in` | `tokensIn` | `integer` | yes | — | `12` | — |
| `tokens_out` | `tokensOut` | `integer` | yes | — | `12` | — |
| `created_at` | `createdAt` | `timestamptz` | no | `now()` | `2026-10-08T09:30:00.000Z` | — |
| `updated_at` | `updatedAt` | `timestamptz` | no | — | `2026-10-08T09:30:00.000Z` | — |

Indexes and constraints:

- `@@unique([runId, leafKey])`
- `@@index([runId, status])`
- `@@index([status, nextRetryAt])`

### `crm.quote_templates`

Prisma model `QuoteTemplate`.

| Column | App field | Type | Null | Default | Sample | Notes |
|---|---|---|---|---|---|---|
| `id` | `id` | `text` | no | `cuid()` | `cksample0001contact01` | primary key |
| `organization_id` | `organizationId` | `bigint` | no | — | `1000` | — |
| `name` | `name` | `text` | no | — | `Example` | — |
| `code` | `code` | `text` | yes | — | `example` | — |
| `kind` | `kind` | `QuoteTemplateKind` | no | `standard` | `quotetemplatekind` | — |
| `sections` | `sections` | `jsonb` | no | — | `see JSON keys below` | Document sections: [{ id, key, title, body, sortOrder }] |
| `blueprint` | `blueprint` | `jsonb` | yes | — | `see JSON keys below` | HTML brand blueprint: { version, html, css, theme, slots } |
| `assets` | `assets` | `jsonb` | yes | — | `see JSON keys below` | Inline assets: [{ id, kind, mime, dataBase64 }] |
| `is_default` | `isDefault` | `boolean` | no | `false` | `false` | — |
| `created_at` | `createdAt` | `timestamptz` | no | `now()` | `2026-10-08T09:30:00.000Z` | — |
| `updated_at` | `updatedAt` | `timestamptz` | no | — | `2026-10-08T09:30:00.000Z` | — |
| `quotes` | `quotes` | `Quote[]` | no | — | `["example"]` | — |

Indexes and constraints:

- `@@unique([organizationId, code])`
- `@@index([organizationId])`
- `@@index([organizationId, isDefault])`

### `crm.quotes`

Prisma model `Quote`.

| Column | App field | Type | Null | Default | Sample | Notes |
|---|---|---|---|---|---|---|
| `id` | `id` | `text` | no | `cuid()` | `cksample0001contact01` | primary key |
| `organization_id` | `organizationId` | `bigint` | no | — | `1000` | — |
| `deal_id` | `dealId` | `text` | no | — | `example` | — |
| `proposal_id` | `proposalId` | `text` | yes | — | `example` | Optional link when a quote was created from a proposal |
| `renewal_contract_id` | `renewalContractId` | `text` | yes | — | `example` | Renewal quote linked to an existing contract (Phase 3). |
| `template_id` | `templateId` | `text` | yes | — | `example` | — |
| `number` | `number` | `text` | no | — | `example` | — |
| `version` | `version` | `integer` | no | `1` | `12` | — |
| `status` | `status` | `QuoteStatus` | no | `draft` | `active` | — |
| `currency` | `currency` | `text` | no | `"USD"` | `USD` | — |
| `subtotal` | `subtotal` | `numeric(12, 2)` | no | `0` | `1500.00` | — |
| `discount_pct` | `discountPct` | `numeric(5, 2)` | no | `0` | `1500.00` | — |
| `total` | `total` | `numeric(12, 2)` | no | `0` | `1500.00` | — |
| `valid_until` | `validUntil` | `timestamptz` | yes | — | `2026-10-08T09:30:00.000Z` | — |
| `notes` | `notes` | `text` | yes | — | `example` | — |
| `document_sections` | `documentSections` | `jsonb` | yes | — | `{}` | Customer-specific document sections after template merge/edit |
| `blueprint` | `blueprint` | `jsonb` | yes | — | `{}` | Cloned HTML blueprint from template |
| `assets` | `assets` | `jsonb` | yes | — | `{}` | Cloned assets from template |
| `customer_name` | `customerName` | `text` | yes | — | `Example` | — |
| `company_name` | `companyName` | `text` | yes | — | `Example` | — |
| `vendor_name` | `vendorName` | `text` | yes | — | `Example` | — |
| `sent_at` | `sentAt` | `timestamptz` | yes | — | `2026-10-08T09:30:00.000Z` | — |
| `accepted_at` | `acceptedAt` | `timestamptz` | yes | — | `2026-10-08T09:30:00.000Z` | — |
| `approved_by_user_id` | `approvedByUserId` | `bigint` | yes | — | `1015` | — |
| `approved_at` | `approvedAt` | `timestamptz` | yes | — | `2026-10-08T09:30:00.000Z` | — |
| `approval_status` | `approvalStatus` | `varchar(32)` | no | `"drafting"` | `drafting` | — |
| `approval_note` | `approvalNote` | `text` | yes | — | `example` | Finance approve/reject note (reject requires a reason). |
| `created_by_user_id` | `createdByUserId` | `bigint` | yes | — | `1015` | — |
| `created_at` | `createdAt` | `timestamptz` | no | `now()` | `2026-10-08T09:30:00.000Z` | — |
| `updated_at` | `updatedAt` | `timestamptz` | no | — | `2026-10-08T09:30:00.000Z` | — |
| `lines` | `lines` | `QuoteLine[]` | no | — | `["example"]` | — |
| `orders` | `orders` | `SalesOrder[]` | no | — | `["example"]` | — |

Indexes and constraints:

- `@@unique([organizationId, number, version])`
- `@@index([organizationId, dealId])`
- `@@index([organizationId, status, createdAt])`
- `@@index([dealId])`
- `@@index([proposalId])`
- `@@index([renewalContractId])`
- `@@index([templateId])`

### `crm.quote_lines`

Prisma model `QuoteLine`.

| Column | App field | Type | Null | Default | Sample | Notes |
|---|---|---|---|---|---|---|
| `id` | `id` | `text` | no | `cuid()` | `cksample0001contact01` | primary key |
| `organization_id` | `organizationId` | `bigint` | no | — | `1000` | — |
| `quote_id` | `quoteId` | `text` | no | — | `example` | — |
| `product_id` | `productId` | `text` | yes | — | `example` | — |
| `name` | `name` | `text` | no | — | `Example` | — |
| `quantity` | `quantity` | `numeric(12, 2)` | no | `1` | `1500.00` | — |
| `unit_price` | `unitPrice` | `numeric(12, 2)` | no | — | `1500.00` | — |
| `amount` | `amount` | `numeric(12, 2)` | no | — | `1500.00` | — |
| `sort_order` | `sortOrder` | `integer` | no | `0` | `12` | — |
| `created_at` | `createdAt` | `timestamptz` | no | `now()` | `2026-10-08T09:30:00.000Z` | — |
| `updated_at` | `updatedAt` | `timestamptz` | no | — | `2026-10-08T09:30:00.000Z` | — |

Indexes and constraints:

- `@@index([quoteId])`
- `@@index([organizationId])`
- `@@index([organizationId, quoteId])`

### `crm.sales_orders`

Prisma model `SalesOrder`.

| Column | App field | Type | Null | Default | Sample | Notes |
|---|---|---|---|---|---|---|
| `id` | `id` | `text` | no | `cuid()` | `cksample0001contact01` | primary key |
| `organization_id` | `organizationId` | `bigint` | no | — | `1000` | — |
| `deal_id` | `dealId` | `text` | yes | — | `example` | — |
| `quote_id` | `quoteId` | `text` | yes | — | `example` | — |
| `company_id` | `companyId` | `text` | yes | — | `example` | Optional for B2C contact-first commerce orders. |
| `contact_id` | `contactId` | `text` | yes | — | `CDP-crm-org1000-example` | Consumer / contact on the order (B2C / B2B2C). CDP person key. |
| `number` | `number` | `text` | no | — | `example` | — |
| `status` | `status` | `OrderStatus` | no | `confirmed` | `active` | — |
| `currency` | `currency` | `text` | no | `"USD"` | `USD` | — |
| `total` | `total` | `numeric(12, 2)` | no | `0` | `1500.00` | — |
| `confirmed_at` | `confirmedAt` | `timestamptz` | yes | — | `2026-10-08T09:30:00.000Z` | — |
| `created_by_user_id` | `createdByUserId` | `bigint` | yes | — | `1015` | — |
| `created_at` | `createdAt` | `timestamptz` | no | `now()` | `2026-10-08T09:30:00.000Z` | — |
| `updated_at` | `updatedAt` | `timestamptz` | no | — | `2026-10-08T09:30:00.000Z` | — |
| `lines` | `lines` | `OrderLine[]` | no | — | `["example"]` | — |
| `invoices` | `invoices` | `Invoice[]` | no | — | `["example"]` | — |

Indexes and constraints:

- `@@unique([organizationId, number])`
- `@@index([organizationId, status, createdAt])`
- `@@index([companyId])`
- `@@index([dealId])`
- `@@index([contactId])`

### `crm.order_lines`

Prisma model `OrderLine`.

| Column | App field | Type | Null | Default | Sample | Notes |
|---|---|---|---|---|---|---|
| `id` | `id` | `text` | no | `cuid()` | `cksample0001contact01` | primary key |
| `organization_id` | `organizationId` | `bigint` | no | — | `1000` | — |
| `order_id` | `orderId` | `text` | no | — | `example` | — |
| `product_id` | `productId` | `text` | yes | — | `example` | — |
| `name` | `name` | `text` | no | — | `Example` | — |
| `quantity` | `quantity` | `numeric(12, 2)` | no | `1` | `1500.00` | — |
| `unit_price` | `unitPrice` | `numeric(12, 2)` | no | — | `1500.00` | — |
| `amount` | `amount` | `numeric(12, 2)` | no | — | `1500.00` | — |
| `sort_order` | `sortOrder` | `integer` | no | `0` | `12` | — |
| `created_at` | `createdAt` | `timestamptz` | no | `now()` | `2026-10-08T09:30:00.000Z` | — |
| `updated_at` | `updatedAt` | `timestamptz` | no | — | `2026-10-08T09:30:00.000Z` | — |

Indexes and constraints:

- `@@index([orderId])`
- `@@index([organizationId])`
- `@@index([organizationId, orderId])`

### `crm.invoice_templates`

Prisma model `InvoiceTemplate`.

| Column | App field | Type | Null | Default | Sample | Notes |
|---|---|---|---|---|---|---|
| `id` | `id` | `text` | no | `cuid()` | `cksample0001contact01` | primary key |
| `organization_id` | `organizationId` | `bigint` | no | — | `1000` | — |
| `name` | `name` | `text` | no | — | `Example` | — |
| `code` | `code` | `text` | yes | — | `example` | — |
| `kind` | `kind` | `InvoiceTemplateKind` | no | `standard` | `invoicetemplatekind` | — |
| `sections` | `sections` | `jsonb` | no | — | `see JSON keys below` | Document sections: [{ id, key, title, body, sortOrder }] |
| `blueprint` | `blueprint` | `jsonb` | yes | — | `see JSON keys below` | HTML brand blueprint: { version, html, css, theme, slots } |
| `assets` | `assets` | `jsonb` | yes | — | `see JSON keys below` | Inline assets: [{ id, kind, mime, dataBase64 }] |
| `is_default` | `isDefault` | `boolean` | no | `false` | `false` | — |
| `created_at` | `createdAt` | `timestamptz` | no | `now()` | `2026-10-08T09:30:00.000Z` | — |
| `updated_at` | `updatedAt` | `timestamptz` | no | — | `2026-10-08T09:30:00.000Z` | — |
| `invoices` | `invoices` | `Invoice[]` | no | — | `["example"]` | — |

Indexes and constraints:

- `@@unique([organizationId, code])`
- `@@index([organizationId])`
- `@@index([organizationId, isDefault])`

### `crm.invoices`

Prisma model `Invoice`.

| Column | App field | Type | Null | Default | Sample | Notes |
|---|---|---|---|---|---|---|
| `id` | `id` | `text` | no | `cuid()` | `cksample0001contact01` | primary key |
| `organization_id` | `organizationId` | `bigint` | no | — | `1000` | — |
| `order_id` | `orderId` | `text` | yes | — | `example` | Optional — set when invoice comes from quote accept / commerce order. |
| `deal_id` | `dealId` | `text` | yes | — | `example` | Optional — set when Finance creates invoice from a deal. |
| `company_id` | `companyId` | `text` | yes | — | `example` | — |
| `template_id` | `templateId` | `text` | yes | — | `example` | — |
| `number` | `number` | `text` | no | — | `example` | — |
| `status` | `status` | `InvoiceStatus` | no | `draft` | `active` | — |
| `currency` | `currency` | `text` | no | `"USD"` | `USD` | — |
| `total` | `total` | `numeric(12, 2)` | no | `0` | `1500.00` | — |
| `discount_amount` | `discountAmount` | `numeric(12, 2)` | no | `0` | `1500.00` | — |
| `tax_amount` | `taxAmount` | `numeric(12, 2)` | no | `0` | `1500.00` | — |
| `tax_details` | `taxDetails` | `jsonb` | yes | — | `{}` | Global tax snapshot (IN GST / UK VAT / US sales tax components). |
| `issue_date` | `issueDate` | `timestamptz` | yes | — | `2026-10-08T09:30:00.000Z` | — |
| `payment_terms` | `paymentTerms` | `text` | yes | — | `example` | — |
| `notes` | `notes` | `text` | yes | — | `example` | — |
| `billing_address` | `billingAddress` | `text` | yes | — | `example` | — |
| `lead_email` | `leadEmail` | `text` | yes | — | `ada@example.com` | — |
| `lead_phone` | `leadPhone` | `text` | yes | — | `+919800000000` | — |
| `tax_id` | `taxId` | `text` | yes | — | `example` | — |
| `due_at` | `dueAt` | `timestamptz` | yes | — | `2026-10-08T09:30:00.000Z` | — |
| `paid_at` | `paidAt` | `timestamptz` | yes | — | `2026-10-08T09:30:00.000Z` | — |
| `sections` | `sections` | `jsonb` | yes | — | `{}` | Customer-specific document sections after template merge/edit |
| `blueprint` | `blueprint` | `jsonb` | yes | — | `{}` | Cloned HTML blueprint from template |
| `assets` | `assets` | `jsonb` | yes | — | `{}` | Cloned assets from template |
| `approved_by_user_id` | `approvedByUserId` | `bigint` | yes | — | `1015` | — |
| `approved_at` | `approvedAt` | `timestamptz` | yes | — | `2026-10-08T09:30:00.000Z` | — |
| `approval_status` | `approvalStatus` | `varchar(32)` | no | `"drafting"` | `drafting` | — |
| `approval_note` | `approvalNote` | `text` | yes | — | `example` | — |
| `billing_kind` | `billingKind` | `InvoiceBillingKind` | no | `standard` | `invoicebillingkind` | — |
| `submitted_for_approval_at` | `submittedForApprovalAt` | `timestamptz` | yes | — | `2026-10-08T09:30:00.000Z` | — |
| `resubmitted_at` | `resubmittedAt` | `timestamptz` | yes | — | `2026-10-08T09:30:00.000Z` | — |
| `payment_method` | `paymentMethod` | `InvoicePaymentMethod` | yes | — | `invoicepaymentmethod` | — |
| `payment_reference` | `paymentReference` | `text` | yes | — | `example` | — |
| `payment_confirmed_by_user_id` | `paymentConfirmedByUserId` | `bigint` | yes | — | `1015` | — |
| `payment_confirmed_at` | `paymentConfirmedAt` | `timestamptz` | yes | — | `2026-10-08T09:30:00.000Z` | — |
| `payment_provider` | `paymentProvider` | `InvoicePaymentProvider` | yes | — | `invoicepaymentprovider` | — |
| `payment_link_url` | `paymentLinkUrl` | `text` | yes | — | `example` | — |
| `payment_session_id` | `paymentSessionId` | `text` | yes | — | `example` | — |
| `payment_session_expires_at` | `paymentSessionExpiresAt` | `timestamptz` | yes | — | `2026-10-08T09:30:00.000Z` | — |
| `payment_session_status` | `paymentSessionStatus` | `InvoicePaymentSessionStatus` | yes | — | `active` | — |
| `sent_at` | `sentAt` | `timestamptz` | yes | — | `2026-10-08T09:30:00.000Z` | — |
| `last_sent_at` | `lastSentAt` | `timestamptz` | yes | — | `2026-10-08T09:30:00.000Z` | — |
| `voided_at` | `voidedAt` | `timestamptz` | yes | — | `2026-10-08T09:30:00.000Z` | — |
| `void_reason` | `voidReason` | `text` | yes | — | `example` | — |
| `voided_by_user_id` | `voidedByUserId` | `bigint` | yes | — | `1015` | — |
| `created_by_user_id` | `createdByUserId` | `bigint` | yes | — | `1015` | — |
| `escalation_severity` | `escalationSeverity` | `varchar(16)` | yes | — | `example` | Invoice Escalation Agent — collections-risk overlay. Agent only ever writes these four fields (+ notifications); never marks paid/void, never changes dueAt/total, never sends escalationDraft itself (human-only send). |
| `escalation_reason` | `escalationReason` | `text` | yes | — | `example` | — |
| `escalation_draft` | `escalationDraft` | `text` | yes | — | `example` | — |
| `escalation_last_run_at` | `escalationLastRunAt` | `timestamptz` | yes | — | `2026-10-08T09:30:00.000Z` | — |
| `dunning_stage` | `dunningStage` | `varchar(16)` | no | `"none"` | `none` | Invoice Dunning Agent — staged reminder->warning->pause_notice cadence. Agent only ever writes these three fields (+ notifications); draft only, a human always reviews and sends (same HITL rule as escalation above). |
| `dunning_stage_sent_at` | `dunningStageSentAt` | `timestamptz` | yes | — | `2026-10-08T09:30:00.000Z` | — |
| `dunning_draft` | `dunningDraft` | `text` | yes | — | `example` | — |
| `contract_id` | `contractId` | `text` | yes | — | `example` | — |
| `billing_schedule_id` | `billingScheduleId` | `text` | yes | — | `example` | — |
| `created_at` | `createdAt` | `timestamptz` | no | `now()` | `2026-10-08T09:30:00.000Z` | — |
| `updated_at` | `updatedAt` | `timestamptz` | no | — | `2026-10-08T09:30:00.000Z` | — |
| `lines` | `lines` | `InvoiceLine[]` | no | — | `["example"]` | — |

Indexes and constraints:

- `@@unique([organizationId, number])`
- `@@index([organizationId, status, createdAt])`
- `@@index([companyId])`
- `@@index([orderId])`
- `@@index([dealId])`
- `@@index([contractId])`
- `@@index([billingScheduleId])`
- `@@index([templateId])`
- `@@index([organizationId, escalationSeverity])`
- `@@index([organizationId, dunningStage])`

### `crm.invoice_lines`

Prisma model `InvoiceLine`.

| Column | App field | Type | Null | Default | Sample | Notes |
|---|---|---|---|---|---|---|
| `id` | `id` | `text` | no | `cuid()` | `cksample0001contact01` | primary key |
| `organization_id` | `organizationId` | `bigint` | no | — | `1000` | — |
| `invoice_id` | `invoiceId` | `text` | no | — | `example` | — |
| `kind` | `kind` | `InvoiceLineKind` | no | `product` | `invoicelinekind` | — |
| `product_id` | `productId` | `text` | yes | — | `example` | — |
| `addon_id` | `addonId` | `text` | yes | — | `example` | — |
| `name` | `name` | `text` | no | — | `Example` | — |
| `description` | `description` | `text` | yes | — | `example` | — |
| `quantity` | `quantity` | `numeric(12, 2)` | no | `1` | `1500.00` | — |
| `unit_price` | `unitPrice` | `numeric(12, 4)` | no | — | `1500.00` | — |
| `tax_percent` | `taxPercent` | `numeric(5, 2)` | no | `0` | `1500.00` | — |
| `amount` | `amount` | `numeric(12, 2)` | no | — | `1500.00` | — |
| `sort_order` | `sortOrder` | `integer` | no | `0` | `12` | — |
| `created_at` | `createdAt` | `timestamptz` | no | `now()` | `2026-10-08T09:30:00.000Z` | — |
| `updated_at` | `updatedAt` | `timestamptz` | no | — | `2026-10-08T09:30:00.000Z` | — |

Indexes and constraints:

- `@@index([invoiceId])`
- `@@index([productId])`
- `@@index([addonId])`
- `@@index([organizationId])`
- `@@index([organizationId, invoiceId])`

### `crm.contracts`

Prisma model `Contract`.

| Column | App field | Type | Null | Default | Sample | Notes |
|---|---|---|---|---|---|---|
| `id` | `id` | `text` | no | `cuid()` | `cksample0001contact01` | primary key |
| `organization_id` | `organizationId` | `bigint` | no | — | `1000` | — |
| `company_id` | `companyId` | `text` | no | — | `example` | — |
| `deal_id` | `dealId` | `text` | yes | — | `example` | — |
| `title` | `title` | `text` | no | — | `Example` | — |
| `starts_at` | `startsAt` | `timestamptz` | no | — | `2026-10-08T09:30:00.000Z` | — |
| `ends_at` | `endsAt` | `timestamptz` | no | — | `2026-10-08T09:30:00.000Z` | — |
| `arr` | `arr` | `numeric(12, 2)` | yes | — | `1500.00` | — |
| `auto_renew` | `autoRenew` | `boolean` | no | `false` | `false` | — |
| `status` | `status` | `ContractStatus` | no | `active` | `active` | — |
| `source_order_id` | `sourceOrderId` | `text` | yes | — | `example` | — |
| `billing_frequency` | `billingFrequency` | `ProductBillingFrequency` | yes | — | `productbillingfrequency` | — |
| `cancelled_at` | `cancelledAt` | `timestamptz` | yes | — | `2026-10-08T09:30:00.000Z` | — |
| `cancel_reason` | `cancelReason` | `text` | yes | — | `example` | — |
| `renew_deal_id` | `renewDealId` | `text` | yes | — | `example` | — |
| `renewal_reminded_at` | `renewalRemindedAt` | `timestamptz` | yes | — | `2026-10-08T09:30:00.000Z` | — |
| `created_at` | `createdAt` | `timestamptz` | no | `now()` | `2026-10-08T09:30:00.000Z` | — |
| `updated_at` | `updatedAt` | `timestamptz` | no | — | `2026-10-08T09:30:00.000Z` | — |
| `billing_schedules` | `billingSchedules` | `ContractBillingSchedule[]` | no | — | `["example"]` | — |
| `invoices` | `invoices` | `Invoice[]` | no | — | `["example"]` | — |

Indexes and constraints:

- `@@index([organizationId, endsAt])`
- `@@index([organizationId, status, endsAt])`
- `@@index([companyId])`
- `@@index([renewDealId])`
- `@@index([endsAt, renewalRemindedAt])`

### `crm.contract_billing_schedules`

Prisma model `ContractBillingSchedule`.

| Column | App field | Type | Null | Default | Sample | Notes |
|---|---|---|---|---|---|---|
| `id` | `id` | `text` | no | `cuid()` | `cksample0001contact01` | primary key |
| `organization_id` | `organizationId` | `bigint` | no | — | `1000` | — |
| `contract_id` | `contractId` | `text` | no | — | `example` | — |
| `billing_kind` | `billingKind` | `InvoiceBillingKind` | no | — | `invoicebillingkind` | — |
| `scheduled_for` | `scheduledFor` | `Date` | no | — | `2026-10-08T09:30:00.000Z` | — |
| `status` | `status` | `ContractBillingScheduleStatus` | no | `scheduled` | `active` | — |
| `invoice_id` | `invoiceId` | `text` | yes | — | `example` | — |
| `amount` | `amount` | `numeric(12, 2)` | yes | — | `1500.00` | — |
| `currency` | `currency` | `text` | no | `"USD"` | `USD` | — |
| `idempotency_key` | `idempotencyKey` | `text` | no | — | `example` | — |
| `created_at` | `createdAt` | `timestamptz` | no | `now()` | `2026-10-08T09:30:00.000Z` | — |
| `updated_at` | `updatedAt` | `timestamptz` | no | — | `2026-10-08T09:30:00.000Z` | — |
| `invoices` | `invoices` | `Invoice[]` | no | — | `["example"]` | — |

Indexes and constraints:

- `@@unique([organizationId, idempotencyKey])`
- `@@index([organizationId, status, scheduledFor])`
- `@@index([contractId])`

### `crm.audit_logs`

Prisma model `AuditLog`.

| Column | App field | Type | Null | Default | Sample | Notes |
|---|---|---|---|---|---|---|
| `id` | `id` | `text` | no | `cuid()` | `cksample0001contact01` | primary key |
| `organization_id` | `organizationId` | `bigint` | no | — | `1000` | — |
| `actor_user_id` | `actorUserId` | `bigint` | yes | — | `1015` | — |
| `action` | `action` | `AuditAction` | no | — | `auditaction` | — |
| `entity_type` | `entityType` | `text` | no | — | `example` | — |
| `entity_id` | `entityId` | `text` | no | — | `example` | — |
| `meta` | `meta` | `jsonb` | yes | — | `{}` | — |
| `created_at` | `createdAt` | `timestamptz` | no | `now()` | `2026-10-08T09:30:00.000Z` | — |

Indexes and constraints:

- `@@index([organizationId, createdAt])`
- `@@index([entityType, entityId])`
- `@@index([actorUserId, createdAt])`

### `crm.report_snapshots`

Prisma model `ReportSnapshot`.

| Column | App field | Type | Null | Default | Sample | Notes |
|---|---|---|---|---|---|---|
| `id` | `id` | `text` | no | `cuid()` | `cksample0001contact01` | primary key |
| `organization_id` | `organizationId` | `bigint` | no | — | `1000` | — |
| `kind` | `kind` | `text` | no | — | `example` | — |
| `payload` | `payload` | `jsonb` | no | — | `{}` | — |
| `generated_at` | `generatedAt` | `timestamptz` | no | `now()` | `2026-10-08T09:30:00.000Z` | — |

Indexes and constraints:

- `@@index([organizationId, kind, generatedAt])`

### `crm.domain_enrichment_cache`

Prisma model `DomainEnrichmentCache`.

| Column | App field | Type | Null | Default | Sample | Notes |
|---|---|---|---|---|---|---|
| `id` | `id` | `text` | no | `cuid()` | `cksample0001contact01` | primary key |
| `organization_id` | `organizationId` | `bigint` | no | — | `1000` | — |
| `domain` | `domain` | `varchar(255)` | no | — | `example` | — |
| `payload` | `payload` | `jsonb` | no | — | `{}` | — |
| `source` | `source` | `text` | yes | — | `example` | — |
| `expires_at` | `expiresAt` | `timestamptz` | no | — | `2026-10-08T09:30:00.000Z` | — |
| `created_at` | `createdAt` | `timestamptz` | no | `now()` | `2026-10-08T09:30:00.000Z` | — |
| `updated_at` | `updatedAt` | `timestamptz` | no | — | `2026-10-08T09:30:00.000Z` | — |

Indexes and constraints:

- `@@unique([organizationId, domain])`
- `@@index([expiresAt])`

### `crm.lead_enrichment_snapshots`

Prisma model `LeadEnrichmentSnapshot`.

| Column | App field | Type | Null | Default | Sample | Notes |
|---|---|---|---|---|---|---|
| `id` | `id` | `text` | no | `cuid()` | `cksample0001contact01` | primary key |
| `organization_id` | `organizationId` | `bigint` | no | — | `1000` | — |
| `contact_id` | `contactId` | `text` | no | — | `CDP-crm-org1000-example` | — |
| `company_name` | `companyName` | `text` | yes | — | `Example` | — |
| `company_size` | `companySize` | `text` | yes | — | `example` | — |
| `industry` | `industry` | `text` | yes | — | `example` | — |
| `company_description` | `companyDescription` | `text` | yes | — | `example` | — |
| `products` | `products` | `text` | yes | — | `example` | — |
| `revenue_band` | `revenueBand` | `text` | yes | — | `example` | — |
| `seniority_tier` | `seniorityTier` | `varchar(32)` | yes | — | `example` | — |
| `geography` | `geography` | `text` | yes | — | `example` | — |
| `email_domain_type` | `emailDomainType` | `varchar(16)` | yes | — | `ada@example.com` | — |
| `enrichment_confidence` | `enrichmentConfidence` | `double precision` | yes | — | `0.25` | — |
| `enrichment_source` | `enrichmentSource` | `text` | yes | — | `example` | — |
| `conflict_flags` | `conflictFlags` | `jsonb` | yes | — | `{}` | — |
| `enrichment_timestamp` | `enrichmentTimestamp` | `timestamptz` | no | `now()` | `2026-10-08T09:30:00.000Z` | — |
| `created_at` | `createdAt` | `timestamptz` | no | `now()` | `2026-10-08T09:30:00.000Z` | — |
| `updated_at` | `updatedAt` | `timestamptz` | no | — | `2026-10-08T09:30:00.000Z` | — |

Indexes and constraints:

- `@@unique([organizationId, contactId])`
- `@@index([organizationId, updatedAt])`

### `crm.lead_enrichment_jobs`

Prisma model `LeadEnrichmentJob`.

| Column | App field | Type | Null | Default | Sample | Notes |
|---|---|---|---|---|---|---|
| `id` | `id` | `text` | no | `cuid()` | `cksample0001contact01` | primary key |
| `organization_id` | `organizationId` | `bigint` | no | — | `1000` | — |
| `contact_id` | `contactId` | `text` | no | — | `CDP-crm-org1000-example` | — |
| `company_id` | `companyId` | `text` | yes | — | `example` | — |
| `status` | `status` | `LeadEnrichmentStatus` | no | `pending` | `active` | — |
| `attempts` | `attempts` | `integer` | no | `0` | `12` | — |
| `max_attempts` | `maxAttempts` | `integer` | no | `5` | `12` | — |
| `next_retry_at` | `nextRetryAt` | `timestamptz` | yes | — | `2026-10-08T09:30:00.000Z` | — |
| `last_error` | `lastError` | `text` | yes | — | `example` | — |
| `result_summary` | `resultSummary` | `jsonb` | yes | — | `{}` | — |
| `created_at` | `createdAt` | `timestamptz` | no | `now()` | `2026-10-08T09:30:00.000Z` | — |
| `updated_at` | `updatedAt` | `timestamptz` | no | — | `2026-10-08T09:30:00.000Z` | — |
| `completed_at` | `completedAt` | `timestamptz` | yes | — | `2026-10-08T09:30:00.000Z` | — |

Indexes and constraints:

- `@@unique([organizationId, contactId])`
- `@@index([status, nextRetryAt])`
- `@@index([organizationId, status, updatedAt])`

### `crm.agent_step_events`

Prisma model `AgentStepEvent`.

| Column | App field | Type | Null | Default | Sample | Notes |
|---|---|---|---|---|---|---|
| `id` | `id` | `text` | no | `cuid()` | `cksample0001contact01` | primary key |
| `organization_id` | `organizationId` | `bigint` | no | — | `1000` | — |
| `agent` | `agent` | `text` | no | — | `example` | — |
| `job_id` | `jobId` | `text` | no | — | `example` | — |
| `contact_id` | `contactId` | `text` | yes | — | `CDP-crm-org1000-example` | — |
| `step` | `step` | `text` | no | — | `example` | — |
| `label` | `label` | `text` | no | — | `example` | — |
| `status` | `status` | `AgentStepStatus` | no | `started` | `active` | — |
| `detail` | `detail` | `jsonb` | yes | — | `{}` | — |
| `error_reason` | `errorReason` | `text` | yes | — | `example` | — |
| `started_at` | `startedAt` | `timestamptz` | no | `now()` | `2026-10-08T09:30:00.000Z` | — |
| `ended_at` | `endedAt` | `timestamptz` | yes | — | `2026-10-08T09:30:00.000Z` | — |

Indexes and constraints:

- `@@unique([jobId, step])`
- `@@index([contactId, startedAt])`
- `@@index([organizationId, agent, startedAt])`

### `crm.agent_input_fingerprints`

Prisma model `AgentInputFingerprint`.

| Column | App field | Type | Null | Default | Sample | Notes |
|---|---|---|---|---|---|---|
| `id` | `id` | `text` | no | `cuid()` | `cksample0001contact01` | primary key |
| `organization_id` | `organizationId` | `bigint` | no | — | `1000` | — |
| `agent` | `agent` | `text` | no | — | `example` | — |
| `entity_type` | `entityType` | `text` | no | — | `example` | — |
| `entity_id` | `entityId` | `text` | no | — | `example` | — |
| `input_hash` | `inputHash` | `text` | no | — | `example` | — |
| `last_checked_at` | `lastCheckedAt` | `timestamptz` | no | `now()` | `2026-10-08T09:30:00.000Z` | — |
| `last_llm_at` | `lastLlmAt` | `timestamptz` | yes | — | `2026-10-08T09:30:00.000Z` | — |
| `created_at` | `createdAt` | `timestamptz` | no | `now()` | `2026-10-08T09:30:00.000Z` | — |
| `updated_at` | `updatedAt` | `timestamptz` | no | — | `2026-10-08T09:30:00.000Z` | — |

Indexes and constraints:

- `@@unique([organizationId, agent, entityType, entityId])`
- `@@index([organizationId, lastCheckedAt])`

### `crm.lead_summaries`

Prisma model `LeadSummary`.

| Column | App field | Type | Null | Default | Sample | Notes |
|---|---|---|---|---|---|---|
| `id` | `id` | `text` | no | `cuid()` | `cksample0001contact01` | primary key |
| `organization_id` | `organizationId` | `bigint` | no | — | `1000` | — |
| `contact_id` | `contactId` | `text` | no | — | `CDP-crm-org1000-example` | — |
| `summary` | `summary` | `text` | no | — | `example` | — |
| `headline` | `headline` | `text` | yes | — | `example` | — |
| `intent` | `intent` | `text` | yes | — | `example` | — |
| `recommended_action` | `recommendedAction` | `text` | yes | — | `example` | — |
| `flags` | `flags` | `jsonb` | yes | — | `{}` | — |
| `signature` | `signature` | `text` | no | — | `example` | — |
| `source` | `source` | `text` | no | `"heuristic"` | `heuristic` | — |
| `model` | `model` | `text` | yes | — | `example` | — |
| `created_at` | `createdAt` | `timestamptz` | no | `now()` | `2026-10-08T09:30:00.000Z` | — |
| `updated_at` | `updatedAt` | `timestamptz` | no | — | `2026-10-08T09:30:00.000Z` | — |

Indexes and constraints:

- `@@unique([organizationId, contactId])`
- `@@index([organizationId, updatedAt])`

### `crm.lead_summary_refresh_queue`

Prisma model `LeadSummaryRefreshQueue`.

| Column | App field | Type | Null | Default | Sample | Notes |
|---|---|---|---|---|---|---|
| `organization_id` | `organizationId` | `bigint` | no | — | `1000` | — |
| `contact_id` | `contactId` | `text` | no | — | `CDP-crm-org1000-example` | — |
| `run_after` | `runAfter` | `timestamptz` | no | — | `2026-10-08T09:30:00.000Z` | — |
| `created_at` | `createdAt` | `timestamptz` | no | `now()` | `2026-10-08T09:30:00.000Z` | — |

Indexes and constraints:

- `@@id([organizationId, contactId])`
- `@@index([runAfter])`

### `crm.notifications`

Prisma model `Notification`.

| Column | App field | Type | Null | Default | Sample | Notes |
|---|---|---|---|---|---|---|
| `id` | `id` | `text` | no | `cuid()` | `cksample0001contact01` | primary key |
| `organization_id` | `organizationId` | `bigint` | no | — | `1000` | — |
| `recipient_user_id` | `recipientUserId` | `bigint` | no | — | `1015` | — |
| `actor_user_id` | `actorUserId` | `bigint` | yes | — | `1015` | — |
| `kind` | `kind` | `text` | no | — | `example` | — |
| `title` | `title` | `text` | no | — | `Example` | — |
| `body` | `body` | `text` | yes | — | `example` | — |
| `href` | `href` | `text` | yes | — | `example` | — |
| `entity_type` | `entityType` | `text` | yes | — | `example` | — |
| `entity_id` | `entityId` | `text` | yes | — | `example` | — |
| `contact_id` | `contactId` | `text` | yes | — | `CDP-crm-org1000-example` | — |
| `metadata` | `metadata` | `jsonb` | yes | — | `{}` | — |
| `read_at` | `readAt` | `timestamptz` | yes | — | `2026-10-08T09:30:00.000Z` | — |
| `created_at` | `createdAt` | `timestamptz` | no | `now()` | `2026-10-08T09:30:00.000Z` | — |

Indexes and constraints:

- `@@index([recipientUserId, createdAt(sort: Desc)])`
- `@@index([recipientUserId, readAt])`
- `@@index([organizationId, createdAt(sort: Desc)])`
- `@@index([contactId])`

### `crm.meeting_analyses`

Prisma model `MeetingAnalysis`.

| Column | App field | Type | Null | Default | Sample | Notes |
|---|---|---|---|---|---|---|
| `id` | `id` | `text` | no | `cuid()` | `cksample0001contact01` | primary key |
| `organization_id` | `organizationId` | `bigint` | no | — | `1000` | — |
| `activity_id` | `activityId` | `text` | no | — | `example` | unique |
| `contact_id` | `contactId` | `text` | yes | — | `CDP-crm-org1000-example` | — |
| `deal_id` | `dealId` | `text` | yes | — | `example` | — |
| `outcome` | `outcome` | `varchar(32)` | yes | — | `example` | — |
| `bant_budget` | `bantBudget` | `boolean` | yes | — | `false` | — |
| `bant_authority` | `bantAuthority` | `boolean` | yes | — | `false` | — |
| `bant_need` | `bantNeed` | `boolean` | yes | — | `false` | — |
| `bant_timeline_text` | `bantTimelineText` | `varchar(256)` | yes | — | `example` | — |
| `next_step_agreed` | `nextStepAgreed` | `text` | yes | — | `example` | — |
| `objections_raised` | `objectionsRaised` | `jsonb` | no | `"[]"` | `[]` | — |
| `confidence` | `confidence` | `double precision` | no | `0` | `0.25` | — |
| `evidence` | `evidence` | `jsonb` | no | `"[]"` | `[]` | — |
| `analyzed_at` | `analyzedAt` | `timestamptz` | no | `now()` | `2026-10-08T09:30:00.000Z` | — |
| `created_at` | `createdAt` | `timestamptz` | no | `now()` | `2026-10-08T09:30:00.000Z` | — |

Indexes and constraints:

- `@@index([contactId, analyzedAt])`

### `crm.coaching_insights`

Prisma model `CoachingInsight`.

| Column | App field | Type | Null | Default | Sample | Notes |
|---|---|---|---|---|---|---|
| `id` | `id` | `text` | no | `cuid()` | `cksample0001contact01` | primary key |
| `organization_id` | `organizationId` | `bigint` | no | — | `1000` | — |
| `activity_id` | `activityId` | `text` | no | — | `example` | unique |
| `contact_id` | `contactId` | `text` | yes | — | `CDP-crm-org1000-example` | — |
| `deal_id` | `dealId` | `text` | yes | — | `example` | — |
| `rep_user_id` | `repUserId` | `bigint` | no | — | `1015` | — |
| `interaction_type` | `interactionType` | `varchar(16)` | no | — | `example` | — |
| `overall_impression` | `overallImpression` | `varchar(16)` | no | — | `example` | — |
| `discovery_quality` | `discoveryQuality` | `text` | yes | — | `example` | — |
| `objection_handling` | `objectionHandling` | `text` | yes | — | `example` | — |
| `methodology_note` | `methodologyNote` | `text` | yes | — | `example` | — |
| `talk_balance_note` | `talkBalanceNote` | `text` | yes | — | `example` | — |
| `strengths` | `strengths` | `jsonb` | no | `"[]"` | `[]` | — |
| `growth_areas` | `growthAreas` | `jsonb` | no | `"[]"` | `[]` | — |
| `highlighted_moment` | `highlightedMoment` | `text` | yes | — | `example` | — |
| `coaching_note` | `coachingNote` | `text` | yes | — | `example` | — |
| `analyzed_at` | `analyzedAt` | `timestamptz` | no | `now()` | `2026-10-08T09:30:00.000Z` | — |
| `created_at` | `createdAt` | `timestamptz` | no | `now()` | `2026-10-08T09:30:00.000Z` | — |

Indexes and constraints:

- `@@index([organizationId, repUserId, createdAt(sort: Desc)])`
- `@@index([contactId])`

### `crm.daily_briefings`

Prisma model `DailyBriefing`.

| Column | App field | Type | Null | Default | Sample | Notes |
|---|---|---|---|---|---|---|
| `id` | `id` | `text` | no | `cuid()` | `cksample0001contact01` | primary key |
| `organization_id` | `organizationId` | `bigint` | no | — | `1000` | — |
| `user_id` | `userId` | `bigint` | no | — | `1015` | — |
| `briefing_date` | `briefingDate` | `Date` | no | — | `2026-10-08T09:30:00.000Z` | — |
| `script` | `script` | `text` | no | — | `example` | — |
| `items` | `items` | `jsonb` | no | `"[]"` | `[]` | — |
| `played_at` | `playedAt` | `timestamptz` | yes | — | `2026-10-08T09:30:00.000Z` | — |
| `created_at` | `createdAt` | `timestamptz` | no | `now()` | `2026-10-08T09:30:00.000Z` | — |
| `updated_at` | `updatedAt` | `timestamptz` | no | — | `2026-10-08T09:30:00.000Z` | — |

Indexes and constraints:

- `@@unique([organizationId, userId, briefingDate])`
- `@@index([organizationId, userId])`

### `crm.privacy_requests`

Prisma model `PrivacyRequest`.

| Column | App field | Type | Null | Default | Sample | Notes |
|---|---|---|---|---|---|---|
| `id` | `id` | `text` | no | `cuid()` | `cksample0001contact01` | primary key |
| `organization_id` | `organizationId` | `bigint` | no | — | `1000` | — |
| `activity_id` | `activityId` | `text` | no | — | `example` | unique |
| `contact_id` | `contactId` | `text` | no | — | `CDP-crm-org1000-example` | — |
| `request_type` | `requestType` | `varchar(24)` | no | — | `example` | — |
| `confidence` | `confidence` | `varchar(16)` | no | — | `example` | — |
| `status` | `status` | `varchar(24)` | no | `"pending_review"` | `pending_review` | — |
| `reason` | `reason` | `text` | yes | — | `example` | — |
| `draft_confirmation` | `draftConfirmation` | `text` | yes | — | `example` | — |
| `reviewed_by_user_id` | `reviewedByUserId` | `bigint` | yes | — | `1015` | — |
| `reviewed_at` | `reviewedAt` | `timestamptz` | yes | — | `2026-10-08T09:30:00.000Z` | — |
| `executed_at` | `executedAt` | `timestamptz` | yes | — | `2026-10-08T09:30:00.000Z` | — |
| `created_at` | `createdAt` | `timestamptz` | no | `now()` | `2026-10-08T09:30:00.000Z` | — |
| `updated_at` | `updatedAt` | `timestamptz` | no | — | `2026-10-08T09:30:00.000Z` | — |

Indexes and constraints:

- `@@index([organizationId, status, createdAt(sort: Desc)])`
- `@@index([contactId])`

### `crm.lead_nurture_jobs`

Prisma model `LeadNurtureJob`.

| Column | App field | Type | Null | Default | Sample | Notes |
|---|---|---|---|---|---|---|
| `id` | `id` | `text` | no | `cuid()` | `cksample0001contact01` | primary key |
| `organization_id` | `organizationId` | `bigint` | no | — | `1000` | — |
| `contact_id` | `contactId` | `text` | no | — | `CDP-crm-org1000-example` | — |
| `status` | `status` | `LeadNurtureStatus` | no | `pending` | `active` | — |
| `decision` | `decision` | `text` | yes | — | `example` | — |
| `nurture_status` | `nurtureStatus` | `varchar(32)` | yes | — | `active` | — |
| `current_sequence_step` | `currentSequenceStep` | `integer` | yes | — | `1` | — |
| `sequence_started_at` | `sequenceStartedAt` | `timestamptz` | yes | — | `2026-10-08T09:30:00.000Z` | — |
| `attempts` | `attempts` | `integer` | no | `0` | `12` | — |
| `max_attempts` | `maxAttempts` | `integer` | no | `5` | `12` | — |
| `next_retry_at` | `nextRetryAt` | `timestamptz` | yes | — | `2026-10-08T09:30:00.000Z` | — |
| `last_error` | `lastError` | `text` | yes | — | `example` | — |
| `result_summary` | `resultSummary` | `jsonb` | yes | — | `{}` | — |
| `last_sent_at` | `lastSentAt` | `timestamptz` | yes | — | `2026-10-08T09:30:00.000Z` | — |
| `created_at` | `createdAt` | `timestamptz` | no | `now()` | `2026-10-08T09:30:00.000Z` | — |
| `updated_at` | `updatedAt` | `timestamptz` | no | — | `2026-10-08T09:30:00.000Z` | — |
| `completed_at` | `completedAt` | `timestamptz` | yes | — | `2026-10-08T09:30:00.000Z` | — |

Indexes and constraints:

- `@@unique([organizationId, contactId])`
- `@@index([status, nextRetryAt])`
- `@@index([organizationId, status, updatedAt])`

### `crm.lead_lifecycle_jobs`

Prisma model `LeadLifecycleJob`.

| Column | App field | Type | Null | Default | Sample | Notes |
|---|---|---|---|---|---|---|
| `id` | `id` | `text` | no | `cuid()` | `cksample0001contact01` | primary key |
| `organization_id` | `organizationId` | `bigint` | no | — | `1000` | — |
| `contact_id` | `contactId` | `text` | no | — | `CDP-crm-org1000-example` | — |
| `status` | `status` | `LeadLifecycleStatus` | no | `pending` | `active` | — |
| `ladder` | `ladder` | `text` | yes | — | `example` | Which ladder moved: lead_status \| lifecycle \| pipeline \| none |
| `from_stage` | `fromStage` | `text` | yes | — | `example` | — |
| `to_stage` | `toStage` | `text` | yes | — | `example` | — |
| `decision` | `decision` | `text` | yes | — | `example` | — |
| `reason` | `reason` | `text` | yes | — | `example` | — |
| `trigger_reason` | `triggerReason` | `text` | yes | — | `example` | — |
| `deal_id` | `dealId` | `text` | yes | — | `example` | — |
| `attempts` | `attempts` | `integer` | no | `0` | `12` | — |
| `max_attempts` | `maxAttempts` | `integer` | no | `5` | `12` | — |
| `next_retry_at` | `nextRetryAt` | `timestamptz` | yes | — | `2026-10-08T09:30:00.000Z` | — |
| `last_error` | `lastError` | `text` | yes | — | `example` | — |
| `result_summary` | `resultSummary` | `jsonb` | yes | — | `{}` | — |
| `last_applied_at` | `lastAppliedAt` | `timestamptz` | yes | — | `2026-10-08T09:30:00.000Z` | — |
| `created_at` | `createdAt` | `timestamptz` | no | `now()` | `2026-10-08T09:30:00.000Z` | — |
| `updated_at` | `updatedAt` | `timestamptz` | no | — | `2026-10-08T09:30:00.000Z` | — |
| `completed_at` | `completedAt` | `timestamptz` | yes | — | `2026-10-08T09:30:00.000Z` | — |

Indexes and constraints:

- `@@unique([organizationId, contactId])`
- `@@index([status, nextRetryAt])`
- `@@index([organizationId, status, updatedAt])`

### `crm.email_auto_reply_jobs`

Prisma model `EmailAutoReplyJob`.

| Column | App field | Type | Null | Default | Sample | Notes |
|---|---|---|---|---|---|---|
| `id` | `id` | `text` | no | `cuid()` | `cksample0001contact01` | primary key |
| `organization_id` | `organizationId` | `bigint` | no | — | `1000` | — |
| `contact_id` | `contactId` | `text` | no | — | `CDP-crm-org1000-example` | — |
| `inbound_activity_id` | `inboundActivityId` | `text` | no | — | `example` | unique. Inbound ContactActivity that triggered this job |
| `mailbox_user_id` | `mailboxUserId` | `bigint` | yes | — | `1015` | Mailbox owner whose OAuth connection received the mail |
| `status` | `status` | `EmailAutoReplyStatus` | no | `pending` | `active` | — |
| `decision` | `decision` | `text` | yes | — | `example` | — |
| `sensitivity` | `sensitivity` | `text` | yes | — | `example` | safe \| sensitive \| unknown |
| `category` | `category` | `text` | yes | — | `example` | — |
| `reason` | `reason` | `text` | yes | — | `example` | — |
| `reply_activity_id` | `replyActivityId` | `text` | yes | — | `example` | Outbound ContactActivity created after an auto-reply send |
| `escalated_to_user_id` | `escalatedToUserId` | `bigint` | yes | — | `1015` | — |
| `attempts` | `attempts` | `integer` | no | `0` | `12` | — |
| `max_attempts` | `maxAttempts` | `integer` | no | `3` | `12` | — |
| `next_retry_at` | `nextRetryAt` | `timestamptz` | yes | — | `2026-10-08T09:30:00.000Z` | — |
| `last_error` | `lastError` | `text` | yes | — | `example` | — |
| `result_summary` | `resultSummary` | `jsonb` | yes | — | `{}` | — |
| `created_at` | `createdAt` | `timestamptz` | no | `now()` | `2026-10-08T09:30:00.000Z` | — |
| `updated_at` | `updatedAt` | `timestamptz` | no | — | `2026-10-08T09:30:00.000Z` | — |
| `completed_at` | `completedAt` | `timestamptz` | yes | — | `2026-10-08T09:30:00.000Z` | — |

Indexes and constraints:

- `@@index([status, nextRetryAt])`
- `@@index([organizationId, status, completedAt])`

### `crm.scheduled_outbound_emails`

Prisma model `ScheduledOutboundEmail`.

| Column | App field | Type | Null | Default | Sample | Notes |
|---|---|---|---|---|---|---|
| `id` | `id` | `text` | no | `cuid()` | `cksample0001contact01` | primary key |
| `organization_id` | `organizationId` | `bigint` | no | — | `1000` | — |
| `mailbox_user_id` | `mailboxUserId` | `bigint` | no | — | `1015` | — |
| `contact_id` | `contactId` | `text` | yes | — | `CDP-crm-org1000-example` | — |
| `draft_activity_id` | `draftActivityId` | `text` | yes | — | `example` | — |
| `to_email` | `toEmail` | `text` | no | — | `ada@example.com` | — |
| `subject` | `subject` | `text` | no | — | `Example` | — |
| `body` | `body` | `text` | no | — | `example` | — |
| `send_at` | `sendAt` | `timestamptz` | no | — | `2026-10-08T09:30:00.000Z` | — |
| `status` | `status` | `text` | no | `"scheduled"` | `scheduled` | scheduled \| sent \| failed \| cancelled |
| `last_error` | `lastError` | `text` | yes | — | `example` | — |
| `sent_at` | `sentAt` | `timestamptz` | yes | — | `2026-10-08T09:30:00.000Z` | — |
| `created_at` | `createdAt` | `timestamptz` | no | `now()` | `2026-10-08T09:30:00.000Z` | — |
| `updated_at` | `updatedAt` | `timestamptz` | no | — | `2026-10-08T09:30:00.000Z` | — |

Indexes and constraints:

- `@@index([status, sendAt])`
- `@@index([draftActivityId])`

### `crm.gmail_push_watches`

Prisma model `GmailPushWatch`.

| Column | App field | Type | Null | Default | Sample | Notes |
|---|---|---|---|---|---|---|
| `id` | `id` | `text` | no | `cuid()` | `cksample0001contact01` | primary key |
| `organization_id` | `organizationId` | `bigint` | yes | — | `1000` | — |
| `user_id` | `userId` | `bigint` | yes | — | `1015` | — |
| `account_email` | `accountEmail` | `text` | no | — | `ada@example.com` | unique |
| `watch_kind` | `watchKind` | `GmailPushWatchKind` | no | `user` | `gmailpushwatchkind` | — |
| `history_id` | `historyId` | `text` | yes | — | `example` | — |
| `expiration` | `expiration` | `timestamptz` | yes | — | `2026-10-08T09:30:00.000Z` | — |
| `created_at` | `createdAt` | `timestamptz` | no | `now()` | `2026-10-08T09:30:00.000Z` | — |
| `updated_at` | `updatedAt` | `timestamptz` | no | — | `2026-10-08T09:30:00.000Z` | — |

Indexes and constraints:

- `@@index([expiration])`

### `crm.google_calendar_watches`

Prisma model `GoogleCalendarWatch`.

| Column | App field | Type | Null | Default | Sample | Notes |
|---|---|---|---|---|---|---|
| `id` | `id` | `text` | no | `cuid()` | `cksample0001contact01` | primary key |
| `organization_id` | `organizationId` | `bigint` | no | — | `1000` | — |
| `user_id` | `userId` | `bigint` | no | — | `1015` | unique |
| `channel_id` | `channelId` | `text` | no | — | `example` | unique |
| `resource_id` | `resourceId` | `text` | yes | — | `example` | — |
| `channel_token` | `channelToken` | `text` | no | — | `example` | — |
| `sync_token` | `syncToken` | `text` | yes | — | `example` | — |
| `expiration` | `expiration` | `timestamptz` | yes | — | `2026-10-08T09:30:00.000Z` | — |
| `created_at` | `createdAt` | `timestamptz` | no | `now()` | `2026-10-08T09:30:00.000Z` | — |
| `updated_at` | `updatedAt` | `timestamptz` | no | — | `2026-10-08T09:30:00.000Z` | — |

Indexes and constraints:

- `@@index([expiration])`

### `crm.calendar_meet_captures`

Prisma model `CalendarMeetCapture`.

| Column | App field | Type | Null | Default | Sample | Notes |
|---|---|---|---|---|---|---|
| `id` | `id` | `text` | no | `cuid()` | `cksample0001contact01` | primary key |
| `organization_id` | `organizationId` | `bigint` | no | — | `1000` | — |
| `user_id` | `userId` | `bigint` | no | — | `1015` | — |
| `google_event_id` | `googleEventId` | `text` | no | — | `example` | — |
| `meet_url` | `meetUrl` | `text` | yes | — | `example` | — |
| `meet_code` | `meetCode` | `text` | yes | — | `example` | — |
| `summary` | `summary` | `text` | yes | — | `example` | — |
| `start_at` | `startAt` | `timestamptz` | yes | — | `2026-10-08T09:30:00.000Z` | — |
| `end_at` | `endAt` | `timestamptz` | yes | — | `2026-10-08T09:30:00.000Z` | — |
| `status` | `status` | `CalendarMeetCaptureStatus` | no | `pending` | `active` | — |
| `contact_id` | `contactId` | `text` | yes | — | `CDP-crm-org1000-example` | — |
| `activity_id` | `activityId` | `text` | yes | — | `example` | — |
| `meeting_service_id` | `meetingServiceId` | `text` | yes | — | `example` | — |
| `last_error` | `lastError` | `text` | yes | — | `example` | — |
| `created_at` | `createdAt` | `timestamptz` | no | `now()` | `2026-10-08T09:30:00.000Z` | — |
| `updated_at` | `updatedAt` | `timestamptz` | no | — | `2026-10-08T09:30:00.000Z` | — |

Indexes and constraints:

- `@@unique([userId, googleEventId])`
- `@@index([organizationId, meetCode])`
- `@@index([meetingServiceId])`

### `crm.lead_scoring_jobs`

Prisma model `LeadScoringJob`.

| Column | App field | Type | Null | Default | Sample | Notes |
|---|---|---|---|---|---|---|
| `id` | `id` | `text` | no | `cuid()` | `cksample0001contact01` | primary key |
| `organization_id` | `organizationId` | `bigint` | no | — | `1000` | — |
| `contact_id` | `contactId` | `text` | no | — | `CDP-crm-org1000-example` | — |
| `status` | `status` | `LeadScoringStatus` | no | `pending` | `active` | — |
| `score` | `score` | `integer` | yes | — | `12` | — |
| `fit_score` | `fitScore` | `integer` | yes | — | `12` | — |
| `intent_score` | `intentScore` | `integer` | yes | — | `12` | — |
| `grade` | `grade` | `text` | yes | — | `example` | — |
| `band` | `band` | `text` | yes | — | `example` | — |
| `rationale` | `rationale` | `text` | yes | — | `example` | — |
| `factors` | `factors` | `jsonb` | yes | — | `{}` | — |
| `next_best_action` | `nextBestAction` | `text` | yes | — | `example` | — |
| `trigger_reason` | `triggerReason` | `text` | yes | — | `example` | — |
| `previous_score` | `previousScore` | `integer` | yes | — | `12` | — |
| `attempts` | `attempts` | `integer` | no | `0` | `12` | — |
| `max_attempts` | `maxAttempts` | `integer` | no | `5` | `12` | — |
| `next_retry_at` | `nextRetryAt` | `timestamptz` | yes | — | `2026-10-08T09:30:00.000Z` | — |
| `last_error` | `lastError` | `text` | yes | — | `example` | — |
| `result_summary` | `resultSummary` | `jsonb` | yes | — | `{}` | — |
| `created_at` | `createdAt` | `timestamptz` | no | `now()` | `2026-10-08T09:30:00.000Z` | — |
| `updated_at` | `updatedAt` | `timestamptz` | no | — | `2026-10-08T09:30:00.000Z` | — |
| `completed_at` | `completedAt` | `timestamptz` | yes | — | `2026-10-08T09:30:00.000Z` | — |

Indexes and constraints:

- `@@unique([organizationId, contactId])`
- `@@index([status, nextRetryAt])`
- `@@index([organizationId, status, updatedAt])`
- `@@index([organizationId, grade, score])`

### `crm.meeting_assist_sessions`

Prisma model `MeetingAssistSession`.

| Column | App field | Type | Null | Default | Sample | Notes |
|---|---|---|---|---|---|---|
| `id` | `id` | `text` | no | `cuid()` | `cksample0001contact01` | primary key |
| `organization_id` | `organizationId` | `bigint` | no | — | `1000` | — |
| `contact_id` | `contactId` | `text` | no | — | `CDP-crm-org1000-example` | — |
| `activity_id` | `activityId` | `text` | no | — | `example` | unique |
| `provider` | `provider` | `MeetingAssistProvider` | no | `other` | `meetingassistprovider` | — |
| `external_meeting_id` | `externalMeetingId` | `text` | yes | — | `example` | — |
| `join_url` | `joinUrl` | `text` | yes | — | `example` | — |
| `host_user_id` | `hostUserId` | `bigint` | yes | — | `1015` | — |
| `status` | `status` | `MeetingAssistStatus` | no | `active` | `active` | — |
| `started_at` | `startedAt` | `timestamptz` | no | `now()` | `2026-10-08T09:30:00.000Z` | — |
| `ended_at` | `endedAt` | `timestamptz` | yes | — | `2026-10-08T09:30:00.000Z` | — |
| `last_assist_at` | `lastAssistAt` | `timestamptz` | yes | — | `2026-10-08T09:30:00.000Z` | — |
| `last_suggestions` | `lastSuggestions` | `jsonb` | yes | — | `{}` | — |
| `meta` | `meta` | `jsonb` | yes | — | `{}` | — |
| `created_at` | `createdAt` | `timestamptz` | no | `now()` | `2026-10-08T09:30:00.000Z` | — |
| `updated_at` | `updatedAt` | `timestamptz` | no | — | `2026-10-08T09:30:00.000Z` | — |
| `chunks` | `chunks` | `MeetingTranscriptChunk[]` | no | — | `["example"]` | — |

Indexes and constraints:

- `@@index([organizationId, contactId, status])`
- `@@index([organizationId, status, startedAt])`
- `@@index([externalMeetingId])`

### `crm.meeting_transcript_chunks`

Prisma model `MeetingTranscriptChunk`.

| Column | App field | Type | Null | Default | Sample | Notes |
|---|---|---|---|---|---|---|
| `id` | `id` | `text` | no | `cuid()` | `cksample0001contact01` | primary key |
| `organization_id` | `organizationId` | `bigint` | no | — | `1000` | — |
| `session_id` | `sessionId` | `text` | no | — | `example` | — |
| `seq` | `seq` | `integer` | no | — | `1` | — |
| `speaker` | `speaker` | `text` | yes | — | `example` | — |
| `speaker_email` | `speakerEmail` | `text` | yes | — | `ada@example.com` | — |
| `text` | `text` | `text` | no | — | `example` | — |
| `spoken_at` | `spokenAt` | `timestamptz` | yes | — | `2026-10-08T09:30:00.000Z` | — |
| `source` | `source` | `text` | no | `"live_push"` | `live_push` | live_push \| zoom_webhook \| teams_graph \| google_drive \| speech_api \| manual |
| `created_at` | `createdAt` | `timestamptz` | no | `now()` | `2026-10-08T09:30:00.000Z` | — |

Indexes and constraints:

- `@@unique([sessionId, seq])`
- `@@index([sessionId, createdAt])`
- `@@index([organizationId])`
- `@@index([organizationId, sessionId])`

### `crm.process_confirmations`

Prisma model `ProcessConfirmation`.

| Column | App field | Type | Null | Default | Sample | Notes |
|---|---|---|---|---|---|---|
| `id` | `id` | `text` | no | `cuid()` | `cksample0001contact01` | primary key |
| `organization_id` | `organizationId` | `bigint` | no | — | `1000` | — |
| `contact_id` | `contactId` | `text` | no | — | `CDP-crm-org1000-example` | — |
| `owner_user_id` | `ownerUserId` | `bigint` | no | — | `1015` | — |
| `activity_id` | `activityId` | `text` | yes | — | `example` | — |
| `deal_id` | `dealId` | `text` | yes | — | `example` | — |
| `action_kind` | `actionKind` | `text` | no | — | `example` | email_proposal \| book_meeting \| close_won \| close_lost \| quote_send \| quote_accept |
| `title` | `title` | `text` | no | — | `Example` | — |
| `summary` | `summary` | `text` | yes | — | `example` | — |
| `payload` | `payload` | `jsonb` | no | — | `{}` | — |
| `status` | `status` | `ProcessConfirmationStatus` | no | `pending` | `active` | — |
| `decided_at` | `decidedAt` | `timestamptz` | yes | — | `2026-10-08T09:30:00.000Z` | — |
| `decided_by_user_id` | `decidedByUserId` | `bigint` | yes | — | `1015` | — |
| `result_note` | `resultNote` | `text` | yes | — | `example` | — |
| `created_at` | `createdAt` | `timestamptz` | no | `now()` | `2026-10-08T09:30:00.000Z` | — |
| `updated_at` | `updatedAt` | `timestamptz` | no | — | `2026-10-08T09:30:00.000Z` | — |

Indexes and constraints:

- `@@index([ownerUserId, status, createdAt(sort: Desc)])`
- `@@index([contactId, status])`
- `@@index([organizationId, status, createdAt(sort: Desc)])`

### `crm.agent_memories`

Prisma model `AgentMemory`.

| Column | App field | Type | Null | Default | Sample | Notes |
|---|---|---|---|---|---|---|
| `id` | `id` | `text` | no | `cuid()` | `cksample0001contact01` | primary key |
| `organization_id` | `organizationId` | `bigint` | no | — | `1000` | — |
| `scope_type` | `scopeType` | `varchar(16)` | no | — | `example` | org \| user \| contact \| deal |
| `scope_id` | `scopeId` | `varchar(64)` | no | `""` | `` | Empty string for org-wide; otherwise user/contact/deal id. |
| `slot_key` | `slotKey` | `varchar(64)` | no | — | `example` | — |
| `slot_value` | `slotValue` | `jsonb` | no | — | `{}` | — |
| `source` | `source` | `varchar(32)` | yes | — | `example` | — |
| `expires_at` | `expiresAt` | `timestamptz` | yes | — | `2026-10-08T09:30:00.000Z` | — |
| `created_at` | `createdAt` | `timestamptz` | no | `now()` | `2026-10-08T09:30:00.000Z` | — |
| `updated_at` | `updatedAt` | `timestamptz` | no | — | `2026-10-08T09:30:00.000Z` | — |

Indexes and constraints:

- `@@unique([organizationId, scopeType, scopeId, slotKey])`
- `@@index([organizationId, scopeType, scopeId])`
- `@@index([organizationId, updatedAt(sort: Desc)])`

### `crm.a2a_spoke_tasks`

Prisma model `A2aSpokeTask`.

| Column | App field | Type | Null | Default | Sample | Notes |
|---|---|---|---|---|---|---|
| `id` | `id` | `text` | no | `cuid()` | `cksample0001contact01` | primary key |
| `organization_id` | `organizationId` | `bigint` | no | — | `1000` | — |
| `task_id` | `taskId` | `text` | no | — | `example` | unique |
| `context_id` | `contextId` | `text` | no | `""` | `` | — |
| `skill_id` | `skillId` | `text` | no | `""` | `` | — |
| `state` | `state` | `varchar(32)` | no | — | `example` | — |
| `actor_id` | `actorId` | `varchar(160)` | no | `""` | `` | — |
| `run_id` | `runId` | `varchar(160)` | no | `""` | `` | — |
| `idempotency_key` | `idempotencyKey` | `varchar(240)` | no | `""` | `` | — |
| `receipt` | `receipt` | `jsonb` | yes | — | `{}` | — |
| `created_at` | `createdAt` | `timestamptz` | no | `now()` | `2026-10-08T09:30:00.000Z` | — |
| `updated_at` | `updatedAt` | `timestamptz` | no | — | `2026-10-08T09:30:00.000Z` | — |

Indexes and constraints:

- `@@index([organizationId, createdAt])`

### `crm.appointments`

Prisma model `Appointment`.

| Column | App field | Type | Null | Default | Sample | Notes |
|---|---|---|---|---|---|---|
| `id` | `id` | `text` | no | `cuid()` | `cksample0001contact01` | primary key |
| `organization_id` | `organizationId` | `bigint` | no | — | `1000` | — |
| `contact_id` | `contactId` | `text` | no | — | `CDP-crm-org1000-example` | — |
| `host_user_id` | `hostUserId` | `bigint` | no | — | `1015` | — |
| `activity_id` | `activityId` | `text` | yes | — | `example` | unique |
| `source` | `source` | `AppointmentSource` | no | — | `appointmentsource` | — |
| `status` | `status` | `AppointmentStatus` | no | `scheduled` | `active` | — |
| `title` | `title` | `text` | no | — | `Example` | — |
| `starts_at` | `startsAt` | `timestamptz` | no | — | `2026-10-08T09:30:00.000Z` | — |
| `ends_at` | `endsAt` | `timestamptz` | no | — | `2026-10-08T09:30:00.000Z` | — |
| `timezone` | `timezone` | `varchar(64)` | no | — | `example` | — |
| `provider` | `provider` | `MeetingAssistProvider` | no | `google_meet` | `meetingassistprovider` | — |
| `join_url` | `joinUrl` | `text` | yes | — | `example` | — |
| `calendar_event_id` | `calendarEventId` | `text` | yes | — | `example` | — |
| `guest_emails` | `guestEmails` | `jsonb` | no | `"[]"` | `[]` | — |
| `assignment_reason` | `assignmentReason` | `text` | yes | — | `example` | — |
| `canceled_at` | `canceledAt` | `timestamptz` | yes | — | `2026-10-08T09:30:00.000Z` | — |
| `completed_at` | `completedAt` | `timestamptz` | yes | — | `2026-10-08T09:30:00.000Z` | — |
| `created_at` | `createdAt` | `timestamptz` | no | `now()` | `2026-10-08T09:30:00.000Z` | — |
| `updated_at` | `updatedAt` | `timestamptz` | no | — | `2026-10-08T09:30:00.000Z` | — |

Indexes and constraints:

- `@@index([organizationId, contactId, status, startsAt])`
- `@@index([hostUserId, startsAt])`

### `crm.api_keys`

Prisma model `ApiKey`.

| Column | App field | Type | Null | Default | Sample | Notes |
|---|---|---|---|---|---|---|
| `id` | `id` | `text` | no | `cuid()` | `cksample0001contact01` | primary key |
| `organization_id` | `organizationId` | `bigint` | no | — | `1000` | — |
| `name` | `name` | `varchar(120)` | no | — | `Example` | — |
| `key_prefix` | `keyPrefix` | `varchar(32)` | no | — | `example` | Public hint, e.g. crm_live_ab12cd34 |
| `key_hash` | `keyHash` | `varchar(64)` | no | — | `example` | — |
| `scopes` | `scopes` | `text[]` | no | — | `["example"]` | contacts \| companies \| deals \| activities \| appointments \| products \| quotes \| invoices \| commerce |
| `created_by_user_id` | `createdByUserId` | `bigint` | no | — | `1015` | — |
| `created_at` | `createdAt` | `timestamptz` | no | `now()` | `2026-10-08T09:30:00.000Z` | — |
| `revoked_at` | `revokedAt` | `timestamptz` | yes | — | `2026-10-08T09:30:00.000Z` | — |
| `last_used_at` | `lastUsedAt` | `timestamptz` | yes | — | `2026-10-08T09:30:00.000Z` | — |

Indexes and constraints:

- `@@unique([organizationId, keyPrefix])`
- `@@index([keyHash])`
- `@@index([organizationId, revokedAt])`

### `crm.org_research_provider_configs`

Prisma model `OrgResearchProviderConfig`.

| Column | App field | Type | Null | Default | Sample | Notes |
|---|---|---|---|---|---|---|
| `id` | `id` | `text` | no | `cuid()` | `cksample0001contact01` | primary key |
| `organization_id` | `organizationId` | `bigint` | no | — | `1000` | — |
| `provider` | `provider` | `ResearchProvider` | no | — | `researchprovider` | — |
| `enabled` | `enabled` | `boolean` | no | `false` | `false` | — |
| `api_key_enc` | `apiKeyEnc` | `text` | yes | — | `example` | — |
| `api_key_hint` | `apiKeyHint` | `text` | yes | — | `example` | — |
| `settings` | `settings` | `jsonb` | yes | — | `see JSON keys below` | e.g. { competitorStacks: ["salesforce"], ... } |
| `updated_by_user_id` | `updatedByUserId` | `bigint` | yes | — | `1015` | — |
| `created_at` | `createdAt` | `timestamptz` | no | `now()` | `2026-10-08T09:30:00.000Z` | — |
| `updated_at` | `updatedAt` | `timestamptz` | no | — | `2026-10-08T09:30:00.000Z` | — |

Indexes and constraints:

- `@@unique([organizationId, provider])`
- `@@index([organizationId])`

### `crm.prospect_pull_jobs`

Prisma model `ProspectPullJob`.

| Column | App field | Type | Null | Default | Sample | Notes |
|---|---|---|---|---|---|---|
| `id` | `id` | `text` | no | `cuid()` | `cksample0001contact01` | primary key |
| `organization_id` | `organizationId` | `bigint` | no | — | `1000` | — |
| `requested_by_user_id` | `requestedByUserId` | `bigint` | no | — | `1015` | — |
| `status` | `status` | `ProspectPullStatus` | no | `pending` | `active` | — |
| `limit_n` | `limitN` | `integer` | no | `10` | `12` | — |
| `sources_requested` | `sourcesRequested` | `jsonb` | no | `"[]"` | `[]` | — |
| `sources_used` | `sourcesUsed` | `jsonb` | yes | — | `{}` | — |
| `criteria` | `criteria` | `jsonb` | no | `"{}"` | `{}` | — |
| `attempts` | `attempts` | `integer` | no | `0` | `12` | — |
| `max_attempts` | `maxAttempts` | `integer` | no | `3` | `12` | — |
| `last_error` | `lastError` | `text` | yes | — | `example` | — |
| `result_summary` | `resultSummary` | `jsonb` | yes | — | `{}` | — |
| `created_at` | `createdAt` | `timestamptz` | no | `now()` | `2026-10-08T09:30:00.000Z` | — |
| `updated_at` | `updatedAt` | `timestamptz` | no | — | `2026-10-08T09:30:00.000Z` | — |
| `completed_at` | `completedAt` | `timestamptz` | yes | — | `2026-10-08T09:30:00.000Z` | — |
| `candidates` | `candidates` | `ProspectPullCandidate[]` | no | — | `["example"]` | — |

Indexes and constraints:

- `@@index([organizationId, status, updatedAt])`
- `@@index([organizationId, createdAt])`

### `crm.prospect_pull_candidates`

Prisma model `ProspectPullCandidate`.

| Column | App field | Type | Null | Default | Sample | Notes |
|---|---|---|---|---|---|---|
| `id` | `id` | `text` | no | `cuid()` | `cksample0001contact01` | primary key |
| `job_id` | `jobId` | `text` | no | — | `example` | — |
| `organization_id` | `organizationId` | `bigint` | no | — | `1000` | — |
| `rank` | `rank` | `integer` | yes | — | `12` | — |
| `selected` | `selected` | `boolean` | no | `true` | `false` | — |
| `first_name` | `firstName` | `text` | yes | — | `Example` | — |
| `last_name` | `lastName` | `text` | yes | — | `Example` | — |
| `email` | `email` | `text` | yes | — | `ada@example.com` | — |
| `phone` | `phone` | `text` | yes | — | `+919800000000` | — |
| `title` | `title` | `text` | yes | — | `Example` | — |
| `company_name` | `companyName` | `text` | yes | — | `Example` | — |
| `company_domain` | `companyDomain` | `text` | yes | — | `example` | — |
| `linkedin_url` | `linkedinUrl` | `text` | yes | — | `example` | — |
| `industry` | `industry` | `text` | yes | — | `example` | — |
| `employee_count` | `employeeCount` | `integer` | yes | — | `1` | — |
| `city` | `city` | `text` | yes | — | `example` | — |
| `country` | `country` | `text` | yes | — | `example` | — |
| `technographics` | `technographics` | `jsonb` | yes | — | `{}` | — |
| `sources_found_in` | `sourcesFoundIn` | `jsonb` | no | `"[]"` | `[]` | — |
| `qualify_reasons` | `qualifyReasons` | `jsonb` | yes | — | `{}` | — |
| `qualify_score` | `qualifyScore` | `integer` | yes | — | `12` | — |
| `provider_payload` | `providerPayload` | `jsonb` | yes | — | `{}` | — |
| `imported_contact_id` | `importedContactId` | `text` | yes | — | `example` | — |
| `created_at` | `createdAt` | `timestamptz` | no | `now()` | `2026-10-08T09:30:00.000Z` | — |
| `updated_at` | `updatedAt` | `timestamptz` | no | — | `2026-10-08T09:30:00.000Z` | — |

Indexes and constraints:

- `@@index([jobId, rank])`
- `@@index([organizationId, jobId])`

### `crm.prospect_provider_cache`

Prisma model `ProspectProviderCache`.

| Column | App field | Type | Null | Default | Sample | Notes |
|---|---|---|---|---|---|---|
| `id` | `id` | `text` | no | `cuid()` | `cksample0001contact01` | primary key |
| `organization_id` | `organizationId` | `bigint` | no | — | `1000` | — |
| `provider` | `provider` | `ResearchProvider` | no | — | `researchprovider` | — |
| `query_hash` | `queryHash` | `text` | no | — | `example` | — |
| `payload` | `payload` | `jsonb` | no | — | `{}` | — |
| `expires_at` | `expiresAt` | `timestamptz` | no | — | `2026-10-08T09:30:00.000Z` | — |
| `created_at` | `createdAt` | `timestamptz` | no | `now()` | `2026-10-08T09:30:00.000Z` | — |
| `updated_at` | `updatedAt` | `timestamptz` | no | — | `2026-10-08T09:30:00.000Z` | — |

Indexes and constraints:

- `@@unique([organizationId, provider, queryHash])`
- `@@index([expiresAt])`

### `crm.proposal_corpus_batches`

Prisma model `ProposalCorpusBatch`.

| Column | App field | Type | Null | Default | Sample | Notes |
|---|---|---|---|---|---|---|
| `id` | `id` | `text` | no | `cuid()` | `cksample0001contact01` | primary key |
| `organization_id` | `organizationId` | `bigint` | no | — | `1000` | — |
| `created_by_user_id` | `createdByUserId` | `bigint` | no | — | `1015` | — |
| `name` | `name` | `text` | yes | — | `Example` | — |
| `status` | `status` | `ProposalCorpusBatchStatus` | no | `uploading` | `active` | — |
| `last_error` | `lastError` | `text` | yes | — | `example` | — |
| `result_summary` | `resultSummary` | `jsonb` | yes | — | `{}` | — |
| `created_at` | `createdAt` | `timestamptz` | no | `now()` | `2026-10-08T09:30:00.000Z` | — |
| `updated_at` | `updatedAt` | `timestamptz` | no | — | `2026-10-08T09:30:00.000Z` | — |
| `completed_at` | `completedAt` | `timestamptz` | yes | — | `2026-10-08T09:30:00.000Z` | — |
| `items` | `items` | `ProposalCorpusItem[]` | no | — | `["example"]` | — |
| `pairs` | `pairs` | `ProposalCorpusPair[]` | no | — | `["example"]` | — |
| `jobs` | `jobs` | `ProposalCorpusJob[]` | no | — | `["example"]` | — |
| `playbooks` | `playbooks` | `ProposalPlaybook[]` | no | — | `["example"]` | — |
| `case_studies` | `caseStudies` | `ProposalCorpusCaseStudy[]` | no | — | `["example"]` | — |

Indexes and constraints:

- `@@index([organizationId, status, updatedAt])`
- `@@index([organizationId, createdAt])`

### `crm.proposal_corpus_items`

Prisma model `ProposalCorpusItem`.

| Column | App field | Type | Null | Default | Sample | Notes |
|---|---|---|---|---|---|---|
| `id` | `id` | `text` | no | `cuid()` | `cksample0001contact01` | primary key |
| `batch_id` | `batchId` | `text` | no | — | `example` | — |
| `organization_id` | `organizationId` | `bigint` | no | — | `1000` | — |
| `kind` | `kind` | `ProposalCorpusItemKind` | no | — | `proposalcorpusitemkind` | — |
| `pair_slot` | `pairSlot` | `integer` | no | `0` | `12` | User-built pair index (repeatable slots). Both files in a slot share this value. |
| `storage_path` | `storagePath` | `text` | no | — | `example` | — |
| `filename` | `filename` | `text` | no | — | `Example` | — |
| `mime` | `mime` | `text` | yes | — | `example` | — |
| `page_count` | `pageCount` | `integer` | yes | — | `1` | — |
| `sha256` | `sha256` | `text` | yes | — | `example` | — |
| `extract_json` | `extractJson` | `jsonb` | yes | — | `{}` | — |
| `status` | `status` | `ProposalCorpusItemStatus` | no | `pending` | `active` | — |
| `last_error` | `lastError` | `text` | yes | — | `example` | — |
| `created_at` | `createdAt` | `timestamptz` | no | `now()` | `2026-10-08T09:30:00.000Z` | — |
| `updated_at` | `updatedAt` | `timestamptz` | no | — | `2026-10-08T09:30:00.000Z` | — |

Indexes and constraints:

- `@@index([batchId, kind])`
- `@@index([batchId, pairSlot])`
- `@@index([organizationId, batchId])`

### `crm.proposal_corpus_pairs`

Prisma model `ProposalCorpusPair`.

| Column | App field | Type | Null | Default | Sample | Notes |
|---|---|---|---|---|---|---|
| `id` | `id` | `text` | no | `cuid()` | `cksample0001contact01` | primary key |
| `batch_id` | `batchId` | `text` | no | — | `example` | — |
| `organization_id` | `organizationId` | `bigint` | no | — | `1000` | — |
| `requirement_item_id` | `requirementItemId` | `text` | no | — | `example` | — |
| `proposal_item_id` | `proposalItemId` | `text` | no | — | `example` | — |
| `confidence` | `confidence` | `double precision` | yes | — | `0.25` | — |
| `gaps_json` | `gapsJson` | `jsonb` | yes | — | `{}` | — |
| `pairing_source` | `pairingSource` | `text` | no | `"user_explicit"` | `user_explicit` | user_explicit = repeatable-slot upload; legacy_auto = pre-ship auto-paired rows. |
| `is_visual_master` | `isVisualMaster` | `boolean` | no | `false` | `false` | True for the one pair in the batch whose proposal feeds theme/skeleton freeze. |
| `created_at` | `createdAt` | `timestamptz` | no | `now()` | `2026-10-08T09:30:00.000Z` | — |
| `updated_at` | `updatedAt` | `timestamptz` | no | — | `2026-10-08T09:30:00.000Z` | — |
| `case_studies` | `caseStudies` | `ProposalCorpusCaseStudy[]` | no | — | `["example"]` | — |

Indexes and constraints:

- `@@unique([batchId, requirementItemId, proposalItemId])`
- `@@index([organizationId, batchId])`

### `crm.proposal_corpus_case_studies`

Prisma model `ProposalCorpusCaseStudy`.

| Column | App field | Type | Null | Default | Sample | Notes |
|---|---|---|---|---|---|---|
| `id` | `id` | `text` | no | `cuid()` | `cksample0001contact01` | primary key |
| `organization_id` | `organizationId` | `bigint` | no | — | `1000` | — |
| `batch_id` | `batchId` | `text` | no | — | `example` | — |
| `pair_id` | `pairId` | `text` | no | — | `example` | — |
| `pairing_confidence` | `pairingConfidence` | `double precision` | no | — | `0.25` | — |
| `section_analysis` | `sectionAnalysis` | `jsonb` | no | — | `{}` | — |
| `length_analysis` | `lengthAnalysis` | `jsonb` | no | — | `{}` | — |
| `created_at` | `createdAt` | `timestamptz` | no | `now()` | `2026-10-08T09:30:00.000Z` | — |

Indexes and constraints:

- `@@index([organizationId, createdAt])`
- `@@index([batchId])`
- `@@unique([pairId])`

### `crm.proposal_content_playbooks`

Prisma model `ProposalContentPlaybook`.

| Column | App field | Type | Null | Default | Sample | Notes |
|---|---|---|---|---|---|---|
| `id` | `id` | `text` | no | `cuid()` | `cksample0001contact01` | primary key |
| `organization_id` | `organizationId` | `bigint` | no | — | `1000` | — |
| `version` | `version` | `integer` | no | — | `12` | — |
| `section_specs_json` | `sectionSpecsJson` | `jsonb` | no | — | `{}` | — |
| `length_model_json` | `lengthModelJson` | `jsonb` | no | — | `{}` | — |
| `exemplar_bank_json` | `exemplarBankJson` | `jsonb` | no | — | `{}` | — |
| `case_study_count` | `caseStudyCount` | `integer` | no | — | `1` | — |
| `confidence_level` | `confidenceLevel` | `text` | no | — | `example` | low (<8 case studies) \| high (>=8) |
| `variance_log_json` | `varianceLogJson` | `jsonb` | yes | — | `{}` | — |
| `created_at` | `createdAt` | `timestamptz` | no | `now()` | `2026-10-08T09:30:00.000Z` | — |
| `playbooks` | `playbooks` | `ProposalPlaybook[]` | no | — | `["example"]` | — |

Indexes and constraints:

- `@@unique([organizationId, version])`
- `@@index([organizationId, version])`

### `crm.proposal_corpus_jobs`

Prisma model `ProposalCorpusJob`.

| Column | App field | Type | Null | Default | Sample | Notes |
|---|---|---|---|---|---|---|
| `id` | `id` | `text` | no | `cuid()` | `cksample0001contact01` | primary key |
| `batch_id` | `batchId` | `text` | no | — | `example` | — |
| `organization_id` | `organizationId` | `bigint` | no | — | `1000` | — |
| `status` | `status` | `ProposalCorpusJobStatus` | no | `pending` | `active` | — |
| `stage` | `stage` | `text` | no | `"pending"` | `pending` | — |
| `attempts` | `attempts` | `integer` | no | `0` | `12` | — |
| `max_attempts` | `maxAttempts` | `integer` | no | `3` | `12` | — |
| `last_error` | `lastError` | `text` | yes | — | `example` | — |
| `result_summary` | `resultSummary` | `jsonb` | yes | — | `{}` | — |
| `created_at` | `createdAt` | `timestamptz` | no | `now()` | `2026-10-08T09:30:00.000Z` | — |
| `updated_at` | `updatedAt` | `timestamptz` | no | — | `2026-10-08T09:30:00.000Z` | — |
| `completed_at` | `completedAt` | `timestamptz` | yes | — | `2026-10-08T09:30:00.000Z` | — |

Indexes and constraints:

- `@@index([organizationId, status, updatedAt])`
- `@@index([batchId])`

### `crm.proposal_playbooks`

Prisma model `ProposalPlaybook`.

| Column | App field | Type | Null | Default | Sample | Notes |
|---|---|---|---|---|---|---|
| `id` | `id` | `text` | no | `cuid()` | `cksample0001contact01` | primary key |
| `organization_id` | `organizationId` | `bigint` | no | — | `1000` | — |
| `source_batch_id` | `sourceBatchId` | `text` | yes | — | `example` | — |
| `content_playbook_id` | `contentPlaybookId` | `text` | yes | — | `example` | Snapshot of the org content playbook at freeze time. Not a live pointer. |
| `name` | `name` | `text` | no | — | `Example` | — |
| `tags_json` | `tagsJson` | `jsonb` | yes | — | `{}` | — |
| `sections_json` | `sectionsJson` | `jsonb` | no | — | `{}` | — |
| `blueprint` | `blueprint` | `jsonb` | yes | — | `{}` | Exact page-clone visual master from the winning proposal PDF. |
| `section_library_json` | `sectionLibraryJson` | `jsonb` | yes | — | `{}` | Lazy V2 section library. Existing sectionsJson / blueprint are never rewritten. |
| `assets` | `assets` | `jsonb` | yes | — | `{}` | Page assets for the visual master (pageHtml / rasters). |
| `status` | `status` | `ProposalPlaybookStatus` | no | `draft` | `active` | — |
| `approved_at` | `approvedAt` | `timestamptz` | yes | — | `2026-10-08T09:30:00.000Z` | — |
| `approved_by_user_id` | `approvedByUserId` | `bigint` | yes | — | `1015` | — |
| `created_at` | `createdAt` | `timestamptz` | no | `now()` | `2026-10-08T09:30:00.000Z` | — |
| `updated_at` | `updatedAt` | `timestamptz` | no | — | `2026-10-08T09:30:00.000Z` | — |

Indexes and constraints:

- `@@index([organizationId, status, updatedAt])`
- `@@index([sourceBatchId])`
- `@@index([contentPlaybookId])`

### `crm.seo_projects`

Prisma model `SeoProject`.

| Column | App field | Type | Null | Default | Sample | Notes |
|---|---|---|---|---|---|---|
| `id` | `id` | `text` | no | `cuid()` | `cksample0001contact01` | primary key |
| `organization_id` | `organizationId` | `bigint` | no | — | `1000` | — |
| `external_project_id` | `externalProjectId` | `text` | no | — | `example` | — |
| `domain` | `domain` | `text` | yes | — | `example` | — |
| `market` | `market` | `text` | yes | — | `example` | — |
| `raw` | `raw` | `jsonb` | yes | — | `{}` | — |
| `synced_at` | `syncedAt` | `timestamptz` | no | `now()` | `2026-10-08T09:30:00.000Z` | — |
| `created_at` | `createdAt` | `timestamptz` | no | `now()` | `2026-10-08T09:30:00.000Z` | — |
| `updated_at` | `updatedAt` | `timestamptz` | no | — | `2026-10-08T09:30:00.000Z` | — |

Indexes and constraints:

- `@@unique([organizationId, externalProjectId])`
- `@@index([organizationId, syncedAt])`

### `crm.seo_tool_snapshots`

Prisma model `SeoToolSnapshot`.

| Column | App field | Type | Null | Default | Sample | Notes |
|---|---|---|---|---|---|---|
| `id` | `id` | `text` | no | `cuid()` | `cksample0001contact01` | primary key |
| `organization_id` | `organizationId` | `bigint` | no | — | `1000` | — |
| `external_project_id` | `externalProjectId` | `text` | no | — | `example` | — |
| `tool_name` | `toolName` | `text` | no | — | `Example` | — |
| `payload` | `payload` | `jsonb` | yes | — | `{}` | — |
| `error` | `error` | `text` | yes | — | `example` | — |
| `fetched_at` | `fetchedAt` | `timestamptz` | no | `now()` | `2026-10-08T09:30:00.000Z` | — |
| `created_at` | `createdAt` | `timestamptz` | no | `now()` | `2026-10-08T09:30:00.000Z` | — |
| `updated_at` | `updatedAt` | `timestamptz` | no | — | `2026-10-08T09:30:00.000Z` | — |

Indexes and constraints:

- `@@unique([organizationId, externalProjectId, toolName])`
- `@@index([organizationId, fetchedAt])`

### `crm.seo_generated_content`

Prisma model `SeoGeneratedContent`.

| Column | App field | Type | Null | Default | Sample | Notes |
|---|---|---|---|---|---|---|
| `id` | `id` | `text` | no | `cuid()` | `cksample0001contact01` | primary key |
| `organization_id` | `organizationId` | `bigint` | no | — | `1000` | — |
| `user_id` | `userId` | `bigint` | yes | — | `1015` | — |
| `project_id` | `projectId` | `text` | yes | — | `example` | — |
| `content_type` | `contentType` | `text` | no | — | `example` | — |
| `title` | `title` | `text` | no | — | `Example` | — |
| `slug` | `slug` | `text` | yes | — | `example` | — |
| `seo_score` | `seoScore` | `integer` | yes | — | `12` | — |
| `body` | `body` | `jsonb` | no | — | `{}` | — |
| `status` | `status` | `text` | no | `"draft"` | `draft` | — |
| `campaign_id` | `campaignId` | `text` | yes | — | `example` | — |
| `primary_keyword` | `primaryKeyword` | `text` | yes | — | `example` | — |
| `keyword_query_id` | `keywordQueryId` | `text` | yes | — | `example` | — |
| `created_at` | `createdAt` | `timestamptz` | no | `now()` | `2026-10-08T09:30:00.000Z` | — |
| `updated_at` | `updatedAt` | `timestamptz` | no | — | `2026-10-08T09:30:00.000Z` | — |

Indexes and constraints:

- `@@index([organizationId, updatedAt])`
- `@@index([organizationId, contentType])`
- `@@index([organizationId, keywordQueryId])`

### `crm.seo_keyword_queries`

Prisma model `SeoKeywordQuery`.

| Column | App field | Type | Null | Default | Sample | Notes |
|---|---|---|---|---|---|---|
| `id` | `id` | `text` | no | `cuid()` | `cksample0001contact01` | primary key |
| `organization_id` | `organizationId` | `bigint` | no | — | `1000` | — |
| `user_id` | `userId` | `bigint` | yes | — | `1015` | — |
| `seed` | `seed` | `text` | no | — | `example` | — |
| `location` | `location` | `text` | no | `"us"` | `us` | — |
| `language` | `language` | `text` | no | `"en"` | `en` | — |
| `filters` | `filters` | `jsonb` | no | `"{}"` | `{}` | — |
| `cache_key` | `cacheKey` | `text` | no | — | `example` | — |
| `semrush_called_at` | `semrushCalledAt` | `timestamptz` | yes | — | `2026-10-08T09:30:00.000Z` | — |
| `expires_at` | `expiresAt` | `timestamptz` | no | — | `2026-10-08T09:30:00.000Z` | — |
| `payload` | `payload` | `jsonb` | no | `"[]"` | `[]` | — |
| `error` | `error` | `text` | yes | — | `example` | — |
| `budget_skipped` | `budgetSkipped` | `boolean` | no | `false` | `false` | — |
| `created_at` | `createdAt` | `timestamptz` | no | `now()` | `2026-10-08T09:30:00.000Z` | — |
| `updated_at` | `updatedAt` | `timestamptz` | no | — | `2026-10-08T09:30:00.000Z` | — |

Indexes and constraints:

- `@@unique([organizationId, cacheKey])`
- `@@index([organizationId, updatedAt])`

### `crm.seo_saved_keywords`

Prisma model `SeoSavedKeyword`.

| Column | App field | Type | Null | Default | Sample | Notes |
|---|---|---|---|---|---|---|
| `id` | `id` | `text` | no | `cuid()` | `cksample0001contact01` | primary key |
| `organization_id` | `organizationId` | `bigint` | no | — | `1000` | — |
| `query_id` | `queryId` | `text` | no | — | `example` | — |
| `term` | `term` | `text` | no | — | `example` | — |
| `metrics` | `metrics` | `jsonb` | no | `"{}"` | `{}` | — |
| `content_id` | `contentId` | `text` | yes | — | `example` | — |
| `created_at` | `createdAt` | `timestamptz` | no | `now()` | `2026-10-08T09:30:00.000Z` | — |
| `updated_at` | `updatedAt` | `timestamptz` | no | — | `2026-10-08T09:30:00.000Z` | — |

Indexes and constraints:

- `@@unique([organizationId, queryId, term])`
- `@@index([organizationId, updatedAt])`

### `crm.seo_social_posts`

Prisma model `SeoSocialPost`.

| Column | App field | Type | Null | Default | Sample | Notes |
|---|---|---|---|---|---|---|
| `id` | `id` | `text` | no | `cuid()` | `cksample0001contact01` | primary key |
| `organization_id` | `organizationId` | `bigint` | no | — | `1000` | — |
| `user_id` | `userId` | `bigint` | yes | — | `1015` | — |
| `content_id` | `contentId` | `text` | yes | — | `example` | — |
| `platform` | `platform` | `text` | no | — | `example` | — |
| `post_type` | `postType` | `text` | no | `"feed"` | `feed` | — |
| `copy` | `copy` | `jsonb` | no | `"{}"` | `{}` | — |
| `status` | `status` | `text` | no | `"draft"` | `draft` | — |
| `scheduled_at` | `scheduledAt` | `timestamptz` | yes | — | `2026-10-08T09:30:00.000Z` | — |
| `published_at` | `publishedAt` | `timestamptz` | yes | — | `2026-10-08T09:30:00.000Z` | — |
| `external_post_id` | `externalPostId` | `text` | yes | — | `example` | — |
| `last_error` | `lastError` | `text` | yes | — | `example` | — |
| `accounts_connection_id` | `accountsConnectionId` | `text` | yes | — | `example` | — |
| `created_at` | `createdAt` | `timestamptz` | no | `now()` | `2026-10-08T09:30:00.000Z` | — |
| `updated_at` | `updatedAt` | `timestamptz` | no | — | `2026-10-08T09:30:00.000Z` | — |

Indexes and constraints:

- `@@index([organizationId, updatedAt])`
- `@@index([organizationId, contentId])`

### `crm.voice_conversations`

Prisma model `VoiceConversation`.

| Column | App field | Type | Null | Default | Sample | Notes |
|---|---|---|---|---|---|---|
| `id` | `id` | `text` | no | `cuid()` | `cksample0001contact01` | primary key |
| `organization_id` | `organizationId` | `bigint` | no | — | `1000` | — |
| `user_id` | `userId` | `bigint` | no | — | `1015` | — |
| `ext` | `ext` | `varchar(32)` | no | — | `example` | — |
| `direction` | `direction` | `varchar(16)` | no | — | `example` | inbound \| outbound |
| `status` | `status` | `varchar(16)` | no | — | `active` | ringing \| rejected \| missed \| connected \| ended \| failed |
| `remote_number` | `remoteNumber` | `varchar(32)` | no | — | `example` | — |
| `remote_name` | `remoteName` | `text` | yes | — | `Example` | — |
| `caller_id` | `callerId` | `varchar(32)` | yes | — | `example` | X-Outbound-Number on an outbound call. |
| `contact_id` | `contactId` | `text` | yes | — | `CDP-crm-org1000-example` | cdp.customer_profile.cdp_id when the number matches a contact. |
| `sip_call_id` | `sipCallId` | `text` | no | — | `example` | — |
| `started_at` | `startedAt` | `timestamptz` | no | — | `2026-10-08T09:30:00.000Z` | — |
| `answered_at` | `answeredAt` | `timestamptz` | yes | — | `2026-10-08T09:30:00.000Z` | — |
| `ended_at` | `endedAt` | `timestamptz` | yes | — | `2026-10-08T09:30:00.000Z` | — |
| `duration_seconds` | `durationSeconds` | `integer` | yes | — | `12` | — |
| `end_reason` | `endReason` | `varchar(32)` | yes | — | `example` | hangup \| remote_bye \| rejected \| busy \| failed |
| `created_at` | `createdAt` | `timestamptz` | no | `now()` | `2026-10-08T09:30:00.000Z` | — |
| `updated_at` | `updatedAt` | `timestamptz` | no | — | `2026-10-08T09:30:00.000Z` | — |

Indexes and constraints:

- `@@unique([organizationId, sipCallId])`
- `@@index([organizationId, userId, startedAt])`
- `@@index([organizationId, contactId, startedAt])`

### `crm.call_transcript_sessions`

Prisma model `CallTranscriptSession`.

| Column | App field | Type | Null | Default | Sample | Notes |
|---|---|---|---|---|---|---|
| `id` | `id` | `text` | no | `cuid()` | `cksample0001contact01` | primary key |
| `organization_id` | `organizationId` | `bigint` | no | — | `1000` | — |
| `user_id` | `userId` | `bigint` | no | — | `1015` | — |
| `ext` | `ext` | `varchar(32)` | no | — | `example` | — |
| `contact_id` | `contactId` | `text` | no | — | `CDP-crm-org1000-example` | — |
| `contact_name` | `contactName` | `text` | yes | — | `Example` | — |
| `remote_digits` | `remoteDigits` | `varchar(32)` | no | — | `example` | Last 10 digits of the connected party, used to match gateway lines. |
| `direction` | `direction` | `varchar(16)` | no | — | `example` | inbound \| outbound |
| `gateway_session_id` | `gatewaySession` | `text` | yes | — | `example` | — |
| `status` | `status` | `varchar(16)` | no | — | `active` | active \| ended |
| `activity_id` | `activityId` | `text` | yes | — | `example` | — |
| `end_reason` | `endReason` | `varchar(32)` | yes | — | `example` | hangup \| remote_bye \| failed |
| `started_at` | `startedAt` | `timestamptz` | no | `now()` | `2026-10-08T09:30:00.000Z` | — |
| `ended_at` | `endedAt` | `timestamptz` | yes | — | `2026-10-08T09:30:00.000Z` | — |
| `created_at` | `createdAt` | `timestamptz` | no | `now()` | `2026-10-08T09:30:00.000Z` | — |
| `updated_at` | `updatedAt` | `timestamptz` | no | — | `2026-10-08T09:30:00.000Z` | — |
| `chunks` | `chunks` | `CallTranscriptChunk[]` | no | — | `["example"]` | — |

Indexes and constraints:

- `@@index([organizationId, status, ext, remoteDigits])`
- `@@index([userId, status])`

### `crm.call_transcript_chunks`

Prisma model `CallTranscriptChunk`.

| Column | App field | Type | Null | Default | Sample | Notes |
|---|---|---|---|---|---|---|
| `id` | `id` | `text` | no | `cuid()` | `cksample0001contact01` | primary key |
| `session_id` | `sessionId` | `text` | no | — | `example` | — |
| `seq` | `seq` | `integer` | no | — | `1` | — |
| `speaker` | `speaker` | `text` | yes | — | `example` | — |
| `is_bot` | `isBot` | `boolean` | no | `false` | `false` | — |
| `text` | `text` | `text` | no | — | `example` | — |
| `emotion` | `emotion` | `text` | yes | — | `example` | — |
| `transcript_tm` | `transcriptTm` | `text` | yes | — | `example` | — |
| `raw` | `raw` | `jsonb` | no | — | `{}` | — |
| `created_at` | `createdAt` | `timestamptz` | no | `now()` | `2026-10-08T09:30:00.000Z` | — |

Indexes and constraints:

- `@@unique([sessionId, seq])`
- `@@index([sessionId, transcriptTm])`

### `crm.nurture_voice_calls`

Prisma model `NurtureVoiceCall`.

| Column | App field | Type | Null | Default | Sample | Notes |
|---|---|---|---|---|---|---|
| `id` | `id` | `text` | no | `cuid()` | `cksample0001contact01` | primary key |
| `organization_id` | `organizationId` | `bigint` | no | — | `1000` | — |
| `contact_id` | `contactId` | `text` | no | — | `CDP-crm-org1000-example` | cdp.customer_profile.cdp_id |
| `activity_id` | `activityId` | `text` | no | — | `example` | — |
| `session_id` | `sessionId` | `text` | no | — | `example` | unique. cc-core auto-bot-call session id (ccass.conversations.external_thread_id) |
| `triggered_at` | `triggeredAt` | `timestamptz` | no | — | `2026-10-08T09:30:00.000Z` | When CRM received the session id from cc-core. |
| `created_at` | `createdAt` | `timestamptz` | no | `now()` | `2026-10-08T09:30:00.000Z` | — |
| `updated_at` | `updatedAt` | `timestamptz` | no | — | `2026-10-08T09:30:00.000Z` | — |

Indexes and constraints:

- `@@index([activityId])`
- `@@index([organizationId, contactId])`

## Shared `accounts` tables the CRM uses

CRM does not own these columns. Types below are the ones the application relies on. Confirm with `information_schema` before assuming a new column.

| Table | What CRM uses it for |
|---|---|
| `accounts.organizations` | Seller tenant. `id` is `organization_id` everywhere. `business_type` is `b2b`, `b2c`, or `b2b2c`. `industry_type` maps to a CRM field pack. `company_name` is the letterhead name. Not a customer company. |
| `accounts.setup_users` | Employees who log in. `id` is every CRM `*_user_id`. Login matches `lower(work_email)`. `status` must be `active`. Optional assignment columns: `skills` (jsonb array), `primary_language`, `secondary_language`, `city`, `state`, `country`, `business_hours_id`. |
| `accounts.setup_roles` | Role name for RBAC: `admin`, `sales_manager`, `sales_rep`, `marketing`, `finance`, `viewer`. `module_permissions` is jsonb. |
| `accounts.setup_user_product_access` | Grant of a role on a product. CRM access is the row with `product_id = 'crm'`. |
| `accounts.setup_channel_configs` | Org channels. CRM bot mailbox is an `active` row with `channel_type = 'email'` and `product_ids` jsonb containing `"crm"`. `settings` is jsonb. |
| `accounts.setup_email_configs` | Sender identity for that channel: `sender_email`, `sender_name`, `reply_to`, `oauth_provider`, `oauth_connection_id`. SMTP and IMAP passwords are encrypted columns. CRM does not use `is_bot` to pick the mailbox. |
| `accounts.mail_oauth_connections` | Encrypted mailbox tokens (`access_token_encrypted`, `refresh_token_encrypted`), `account_email`, `expires_at`, `scope`, `needs_reauth`. |
| `accounts.setup_business_hours` | Lead reminder windows when `setup_users.business_hours_id` is set. `timezone`, `open_time`, `close_time`, `working_days`, `day_timings` jsonb, `status = active`. |
| `accounts.setup_ccaas_queues` | Contact-centre queues. CRM reads them for voice presence. |
| `accounts.setup_ccaas_queue_agents` | Which setup user sits on which queue. |
| `accounts.setup_voice_dids` | Voice DIDs used by SIP registration. |
| `accounts.setup_app_connections` | Connected apps for a tenant. |
| `accounts.setup_social_configs` | Social channel config for a tenant. |
| `accounts.auth_sessions` | Created at login. CRM does not seed this table. |
| `accounts.a2a_spoke_clients` | One Hub OAuth client per spoke. Unique on `a2a_server_name` and `client_id`. Columns: `id` bigint, `a2a_server_name`, `client_id`, `client_secret`, `access_token`, `access_expires_at`, `refresh_token`, `refresh_expires_at`, `skill_version`, `created_at`, `updated_at`, `organization_id`. Do not log secrets. |

### Sample `accounts.organizations` row

```json
{
  "id": "1000",
  "company_name": "Northwind Labs",
  "business_type": "b2b",
  "industry_type": "software",
  "lifecycle_status": "active",
  "country": "India"
}
```

### Sample `accounts.setup_users` row

```json
{
  "id": "1015",
  "organization_id": "1000",
  "work_email": "ada@northwind.example",
  "first_name": "Ada",
  "last_name": "Lovelace",
  "status": "active",
  "country": "India",
  "skills": []
}
```

## Shared `cdp` tables the CRM uses

### `cdp.customer_profile`

One person. The contact list is this table joined to `crm.contact_profiles`.

| Column | Type | CRM use | Sample |
|---|---|---|---|
| `cdp_id` | `text` | Primary key. Same as `crm.contact_profiles.account_contact_id`. | `CDP-crm-org1000-example` |
| `organization_id` | `bigint` | Tenant. | `1000` |
| `first_name` | `varchar(128)` | Given name. | `Ashi` |
| `last_name` | `varchar(128)` | Family name. | `A` |
| `company` | `varchar(255)` | Free-text employer. Not `crm.companies.id`. | `meesho` |
| `city` | `varchar(128)` | City. | `chennai` |
| `region` | `varchar(128)` | Region, or a street line when CRM writes an address here. | `TN` |
| `country` | `varchar(128)` | Country. | `India` |
| `language` | `varchar(64)` | Preferred language. | `English` |
| `timezone` | `varchar(64)` | IANA timezone. | `Asia/Kolkata` |
| `gender` | `varchar(32)` | Optional. | — |
| `date_of_birth` | `date` | Optional. | — |
| `acquisition_channel` | `varchar(128)` | First source. Do not write the placeholder `cdp_ingest`. | `inbound_whatsapp` |
| `acquisition_date` | `date` | Acquisition date. | `2026-10-01` |
| `first_referrer` | `text` | First referrer. | — |
| `first_seen_at` | `timestamptz` | First seen. | `2026-10-01T08:00:00.000Z` |
| `last_seen_at` | `timestamptz` | Last seen. | `2026-10-08T09:00:00.000Z` |
| `contact_type` | `varchar(200)` | `contact`, `customer`, or `churned`. Customer and churned are treated as converted. | `contact` |
| `custom_fields` | `jsonb` | See JSON keys. Default `{}`. | `{"title":"Founder"}` |
| `preferences_json` | `jsonb` | CDP preferences. Customer 360 prints key/value pairs. | `{}` |
| `consent_json` | `jsonb` | CDP consent. Customer 360 prints key/value pairs. | `{}` |
| `traits_json` | `jsonb` | CDP traits. | `{}` |
| `tenant_id` | `text` | Legacy string. Prefer `organization_id`. Default `default`. | `default` |
| `blocked` | `boolean` | Read by Customer 360 when the column is present. | `false` |
| `created_at` | `timestamptz` | Created. | `2026-10-01T08:00:00.000Z` |
| `updated_at` | `timestamptz` | Contact list order. | `2026-10-08T09:00:00.000Z` |

### `cdp.identity_keys`

Emails and phones. Unique on `(organization_id, key_type, key_value)`. Oldest row of a type is the primary. A profile with no key is unreachable in CRM.

| Column | Type | Sample |
|---|---|---|
| `identity_id` | text | `idk_example_email_01` |
| `cdp_id` | text | `CDP-crm-org1000-example` |
| `organization_id` | bigint | `1000` |
| `key_type` | varchar(64) | `email` |
| `key_value` | varchar(255) | `ada@example.com` |
| `source_system` | varchar(255) | `crm` |
| `confidence_score` | numeric(5,4) | `1.0` |
| `verified` | boolean | `false` |
| `custom_fields` | jsonb | `{}` |
| `created_at` | timestamptz | `2026-10-01T08:00:00.000Z` |

`key_type` values CRM writes: `email`, `phone`, `email_secondary`, `phone_secondary`. Email is stored lowercased and trimmed. Phone is trimmed.

### Customer 360 tables

Read only, joined on `organization_id` and `cdp_id`. CRM does not own the columns. These are the columns the Insights query selects.

| Table | Columns CRM selects | Sample |
|---|---|---|
| `cdp.customer_scores` | `churn_score`, `loyalty_score`, `value_score`, `purchase_probability`, `retention_score`, `advocacy_score`, `web_engagement_score`, `predicted_ltv`, `next_purchase_days`, `updated_at` | churn_score `0.12` |
| `cdp.customer_metrics` | `metric_date`, `session_count`, `total_page_views`, `avg_session_duration`, `bounce_rate`, `avg_scroll_depth`, `conversion_count`, `last_seen_days` | session_count `4` |
| `cdp.gold_customer_metrics` | `journey_stage`, `total_orders`, `total_spend`, `avg_order_value`, `last_purchase_at`, `updated_at` | journey_stage `consideration` |
| `cdp.orders` | `order_id`, `order_number`, `status`, `total_amount`, `currency`, `payment_status`, `fulfillment_status`, `created_at` | order_number `SO-1001` |
| `cdp.order_items` | `order_item_id`, `order_id`, `organization_id`, `product_id`, `quantity`, `unit_price` | quantity `1` |
| `cdp.customer_events` | `event_name`, `channel`, `page_path`, `amount`, `occurred_at`, `utm_source`, `utm_medium`, `utm_campaign`, `device_type`, `country`, `properties_json` | event_name `page_view` |
| `cdp.ai_insights` | `insight_type`, `score`, `summary`, `explanation`, `generated_at` | insight_type `attrition_risk` |
| `cdp.customer_recommendations` | `recommendation_type`, `recommendation`, `confidence`, `generated_at` | recommendation_type `product_affinity` |
| `cdp.nba_nbo` | `nba_action`, `updated_at` | nba_action `Book a discovery call` |
| `cdp.customer_segments` | assignment rows joined to `cdp.segment_definitions` | — |
| `cdp.segment_definitions` | `segment_name` | `High intent` |

Insight types Customer 360 keeps: `attrition_risk`, `conversion_likelihood`, `future_value`, `product_affinity`, `next_purchase_timing`.

Ticket rows are not a separate table. They are `cdp.customer_events` whose `event_name` starts with `ticketing.ticket` and whose `properties_json` has `ticket_id`, `ticket_number`, `subject`, `channel`, `category`, `priority`, `assignee_name`, `due_at`, `resolved_at`, `csat_score`, `ai_summary`.

### `cdp.products`

Worktual CDP product registry (`product_id` bigint). Not the CRM Product module and not quote `product_id`. Those use `inventory.products`.

## JSON and customizable fields

### `cdp.customer_profile.custom_fields`

| Key | Type | Meaning |
|---|---|---|
| `title` | string | Job title |
| `industry` | string | Employer industry |
| `company_domain` | string | Employer domain |
| `address_line` | string | Street address |
| `omniChannelSummary` | string | Contact-centre paragraph. Read only. Lead scoring and summaries hash it. |

Voice nurture also copies these keys into the call `data` object when present: `preferred_channel`, `lifecycle_event`, `payment_reference`, `product`, `language`.

```json
{
  "title": "Founder",
  "industry": "Retail",
  "company_domain": "meesho.example",
  "address_line": "12 Anna Salai",
  "omniChannelSummary": "Asked about a product demo on WhatsApp."
}
```

### `crm.contact_profiles.custom_attributes` and company custom attributes

Industry field pack. Keys are allowed only for the pack mapped from `accounts.organizations.industry_type`. Unknown keys are dropped. `general` has no extra keys.

| Pack | Key | Type | Entity |
|---|---|---|---|
| ecommerce | `loyalty_tier` | string | contact |
| ecommerce | `preferred_channel` | string | contact |
| healthcare | `patient_ref` | string | contact |
| healthcare | `consent_marketing` | boolean | contact |
| finance | `kyc_status` | string | contact |
| finance | `risk_band` | string | contact |
| telecom | `msisdn` | string | contact |
| telecom | `plan_code` | string | contact |

```json
{"loyalty_tier":"Gold","preferred_channel":"App"}
```

### `crm.organization_profiles.vertical_config`

Optional JSON overrides for the field pack. Industry itself stays on `accounts.organizations.industry_type`. `vertical` on this row is the enum `general`, `ecommerce`, `healthcare`, `finance`, `telecom`.

### `crm.org_assignment_settings.lead_icp`

```json
{
  "targetIndustries": [
    "software",
    "retail"
  ],
  "adjacentIndustries": [
    "logistics"
  ],
  "sizeTiers": [
    "51-200"
  ],
  "serviceableGeos": [
    "India"
  ]
}
```

### `crm.org_assignment_settings.followup_policy`

```json
{
  "hot": {
    "remindMinutes": 5,
    "managerMinutes": 15,
    "adminMinutes": 30
  },
  "warm": {
    "remindMinutes": 30,
    "managerMinutes": 120,
    "adminMinutes": 240
  },
  "cold": {
    "remind": "end_of_working_day",
    "manager": "next_working_day",
    "admin": "two_working_days"
  }
}
```

### `crm.org_finance_settings` JSON

`payment_routing_rules`:

```json
{
  "defaultProvider": "razorpay",
  "rules": [
    {
      "currency": "INR",
      "offlineOnlyAbove": 500000,
      "allowedProviders": [
        "razorpay"
      ]
    }
  ]
}
```

`bank_details`: `accountName`, `bankName`, `accountNumber`, `ifsc`, `iban`, `swift`, `routingNumber`, `notes`.

`revenue_forecast_last_run`: `hasTarget`, `narrative`, `atRiskInvoiceIds`, `gapScenario`, `source`.

Gateway secrets are not JSON. They are encrypted text columns: `stripe_secret_key_enc`, `stripe_webhook_secret_enc`, `razorpay_key_secret_enc`, `razorpay_webhook_secret_enc`.

### `inventory.products` JSON

| Column | Shape |
|---|---|
| `gallery_urls` | JSON array of image URL strings |
| `pricing_tiers` | Legacy volume tiers. Prefer `crm.product_addons` for customizable pricing. |
| `custom_attributes` | Non-pricing labels. Not used in quote math. |

`product_type` is `fixed` or `customizable`. `billing_type` is `one_time` or `recurring`. `billing_frequency` is `monthly`, `quarterly`, or `annual`. `unit_of_measure` is `per_seat`, `per_agent`, `per_ticket`, or `flat`. `status` is `draft`, `active`, or `archived`.

### `crm.product_addons`

`pricing_model`: `flat`, `tiered`, `per_seat`, `usage`. `meter_key` for usage: values in the `AddonMeterKey` enum. Tier rows live in `crm.product_addon_tiers` (`from_qty`, `to_qty`, `unit_amount`).

### Document JSON (`sections`, `blueprint`, `assets`)

Used on proposal, quote, and invoice templates and on the documents themselves.

| Key | Meaning |
|---|---|
| `sections` | Ordered document sections the renderer draws |
| `blueprint` | Layout / structure the generator fills |
| `assets` | Images and files referenced by the document |
| `document_sections` | Quote/invoice copy of the rendered sections |

Proposal generation also stores JSON snapshots on `crm.proposal_generation_runs`: `input_json`, `requirement_profile`, `kb_snapshot`, `catalog_snapshot`, `deal_plan`, `outline`, `pricing_snapshot`, `pricing_issues`, `deal_brief`, `qa_report`, `error`. Each leaf in `crm.proposal_generation_leaves` has `output_json`.

Playbooks (`crm.proposal_playbooks`) store `tags_json`, `sections_json`, `section_library_json`, `blueprint`, `assets`.

### Agent and job JSON

| Column | Keys the app writes |
|---|---|
| `crm.lead_nurture_jobs.result_summary` | `body`, `goal`, `brief`, `score`, `source`, `subject`, `rationale`, `sessionId`, `transport` (`voice_auto_bot`, `campaign`, `campaign_automation`, `fallback`), `campaignName`, `voiceInstruction`, `callTouchEligibleAt`, `runId` |
| `crm.lead_scoring_jobs.result_summary` / `factors` | Score breakdown the scoring job stored |
| `crm.lead_lifecycle_jobs.result_summary` | Lifecycle decision payload |
| `crm.email_auto_reply_jobs.result_summary` | Auto-reply outcome |
| `crm.lead_summaries.flags` | Includes `omniHash` (md5 of `custom_fields.omniChannelSummary`) |
| `crm.notifications.metadata` | `score`, `rationale`, `transport`, `runId`, `sessionId`, `subject` on nurture notices |
| `crm.audit_logs.meta` | Action-specific extra |
| `crm.report_snapshots.payload` | Frozen report body |
| `crm.domain_enrichment_cache.payload` | Provider enrichment blob |
| `crm.payment_gateway_events.payload` | Raw gateway event |
| `crm.agent_memories.slot_value` | Memory slot JSON |
| `crm.a2a_spoke_tasks.receipt` | A2A task receipt |
| `crm.appointments.guest_emails` | JSON array of guest email strings |
| `crm.meeting_analyses.objections_raised` / `evidence` | JSON arrays |
| `crm.coaching_insights.strengths` / `growth_areas` | JSON arrays |
| `crm.daily_briefings.items` | JSON array of briefing items |

### `crm.invoices.tax_details`

Tax breakdown stored with the invoice. Line kind is `product` or `addon`. Billing kind is the `InvoiceBillingKind` enum (`standard`, subscription, renewal, and related values in Prisma).

## Sample CRM rows

These show how the four schemas join. They are not a seed script.

```json
{
  "cdp.customer_profile": {
    "cdp_id": "CDP-crm-org1000-example",
    "organization_id": "1000",
    "first_name": "Ada",
    "last_name": "Lovelace",
    "company": "Analytical Engines",
    "city": "Chennai",
    "country": "India",
    "contact_type": "contact",
    "custom_fields": {
      "title": "Founder",
      "industry": "Software",
      "company_domain": "analytical.example"
    }
  },
  "cdp.identity_keys": {
    "cdp_id": "CDP-crm-org1000-example",
    "key_type": "email",
    "key_value": "ada@analytical.example",
    "source_system": "crm",
    "verified": false
  },
  "crm.contact_profiles": {
    "id": "cksample0001contact01",
    "account_contact_id": "CDP-crm-org1000-example",
    "organization_id": "1000",
    "owner_user_id": "1015",
    "lead_status": "new",
    "crm_status": "active",
    "bant_budget": null,
    "tags": [],
    "marketing_opt_out": false,
    "custom_attributes": {}
  },
  "crm.companies": {
    "id": "cksample0001company01",
    "organization_id": "1000",
    "name": "Analytical Engines",
    "domain": "analytical.example",
    "owner_user_id": "1015"
  },
  "inventory.products": {
    "id": "cksample0001product01",
    "organization_id": "1000",
    "name": "Support platform",
    "sku": "SUP-001",
    "price": "1500.00",
    "currency": "INR",
    "status": "active",
    "product_type": "fixed",
    "billing_type": "one_time"
  }
}
```

## Migrations

CRM schema changes are Prisma migrations in `prisma/migrations/`. Apply them only to the CRM schema. Do not add a migration that alters `cdp`, `accounts`, or `inventory` except the two approved exceptions named above.
