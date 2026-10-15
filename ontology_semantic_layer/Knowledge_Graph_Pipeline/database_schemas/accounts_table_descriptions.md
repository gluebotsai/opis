# My Accounts — tables and columns (plain language)

This file explains **what each My Accounts table stores** and **what each column means**, in simple words.

- Live schema source: SQL under [`backend/database/`](backend/database/) and [`backend/database/v2/`](backend/database/v2/).
- Flows and “which action writes which table”: [`knowledge.md`](knowledge.md) §8–§9.
- After v2, most tables live in schema **`accounts`**. Staff/pricing/mail live in **`platform`**. Product apps use **`crm` / `cdp` / …**. Search path is `accounts, platform, public`.

**How to read this file**

- **`id`** — unique row id (UUID unless noted).
- **`organization_id`** — which customer company this row belongs to.
- **`created_at` / `updated_at`** — when the row was created / last changed.
- **`status`** — life of the row (active, pending, paid, …). Exact values depend on the table.
- Encrypted columns (`*_encrypted`) hold secrets. Do not copy them into docs or chat.

---

## 1. How the database is split

| Schema | In simple words |
|--------|-----------------|
| **`accounts`** | One customer company (org), its sales deal, quotes, payments, subscriptions, customer login, and Setup Workspace. |
| **`platform`** | Worktual staff, price lists, email sending, partners, resellers. |
| **`crm` / `cvm` / `ticketing` / `ccass` / `cdp` / `campaign`** | Product-app starter tables (mostly empty stubs except `cdp.contacts`). |
| **`public`** | A few leftovers (invoice company bank details, number inventory). |

**Two org keys**

| Column | Meaning |
|--------|---------|
| `organizations.id` | Real UUID used by products, file paths, search, Setup Workspace. |
| `organizations.tenant_id` / `leads.tenant_id` | Short human code (for display). Do **not** use this as the product tenancy key. |

---

## 2. Company (the customer)

### `accounts.organizations`

One **customer company** after a deal is paid (or a prospect org is created). This is the root of almost everything.

| Column | Meaning |
|--------|---------|
| `id` | Company id (UUID). Use this everywhere. |
| `source_lead_id` | The sales lead this company came from. |
| `tenant_id` | Short company code. |
| `company_name` | Legal / display name. |
| `industry_type` | Industry (IT, bank, …). |
| `business_type` | B2B / B2C style (copied from the lead). |
| `contact_name` | Main person name. |
| `designation` | Their job title. |
| `work_email` | Work email. |
| `admin_email` | Admin / portal email. |
| `tax_number` | GST / tax id. |
| `billing_address` | Billing street address. |
| `website_url` | Website. |
| `country` | Country. |
| `company_size` | How big the company is. |
| `mobile_country_code` | Phone country code (`+91`). |
| `mobile_number` | Phone number. |
| `lifecycle_status` | Usually `active`. |
| `converted_at` | When the lead became this company. |
| `reseller_id` | If a reseller owns this customer. |

### `accounts.organization_locations`

Offices / branches of the company (after conversion).

| Column | Meaning |
|--------|---------|
| `id` | Location code inside the org (with `organization_id` is the key). |
| `organization_id` | Parent company. |
| `label` | Name of the branch (HQ, Chennai, …). |
| `address` | Street address. |
| `country` | Country. |
| `tax_number` | Tax id for this site. |
| `contact_name` / `designation` / `work_email` | Local contact. |
| `industry_type` | Industry at this site. |
| `mobile_*` / `secondary_mobile_*` | Phones. |
| `is_primary` | Main / HQ location. |
| `status` | `active` or dropped. |
| `inactivated_at` / `inactivated_by` / `inactivation_reason` | When/why it was turned off. |
| `scheduled_drop_*` | Future drop of this branch. |

---

## 3. Sales leads and quotes

### `accounts.leads`

A **sales opportunity** before / while quoting.

| Column | Meaning |
|--------|---------|
| `id` | Lead id. |
| `tenant_id` | Short code for this deal. |
| `company_name` | Company they typed in. |
| `industry_type` / `business_type` / `company_size` | Company profile. |
| `contact_name` / `designation` | Who we talk to. |
| `work_email` / `admin_email` | Emails. |
| `tax_number` / `billing_address` / `website_url` | Billing facts. |
| `country` / `state` | Place. |
| `is_decision_maker` / `decision_maker_name` | Who signs. |
| `mobile_*` / `secondary_mobile_*` | Phones. |
| `status` | Sales stage (`New`, `In Progress`, `Paid`, `Rejected`, …). |
| `is_active` | Soft on/off. |
| `product_draft` | Draft product config (JSON). |
| `assigned_user_id` | Sales person currently owning it. |
| `created_by_user_id` | Who created the lead. |
| `assigned_at` | When it was last assigned. |
| `lead_kind` | `standard` or special kinds. |
| `converted_organization_id` / `converted_at` | Link after it becomes an org. |
| `organization_id` | Org id when already linked. |
| `partner_id` / `reseller_id` | Who referred / bills this lead. |

### `accounts.lead_assignments`

History of “this lead moved from salesperson A to B”.

| Column | Meaning |
|--------|---------|
| `lead_id` | Which lead. |
| `from_user_id` / `to_user_id` | Old and new owner. |
| `assigned_by_user_id` | Who did the assign. |
| `reason` | Why it moved. |

### `accounts.additional_addresses`

Extra addresses on a lead (not the main HQ).

| Column | Meaning |
|--------|---------|
| `lead_id` | Parent lead. |
| `label` | Name of this address. |
| `address` / `country` / `state` / `tax_number` | Location + tax. |
| Rest | Same style of contact fields as the lead. |

### `accounts.branches`

Quote-time branch list on the **lead** (before org locations).

| Column | Meaning |
|--------|---------|
| `id` | Branch code on this lead. |
| `lead_id` | Parent lead. |
| `label` / `address` / `country` / `state` / `tax_number` | Branch facts. |
| `is_primary` | HQ / first branch. |

### `accounts.quote_sessions`

Unsaved / in-progress quote while sales is still editing.

| Column | Meaning |
|--------|---------|
| `lead_id` | One draft per lead. |
| `lead_snapshot` | Copy of lead fields at draft time. |
| `file_name` / `pdf_base64` | Draft PDF. |
| `assignments` / `product_summary` / `invoices` / `branch_summary` | Draft quote JSON. |
| `invoice_mode` | How invoices are split. |

### `accounts.quotations`

A **submitted** quote (finance can approve / reject).

| Column | Meaning |
|--------|---------|
| `lead_id` | Which deal. |
| `lead_snapshot` | Frozen lead details. |
| `file_name` / `pdf_base64` | Quote PDF. |
| `invoice_mode` / `branch_summary` | How billing is split. |
| `subtotal` / `grand_total` / `currency` / `gst_rate` | Money. |
| `status` | `Pending Finance Review` → `Approved` → `Paid` or `Rejected`. |
| `finance_note` | Finance comment. |
| `submitted_by` / `submitted_at` | Who sent it. |
| `reviewed_by` / `reviewed_at` | Who approved/rejected. |
| `version` | Quote version number. |
| `submission_batch_id` | Group of quotes sent together. |
| `source_product_request_id` | If this quote came from “request new product”. |
| `billing_phase` | Normal vs implementation / go-live billing. |
| `invoice_number` | Printed invoice number. |
| `organization_id` | Org when known. |

### `accounts.product_assignments`

Which **product** is sold on which **branch** on a quote.

| Column | Meaning |
|--------|---------|
| `quotation_id` / `lead_id` | Parent quote and lead. |
| `product_id` | Product key (`contact-center`, `crm`, …). |
| `branch_id` | Using location. |
| `billing_branch_id` | Who pays. |
| `change_type` | New, add-on, etc. |
| `config` | Seats, add-ons, prices (JSON). |

### `accounts.product_summary_items`

Human-readable lines shown on the quote summary.

| Column | Meaning |
|--------|---------|
| `quotation_id` | Parent quote. |
| `product_id` / `name` | Product. |
| `price_label` | Price text. |
| `branch_label` / `billing_label` | Where it is used / billed. |
| `change_type_label` | New / change text. |

### `accounts.quotation_invoices`

PDF invoice files attached to a quote (one per billing branch if split).

| Column | Meaning |
|--------|---------|
| `quotation_id` | Parent quote. |
| `file_name` / `pdf_base64` | Invoice file. |
| `billing_branch_id` / `branch_label` | Who this invoice is for. |
| `subtotal` / `grand_total` | Amounts. |

---

## 4. Payments

### `accounts.payments`

One payment record for a **whole quote** (single checkout).

| Column | Meaning |
|--------|---------|
| `quotation_id` | Which quote (one payment row per quote). |
| `provider` | `stripe` or `razorpay`. |
| `payment_link_url` / `payment_link_id` | Checkout link. |
| `subtotal` / `grand_total` / `currency` / `gst_rate` / `amount_label` | Amounts. |
| `status` | `pending`, `reported`, `paid`, `failed`, … |
| `paid_at` | When money landed. |
| `provider_payment_id` / `provider_customer_id` | Gateway ids. |
| `last_provider_event_id` | Last webhook we saw. |
| `failure_reason` | Why it failed. |
| `dry_run` | Test payment, not real money. |

### `accounts.quotation_branch_payments`

Payment **per billing branch** when the quote is split.

Same idea as `payments`, plus:

| Column | Meaning |
|--------|---------|
| `billing_branch_id` / `branch_label` | Which branch pays. |
| `payment_reported_at` / `payment_reported_by` | Customer said “I paid” (UTR). |
| `finance_confirmed_at` / `finance_confirmed_by` | Finance marked paid. |

### `accounts.payment_webhook_events`

Raw Stripe / Razorpay events (so we do not process the same event twice).

| Column | Meaning |
|--------|---------|
| `provider` + `event_id` | Unique event. |
| `event_type` | What happened. |
| `quotation_id` | Quote we matched. |
| `payload` | Full webhook JSON. |
| `processed_at` | When we handled it. |

### `accounts.active_products`

Products that became “live” on a lead after pay (fulfillment snapshot).

| Column | Meaning |
|--------|---------|
| `key` | Unique string for this product+branch. |
| `lead_id` / `product_id` / `branch_id` / `billing_branch_id` | What was bought. |
| `change_type` / `config` / `price_label` | Config snapshot. |
| `implementation_purchased` | Paid for implementation help. |
| `quotation_id` | Source quote. |
| `approved_at` / `payment_confirmed_at` | When finance / pay completed. |

---

## 5. Subscriptions, usage, go-live

### `accounts.subscriptions`

A **live product** for an org + location after payment.

| Column | Meaning |
|--------|---------|
| `key` | Unique subscription key. |
| `organization_id` / `source_lead_id` | Who owns it. |
| `product_id` / `branch_id` / `billing_branch_id` | What and where. |
| `status` | `active`, cancelled, … |
| `change_type` | New vs change. |
| `entitlement_config` | What they are allowed to use (JSON). |
| `price_label` / `mrr` | Price / monthly revenue. |
| `implementation_purchased` | Implementation sold. |
| `starts_at` / `renews_at` | Service dates. |
| `approved_at` / `payment_confirmed_at` | When it went live. |
| `quotation_id` / `source_purchase_order_id` | Source papers. |
| `cancelled_*` / `cancel_at_period_end` / `cancel_effective_at` | Cancel plan. |
| `scheduled_cancellation_request_id` | Linked cancel request. |

### `accounts.subscription_entitlements`

History of entitlement JSON (what seats/modules they have).

| Column | Meaning |
|--------|---------|
| `subscription_id` | Parent subscription. |
| `schema_version` | Shape version of `config`. |
| `config` | Entitlement JSON. |
| `change_type` | Why this version exists. |
| `effective_from` | When it starts. |
| `purchase_order_id` | Which paid order created it. |

### `accounts.purchase_orders`

One paid quote → one purchase order.

| Column | Meaning |
|--------|---------|
| `organization_id` / `lead_id` / `quotation_id` | Who and which quote. |
| `status` | Usually `paid`. |
| `paid_at` | Pay time. |

### `accounts.subscription_items`

Lines on a purchase order (each product/branch).

| Column | Meaning |
|--------|---------|
| `purchase_order_id` | Parent order. |
| `subscription_id` | Live subscription created from this line. |
| `product_id` / `branch_id` / `change_type` | What was bought. |
| `config_snapshot` | Config at purchase time. |

### `accounts.usage_metrics`

Current period usage (minutes, seats used, …).

| Column | Meaning |
|--------|---------|
| `subscription_id` | Which subscription. |
| `metric_key` | What we measure. |
| `allocated` / `consumed` | Allowed vs used. |
| `unit` | Unit name. |
| `period_start` / `period_end` | Billing window. |

### `accounts.usage_metrics_monthly`

Closed month snapshot of usage.

| Column | Meaning |
|--------|---------|
| `subscription_id` / `organization_id` / `product_id` / `branch_id` | Who. |
| `year_month` | `YYYY-MM`. |
| `metric_key` / `allocated` / `consumed` / `unit` | Same as live usage. |
| `snapshot` | Extra JSON. |
| `closed_at` | When we froze the month. |

### `accounts.product_go_live`

Implementation / UAT / go-live tracker per product + branch.

| Column | Meaning |
|--------|---------|
| `organization_id` / `lead_id` | Customer and original deal. |
| `product_id` / `branch_id` / `billing_branch_id` | What is going live. |
| `lifecycle_status` | Stage (`awaiting_implementation`, UAT, live, …). |
| `otc_quotation_id` | One-time implementation quote. |
| `go_live_quotation_id` | Recurring / go-live quote. |
| `subscription_id` | Live subscription when ready. |
| `uat_expires_at` / `uat_extended_count` | UAT clock. |
| `uat_credentials` | Test login JSON (sensitive). |
| `change_request_note` | Customer change note. |
| `accepted_at` / `go_live_paid_at` | Accept / paid timestamps. |

### `accounts.renewal_events`

A reminder that a subscription must renew.

| Column | Meaning |
|--------|---------|
| `subscription_id` | Which subscription. |
| `due_at` | When renewal is due. |
| `status` | `scheduled`, done, … |
| `renewal_quotation_id` | Renewal quote if created. |

### `accounts.subscription_invoices`

Split invoices for a subscription period (sequence 1 or 2).

| Column | Meaning |
|--------|---------|
| `subscription_id` | Parent. |
| `sequence` | `1` or `2`. |
| `invoice_type` | Kind of invoice. |
| `generation_date` / `status` | When generated / state. |
| `service_period_start` / `service_period_end` | Dates covered. |
| `remaining_days` | Days left in period. |
| `monthly_price` / `subtotal` / `gst_rate` / `grand_total` | Money. |

---

## 6. Customer portal

### `accounts.customer_users`

People who log into the **customer** portal (not Setup Workspace agents).

| Column | Meaning |
|--------|---------|
| `organization_id` | Their company. |
| `email` / `password_hash` | Login. |
| `display_name` | Name shown in UI. |
| `role` | Usually `org_admin`. |
| `branch_id` | Optional branch scope. |
| `is_active` | Can they log in. |
| `must_change_password` | Force password change. |

### `accounts.customer_auth_sessions`

Logged-in customer sessions.

| Column | Meaning |
|--------|---------|
| `token` | Session cookie/token. |
| `customer_user_id` / `organization_id` / `email` | Who. |
| `expires_at` | When it dies. |

### `accounts.product_access_grants`

Which customer user may open which subscription.

| Column | Meaning |
|--------|---------|
| `customer_user_id` | Portal user. |
| `subscription_id` | Product they can see. |
| `role` | Access role. |

### `accounts.support_tickets` / `accounts.support_ticket_messages`

Customer support tickets and replies.

| Column (ticket) | Meaning |
|-----------------|---------|
| `ticket_number` | Human number. |
| `organization_id` / `customer_user_id` | Who raised it. |
| `subscription_id` / `product_id` / `product_label` | Related product. |
| `category` / `priority` / `subject` / `description` | Ticket body. |
| `status` | `open`, resolved, … |
| `unable_to_use` / `started_after_change` | Extra flags. |
| `tenant_id` / `company_name` / `contact_email` | Snapshot for staff. |
| `resolved_at` | When closed. |

| Column (message) | Meaning |
|------------------|---------|
| `ticket_id` | Parent ticket. |
| `author_type` / `author_label` | Customer vs staff. |
| `body` | Message text. |

### `accounts.customer_product_requests`

“Please sell us another product” from the customer portal.

| Column | Meaning |
|--------|---------|
| `request_number` | Human number. |
| `organization_id` / `customer_user_id` / `source_lead_id` | Who asked. |
| `request_type` / `status` | Kind and state. |
| `assignments` / `product_summary` / `branch_summary` / `new_branches` | What they want (JSON). |
| `customer_note` | Free text. |

### `accounts.branch_cancellation_requests`

Ask to drop a branch or a product on a branch.

| Column | Meaning |
|--------|---------|
| `request_number` | Human number. |
| `organization_id` / `customer_user_id` / `source_lead_id` | Who. |
| `request_kind` | Branch vs product cancel. |
| `branch_id` / `product_id` / `subscription_id` | What to cancel. |
| `status` | Workflow state. |
| `trigger_source` | Customer vs admin. |
| `grace_deadline_at` | Last day to keep it. |
| `related_quotation_id` | Linked quote. |
| `customer_note` / `admin_note` | Comments. |
| `effective_timing` / `effective_at` | When it actually stops. |
| `resolved_at` / `resolved_by` | Close info. |

### `accounts.branch_cancellation_alerts`

Reminders that a cancel grace period is ending.

### `accounts.branch_add_requests`

Ask to add a new branch (payload is JSON).

---

## 7. Setup Workspace (onboarding)

These are the tables the customer fills after they buy products.

### Holidays and hours

#### `accounts.setup_holiday_calendars`

A named holiday list (e.g. “India 2026”).

| Column | Meaning |
|--------|---------|
| `organization_id` | Company. |
| `name` | Calendar name. |
| `country` | Country this list is for. |

#### `accounts.setup_holidays`

One holiday date on a calendar.

| Column | Meaning |
|--------|---------|
| `calendar_id` | Parent calendar. |
| `name` | Holiday name. |
| `holiday_date` | The date. |

#### `accounts.setup_business_hours`

When the company / team is open.

| Column | Meaning |
|--------|---------|
| `organization_id` | Company. |
| `name` / `description` | Label. |
| `timezone` | Time zone name. |
| `holiday_calendar_id` | Which holidays apply. |
| `status` | `active` or not. |
| `open_time` / `close_time` | Same hours every day (when `timing_mode` is `same`). |
| `working_days` | Which weekdays (JSON). |
| `timing_mode` | `same` vs different hours per day. |
| `day_timings` | Per-day hours (JSON). |

#### `accounts.setup_business_hour_shifts`

One shift row (start/end, optional breaks).

| Column | Meaning |
|--------|---------|
| `business_hours_id` | Parent hours. |
| `shift_type` | Regular / other. |
| `day_of_week` / `end_day_of_week` | Days covered. |
| `start_time` / `end_time` | Shift times. |
| `crosses_midnight` | Overnight shift. |
| `break_*` | Break windows. |

### People, teams, roles

#### `accounts.setup_teams`

A team of agents.

| Column | Meaning |
|--------|---------|
| `organization_id` | Company. |
| `name` / `description` | Team name. |
| `business_hours_id` | Hours this team follows. |
| `available_products` | Products this team works on (JSON list). |
| `status` | `active`. |
| `member_ids` | Member user ids (JSON). |

#### `accounts.setup_roles`

Permission pack for a product.

| Column | Meaning |
|--------|---------|
| `organization_id` | Company. |
| `name` / `description` | Role name. |
| `product_id` | Which product this role is for. |
| `accessible_products` | Extra product list (JSON). |
| `module_permission` / `module_permissions` | Old + new module rights. |
| `can_view` / `can_create` / `can_edit` / `can_delete` / `can_export` / `can_approve` | Simple flags. |

#### `accounts.setup_users`

An employee / agent in Setup Workspace (not the same as `customer_users`).

| Column | Meaning |
|--------|---------|
| `organization_id` | Company. |
| `employee_id` | Staff id (unique per org). |
| `first_name` / `last_name` | Name. |
| `work_email` | Login / invite email (unique globally). |
| `mobile_number` | Phone (unique digits per org). |
| `primary_language` / `secondary_language` | Languages. |
| `skills` | Skills list (JSON). |
| `city` / `state` / `country` | Region. |
| `location_id` | Branch / site code. |
| `status` | `active`. |
| `team_id` | Team. |
| `business_hours_id` | Their hours. |
| `shift_types` | Shifts they work (JSON). |
| `password_hash` | Password after invite. |
| `invite_status` | Invite pending / accepted. |
| `password_set_at` / `invited_at` | Invite timeline. |

#### `accounts.setup_user_invite_tokens`

One-time link to set a password.

| Column | Meaning |
|--------|---------|
| `organization_id` / `user_id` | Who was invited. |
| `token_hash` | Hashed token (not the raw link). |
| `expires_at` / `used_at` | Validity. |
| `created_by` | Who sent the invite. |

#### `accounts.setup_user_product_access`

Which product + role a setup user has.

| Column | Meaning |
|--------|---------|
| `user_id` | Setup user. |
| `product_id` | Product key. |
| `role_id` | Role they get on that product. |

### Channels

#### `accounts.setup_channel_configs`

Parent row for a channel (email, webchat, social, voice).

| Column | Meaning |
|--------|---------|
| `organization_id` | Company. |
| `channel_type` | `email`, `webchat`, `social`, `voice`, … |
| `name` | Display name. |
| `status` | `pending` / connected / … |
| `product_ids` | Which purchased products use it (JSON). |

#### `accounts.setup_email_configs`

Email settings for one channel.

| Column | Meaning |
|--------|---------|
| `channel_config_id` | Parent channel (one email config each). |
| `provider_type` | Hosted, SMTP, OAuth, … |
| `third_party_mode` | Extra mode. |
| `sender_email` / `sender_name` / `reply_to` | From-line. |
| `domain` / `domain_verification_*` | Domain prove. |
| `smtp_*` / `imap_*` | Server settings. |
| `*_encrypted` | Saved passwords (secret). |
| `oauth_connection_id` / `oauth_provider` | Microsoft/Google OAuth. |
| `requested_local_part` / `hosted_domain` / `provisioning_status` | Hosted mailbox. |
| `ccaas_handler` | How Contact Center handles mail. |
| `is_bot` | Bot mailbox vs human. |

#### `accounts.setup_webchat_configs`

Web chat widget for Contact Center.

| Column | Meaning |
|--------|---------|
| `channel_config_id` | Parent channel. |
| `webchat_id` | Public widget id. |
| `title` / `alias_title` / `description` | Widget text. |
| `greeting_message` / `trigger_message` | What the widget says. |
| `personalisation` | Colors / extras (JSON). |

#### `accounts.setup_social_configs`

WhatsApp / Instagram / Facebook connection.

| Column | Meaning |
|--------|---------|
| `channel_config_id` | Parent channel. |
| `provider` | `whatsapp`, `instagram`, `facebook`. |
| `bot_enabled` | Bot on or off. |
| `usage_mode` | `inbox` or `templates`. |
| `display_number` | Number shown. |
| `access_token_encrypted` / `token_expires_at` | Meta token (secret). |
| `meta_user_*` / `waba_id` / `phone_number_id` / `page_id` | Meta ids. |
| `ig_*` | Instagram account ids. |
| `meta_auth_type` / `meta_app_id` / `granted_scopes` | How they logged in. |
| `meta_connected_at` / `meta_connection_status` | Connection state. |

#### `accounts.setup_ccaas_queues`

A Contact Center queue.

| Column | Meaning |
|--------|---------|
| `organization_id` | Company. |
| `name` / `description` | Queue name. |
| `team_id` | Team that owns it. |
| `status` | `active`. |

#### `accounts.setup_ccaas_queue_agents`

Which setup user sits in a queue, and what they handle.

| Column | Meaning |
|--------|---------|
| `queue_id` / `user_id` | Queue and agent (one queue seat per user). |
| `handles_calls` / `handles_email` / `handles_social` / `handles_chat` | Channels. |
| `handles_whatsapp` / `handles_instagram` / `handles_facebook` | Social splits. |
| `*_concurrency` | How many chats they can take at once. |
| `call_type` | Inbound / outbound / both. |

#### `accounts.setup_crm_channel_agents`

Which setup users are attached to a **CRM** channel (email/social), not a CCaaS queue.

| Column | Meaning |
|--------|---------|
| `channel_config_id` | Channel. |
| `user_id` | Setup user. |

#### `accounts.setup_voice_prompt_profiles`

Voice IVR / prompt pack.

| Column | Meaning |
|--------|---------|
| `organization_id` | Company. |
| `name` / `description` | Profile name. |
| `status` | `active`. |
| `slots` | Prompt slots (JSON). |

#### `accounts.setup_voice_dids`

Phone numbers (DIDs) and where calls go.

| Column | Meaning |
|--------|---------|
| `organization_id` | Company. |
| `phone_number` | The number. |
| `product_id` | Usually `contact-center` or `crm`. |
| `routing_type` | User vs queue. |
| `routing_user_id` / `routing_queue_id` | Where to send the call. |
| `prompt_profile_id` | Which voice prompts. |
| `status` | `active`. |

#### `accounts.setup_app_connections`

Connected Apps OAuth (Google, etc.).

| Column | Meaning |
|--------|---------|
| `organization_id` | Company. |
| `app_key` | Which app (unique per org). |
| `provider` | Vendor. |
| `status` | `disconnected` / `connected` / `needs_reauth`. |
| `account_email` / `account_name` / `external_account_id` | Connected account. |
| `scopes` | Permissions granted. |
| `access_token_encrypted` / `refresh_token_encrypted` / `token_expires_at` | Secrets. |
| `metadata` | Extra JSON. |
| `connected_at` | When connected. |

### Knowledge Base

#### `accounts.setup_knowledge_documents`

Uploaded files (PDF, etc.).

| Column | Meaning |
|--------|---------|
| `organization_id` | Company. |
| `category` | `business`, `product`, or `customer_support`. |
| `product_id` | Which Worktual product the file is for (`crm`, `contact-center`, …). |
| `ccaas_audience` | For Contact Center only: `bot`, `agent_assist`, or `both`. |
| `file_name` / `file_type` / `file_size_bytes` | File info. |
| `storage_path` | Disk path under `{UPLOAD_BASE}/uploads/{organization_id}/{module}/`. |
| `all_branches` / `assigned_branch_ids` | Branch scope. |
| `uploaded_by` | Who uploaded. |

Chunks are **not** in Postgres. They go to Meilisearch via context_layer.

#### `accounts.setup_knowledge_org_profiles`

One row per company. LLM JSON extracted from product / business PDFs.

| Column | Meaning |
|--------|---------|
| `organization_id` | Company (primary key). |
| `product` | Product entities JSON (from product uploads). |
| `business` | Company contact JSON (from business uploads). |
| `updated_at` | Last extract time. |

---

## 8. Contacts (CDP)

### `cdp.contacts`

Shared org contacts (Setup Workspace contacts screen).

| Column | Meaning |
|--------|---------|
| `organization_id` | Company. |
| `first_name` / `last_name` | Name. |
| `primary_email` | Main email (unique per org). |
| `primary_phone` / `secondary_email` / `secondary_phone` | Extra contact. |
| `gender` / `date_of_birth` | Person facts. |
| `company` / `industry` / `department` / `company_size` | Work facts. |
| `life_cycle_stage` | Lead / customer / … |
| `city` / `region` / `country` / `language` / `timezone` | Place. |
| `source_system` | Where the contact came from. |
| `custom_fields` | Extra JSON. |
| `is_active` | Soft delete. |

---

## 9. Staff, partners, resellers (platform)

These tables sit in **`platform`** after the v2 move (same names).

### `platform.users`

Worktual **staff** (sales, finance, admin).

| Column | Meaning |
|--------|---------|
| `email` / `password` | Login. |
| `role` | `admin`, `sales`, `finance`, … |
| `display_name` / `phone` / `country` / `department` | Profile. |
| `mobile_country_code` / `mobile_number` | Phone. |
| `is_active` | Can they log in. |
| `created_by` / `updated_by` | Audit. |

### `platform.auth_sessions`

Staff login sessions (`token`, `user_id`, `expires_at`).

### `platform.password_reset_otps`

OTP for forgot-password (staff / customer / partner / reseller).

| Column | Meaning |
|--------|---------|
| `email` / `account_type` / `account_id` | Which account. |
| `otp_hash` / `reset_token_hash` | Hashed secrets. |
| `expires_at` / `attempts` / `consumed_at` | Limits. |

### `platform.pricing_catalogs`

Price book JSON (`regions`, `products`, `region_pricing`).

### `platform.products`

Registry of sellable Worktual products.

### `public.invoice_company_settings`

Worktual bank details and invoice number series (one `default` row).

### `platform.export_audit_logs`

Who exported a CSV/Excel and how many rows.

### Partners

| Table | What it is |
|-------|------------|
| `platform.partners` | Referral partner company. |
| `platform.partner_users` | Partner portal login. |
| `platform.partner_auth_sessions` | Partner sessions. |
| `platform.partner_bank_accounts` | Where to pay commission. |
| `platform.commission_slabs` | % rate by deal size and country. |
| `accounts.partner_commission_entries` | One commission per paid quote. |

**`partner_commission_entries` columns:** `partner_id`, `lead_id`, `quotation_id`, `deal_amount`, `rate_percent`, `commission_amount`, `status` (`pending` / paid), `payout_reference`.

### Resellers

| Table | What it is |
|-------|------------|
| `platform.resellers` | Billing reseller company (invoice emails, tax). |
| `platform.reseller_users` | Reseller portal login. |
| `platform.reseller_auth_sessions` | Reseller sessions. |

---

## 10. Mail (platform)

| Table | What it is |
|-------|------------|
| `mail_oauth_connections` | Microsoft mailbox OAuth tokens per account. |
| `mail_oauth_states` | Short-lived OAuth “state” during login. |
| `email_outbox` | Emails waiting to send (`job_type`, `to_email`, `status`). |
| `graph_mail_subscriptions` | Graph webhook subscriptions. |
| `mail_signatures` | HTML signature per mailbox. |

`mail_oauth_connections` important columns: `account_type` (internal / customer / …), `account_id`, `mailbox_profile`, `account_email`, encrypted tokens, `needs_reauth`.

---

## 11. Number management

Usually in `accounts` after tenancy move.

### `number_mappings`

A phone / DID assigned to a customer.

| Column | Meaning |
|--------|---------|
| `tenant_id` | Short tenant code. |
| `organization_id` / `lead_id` | Customer / deal. |
| `product_id` | Usually `contact-center`. |
| `number` | The phone number (unique). |
| `number_type` | DID type. |
| `agent_label` | Label. |
| `status` | `active`. |
| `notes` | Free text. |
| `mapped_at` | When assigned. |

### `available_numbers`

Pool of numbers **not** yet given to a customer.

### `agent_did_usage_monthly`

Monthly usage entered for a mapped number (`year_month`, `usage_value`, `usage_unit`).

---

## 12. Product stubs (almost empty)

Starter tables for other Worktual apps. Safe to ignore unless that product is live.

| Table | Meaning |
|-------|---------|
| `crm.accounts` | CRM company records. |
| `crm.contacts` | CRM people (`email`, `full_name`). |
| `cvm.value_scores` | Value score per profile. |
| `ticketing.tickets` | Ticketing product tickets (not My Accounts support). |
| `ccass.agents` | Contact-center product agents. |
| `cdp.profiles` | CDP profile stubs. |
| `campaign.campaigns` | Campaign drafts. |

---

## 13. Common “which table?” cheat sheet

| I need… | Look at |
|---------|---------|
| Company name / GST / website | `organizations` |
| Office list after go-live | `organization_locations` |
| Sales deal before pay | `leads` |
| Submitted quote | `quotations` |
| Money / checkout | `payments` or `quotation_branch_payments` |
| What they bought (live) | `subscriptions` |
| Implementation / UAT | `product_go_live` |
| Customer portal login | `customer_users` |
| Setup agents / teams / hours | `setup_users`, `setup_teams`, `setup_business_hours` |
| Email / WhatsApp / chat setup | `setup_channel_configs` + child config table |
| KB files | `setup_knowledge_documents` |
| Extracted company/product JSON | `setup_knowledge_org_profiles` |
| Shared contacts | `cdp.contacts` |
| Staff login | `platform.users` |

---

*Last updated: 2026-08-11. If a column is added in a new migration, update this file in the same change.*
