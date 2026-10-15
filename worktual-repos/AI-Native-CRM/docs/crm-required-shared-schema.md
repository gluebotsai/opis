# Tables CRM must have before synthetic data will show up

CRM-owned rows live in `crm.*`. People, login, tenant, and the product catalog do not. If those shared rows are missing, CRM screens stay empty even when every `crm.*.csv` loaded cleanly.

Join key for a person everywhere: `cdp.customer_profile.cdp_id` = `crm.contact_profiles.account_contact_id` = spoke `contact_id`.

Join key for a tenant: `accounts.organizations.id` = `organization_id` on every CRM and spoke row.

Related: [`cdp-customer-identity.md`](./cdp-customer-identity.md) · [`table-schemas.md`](./table-schemas.md) · [`crm-tables-reference.md`](./crm-tables-reference.md) · [`multi-tenancy-common-model.md`](./multi-tenancy-common-model.md)

---

## 1. Required — CRM does not work without these

### `cdp.customer_profile`

One row per person. The contact list is this table inner-joined to `crm.contact_profiles`.

| Column | Required | Notes |
|---|---|---|
| `cdp_id` | yes | Text primary key. Must equal `crm.contact_profiles.account_contact_id`. |
| `organization_id` | yes | Same bigint as `accounts.organizations.id`. |
| `first_name` | yes for a visible name | |
| `last_name` | yes for a visible name | |
| `company` | no | Free-text company name on the person. CRM companies are a separate table. |
| `city` | no | |
| `country` | no | |
| `region` | no | |
| `contact_type` | no | `contact` (default), `customer`, or `churned`. `customer` / `churned` are treated as converted leads. |
| `acquisition_channel` | no | Do not use the placeholder `cdp_ingest`. |
| `custom_fields` | no | JSON. CRM reads `title`, `industry`, `company_domain`, `address_line`. |
| `created_at` | yes | |
| `updated_at` | yes | List order uses this. |

### `cdp.identity_keys`

Email and phone are not columns on the profile. Inbox match, search, and "reachable" all use this table.

| Column | Required | Notes |
|---|---|---|
| `identity_id` | yes | Text primary key. |
| `cdp_id` | yes | FK to `customer_profile.cdp_id`. |
| `organization_id` | yes | Same tenant as the profile. |
| `key_type` | yes | `email`, `phone`, `email_secondary`, `phone_secondary`. |
| `key_value` | yes | Email lowercased and trimmed. Phone trimmed. |
| `verified` | yes | CRM writes `false`. |
| `source_system` | yes | CRM writes `crm`. |
| `confidence_score` | yes | CRM writes `1.0`. |
| `created_at` | yes | Oldest row of a type wins as the primary email or phone. |

Unique per tenant: `(organization_id, key_type, key_value)`.

Every contact you expect to see in CRM needs at least one `email` or `phone` key. A profile with no key is listed as unreachable.

### `accounts.organizations`

| Column | Required | Notes |
|---|---|---|
| `id` | yes | Bigint. This is `organization_id` everywhere else. |
| `company_name` | yes | Shown on quotes as the vendor name. |
| `business_type` | yes | `b2b`, `b2c`, or `b2b2c`. Gates Finance and the revenue path. |
| `industry_type` | no | Free text from signup. CRM maps it to a field pack. It does not live on `crm.organization_profiles`. |

### `accounts.setup_users`

Login and record owners. `owner_user_id`, `host_user_id`, `assignee_user_id`, and `created_by_user_id` in CRM must be one of these ids.

| Column | Required | Notes |
|---|---|---|
| `id` | yes | Bigint. |
| `organization_id` | yes | |
| `work_email` | yes | Login email. Compared case-insensitively. |
| `password_hash` | yes to sign in | |
| `first_name` | yes | |
| `last_name` | yes | |
| `status` | yes | Must be `active`. Anything else is treated as a viewer with no access. |

Optional, used only by lead assignment: `skills`, `primary_language`, `secondary_language`, `city`, `state`, `country`, `business_hours_id`.

### `accounts.setup_user_product_access` and `accounts.setup_roles`

A user with no CRM product row cannot act as admin, manager, or sales rep.

| Table | Column | Required | Notes |
|---|---|---|---|
| `setup_user_product_access` | `user_id` | yes | `setup_users.id` |
| `setup_user_product_access` | `product_id` | yes | Must be the text `crm`. |
| `setup_user_product_access` | `role_id` | yes | `setup_roles.id` |
| `setup_roles` | `id` | yes | |
| `setup_roles` | `name` | yes | CRM accepts `admin`, `manager`, `sales rep`, `sales_manager`, `sales_rep`. |

### `inventory.products`

Only required when a quote, order, or invoice line has `product_id` set, and for the Product screen. Lines with a null `product_id` still load from the name and price on the line.

| Column | Required | Notes |
|---|---|---|
| `id` | yes | Text. This is `product_id` on CRM lines. |
| `organization_id` | yes | |
| `name` | yes | |
| `status` | yes | `draft`, `active`, `archived`. Use `active` for anything you want to sell. |
| `product_type` | yes | `fixed` or `customizable`. |
| `billing_type` | yes | `one_time` or `recurring`. |
| `billing_frequency` | when recurring | `monthly`, `quarterly`, `annual`. |
| `unit_of_measure` | yes | `flat`, `per_seat`, `per_agent`, `per_ticket`. |
| `currency` | yes | Default `USD`. |
| `price` | no | |
| `sku` | no | |
| `description` | no | |
| `category` | no | |

There is no `crm.products` table.

---

## 2. Required CRM overlay (already in the CRM CSVs)

These rows attach the shared person to CRM. They are not a substitute for section 1.

| Table | Must match |
|---|---|
| `crm.contact_profiles` | `account_contact_id` = `cdp.customer_profile.cdp_id`, same `organization_id`. |
| `crm.companies` | `organization_id` = the accounts org. Deal `company_id` points here. |
| `crm.company_locations` | `company_id` points at `crm.companies`. Every deal needs a `location_id`. |
| `crm.deals` | `company_id` and `location_id` required. `contact_id` is the CDP `cdp_id`, not the profile row id. |
| `crm.contact_activities` | `contact_id` is the CDP `cdp_id`. Tasks need `assignee_user_id` = `setup_users.id`. |

---

## 3. Optional CDP — Customer 360 only

Core CRM lists, deals, and inbox work without these. The contact 360 panel stays empty if they are missing. Do not load `crm.customer_metrics`. The app reads the CDP tables below.

| Table | Columns CRM reads | Join |
|---|---|---|
| `cdp.customer_scores` | `organization_id`, `cdp_id`, `churn_score`, `loyalty_score`, `value_score`, `purchase_probability`, `retention_score`, `advocacy_score`, `web_engagement_score`, `predicted_ltv`, `next_purchase_days`, `updated_at` | one row per person |
| `cdp.customer_metrics` | `organization_id`, `cdp_id`, `metric_date`, `session_count`, `total_page_views`, `avg_session_duration`, `bounce_rate`, `avg_scroll_depth`, `conversion_count`, `last_seen_days` | latest `metric_date` |
| `cdp.gold_customer_metrics` | `organization_id`, `cdp_id`, `journey_stage`, `total_orders`, `total_spend`, `avg_order_value`, `last_purchase_at`, `updated_at` | one row per person |
| `cdp.orders` | `order_id`, `order_number`, `organization_id`, `cdp_id`, `status`, `total_amount`, `currency`, `payment_status`, `fulfillment_status`, `created_at` | last 8 orders |
| `cdp.order_items` | `product_id`, `quantity`, `unit_price` | joined to those orders |

`cdp.products` is not the CRM catalog. Ignore it.

---

## 4. Other spokes

CRM does not read `campaign.*` or `ticketing.*` to render its own screens. Those spokes should store the same `organization_id` and the same `cdp_id` as `contact_id` so a person is one person across systems. Loading their CSVs does not fill CRM.

CCaaS is the exception. Two CRM jobs read it directly.

### BANT from chat (`ccass.conversations`, `ccass.conversation_messages`)

| Table | Column | Notes |
|---|---|---|
| `conversations` | `id` | |
| `conversations` | `contact_id` | Must be the CDP `cdp_id`. |
| `conversation_messages` | `conversation_id` | |
| `conversation_messages` | `body` | |
| `conversation_messages` | `direction` | Must be `inbound`. |
| `conversation_messages` | `sender_type` | Must be `customer` (compared case-insensitively). |
| `conversation_messages` | `created_at` | |

### Nurture-call transcript

Also needs a `crm.nurture_voice_calls` row (`session_id`, `contact_id`, `activity_id`). The CRM synthetic zip does not include that table. Create it from the Prisma migration; seed it only if you want old nurture calls to resolve.

| Table | Column | Notes |
|---|---|---|
| `ccass.conversations` | `organization_id` | |
| `ccass.conversations` | `external_thread_id` | Must equal `crm.nurture_voice_calls.session_id`. |
| `ccass.conversations` | `contact_id` | CDP `cdp_id`. |
| `ccass.conversations` | `id`, `direction`, `status`, `created_at` | |
| `ccass.conversation_messages` | `conversation_id`, `organization_id` | |
| `ccass.conversation_messages` | `sender_type`, `body` | |
| `ccass.conversation_messages` | `model_metadata` | JSON. CRM reads `model_metadata->>'speaker'`. |
| `ccass.conversation_messages` | `visibility` | Must be `customer`. |
| `ccass.conversation_messages` | `sent_at`, `created_at`, `id` | Order. |

Agent presence stays in `ccass.agent_presence`. Do not load `crm.agent_presence`.

---

## 5. Minimum row set for one working tenant

1. One `accounts.organizations` row (`business_type` set).
2. One `accounts.setup_users` row with `status = active`, plus a `setup_user_product_access` row with `product_id = 'crm'` and a `setup_roles` row.
3. For each CRM contact: one `cdp.customer_profile` and one `cdp.identity_keys` email or phone, with `cdp_id` equal to `crm.contact_profiles.account_contact_id` and the same `organization_id`.
4. For each deal: a `crm.companies` row and a `crm.company_locations` row in that org.
5. For each product line that has `product_id`: a matching `inventory.products` row in that org, `status = active`.
