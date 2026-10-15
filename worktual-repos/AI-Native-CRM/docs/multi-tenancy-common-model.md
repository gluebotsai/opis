# Multi-tenancy common model (B2B / B2C / B2B2C)

Enterprise invariants for how Worktual CRM stores and isolates tenant data.
This document locks the decisions from the common-table roadmap — agents and
engineers must not re-propose schema forks that contradict it.

## Locked decisions

| Decision | Choice |
|---|---|
| Storage by motion | **One shared CRM schema** for `b2b` / `b2c` / `b2b2c` — gate modules and rules by `accounts.organizations.business_type` |
| Party model | Keep **separate** `companies` + CDP identity (`customer_profile` / `identity_keys`) + `crm.contact_profiles` |
| Industry | `accounts.organizations.industry_type` (signup) mapped to CRM field packs — not a second CRM picker, not new tables per ecommerce / healthcare / telecom |
| Franchise B2B2C | Brand = Worktual `organization_id`; franchise = `companies` (`channel_role`); customers = contacts linked to that company |
| Isolation | App tenancy (`organization_id` + ownership / channel scope); Postgres RLS is a later hardening pass |
| Shared DB | No `CREATE` / `ALTER` / `DROP` on `cdp`, `accounts`, or **`inventory`** — CRM-owned state stays in `crm.*` (product *rows* in `inventory.products`) |

## Three orthogonal axes

```text
business_type (motion)     → modules + revenue path (sales vs commerce, finance or not)
org vertical (industry)    → accounts.industry_type → field packs / labels / playbooks
channel hierarchy          → brand org → franchise company → contact
```

Do **not** collapse these into one enum or one polymorphic party table.

## Shared tables (common model)

| Concern | Store |
|---|---|
| Tenant key | `organization_id` on CRM rows |
| Person identity | `cdp.customer_profile` + `cdp.identity_keys` |
| CRM person overlay | `crm.contact_profiles` (+ optional `custom_attributes`) |
| Accounts / franchises | `crm.companies` (+ `channel_role`, optional `parent_company_id`) |
| B2B revenue | deals → quotes → orders → invoices |
| B2C commerce | `sales_orders` with `deal_id` null and `contact_id` set |
| Catalog | `inventory.products` for **all** motions (B2B / B2C / B2B2C). CRM DML only (no DDL). No `crm.products`. `cdp.products` is not the CRM working copy |
| Org vertical pack | Mapped from `accounts.organizations.industry_type`; optional `crm.organization_profiles` for pack config only |

Motion gating: [`backend/src/config/modules.ts`](../backend/src/config/modules.ts).
Contact copy helpers: [`backend/src/lib/business-type-copy.ts`](../backend/src/lib/business-type-copy.ts).

## Non-goals (do not implement)

- Separate physical tables per motion (`b2b_*` / `b2c_*` / `b2b2c_*`)
- Unified polymorphic `customer_entities` (TENANT / PARTNER / CONSUMER in one table)
- Industry-specific contact tables (`healthcare_contacts`, …)
- Per-franchise physical table splits
- DDL on shared `cdp` / `accounts` schemas
- Treating “common tables” as “one JSONB party bag”

## Motion rules (server must enforce)

| Type | Contacts ↔ company | Revenue |
|---|---|---|
| **B2B** | Company **required** on contact create/update | Deal → quote → order → invoice |
| **B2C** | Company module disabled; no company on contacts | Contact → commerce order (no Finance) |
| **B2B2C** | Company **optional** on contacts | Sales **and** commerce; deals still require company |

Changing an org’s `business_type` is an accounts / ops concern (existing column on
`accounts.organizations`). CRM reads it via session; it does not own accounts DDL.

## Industry verticals

- Source of truth: `accounts.organizations.industry_type` (set at tenant signup). CRM **SELECT**s it; it does not write accounts.
- Mapped in code to a field pack (`general` \| `ecommerce` \| `healthcare` \| `finance` \| `telecom`). Unrecognized values use **general** (no extra fields).
- Pack values live on `contact_profiles.custom_attributes` (CRM overlay only — never new CDP columns).
- There is **no Configuration → Industry screen**. Packs apply automatically on contact forms from the accounts value.
- **Adding a new industry pack** = new pack registration + mapping aliases, not customer-table migrations.

## Franchise / channel

- Same tenant (`organization_id`).
- Franchise / owned store / brand HQ = `companies.channel_role`.
- Optional `parent_company_id` for trees under the same org.
- Franchise-scoped users see contacts/orders for their allowed companies;
  `admin` / `sales_manager` see org-wide.
- Cross-franchise shared consumers and partner private/shared JSON namespaces
  are follow-ons; not required for v1 channel scoping.

## Phase 4 backlog (deferred)

Documented here so the roadmap stays explicit; not implemented in this pass:

- Optional Postgres RLS on hot `crm.*` tables (`organization_id` + session GUC)
- Commerce depth (status edit, multi-line)
- Optional CDP → `inventory.products` import (existing `cdp.products` rows are not the CRM working copy)
- Partner settlement / payouts if Finance copy becomes real product
- Cross-franchise shared consumers + partner private/shared JSON namespaces

## Related docs

- [`contact-module.md`](contact-module.md) — contact UX and motion-aware company rules
- [`metric-source-field-map.md`](metric-source-field-map.md) — commerce on shared `sales_orders`
- [`.cursor/rules/enterprise-production.mdc`](../.cursor/rules/enterprise-production.mdc) — role × module matrix
- [`.cursor/rules/cdp-accounts-readonly.mdc`](../.cursor/rules/cdp-accounts-readonly.mdc) — shared DB boundaries
