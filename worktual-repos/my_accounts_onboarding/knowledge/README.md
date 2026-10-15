# My Account API knowledge

Worktual **My Account** is the purchase, onboarding, and shared-configuration hub for product spokes:

| Product | Typical reuse from My Account |
|---------|-------------------------------|
| CRM | Org, people, branches, entitlements |
| CCaaS (Contact Centre) | Queues, teams, web chat, email channels, business hours |
| Campaign | Email channel configs, org profile |
| Ticketing | Support tickets, org context |
| CDP / CVM | Entitlements, org identity |
| Lola (chat / voice bot) | Web chat widget config, knowledge documents, greeting/personalisation |

Use this folder when vibe-coding any spoke that must **call the same APIs** instead of inventing parallel contracts.

## How to use

1. Start at **[CONVENTIONS.md](./CONVENTIONS.md)** (auth, errors, base URLs).
2. Open the domain file that matches your feature (tables below).
3. Prefer the **client helper** names in `src/lib/...` — they already attach Bearer tokens via `fetchJson`.
4. After you add or change an API in this repo, **update the matching knowledge file in the same change** (see Maintainer rule).

### Locate source files quickly

Use **[locator.js](./locator.js)** to map Setup modules → UI / client / server / repo / schema paths:

```bash
node knowledge/locator.js                 # list modules
node knowledge/locator.js webchat         # Web Chat file map
node knowledge/locator.js email queues    # several modules
node knowledge/locator.js --search consent
node knowledge/locator.js --keys
```

When you add a new Setup surface, add a row to `MODULES` in `locator.js` in the same change.

Related (not duplicated here): [`docs/PROJECT_OVERVIEW.md`](../docs/PROJECT_OVERVIEW.md), [`docs/DATABASE_SCHEMA_KT.md`](../docs/DATABASE_SCHEMA_KT.md).

## Auth at a glance

| Audience | Header | Wrapper on server |
|----------|--------|-------------------|
| Customer portal / setup | `Authorization: Bearer <customerToken>` | `withCustomerAuth` |
| Internal staff (sales) | `Authorization: Bearer <staffToken>` | `requireAuth` |
| Admin | staff token + admin role | `requireAdminAuth` |
| Finance | staff token + finance role | `requireFinanceAuth` |
| Mail workspace | mail session token | `requireMailAuth` |
| Sales oversight | oversight role | `requireSalesOversightAuth` |

## Index by audience

### Customer (product spokes)

| File | Namespace | Why |
|------|-----------|-----|
| [customer/auth-and-session.md](./customer/auth-and-session.md) | `/api/v1/customer/login`, `/api/v1/me/*` | Login, session, password |
| [customer/entitlements.md](./customer/entitlements.md) | `/api/v1/me/entitlements`, usage | Which products are purchased |
| [customer/support-and-requests.md](./customer/support-and-requests.md) | support, product-requests, cancellations | Portal support & commercial requests |

### Setup workspace (highest reuse for CCaaS / Campaign / Lola)

| File | Namespace | Why |
|------|-----------|-----|
| [setup/README.md](./setup/README.md) | `/api/v1/me/setup/*` | Overview + product gates |
| [setup/organization.md](./setup/organization.md) | profile, branches, hours, teams, roles, users | Shared org model |
| [setup/channels-email.md](./setup/channels-email.md) | `/channels/email` | Email channel for CCaaS + Campaign |
| [setup/channels-webchat.md](./setup/channels-webchat.md) | `/channels/web-chat` | Web chat widget + assets |
| [setup/queues.md](./setup/queues.md) | `/ccaas/queues` | CCaaS queue ↔ team ↔ agents |
| [setup/knowledge-documents.md](./setup/knowledge-documents.md) | `/knowledge-documents` | Bot/KB document uploads |

### Internal (sales / admin / mail)

| File | Namespace | Why |
|------|-----------|-----|
| [internal/auth-admin.md](./internal/auth-admin.md) | `/api/auth/*`, `/api/admin/*` | Staff auth & user admin |
| [internal/leads-quotations-payments.md](./internal/leads-quotations-payments.md) | leads, quotes, payments, orgs | Sales → paid customer path |
| [internal/mail.md](./internal/mail.md) | `/api/mail/*` | Internal mailbox (not customer channel email) |
| [internal/sales-oversight.md](./internal/sales-oversight.md) | `/api/sales-oversight/*` | Sales admin dashboards |
| [internal/support-tickets.md](./internal/support-tickets.md) | `/api/support/tickets/*` | Staff-side support desk |

### Ops

| File | Namespace | Why |
|------|-----------|-----|
| [ops/health-events-webhooks.md](./ops/health-events-webhooks.md) | health, SSE, payment/mail webhooks | Runtime & integrations |

## Source of truth in code

| Layer | Path |
|-------|------|
| Route registry | [`server/index.js`](../server/index.js) |
| Domain services | [`server/setup*.js`](../server/), [`server/auth.js`](../server/auth.js), … |
| Repos | [`server/repositories/raw/`](../server/repositories/raw/) |
| Client HTTP | [`src/lib/http.js`](../src/lib/http.js) |
| Setup client | [`src/lib/setup/setupApi.js`](../src/lib/setup/setupApi.js) |

## Maintainer rule

**When you add, change, or remove an HTTP API in My Account, update the matching file under `knowledge/` in the same change.**

- New setup endpoint → edit `knowledge/setup/...`
- New customer portal endpoint → edit `knowledge/customer/...`
- New internal sales/admin/mail endpoint → edit `knowledge/internal/...`
- If unsure which file, add a row to this README index and create the file using the template in CONVENTIONS.md.
