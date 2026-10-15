# Table schemas (crm, accounts, cdp, inventory)

Column-level reference for tables **this CRM actually uses** on the shared Worktual Postgres (`worktual_bigint`).

Sourced from live `information_schema` plus Prisma (`prisma/schema.prisma`) on 22 Aug 2026.

Related: [`crm-tables-reference.md`](./crm-tables-reference.md) (narrative) · [`cdp-customer-identity.md`](./cdp-customer-identity.md) · [`multi-tenancy-common-model.md`](./multi-tenancy-common-model.md) · [`bigint-ids.md`](./bigint-ids.md)

---

## Which schema for which data

Start here. Pick the **schema first**, then the table. Do not invent a parallel store (no `crm.contacts`, no `crm.products`, no `crm.users`).

| If you need… | Refer to | Do **not** use |
|---|---|---|
| A **person / contact** (name, company label, city, country, lifecycle `contact_type`) | **`cdp.customer_profile`** | `crm.contact_profiles` as the identity store; legacy `cdp.contacts` |
| A contact’s **email or phone** | **`cdp.identity_keys`** (`key_type` = `email` / `phone` / `*_secondary`) | Columns on `crm.contact_profiles` or `crm.deals.contact_email` as source of truth |
| CRM **sales overlay** on that person (owner, lead status, BANT, tags, nurture, opt-out) | **`crm.contact_profiles`** (`account_contact_id` = `cdp_id`) | New CDP columns for CRM fields |
| A **logged-in Worktual user** (rep, admin, finance) — login, name, password | **`accounts.setup_users`** | Creating a CRM users table |
| That user’s **CRM role** (admin, sales_rep, finance, …) | **`accounts.setup_user_product_access`** + **`accounts.setup_roles`** where `product_id = 'crm'` | Inferring role from `setup_users` alone |
| The **tenant / org** (seller company name, `b2b`/`b2c`/`b2b2c`, industry) | **`accounts.organizations`** | `crm.organization_profiles.vertical` as industry source of truth |
| Industry **field-pack config** (optional CRM overrides) | **`crm.organization_profiles`** | Writing `accounts.organizations.industry_type` from CRM |
| A **B2B account / franchise company** (customer company, not the tenant) | **`crm.companies`** (+ **`crm.company_locations`**) | `cdp.customer_profile.company` (that is a free-text label only) |
| A **sellable product** in the CRM Product module (SKU, price, stock, quotes) | **`inventory.products`** | `crm.products` (removed); `cdp.products` as the working catalog |
| Plans / addons / price lists on top of a catalog product | **`crm.product_offers`**, **`crm.product_addons`**, **`crm.price_books`** | Putting offer prices onto `inventory.products` as new columns |
| Worktual’s **CDP product registry** (separate bigint catalog) | **`cdp.products`** | Treating it as the CRM Product module store |
| **Deals / pipeline** | **`crm.deals`** | CDP or Accounts |
| **Inbox, emails, meetings, tasks** on a contact | **`crm.contact_activities`** (`contact_id` = `cdp_id`) | CDP event tables as the CRM inbox |
| **Rep mailbox OAuth** (Gmail/Calendar the salesperson connected) | **`crm.user_integration_connections`** | Accounts mail tables for *rep* mail |
| **Org CRM bot mailbox** (nurture / auto-reply From address) | **`accounts.setup_channel_configs`** + **`setup_email_configs`** + **`mail_oauth_connections`** | `crm.user_integration_connections` for the bot |
| **Quotes / proposals / orders / invoices / contracts** | matching **`crm.*`** tables | Finance tables in Accounts; `cdp.orders` |
| **Lead scoring, nurture, enrichment, summaries** | **`crm.lead_*`** job / snapshot tables | Writing scores onto CDP profile columns |
| **In-app notifications** | **`crm.notifications`** (`recipient_user_id` = `setup_users.id`) | Accounts notification tables |

### Schema in one sentence

| Schema | Holds | Typical question it answers |
|---|---|---|
| **`cdp`** | **Customers / people** as Worktual identity | “Who is this person? What is their email?” |
| **`accounts`** | **Our company** — tenant, employees, roles, org mailbox | “Which org is this? Who is logged in? What CRM role? Which bot mailbox?” |
| **`inventory`** | **What we sell** — the product catalog | “What products exist and at what list price?” |
| **`crm`** | **How we sell and follow up** — overlays, pipeline, documents, agents | “Who owns this lead? What deal/quote/invoice? What did the agent decide?” |

### Common mixes (join these; do not collapse them)

**Show a contact in the UI**

1. Person: `cdp.customer_profile` (`cdp_id`)
2. Email/phone: `cdp.identity_keys` (same `cdp_id`)
3. Owner / lead status / company link: `crm.contact_profiles` where `account_contact_id = cdp_id`
4. Linked B2B account (if any): `crm.companies` via `contact_profiles.company_id`

**Show a deal**

1. Opportunity: `crm.deals`
2. Account + site: `crm.companies` + `crm.company_locations`
3. Primary person: `cdp.customer_profile` via `deals.contact_id` (= `cdp_id`)
4. Owner user: `accounts.setup_users` via `deals.owner_user_id`

**Line on a quote / order / invoice**

1. Line: `crm.quote_lines` / `order_lines` / `invoice_lines`
2. Catalog row: `inventory.products` via `product_id`
3. Tenant: `accounts.organizations` via `organization_id`

**Assign or notify a sales rep**

1. User + login: `accounts.setup_users`
2. CRM role: `setup_user_product_access` + `setup_roles` (`product_id = 'crm'`)
3. Capacity / PTO / territory: `crm.sales_user_assignment_profiles`
4. Contact being assigned: `crm.contact_profiles.owner_user_id` + person in **CDP**

### Easy to get wrong

| Wrong assumption | Correct |
|---|---|
| “Contacts live in `crm`” | Identity is **CDP**. CRM only stores the overlay. |
| “`contact_id` is `contact_profiles.id`” | `contact_id` is almost always **`cdp_id` (text)**, not the overlay cuid. |
| “Products live in `crm` or `cdp`” | Working catalog is **`inventory.products`** for all motions. |
| “Users live in `crm`” | Users are **`accounts.setup_users`**. CRM stores only `*_user_id` bigints. |
| “`customer_profile.company` is the account” | That is a **string label**. The B2B account row is **`crm.companies`**. |
| “Industry is chosen in CRM Configuration” | Industry is **`accounts.organizations.industry_type`**. |
| “B2C has a different contacts table” | Same CDP + overlay tables. Motion is `organizations.business_type`. |

---

## Ownership

| Schema | CRM may | Notes |
|---|---|---|
| `crm` | DDL + DML | Prisma-managed. Product catalog is **not** here. |
| `inventory` | DML on existing columns | Catalog is `inventory.products` only. Ask inventory owners before new fields. |
| `cdp` | SELECT + DML on existing columns | Person identity. No CRM migrations. |
| `accounts` | SELECT + limited DML on existing columns | Auth, org, roles, CRM bot mailbox. No CRM migrations. |

`accounts` and `cdp` contain many other platform tables (CCAAS, campaigns, events, …). Those are **out of scope** here.

## How the four schemas connect

```text
accounts.organizations.id  ──organization_id──►  almost every crm.* / inventory.products / cdp row
accounts.setup_users.id    ──*_user_id────────►  owner, actor, assignee, approver, recipient
accounts.setup_roles
        ▲
        │ role_id
accounts.setup_user_product_access  (product_id = 'crm')
        │ user_id
        ▼
accounts.setup_users

cdp.customer_profile.cdp_id  =  crm.contact_profiles.account_contact_id
                             =  crm.*.contact_id  (activities, jobs, deals, orders)
cdp.identity_keys.cdp_id     →  emails / phones for that person

inventory.products.id        ←  crm quote/order/invoice lines, offers, addons, price-book entries
```

**People:** name/email/phone live in CDP. CRM stores sales overlays only.

**Users:** there is no FK from `crm` to `accounts`. The app enforces validity.

## ID conventions

| Column pattern | Type | Points to |
|---|---|---|
| `organization_id` | `bigint` | `accounts.organizations.id` |
| `*_user_id` | `bigint` | `accounts.setup_users.id` |
| `account_contact_id`, `contact_id` | `text` | `cdp.customer_profile.cdp_id` |
| CRM entity `id` | `text` (cuid) | That CRM table |
| `product_id` (CRM lines / offers) | `text` | `inventory.products.id` |
| `cdp.products.product_id` | `bigint` | CDP registry only — not the CRM catalog |

In raw SQL cast tenant/user ids: `$1::bigint`.


## `accounts` schema

**Refer here for:** the **tenant** (our company), **logged-in employees**, **CRM roles**, and the **org CRM bot mailbox**. Not for customers/contacts (those are CDP) and not for the product catalog (inventory).

Shared Worktual auth / org / mailbox schema. CRM **SELECT** (and limited DML on existing columns). **No CREATE / ALTER / DROP.**

### `accounts.organizations`

**Refer here for:** the **seller tenant** — `id` (every row’s `organization_id`), `business_type` (b2b / b2c / b2b2c), `industry_type`, `company_name` on letterhead. This is **not** a customer company; those are `crm.companies`.

Tenant organization created at Worktual signup. CRM reads `id`, `business_type`, `industry_type`, and `company_name`. CRM must not ALTER this table.

| Column | Type | Null | Default | Description |
|---|---|---|---|---|
| `tenant_id` | `varchar(16)` | required | — | Short tenant code used by other Worktual products (not the CRM FK). |
| `company_name` | `varchar(255)` | nullable | — | Seller / tenant display name (letterhead on quotes, proposals, invoices). |
| `industry_type` | `varchar(128)` | nullable | — | Signup industry text. CRM maps this to a field pack; do not treat `crm.organization_profiles.vertical` as source of truth. |
| `contact_name` | `varchar(255)` | nullable | — | Primary signup contact name. |
| `designation` | `varchar(128)` | nullable | — | Signup contact job title. |
| `work_email` | `varchar(255)` | nullable | — | Signup work email. |
| `admin_email` | `varchar(255)` | nullable | — | Admin notification email. |
| `tax_number` | `varchar(64)` | nullable | — | Tax / VAT / GST identifier for the tenant. |
| `billing_address` | `text` | nullable | — | Tenant billing address. |
| `website_url` | `varchar(512)` | nullable | — | Tenant website. |
| `country` | `varchar(128)` | nullable | — | Tenant country. |
| `company_size` | `varchar(64)` | nullable | — | Self-reported company size band. |
| `mobile_country_code` | `varchar(8)` | nullable | — | Signup mobile country code. |
| `mobile_number` | `varchar(32)` | nullable | — | Signup mobile number. |
| `lifecycle_status` | `varchar(32)` | required | 'active' | Org lifecycle (`active`, …). |
| `converted_at` | `timestamptz` | required | `now()` | When the org converted from lead/trial. |
| `created_at` | `timestamptz` | required | `now()` | Row creation timestamp. |
| `updated_at` | `timestamptz` | required | `now()` | Last update timestamp. |
| `business_type` | `varchar(64)` | nullable | — | Motion gate: `b2b`, `b2c`, or `b2b2c`. Controls CRM modules (B2C never gets Finance). |
| `support_portal_slug` | `varchar(63)` | nullable | — | Optional public support-portal slug. |
| `support_portal_enabled` | `boolean` | required | `false` | Whether the support portal is on. |
| `support_portal_welcome` | `text` | nullable | — | Support portal welcome copy. |
| `id` | `bigint` | required | — | Tenant primary key. Copied onto almost every CRM row as `organization_id`. |
| `reseller_id` | `bigint` | nullable | — | Optional reseller that sold this tenant. |
| `source_lead_id` | `bigint` | nullable | — | Optional originating Accounts lead. |

### `accounts.setup_users`

**Refer here for:** **employees who log into CRM** (name, `work_email`, password, status). Not customers — customers are CDP. CRM role is **not** on this row; join `setup_user_product_access` + `setup_roles`.

Worktual login users. Every CRM `*_user_id` column stores `setup_users.id` (bigint).

| Column | Type | Null | Default | Description |
|---|---|---|---|---|
| `employee_id` | `varchar(64)` | nullable | — | Optional HR / employee code. |
| `first_name` | `varchar(128)` | required | — | Given name. |
| `last_name` | `varchar(128)` | required | — | Family name. |
| `work_email` | `varchar(255)` | required | — | Login email (unique in practice). CRM auth looks up `lower(work_email)`. |
| `mobile_number` | `varchar(32)` | nullable | — | User mobile. |
| `primary_language` | `varchar(64)` | nullable | — | Preferred UI / comms language. |
| `secondary_language` | `varchar(64)` | nullable | — | Secondary language. |
| `location_id` | `varchar(128)` | nullable | — | Accounts location reference (not `crm.company_locations.id`). |
| `status` | `varchar(32)` | required | 'active' | Account status (`active`, …). |
| `created_at` | `timestamptz` | required | `now()` | Row creation timestamp. |
| `updated_at` | `timestamptz` | required | `now()` | Last update timestamp. |
| `shift_types` | `jsonb` | nullable | — | CCAAS shift tags (JSON). |
| `password_hash` | `text` | nullable | — | Bcrypt (or similar) password hash. |
| `invite_status` | `varchar(32)` | nullable | — | Invite workflow state. |
| `password_set_at` | `timestamptz` | nullable | — | When the user set a password. |
| `invited_at` | `timestamptz` | nullable | — | When the invite was sent. |
| `skills` | `jsonb` | required | '[]'::jsonb | CCAAS skill tags (JSON array). |
| `city` | `varchar(128)` | nullable | — | User city. |
| `state` | `varchar(128)` | nullable | — | User state / region. |
| `country` | `varchar(128)` | nullable | — | User country — also used as territory for lead assignment. |
| `business_hours_id` | `bigint` | nullable | — | FK to Accounts business-hours row. |
| `id` | `bigint` | required | — | User primary key. All CRM `*_user_id` columns store this bigint. |
| `organization_id` | `bigint` | required | — | Tenant this user belongs to. |
| `team_id` | `bigint` | nullable | — | Optional Accounts team. |
| `whatsapp_number` | `varchar(32)` | nullable | — | Optional WhatsApp number. |

### `accounts.setup_roles`

Named product roles (admin, sales_rep, finance, …). CRM looks up the role name via `setup_user_product_access` where `product_id = 'crm'`.

| Column | Type | Null | Default | Description |
|---|---|---|---|---|
| `name` | `varchar(255)` | required | — | Role name used by CRM RBAC (`admin`, `sales_manager`, `sales_rep`, `marketing`, `finance`, `viewer`). |
| `description` | `text` | nullable | — | Human description of the role. |
| `accessible_products` | `jsonb` | required | '[]'::jsonb | JSON list of Worktual products this role can open. |
| `module_permission` | `varchar(128)` | nullable | — | Legacy single-module permission string. |
| `can_view` | `boolean` | required | `true` | View capability flag. |
| `can_create` | `boolean` | required | `false` | Create capability flag. |
| `can_edit` | `boolean` | required | `false` | Edit capability flag. |
| `can_delete` | `boolean` | required | `false` | Delete capability flag. |
| `can_export` | `boolean` | required | `false` | Export capability flag. |
| `can_approve` | `boolean` | required | `false` | Approve capability flag. |
| `created_at` | `timestamptz` | required | `now()` | Row creation timestamp. |
| `updated_at` | `timestamptz` | required | `now()` | Last update timestamp. |
| `product_id` | `varchar(128)` | nullable | — | Product this role is defined for (`crm`, …). |
| `module_permissions` | `jsonb` | nullable | — | JSON module permission map. |
| `id` | `bigint` | required | — | Role primary key. |
| `organization_id` | `bigint` | required | — | Tenant that owns the role. |

### `accounts.setup_user_product_access`

Maps a user to a Worktual product and role. CRM access is the row with `product_id = 'crm'`.

| Column | Type | Null | Default | Description |
|---|---|---|---|---|
| `product_id` | `varchar(128)` | required | — | Worktual product (`crm` for this app). |
| `created_at` | `timestamptz` | required | `now()` | Row creation timestamp. |
| `id` | `bigint` | required | — | Grant primary key. |
| `organization_id` | `bigint` | required | — | Tenant. |
| `role_id` | `bigint` | required | — | FK to `accounts.setup_roles.id`. |
| `user_id` | `bigint` | required | — | FK to `accounts.setup_users.id`. |

### `accounts.setup_channel_configs`

Org communication channels. CRM uses active `channel_type = 'email'` rows whose `product_ids` JSON contains `"crm"` (bot mailbox / nurture send).

| Column | Type | Null | Default | Description |
|---|---|---|---|---|
| `channel_type` | `varchar(32)` | required | — | Channel kind (`email`, voice, …). CRM uses `email`. |
| `name` | `varchar(255)` | required | — | Display name of the channel. |
| `status` | `varchar(32)` | required | 'pending' | Channel status. CRM requires `active`. |
| `product_ids` | `jsonb` | required | '[]'::jsonb | JSON array of product slugs. CRM mailbox = contains `"crm"`. |
| `created_at` | `timestamptz` | required | `now()` | Row creation timestamp. |
| `updated_at` | `timestamptz` | required | `now()` | Last update timestamp. |
| `id` | `bigint` | required | — | Channel primary key. |
| `organization_id` | `bigint` | required | — | Tenant. |
| `settings` | `jsonb` | required | '{}'::jsonb | Provider-specific channel settings (JSON). |

### `accounts.setup_email_configs`

Email-provider settings for a channel (`channel_config_id`). CRM reads sender identity and OAuth link; ignores CCAAS-only `is_bot`.

| Column | Type | Null | Default | Description |
|---|---|---|---|---|
| `provider_type` | `varchar(32)` | required | — | Email provider (`google`, `microsoft`, SMTP, hosted, …). |
| `third_party_mode` | `varchar(32)` | nullable | — | How the third-party mailbox is used. |
| `sender_email` | `varchar(255)` | nullable | — | From address used for CRM bot / nurture mail. |
| `sender_name` | `varchar(255)` | nullable | — | From display name. |
| `reply_to` | `varchar(255)` | nullable | — | Reply-To address. |
| `domain` | `varchar(255)` | nullable | — | Sending domain. |
| `domain_verification_status` | `varchar(32)` | nullable | — | Domain verify state. |
| `domain_verification_token` | `varchar(128)` | nullable | — | Domain verify token. |
| `smtp_host` | `varchar(255)` | nullable | — | SMTP host (when not OAuth). |
| `smtp_port` | `integer` | nullable | — | SMTP port. |
| `smtp_secure` | `boolean` | nullable | — | SMTP TLS/SSL flag. |
| `imap_host` | `varchar(255)` | nullable | — | IMAP host. |
| `imap_port` | `integer` | nullable | — | IMAP port. |
| `imap_secure` | `boolean` | nullable | — | IMAP TLS/SSL flag. |
| `smtp_user_encrypted` | `text` | nullable | — | Encrypted SMTP username. |
| `smtp_pass_encrypted` | `text` | nullable | — | Encrypted SMTP password. |
| `imap_user_encrypted` | `text` | nullable | — | Encrypted IMAP username. |
| `imap_pass_encrypted` | `text` | nullable | — | Encrypted IMAP password. |
| `requested_local_part` | `varchar(128)` | nullable | — | Requested local-part for hosted mail. |
| `hosted_domain` | `varchar(255)` | required | 'vectone.tech' | Hosted mail domain (default vectone.tech). |
| `provisioning_status` | `varchar(32)` | nullable | — | Hosted mailbox provisioning state. |
| `created_at` | `timestamptz` | required | `now()` | Row creation timestamp. |
| `updated_at` | `timestamptz` | required | `now()` | Last update timestamp. |
| `oauth_provider` | `varchar(32)` | nullable | — | `google` or `microsoft` when OAuth is used. |
| `ccaas_handler` | `varchar(32)` | nullable | — | CCAAS routing handler (CRM ignores). |
| `is_bot` | `boolean` | required | `false` | CCAAS bot flag — CRM does not use this to pick the mailbox. |
| `channel_config_id` | `bigint` | required | — | FK to `setup_channel_configs.id`. |
| `id` | `bigint` | required | — | Email-config primary key. |
| `oauth_connection_id` | `bigint` | nullable | — | FK to `mail_oauth_connections.id`. |

### `accounts.mail_oauth_connections`

Encrypted mailbox OAuth tokens owned by Accounts. CRM updates tokens after Google/Microsoft connect; never stores a parallel secret here in CRM schema.

| Column | Type | Null | Default | Description |
|---|---|---|---|---|
| `account_type` | `varchar(16)` | required | 'internal' | Mailbox class (`internal`, …). |
| `mailbox_profile` | `varchar(64)` | required | — | Mailbox profile label. |
| `account_email` | `varchar(255)` | required | — | Connected mailbox address. |
| `account_name` | `varchar(255)` | nullable | — | Connected account display name. |
| `ms_tenant_id` | `varchar(64)` | nullable | — | Microsoft tenant id (Graph). |
| `access_token_encrypted` | `text` | required | — | Encrypted access token (Accounts crypto). |
| `refresh_token_encrypted` | `text` | required | — | Encrypted refresh token. |
| `expires_at` | `timestamptz` | required | — | Access-token expiry. |
| `scope` | `text` | nullable | — | Granted OAuth scopes. |
| `needs_reauth` | `boolean` | required | `false` | True when the user must reconnect. |
| `created_at` | `timestamptz` | required | `now()` | Row creation timestamp. |
| `updated_at` | `timestamptz` | required | `now()` | Last update timestamp. |
| `account_id` | `bigint` | required | — | Accounts-side account reference. |
| `id` | `bigint` | required | — | OAuth connection primary key. |

## `cdp` schema

**Refer here for:** **contacts / people** — name, geo, lifecycle `contact_type`, emails, phones. Always start with `customer_profile` + `identity_keys`. CRM sales fields (owner, lead status, BANT) are **not** here; they live on `crm.contact_profiles`.

`cdp.products` is a separate Worktual registry (bigint ids). For the CRM Product module and quote lines, use **`inventory.products`**.

Shared person identity and CDP product registry. CRM **SELECT** and DML on **existing** columns only. **No DDL.** Do not use legacy `cdp.contacts`.

### `cdp.customer_profile`

**Refer here for:** **contact / person identity** — first/last name, free-text `company`, city/country, `contact_type` (lead / customer / …). Join `identity_keys` for email/phone. Then join `crm.contact_profiles` on `account_contact_id = cdp_id` for owner and lead status.

Shared person / firmographic profile. System of record for name, company label, geo, and `contact_type`. CRM overlays live in `crm.contact_profiles`.

| Column | Type | Null | Default | Description |
|---|---|---|---|---|
| `cdp_id` | `text` | required | — | Person primary key (text). Same value as `crm.contact_profiles.account_contact_id` and most CRM `contact_id` columns. |
| `first_name` | `varchar(128)` | nullable | — | Given name. |
| `last_name` | `varchar(128)` | nullable | — | Family name. |
| `gender` | `varchar(32)` | nullable | — | Optional gender. |
| `date_of_birth` | `date` | nullable | — | Optional date of birth. |
| `company` | `varchar(255)` | nullable | — | Free-text employer / company label (not `crm.companies.id`). |
| `city` | `varchar(128)` | nullable | — | City. |
| `region` | `varchar(128)` | nullable | — | Region / state, or street line when CRM writes address into this column. |
| `country` | `varchar(128)` | nullable | — | Country. |
| `language` | `varchar(64)` | nullable | — | Preferred language. |
| `timezone` | `varchar(64)` | nullable | — | IANA timezone. |
| `acquisition_channel` | `varchar(128)` | nullable | — | How the person was first acquired. |
| `acquisition_date` | `date` | nullable | — | Acquisition date. |
| `first_referrer` | `text` | nullable | — | First referrer URL / source. |
| `first_seen_at` | `timestamptz` | nullable | — | First observed timestamp. |
| `last_seen_at` | `timestamptz` | nullable | — | Last observed timestamp. |
| `created_at` | `timestamptz` | required | `now()` | Row creation timestamp. |
| `updated_at` | `timestamptz` | required | `now()` | Last update timestamp. |
| `organization_id` | `bigint` | required | — | Tenant. |
| `custom_fields` | `jsonb` | required | '{}'::jsonb | JSON bag. CRM uses `title`, `industry`, `company_domain`, `address_line`. |
| `tenant_id` | `text` | required | 'default' | Legacy CDP tenant string (default `default`). Prefer `organization_id`. |
| `preferences_json` | `jsonb` | required | '{}'::jsonb | Preference payload (CDP-owned). |
| `consent_json` | `jsonb` | required | '{}'::jsonb | Consent payload (CDP-owned). |
| `traits_json` | `jsonb` | required | '{}'::jsonb | Trait payload (CDP-owned). |
| `contact_type` | `varchar(200)` | nullable | — | Person lifecycle (`lead`, `mql`, `sql`, `customer`, …). Moved here from `crm.contact_profiles.lifecycle_stage`. |

### `cdp.identity_keys`

**Refer here for:** a contact’s **emails and phones** (and any other identity key). There is no email/phone column on `crm.contact_profiles`.

Emails, phones, and other identity keys for a person. Unique per tenant on `(organization_id, key_type, key_value)`.

| Column | Type | Null | Default | Description |
|---|---|---|---|---|
| `identity_id` | `text` | required | — | Identity-key primary key (text). |
| `cdp_id` | `text` | required | — | FK to `cdp.customer_profile.cdp_id` (CASCADE). |
| `key_type` | `varchar(64)` | required | — | CRM conventions: `email`, `phone`, `email_secondary`, `phone_secondary`. |
| `key_value` | `varchar(255)` | required | — | Normalized value (email lowercased; phone trimmed). |
| `source_system` | `varchar(255)` | nullable | — | Writer system. CRM writes `crm`. |
| `confidence_score` | `numeric(5,4)` | nullable | — | Match confidence 0–1. |
| `verified` | `boolean` | required | `false` | Whether the key is verified. |
| `created_at` | `timestamptz` | required | `now()` | Row creation timestamp. |
| `organization_id` | `bigint` | required | — | Tenant. |
| `custom_fields` | `jsonb` | required | '{}'::jsonb | Optional JSON on the key. |

### `cdp.products`

**Refer here only for:** the shared CDP product registry (`product_id` bigint). **Do not use this for the CRM Product module, quotes, or inventory stock.** Those use `inventory.products`.

Worktual CDP product registry. CRM may DML existing columns only.

| Column | Type | Null | Default | Description |
|---|---|---|---|---|
| `product_id` | `bigint` | required | sequence | Bigint product PK (sequence). Not `inventory.products.id`. |
| `sku` | `varchar(128)` | required | — | SKU. |
| `product_name` | `varchar(255)` | required | — | Display name. |
| `brand` | `varchar(128)` | nullable | — | Brand. |
| `category` | `varchar(255)` | nullable | — | Category. |
| `subcategory` | `varchar(255)` | nullable | — | Subcategory. |
| `price` | `numeric(14,2)` | required | `0.00` | List price. |
| `currency` | `varchar(8)` | required | 'USD' | ISO currency. |
| `status` | `varchar(64)` | required | 'active' | Lifecycle status (`active`, …). |
| `active` | `boolean` | required | `true` | Soft-active flag. |
| `created_at` | `timestamptz` | required | `now()` | Row creation timestamp. |
| `updated_at` | `timestamptz` | required | `now()` | Last update timestamp. |
| `organization_id` | `bigint` | required | — | Tenant. |
| `custom_fields` | `jsonb` | required | '{}'::jsonb | CDP JSON bag. |

## `inventory` schema

**Refer here for:** **what the tenant sells** — SKU, name, list price, stock, billing type — for B2B, B2C, and B2B2C. Quote / order / invoice `product_id` columns point here.

Offers, addons, and price books stay in **`crm`**. Do not use `cdp.products` as the CRM working catalog.

Shared product catalog. CRM DML on existing columns only. Field changes require inventory owners first. There is **no** `crm.products` table.

### `inventory.products`

**Refer here for:** every **sellable catalog product** in CRM — name, SKU, price, stock, billing. All quote/order/invoice `product_id` values point at `id` here. Same table for B2B, B2C, and B2B2C.

Shared product catalog. CRM SELECT/INSERT/UPDATE/DELETE existing columns only. No `crm.products` table.

| Column | Type | Null | Default | Description |
|---|---|---|---|---|
| `id` | `text` | required | — | Catalog primary key (cuid text). Referenced by CRM offers, addons, and quote/order/invoice lines. |
| `name` | `text` | required | — | Product name. |
| `tagline` | `text` | nullable | — | Short line shown on cards. |
| `description` | `text` | nullable | — | Marketing / sales description. |
| `specifications` | `text` | nullable | — | Long-form specs / details. |
| `image_url` | `text` | nullable | — | Primary image URL. |
| `gallery_urls` | `jsonb` | nullable | — | Extra image URLs (JSON string array). |
| `sku` | `text` | nullable | — | SKU. |
| `price` | `numeric(12,2)` | nullable | — | List price. |
| `currency` | `text` | required | 'USD' | ISO currency (default USD). |
| `status` | `ProductStatus` | required | 'draft'::crm."ProductStatus" | draft / active / archived. |
| `category` | `text` | nullable | — | Category label. |
| `tags` | `text` | nullable | — | Freeform / comma-separated tags. |
| `created_at` | `timestamp` | required | `CURRENT_TIMESTAMP` | Row creation timestamp. |
| `updated_at` | `timestamp` | required | — | Last update timestamp. |
| `organization_id` | `bigint` | required | — | Tenant. |
| `billing_type` | `ProductBillingType` | required | 'one_time'::crm."ProductBillingType" | one_time or recurring. |
| `billing_frequency` | `ProductBillingFrequency` | nullable | — | monthly / quarterly / annual (when recurring). |
| `unit_of_measure` | `ProductUnitOfMeasure` | required | 'flat'::crm."ProductUnitOfMeasure" | per_seat / per_agent / per_ticket / flat. |
| `pricing_tiers` | `jsonb` | nullable | — | Legacy volume tiers on the product (prefer addons for customizable). |
| `product_type` | `ProductType` | required | 'fixed'::crm."ProductType" | fixed or customizable. |
| `custom_attributes` | `jsonb` | nullable | — | Non-pricing industry labels (not used for quote math). |
| `max_discount_percent` | `numeric(5,2)` | nullable | — | Quote-line discount cap; above this needs Finance approval. Null = no cap. |
| `brand` | `text` | nullable | — | Retail / commerce brand (optional on B2B). |
| `subcategory` | `text` | nullable | — | Retail subcategory. |
| `stock_on_hand` | `integer` | nullable | — | Warehouse units. Null = not inventory-tracked. Decremented on confirmed orders. |
| `product_url` | `text` | nullable | — | PDP / datasheet URL (not an image). |

## `crm` schema

**Refer here for:** **how we sell and operate** — company accounts, CRM contact overlay, deals, inbox, quotes/orders/invoices, and agent job/snapshot tables. Not for person identity (CDP), not for login users (Accounts), not for the product catalog row (inventory).

CRM-owned schema (Prisma). This app may migrate these tables. Product **rows** live in `inventory.products`; CRM keeps offers, addons, price books, and document lines here.

### `crm.companies`

**Refer here for:** **customer companies / B2B accounts** (and franchise nodes). Not the tenant seller — that is `accounts.organizations`. Not the person’s employer string — that is `cdp.customer_profile.company`.

B2B accounts (and franchise nodes) inside a tenant. Required on B2B deals. Optional parent/child tree via `channel_role` + `parent_company_id`.

| Column | Type | Null | Default | Description |
|---|---|---|---|---|
| `id` | `text` | required | — | Primary key (cuid text). |
| `name` | `text` | required | — | Account / company display name. |
| `industry` | `text` | nullable | — | Industry label. |
| `employee_count` | `integer` | nullable | — | Headcount (optional). |
| `owner_user_id` | `bigint` | nullable | — | CRM owner (`accounts.setup_users.id`). |
| `created_at` | `timestamp` | required | `CURRENT_TIMESTAMP` | Row creation timestamp. |
| `updated_at` | `timestamp` | required | — | Last update timestamp. |
| `organization_id` | `bigint` | required | — | Tenant (`accounts.organizations.id`). |
| `domain` | `text` | nullable | — | Primary web domain. |
| `linkedin_url` | `text` | nullable | — | Company LinkedIn URL. |
| `logo_url` | `text` | nullable | — | Logo image URL. |
| `channel_role` | `CompanyChannelRole` | required | 'standard'::crm."CompanyChannelRole" | standard / franchise / owned_store / brand_hq (B2B2C hierarchy). |
| `parent_company_id` | `text` | nullable | — | Optional parent `crm.companies.id` (franchise tree). |
| `expansion_signal` | `varchar(16)` | nullable | — | Expansion agent flag (HITL). Agent never creates a deal or sends mail. |
| `expansion_reason` | `text` | nullable | — | Why expansion was flagged. |
| `expansion_draft` | `text` | nullable | — | Draft outreach talking points (human sends). |
| `expansion_last_run_at` | `timestamptz` | nullable | — | Last expansion-agent run. |

### `crm.company_locations`

HQ or branch sites under a company. Every B2B deal requires a location.

| Column | Type | Null | Default | Description |
|---|---|---|---|---|
| `id` | `text` | required | — | Primary key (cuid text). |
| `company_id` | `text` | required | — | Parent company (CASCADE delete). |
| `name` | `text` | required | — | Display name. |
| `type` | `LocationType` | required | 'branch'::crm."LocationType" | hq or branch. |
| `address` | `text` | nullable | — | Street address. |
| `city` | `text` | nullable | — | City. |
| `industry` | `text` | nullable | — | Site industry override. |
| `employee_count` | `integer` | nullable | — | Site headcount. |
| `created_at` | `timestamp` | required | `CURRENT_TIMESTAMP` | Row creation timestamp. |
| `updated_at` | `timestamp` | required | — | Last update timestamp. |
| `owner_user_id` | `bigint` | nullable | — | CRM owner (`accounts.setup_users.id`). |
| `organization_id` | `bigint` | required | — | Tenant (`accounts.organizations.id`). |

### `crm.contact_profiles`

**Refer here for:** CRM fields **on top of a CDP person** — owner, lead status, company/location link, BANT, tags, nurture/opt-out. **Not** name, email, or phone (those are CDP). `account_contact_id` = `cdp.customer_profile.cdp_id`. Activities and jobs use `contact_id` = that same `cdp_id`, not this row’s `id`.

CRM overlay on a CDP person. Not the identity store.

| Column | Type | Null | Default | Description |
|---|---|---|---|---|
| `id` | `text` | required | — | Primary key (cuid text). |
| `account_contact_id` | `text` | required | — | Unique CDP person key (`cdp.customer_profile.cdp_id`). |
| `organization_id` | `bigint` | required | — | Tenant (`accounts.organizations.id`). |
| `company_id` | `text` | nullable | — | FK to `crm.companies.id`. |
| `location_id` | `text` | nullable | — | FK to `crm.company_locations.id`. |
| `owner_user_id` | `bigint` | nullable | — | CRM owner (`accounts.setup_users.id`). |
| `lead_source` | `varchar(128)` | nullable | — | How the lead entered CRM. |
| `lead_status` | `varchar(32)` | required | 'new' | Sales lead status (`new`, qualified, disqualified, …). |
| `disqualify_reason` | `varchar(64)` | nullable | — | Why the lead was disqualified. |
| `bant_budget` | `boolean` | nullable | — | BANT — budget confirmed. |
| `bant_authority` | `boolean` | nullable | — | BANT — authority confirmed. |
| `bant_need` | `boolean` | nullable | — | BANT — need confirmed. |
| `bant_timeline` | `boolean` | nullable | — | BANT — timeline confirmed. |
| `converted_deal_id` | `text` | nullable | — | Deal created when this lead converted. |
| `tags` | `text[]` | required | `ARRAY[][]` | Free-form CRM tags. |
| `crm_status` | `varchar(32)` | required | 'active' | `active` or archived (soft-delete lives here, not on CDP). |
| `notes` | `text` | nullable | — | Free-text notes. |
| `is_pinned` | `boolean` | required | `false` | Pinned in the contact list UI. |
| `created_at` | `timestamp` | required | `CURRENT_TIMESTAMP` | Row creation timestamp. |
| `updated_at` | `timestamp` | required | — | Last update timestamp. |
| `assignment_reason` | `text` | nullable | — | Why Assignment Agent routed this owner. |
| `sla_deadline` | `timestamp` | nullable | — | First-touch SLA deadline after assignment. |
| `assigned_at` | `timestamp` | nullable | — | When the current owner was assigned. |
| `assignment_escalated` | `boolean` | required | `false` | True after assignment SLA miss was escalated. |
| `nurture_status` | `varchar(32)` | nullable | — | Nurturing Agent overlay status. |
| `nurture_sequence_step` | `integer` | nullable | — | Current nurture sequence step. |
| `nurture_started_at` | `timestamp` | nullable | — | When nurture started. |
| `nurture_last_touch_at` | `timestamp` | nullable | — | Last nurture send / touch. |
| `flagged_for_review` | `boolean` | required | `false` | Lifecycle Agent review flag (ambiguous / stalled). |
| `flag_reason` | `varchar(500)` | nullable | — | Why the contact was flagged. |
| `lifecycle_last_action` | `varchar(64)` | nullable | — | Last lifecycle action applied. |
| `lifecycle_last_reason` | `text` | nullable | — | Reason for that action. |
| `lifecycle_last_run_at` | `timestamptz` | nullable | — | Last lifecycle agent run. |
| `custom_attributes` | `jsonb` | nullable | — | Vertical pack field values (CRM overlay — never CDP columns). |
| `marketing_opt_out` | `boolean` | required | `false` | Durable marketing suppression. Enforced before any automated nurture send. |
| `marketing_opt_out_at` | `timestamptz` | nullable | — | When opt-out was recorded. |
| `created_by_user_id` | `bigint` | nullable | — | User who created the overlay (distinct from assigned owner). |

### `crm.organization_profiles`

**Refer here for:** optional CRM **field-pack overrides**. Industry itself is **`accounts.organizations.industry_type`** — do not treat `vertical` here as source of truth.

Optional CRM vertical-pack overrides.

| Column | Type | Null | Default | Description |
|---|---|---|---|---|
| `organization_id` | `bigint` | required | — | PK = tenant id (one row per org). |
| `vertical` | `OrganizationVertical` | required | 'general'::crm."OrganizationVertical" | Cached pack enum (general, ecommerce, healthcare, finance, telecom). Not the industry source of truth. |
| `vertical_config` | `jsonb` | required | '{}'::jsonb | Pack override JSON. |
| `created_at` | `timestamp` | required | `CURRENT_TIMESTAMP` | Row creation timestamp. |
| `updated_at` | `timestamp` | required | `CURRENT_TIMESTAMP` | Last update timestamp. |

### `crm.deals`

**Refer here for:** **B2B opportunities / pipeline**. Join company + location in `crm`; primary person via `contact_id` = **`cdp_id`**; owner via `accounts.setup_users`. B2C commerce orders skip this table.

B2B opportunity. Stages qualification → discover → propose → negotiate → closed_won / closed_lost. Requires company + location.

| Column | Type | Null | Default | Description |
|---|---|---|---|---|
| `id` | `text` | required | — | Primary key (cuid text). |
| `title` | `text` | required | — | Opportunity name. |
| `stage` | `DealStage` | required | 'qualification'::crm."DealStage" | Pipeline stage. |
| `amount` | `numeric(12,2)` | nullable | — | Deal value. |
| `company_id` | `text` | required | — | FK to `crm.companies.id`. |
| `location_id` | `text` | required | — | FK to `crm.company_locations.id`. |
| `contact_id` | `text` | nullable | — | CDP person key (`cdp.customer_profile.cdp_id`). |
| `contact_name` | `text` | nullable | — | Denormalized primary contact name for board/list UI. |
| `contact_email` | `text` | nullable | — | Denormalized primary contact email. |
| `owner_user_id` | `bigint` | nullable | — | CRM owner (`accounts.setup_users.id`). |
| `notes` | `text` | nullable | — | Free-text notes. |
| `closed_at` | `timestamp` | nullable | — | When the deal closed (won or lost). |
| `created_at` | `timestamp` | required | `CURRENT_TIMESTAMP` | Row creation timestamp. |
| `updated_at` | `timestamp` | required | — | Last update timestamp. |
| `expected_close_date` | `timestamp` | nullable | — | Forecast close date. |
| `lost_reason` | `text` | nullable | — | Why the deal was lost. |
| `organization_id` | `bigint` | required | — | Tenant (`accounts.organizations.id`). |
| `forecast_category` | `varchar(32)` | nullable | — | Forecast auditor category overlay. |
| `forecast_confidence_percent` | `integer` | nullable | — | Auditor confidence 0–100. |
| `forecast_flagged` | `boolean` | required | `false` | True when the auditor flagged the forecast. |
| `forecast_reason` | `text` | nullable | — | Why it was flagged. |
| `forecast_last_run_at` | `timestamptz` | nullable | — | Last forecast-auditor run. Agent never mutates stage or expected_close_date. |

### `crm.deal_activities`

Calls, meetings, emails, notes, and tasks logged on a deal (not the contact Inbox timeline).

| Column | Type | Null | Default | Description |
|---|---|---|---|---|
| `id` | `text` | required | — | Primary key (cuid text). |
| `deal_id` | `text` | required | — | FK to `crm.deals.id`. |
| `type` | `ActivityType` | required | — | Activity or entity type enum. |
| `subject` | `text` | required | — | Subject / short headline. |
| `body` | `text` | nullable | — | Long body / notes / email HTML or text. |
| `due_at` | `timestamp` | nullable | — | Due / reminder datetime. |
| `completed_at` | `timestamp` | nullable | — | When processing finished successfully. |
| `created_by_user_id` | `bigint` | nullable | — | User who created the row (`accounts.setup_users.id`). |
| `created_at` | `timestamp` | required | `CURRENT_TIMESTAMP` | Row creation timestamp. |
| `updated_at` | `timestamp` | required | — | Last update timestamp. |
| `organization_id` | `bigint` | required | — | Tenant (`accounts.organizations.id`). |

### `crm.contact_activities`

**Refer here for:** the **contact timeline and Inbox** (email, meeting, task, note, call, SMS). `contact_id` is the **CDP person key**, not `contact_profiles.id`. Deal-only logs go in `crm.deal_activities`.

Unified contact timeline and Inbox.

| Column | Type | Null | Default | Description |
|---|---|---|---|---|
| `id` | `text` | required | — | Primary key (cuid text). |
| `contact_id` | `text` | required | — | CDP person key (`cdp.customer_profile.cdp_id`). |
| `type` | `ActivityType` | required | — | Activity or entity type enum. |
| `subject` | `text` | required | — | Subject / short headline. |
| `body` | `text` | nullable | — | Long body / notes / email HTML or text. |
| `due_at` | `timestamp` | nullable | — | Due / reminder datetime. |
| `completed_at` | `timestamp` | nullable | — | When processing finished successfully. |
| `created_by_user_id` | `bigint` | nullable | — | User who created the row (`accounts.setup_users.id`). |
| `created_at` | `timestamp` | required | `CURRENT_TIMESTAMP` | Row creation timestamp. |
| `updated_at` | `timestamp` | required | — | Last update timestamp. |
| `folder` | `InboxFolder` | required | 'inbox'::crm."InboxFolder" | Inbox folder: inbox / sent / draft / trash. |
| `thread_id` | `text` | nullable | — | CRM-side conversation grouping for the Inbox UI. |
| `gmail_message_id` | `text` | nullable | — | Legacy Gmail message id (unique). |
| `gmail_thread_id` | `text` | nullable | — | Legacy Gmail thread id. |
| `email_direction` | `EmailDirection` | nullable | — | inbound or outbound. |
| `rfc_message_id` | `text` | nullable | — | RFC Message-ID header — required for client-side reply threading. |
| `reminder_sent_at` | `timestamp` | nullable | — | Legacy 1-hour reminder flag (mirrored to reminder_1h_sent_at). |
| `organization_id` | `bigint` | required | — | Tenant (`accounts.organizations.id`). |
| `task_status` | `TaskStatus` | nullable | — | Task workflow (null for non-task rows). Overdue is derived. |
| `assignee_user_id` | `bigint` | nullable | — | Task assignee (`accounts.setup_users.id`). |
| `transcript_text` | `text` | nullable | — | Full meeting/call transcript once a provider or upload supplies it. |
| `transcript_source` | `text` | nullable | — | Where the transcript came from. |
| `transcript_analyzed_at` | `timestamp` | nullable | — | When meeting analysis last ran. |
| `transcript_insights` | `jsonb` | nullable | — | Extracted signals: intent, commitments, objections, BANT hints. |
| `provider_message_id` | `text` | nullable | — | Provider-agnostic message id (Gmail or Graph) for dedupe. |
| `provider_thread_id` | `text` | nullable | — | Provider-agnostic conversation id. |
| `mail_provider` | `MailProvider` | nullable | — | google or microsoft. |
| `needs_manual_response` | `boolean` | required | `false` | Set by auto-reply when a human must answer (sensitive content). |
| `reminder_24h_sent_at` | `timestamp` | nullable | — | T−24h meeting reminder legs completed or permanently skipped. |
| `reminder_1h_sent_at` | `timestamp` | nullable | — | T−1h meeting reminder legs completed or permanently skipped. |
| `miss_escalated_at` | `timestamp` | nullable | — | Admins escalated that the meeting was not conducted (no transcript). |
| `mom_sent_at` | `timestamp` | nullable | — | Minutes-of-meeting email sent after transcript attach. |

### `crm.user_integration_connections`

**Refer here for:** a **salesperson’s connected Gmail/Calendar**. The **org CRM bot mailbox** (nurture / auto-reply From) is in **Accounts** (`setup_channel_configs` + `setup_email_configs` + `mail_oauth_connections`), not here.

Per-user OAuth for Gmail/Calendar (and other providers). Powers inbox sync and outbound send from a rep mailbox.

| Column | Type | Null | Default | Description |
|---|---|---|---|---|
| `id` | `text` | required | — | Primary key (cuid text). |
| `user_id` | `bigint` | required | — | Mailbox owner (`accounts.setup_users.id`). Unique with provider. |
| `provider` | `IntegrationProvider` | required | — | google / microsoft / zoom / yahoo. |
| `account_email` | `text` | nullable | — | Connected mailbox address. |
| `access_token` | `text` | required | — | OAuth access token (secret). |
| `refresh_token` | `text` | nullable | — | OAuth refresh token (secret). |
| `token_expires_at` | `timestamp` | nullable | — | Access-token expiry. |
| `scope` | `text` | nullable | — | Granted scopes. |
| `created_at` | `timestamp` | required | `CURRENT_TIMESTAMP` | Row creation timestamp. |
| `updated_at` | `timestamp` | required | — | Last update timestamp. |
| `organization_id` | `bigint` | required | — | Tenant (`accounts.organizations.id`). |

### `crm.gmail_push_watches`

Gmail `users.watch` registration for Pub/Sub push. One row per mailbox email (`user` or `crm_bot`).

| Column | Type | Null | Default | Description |
|---|---|---|---|---|
| `id` | `text` | required | — | Primary key (cuid text). |
| `organization_id` | `bigint` | nullable | — | Tenant (`accounts.organizations.id`). |
| `user_id` | `bigint` | nullable | — | Rep mailbox owner, when watch_kind = user. |
| `account_email` | `text` | required | — | Watched mailbox (unique). |
| `watch_kind` | `text` | required | 'user' | `user` or `crm_bot`. |
| `history_id` | `text` | nullable | — | Last Gmail history id processed. |
| `expiration` | `timestamptz` | nullable | — | When the watch expires and must be renewed. |
| `created_at` | `timestamptz` | required | `now()` | Row creation timestamp. |
| `updated_at` | `timestamptz` | required | `now()` | Last update timestamp. |

### `crm.org_assignment_settings`

Per-tenant assignment knobs: deal-size → seniority threshold and ICP JSON for Fit scoring.

| Column | Type | Null | Default | Description |
|---|---|---|---|---|
| `id` | `text` | required | — | Primary key (cuid text). |
| `organization_id` | `bigint` | required | — | Tenant (`accounts.organizations.id`). |
| `senior_amount_threshold` | `integer` | required | `50000` | Deal amount at/above which seniors are preferred (default 50000). |
| `updated_by_user_id` | `bigint` | nullable | — | Last editor. |
| `created_at` | `timestamp` | required | `CURRENT_TIMESTAMP` | Row creation timestamp. |
| `updated_at` | `timestamp` | required | — | Last update timestamp. |
| `lead_icp` | `jsonb` | nullable | — | ICP knobs: `{ targetIndustries, sizeTiers, serviceableGeos }`. |

### `crm.sales_user_assignment_profiles`

Per-rep capacity overlay: accepting leads, max open deals, seniority, PTO, territory country.

| Column | Type | Null | Default | Description |
|---|---|---|---|---|
| `id` | `text` | required | — | Primary key (cuid text). |
| `organization_id` | `bigint` | required | — | Tenant (`accounts.organizations.id`). |
| `user_id` | `bigint` | required | — | Sales rep (`accounts.setup_users.id`). Unique with organization_id. |
| `accepting_leads` | `boolean` | required | `true` | If false, Assignment Agent skips this rep. |
| `max_open_deals` | `integer` | nullable | — | Optional open-deal capacity cap. |
| `seniority_tier` | `SalesSeniorityTier` | nullable | — | junior / mid / senior. |
| `on_pto_until` | `date` | nullable | — | Skip assignment until this date (inclusive). |
| `country` | `varchar(128)` | nullable | — | Territory country filter. |
| `created_at` | `timestamp` | required | `CURRENT_TIMESTAMP` | Row creation timestamp. |
| `updated_at` | `timestamp` | required | — | Last update timestamp. |

### `crm.product_offers`

Named commercial package under a catalog product (plan, edition, or usage pack).

| Column | Type | Null | Default | Description |
|---|---|---|---|---|
| `id` | `text` | required | — | Primary key (cuid text). |
| `organization_id` | `bigint` | required | — | Tenant (`accounts.organizations.id`). |
| `product_id` | `text` | required | — | FK to `inventory.products.id`. |
| `name` | `text` | required | — | Display name. |
| `code` | `text` | nullable | — | Optional stable code (unique per org when set). |
| `billing_type` | `ProductBillingType` | nullable | — | one_time or recurring override for this offer. |
| `billing_frequency` | `ProductBillingFrequency` | nullable | — | monthly / quarterly / annual. |
| `included_qty` | `integer` | nullable | — | Included units in the pack. |
| `meter_key` | `AddonMeterKey` | nullable | — | Usage meter (seat, minute, session, …). |
| `sort_order` | `integer` | required | `0` | Display / line order (0-based). |
| `status` | `ProductStatus` | required | 'active'::crm."ProductStatus" | Workflow status for this record. |
| `created_at` | `timestamp` | required | `CURRENT_TIMESTAMP` | Row creation timestamp. |
| `updated_at` | `timestamp` | required | — | Last update timestamp. |

### `crm.product_addons`

Optional add-on sold with a customizable product (flat / per-unit / stepped / tiered).

| Column | Type | Null | Default | Description |
|---|---|---|---|---|
| `id` | `text` | required | — | Primary key (cuid text). |
| `organization_id` | `bigint` | required | — | Tenant (`accounts.organizations.id`). |
| `product_id` | `text` | required | — | FK to `inventory.products.id`. |
| `name` | `text` | required | — | Display name. |
| `unit_label` | `text` | nullable | — | Unit label shown in UI (e.g. seats). |
| `pricing_model` | `AddonPricingModel` | required | — | flat / per_unit / stepped / tiered. |
| `flat_price` | `numeric(12,2)` | nullable | — | Price when model = flat. |
| `unit_price` | `numeric(12,4)` | nullable | — | Unit price. |
| `step_size` | `integer` | nullable | — | Step size when model = stepped. |
| `step_price` | `numeric(12,2)` | nullable | — | Price per step. |
| `sort_order` | `integer` | required | `0` | Display / line order (0-based). |
| `created_at` | `timestamp` | required | `CURRENT_TIMESTAMP` | Row creation timestamp. |
| `updated_at` | `timestamp` | required | — | Last update timestamp. |
| `meter_key` | `AddonMeterKey` | nullable | — | Usage meter vocabulary. |
| `is_overage` | `boolean` | required | `false` | True when this addon is overage / excess usage. |

### `crm.product_addon_tiers`

Quantity bands for tiered addon pricing.

| Column | Type | Null | Default | Description |
|---|---|---|---|---|
| `id` | `text` | required | — | Primary key (cuid text). |
| `addon_id` | `text` | required | — | Parent addon. |
| `min_qty` | `integer` | required | — | Inclusive lower quantity of the band. |
| `max_qty` | `integer` | nullable | — | Inclusive upper quantity (null = unbounded). |
| `unit_price` | `numeric(12,4)` | required | — | Unit price. |
| `created_at` | `timestamp` | required | `CURRENT_TIMESTAMP` | Row creation timestamp. |
| `updated_at` | `timestamp` | required | — | Last update timestamp. |
| `organization_id` | `bigint` | required | — | Tenant (`accounts.organizations.id`). |

### `crm.price_books`

Org-level rate card (region / market / currency list).

| Column | Type | Null | Default | Description |
|---|---|---|---|---|
| `id` | `text` | required | — | Primary key (cuid text). |
| `organization_id` | `bigint` | required | — | Tenant (`accounts.organizations.id`). |
| `name` | `text` | required | — | Display name. |
| `code` | `text` | nullable | — | Optional stable code (unique per org when set). |
| `currency` | `text` | required | 'USD' | ISO currency (default USD). |
| `is_default` | `boolean` | required | `false` | Default rate card for the org. |
| `created_at` | `timestamp` | required | `CURRENT_TIMESTAMP` | Row creation timestamp. |
| `updated_at` | `timestamp` | required | — | Last update timestamp. |

### `crm.price_book_entries`

List price for exactly one of product, offer, or addon inside a price book.

| Column | Type | Null | Default | Description |
|---|---|---|---|---|
| `id` | `text` | required | — | Primary key (cuid text). |
| `organization_id` | `bigint` | required | — | Tenant (`accounts.organizations.id`). |
| `price_book_id` | `text` | required | — | Parent price book. |
| `product_id` | `text` | nullable | — | FK to `inventory.products.id`. |
| `offer_id` | `text` | nullable | — | Target offer (exactly one of product/offer/addon). |
| `addon_id` | `text` | nullable | — | Target addon (exactly one of product/offer/addon). |
| `amount` | `numeric(12,2)` | required | — | Extended line amount (qty × unit, after line math). |
| `billing_frequency` | `ProductBillingFrequency` | nullable | — | Optional frequency for this list price. |
| `created_at` | `timestamp` | required | `CURRENT_TIMESTAMP` | Row creation timestamp. |
| `updated_at` | `timestamp` | required | — | Last update timestamp. |

### `crm.proposal_templates`

Tenant-owned proposal skeletons (sections + HTML blueprint + inline assets).

| Column | Type | Null | Default | Description |
|---|---|---|---|---|
| `id` | `text` | required | — | Primary key (cuid text). |
| `organization_id` | `bigint` | required | — | Tenant (`accounts.organizations.id`). |
| `name` | `text` | required | — | Display name. |
| `code` | `text` | nullable | — | Optional stable code (unique per org when set). |
| `kind` | `ProposalTemplateKind` | required | 'standard'::crm."ProposalTemplateKind" | Template kind (`standard`). |
| `sections` | `jsonb` | required | — | Document sections JSON: `[{ id, key, title, body, sortOrder }]`. |
| `is_default` | `boolean` | required | `false` | Whether this is the org default template / book. |
| `created_at` | `timestamp` | required | `CURRENT_TIMESTAMP` | Row creation timestamp. |
| `updated_at` | `timestamp` | required | — | Last update timestamp. |
| `blueprint` | `jsonb` | nullable | — | HTML brand blueprint: `{ version, html, css, theme, slots }`. |
| `assets` | `jsonb` | nullable | — | Inline assets: `[{ id, kind, mime, dataBase64 }]`. |

### `crm.proposals`

Customer-facing proposal on a deal. Send/share requires human approval fields.

| Column | Type | Null | Default | Description |
|---|---|---|---|---|
| `id` | `text` | required | — | Primary key (cuid text). |
| `organization_id` | `bigint` | required | — | Tenant (`accounts.organizations.id`). |
| `deal_id` | `text` | required | — | Parent deal (CASCADE). |
| `number` | `text` | required | — | Human-visible document number (unique per org, often with version). |
| `title` | `text` | required | — | Display title. |
| `summary` | `text` | nullable | — | Executive summary shown on the document. |
| `version` | `integer` | required | `1` | Document version (starts at 1). |
| `status` | `ProposalStatus` | required | 'draft'::crm."ProposalStatus" | Workflow status for this record. |
| `attachment_url` | `text` | nullable | — | Optional uploaded PDF / file URL. |
| `shared_at` | `timestamp` | nullable | — | When the proposal was shared with the customer. |
| `created_by_user_id` | `bigint` | nullable | — | User who created the row (`accounts.setup_users.id`). |
| `created_at` | `timestamp` | required | `CURRENT_TIMESTAMP` | Row creation timestamp. |
| `updated_at` | `timestamp` | required | — | Last update timestamp. |
| `template_id` | `text` | nullable | — | FK to the matching `*_templates` row. |
| `sections` | `jsonb` | nullable | — | Document sections JSON: `[{ id, key, title, body, sortOrder }]`. |
| `customer_name` | `text` | nullable | — | Display name used in the document (company or contact). |
| `blueprint` | `jsonb` | nullable | — | HTML brand blueprint: `{ version, html, css, theme, slots }`. |
| `assets` | `jsonb` | nullable | — | Inline assets: `[{ id, kind, mime, dataBase64 }]`. |
| `approved_by_user_id` | `bigint` | nullable | — | User who approved send (`accounts.setup_users.id`). |
| `approved_at` | `timestamptz` | nullable | — | When human approval was recorded. |
| `approval_status` | `varchar(32)` | required | 'drafting' | Human approval workflow (`drafting`, approved, rejected, …). |

### `crm.quote_templates`

Tenant-owned quotation document skeletons.

| Column | Type | Null | Default | Description |
|---|---|---|---|---|
| `id` | `text` | required | — | Primary key (cuid text). |
| `organization_id` | `bigint` | required | — | Tenant (`accounts.organizations.id`). |
| `name` | `text` | required | — | Display name. |
| `code` | `text` | nullable | — | Optional stable code (unique per org when set). |
| `kind` | `QuoteTemplateKind` | required | 'standard'::crm."QuoteTemplateKind" | Template kind (`standard`). |
| `sections` | `jsonb` | required | — | Document sections JSON: `[{ id, key, title, body, sortOrder }]`. |
| `is_default` | `boolean` | required | `false` | Whether this is the org default template / book. |
| `created_at` | `timestamp` | required | `CURRENT_TIMESTAMP` | Row creation timestamp. |
| `updated_at` | `timestamp` | required | — | Last update timestamp. |
| `blueprint` | `jsonb` | nullable | — | HTML brand blueprint: `{ version, html, css, theme, slots }`. |
| `assets` | `jsonb` | nullable | — | Inline assets: `[{ id, kind, mime, dataBase64 }]`. |

### `crm.quotes`

**Refer here for:** **B2B quotations** on a deal. Line products are `inventory.products`. Person/company names on the document are denormalized; live contact data stays in CDP.

Formal quote on a deal. May originate from a proposal. Accept creates an order (and optionally an invoice).

| Column | Type | Null | Default | Description |
|---|---|---|---|---|
| `id` | `text` | required | — | Primary key (cuid text). |
| `organization_id` | `bigint` | required | — | Tenant (`accounts.organizations.id`). |
| `deal_id` | `text` | required | — | FK to `crm.deals.id`. |
| `number` | `text` | required | — | Human-visible document number (unique per org, often with version). |
| `version` | `integer` | required | `1` | Document version (starts at 1). |
| `status` | `QuoteStatus` | required | 'draft'::crm."QuoteStatus" | Workflow status for this record. |
| `currency` | `text` | required | 'USD' | ISO currency (default USD). |
| `subtotal` | `numeric(12,2)` | required | `0` | Sum of lines before discount. |
| `discount_pct` | `numeric(5,2)` | required | `0` | Header discount percent. |
| `total` | `numeric(12,2)` | required | `0` | Document total. |
| `valid_until` | `timestamp` | nullable | — | Quote expiry. |
| `notes` | `text` | nullable | — | Free-text notes. |
| `sent_at` | `timestamp` | nullable | — | When the quote was sent. |
| `accepted_at` | `timestamp` | nullable | — | When the customer accepted. |
| `created_by_user_id` | `bigint` | nullable | — | User who created the row (`accounts.setup_users.id`). |
| `created_at` | `timestamp` | required | `CURRENT_TIMESTAMP` | Row creation timestamp. |
| `updated_at` | `timestamp` | required | — | Last update timestamp. |
| `proposal_id` | `text` | nullable | — | Optional source proposal. |
| `template_id` | `text` | nullable | — | FK to the matching `*_templates` row. |
| `document_sections` | `jsonb` | nullable | — | Customer-specific sections after template merge. |
| `customer_name` | `text` | nullable | — | Bill-to / customer display name. |
| `company_name` | `text` | nullable | — | Account name printed on the quote. |
| `vendor_name` | `text` | nullable | — | Seller name printed on the quote. |
| `blueprint` | `jsonb` | nullable | — | HTML brand blueprint: `{ version, html, css, theme, slots }`. |
| `assets` | `jsonb` | nullable | — | Inline assets: `[{ id, kind, mime, dataBase64 }]`. |
| `approved_by_user_id` | `bigint` | nullable | — | User who approved send (`accounts.setup_users.id`). |
| `approved_at` | `timestamptz` | nullable | — | When human approval was recorded. |
| `approval_status` | `varchar(32)` | required | 'drafting' | Human approval workflow (`drafting`, approved, rejected, …). |
| `approval_note` | `text` | nullable | — | Finance approve/reject note (reject requires a reason). |

### `crm.quote_lines`

Line items on a quote. `product_id` points at `inventory.products.id`.

| Column | Type | Null | Default | Description |
|---|---|---|---|---|
| `id` | `text` | required | — | Primary key (cuid text). |
| `quote_id` | `text` | required | — | Parent quote (CASCADE). |
| `product_id` | `text` | nullable | — | FK to `inventory.products.id`. |
| `name` | `text` | required | — | Display name. |
| `quantity` | `numeric(12,2)` | required | `1` | Line quantity. |
| `unit_price` | `numeric(12,2)` | required | — | Unit price. |
| `amount` | `numeric(12,2)` | required | — | Extended line amount (qty × unit, after line math). |
| `sort_order` | `integer` | required | `0` | Display / line order (0-based). |
| `created_at` | `timestamp` | required | `CURRENT_TIMESTAMP` | Row creation timestamp. |
| `updated_at` | `timestamp` | required | — | Last update timestamp. |
| `organization_id` | `bigint` | required | — | Tenant (`accounts.organizations.id`). |

### `crm.sales_orders`

**Refer here for:** **confirmed orders**. B2B: from accepted quote + deal. B2C: contact-first — `deal_id` null, `contact_id` = **`cdp_id`**. Buyer identity is still CDP.

Confirmed order.

| Column | Type | Null | Default | Description |
|---|---|---|---|---|
| `id` | `text` | required | — | Primary key (cuid text). |
| `organization_id` | `bigint` | required | — | Tenant (`accounts.organizations.id`). |
| `deal_id` | `text` | nullable | — | FK to `crm.deals.id`. |
| `quote_id` | `text` | nullable | — | Source quote (optional). |
| `company_id` | `text` | nullable | — | FK to `crm.companies.id`. |
| `number` | `text` | required | — | Human-visible document number (unique per org, often with version). |
| `status` | `OrderStatus` | required | 'confirmed'::crm."OrderStatus" | Workflow status for this record. |
| `currency` | `text` | required | 'USD' | ISO currency (default USD). |
| `total` | `numeric(12,2)` | required | `0` | Document total. |
| `confirmed_at` | `timestamp` | nullable | — | When the order was confirmed. |
| `created_by_user_id` | `bigint` | nullable | — | User who created the row (`accounts.setup_users.id`). |
| `created_at` | `timestamp` | required | `CURRENT_TIMESTAMP` | Row creation timestamp. |
| `updated_at` | `timestamp` | required | — | Last update timestamp. |
| `contact_id` | `text` | nullable | — | CDP person key (`cdp.customer_profile.cdp_id`). |

### `crm.order_lines`

Line items on a sales order. `product_id` points at `inventory.products.id`.

| Column | Type | Null | Default | Description |
|---|---|---|---|---|
| `id` | `text` | required | — | Primary key (cuid text). |
| `order_id` | `text` | required | — | Parent sales order (CASCADE). |
| `product_id` | `text` | nullable | — | FK to `inventory.products.id`. |
| `name` | `text` | required | — | Display name. |
| `quantity` | `numeric(12,2)` | required | `1` | Line quantity. |
| `unit_price` | `numeric(12,2)` | required | — | Unit price. |
| `amount` | `numeric(12,2)` | required | — | Extended line amount (qty × unit, after line math). |
| `sort_order` | `integer` | required | `0` | Display / line order (0-based). |
| `created_at` | `timestamp` | required | `CURRENT_TIMESTAMP` | Row creation timestamp. |
| `updated_at` | `timestamp` | required | — | Last update timestamp. |
| `organization_id` | `bigint` | required | — | Tenant (`accounts.organizations.id`). |

### `crm.invoice_templates`

Tenant-owned invoice document skeletons.

| Column | Type | Null | Default | Description |
|---|---|---|---|---|
| `id` | `text` | required | — | Primary key (cuid text). |
| `organization_id` | `bigint` | required | — | Tenant (`accounts.organizations.id`). |
| `name` | `text` | required | — | Display name. |
| `code` | `text` | nullable | — | Optional stable code (unique per org when set). |
| `kind` | `InvoiceTemplateKind` | required | 'standard'::crm."InvoiceTemplateKind" | Template kind (`standard`). |
| `sections` | `jsonb` | required | — | Document sections JSON: `[{ id, key, title, body, sortOrder }]`. |
| `blueprint` | `jsonb` | nullable | — | HTML brand blueprint: `{ version, html, css, theme, slots }`. |
| `assets` | `jsonb` | nullable | — | Inline assets: `[{ id, kind, mime, dataBase64 }]`. |
| `is_default` | `boolean` | required | `false` | Whether this is the org default template / book. |
| `created_at` | `timestamp` | required | `CURRENT_TIMESTAMP` | Row creation timestamp. |
| `updated_at` | `timestamp` | required | — | Last update timestamp. |

### `crm.invoices`

**Refer here for:** **Finance invoices** (B2B / B2B2C only — B2C must not enable Finance). Seller letterhead name comes from `accounts.organizations.company_name`.

Finance invoice. From quote-accept / order, or created from a deal. Collections agent only writes escalation overlay fields.

| Column | Type | Null | Default | Description |
|---|---|---|---|---|
| `id` | `text` | required | — | Primary key (cuid text). |
| `organization_id` | `bigint` | required | — | Tenant (`accounts.organizations.id`). |
| `order_id` | `text` | nullable | — | Source order (quote-accept / commerce). |
| `company_id` | `text` | nullable | — | FK to `crm.companies.id`. |
| `number` | `text` | required | — | Human-visible document number (unique per org, often with version). |
| `status` | `InvoiceStatus` | required | 'draft'::crm."InvoiceStatus" | Workflow status for this record. |
| `currency` | `text` | required | 'USD' | ISO currency (default USD). |
| `total` | `numeric(12,2)` | required | `0` | Document total. |
| `due_at` | `timestamp` | nullable | — | Due / reminder datetime. |
| `paid_at` | `timestamp` | nullable | — | When marked paid. |
| `created_by_user_id` | `bigint` | nullable | — | User who created the row (`accounts.setup_users.id`). |
| `created_at` | `timestamp` | required | `CURRENT_TIMESTAMP` | Row creation timestamp. |
| `updated_at` | `timestamp` | required | — | Last update timestamp. |
| `deal_id` | `text` | nullable | — | FK to `crm.deals.id`. |
| `discount_amount` | `numeric(12,2)` | required | `0` | Header discount amount. |
| `tax_amount` | `numeric(12,2)` | required | `0` | Total tax. |
| `issue_date` | `timestamp` | nullable | — | Invoice issue date. |
| `payment_terms` | `text` | nullable | — | Payment terms text. |
| `notes` | `text` | nullable | — | Free-text notes. |
| `billing_address` | `text` | nullable | — | Bill-to address. |
| `lead_email` | `text` | nullable | — | Billing contact email. |
| `lead_phone` | `text` | nullable | — | Billing contact phone. |
| `tax_id` | `text` | nullable | — | Customer tax id printed on the invoice. |
| `tax_details` | `jsonb` | nullable | — | Tax snapshot (GST / VAT / sales-tax components). |
| `template_id` | `text` | nullable | — | FK to the matching `*_templates` row. |
| `sections` | `jsonb` | nullable | — | Document sections JSON: `[{ id, key, title, body, sortOrder }]`. |
| `blueprint` | `jsonb` | nullable | — | HTML brand blueprint: `{ version, html, css, theme, slots }`. |
| `assets` | `jsonb` | nullable | — | Inline assets: `[{ id, kind, mime, dataBase64 }]`. |
| `approved_by_user_id` | `bigint` | nullable | — | User who approved send (`accounts.setup_users.id`). |
| `approved_at` | `timestamptz` | nullable | — | When human approval was recorded. |
| `approval_status` | `varchar(32)` | required | 'drafting' | Human approval workflow (`drafting`, approved, rejected, …). |
| `escalation_severity` | `varchar(16)` | nullable | — | Collections-risk severity overlay. |
| `escalation_reason` | `text` | nullable | — | Why the invoice was escalated. |
| `escalation_draft` | `text` | nullable | — | Draft chase email (human sends). Agent never marks paid/void. |
| `escalation_last_run_at` | `timestamptz` | nullable | — | Last collections-agent run. |

### `crm.invoice_lines`

Invoice line (product or addon) with tax percent.

| Column | Type | Null | Default | Description |
|---|---|---|---|---|
| `id` | `text` | required | — | Primary key (cuid text). |
| `invoice_id` | `text` | required | — | Parent invoice (CASCADE). |
| `kind` | `InvoiceLineKind` | required | 'product'::crm."InvoiceLineKind" | product or addon. |
| `product_id` | `text` | nullable | — | FK to `inventory.products.id`. |
| `addon_id` | `text` | nullable | — | FK to `crm.product_addons.id` when kind = addon. |
| `name` | `text` | required | — | Display name. |
| `description` | `text` | nullable | — | Line description. |
| `quantity` | `numeric(12,2)` | required | `1` | Line quantity. |
| `unit_price` | `numeric(12,4)` | required | — | Unit price. |
| `tax_percent` | `numeric(5,2)` | required | `0` | Line tax percent. |
| `amount` | `numeric(12,2)` | required | — | Extended line amount (qty × unit, after line math). |
| `sort_order` | `integer` | required | `0` | Display / line order (0-based). |
| `created_at` | `timestamp` | required | `CURRENT_TIMESTAMP` | Row creation timestamp. |
| `updated_at` | `timestamp` | required | — | Last update timestamp. |
| `organization_id` | `bigint` | required | — | Tenant (`accounts.organizations.id`). |

### `crm.contracts`

Subscription / ARR record after closed-won. Drives renewal reminders.

| Column | Type | Null | Default | Description |
|---|---|---|---|---|
| `id` | `text` | required | — | Primary key (cuid text). |
| `organization_id` | `bigint` | required | — | Tenant (`accounts.organizations.id`). |
| `company_id` | `text` | required | — | FK to `crm.companies.id`. |
| `deal_id` | `text` | nullable | — | FK to `crm.deals.id`. |
| `title` | `text` | required | — | Display title. |
| `starts_at` | `timestamp` | required | — | Contract start. |
| `ends_at` | `timestamp` | required | — | Contract end (renewal reminders use this). |
| `arr` | `numeric(12,2)` | nullable | — | Annual recurring revenue. |
| `renew_deal_id` | `text` | nullable | — | Linked renewal opportunity. |
| `renewal_reminded_at` | `timestamp` | nullable | — | When a renewal reminder was last sent. |
| `created_at` | `timestamp` | required | `CURRENT_TIMESTAMP` | Row creation timestamp. |
| `updated_at` | `timestamp` | required | — | Last update timestamp. |

### `crm.audit_logs`

Immutable CRM change log (create, update, stage change, quote sent, merge, …).

| Column | Type | Null | Default | Description |
|---|---|---|---|---|
| `id` | `text` | required | — | Primary key (cuid text). |
| `organization_id` | `bigint` | required | — | Tenant (`accounts.organizations.id`). |
| `actor_user_id` | `bigint` | nullable | — | Who acted (`accounts.setup_users.id`). Null for system. |
| `action` | `AuditAction` | required | — | Audit action enum. |
| `entity_type` | `text` | required | — | Entity kind (`deal`, `contact`, `quote`, …). |
| `entity_id` | `text` | required | — | Entity primary key. |
| `meta` | `jsonb` | nullable | — | Optional JSON payload. |
| `created_at` | `timestamp` | required | `CURRENT_TIMESTAMP` | Row creation timestamp. |

### `crm.report_snapshots`

Cached JSON rollups for dashboard analytics so the UI does not scan live OLTP.

| Column | Type | Null | Default | Description |
|---|---|---|---|---|
| `id` | `text` | required | — | Primary key (cuid text). |
| `organization_id` | `bigint` | required | — | Tenant (`accounts.organizations.id`). |
| `kind` | `text` | required | — | Snapshot kind (dashboard metric set). |
| `payload` | `jsonb` | required | — | Rolled-up JSON. |
| `generated_at` | `timestamp` | required | `CURRENT_TIMESTAMP` | When the snapshot was built. |

### `crm.domain_enrichment_cache`

Cached firmographics per email/company domain (about 30-day TTL).

| Column | Type | Null | Default | Description |
|---|---|---|---|---|
| `id` | `text` | required | — | Primary key (cuid text). |
| `organization_id` | `bigint` | required | — | Tenant (`accounts.organizations.id`). |
| `domain` | `varchar(255)` | required | — | Email or company domain (unique per org). |
| `payload` | `jsonb` | required | — | Cached firmographic JSON. |
| `source` | `text` | nullable | — | Enrichment provider / heuristic source. |
| `expires_at` | `timestamp` | required | — | TTL; stale rows are ignored. |
| `created_at` | `timestamp` | required | `CURRENT_TIMESTAMP` | Row creation timestamp. |
| `updated_at` | `timestamp` | required | `CURRENT_TIMESTAMP` | Last update timestamp. |

### `crm.lead_enrichment_snapshots`

Enrichment agent snapshot per contact. Never silently overwrites user-edited CRM/CDP fields.

| Column | Type | Null | Default | Description |
|---|---|---|---|---|
| `id` | `text` | required | — | Primary key (cuid text). |
| `organization_id` | `bigint` | required | — | Tenant (`accounts.organizations.id`). |
| `contact_id` | `text` | required | — | CDP person key (`cdp.customer_profile.cdp_id`). |
| `company_name` | `text` | nullable | — | Enriched company name. |
| `company_size` | `text` | nullable | — | Enriched size band. |
| `industry` | `text` | nullable | — | Enriched industry. |
| `revenue_band` | `text` | nullable | — | Enriched revenue band. |
| `seniority_tier` | `varchar(32)` | nullable | — | Enriched contact seniority. |
| `geography` | `text` | nullable | — | Enriched geo. |
| `email_domain_type` | `varchar(16)` | nullable | — | corporate / public / unknown. |
| `enrichment_confidence` | `float8` | nullable | — | 0–1 confidence. |
| `enrichment_source` | `text` | nullable | — | Provider or `heuristic` / `llm_*`. |
| `conflict_flags` | `jsonb` | nullable | — | Fields that conflict with user-entered data. |
| `enrichment_timestamp` | `timestamp` | required | `CURRENT_TIMESTAMP` | When this snapshot was produced. |
| `created_at` | `timestamp` | required | `CURRENT_TIMESTAMP` | Row creation timestamp. |
| `updated_at` | `timestamp` | required | `CURRENT_TIMESTAMP` | Last update timestamp. |
| `company_description` | `text` | nullable | — | Enriched company blurb. |
| `products` | `text` | nullable | — | Enriched product list text. |

### `crm.lead_enrichment_jobs`

Queue for firmographic enrichment. A CDP insert trigger can enqueue a row.

| Column | Type | Null | Default | Description |
|---|---|---|---|---|
| `id` | `text` | required | — | Primary key (cuid text). |
| `organization_id` | `bigint` | required | — | Tenant (`accounts.organizations.id`). |
| `contact_id` | `text` | required | — | CDP person key (`cdp.customer_profile.cdp_id`). |
| `company_id` | `text` | nullable | — | FK to `crm.companies.id`. |
| `status` | `LeadEnrichmentStatus` | required | 'pending'::crm."LeadEnrichmentStatus" | Workflow status for this record. |
| `attempts` | `integer` | required | `0` | Number of worker attempts so far. |
| `max_attempts` | `integer` | required | `5` | Retry ceiling before permanent failure. |
| `next_retry_at` | `timestamp` | nullable | — | Earliest time the worker should retry. |
| `last_error` | `text` | nullable | — | Last processing error message. |
| `result_summary` | `jsonb` | nullable | — | JSON summary of the agent/job outcome. |
| `created_at` | `timestamp` | required | `CURRENT_TIMESTAMP` | Row creation timestamp. |
| `updated_at` | `timestamp` | required | — | Last update timestamp. |
| `completed_at` | `timestamp` | nullable | — | When processing finished successfully. |

### `crm.lead_summaries`

AI narrative summary per lead. Regenerated when the lead signature changes.

| Column | Type | Null | Default | Description |
|---|---|---|---|---|
| `id` | `text` | required | — | Primary key (cuid text). |
| `organization_id` | `bigint` | required | — | Tenant (`accounts.organizations.id`). |
| `contact_id` | `text` | required | — | CDP person key (`cdp.customer_profile.cdp_id`). |
| `summary` | `text` | required | — | Full narrative. |
| `headline` | `text` | nullable | — | One-line headline. |
| `intent` | `text` | nullable | — | Inferred intent. |
| `signature` | `text` | required | — | Hash of inputs; change triggers regenerate. |
| `source` | `text` | required | 'heuristic' | `llm` or `heuristic` (offline fallback). |
| `model` | `text` | nullable | — | LLM model id when source = llm. |
| `created_at` | `timestamp` | required | `CURRENT_TIMESTAMP` | Row creation timestamp. |
| `updated_at` | `timestamp` | required | — | Last update timestamp. |
| `recommended_action` | `text` | nullable | — | Next-best-action text. |
| `flags` | `jsonb` | nullable | — | JSON flags (risk, missing data, …). |

### `crm.lead_scoring_jobs`

Lead Scoring Agent queue — one row per contact. Fit + intent → band (hot/warm/cold).

| Column | Type | Null | Default | Description |
|---|---|---|---|---|
| `id` | `text` | required | — | Primary key (cuid text). |
| `organization_id` | `bigint` | required | — | Tenant (`accounts.organizations.id`). |
| `contact_id` | `text` | required | — | CDP person key (`cdp.customer_profile.cdp_id`). |
| `status` | `LeadScoringStatus` | required | 'pending'::crm."LeadScoringStatus" | Workflow status for this record. |
| `score` | `integer` | nullable | — | Combined score. |
| `grade` | `text` | nullable | — | Letter or label grade. |
| `band` | `text` | nullable | — | hot / warm / cold (gate typically ≥ 40). |
| `rationale` | `text` | nullable | — | LLM rationale. |
| `factors` | `jsonb` | nullable | — | Scored factor JSON. |
| `next_best_action` | `text` | nullable | — | Recommended next action. |
| `trigger_reason` | `text` | nullable | — | Why this rescore ran. |
| `previous_score` | `integer` | nullable | — | Score before this run. |
| `attempts` | `integer` | required | `0` | Number of worker attempts so far. |
| `max_attempts` | `integer` | required | `5` | Retry ceiling before permanent failure. |
| `next_retry_at` | `timestamp` | nullable | — | Earliest time the worker should retry. |
| `last_error` | `text` | nullable | — | Last processing error message. |
| `result_summary` | `jsonb` | nullable | — | JSON summary of the agent/job outcome. |
| `created_at` | `timestamp` | required | `CURRENT_TIMESTAMP` | Row creation timestamp. |
| `updated_at` | `timestamp` | required | `CURRENT_TIMESTAMP` | Last update timestamp. |
| `completed_at` | `timestamp` | nullable | — | When processing finished successfully. |
| `fit_score` | `integer` | nullable | — | ICP / firmographic fit. |
| `intent_score` | `integer` | nullable | — | Engagement / intent. |

### `crm.lead_nurture_jobs`

Nurture / re-engage queue. Agent decides nurture_now | wait | skip. Sends from the org CRM bot mailbox.

| Column | Type | Null | Default | Description |
|---|---|---|---|---|
| `id` | `text` | required | — | Primary key (cuid text). |
| `organization_id` | `bigint` | required | — | Tenant (`accounts.organizations.id`). |
| `contact_id` | `text` | required | — | CDP person key (`cdp.customer_profile.cdp_id`). |
| `status` | `LeadNurtureStatus` | required | 'pending'::crm."LeadNurtureStatus" | Workflow status for this record. |
| `decision` | `text` | nullable | — | nurture_now / wait / skip_not_interested (or similar). |
| `attempts` | `integer` | required | `0` | Number of worker attempts so far. |
| `max_attempts` | `integer` | required | `5` | Retry ceiling before permanent failure. |
| `next_retry_at` | `timestamp` | nullable | — | Earliest time the worker should retry. |
| `last_error` | `text` | nullable | — | Last processing error message. |
| `result_summary` | `jsonb` | nullable | — | JSON summary of the agent/job outcome. |
| `last_sent_at` | `timestamp` | nullable | — | Last nurture email send. |
| `created_at` | `timestamp` | required | `CURRENT_TIMESTAMP` | Row creation timestamp. |
| `updated_at` | `timestamp` | required | — | Last update timestamp. |
| `completed_at` | `timestamp` | nullable | — | When processing finished successfully. |
| `nurture_status` | `varchar(32)` | nullable | — | Sequence status overlay. |
| `current_sequence_step` | `integer` | nullable | — | Step index in the sequence. |
| `sequence_started_at` | `timestamp` | nullable | — | When the sequence started. |

### `crm.lead_lifecycle_jobs`

Lifecycle Agent queue. Owns lead_status / CDP contact_type / deal stage moves from CRM signals.

| Column | Type | Null | Default | Description |
|---|---|---|---|---|
| `id` | `text` | required | — | Primary key (cuid text). |
| `organization_id` | `bigint` | required | — | Tenant (`accounts.organizations.id`). |
| `contact_id` | `text` | required | — | CDP person key (`cdp.customer_profile.cdp_id`). |
| `status` | `LeadLifecycleStatus` | required | 'pending'::crm."LeadLifecycleStatus" | Workflow status for this record. |
| `ladder` | `text` | nullable | — | Which ladder moved: `lead_status` \| `lifecycle` \| `pipeline` \| `none`. |
| `from_stage` | `text` | nullable | — | Stage before the move. |
| `to_stage` | `text` | nullable | — | Stage after the move. |
| `decision` | `text` | nullable | — | apply / wait / skip. |
| `reason` | `text` | nullable | — | Why the agent decided that. |
| `trigger_reason` | `text` | nullable | — | What signal enqueued the job. |
| `deal_id` | `text` | nullable | — | FK to `crm.deals.id`. |
| `attempts` | `integer` | required | `0` | Number of worker attempts so far. |
| `max_attempts` | `integer` | required | `5` | Retry ceiling before permanent failure. |
| `next_retry_at` | `timestamp` | nullable | — | Earliest time the worker should retry. |
| `last_error` | `text` | nullable | — | Last processing error message. |
| `result_summary` | `jsonb` | nullable | — | JSON summary of the agent/job outcome. |
| `last_applied_at` | `timestamp` | nullable | — | Last time a stage write was applied. |
| `created_at` | `timestamp` | required | `CURRENT_TIMESTAMP` | Row creation timestamp. |
| `updated_at` | `timestamp` | required | — | Last update timestamp. |
| `completed_at` | `timestamp` | nullable | — | When processing finished successfully. |

### `crm.email_auto_reply_jobs`

One row per inbound email. Safe mail can auto-reply; sensitive mail is escalated to a human.

| Column | Type | Null | Default | Description |
|---|---|---|---|---|
| `id` | `text` | required | — | Primary key (cuid text). |
| `organization_id` | `bigint` | required | — | Tenant (`accounts.organizations.id`). |
| `contact_id` | `text` | required | — | CDP person key (`cdp.customer_profile.cdp_id`). |
| `inbound_activity_id` | `text` | required | — | Inbound `contact_activities` row that triggered this job (unique). |
| `mailbox_user_id` | `bigint` | nullable | — | Mailbox owner whose OAuth received the mail. |
| `status` | `EmailAutoReplyStatus` | required | 'pending'::crm."EmailAutoReplyStatus" | Workflow status for this record. |
| `decision` | `text` | nullable | — | reply / escalate / skip. |
| `sensitivity` | `text` | nullable | — | safe \| sensitive \| unknown. |
| `category` | `text` | nullable | — | Inbound category (demo request, support, …). |
| `reason` | `text` | nullable | — | Why that decision was taken. |
| `reply_activity_id` | `text` | nullable | — | Outbound activity created after a send. |
| `escalated_to_user_id` | `bigint` | nullable | — | Human who must answer. |
| `attempts` | `integer` | required | `0` | Number of worker attempts so far. |
| `max_attempts` | `integer` | required | `3` | Retry ceiling before permanent failure. |
| `next_retry_at` | `timestamp` | nullable | — | Earliest time the worker should retry. |
| `last_error` | `text` | nullable | — | Last processing error message. |
| `result_summary` | `jsonb` | nullable | — | JSON summary of the agent/job outcome. |
| `created_at` | `timestamp` | required | `CURRENT_TIMESTAMP` | Row creation timestamp. |
| `updated_at` | `timestamp` | required | `CURRENT_TIMESTAMP` | Last update timestamp. |
| `completed_at` | `timestamp` | nullable | — | When processing finished successfully. |

### `crm.agent_step_events`

Curated step trace for proactive agent runs (one row per graph node per job). No raw prompt dumps.

| Column | Type | Null | Default | Description |
|---|---|---|---|---|
| `id` | `text` | required | — | Primary key (cuid text). |
| `organization_id` | `bigint` | required | — | Tenant (`accounts.organizations.id`). |
| `agent` | `text` | required | — | Agent name (enrich, score, nurture, …). |
| `job_id` | `text` | required | — | Parent job id. Unique with `step`. |
| `contact_id` | `text` | nullable | — | CDP person key (`cdp.customer_profile.cdp_id`). |
| `step` | `text` | required | — | Graph node / step key. |
| `label` | `text` | required | — | Human label for the trace UI. |
| `status` | `AgentStepStatus` | required | 'started'::crm."AgentStepStatus" | started / ok / failed / skipped. |
| `detail` | `jsonb` | nullable | — | Small curated facts only — never raw HTML or prompts. |
| `error_reason` | `text` | nullable | — | Failure reason. |
| `started_at` | `timestamp` | required | `CURRENT_TIMESTAMP` | Step start. |
| `ended_at` | `timestamp` | nullable | — | Step end. |

### `crm.meeting_assist_sessions`

Live / post-meeting assist session — one per meeting `contact_activities` row.

| Column | Type | Null | Default | Description |
|---|---|---|---|---|
| `id` | `text` | required | — | Primary key (cuid text). |
| `organization_id` | `bigint` | required | — | Tenant (`accounts.organizations.id`). |
| `contact_id` | `text` | required | — | CDP person key (`cdp.customer_profile.cdp_id`). |
| `activity_id` | `text` | required | — | FK to `crm.contact_activities.id`. |
| `provider` | `meeting_assist_provider` | required | 'other'::crm.meeting_assist_provider | google_meet / zoom / teams / other. |
| `external_meeting_id` | `text` | nullable | — | Provider meeting id. |
| `join_url` | `text` | nullable | — | Join URL. |
| `host_user_id` | `bigint` | nullable | — | Host user (`accounts.setup_users.id`). |
| `status` | `meeting_assist_status` | required | 'active'::crm.meeting_assist_status | Workflow status for this record. |
| `started_at` | `timestamp` | required | `CURRENT_TIMESTAMP` | Session start. |
| `ended_at` | `timestamp` | nullable | — | Session end. |
| `last_assist_at` | `timestamp` | nullable | — | Last live-assist suggestion time. |
| `last_suggestions` | `jsonb` | nullable | — | Last suggestion payload. |
| `meta` | `jsonb` | nullable | — | Provider metadata. |
| `created_at` | `timestamp` | required | `CURRENT_TIMESTAMP` | Row creation timestamp. |
| `updated_at` | `timestamp` | required | — | Last update timestamp. |

### `crm.meeting_transcript_chunks`

Streaming transcript segments. On finalize they roll up to `contact_activities.transcript_text`.

| Column | Type | Null | Default | Description |
|---|---|---|---|---|
| `id` | `text` | required | — | Primary key (cuid text). |
| `session_id` | `text` | required | — | Parent assist session (CASCADE). |
| `seq` | `integer` | required | — | Monotonic sequence in the session. |
| `speaker` | `text` | nullable | — | Speaker display name. |
| `text` | `text` | required | — | Utterance text. |
| `spoken_at` | `timestamp` | nullable | — | When the utterance was spoken. |
| `source` | `text` | required | 'live_push' | live_push \| zoom_webhook \| teams_graph \| google_drive \| speech_api \| manual. |
| `created_at` | `timestamp` | required | `CURRENT_TIMESTAMP` | Row creation timestamp. |
| `organization_id` | `bigint` | required | — | Tenant (`accounts.organizations.id`). |
| `speaker_email` | `varchar(320)` | nullable | — | Speaker email when known. |

### `crm.meeting_analyses`

Structured meeting evidence for Lifecycle (outcome, BANT, objections). Never stores the raw transcript.

| Column | Type | Null | Default | Description |
|---|---|---|---|---|
| `id` | `text` | required | — | Primary key (cuid text). |
| `organization_id` | `bigint` | required | — | Tenant (`accounts.organizations.id`). |
| `activity_id` | `text` | required | — | FK to `crm.contact_activities.id`. |
| `contact_id` | `text` | nullable | — | CDP person key (`cdp.customer_profile.cdp_id`). |
| `deal_id` | `text` | nullable | — | FK to `crm.deals.id`. |
| `outcome` | `varchar(32)` | nullable | — | Meeting outcome label. |
| `bant_budget` | `boolean` | nullable | — | Budget signal from the meeting. |
| `bant_authority` | `boolean` | nullable | — | Authority signal. |
| `bant_need` | `boolean` | nullable | — | Need signal. |
| `bant_timeline_text` | `varchar(256)` | nullable | — | Timeline phrasing extracted from the meeting. |
| `next_step_agreed` | `text` | nullable | — | Next step the parties agreed. |
| `objections_raised` | `jsonb` | required | '[]'::jsonb | JSON array of objections. |
| `confidence` | `float8` | required | `0` | Analysis confidence 0–1. |
| `evidence` | `jsonb` | required | '[]'::jsonb | JSON evidence snippets (not full transcript). |
| `analyzed_at` | `timestamptz` | required | `now()` | When analysis ran. |
| `created_at` | `timestamptz` | required | `now()` | Row creation timestamp. |

### `crm.coaching_insights`

Private per-interaction coaching for the rep. Managers only see aggregate counts, never raw note text.

| Column | Type | Null | Default | Description |
|---|---|---|---|---|
| `id` | `text` | required | — | Primary key (cuid text). |
| `organization_id` | `bigint` | required | — | Tenant (`accounts.organizations.id`). |
| `activity_id` | `text` | required | — | FK to `crm.contact_activities.id`. |
| `contact_id` | `text` | nullable | — | CDP person key (`cdp.customer_profile.cdp_id`). |
| `deal_id` | `text` | nullable | — | FK to `crm.deals.id`. |
| `rep_user_id` | `bigint` | required | — | Rep who ran the interaction. |
| `interaction_type` | `varchar(16)` | required | — | call / meeting / email / … |
| `overall_impression` | `varchar(16)` | required | — | Qualitative band — not a performance score. |
| `discovery_quality` | `text` | nullable | — | Discovery coaching note. |
| `objection_handling` | `text` | nullable | — | Objection-handling note. |
| `methodology_note` | `text` | nullable | — | Methodology note. |
| `talk_balance_note` | `text` | nullable | — | Talk/listen balance note. |
| `strengths` | `jsonb` | required | '[]'::jsonb | JSON array of strengths. |
| `growth_areas` | `jsonb` | required | '[]'::jsonb | JSON array of growth areas. |
| `highlighted_moment` | `text` | nullable | — | One highlighted moment (private). |
| `coaching_note` | `text` | nullable | — | Private coaching paragraph. Managers never see raw text. |
| `analyzed_at` | `timestamptz` | required | `now()` | When coaching was generated. |
| `created_at` | `timestamptz` | required | `now()` | Row creation timestamp. |

### `crm.privacy_requests`

Human-gated data-access / deletion requests. Agent classifies and drafts; an admin must execute.

| Column | Type | Null | Default | Description |
|---|---|---|---|---|
| `id` | `text` | required | — | Primary key (cuid text). |
| `organization_id` | `bigint` | required | — | Tenant (`accounts.organizations.id`). |
| `activity_id` | `text` | required | — | FK to `crm.contact_activities.id`. |
| `contact_id` | `text` | required | — | CDP person key (`cdp.customer_profile.cdp_id`). |
| `request_type` | `varchar(24)` | required | — | access / deletion / … |
| `confidence` | `varchar(16)` | required | — | Classifier confidence band. |
| `status` | `varchar(24)` | required | 'pending_review' | Default `pending_review` until an admin executes. |
| `reason` | `text` | nullable | — | Why this was classified as a privacy request. |
| `draft_confirmation` | `text` | nullable | — | Draft confirmation the admin can send. |
| `reviewed_by_user_id` | `bigint` | nullable | — | Admin who reviewed. |
| `reviewed_at` | `timestamptz` | nullable | — | Review timestamp. |
| `executed_at` | `timestamptz` | nullable | — | When deletion/access was actually executed. |
| `created_at` | `timestamptz` | required | `now()` | Row creation timestamp. |
| `updated_at` | `timestamptz` | required | `now()` | Last update timestamp. |

### `crm.process_confirmations`

Owner approval gate for post-meeting process actions (email proposal, close won/lost, quote send/accept).

| Column | Type | Null | Default | Description |
|---|---|---|---|---|
| `id` | `text` | required | — | Primary key (cuid text). |
| `organization_id` | `bigint` | required | — | Tenant (`accounts.organizations.id`). |
| `contact_id` | `text` | required | — | CDP person key (`cdp.customer_profile.cdp_id`). |
| `owner_user_id` | `bigint` | required | — | Approver (deal/contact owner). |
| `activity_id` | `text` | nullable | — | FK to `crm.contact_activities.id`. |
| `deal_id` | `text` | nullable | — | FK to `crm.deals.id`. |
| `action_kind` | `text` | required | — | email_proposal \| book_meeting \| close_won \| close_lost \| quote_send \| quote_accept. |
| `title` | `text` | required | — | Display title. |
| `summary` | `text` | nullable | — | Short explanation of the proposed action. |
| `payload` | `jsonb` | required | — | Action payload the worker will execute if approved. |
| `status` | `ProcessConfirmationStatus` | required | 'pending'::crm."ProcessConfirmationStatus" | Workflow status for this record. |
| `decided_at` | `timestamp` | nullable | — | When the owner decided. |
| `decided_by_user_id` | `bigint` | nullable | — | Who approved or rejected. |
| `result_note` | `text` | nullable | — | Optional note on the decision. |
| `created_at` | `timestamp` | required | `CURRENT_TIMESTAMP` | Row creation timestamp. |
| `updated_at` | `timestamp` | required | `CURRENT_TIMESTAMP` | Last update timestamp. |

### `crm.notifications`

In-app notifications. Recipients are `accounts.setup_users.id` (no cross-schema FK).

| Column | Type | Null | Default | Description |
|---|---|---|---|---|
| `id` | `text` | required | — | Primary key (cuid text). |
| `organization_id` | `bigint` | required | — | Tenant (`accounts.organizations.id`). |
| `recipient_user_id` | `bigint` | required | — | Who sees the notification. |
| `actor_user_id` | `bigint` | nullable | — | Who triggered it (optional). |
| `kind` | `text` | required | — | Notification kind / event name. |
| `title` | `text` | required | — | Display title. |
| `body` | `text` | nullable | — | Long body / notes / email HTML or text. |
| `href` | `text` | nullable | — | In-app deep link. |
| `entity_type` | `text` | nullable | — | Related entity kind. |
| `entity_id` | `text` | nullable | — | Related entity id. |
| `contact_id` | `text` | nullable | — | CDP person key (`cdp.customer_profile.cdp_id`). |
| `metadata` | `jsonb` | nullable | — | Extra JSON. |
| `read_at` | `timestamp` | nullable | — | When the recipient read it (null = unread). |
| `created_at` | `timestamp` | required | `CURRENT_TIMESTAMP` | Row creation timestamp. |

### `crm.agent_memories`

Durable structured memory slots for coworker/agents (not Redis, not CDP).

| Column | Type | Null | Default | Description |
|---|---|---|---|---|
| `id` | `text` | required | — | Primary key (cuid text). |
| `organization_id` | `bigint` | required | — | Tenant (`accounts.organizations.id`). |
| `scope_type` | `varchar(16)` | required | — | org \| user \| contact \| deal. |
| `scope_id` | `varchar(64)` | required | '' | Empty string for org-wide; otherwise user id / cdp_id / deal id. |
| `slot_key` | `varchar(64)` | required | — | Memory slot name. |
| `slot_value` | `jsonb` | required | — | JSON value. |
| `source` | `varchar(32)` | nullable | — | Who wrote the slot (coworker, agent name, …). |
| `expires_at` | `timestamptz` | nullable | — | Optional TTL. |
| `created_at` | `timestamptz` | required | `now()` | Row creation timestamp. |
| `updated_at` | `timestamptz` | required | `now()` | Last update timestamp. |

### `crm.api_keys`

Tenant integration API keys. Secret is stored as a hash only.

| Column | Type | Null | Default | Description |
|---|---|---|---|---|
| `id` | `text` | required | — | Primary key (cuid text). |
| `organization_id` | `bigint` | required | — | Tenant (`accounts.organizations.id`). |
| `name` | `varchar(120)` | required | — | Admin-visible key label. |
| `key_prefix` | `varchar(32)` | required | — | Public hint, e.g. `crm_live_ab12cd34`. |
| `key_hash` | `varchar(64)` | required | — | SHA-256 (or similar) of the secret. Secret is never stored. |
| `scopes` | `text[]` | required | '{}'[] | Allowed resources: contacts, companies, deals, activities, products, quotes, invoices, commerce. |
| `created_by_user_id` | `bigint` | required | — | User who created the row (`accounts.setup_users.id`). |
| `created_at` | `timestamptz` | required | `now()` | Row creation timestamp. |
| `revoked_at` | `timestamptz` | nullable | — | When revoked (null = active). |
| `last_used_at` | `timestamptz` | nullable | — | Last successful authenticated request. |


## CRM enums

Values live in the `crm` PostgreSQL schema (Prisma enums).

| Enum | Values |
|---|---|
| `LocationType` | `hq`, `branch` |
| `CompanyChannelRole` | `standard`, `franchise`, `owned_store`, `brand_hq` |
| `OrganizationVertical` | `general`, `ecommerce`, `healthcare`, `finance`, `telecom` |
| `DealStage` | `qualification`, `discover`, `propose`, `negotiate`, `closed_won`, `closed_lost` |
| `ActivityType` | `call`, `meeting`, `email`, `sms`, `note`, `task` |
| `TaskStatus` | `open`, `in_progress`, `completed` |
| `InboxFolder` | `inbox`, `sent`, `draft`, `trash` |
| `EmailDirection` | `outbound`, `inbound` |
| `MailProvider` | `google`, `microsoft` |
| `IntegrationProvider` | `google`, `microsoft`, `zoom`, `yahoo` |
| `ProductStatus` | `draft`, `active`, `archived` |
| `ProductType` | `fixed`, `customizable` |
| `ProductBillingType` | `one_time`, `recurring` |
| `ProductBillingFrequency` | `monthly`, `quarterly`, `annual` |
| `ProductUnitOfMeasure` | `per_seat`, `per_agent`, `per_ticket`, `flat` |
| `AddonPricingModel` | `flat`, `per_unit`, `stepped`, `tiered` |
| `AddonMeterKey` | `seat`, `minute`, `session`, `email`, `agent`, `flat`, `custom` |
| `QuoteStatus` | `draft`, `sent`, `accepted`, `rejected`, `void` |
| `ProposalStatus` | `draft`, `shared`, `accepted`, `declined` |
| `ProposalTemplateKind` / `QuoteTemplateKind` / `InvoiceTemplateKind` | `standard` |
| `OrderStatus` | `draft`, `confirmed`, `fulfilled`, `cancelled` |
| `InvoiceStatus` | `draft`, `sent`, `paid`, `void`, `overdue` |
| `InvoiceLineKind` | `product`, `addon` |
| `AuditAction` | `create`, `update`, `delete`, `stage_change`, `assign`, `convert`, `merge`, `quote_sent`, `quote_accepted`, `order_created`, `invoice_created` |
| `LeadEnrichmentStatus` | `pending`, `running`, `enriched`, `skipped`, `failed` |
| `LeadNurtureStatus` | `pending`, `analyzing`, `sent`, `waited`, `skipped`, `failed` |
| `LeadScoringStatus` | `pending`, `scoring`, `scored`, `failed` |
| `LeadLifecycleStatus` | `pending`, `analyzing`, `applied`, `waited`, `skipped`, `failed` |
| `EmailAutoReplyStatus` | `pending`, `analyzing`, `replied`, `awaiting_demo`, `escalated`, `skipped`, `failed` |
| `AgentStepStatus` | `started`, `ok`, `failed`, `skipped` |
| `SalesSeniorityTier` | `junior`, `mid`, `senior` |
| `meeting_assist_status` | `active`, `ended`, `failed` |
| `meeting_assist_provider` | `google_meet`, `zoom`, `teams`, `other` |
| `ProcessConfirmationStatus` | `pending`, `approved`, `rejected`, `expired` |

Unused leftover enums may still exist in Postgres from dropped B2C job tables (`B2c*`, `Commerce*`). They are not used by current models.

## CDP `identity_keys.key_type` (CRM)

| key_type | Meaning |
|---|---|
| `email` | Primary email |
| `phone` | Primary phone |
| `email_secondary` | Additional email |
| `phone_secondary` | Additional phone |

## CDP `custom_fields` keys used by CRM

| Key | Meaning |
|---|---|
| `title` | Job title |
| `industry` | Company industry |
| `company_domain` | Company domain |
| `address_line` | Street address |

---

Dropped CRM tables (do not recreate): `crm.products`, `catalog_integration_connections`, `service_tickets`, `password_reset_tokens`, unused `b2c_*` / `commerce_*`. See migration `20260820180000_drop_unused_crm_tables`.
