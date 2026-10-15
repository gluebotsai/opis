# Worktual My Accounts — Complete Knowledge Transfer (KT)

> **Living document.** Update this file whenever portals, login, APIs, DB tables, statuses, env, or major flows change.  
> Companion narrative for roles/flows also exists in `KT-FLOWS.md` — prefer keeping **this file** as the single source of truth for DB + action mapping.  
> Last reviewed: 2026-08-06 (branch context: `main` — CCaaS agents/queue capacity + Campaign numbers removed).

---

## 0. How to keep this file current

| Change type | Sections to update |
|-------------|-------------------|
| Login / auth / session / roles | §3, §4, §11 |
| New/changed portal page or nav | §2, §5 |
| New/changed API route | §6, §11 |
| Schema / migration / table / status | §7, §8, §9, §10 |
| Payment / fulfillment / go-live | §9, §10 |
| Env / ports / run commands | §1, §12 |
| API response shape | §13 |

Cursor rule: `.cursor/rules/knowledge-md.mdc` (always apply).

---

## 1. Product overview & how to run

**Worktual My Accounts** is a multi-portal SaaS for sales quoting, finance payment confirmation, customer self-service (products, invoices, setup workspace, go-live), partners/resellers, and admin platform config.

### Layout

```text
frontend/     React 19 + Vite 6 + React Router — UI
backend/      Fastify 5 TypeScript API, worker, Postgres migrations
```

No shared root `node_modules`. Install and run each package separately.

### Local run

| Package | Command | Default URL |
|---------|---------|-------------|
| Backend | `cd backend && pnpm install && pnpm dev` | http://localhost:3002 |
| Frontend (bundled watch) | `cd frontend && pnpm install && pnpm dev` | http://localhost:5173 |
| Frontend (Vite HMR) | `cd frontend && pnpm dev:hmr` | http://localhost:5173 |

- Frontend proxies `/api` → `VITE_API_PROXY` (default `http://127.0.0.1:3002`).
- Backend port: `MAIL_API_PORT` \|\| `PORT` \|\| **3002**.
- Migrations run on API boot unless `SKIP_MIGRATE_ON_BOOT=true`.
- Worker: `cd backend && pnpm worker` (or `worker:source`).

### Important entry files

| Concern | Path |
|---------|------|
| Frontend routes | `frontend/src/App.tsx` |
| Route guards | `frontend/src/components/ProtectedRoute.tsx` |
| Shells / nav | `frontend/src/layouts/*Shell.tsx` |
| Backend server | `backend/src/server.ts` |
| Legacy schema create | `backend/database/schema.sql` |
| Multi-schema tenancy | `backend/database/v2/*` |
| Migrations | `backend/src/db/migrate.ts` |
| Payment fulfillment | `backend/src/modules/payments/fulfillment.ts` |
| Go-live store | `backend/src/modules/product-go-live/*` |
| API envelope | `backend/src/helpers/api-response.ts` |

---

## 2. Portals (who uses what)

Unified login UI: **`/`** (`LoginPage`). Legacy `/finance/login` and `/customer/login` redirect to `/`.

| Portal | Who | Home path | Shell | Guard |
|--------|-----|-----------|-------|-------|
| **Admin** | Platform admins | `/admin/users` | `AdminShell` | `AdminRoute` |
| **Sales** | Sales executives | `/dashboard` | `SalesWorkspaceShell` → `AppShell` | `SalesWorkspaceRoute` |
| **Sales Admin** | Sales managers | `/dashboard` (+ oversight) | `SalesAdminShell` / workspace | `SalesWorkspaceRoute` + oversight |
| **Sales Oversight** | Admin + sales_admin | `/sales-oversight` | Layout wraps Admin or SalesAdmin shell | `SalesOversightRoute` |
| **Finance** | Finance team | `/finance/queue` | `FinanceShell` | `FinanceRoute` |
| **Number Management** | Number ops | `/number-management/dashboard` | `NumberManagementShell` | `NumberManagementRoute` |
| **Customer** | Org / branch users | `/customer/dashboard` | `CustomerPortalShell` | `CustomerRoute` |
| **Partner** | Referral partners | `/partner/dashboard` | `PartnerShell` | `PartnerRoute` |
| **Reseller** | Resellers | `/reseller/dashboard` | `ResellerShell` | `ResellerRoute` |

Staff roles constant: `frontend/src/lib/auth.js` → `ROLES`: `admin`, `sales`, `sales_admin`, `finance`, `number_management`.

---

## 3. Login & sessions (keep in sync when auth changes)

### 3.1 Sign-in order

**Primary:** `POST /api/auth/sign-in`  
Implementation: `backend/src/modules/auth/session-auth.ts` → `signInAccount` tries:

1. **Internal staff** (`users` / `auth_sessions`)
2. **Reseller** (`reseller_users` / `reseller_auth_sessions`)
3. **Partner** (`partner_users` / `partner_auth_sessions`)
4. **Customer** (`customer_users` / `customer_auth_sessions`)

Also available:

| Endpoint | Audience |
|----------|----------|
| `POST /api/auth/login` | Staff only |
| `POST /api/v1/customer/login` | Customer direct |
| Partner / Reseller | Via `/api/auth/sign-in` only (logout: `/api/partner/logout`, `/api/reseller/logout`) |

Frontend helper: `frontend/src/lib/signIn.js`.

### 3.2 Session storage (browser)

| Account | Session key | Token key |
|---------|-------------|-----------|
| Staff | `worktual-session` | `worktual-auth-token` |
| Customer | `worktual-customer-session` | `worktual-customer-token` |
| Partner | `worktual-partner-session` | `worktual-partner-token` |
| Reseller | `worktual-reseller-session` | `worktual-reseller-token` |

Tokens are **opaque DB session rows** (Bearer), not JWT for these portal paths.

### 3.3 Auth → DB tables

| Account type | Users table | Sessions table | Schema (v2) |
|--------------|-------------|----------------|-------------|
| Staff | `users` | `auth_sessions` | `platform` |
| Customer | `customer_users` | `customer_auth_sessions` | `accounts` |
| Partner | `partner_users` | `partner_auth_sessions` | `platform` |
| Reseller | `reseller_users` | `reseller_auth_sessions` | `platform` |
| Password reset OTP | `password_reset_otps` (`account_type` ∈ internal/reseller/partner/customer) | | `platform` |

### 3.4 Session rules

- Single active session for non-admin (conflict → **409**; replace with `replaceSession` when allowed).
- Admin generally exempt from single-session lock.
- Smoke / QA: `ALLOW_LOGIN_SESSION_REPLACE=1`.
- Customer forced password change may redirect home to `/customer/account`.

### 3.5 Post-login home (staff)

| Role | Path |
|------|------|
| `admin` | `/admin/users` |
| `sales` / `sales_admin` | `/dashboard` |
| `finance` | `/finance/queue` |
| `number_management` | `/number-management/dashboard` |

---

## 4. Portal responsibilities (what each role does)

### Admin
- Staff users CRUD / bulk upload / force logout  
- Customer portal users directory / force logout  
- Partners & resellers CRUD  
- Pricing catalog, commission slabs, invoice settings  
- Cancellation request queue  
- Sales oversight  
- Mail (Outlook) for admin mailbox  

**Tables often touched:** `users`, `auth_sessions`, `customer_users`, `partners`, `partner_users`, `resellers`, `reseller_users`, `pricing_catalogs`, `commission_slabs`, `invoice_company_settings`, `branch_cancellation_requests`.

### Sales
- Create/edit assigned leads, configure products, generate quotations, email via Outlook, forward payment links, support, product requests, implementation/UAT hand-off.

**Tables:** `leads`, `lead_assignments`, `branches`, `quote_sessions`, `quotations`, `product_assignments`, `product_summary_items`, `active_products`, `product_go_live`, `mail_*`, `email_outbox`, `customer_product_requests`.

### Sales admin
- Same as sales + team oversight, broader quote rights (including reseller-owned leads), agent management under `/sales-oversight/*`.

### Finance
- Approve/reject quotations, confirm payments (gateway or manual), partner commissions views, mail.

**Tables:** `quotations`, `payments`, `quotation_branch_payments`, `payment_webhook_events`, `partner_commission_entries`, `organizations` (via fulfillment), `subscriptions`, `purchase_orders`.

### Number management
- DID / number mapping inventory and customer number views.

**Tables:** `number_mappings`, `number_providers`, `provider_numbers`, `agent_did_usage_monthly`, `organizations`.

### Customer portal
- Dashboard, products, invoices, support, onboarding, operational hub, **Setup Workspace** (business hours, teams, queues, people, KB, channels, etc.), go-live accept / request changes.

**Tables:** `customer_users`, `organizations`, `organization_locations`, `subscriptions`, `product_access_grants`, `product_go_live`, `subscription_invoices`, `support_tickets*`, `customer_product_requests`, `branch_add_requests`, `branch_cancellation_requests`, `accounts.setup_*`, `cdp.contacts`.

### Partner
- Own leads, commissions, bank details, commission slabs view.
- **Live refresh:** `PartnerShell` opens SSE (`/api/events/stream`) on channels `quotations`, `payments`, `commissions` using the partner session token. Backend delivers only events whose `partnerId` matches the logged-in partner. Pages debounce-refetch KPIs/tables on `payment.*`, `quotation.*`, `commission.*`.

**Tables:** `partners`, `partner_users`, `leads` (`partner_id`), `partner_commission_entries`, `partner_bank_accounts`, `commission_slabs`.

### Reseller
- Own leads, renewals, invoices.
- **Live refresh:** same SSE pattern as partner on channels `quotations`, `payments`; events filtered by `resellerId`.

**Tables:** `resellers`, `reseller_users`, `leads` (`reseller_id`), `organizations` (`reseller_id`), quotations / renewals / invoices as applicable.

---

## 5. Key UI routes by portal

### Admin (`/admin/*`)
`/admin/users`, `/admin/customer-portal-users`, `/admin/partners`, `/admin/resellers`, `/admin/commission-slabs`, `/admin/invoice-settings`, `/admin/cancellation-requests`, `/admin/pricing`, `/admin/mail`, `/admin/account`, plus `/sales-oversight/*`.

### Sales workspace
`/dashboard`, `/products`, `/products/:leadId`, `/products/:leadId/products/*`, `/products/:leadId/workflow`, `/products/:leadId/compose`, `/products/:leadId/payment-forward`, `/*/implementation-uat`, `/customers`, `/mail`, `/support`, `/account`.

### Finance
`/finance/queue`, `/finance/commissions`, `/finance/mail`, `/finance/account`.

### Number management
`/number-management/dashboard`, `/number-management/inventory`, `/number-management/mappings`, `/number-management/customers/:organizationId`, mail/account.

### Customer
`/customer/dashboard`, `/customer/products`, `/customer/onboarding`, `/customer/operational-hub`, `/customer/invoices`, `/customer/support`, `/customer/account`, `/customer/setup/*`.

### Partner / Reseller
`/partner/dashboard` (+ leads, commissions, bank), `/reseller/dashboard` (+ leads, renewals, invoices).

Public misc: `/invite/set-password`, `/mail/oauth-callback`, `/webchat/test/:webchatId`.

---

## 6. Backend architecture (short)

- **Framework:** Fastify native routes under `backend/src/modules/*/native-routes.ts` (and `routes.ts` where used).
- **DB:** `pg` pool (`backend/src/db/pool.ts`) with `search_path = accounts, platform, public`.
- **Tenancy:** per request `platform.set_staff_mode()` or `platform.set_tenant(org_id)` → GUC `app.is_staff` / `app.organization_id`.
- **Jobs:** BullMQ worker (`backend/src/worker.ts`) — email outbox, UAT expiry, payment recovery, etc.
- **Redis:** optional (`REDIS_URL`); without it health reports redis not configured.

---

## 7. Database schemas (v2 multi-tenancy)

| Schema | Holds |
|--------|--------|
| **`platform`** | Staff, pricing catalogs, mail OAuth/outbox, partners/resellers, `platform.products`, `schema_migrations` |
| **`accounts`** | Tenancy root `organizations`, leads, quotes, payments, subscriptions, portal, commissions entries, setup workspace |
| **`crm` / `cvm` / `ticketing` / `ccass` / `cdp` / `campaign`** | Product stub schemas |
| **`public`** | Unmoved leftovers (e.g. `invoice_company_settings`; some migrate-only tables if created before move) |

Docs: `backend/database/v2/README.md`.  
Apply order: `00_schemas` → `schema.sql` → `01_move_tables` → `02_tenancy` → stubs → RLS → grants → setup → CDP, etc. (`migrate.ts`).

**Tenancy key:** `organization_id` (UUID). Human code: `organizations.tenant_id` / `leads.tenant_id`.

**RLS:** FORCE RLS on core `accounts.*` with `tenant_isolation` using `platform.rls_org_ok` / `rls_entitled`. Platform staff tables are not tenant-RLS’d the same way.

---

## 8. Table inventory (by domain)

Unqualified names resolve via `search_path` (`accounts`, then `platform`, then `public`). After v2 moves, prefer thinking in `schema.table`.

### 8.1 Platform — staff & auth
`users`, `auth_sessions`, `export_audit_logs`, `password_reset_otps`

### 8.2 Platform — pricing / registry
`pricing_catalogs`, `platform.products`  
`public.invoice_company_settings` (invoice company defaults)

### 8.3 Platform — mail
`mail_oauth_connections`, `mail_oauth_states`, `email_outbox`, `graph_mail_subscriptions`, `mail_signatures`  
(+ migrate: `mail_templates`, `mail_folder_cache`)

### 8.4 Platform — partners & resellers
`partners`, `partner_users`, `partner_auth_sessions`, `partner_bank_accounts`, `commission_slabs`  
`resellers`, `reseller_users`, `reseller_auth_sessions`

### 8.5 Accounts — CRM / tenancy
`organizations`, `organization_locations`, `leads`, `lead_assignments`, `additional_addresses`, `branches`

### 8.6 Accounts — quotations & payments
`quote_sessions`, `quotations`, `product_assignments`, `product_summary_items`, `quotation_invoices`, `payments`, `quotation_branch_payments`, `payment_webhook_events`, `active_products`

### 8.7 Accounts — subscriptions / go-live / usage
`subscriptions`, `subscription_entitlements`, `purchase_orders`, `subscription_items`, `usage_metrics`, `usage_metrics_monthly`, `product_go_live`, `renewal_events`, `subscription_invoices`, `partner_commission_entries`

**CCaaS number entitlement columns** (also optional snapshot on `product_assignments`): `agent_count`, `included_number_count` (= agents), `queue_capacity_count`, `total_number_count` (= agents + queue). Synced from assignment `config` on payment/go-live (`maintenance/subscription_number_counts_v1`). Config JSON also stores `includedNumberCount`, `queueCapacityCount`/`Rate`/`Enabled`, `telcoLineCharge`, `totalNumberEntitlement`. Agent invoice line = `(agentRate + telcoLineCharge) × agentCount`; Queue capacity is a separate add-on (replaces CCaaS phone-number SKU). Campaign no longer sells/entitles numbers (messaging packs only); CRM keeps hybrid user licenses + numbers.

### 8.8 Accounts — customer portal & requests
`customer_users`, `customer_auth_sessions`, `product_access_grants`, `support_tickets`, `support_ticket_messages`, `customer_product_requests`, `branch_cancellation_requests`, `branch_cancellation_alerts`, `branch_add_requests`

### 8.9 Accounts — Setup Workspace
`setup_holiday_calendars`, `setup_holidays`, `setup_business_hours`, `setup_business_hour_shifts`, `setup_teams`, `setup_roles`, `setup_users`, `setup_user_invite_tokens`, `setup_user_product_access`, `setup_channel_configs`, `setup_email_configs`, `setup_webchat_configs`, `setup_social_configs`, `setup_ccaas_queues`, `setup_ccaas_queue_agents`, `setup_crm_channel_agents`, `setup_knowledge_documents`, `setup_voice_prompt_profiles`, `setup_voice_dids`, `setup_app_connections`

### 8.10 Product stubs / CDP
`crm.accounts`, `crm.contacts`, `cvm.value_scores`, `ticketing.tickets`, `ccass.agents`, `cdp.profiles`, `cdp.contacts`, `campaign.campaigns`

### 8.11 Number management (migrate-ensured)
`number_mappings`, `agent_did_usage_monthly`, `number_providers`, `provider_numbers`

(`available_numbers` exists only on DBs that ran older `number_management_v1`; runtime code no longer reads or writes it.)

Follow-up keys (must not reuse v1 when schema evolves):
- `maintenance/number_mappings_product_id_v1` — adds `number_mappings.product_id` when v1 ran without it
- `maintenance/mail_mailbox_profile_widen_v1` — widens mail `mailbox_profile` / folder `profile` to `VARCHAR(64)` for `number_management` (18 chars)
- `maintenance/subscription_number_counts_v1` — CCaaS agent/included/queue/total number count columns on `subscriptions` + `product_assignments`

### 8.12 Implementation customer details (quick answer)
| Need | Table |
|------|-------|
| Implementation / go-live workflow | **`product_go_live`** |
| Company & contact | **`organizations`** (`product_go_live.organization_id`) |
| Original lead | **`leads`** |
| Implementation purchased flag | **`active_products.implementation_purchased`** |

---

## 9. Action → database map (core flows)

Use this when debugging “which table did that write?”.

### 9.1 Login / logout / password reset

| Action | Tables |
|--------|--------|
| Staff login | `users` (read), `auth_sessions` (insert; may revoke prior) |
| Customer login | `customer_users`, `customer_auth_sessions` |
| Partner / reseller login | `partner_users` / `reseller_users` + session tables |
| Logout | Delete/invalidate matching `*_auth_sessions` row |
| Password reset request/confirm | `password_reset_otps` + target users table |

### 9.2 Lead → quotation → finance

| Action | Tables |
|--------|--------|
| Create lead | `leads`, often prospect `organizations` + `leads.organization_id`, `lead_assignments`, `branches` / addresses |
| Edit quote draft | `quote_sessions`, `product_assignments` (as used by flow) |
| Submit quotation | `quotations`, `product_assignments`, `product_summary_items`; lead/quote statuses |
| Finance approve | `quotations.status` → Approved; may create payment intent / link |
| Finance reject | `quotations.status` → Rejected; lead status updates |
| Create payment / checkout | `payments`, possibly `quotation_branch_payments` |
| Webhook (Stripe/Razorpay) | `payment_webhook_events`, then `payments` / branch payments |

**Statuses (quotations):** `Pending Finance Review` → `Approved` → `Paid` \| `Rejected`  
**Statuses (leads):** `New`, `In Progress`, `Qualified`, `Pending Finance Review`, `Approved`, `Partially paid`, `Paid`, `Rejected`  
(Source: `backend/src/lib/statuses.ts`)

### 9.3 Payment fulfillment (paid quote)

Core: `backend/src/modules/payments/fulfillment.ts` → `syncQuotationProductFulfillment`.

| Step | Tables |
|------|--------|
| Ensure active products | `active_products` |
| Ensure org for paid lead | `organizations`, `organization_locations` |
| Billing phase = `implementation` | `product_go_live` seeded from OTC quote (**no** live subscription yet) |
| Standard / go-live paid | `subscriptions`, `purchase_orders`, `subscription_items`, entitlements; mark `product_go_live` → `live` when go-live phase |
| Provision portal | `customer_users`, sessions / grants as needed |
| Partner commission | `partner_commission_entries` |
| Notify | `email_outbox` (+ jobs) |

**Payment statuses:** `pending` → `reported` / `partial` → `paid` (also `failed`, `refunded`).

**Quotation `billing_phase`:** `standard` \| `implementation` \| `go_live_proration` \| `mrr_adjustment` \| `renewal_cancel`.

### 9.4 Implementation / go-live lifecycle

Table: **`product_go_live`**.

| `lifecycle_status` | Meaning | Typical writers |
|--------------------|---------|-----------------|
| `awaiting_implementation` | OTC paid; wait for sales UAT | Fulfillment seed |
| `uat` | UAT credentials active | Sales send-UAT |
| `uat_expired` | Window ended | Worker job |
| `awaiting_subscription_payment` | Customer accepted; go-live quote created | Customer accept |
| `live` | Go-live payment done | Fulfillment |

Related columns: `otc_quotation_id`, `go_live_quotation_id`, `subscription_id`, `uat_expires_at`, `uat_credentials`.

APIs (examples): `/api/leads/:leadId/go-live`, `/api/customer/go-live`, accept / request-changes (`frontend/src/lib/goLive.js`).

### 9.5 Customer portal product / branch requests

| Action | Tables |
|--------|--------|
| Request new product / change | `customer_product_requests` |
| Request add branch | `branch_add_requests` |
| Request cancellation | `branch_cancellation_requests`, alerts |
| Admin/finance resolve cancel | Same + subscriptions / org locations as flow defines |

### 9.6 Mail

| Action | Tables |
|--------|--------|
| Connect Outlook | `mail_oauth_connections`, `mail_oauth_states` |
| Graph subscription | `graph_mail_subscriptions` |
| Send / queue email | `email_outbox` |
| Signatures / templates | `mail_signatures`, `mail_templates` |

Webhook/OAuth callback paths skip JSON API envelope.

### 9.7 Setup Workspace (customer)

Writes under `accounts.setup_*` and often `cdp.contacts` for contacts. Org-scoped; RLS applies.

### 9.8 Number management

| Action | Tables |
|--------|--------|
| Map DID | `number_mappings` (+ optional `provider_id`); consumes row from `provider_numbers` |
| Provider inventory | `number_providers`, `provider_numbers` (UI: name/image/country; `storage` / `account_id` columns unused by UI) |
| Usage rollups | `agent_did_usage_monthly` |

---

## 10. End-to-end happy path (sales → paid → customer)

```text
Sales creates lead
  → leads (+ org prospect / assignments / branches)
Sales configures products & submits quotation
  → quotations, product_assignments, …
Finance approves
  → quotations.status = Approved; payment link
Customer/sales pays (Stripe/Razorpay) or finance confirms
  → payments (+ webhooks)
Fulfillment
  → active_products
  → organizations (convert/ensure)
  → if implementation phase: product_go_live (awaiting_implementation)
  → else: subscriptions / purchase_orders / …
  → customer_users provisioned
Sales sends UAT (implementation products)
  → product_go_live.lifecycle_status = uat
Customer accepts go-live
  → awaiting_subscription_payment + go_live quotation
Pay go-live / confirm
  → subscriptions live; product_go_live = live
Customer uses portal + setup workspace
  → setup_*, cdp.contacts, support_*, invoices
```

---

## 11. Important API surface (group map)

| Area | Typical prefix | Module folder |
|------|----------------|---------------|
| Auth / sign-in | `/api/auth/*` | `modules/auth` |
| Customer auth | `/api/v1/customer/*` | `modules/customer-portal` |
| Leads / sales | `/api/leads/*` | `modules/leads` |
| Quotations / finance queue | `/api/quotations/*`, finance routes | `modules/quotations` |
| Payments / webhooks | `/api/payments/*` | `modules/payments` |
| Go-live | `/api/leads/.../go-live`, `/api/customer/go-live` | `modules/product-go-live` |
| Partners / resellers | `/api/partner*`, `/api/reseller*`, admin partners | `modules/partners`, `modules/resellers` |
| Number management | `/api/number-management/*` | `modules/number-management` |
| Mail | `/api/mail/*` | `modules/mail` |
| Health | `/api/health` | `modules/health` |
| Pricing | `/api/pricing-catalog` | pricing modules |
| Platform utils | `/api/v1/tax/*`, etc. | `modules/platform` |

Exact route registration: `backend/src/server.ts` + each module’s `native-routes` / `routes`.

---

## 12. Environment variables (high signal)

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | Postgres |
| `REDIS_URL` | Optional queues / SSE |
| `MAIL_API_PORT` / `PORT` | API listen (ops default **3002**) |
| `APP_URL` | SPA origin (OAuth redirects) |
| `VITE_API_PROXY` | Frontend → API proxy target |
| `PAYMENT_PROVIDER` | `stripe` / razorpay defaulting |
| `STRIPE_*` / `RAZORPAY_*` | Keys + webhook secrets |
| `ADMIN_LOGIN_*`, `FINANCE_LOGIN_*`, `SALES_LOGIN_*`, `SALES_ADMIN_LOGIN_*` | Seed staff |
| `MS_CLIENT_ID`, `MS_CERT_THUMBPRINT`, `MS_PRIVATE_KEY_PATH`, `MS_TENANT_ID`, … | Graph mail |
| `ALLOW_LOGIN_SESSION_REPLACE` | QA session replace |
| `SKIP_MIGRATE_ON_BOOT` | Skip migrate on start |
| `MAIL_DRY_RUN` | Don’t send real mail |

See `backend/.env.example`, `frontend/.env.example`.

---

## 13. API response envelope

Global `onSend` plugin wraps JSON responses:

```json
{ "statusCode": 200, "message": "Success", "users": [/* payload fields at root */] }
```

- Helper: `backend/src/helpers/api-response.ts` (`toApiEnvelope`).
- Frontend unwrap: `frontend/src/lib/http.js` (`fetchJson` strips `statusCode`/`message` for callers).
- **Skipped:** payment webhooks, mail Graph webhook/OAuth callbacks, SSE `/api/events/stream`, non-JSON.

**SSE auth:** staff session, customer session, partner session (`partner_auth_sessions`), or reseller session (`reseller_auth_sessions`) via `access_token` query param. Partner/reseller clients only receive payloads that include their `partnerId` / `resellerId`. Channels include `commissions` (`commission.paid`, `commission.accrued`) in addition to quotations/payments.

**Manual UTR / bank reference:** finance offline payment + commission payout — `^[A-Z]{4}[0-9]{12,20}$` (4 capital letters + 12–20 digits); validated in UI (`frontend/src/lib/utrValidation.js`) and API (`backend/src/lib/utr-validation.ts`). Input is uppercased on sanitize.

In-flight GET coalescing may dedupe concurrent identical GETs in the browser (`http.js`).

---

## 14. Frontend local serve notes

| Script | Behavior |
|--------|----------|
| `pnpm dev` | Production-like bundle + watch + preview + auto-refresh (`frontend/scripts/dev-bundled.mjs`) — few chunk requests |
| `pnpm dev:hmr` | Classic Vite ESM — many `/src/*.tsx` script requests in Network is **normal**, not API spam |

Filter Network **Fetch/XHR** to see real `/api` calls.

---

## 15. QA / seed logins (local & Worktual QA)

Documented for Chrome GUI testing against QA onboarding; local seeds come from env.

**Typical staff (QA):**
- Admin: `onboarding.admin@worktual.com` / `admin123`
- Sales admin: `onboarding.salesadmin@worktual.com` / `SalesAdmin@123`
- Sales: `onboarding.sales1@worktual.com` / `SALES@123`

Confirm against current seed/env before sharing externally. Never commit real production secrets into this file.

---

## 16. Glossary

| Term | Meaning |
|------|---------|
| Lead | Pre/post-sale CRM record in `leads` |
| Organization | Paying (or prospect) tenant root in `organizations` |
| Active product | Paid/approved product key row before/alongside subscription |
| OTC / implementation phase | One-time implementation fee billing before full MRR go-live |
| Go-live | Customer accepts UAT and pays subscription proration |
| Tenant | `organization_id` for RLS |
| Envelope | Flat `{ statusCode, message, ...payload }` API wrapper |

---

## 17. Related docs

| Doc | Role |
|-----|------|
| `knowledge.md` (this file) | **Master KT** — portals + DB + actions |
| `KT-FLOWS.md` | Narrative role/flow deep-dive |
| `README.md` | Quick start |
| `backend/database/v2/README.md` | Schema move / RLS |
| `backend/README.md` / `frontend/README.md` | Package-specific notes |

---

*When in doubt after a change: update §0 checklist sections, bump “Last reviewed” date, and note the PR/branch in the changelog line below.*

### Changelog (KT doc)

| Date | Note |
|------|------|
| 2026-08-06 | Map number / create mapping: removed runtime dependency on legacy `available_numbers` table (fixes `relation "available_numbers" does not exist` on QA DBs without that table). Mapping create/update only consumes `provider_numbers`; `GET /api/number-management/available-numbers` lists unassigned provider inventory across all providers; POST to that route returns guidance to use Number Inventory. |
| 2026-08-06 | Number inventory add-number: country dial + national digits with provider-country validation (FE + BE); CSV import rejects invalid country numbers; logo avatar uses contain in a wide rect; Add button aligned to input height. |
| 2026-08-06 | Number providers schema: tracked migration `maintenance/number_providers_inventory_v1` (tables were nested under already-applied `number_management_v1`, so existing DBs missed them — caused `relation "number_providers" does not exist` / `column "provider_id" does not exist`). Inventory search toolbar no longer flex-grows; logo upload is a full-width rectangle. |
| 2026-08-06 | Number inventory UX: Add/Edit provider is a right side overlay; **storage** / **account_id** removed from inventory UI + payloads (DB columns kept; create defaults empty; patch omits keep existing). |
| 2026-08-06 | Number management **Number inventory** nav page: providers (name, image, country) + per-provider unassigned numbers; bulk CSV (number-only) with resolve dialog for global conflicts; Map Number uses provider dropdown → pick from that provider’s inventory (or type manually); entitlement-gated CC/CRM only. Legacy `available_numbers` pool left in place unused by the new map flow. Tables: `number_providers`, `provider_numbers`, `number_mappings.provider_id`. |
| 2026-08-06 | Product model: CCaaS `includedNumberCount = agentCount`; agent invoice folds telco (`(agentRate + telcoLineCharge) × agents`); plan/mid add-on **Queue capacity** replaces Number count increase / `phoneNumbers`; entitlement = agents + queue. Campaign Number Count / Additional numbers removed from catalog defaults, admin, quote UI, invoice, and NM entitlement (force 0). CRM hybrid numbers unchanged. DB: `maintenance/subscription_number_counts_v1` adds `agent_count` / `included_number_count` / `queue_capacity_count` / `total_number_count` on `subscriptions` (+ nullable on `product_assignments`); synced in `subscription-store` on pay/go-live. |
| 2026-08-06 | Invoice tax by buyer country: India keeps GST (CGST/SGST or IGST at 18%); UK 20% VAT, UAE 5% VAT, and other non-India countries use a single VAT line at `taxRate` from `countryDefaults` (no CGST/SGST). Mirrored in frontend + backend `invoice` + `countryDefaults`. |
| 2026-08-05 | Single-location UI chrome commented out (not deleted) across sales/customer/finance/admin: Locations columns/KPIs/panels, Branch table columns, product-workflow Locations step (`showBranchAssignment = false`), and product Location/branch labels. HQ address forms and APIs unchanged for restore later. |
| 2026-08-05 | Country-aware address division + tax naming: `frontend/src/lib/countryDefaults.js` (+ backend mirror `backend/src/lib/countryDefaults.ts`) gained `divisionLabel`/`divisions` per country (IN→State, UK→County, US→State, AE→Emirate, AU→State/Territory, CA→Province, SG→Region, DE→State, FR→Region; `Other` has no list) plus `getDivisionLabelForCountry` / `getDivisionPlaceholderForCountry` helpers. Head-office + branch "state" fields (`OnboardingPage.tsx` `StateField`/`AdditionalAddressesField`, `ExternalLeadForm.tsx` `ExternalStateField`, `ProductWorkflowPage.tsx` new-location branch field) now show a country-specific dropdown (falling back to a labeled free-text input when no curated list exists) with the division label instead of the hardcoded "State" / "State or province"; a stored value not in the curated list is still shown as an extra option so old free-text data doesn't disappear. Invoice generation (`frontend/src/lib/invoice.js` + backend mirror `backend/src/lib/invoice.ts`, used by sales quote invoices and server-side auto-renewal invoices) now labels the buyer's tax line with `Buyer <taxLabel>` (GST/VAT/etc. per buyer country, already-existing per-country logic) and the seller's own line with `Seller GST`/`Seller GSTIN` for clarity, and the default "Delivery Timeline" tax notice ("… will be applied as per prevailing tax regulations.") now names the buyer's country tax label instead of always saying "GST". Fixed a bug where editing PERIOD START / PERIOD END in "Review invoice before finance submission" → in-preview editor did not update the rendered PDF's period text (added `formatInvoiceSheetPeriodLine` in `invoice.js`, wired into `EditableInvoiceSheet.tsx`'s `patch()` so the Delivery Timeline line stays in sync when the date pickers change, without clobbering manually-edited footer text). |
| 2026-08-05 | Mail bug fixes: `GET /api/mail/messages/item/attachments/item` (fixed path, `?attachmentId=`) added so long Graph attachment ids never hit Fastify's default `maxParamLength` (100) on `:attachmentId` — fixes "Download all" (and any long-id single download) failing with "exceeding the max param length"; `fetchMailAttachment` frontend helper updated to match. `.mail-read-pane__body--html` changed from `overflow: hidden` to `overflow-y: auto` so long HTML email bodies (invoice HTML, sent mail) scroll instead of clipping in finance/sales/admin read pane. |
| 2026-08-05 | Customer portal “Request a new product” **Note for sales** is required (UI + API); empty notes are rejected. |
| 2026-08-05 | Customer “Request new product” inquiries (including empty “Note for sales”) stay open on sales until a quote is **explicitly** linked — removed unlinked-inquiry auto-fulfill on list load, and quote create no longer auto-attaches notify-only inquiries. Customer portal branch-scoped request lists also keep inquiries visible (they have no assignments). |
| 2026-08-05 | Customer “Request new product” inquiries no longer auto-close against older unlinked approved/paid quotes; only quotes at/after the inquiry (or an explicit quote link) can fulfill them. *(Superseded same day: inquiries never auto-link/auto-fulfill against unlinked quotes.)* |
| 2026-08-05 | UTR rule set to `^[A-Z]{4}[0-9]{12,20}$` for finance queue Mark paid + partner commission payout; sales product-request lists use SSE reconnect on `product_request.*`. |
| 2026-08-05 | Sales Admin lead assign/reassign queues `sales_lead_assigned` email to the Sales Executive (from sales_admin mailbox); partner portal assign mail unchanged. |
| 2026-08-05 | Sales quote configure: catalog `storageAddOn` now surfaces as Add-On Storage (`additionalStorageEnabled` / `Count` / `Rate`; CRM/Campaign also `midPeriodAddons.storage`) — same path as `numberAddOn` / additional numbers. |
| 2026-08-05 | CCaaS sales Add-ons panel: Add-On Storage via `midPeriodAddons.storage` (seeded from contact-center `storageAddOn`), included in totals and invoice lines. |
| 2026-08-05 | UTR / bank reference briefly used `^[A-Za-z0-9]{16,22}$`; superseded same day by `^[A-Z]{4}[0-9]{12,20}$`. |
| 2026-08-03 | BA batch: partner/reseller transactional emails (commission accrued/paid, lead created/assigned, quotation submitted/approved/rejected, reseller customer paid); partner+reseller full lead edit + hard delete (scoped APIs); work-email reuse after total delete (org/location uniqueness + hard-delete cleanup); partner commissions table + slabs scroll CSS; compose Send button alignment. |
| 2026-08-03 | Partner/reseller portal SSE live refresh (payment + quotation + commission events, tenant-scoped auth); shared UTR validation for finance manual payment + commission payout; invoice preview PDF toolbar download removed (footer download kept). |
| 2026-08-03 | Initial complete `knowledge.md` created (portals, auth, schemas, action→DB, envelope, runbook). |
