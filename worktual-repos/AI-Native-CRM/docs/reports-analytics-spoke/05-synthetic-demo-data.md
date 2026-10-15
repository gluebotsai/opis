# Synthetic demo data for organization 1003

This is the insert plan for a B2B demo of Worktual org **`1003`**. Column lists and allowed values stay in [`01-database-schema.md`](01-database-schema.md). Pipeline rules stay in [`02-modules-roles-pipeline.md`](02-modules-roles-pipeline.md).

Org `1003` already exists (`accounts.organizations`, `business_type` B2B, company name Worktual). Do not insert a second tenant. Do not `CREATE` / `ALTER` / `DROP` anything in `accounts`, `cdp`, or `inventory`. Insert and update existing columns only.

**Window:** 1 Oct 2023 through 1 Oct 2026. Spread `created_at`, `closed_at`, `sent_at`, `accepted_at`, `confirmed_at`, `issue_date`, `paid_at`, and `due_at` across those three years. Leave a live open pipeline in 2026 so the dashboard is not only history.

**Currency:** one code for the whole set, matching the catalog rows you attach (`inventory.products.currency`). Do not mix INR and USD in one demo sum.

**Owners:** reuse existing `accounts.setup_users.id` values that already have `setup_user_product_access.product_id = 'crm'` for org `1003`. Do not invent login users, passwords, or sessions.

---

## What a finished story looks like

One won deal is this chain. Every id below is the primary key of that table.

```text
accounts.organizations.id = 1003
        │
        ├── accounts.setup_users.id          owner_user_id / created_by_user_id
        │
inventory.products.id                        product_id on every commercial line
        │
crm.companies.id
        └── crm.company_locations.id         deals.location_id (required)
                │
cdp.customer_profile.cdp_id
        ├── cdp.identity_keys.cdp_id         email (and optional phone)
        └── crm.contact_profiles
                account_contact_id = cdp_id
                company_id, location_id, owner_user_id
                │
                ├── crm.contact_activities.contact_id = contact_profiles.id
                │
                └── crm.deals
                        company_id, location_id
                        contact_id = cdp_id          (not contact_profiles.id)
                        │
                        ├── crm.deal_activities.deal_id
                        ├── crm.quotes.deal_id
                        │       └── crm.quote_lines.quote_id
                        │               product_id = inventory.products.id
                        ├── crm.sales_orders
                        │       deal_id, quote_id, company_id
                        │       contact_id = contact_profiles.id
                        │       └── crm.order_lines.order_id
                        │               product_id = inventory.products.id
                        ├── crm.invoices
                        │       order_id, deal_id, company_id
                        │       └── crm.invoice_lines.invoice_id
                        │               product_id = inventory.products.id
                        └── crm.contracts (recurring wins only)
                                company_id, deal_id, source_order_id
```

Open deals stop earlier: company + location + person + deal, plus a few activities. They do not need a quote, order, or invoice.

Lost deals stop at `closed_lost` with `lost_reason` and `closed_at`. A rejected quote is optional.

---

## Insert order

Insert parents before children. Delete in reverse if you reload the set.

| Step | Table | Why it is first |
| --- | --- | --- |
| 0 | `accounts.organizations` id `1003` | Already there. Do not insert. |
| 0 | `accounts.setup_users` + `setup_user_product_access` | Already there for real reps. Reuse those ids. |
| 1 | `inventory.products` | Lines need a real `product_id`. Reuse org 1003 catalog rows when they exist (`status = active`). Add rows only if the demo needs a SKU that is missing. |
| 2 | `crm.companies` | Deals require a company. |
| 3 | `crm.company_locations` | Deals require `location_id`. One `hq` per company is enough. |
| 4 | `cdp.customer_profile` | Person name. `organization_id = 1003`. |
| 5 | `cdp.identity_keys` | Email the UI shows. Unique on `(organization_id, key_type, key_value)`. |
| 6 | `crm.contact_profiles` | CRM owner, lead status, company link. `account_contact_id` = that person's `cdp_id`. |
| 7 | `crm.deals` | Pipeline. Then set `contact_profiles.converted_deal_id` on converted people. |
| 8 | `crm.contact_activities` and `crm.deal_activities` | Timeline. Contact activities point at `contact_profiles.id`. Deal activities point at `deals.id`. |
| 9 | `crm.quotes` then `crm.quote_lines` | Only when the deal has reached propose or later, or is won/lost after a price. |
| 10 | `crm.sales_orders` then `crm.order_lines` | Only after an accepted quote. |
| 11 | `crm.invoices` then `crm.invoice_lines` | Only after an order. Paid rows need `paid_at`. |
| 12 | `crm.contracts` | Only for recurring products on won deals. |

Header totals must match their lines. `quotes.total` = sum of `quote_lines.amount` (after the header discount you store). `sales_orders.total` = sum of `order_lines.amount`. `invoices.total` = sum of line amounts plus `tax_amount` minus `discount_amount`. Do not also add the header into a line-level report.

---

## What to fill

### Reuse, do not seed

| Table | Rule |
| --- | --- |
| `accounts.organizations` | Keep id `1003`. |
| `accounts.setup_users` | Pick 3–5 existing CRM users in this org (admin, sales manager, sales reps). Store those bigint ids on `owner_user_id` and `created_by_user_id`. |
| `accounts.setup_roles`, `setup_user_product_access` | Leave real grants. `product_id` for CRM access is `crm`. |
| `accounts.auth_sessions`, mailbox OAuth, encrypted `*_enc` columns | Do not insert. |
| `inventory.products` | Prefer existing active products for org `1003` (live rows already use ids such as `wt-product-crm`). New products need `organization_id = 1003`, `name`, `currency`, `status = active`, `billing_type`, `product_type`, `unit_of_measure`. |

### Companies and sites

`crm.companies` — about **12** accounts, created across the three years.

| Column | Fill |
| --- | --- |
| `id` | New text id. |
| `organization_id` | `1003` |
| `name` | Buyer account name. Not “Worktual” (that is the seller on `accounts.organizations.company_name`). |
| `domain` | Host only, for example `example.com`. |
| `industry`, `employee_count` | Optional. Useful on the company card. |
| `owner_user_id` | A reused setup user id. |
| `channel_role` | `standard` for almost all. At most one `brand_hq` plus two children with `parent_company_id` if you want a hierarchy. |
| `created_at`, `updated_at` | Inside the window. `updated_at` ≥ `created_at`. |

`crm.company_locations` — **one `hq` per company**.

| Column | Fill |
| --- | --- |
| `company_id` | Parent company. |
| `organization_id` | `1003` |
| `name` | For example `HQ`. |
| `type` | `hq` |
| `city`, `address` | Optional. |

### People

One person is two shared rows plus one CRM overlay.

`cdp.customer_profile`

| Column | Fill |
| --- | --- |
| `cdp_id` | New text id. This is what deals store. |
| `organization_id` | `1003` |
| `tenant_id` | Copy the value already used on org 1003 CDP rows (`9009` on the tenant; person rows in this org use their existing `tenant_id` pattern — read one live row and copy that string). |
| `first_name`, `last_name` | Display name. |
| `company` | Same text as `crm.companies.name` for that account. |
| `contact_type` | `lead` or `prospect` while open; `customer` when the deal is `closed_won`; `churned` only if you also cancel a contract. |
| `custom_fields`, `preferences_json`, `consent_json`, `traits_json` | `{}` |
| `blocked` | `false` |
| `created_at`, `updated_at` | Inside the window. |

`cdp.identity_keys` — one email per person.

| Column | Fill |
| --- | --- |
| `identity_id` | New text id. |
| `cdp_id` | The profile above. |
| `organization_id` | `1003` |
| `key_type` | `email` |
| `key_value` | Lowercase, unique in this org. |
| `source_system` | `crm` |
| `verified` | `false` |
| `custom_fields` | `{}` |

`crm.contact_profiles` — about **2 people per company** (roughly 24).

| Column | Fill |
| --- | --- |
| `id` | New text id. Activities and orders use this id. |
| `account_contact_id` | `cdp.customer_profile.cdp_id` |
| `organization_id` | `1003` |
| `company_id` | Required for a B2B demo person who sits on a deal. |
| `location_id` | That company's HQ. |
| `owner_user_id` | Same rep as the company or the deal. |
| `lead_status` | `new` / `contacted` / `qualifying` / `qualified` while open. `converted` when `converted_deal_id` is set. `disqualified` only with `disqualify_reason`. |
| `converted_deal_id` | `crm.deals.id` after the deal exists, for converted people. |
| `crm_status` | `active` |
| `tags` | `'{}'` (empty array). The column is required. |
| `is_pinned` | `false` |
| `assignment_escalated` | `false` |
| `flagged_for_review` | `false` unless you want a stalled-lead tile. |
| `marketing_opt_out` | `false` |
| `lead_source` | Short label such as `inbound`, `referral`, or `import`. |

Do not point `deals.contact_id` at `contact_profiles.id`. That column is the CDP id.

### Deals

About **90–120 deals** over three years is enough for charts. Fewer than that looks empty; thousands are not needed.

| Column | Fill |
| --- | --- |
| `organization_id` | `1003` |
| `title` | Opportunity name. |
| `company_id` | Required. |
| `location_id` | Required. That company's HQ. |
| `contact_id` | `cdp_id` of the primary person. |
| `contact_name`, `contact_email` | Copy of the CDP name and identity email at insert time. |
| `owner_user_id` | Rep. Split the book across the reused users. |
| `stage` | See the mix below. |
| `amount` | Same currency as the lines you will attach. On won deals, match the accepted quote total. |
| `created_at` | Spread from 2023-10 through 2026-09. |
| `expected_close_date` | Set on open deals, some in the past (slippage) and some in the future. |
| `closed_at` | Required in practice for `closed_won` and `closed_lost`. Null on open stages. |
| `lost_reason` | Only on `closed_lost`. Examples already in the product: `Pricing`. |
| `forecast_flagged` | `false` |

There is no stage-history table. The row holds the **current** stage only.

Suggested mix so every screen has something:

| Stage | Share | Dates |
| --- | --- | --- |
| `closed_won` | ~35% | `closed_at` spread over 2023–2026, including several in the last 90 days |
| `closed_lost` | ~25% | `closed_at` spread the same way |
| `qualification`, `discover`, `propose`, `negotiate` | ~40% together | `created_at` mostly in 2026. These stay open. `closed_at` null |

Won and lost dates must be on or after `created_at`.

### Activities

Two or three touches per open deal, and at least one per won or lost deal, dated before `closed_at`.

`crm.deal_activities`: `deal_id`, `organization_id = 1003`, `type` (`call`, `meeting`, `email`, `note`, `task`), `subject`, `created_at`. Completed tasks set `completed_at`. Open tasks set `due_at` and leave `completed_at` null — include a few overdue ones.

`crm.contact_activities`: `contact_id` = **`contact_profiles.id`**, `organization_id = 1003`, `type`, `subject`, `folder`. Use `sent` for outbound email and `inbox` for inbound. Set `email_direction` when `type = email`. Set `needs_manual_response = false` unless you want an inbox badge. `task_status` when `type = task`: `open`, `in_progress`, or `completed`.

### Quotes, orders, invoices

**Quote** — for every `propose` / `negotiate` deal and every won deal. Optional on lost deals.

| Column | Fill |
| --- | --- |
| `deal_id` | Required. |
| `organization_id` | `1003` |
| `number` | Unique in the org, for example `Q-2024-0142`. |
| `version` | `1` |
| `status` | `sent` on open late-stage deals (`sent_at` set). `accepted` on won deals (`sent_at` and `accepted_at` set, `accepted_at` ≤ `closed_at`). `rejected` if you attach one to a loss. `draft` only for a deal still in `discover`. |
| `currency`, `subtotal`, `discount_pct`, `total` | `discount_pct` can be `0`. `total` matches lines. |
| `approval_status` | `sent` when the quote was sent. `drafting` only while `status = draft`. |
| `company_name`, `customer_name`, `vendor_name` | Denormalized labels. Vendor is Worktual. |
| `created_by_user_id` | The deal owner. |

`crm.quote_lines`: `quote_id`, `organization_id`, `product_id` (real catalog id), `name` (product name), `quantity`, `unit_price`, `amount` (= quantity × unit price), `sort_order`.

**Order** — only when the quote is `accepted` (won deals).

| Column | Fill |
| --- | --- |
| `organization_id` | `1003` |
| `deal_id`, `quote_id`, `company_id` | The won chain. |
| `contact_id` | **`contact_profiles.id`**, not `cdp_id`. |
| `number` | Unique per org, for example `SO-2024-0142`. |
| `status` | `confirmed` (or `fulfilled` for old wins). |
| `currency`, `total` | Match the accepted quote. |
| `confirmed_at` | On or just after `quotes.accepted_at`. |
| `created_by_user_id` | Deal owner. |

`crm.order_lines`: same shape as quote lines, `order_id` instead of `quote_id`, same `product_id` and amounts.

**Invoice** — one per confirmed order. Add a second invoice on a few 2024–2025 wins if you want renewals.

| Column | Fill |
| --- | --- |
| `organization_id` | `1003` |
| `order_id`, `deal_id`, `company_id` | The same chain. |
| `number` | Unique per org, for example `INV-2024-0142`. |
| `currency`, `total`, `discount_amount`, `tax_amount` | `discount_amount` can be `0`. If tax is 0, say so on the lines (`tax_percent = 0`) and keep `tax_amount = 0`. |
| `billing_kind` | `standard` for the first invoice. `renewal` only when it hangs off a contract. |
| `approval_status` | `sent` once it left finance. Do not leave paid invoices on `drafting`. |
| `dunning_stage` | A short code the column accepts today; use the same value already stored on live org 1003 invoices if you are unsure, or `none` only after you confirm that code exists on a live row. |
| `status` | See the mix below. |
| `issue_date`, `due_at` | `due_at` about 30 days after issue. |
| `paid_at` | Set only when `status = paid`, and on or after `issue_date`. |
| `sent_at` | Set when status is `sent`, `paid`, or `overdue`. |

Invoice status mix:

| Status | Use |
| --- | --- |
| `paid` | Most invoices from 2023 through mid-2026. This is collected revenue. |
| `sent` | A few recent invoices, `due_at` still in the future. |
| `overdue` | A few with `due_at` in the past and `paid_at` null, so collections is not empty. |
| `draft` | At most one current invoice, so finance has something to approve. |
| `void` | Rare. If used, set `voided_at`. |

`crm.invoice_lines`: `invoice_id`, `organization_id`, `kind = product`, `product_id`, `name`, `quantity`, `unit_price`, `tax_percent`, `amount`, `sort_order`.

### Contracts (optional, for recurring revenue)

Only when the product `billing_type` is `recurring` and the deal is won.

| Column | Fill |
| --- | --- |
| `organization_id` | `1003` |
| `company_id` | The account. |
| `deal_id` | The won deal. |
| `source_order_id` | The confirmed order. |
| `title` | For example `Contract — Acme — CRM`. |
| `status` | `active` if `ends_at` is in the future. `expired` if `ends_at` is in the past. |
| `starts_at`, `ends_at` | Term inside or starting inside the window. |
| `auto_renew` | `true` or `false`. |
| `billing_frequency` | `monthly`, `quarterly`, or `annual`, matching the product. |
| `arr` | Annual value when you want a renewal number. |

Skip `crm.contract_billing_schedules` unless you need a next-bill date. If you add them, `contract_id` must exist and `status` is `scheduled` or `generated`.

---

## How the ids connect

| From | Column | To |
| --- | --- | --- |
| Every CRM row in this set | `organization_id` | `accounts.organizations.id` = `1003` |
| Company, contact, deal | `owner_user_id` | `accounts.setup_users.id` |
| Location | `company_id` | `crm.companies.id` |
| Contact overlay | `account_contact_id` | `cdp.customer_profile.cdp_id` |
| Contact overlay | `company_id` | `crm.companies.id` |
| Identity key | `cdp_id` | `cdp.customer_profile.cdp_id` |
| Deal | `company_id` | `crm.companies.id` |
| Deal | `location_id` | `crm.company_locations.id` |
| Deal | `contact_id` | `cdp.customer_profile.cdp_id` |
| Contact activity | `contact_id` | `crm.contact_profiles.id` |
| Deal activity | `deal_id` | `crm.deals.id` |
| Quote | `deal_id` | `crm.deals.id` |
| Quote line | `quote_id` | `crm.quotes.id` |
| Quote / order / invoice line | `product_id` | `inventory.products.id` |
| Order | `quote_id`, `deal_id`, `company_id` | Quote, deal, company |
| Order | `contact_id` | `crm.contact_profiles.id` |
| Order line | `order_id` | `crm.sales_orders.id` |
| Invoice | `order_id`, `deal_id`, `company_id` | Order, deal, company |
| Invoice line | `invoice_id` | `crm.invoices.id` |
| Converted person | `converted_deal_id` | `crm.deals.id` |
| Contract | `company_id`, `deal_id`, `source_order_id` | Company, deal, order |

`contact_profiles.company` is not a column. The employer text is `cdp.customer_profile.company`. The CRM link is `contact_profiles.company_id`.

---

## Leave empty

These tables are real, but a sales and finance demo does not need synthetic rows. Filling them with fake tokens or agent jobs creates noise and can trip live workers.

- Login and secrets: `accounts.auth_sessions`, `mail_oauth_connections`, `a2a_spoke_clients`, any `*_enc` column
- Agent runtime: `agent_*`, `lead_enrichment_*`, `lead_scoring_jobs`, `lead_lifecycle_jobs`, `lead_nurture_jobs`, `lead_summaries`, `a2a_spoke_tasks`
- Mail sync: `gmail_push_watches`, `google_calendar_watches`, `email_auto_reply_jobs`, `user_integration_connections`
- Meetings and coaching: `appointments`, `meeting_*`, `coaching_insights`, `calendar_meet_captures`
- SEO and prospecting: `seo_*`, `prospect_*`, `domain_enrichment_cache`
- Proposal corpus: `proposal_corpus_*`, `proposal_playbooks` (a demo quote does not need a corpus)
- Templates: reuse the live standard quote and invoice templates if a row requires `template_id`. Do not clone blueprint JSON.
- Org settings: `org_finance_settings`, `org_assignment_settings`, `organization_profiles` — leave the live org 1003 rows

Price books, offers, and add-ons (`price_books`, `price_book_entries`, `product_offers`, `product_addons`) are optional. Lines can point straight at `inventory.products`.

---

## Checks before you call it done

1. Every new row that has `organization_id` is `1003`.
2. Every `deals.location_id` belongs to that deal's `company_id`.
3. Every `deals.contact_id` exists in `cdp.customer_profile` for org `1003`, and that person has an email in `cdp.identity_keys`.
4. Every won deal has `closed_at`, an `accepted` quote, a `confirmed` order, and at least one invoice. Paid invoices have `paid_at`.
5. Open deals have no `closed_at`. Lost deals have `closed_at` and `lost_reason`.
6. Quote, order, and invoice numbers do not collide with existing org 1003 numbers (`Q-…`, `SO-…`, `INV-…`). `sales_orders` is unique on `(organization_id, number)`.
7. Line `product_id` values exist on `inventory.products` for org `1003`.
8. No new rows in auth, OAuth, or encrypted columns.

Column types and enums that are not repeated here are in [`01-database-schema.md`](01-database-schema.md) under each table and under **Enumerations**.
