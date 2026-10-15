# Org 1003 synthetic ingest — what is not in the CSVs

Scope: load data for organization **1003** only.

Do not insert `accounts.organizations`. That tenant already exists.
Do not insert `inventory.products` when the six product ids below already exist for 1003.

The zip has `crm`, `campaign`, `ccass`, and `ticketing` only. It has no `cdp` or `accounts` user rows.

Person join: `cdp.customer_profile.cdp_id` = `crm.contact_profiles.account_contact_id`.

Related: [`crm-required-shared-schema.md`](./crm-required-shared-schema.md) · [`cdp-customer-identity.md`](./cdp-customer-identity.md)

## 1. Still required

### `cdp.customer_profile`

One row per `crm.contact_profiles` row (3,636 for this org). `organization_id` = `1003`.

| Column | Required | Notes |
|---|---|---|
| `cdp_id` | yes | Same text as `account_contact_id`. |
| `organization_id` | yes | `1003` |
| `first_name` | yes | Not on the CRM overlay. |
| `last_name` | yes | |
| `company` | no | Free-text label. The company record is `crm.companies`. |
| `city` | no | |
| `country` | no | |
| `region` | no | |
| `contact_type` | no | `contact`, `customer`, or `churned`. Empty means `contact`. |
| `acquisition_channel` | no | Do not use `cdp_ingest`. |
| `custom_fields` | no | JSON below. |
| `created_at` | yes | |
| `updated_at` | yes | Contact list sorts by this. |

`custom_fields` keys CRM reads:

| Key | Meaning |
|---|---|
| `title` | Job title |
| `industry` | Industry |
| `company_domain` | Company domain |
| `address_line` | Street |
| `city` | Only if the `city` column is empty |
| `country` | Only if the `country` column is empty |
| `region` | Only if the `region` column is empty |
| `location` or `geography` | Fallback place name |

`crm.contact_profiles.custom_attributes` is a different column. Its file keys are `requirement` and `solution_interest`. They do not replace `custom_fields`.

### `cdp.identity_keys`

No JSON. One row per email or phone. Same `cdp_id` and `organization_id` = `1003`.

| Column | Notes |
|---|---|
| `identity_id` | Text primary key |
| `cdp_id` | `customer_profile.cdp_id` |
| `organization_id` | `1003` |
| `key_type` | `email`, `phone`, `email_secondary`, `phone_secondary` |
| `key_value` | Email lowercased. Phone trimmed. |
| `verified` | `false` |
| `source_system` | `crm` |
| `confidence_score` | `1.0` |
| `created_at` | Oldest row of a type is the primary email or phone |

A profile with no email and no phone is unreachable.

### `accounts.setup_users` (only if 1015–1018 are missing)

| id | Where the CSVs use it |
|---|---|
| `1015` | Most deals, contacts, and appointments |
| `1016` | |
| `1017` | |
| `1018` | `crm.sales_user_assignment_profiles` only |

| Column | Notes |
|---|---|
| `id` | One of those four |
| `organization_id` | `1003` |
| `work_email` | Login |
| `password_hash` | Required to sign in |
| `first_name`, `last_name` | |
| `status` | `active` |

Also `accounts.setup_roles` and `accounts.setup_user_product_access`:

| Column | Notes |
|---|---|
| `setup_user_product_access.user_id` | `1015`–`1018` |
| `setup_user_product_access.product_id` | Must be `crm` |
| `setup_user_product_access.role_id` | `setup_roles.id` |
| `setup_roles.name` | `admin`, `manager`, `sales rep`, `sales_manager`, or `sales_rep` |

No JSON on these tables.

### Product ids that must already exist

Do not insert products if these rows are already in `inventory.products` for org 1003:

- `wt-product-ccaas`
- `wt-product-ticketing`
- `wt-product-crm`
- `wt-product-campaign`
- `wt-product-web-tracking`
- `wt-product-cvm`

If any id is missing, quote, order, and invoice lines that reference it will not attach to the catalog.

## 2. CRM tables in the schema but not in the zip

Create them empty. The app fills them later. No JSON.

| Table | Columns |
|---|---|
| `crm.org_nurture_settings` | `organization_id` = `1003`, `nurture_call_enabled` (default false), `nurture_call_delay_minutes` (default 15) |
| `crm.scheduled_outbound_emails` | Leave empty |
| `crm.nurture_voice_calls` | Leave empty unless old nurture calls must resolve (`contact_id`, `activity_id`, `session_id`, `triggered_at`) |

## 3. Do not load from the zip

| File | Reason |
|---|---|
| `crm.agent_presence`, `crm.agent_presence_history` | Presence is `ccass.agent_presence` |
| `crm.customer_metrics` | Customer 360 reads `cdp.customer_metrics`, not this file |
| `crm.metricflow_time_spine` | Not a CRM entity |
| `crm._prisma_migrations` | Would overwrite migration history |

## 4. JSON already in the CRM files — keys the app reads

Insert works with the file JSON. These screens ignore it until the keys match.

**`crm.org_assignment_settings.lead_icp`**

- `targetIndustries` — string array
- `adjacentIndustries` — string array
- `sizeTiers` — string array
- `serviceableGeos` — string array

The file has `business_model` and `countries`. Those are not read.

**`crm.org_assignment_settings.followup_policy`**

- `hot.remindMinutes`, `hot.managerMinutes`, `hot.adminMinutes`
- `warm.remindMinutes`, `warm.managerMinutes`, `warm.adminMinutes`

`cold` is fixed in code: `end_of_working_day`, `next_working_day`, `two_working_days`. The file keys `first_response_hours`, `max_unanswered_attempts`, and `respect_local_business_hours` are dropped. Defaults are hot 5/15/30 minutes and warm 30/120/240.

**`crm.org_finance_settings.bank_details`**

- `accountName` or `account_name`
- `bankName` or `bank_name`
- `accountNumber` or `account_number`
- `ifsc`, `iban`, `swift`
- `routingNumber` or `routing_number`
- `notes`

The file has `beneficiary_name` and `currency`. The quote bank block stays blank.

**`crm.org_finance_settings.payment_routing_rules`**

- `defaultProvider` — `stripe` or `razorpay`
- `rules[]` — `currency`, `offlineOnlyAbove`, `allowedProviders`

The file uses country names as keys (`India`, `United Arab Emirates`, `United Kingdom`).

**`crm.invoices.tax_details`**

- `system`
- `effectivePercent`
- `summaryLines` — string array
- `components[]` — `label`, `percent`, `amount`

The file has `country`, `rate_percent`, `system`, `taxable_amount`. Only `system` is used.

**Document bodies** (`crm.quotes.document_sections`, `crm.proposals.sections`, `crm.invoice_templates.sections`, `crm.quote_templates.sections`, `crm.proposal_templates.sections`) — array of:

- `id`, `key`, `title`, `body`, `sortOrder`
- `tableRows` — optional array of `{ "cells": ["..."] }`

The files put `product_id`, `quantity`, and amounts on the object itself. Those show up in the document only when they are inside `body`.

**`crm.appointments.guest_emails`** — JSON array of email strings, not an object.

**`crm.organization_profiles.vertical_config`** — branding reads `logoUrl` only. The file has `business_model` and `markets`.

**`crm.contact_activities.transcript_insights`** — optional object: `ranAt`, `status`, `completedAt`, `briefCreated`, `bookedMeeting`, `momProposalRequested`, `momNextBestAction`. Org 1003 rows leave this empty.

## 5. Optional, also not in the zip

Customer 360 only: `cdp.customer_scores`, `cdp.customer_metrics`, `cdp.gold_customer_metrics`, `cdp.orders`, `cdp.order_items`. Join on `organization_id = 1003` and `cdp_id`.

Lead reminder hours, only if `setup_users.business_hours_id` is set: `accounts.setup_business_hours` with `organization_id = 1003`, `status = active`, `timezone`, `open_time`, `close_time`. `working_days` is weekday names. `day_timings` is JSON:

```json
{ "Monday": { "openTime": "10:00", "closeTime": "16:00" } }
```

Do not seed `accounts.auth_sessions`. Login creates those.
