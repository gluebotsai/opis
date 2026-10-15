# Implementation → UAT → Go-live invoice → Live customer

End-to-end lifecycle when a lead buys a product **with an implementation (OTC) fee**: what happens in the app, which APIs run, and **every database write** at each step.

> **For the external onboarding / product-setup team** (which tables to read after OTC pay, and how to parse each product’s `config` JSON): see [`ONBOARDING_TEAM_DATA_CONTRACT.md`](./ONBOARDING_TEAM_DATA_CONTRACT.md).

> **Scope:** `billing_phase = implementation` on the first quotation, then UAT, then customer Accept, then `billing_phase = go_live_proration` payment, then live subscription.
>
> Products **without** an implementation fee skip this path and create subscriptions on first paid quote (`billing_phase = standard`). That path is out of scope here.
>
> **Temporary Lead** (`lead_kind = temporary`): sales creates a finance-only invoice and submits to the finance queue. Finance **approve stops here** — status becomes Approved, **no payment link**, no customer payment email, no portal / go-live fulfillment. Temporary leads are listed only under the Temporary Lead Products scope (excluded from All/Mine). Offline mark-paid / later fulfillment for temporary is out of scope.

---

## Status cheat sheet

### `quotations.billing_phase`

| Value | Meaning |
|-------|---------|
| `implementation` | First invoice = setup / OTC only (no recurring yet) |
| `go_live_proration` | Customer accepted UAT; prorated first subscription invoice |
| `standard` | Normal quote (not this flow) |

Defined in `backend/src/modules/payments/billingPhases.ts`.

### `product_go_live.lifecycle_status`

```text
awaiting_implementation
        ↓  (sales sends UAT)
       uat  ──(optional expiry job)──► uat_expired
        ↓  (customer Accept / Go live)
awaiting_subscription_payment
        ↓  (go-live quote paid)
       live
```

### `subscriptions.status`

Only exists **after** go-live payment (or a standard paid quote). Typical value: `active` (or later `cancelled`).

---

## High-level diagram

```text
Sales creates OTC quote (implementation)
        │
        ▼
Finance approves + payment link
        │
        ▼
Customer / gateway pays OTC
        │
        ├─► organizations + locations
        ├─► customer_users + welcome email
        ├─► active_products.payment_confirmed_at
        ├─► product_go_live = awaiting_implementation
        └─► NO subscriptions yet
        │
        ▼
Sales sends UAT credentials
        │
        └─► product_go_live = uat (+ uat_credentials, expiry)
        │
        ▼
Customer Accept / Go live
        │
        ├─► new quotation billing_phase=go_live_proration
        ├─► pending payment
        └─► product_go_live = awaiting_subscription_payment
        │
        ▼
Finance approves go-live quote + payment link
        │
        ▼
Customer pays go-live invoice
        │
        ├─► purchase_orders, subscriptions, entitlements, items
        ├─► subscription_invoices (schedule)
        ├─► renewal_events, usage metrics, grants
        └─► product_go_live = live
```

---

## Phase 0 — Create OTC (implementation) quotation

### Trigger

- Sales workflow submits a quote whose assignments include an implementation fee.
- Frontend / proration sets `billingPhase: "implementation"` (`quoteNeedsImplementationPhase`).
- API: `POST /quotations` → `createQuotationsForFinance` → `createQuotation`.

### Code

- `backend/src/modules/quotations/quotation-store.ts` — `createQuotation`
- `backend/src/lib/proration.ts` — OTC amount = setup only when `implementationOnly`

### DB actions

| Table | Op | What is written |
|-------|----|-----------------|
| `quotations` | **INSERT** | `billing_phase='implementation'`, `status` pending finance, amounts (OTC), `lead_id`, snapshots, batch ids |
| `product_assignments` | **INSERT** | One row per product/branch: `product_id`, `branch_id`, `billing_branch_id`, `change_type`, **`config` JSONB** (full configuration + implementation fee) |
| `quotation_product_summary` | **INSERT** | Display lines (name, price label) |
| `quotation_invoices` | **INSERT** | PDF / branch invoice artifacts for the OTC quote |
| `leads` | **UPDATE** | First-time → `Pending Finance Review`; **existing customers** (any prior Paid quotation) stay `Paid` via `updateLeadStatusForNewQuotation` (not Partially paid yet) |

### Not yet

Org conversion, portal users, `product_go_live`, subscriptions, renewals.

---

## Phase 1 — Finance approves OTC quotation

### Trigger

- API: `POST /quotations/:id/approve` → `approveQuotation`
- Then payment link: `issueQuotationPaymentLink` / `attachPaymentToQuotation`

### DB actions

| Table | Op | What is written |
|-------|----|-----------------|
| `quotations` | **UPDATE** | `status='Approved'`, reviewer, notes, version bump |
| `active_products` | **UPSERT** | Product entitlement snapshot for the lead: `key`, `lead_id`, `product_id`, `branch_id`, `config`, `quotation_id`, `approved_at`, `implementation_purchased` — **`payment_confirmed_at` still NULL** |
| `leads` | **UPDATE** | `status='Approved'` for first-time leads; **existing customers** (any prior Paid quotation) become `Partially paid` so they remain in Customers while awaiting payment |
| `payments` | **UPSERT / INSERT** | `status='pending'`, amount, provider / payment-link fields |
| `branch_payments` | **UPSERT** | Per-branch pending rows when multi-branch |

### Side effects

- Approval / payment-link emails may enqueue via BullMQ → **`email_outbox`** (not a domain lifecycle table).

---

## Phase 2 — OTC paid (implementation paid)

### Triggers (all converge on confirm + fulfillment)

| Path | Entry |
|------|--------|
| Stripe / Razorpay webhook | `recordProviderPaymentReported` → auto-confirm |
| Finance report payment | `POST /quotations/:id/report-payment` |
| Finance confirm | `POST /quotations/:id/confirm-payment` → `confirmFinancePayment` |
| Finance mark paid | `POST /quotations/:id/mark-paid` |

Core: `backend/src/modules/payments/fulfillment.ts`.

Fulfillment is **split**:

1. Short TX — mark payment / quotation / lead paid  
2. Separate TX — product / org / portal / go-live seed (avoids lock storms)

Because `billing_phase === 'implementation'`:

```text
OTC paid: portal + welcome only; products stay awaiting UAT
(no live subscription / day-20).
```

Uses **`seedGoLiveFromOtcQuotation`**, **not** `syncSubscriptionsFromQuotation`.

---

### 2a. Mark paid (payment TX)

| Table | Op | What is written |
|-------|----|-----------------|
| `payments` | **UPDATE** | `status='paid'`, `paid_at`, finance confirm fields, provider ids; `welcome_email_status='pending'` |
| `branch_payments` | **UPDATE** | Paid per branch when applicable |
| `quotations` | **UPDATE** | `status='Paid'` |
| `leads` | **UPDATE** | `Paid` or `Partially paid` |
| `customer_product_requests` | **UPDATE** (optional) | Fulfilled if quote linked to a product request and assignments complete |

---

### 2b. Product fulfillment (after payment TX)

Ordered work in `syncQuotationProductFulfillment` for **implementation**:

1. `ensureActiveProductsForQuotation`
2. `confirmActiveProductsPayment`
3. `ensureOrganizationForPaidLead` / `convertLeadToOrganization`
4. **`seedGoLiveFromOtcQuotation`**
5. `provisionBranchPortalAccessForQuotation` → `ensureBranchCustomerUser`
6. After commit: welcome email delivery / queue; optional partner commission

| Table | Op | What is written |
|-------|----|-----------------|
| `active_products` | **UPDATE** | `payment_confirmed_at = NOW()` |
| `organizations` | **INSERT** or **UPDATE** | New org or prospect → `lifecycle_status='active'`, `converted_at` |
| `leads` | **UPDATE** | `organization_id` and conversion fields |
| `organization_locations` | **UPSERT** | Branches copied from lead |
| **`product_go_live`** | **UPSERT** | One row per OTC assignment: `lifecycle_status='awaiting_implementation'`, `otc_quotation_id`, `organization_id`, `lead_id`, `product_id`, `branch_id`, `billing_branch_id`; `subscription_id` NULL; `uat_expires_at` NULL |
| `customer_users` | **INSERT** or **UPDATE** | HQ / branch portal login: `email`, `password_hash`, `role`, `branch_id`, `organization_id`. First time: temporary password for welcome email |
| `product_access_grants` | **INSERT** (attempted) | Usually **no-op** at OTC — no subscriptions yet |
| `payments` | **UPDATE** | `welcome_email_status` (`sent` / `sent_without_credentials` / `failed`), `welcome_email_sent_at`, attempts; `internal_credentials_*` |
| `commission_entries` | **INSERT** (if partner lead) | Deal commission for paid OTC |
| `email_outbox` | **INSERT** | Queued welcome / notify jobs |

**Ops:** With `REDIS_URL` set, the API only enqueues — run `backend` **worker** (`pnpm` worker / systemd mail worker) so `quotation_approved` and `payment_received` jobs send. Approve mail enqueues by `quotationId` only; PDFs hydrate inside the worker. Stuck `welcome_email_status=pending` older than ~2 minutes is treated as retryable.

### Explicitly NOT written at OTC

| Table | Why |
|-------|-----|
| `subscriptions` | Deferred until go-live / standard pay |
| `purchase_orders` | Same |
| `subscription_items` / `subscription_entitlements` | Same |
| `subscription_invoices` | Day-20 / monthly schedule starts only with live subscription |
| `renewal_events` | Same |
| `usage_metrics*` | Seeded with subscription |
| `customer_auth_sessions` | Created on **login**, not at payment |

---

## Phase 3 — UAT

### 3a. Sales sends UAT

- UI: `/customers/:leadId/implementation-uat` (or products equivalent)
- API: `POST /api/leads/:id/go-live/:goLiveId/send-uat`
- Function: `sendUatAccess` → `updateGoLiveUat`

| Table | Op | What is written |
|-------|----|-----------------|
| `product_go_live` | **UPDATE** | `lifecycle_status='uat'`, `uat_expires_at` = now + **chosen duration** (3/5/7/14 days), `uat_credentials` JSONB (`portalUrl`, `username`, `password`, notes, `durationDays`, `sentAt`), clear `change_request_note` when entering UAT |

SSE: `payment.uat_updated` (Redis / local bus — not a DB table).

Sales UI: **Send UAT** only while `awaiting_implementation`; form hides while `uat`; **Extend UAT** only when `uat_expired`.

### 3b. Extend UAT

- API: `POST .../extend-uat` → `extendUatAccess` (body: `durationDays`, optional credentials)

| Table | Op | What is written |
|-------|----|-----------------|
| `product_go_live` | **UPDATE** | Status back to `uat`, new expiry from chosen duration, `uat_extended_count++`, credentials refreshed; customer UAT email re-queued |

### 3c. UAT expiry (job)

- Job: billing sweep → `expireDueUatAccess` → `expireDueUatRows`

| Table | Op | What is written |
|-------|----|-----------------|
| `product_go_live` | **UPDATE** | `lifecycle_status='uat_expired'` where `uat` and `uat_expires_at < now` |

### 3d. Customer requests UAT changes

- API: `POST /api/customer/go-live/:goLiveId/request-changes`

| Table | Op | What is written |
|-------|----|-----------------|
| `product_go_live` | **UPDATE** | `change_request_note` only — **status unchanged** |

### Not in this phase

No new quotations, payments, or subscriptions.

---

## Phase 4 — Customer Accept → go-live invoice

### Trigger

- Customer portal: Accept / Go live
- API: `POST /api/customer/go-live/accept`
- Function: `acceptGoLiveProducts` (`backend/src/modules/product-go-live/acceptance.ts`)

Requires go-live rows in `uat` or `uat_expired`. Builds prorated remaining-month amounts from OTC assignment configs (implementation fee forced purchased / zeroed).

### DB actions

| Table | Op | What is written |
|-------|----|-----------------|
| `quotations` | **INSERT** | **`billing_phase='go_live_proration'`**, pending finance, prorated totals |
| `product_assignments` | **INSERT** | `change_type='go_live'`, config with go-live proration flags / amounts |
| `quotation_product_summary` | **INSERT** | Go-live line items |
| `quotation_invoices` | **INSERT** | PDF / invoice artifacts for go-live quote (as created by quotation store) |
| `payments` | **INSERT** | Pending payment for go-live amount (`attachPaymentToQuotation`) |
| `leads` | **UPDATE** | Often `Partially paid` (OTC already paid) |
| **`product_go_live`** | **UPDATE** | **`lifecycle_status='awaiting_subscription_payment'`**, `accepted_at=NOW()`, `go_live_quotation_id=<new quotation id>` |

### Invoice note

This is the **customer go-live / proration quotation invoice** (stored with quotations / `quotation_invoices` + `payments`).  
It is **not** yet a `subscription_invoices` schedule row.

Still **no** `subscriptions` until this invoice is paid.

**Mail:** queues `go_live_accepted` → sales person (lead assignee) notified that the customer accepted UAT / is ready to purchase and finance has a go-live invoice pending.

---

## Phase 5 — Finance approves go-live quotation

Same approve + payment-link machinery as Phase 1, on the **go-live** quotation.

| Table | Op | What is written |
|-------|----|-----------------|
| `quotations` | **UPDATE** | Approved |
| `active_products` | **UPSERT** | Snapshot for go-live quote (may refresh config / quotation pointer) |
| `payments` | **UPDATE / UPSERT** | Payment link / provider fields; still pending until customer pays |

Finance UI treats this as “Go-live — awaiting payment”.

---

## Phase 6 — Go-live paid → live customer / subscription

### Trigger

Same confirm paths as Phase 2, but quotation `billing_phase === 'go_live_proration'`.

### Fulfillment branch

```text
syncSubscriptionsFromQuotation(...)
markGoLiveProductsPaidForQuotation(...)   // → lifecycle_status = live
provisionBranchPortalAccessForQuotation(...)
```

Inside `syncSubscriptionsFromQuotation` (`subscription-store.ts`):

1. Ensure organization  
2. Upsert purchase order  
3. Rebuild subscription items for PO  
4. Per assignment: upsert subscription → entitlement → item → usage seed → finalize billing  
5. Finalize: schedule renewal + **`createInitialSubscriptionInvoices`**  
6. Resync product access grants  
7. Mark go-live rows paid / live  
8. Portal provision (usually existing user; no password reset)  
9. Welcome / payment-received email path  
10. After commit: maybe immediate renewal quotation if purchase after 20th

### DB actions

| Table | Op | What is written |
|-------|----|-----------------|
| `payments` | **UPDATE** | Paid + welcome delivery fields |
| `quotations` | **UPDATE** | Paid |
| `leads` | **UPDATE** | Paid / deal-complete logic |
| `active_products` | **UPDATE** | `payment_confirmed_at` for go-live quote |
| **`purchase_orders`** | **UPSERT** | `status='paid'`, `quotation_id`, `paid_at` |
| **`subscriptions`** | **UPSERT** | `status='active'`, `mrr`, `starts_at`, `renews_at`, `payment_confirmed_at`, `quotation_id`, `entitlement_config`, `implementation_purchased`, org/lead/product/branch keys |
| **`subscription_entitlements`** | **INSERT** | Config snapshot + `purchase_order_id` |
| **`subscription_items`** | **DELETE + INSERT** | Lines for this purchase order |
| **`subscription_invoices`** | **INSERT** | Schedule rows (`prorated_initial` / `full_monthly`, etc.) — **billing schedule**, distinct from quotation PDFs |
| **`renewal_events`** | **INSERT / UPSERT** | Next renewal due |
| `usage_metrics*` | **UPSERT** | Seeded from entitlement config |
| `product_access_grants` | **INSERT / DELETE** | Grants now attach to live subscriptions |
| **`product_go_live`** | **UPDATE** | **`lifecycle_status='live'`**, `go_live_paid_at=NOW()`, `uat_expires_at=NULL` |
| `customer_users` | **INSERT** (rare) | Only if portal user missing; normally already created at OTC |
| `commission_entries` | **INSERT** | If partner commission applies to this paid quote |
| `email_outbox` | **INSERT** | Queued mail |

### Note on `product_go_live.subscription_id`

Column exists and upsert SQL accepts it, but current writers typically leave it **NULL**. Relate live products via `organization_id` + `product_id` + `branch_id`, or `otc_quotation_id` / `go_live_quotation_id`.

---

## Two kinds of “invoice”

| Kind | When | Storage |
|------|------|---------|
| **OTC quotation invoice** | Phase 0–2 | `quotations` + `quotation_invoices` + `payments` (setup fee) |
| **Go-live proration quotation invoice** | Phase 4–6 | New `quotations` (`go_live_proration`) + `quotation_invoices` + `payments` |
| **Subscription schedule invoices** | Phase 6 only | Table **`subscription_invoices`** (ongoing billing) |

---

## Where to read product configuration

| Need | Source |
|------|--------|
| Full config after OTC | Paid OTC `product_assignments.config` (and `active_products.config`) |
| UAT credentials / phase | `product_go_live.uat_credentials`, `lifecycle_status` |
| Live entitlement / MRR | `subscriptions.entitlement_config`, `mrr`, `renews_at` |

---

## Portal credentials

| When | Function | DB |
|------|----------|-----|
| First paid fulfillment (OTC) | `provisionBranchPortalAccessForQuotation` → `ensureBranchCustomerUser` | **INSERT** `customer_users` + temp password for welcome mail |
| Later paid quotes | Same, usually `resetCredentials: false` | **UPDATE** existing user; no new temp password |
| Login | `loginCustomerUser` | **INSERT** `customer_auth_sessions` |
| Resend welcome | Regenerate password path | **UPDATE** `customer_users.password_hash`; update `payments.welcome_email_*` |

---

## Key file map

| Concern | Path |
|---------|------|
| Pay + phase branch | `backend/src/modules/payments/fulfillment.ts` |
| Phase constants | `backend/src/modules/payments/billingPhases.ts` |
| Seed / UAT / live | `backend/src/modules/product-go-live/go-live-store.ts` |
| Go-live repo SQL | `backend/src/repositories/raw/productGoLive.repo.ts` |
| Accept + go-live quote | `backend/src/modules/product-go-live/acceptance.ts` |
| Subscriptions on go-live pay | `backend/src/modules/subscriptions/subscription-store.ts` |
| Subscription schedule invoices | `backend/src/modules/billing/subscriptionInvoices.ts` |
| Org conversion | `backend/src/modules/organizations/organization-store.ts` |
| Portal users | `backend/src/modules/customer-portal/customer-auth.ts` |
| OTC amount rules | `backend/src/lib/proration.ts` |
| Email queue | `backend/src/infra/notify.ts` → jobs → `email_outbox` |

---

## Quick SQL checkpoints

```sql
-- After OTC paid
SELECT lifecycle_status, otc_quotation_id, uat_expires_at
FROM product_go_live
WHERE lead_id = '<lead_id>';
-- expect: awaiting_implementation (then uat after send)

SELECT id, status FROM subscriptions WHERE source_lead_id = '<lead_id>';
-- expect: no rows yet

-- After Accept
SELECT id, billing_phase, status FROM quotations
WHERE lead_id = '<lead_id>' AND billing_phase = 'go_live_proration';

-- After go-live paid
SELECT lifecycle_status, go_live_paid_at FROM product_go_live WHERE lead_id = '<lead_id>';
-- expect: live

SELECT id, status, mrr, renews_at FROM subscriptions WHERE source_lead_id = '<lead_id>';
-- expect: active
```

---

## Ordered summary

1. **Create OTC quote** → `quotations` + `product_assignments` + summary/invoices + pending lead  
2. **Approve OTC** → approved quote + `active_products` + pending `payments`  
3. **Pay OTC** → paid payment/quote/lead + org + locations + **portal user** + **`product_go_live=awaiting_implementation`** + welcome email fields — **no subscription**  
4. **Send UAT** → `product_go_live=uat` + credentials JSON  
5. **Accept** → **go-live quotation + pending payment** + `awaiting_subscription_payment`  
6. **Approve go-live** → approved go-live quote + payment link  
7. **Pay go-live** → **subscriptions + schedule invoices + renewals** + **`product_go_live=live`**

That is the full implementation → UAT → invoice → live customer DB path.
