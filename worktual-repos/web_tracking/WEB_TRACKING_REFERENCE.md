# Web Tracking — Data & Login Reference

**Audience:** Teams integrating **AI Native Web Tracking** (`web-tracking`) with My Accounts — analytics SDK, onboarding, reporting, or external services that need **organization id**, **customer login context**, and **website id / URL**.

**Product id (catalog):** `web-tracking`  
**Portal label:** Web Tracking  
**Scope:** Organization / HQ only (not per-branch SKUs in the current catalog).

**Related docs:** [`knowledge.md`](../knowledge.md) (master KT), [`tables.md`](../tables.md) (column catalog), [`ONBOARDING_TEAM_DATA_CONTRACT.md`](./ONBOARDING_TEAM_DATA_CONTRACT.md) (post-OTC setup for all products).

---

## 1. End-to-end flow (login → org → websites → snippet)

```text
Customer pays / UAT / go-live
        │
        ▼
organizations (tenant root)
        │
        ├─ customer_users + customer_auth_sessions  ← portal login
        │
        ├─ product_go_live + active_products.config   ← pre-live website URLs + ids
        │       (or subscriptions.entitlement_config when live)
        │
        └─ Channel Setup → Website tracking page
                WebtualAnalytics.init({
                  organizationId,
                  websiteId,      ← key in visitorAllowanceBySlot (≥ 1000)
                  websiteUrl,
                })
```

---

## 2. Customer login (portal credentials)

Web Tracking setup and install snippets use the **customer portal** — not Setup People (`setup_users`).

| Need | Table | Schema | Key columns |
|------|--------|--------|-------------|
| Login email | `customer_users` | `accounts` | `email`, `password_hash`, `is_active` |
| Password | `customer_users` | `accounts` | `password_hash` (bcrypt) |
| Session after login | `customer_auth_sessions` | `accounts` | `token`, `customer_user_id`, `organization_id`, `expires_at` |
| **Organization id** (tenancy key) | `customer_users` | `accounts` | **`organization_id`** → `organizations.id` |
| Branch scope (portal) | `customer_users` | `accounts` | `branch_id` → `organization_locations.id` |
| Org profile | `organizations` | `accounts` | `id`, `tenant_id`, `company_name`, `source_lead_id`, … |
| HQ / branch row | `organization_locations` | `accounts` | `organization_id`, `id`, `is_primary`, `label` |

**Login API:** `POST /api/v1/customer/login`  
**Session check:** Bearer token or cookie `customer_session` / `customerSession`  
**Authenticated setup APIs:** `Authorization: Bearer <token>` → resolves `customer_users` + `organization_id`.

**Response includes:** `organizationId` (same as `organizations.id`, BIGINT from 1000).

**Not portal login:** `setup_users` / `setup_user_product_access` — internal Setup Workspace people (Admin/Agent roles for Web Tracking). Use these for in-app permissions, not for signing into My Accounts.

---

## 3. Organization id

| Field | Source | Notes |
|-------|--------|--------|
| **`organization_id`** | `organizations.id` | Primary tenancy key for APIs, file paths, install snippet |
| Human code | `organizations.tenant_id` | Display only — **do not** use as `organizationId` in the tracking SDK |
| Link to sale | `organizations.source_lead_id` | Original `leads.id` |

After customer login, read **`customer_users.organization_id`** or session payload **`organizationId`**.

---

## 4. Is Web Tracking entitled for this org?

Product id is always **`web-tracking`**.

| Lifecycle | Table(s) | Config column |
|-----------|----------|---------------|
| **Pre-live** (implementation / UAT / awaiting go-live payment) | `product_go_live` + **`active_products`** | `active_products.config` (JSONB) |
| **Live subscription** | **`subscriptions`** | `subscriptions.entitlement_config` (JSONB) |
| **Open quote (sales)** | `product_assignments` + `quotations` | `product_assignments.config` (JSONB) |

**Pre-live gate:** `product_go_live.lifecycle_status` in  
`awaiting_implementation` | `uat` | `uat_expired` | `awaiting_subscription_payment`  
and `product_go_live.product_id = 'web-tracking'`.

**Live gate:** `subscriptions.product_id = 'web-tracking'`, `status = active`, within unpaid grace / renew window.

**People roles (optional):** when entitled, My Accounts seeds **Admin** + **Agent** on `setup_roles` (`product_id = 'web-tracking'`) and assigns via `setup_user_product_access`.

---

## 5. Website config JSON (no separate websites table)

Website count, URLs, and **website ids** live inside product **config JSON** — not a dedicated `websites` table.

### 5.1 Where to read/write by stage

| Stage | Table | Column |
|-------|--------|--------|
| Customer Setup (edit URLs before go-live) | `active_products` | `config` |
| Live entitlements | `subscriptions` | `entitlement_config` |
| Sales quote | `product_assignments` | `config` |

Filter rows with **`product_id = 'web-tracking'`** for the org’s lead/branch as applicable.

### 5.2 JSON shape

```json
{
  "websiteCount": "2",
  "includedVisitorsPerWebsite": "15000",
  "includedStorageGb": "10",
  "visitorAllowanceBySlot": {
    "1000": {
      "slotIndex": 1,
      "label": "Main site",
      "url": "https://example.com",
      "monthlyTrackedVisitors": "15000"
    },
    "1001": {
      "slotIndex": 2,
      "label": "Shop",
      "url": "https://shop.example.com",
      "monthlyTrackedVisitors": "15000"
    }
  }
}
```

| JSON path | Meaning |
|-----------|---------|
| `websiteCount` | Number of website slots on the plan |
| `visitorAllowanceBySlot[<website_id>]` | One website |
| **Key `<website_id>`** | **Platform-wide BIGINT ≥ 1000** — this is the SDK **`websiteId`** |
| `slotIndex` | Display order (1, 2, 3, …) — **not** the SDK id |
| `label` | Editable name (“Website 1”, “Main site”, …) |
| `url` | Must be `https://…`; globally unique across active Web Tracking configs |
| `monthlyTrackedVisitors` | Visitor allowance for that slot |

**Pending keys (before first URL save):** `__pending_1`, `__pending_2`, … — replaced by permanent ids when a URL is saved.

**Legacy keys (migrated):** `"1"`, `"2"`, … — backfilled to BIGINT ids ≥ 1000.

### 5.3 Website id sequence

| Object | Details |
|--------|---------|
| Sequence | `accounts.web_tracking_website_id_seq` |
| Starts at | `1000` |
| Issued when | First time a slot’s **URL is saved** (Sales quote, Customer Setup, or migration) |

Ids are **globally unique** across all tenants (not prefixed with `organization_id`).

---

## 6. Install snippet (Worktual Analytics)

**UI:** Customer → Setup → Channel Setup → **Website tracking**  
Route: `/customer/setup/communication/website`

**SDK (default):**  
`https://nlp-storage.worktual.co.uk/wsnlp/Web_Tracking/JavaScript_sdk/sdk/v1/web_tracking_v3.js`  
Override in frontend: `VITE_WEB_TRACKING_SDK_URL`

**Example (one website):**

```html
<!-- Worktual Analytics -->
<script src="https://nlp-storage.worktual.co.uk/wsnlp/Web_Tracking/JavaScript_sdk/sdk/v1/web_tracking_v3.js"></script>
<script>
WebtualAnalytics.init({
  websiteId: 1000,
  websiteUrl: 'https://example.com',
  organizationId: 1000,
});
</script>
```

| Init field | Source |
|------------|--------|
| `organizationId` | `customer_users.organization_id` / `organizations.id` |
| `websiteId` | Key in `visitorAllowanceBySlot` (permanent id ≥ 1000) |
| `websiteUrl` | `visitorAllowanceBySlot[websiteId].url` |

**Requirement:** Slot must have a **saved `https://` URL** and a **permanent website id** before the install page shows a snippet. Otherwise customer is directed to **Web Tracking websites** (`/customer/setup/web-tracking`) to save URLs first.

---

## 7. APIs (customer-authenticated unless noted)

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/v1/customer/login` | Portal login → `organizationId` + token |
| GET | `/api/v1/me/setup/web-tracking/websites` | List slots + `organizationId` (pre-live or live config) |
| PUT | `/api/v1/me/setup/web-tracking/websites` | Save labels/URLs (pre-live only; writes `active_products.config`) |
| POST | `/api/v1/me/setup/web-tracking/website-id/allocate` | Allocate next website id from sequence |
| GET | `/api/v1/me/setup/web-tracking/website-urls/check?url=` | URL uniqueness check |
| POST | `/api/leads/web-tracking/website-ids/allocate` | Sales: allocate website id |
| GET/POST | `/api/leads/web-tracking/website-urls/check*` | Sales: URL validation |

---

## 8. Quick lookup — “I need X, use table Y”

| I need… | Refer to… |
|---------|-----------|
| Portal login email / password | `accounts.customer_users` |
| Session token | `accounts.customer_auth_sessions` |
| **Organization id** | `customer_users.organization_id` → **`organizations.id`** |
| Company name, tenant code | `accounts.organizations` |
| Is Web Tracking purchased / in setup? | `product_go_live`, `subscriptions`, `active_products` |
| Website URLs (pre go-live) | `active_products.config` → `visitorAllowanceBySlot` |
| Website URLs (live) | `subscriptions.entitlement_config` → `visitorAllowanceBySlot` |
| **Website id** for SDK | JSON key in `visitorAllowanceBySlot` (≥ 1000) |
| Quote-stage URLs | `product_assignments.config` |
| Setup People / Web Tracking roles | `setup_users`, `setup_roles`, `setup_user_product_access` |

---

## 9. Example SQL (read-only)

**Organization id for a portal user:**

```sql
SELECT u.id, u.email, u.organization_id, o.company_name
FROM accounts.customer_users u
JOIN accounts.organizations o ON o.id = u.organization_id
WHERE lower(u.email) = lower('customer@example.com');
```

**Web Tracking websites for an org (pre-live):**

```sql
SELECT ap.config
FROM accounts.active_products ap
JOIN accounts.product_go_live pgl
  ON pgl.lead_id = ap.lead_id
 AND pgl.product_id = ap.product_id
 AND pgl.branch_id = ap.branch_id
WHERE pgl.organization_id = :org_id
  AND ap.product_id = 'web-tracking';
```

**Web Tracking websites for an org (live):**

```sql
SELECT entitlement_config AS config
FROM accounts.subscriptions
WHERE organization_id = :org_id
  AND product_id = 'web-tracking'
  AND status <> 'cancelled';
```

Parse `config->'visitorAllowanceBySlot'` in application code (or use JSON operators) for each website’s `url`, `label`, and key (= `websiteId`).

---

## 10. Portal pages (customer)

| Page | Route | Purpose |
|------|-------|---------|
| Web Tracking websites | `/customer/setup/web-tracking` | Edit website names + URLs (pre go-live) |
| Website install snippet | `/customer/setup/communication/website` | Copy `WebtualAnalytics.init` per website |
| Channel Setup directory | `/customer/setup/communication` | Entry when `web-tracking` entitled |

---

## 11. Changelog (this doc)

| Date | Change |
|------|--------|
| 2026-08-28 | Initial reference: login tables, org id, config JSON, website id sequence, install snippet, APIs, SQL examples. |
| 2026-08-28 | Section 12: Analytics dashboard login via `accounts.setup_users` + `setup_user_product_access` (read-only). |

---

## 12. Analytics dashboard login (QA — read-only Postgres)

**Database:** `worktual_bigint` · schema **`accounts`** (no `public.admin_accounts`).

The **analytics API** (`api-node` `/api/auth/login`) authenticates **Setup People** (`setup_users`), not the customer portal (`customer_users`). All access is **SELECT only**.

| Step | Table | Key columns |
|------|--------|-------------|
| User identity | `accounts.setup_users` | `id`, `organization_id`, **`work_email`**, `password_hash`, `status`, `invite_status`, `password_set_at` |
| Web Tracking access | `accounts.setup_user_product_access` | `user_id`, `product_id` (`'web-tracking'`), `role_id` |
| Role (Admin / Agent) | `accounts.setup_roles` | `id`, `organization_id`, `product_id`, `name`, `permissions` |
| Organization / tenant | `accounts.organizations` | `id` (= `setup_users.organization_id`) |
| Invite / set password | `accounts.setup_user_invite_tokens` | `user_id`, `token_hash`, `expires_at`, `used_at` (not used at login; password must be set) |
| Website list | `active_products.config` / `subscriptions.entitlement_config` | `visitorAllowanceBySlot` JSON |
| Default `websiteId` / `websiteUrl` | JSON slot key + `url` | First slot with non-empty HTTPS URL |

**Login eligibility:** `password_hash` and `password_set_at` set; `status` active; `invite_status` not pending/expired; **`setup_user_product_access`** row for `product_id = 'web-tracking'`.

**Example SQL (read-only check for an email):**

```sql
SELECT u.id, u.work_email, u.organization_id, u.status, u.invite_status, u.password_set_at,
       r.name AS web_tracking_role
FROM accounts.setup_users u
LEFT JOIN accounts.setup_user_product_access pa
  ON pa.user_id = u.id AND pa.product_id = 'web-tracking'
LEFT JOIN accounts.setup_roles r ON r.id = pa.role_id
WHERE lower(u.work_email) = lower('user@company.com');
```

**`.env` (analytics QA):**

```env
DB_NAME=worktual_bigint
DB_SCHEMA=accounts
AUTH_SOURCE=my_accounts
POSTGRES_READ_ONLY=true
DATABASE_URL=postgresql://USER:PASS@10.180.0.126:5432/worktual_bigint?schema=accounts
```

**DB team grants for app user (`nlp`) — SELECT only:**

```sql
GRANT USAGE ON SCHEMA accounts TO nlp;
GRANT SELECT ON accounts.setup_users TO nlp;
GRANT SELECT ON accounts.setup_user_product_access TO nlp;
GRANT SELECT ON accounts.setup_roles TO nlp;
GRANT SELECT ON accounts.organizations TO nlp;
GRANT SELECT ON accounts.active_products TO nlp;
GRANT SELECT ON accounts.product_go_live TO nlp;
GRANT SELECT ON accounts.subscriptions TO nlp;
```

**Legacy mode:** `AUTH_SOURCE=legacy_admin` uses `public.admin_accounts` (old QA DB only).

**Ingest validation** uses the same My Accounts JSON as login: `accounts.subscriptions` / `accounts.active_products` → `visitorAllowanceBySlot` (read-only via `nlp` user). ClickHouse `dict_admin_accounts` is legacy and no longer required for ingest.
