# Onboarding / Implementation Team — Data Contract

**Audience:** External team that builds **customer portal onboarding / product setup** after a lead pays the **implementation (OTC) fee**.

**Problem this doc solves:** After payment, My Accounts moves products to `awaiting_implementation`. Your team must know **which tables to read**, **where product configuration and counts live**, and **why `product_assignments.config` looks different per product**.

**Related lifecycle doc:** [`IMPLEMENTATION_TO_LIVE_FLOW.md`](./IMPLEMENTATION_TO_LIVE_FLOW.md) (full OTC → UAT → go-live → live path and DB writes).

---

## 1. What happens after the customer pays implementation

```text
Customer pays OTC invoice (billing_phase = implementation)
        │
        ▼
My Accounts creates / activates:
  • organization + locations
  • customer portal user (welcome email)     ← My Accounts login
  • active_products (payment confirmed)
  • product_go_live = awaiting_implementation
        │
        ▼
YOUR TEAM: implement the purchased product(s)
  using identity + config from the tables below
        │
        ▼
Sales (My Accounts) sends UAT credentials
  product_go_live → uat
        │
        ▼
Customer Accept / Go live → subscription invoice → live
```

### Important boundaries

| System | Who owns it | What it stores |
|--------|-------------|----------------|
| **My Accounts** | This repo | Commercial quote, OTC payment, org/portal login, go-live status, **purchased config snapshot** |
| **Product apps** (CRM, CCaaS, …) | Your / product teams | Actual tenant setup, UAT environment, end-user logins |

- Config in My Accounts is the **sold configuration** (plans, seats, channels, fees). It does **not** auto-sync from changes made inside the product UAT UI.
- **Subscriptions do not exist yet** at `awaiting_implementation`. Do not join `subscriptions` for “what they bought” at this stage.
- My Accounts portal login ≠ product UAT login (separate credentials later).

---

## 2. Which tables to use (post–OTC paid)

### 2.1 Start here — implementation queue

| Table | Why you need it |
|-------|-----------------|
| **`product_go_live`** | **Primary work queue.** One row per purchased product × branch. Filter `lifecycle_status = 'awaiting_implementation'`. Links to org, lead, OTC quotation. **Does not store product config.** |

Key columns:

| Column | Meaning |
|--------|---------|
| `id` | Go-live row id (UAT APIs use this later) |
| `organization_id` | Customer org |
| `lead_id` | Source lead |
| `product_id` | Catalog id: `crm`, `contact-center`, `campaign`, `cdp`, `ticketing`, `value-management` |
| `branch_id` | Location scope (`hq` or branch uuid/id) |
| `billing_branch_id` | Who was billed |
| `lifecycle_status` | `awaiting_implementation` → `uat` → … → `live` |
| `otc_quotation_id` | **Join key** to the paid OTC quote + assignments |
| `uat_credentials` | Filled only after sales sends UAT (not at pay time) |
| `subscription_id` | NULL until go-live paid |

There is **no** product id `crm-hq`. HQ CRM is `product_id = 'crm'` and `branch_id = 'hq'`.

---

### 2.2 Product configuration (what they purchased)

| Table | Role | When to prefer |
|-------|------|----------------|
| **`active_products`** | Paid entitlement snapshot; **`config` JSONB** | **Preferred after OTC paid** (`payment_confirmed_at` set) |
| **`product_assignments`** | Quote line config; **`config` JSONB** | Source of truth on the OTC quotation; use via `otc_quotation_id` |

Join pattern:

```text
product_go_live.otc_quotation_id  →  product_assignments (quotation_id + product_id + branch_id)
product_go_live.lead_id           →  active_products (lead_id + product_id + branch_id)
```

`active_products.config` and the matching OTC `product_assignments.config` should match for that purchase. Prefer **`active_products`** once `payment_confirmed_at` is set.

Also useful:

| Column / table | Meaning |
|----------------|---------|
| `active_products.implementation_purchased` | Implementation was part of the deal |
| `active_products.quotation_id` | OTC quotation id |
| `quotations.billing_phase` | Expect `implementation` for this path |
| `quotations.status` | Expect `Paid` |
| `payments` | `paid_at`, amounts, welcome-email status |

---

### 2.3 Customer / company / branch identity

| Table | Use for |
|-------|---------|
| **`organizations`** | Company name, admin/work email, country, billing address, **org tax number**, lifecycle |
| **`organization_locations`** | Branch label, address, country, **branch tax number**, contacts (`id` = `branch_id`) |
| **`leads`** | Sales capture fields still useful; `organization_id` / `source_lead_id` link |
| **`branches`** | Lead-scoped branch master (same ids as locations after convert) |
| **`customer_users`** | My Accounts portal logins (`email`, `branch_id`, `role`) — **not** product UAT users. **Portal branch visibility:** head office = `branch_id` matches `organization_locations.is_primary`; that user may see all locations. Non-head portal users see **only their own** location (entitlements `/api/v1/me/entitlements` scopes `organization.locations`; products stay grant-scoped). |
| **`additional_addresses`** | Extra lead addresses (optional) |

Tax / GST for invoicing also appears on the quotation (`gst_rate`, `lead_snapshot`). Config usually has `taxLabel` / `region` / `currency`, not a full GST object.

---

### 2.4 Tables you usually should **ignore** at this stage

| Table | Why |
|-------|-----|
| `subscriptions` | Created only after go-live (or non-OTC standard purchase) |
| `subscription_items` / `subscription_entitlements` | Same |
| `subscription_invoices` | Recurring schedule after live |
| `purchase_orders` | After go-live |
| `usage_metrics*` | Seeded with subscription |
| `product_access_grants` | Needs `subscription_id`; usually empty at OTC |

---

### 2.5 Supporting tables (optional)

| Table | Use |
|-------|-----|
| `quotation_invoices` | OTC PDF artifacts |
| `quotation_product_summary` / summary items | Human-readable quote lines |
| `quotation_branch_payments` | Multi-branch payment split |
| `email_outbox` | Welcome / notify jobs (ops) |

---

### 2.6 Recommended query — “what do I implement?”

```sql
SELECT
  pgl.id                 AS go_live_id,
  pgl.lifecycle_status,
  pgl.product_id,
  pgl.branch_id,
  pgl.billing_branch_id,
  pgl.otc_quotation_id,
  o.id                   AS organization_id,
  o.company_name,
  o.admin_email,
  o.work_email,
  o.country,
  o.tax_number           AS org_tax_number,
  o.billing_address,
  ol.label               AS branch_label,
  ol.address             AS branch_address,
  ol.tax_number          AS branch_tax_number,
  q.currency,
  q.gst_rate,
  q.grand_total          AS otc_amount_paid,
  pay.paid_at,
  ap.config              AS product_config,   -- preferred
  pa.config              AS assignment_config, -- fallback
  ap.implementation_purchased,
  ap.payment_confirmed_at,
  cu.email               AS my_accounts_portal_email,
  cu.branch_id           AS portal_user_branch
FROM product_go_live pgl
JOIN organizations o
  ON o.id = pgl.organization_id
LEFT JOIN organization_locations ol
  ON ol.organization_id = pgl.organization_id
 AND ol.id = pgl.branch_id
JOIN quotations q
  ON q.id = pgl.otc_quotation_id
LEFT JOIN payments pay
  ON pay.quotation_id = q.id
LEFT JOIN active_products ap
  ON ap.lead_id = pgl.lead_id
 AND ap.product_id = pgl.product_id
 AND ap.branch_id = pgl.branch_id
LEFT JOIN product_assignments pa
  ON pa.quotation_id = pgl.otc_quotation_id
 AND pa.product_id = pgl.product_id
 AND pa.branch_id = pgl.branch_id
LEFT JOIN customer_users cu
  ON cu.organization_id = pgl.organization_id
 AND (cu.branch_id = pgl.branch_id OR cu.branch_id = 'hq')
WHERE pgl.lifecycle_status = 'awaiting_implementation'
  -- AND pgl.organization_id = :org_id
  -- AND pgl.lead_id = :lead_id
;
```

**Algorithm for your services:**

1. Poll / subscribe on `product_go_live` where `lifecycle_status = 'awaiting_implementation'`.
2. Load org + location for customer context.
3. Load `COALESCE(active_products.config, product_assignments.config)`.
4. Branch parsers on `config.pricingMode` (or `product_id`) — see §3.
5. When My Accounts moves status to `uat` / `live`, stop treating the row as “needs implementation.”

---

## 3. `config` JSON — why it differs per product

### 3.1 How to identify the product

| `product_id` (column) | `config.pricingMode` | Display name |
|-----------------------|----------------------|--------------|
| `contact-center` | `ccaas` | Contact Center / AICCAAS |
| `crm` | `crm` | AI Native CRM |
| `campaign` | `campaign` | Campaign Management |
| `cdp` | `cdp` | CDP |
| `ticketing` | `ticketing` | Ticketing |
| `value-management` | `value-management` | Value Management |

**Always branch on `pricingMode` (or `product_id`).** Do not assume one flat schema.

Canonical builders: `backend/src/lib/pricingRuntime.ts`  
Billing interpretation: `backend/src/lib/invoice.ts` (`getProductInvoice`)

---

### 3.2 Fields common across products

These usually exist (names may be empty strings):

| Field | Meaning |
|-------|---------|
| `productId` | Same as catalog id |
| `pricingMode` | Parser discriminator |
| `region` | e.g. `India` |
| `currency` | e.g. `INR` |
| `taxLabel` | e.g. `GST` |
| `billingCycle` | e.g. `monthly` |
| `implementationEnabled` | Whether OTC was sold |
| `implementationDiscountType` / `implementationDiscountValue` | OTC discount |
| `discountType` / `discountValue` | Core monthly discount |
| `addonDiscountType` / `addonDiscountValue` | Add-on discount |

**Implementation fee field name is NOT consistent:**

| Product | Field |
|---------|--------|
| **CRM** | `implementationCost` |
| **All others** | `implementationFee` |

Helper for readers:

```text
otcFee = config.implementationCost ?? config.implementationFee ?? config.setupFee
```

**Monthly / line totals** are normally **computed** by My Accounts invoice helpers (`finalMonthly`, `setupSubtotal`, etc.), not stored as a single trusted field on every config. Prefer reading **counts + rates** and recomputing if you need money; for provisioning, prefer **counts and feature flags**.

---

### 3.3 Contact Center (`pricingMode: ccaas`)

Nested structure: **modules** + **usageDetails** + **addons**.

| Need | Where |
|------|--------|
| License tier | `licenseTier` |
| Seat / channel modules | `modules.<id> = { optionId, price, pricingPlanId }` |
| Agent & channel counts | `usageDetails.agentCount`, `smsCount`, `emailCount`, voice/WA/social counts + matching `*Rate` / `*Total` |
| Packaged add-ons | `addons.sessionBundle`, `sessionCount`, `sessionPrice`, `multilingualOption`, `multilingualPrice` |
| OTC fee | `implementationFee` |

```json
{
  "productId": "contact-center",
  "pricingMode": "ccaas",
  "licenseTier": "growth",
  "region": "India",
  "currency": "INR",
  "taxLabel": "GST",
  "billingCycle": "monthly",
  "modules": {
    "voice": { "optionId": "human-agent", "price": "9000", "pricingPlanId": "growth" },
    "digitalChannels": { "optionId": "email-sms", "price": "0", "pricingPlanId": "growth" }
  },
  "usageDetails": {
    "agentCount": "5",
    "agentRate": "9000",
    "smsCount": "1000",
    "smsRate": "0.20",
    "emailCount": "5000",
    "emailRate": "0.05"
  },
  "addons": {
    "sessionBundle": "none",
    "sessionPrice": "0",
    "multilingualOption": "none",
    "multilingualPrice": "0"
  },
  "implementationEnabled": true,
  "implementationFee": "560000",
  "implementationDiscountType": "percentage",
  "implementationDiscountValue": "",
  "discountType": "percentage",
  "discountValue": "",
  "addonDiscountType": "percentage",
  "addonDiscountValue": ""
}
```

**Provisioning tip:** Use `usageDetails` for quantities; use `modules` for which capabilities/tier options were sold. Agent rate may be customized in config even when billed “in base.”

---

### 3.4 CRM (`pricingMode: crm`)

Flat flags + counts. **No nested `addons` object.**

| Need | Where |
|------|--------|
| Base users | `usersEnabled`, `userCount`, `userLicenseRate` |
| Contacts included | `includedContacts` |
| Numbers | `numberCount`, `numberRate` |
| Add-ons | `additionalUsersEnabled` + `additionalUserCount` / rates; `additionalNumbersEnabled` + counts; `additionalContactsEnabled` + `additionalContactSlab` |
| OTC fee | **`implementationCost`** |

```json
{
  "productId": "crm",
  "pricingMode": "crm",
  "usersEnabled": true,
  "implementationEnabled": true,
  "billingCycle": "monthly",
  "region": "India",
  "currency": "INR",
  "userCount": "25",
  "userLicenseRate": "2000",
  "includedContacts": "50000",
  "numberCount": "2",
  "numberRate": "500",
  "additionalUsersEnabled": false,
  "additionalUserCount": "",
  "additionalNumbersEnabled": false,
  "additionalContactsEnabled": false,
  "implementationCost": "500000",
  "implementationDiscountType": "percentage",
  "implementationDiscountValue": "",
  "discountType": "percentage",
  "discountValue": ""
}
```

---

### 3.5 Campaign (`pricingMode: campaign`)

| Need | Where |
|------|--------|
| Base plan on/off | `basePlanEnabled`, `monthlyBasePrice`, `includedContacts` |
| Numbers | `numberCount`, `numberRate` |
| Channels | `channelsEnabled`; `emailCount`/`emailRate`, `smsCount`/`smsRate`, `whatsappCredits`/`whatsappRate`, `webPushSubscribers`/`webPushRate`, `appPushSubscribers`/`appPushRate` |
| Add-ons | `additionalNumbersEnabled`, `additionalContactsEnabled` + slabs/counts |
| OTC fee | `implementationFee` |

```json
{
  "productId": "campaign",
  "pricingMode": "campaign",
  "basePlanEnabled": true,
  "channelsEnabled": true,
  "implementationEnabled": true,
  "monthlyBasePrice": "25000",
  "includedContacts": "50000",
  "numberCount": "1",
  "numberRate": "500",
  "emailCount": "100000",
  "emailRate": "0.10",
  "smsCount": "50000",
  "smsRate": "0.25",
  "whatsappCredits": "10000",
  "whatsappRate": "0.50",
  "additionalNumbersEnabled": false,
  "additionalContactsEnabled": false,
  "implementationFee": "200000"
}
```

---

### 3.6 CDP (`pricingMode: cdp`)

| Need | Where |
|------|--------|
| Platform | `platformEnabled`, `monthlyBasePrice` |
| Profiles | `customerProfiles` |
| Add-on | `additionalContactsEnabled`, `additionalContactSlab` |
| OTC fee | `implementationFee` |

```json
{
  "productId": "cdp",
  "pricingMode": "cdp",
  "platformEnabled": true,
  "implementationEnabled": true,
  "monthlyBasePrice": "40000",
  "customerProfiles": "100000",
  "additionalContactsEnabled": false,
  "additionalContactSlab": "",
  "implementationFee": "300000"
}
```

---

### 3.7 Ticketing (`pricingMode: ticketing`)

| Need | Where |
|------|--------|
| Users | `usersEnabled`, `userCount`, `userLicenseRate` |
| Tickets | `includedTickets`, `includedTicketRate` |
| Add-ons | `additionalUsersEnabled` + counts; `additionalTicketsEnabled` + `additionalTicketSlab` |
| OTC fee | `implementationFee` |

```json
{
  "productId": "ticketing",
  "pricingMode": "ticketing",
  "usersEnabled": true,
  "implementationEnabled": true,
  "userCount": "15",
  "userLicenseRate": "1500",
  "includedTickets": "2000",
  "includedTicketRate": "0",
  "additionalUsersEnabled": false,
  "additionalTicketsEnabled": false,
  "implementationFee": "150000"
}
```

---

### 3.8 Value Management (`pricingMode: value-management`)

| Need | Where |
|------|--------|
| Subscription | `subscriptionEnabled`, `monthlyBasePrice` |
| MAU | `monthlyActiveUsers` |
| Add-on | `additionalContactsEnabled` (+ slab if present) |
| OTC fee | `implementationFee` |

```json
{
  "productId": "value-management",
  "pricingMode": "value-management",
  "subscriptionEnabled": true,
  "implementationEnabled": true,
  "monthlyBasePrice": "35000",
  "monthlyActiveUsers": "100000",
  "additionalContactsEnabled": false,
  "implementationFee": "250000"
}
```

---

## 4. Add-ons — how to read them

There is **no single `addons[]` array** across all products.

| Product | Add-on pattern |
|---------|----------------|
| **CCaaS** | Nested object `config.addons` (+ some usage lines) |
| **CRM / Campaign / CDP / Ticketing / VM** | Boolean `*Enabled` flags + parallel count/rate/slab fields |

Always:

1. Check the feature flag (`additionalUsersEnabled`, etc.) or CCaaS `addons.*` option ≠ `none`.
2. Read the matching count/slab/rate fields.
3. Apply `addonDiscountType` / `addonDiscountValue` only if you need **commercial** net amounts (usually not required for provisioning entitlements).

---

## 5. Consistency: should we normalize, or KT the current format?

### Current structure is intentional

My Accounts models each product’s **sales worksheet** differently on purpose:

- Six factories in `pricingRuntime.ts` (`create*InitialConfigFromCatalog`)
- Invoice engine hard-branches on `pricingMode` in `invoice.ts`
- UI / finance summarizers also branch on `pricingMode`

Forcing one global JSON schema would require a large adapter rewrite across sales workflow, invoices, finance review, and go-live — **not required for your team to ship onboarding**.

### Recommendation for your team

| Approach | Recommendation |
|----------|----------------|
| **Normalize My Accounts DB to one schema now** | **No** — keep current per-product shape |
| **Your integration layer** | **Yes** — build a thin **adapter per `pricingMode`** that maps into *your* onboarding DTO |
| **Stable contract** | Join path in §2 + discriminator `pricingMode` + common fields in §3.2 |
| **KT** | Use this document + walk one real paid OTC row per product in staging |

### Suggested adapter shape (yours, not stored in My Accounts)

```ts
type PurchasedProductEntitlement = {
  goLiveId: string;
  organizationId: string;
  leadId: string;
  productId: string;
  pricingMode: string;
  branchId: string;
  customer: { companyName; adminEmail; country; taxNumber; ... };
  location: { label; address; taxNumber; ... };
  implementation: { enabled: boolean; feeRaw: string };
  entitlements: {
    // normalized by YOUR team, e.g.:
    seats?: number;
    users?: number;
    channels?: Record<string, number>;
    modules?: string[];
    rawConfig: object; // always keep original JSON
  };
};
```

Map each `pricingMode` → `entitlements` in your service. Keep `rawConfig` for debugging.

---

## 6. Lifecycle statuses your team may see

| `product_go_live.lifecycle_status` | Meaning for you |
|------------------------------------|-----------------|
| `awaiting_implementation` | **Your queue** — implement using config |
| `uat` | Sales sent product UAT credentials; customer testing |
| `uat_expired` | UAT window ended; may need extend / rework |
| `awaiting_subscription_payment` | Customer accepted; waiting go-live invoice pay |
| `live` | Subscription exists; commercial live |

Do not treat `active_products` presence alone as “product is live.” **Live** means go-live paid + `lifecycle_status = live` (and usually a `subscriptions` row).

---

## 7. Quick file map (My Accounts codebase)

| Concern | Path |
|---------|------|
| Full OTC → live DB story | `guidelines/IMPLEMENTATION_TO_LIVE_FLOW.md` |
| Config factories | `backend/src/lib/pricingRuntime.ts` |
| Invoice / fee interpretation | `backend/src/lib/invoice.ts` |
| CCaaS usage / addons helpers | `backend/src/lib/ccaasConfiguration.ts` |
| Active products helpers | `backend/src/lib/activeProducts.ts` |
| Seed go-live on OTC pay | `backend/src/modules/product-go-live/go-live-store.ts` |
| Pay fulfillment | `backend/src/modules/payments/fulfillment.ts` |
| Product catalog ids | `backend/src/lib/productCatalog.ts` |
| Human config summary (UI) | `frontend/src/lib/customerProductRequests.js` |

---

## 8. KT checklist for the other team

1. In staging, complete one OTC payment for each `product_id`.
2. Run the SQL in §2.6; confirm `lifecycle_status = awaiting_implementation`.
3. Open `active_products.config` and identify `pricingMode`.
4. Extract counts using the product section in §3 (agents/users/channels/profiles).
5. Confirm org + branch tax/address from `organizations` / `organization_locations`.
6. Confirm **no** `subscriptions` row yet.
7. After sales **Send UAT**, re-read `product_go_live.uat_credentials` (product login only).
8. Implement adapters per `pricingMode`; do not wait for a unified My Accounts schema.

---

*This document is the data contract for post–implementation-payment onboarding. Lifecycle write details remain in `IMPLEMENTATION_TO_LIVE_FLOW.md`.*
