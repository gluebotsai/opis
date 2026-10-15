# CRM Metric Source → Database Field Map

Source of truth: `prisma/schema.prisma` (CRM OLTP on `DATABASE_URL` / `crm_qa`).  
Person identity for contacts is cross-DB (`cdp.customer_profile` + `crm.contact_profiles.account_contact_id`); revenue objects below are CRM-owned.

**Convention:** Prisma model → Postgres table via `@@map`. Column names below use DB snake_case.

---

## Coverage summary

| # | Metric | Calculable today? | Primary tables |
|---|--------|-------------------|----------------|
| 1 | Customer Lifetime Value (blended) | Partial | `invoices`, `sales_orders`, `contact_profiles`, `companies` |
| 2 | ARR per Account | Yes | `contracts`, `companies` |
| 3 | Revenue at Risk (Renewal Exposure) | Yes | `contracts` |
| 4 | Win Rate | Yes (enum rename) | `deals`, `contact_profiles`, `companies` |
| 5 | Quote Acceptance Rate | Yes | `quotes`, `deals` |
| 6 | DSO / AR Aging | Yes | `invoices`, `companies` |
| 7 | Repeat Purchase Rate (B2C) | Yes (table rename) | `sales_orders` |
| 8 | Return/Refund Rate (B2C) | **No** — schema gap | — |
| 9 | Time Since Last Touch | Yes | `contact_activities`, `contact_profiles` |
| 10 | Lead/Account Score Momentum | Yes | `lead_scoring_jobs` |

---

## 1. Customer Lifetime Value (blended)

**Definition:** `SUM(invoices.total) + SUM(b2c net commerce)` per customer — economic value across B2B + B2C.

### Actual CRM mapping

There is **no** `b2c_commerce_orders` table. B2C / contact-first commerce is stored on **`sales_orders`** where `deal_id IS NULL` and `contact_id IS NOT NULL` (see `listOrders({ commerceOnly: true })`).

| Role | Table | Columns |
|------|-------|---------|
| B2B / invoiced revenue | `invoices` | `id`, `organization_id`, `company_id`, `order_id`, `deal_id`, `total`, `currency`, `status`, `issue_date`, `paid_at`, `created_at` |
| B2C commerce revenue | `sales_orders` | `id`, `organization_id`, `contact_id`, `company_id`, `deal_id`, `total`, `currency`, `status`, `confirmed_at`, `created_at` |
| Order lines (optional detail) | `order_lines` | `order_id`, `amount`, `quantity`, `unit_price` |
| Customer bridge (contact ↔ company) | `contact_profiles` | `account_contact_id` (= CDP person), `company_id`, `organization_id` |
| Account grain | `companies` | `id`, `name`, `organization_id` |

### Suggested formula (as implemented)

```text
-- B2B side (company grain)
SUM(invoices.total) WHERE status NOT IN ('void', 'draft')
  GROUP BY company_id

-- B2C side (contact grain)
SUM(sales_orders.total) WHERE deal_id IS NULL
  AND contact_id IS NOT NULL
  AND status NOT IN ('cancelled', 'draft')
  GROUP BY contact_id
```

Blended “per customer” requires a product decision on grain:

- **Company CLV:** invoice totals + commerce orders linked via `sales_orders.company_id` or `contact_profiles.company_id`.
- **Contact CLV:** commerce `contact_id` + invoices reached via deal/order → company → `contact_profiles`.

### Gaps

| Stated field | In schema? | Notes |
|--------------|------------|-------|
| `b2c_commerce_orders` | No | Use `sales_orders` (commerce filter) |
| `refund_total` | No | No refund column on orders or invoices |
| Unified customer id | Partial | Contact UUID vs `companies.id`; join via `contact_profiles` |

---

## 2. ARR per Account

**Definition:** `SUM(contracts.arr) GROUP BY company_id`.

| Table | Column | Type / notes |
|-------|--------|--------------|
| `contracts` | `id` | PK |
| `contracts` | `organization_id` | Tenant |
| `contracts` | `company_id` | Account FK → `companies.id` |
| `contracts` | `deal_id` | Optional originating deal |
| `contracts` | `arr` | `Decimal(12,2)` nullable — recurring baseline |
| `contracts` | `starts_at`, `ends_at` | Term window |
| `contracts` | `title` | Label |
| `companies` | `id`, `name` | Account display |

**SQL sketch:**

```sql
SELECT company_id, SUM(arr) AS arr
FROM contracts
WHERE organization_id = $org
  AND arr IS NOT NULL
GROUP BY company_id;
```

**Status:** Fully supported.

---

## 3. Revenue at Risk (Renewal Exposure)

**Definition:** `SUM(arr)` where contract ends within 90 days **and** no renewal deal.

| Table | Column | Role |
|-------|--------|------|
| `contracts` | `arr` | $ exposure |
| `contracts` | `ends_at` | Near-term window (`ends_at <= now() + 90 days` AND `ends_at >= now()` — product may include already-lapsed) |
| `contracts` | `renew_deal_id` | Null = no renewal pipeline |
| `contracts` | `company_id` | Account |
| `contracts` | `renewal_reminded_at` | Ops signal (not in formula; useful companion) |
| `contracts` | `deal_id` | Original deal (optional context) |

**SQL sketch:**

```sql
SELECT SUM(arr) AS revenue_at_risk
FROM contracts
WHERE organization_id = $org
  AND ends_at BETWEEN NOW() AND NOW() + INTERVAL '90 days'
  AND renew_deal_id IS NULL
  AND arr IS NOT NULL;
```

**Status:** Fully supported — field names match the metric definition.

---

## 4. Win Rate

**Definition:** `COUNT(stage='won') / COUNT(closed deals)` by segment / rep / source.

### Actual CRM mapping

Deal stages are **not** `won` / `lost`. Enum `DealStage`:

`qualification` | `discover` | `propose` | `negotiate` | `closed_won` | `closed_lost`

| Dimension | Table | Column |
|-----------|-------|--------|
| Outcome | `deals` | `stage` (`closed_won` / `closed_lost`) |
| Closed filter | `deals` | `stage IN ('closed_won','closed_lost')` or `closed_at IS NOT NULL` |
| Amount (optional) | `deals` | `amount` |
| Close timing | `deals` | `closed_at`, `expected_close_date`, `updated_at` |
| Rep | `deals` | `owner_user_id` |
| Account / segment | `deals` | `company_id` → `companies.industry`, `employee_count` |
| Source | `contact_profiles` | `lead_source` (via `deals.contact_id` = `contact_profiles.account_contact_id`) |
| Contact on deal | `deals` | `contact_id` |

**SQL sketch:**

```sql
SELECT
  COUNT(*) FILTER (WHERE stage = 'closed_won')::float
  / NULLIF(COUNT(*) FILTER (WHERE stage IN ('closed_won','closed_lost')), 0)
  AS win_rate
FROM deals
WHERE organization_id = $org;
```

**Status:** Supported with enum rename (`won` → `closed_won`).

---

## 5. Quote Acceptance Rate

**Definition:** `COUNT(status='accepted') / COUNT(quotes)`.

| Table | Column | Notes |
|-------|--------|-------|
| `quotes` | `status` | Enum: `draft`, `sent`, `accepted`, `rejected`, `void` |
| `quotes` | `accepted_at` | Timestamp when accepted |
| `quotes` | `sent_at` | Useful denominator filter (sent+ only) |
| `quotes` | `deal_id` | Join to deal / rep / company |
| `quotes` | `total`, `currency`, `subtotal`, `discount_pct` | Pricing context |
| `quotes` | `created_by_user_id`, `organization_id` | Rep / tenant |
| `deals` | `owner_user_id`, `company_id` | Segment dimensions |

**Recommendation:** Denominator often excludes `draft` / `void` — product choice:

```sql
COUNT(*) FILTER (WHERE status = 'accepted')
/ NULLIF(COUNT(*) FILTER (WHERE status NOT IN ('draft','void')), 0)
```

**Status:** Fully supported.

---

## 6. DSO / AR Aging

**Definition:** Average `paid_at − issue_date` for paid invoices; overdue buckets for unpaid.

| Table | Column | Role |
|-------|--------|------|
| `invoices` | `paid_at` | Payment timestamp (set on mark-paid) |
| `invoices` | `issue_date` | Invoice date |
| `invoices` | `due_at` | Aging / overdue boundary |
| `invoices` | `status` | `draft`, `sent`, `paid`, `void`, `overdue` |
| `invoices` | `total`, `currency` | $ at risk in buckets |
| `invoices` | `company_id` | Customer |
| `invoices` | `discount_amount`, `tax_amount` | Optional netting |

**DSO (paid):**

```sql
AVG(EXTRACT(EPOCH FROM (paid_at - issue_date)) / 86400.0)
FROM invoices
WHERE status = 'paid' AND paid_at IS NOT NULL AND issue_date IS NOT NULL;
```

**AR aging (unpaid):** bucket by `NOW() - due_at` (or `issue_date`) where `status IN ('sent','overdue')` and `paid_at IS NULL`. Runtime also treats `due_at < now` as overdue even if status is still `sent` (`effectiveInvoiceStatus`).

**Status:** Fully supported.

---

## 7. Repeat Purchase Rate (B2C)

**Definition:** `COUNT(customers with >1 order) / COUNT(distinct customers)`.

### Actual CRM mapping

Use commerce slice of **`sales_orders`** (not a separate B2C table):

| Column | Use |
|--------|-----|
| `contact_id` | Customer key (required for commerce) |
| `deal_id` | Must be `NULL` for commerce-only |
| `status` | Exclude `cancelled` / `draft` as needed |
| `organization_id` | Tenant |
| `created_at` / `confirmed_at` | Optional time window |

**SQL sketch:**

```sql
WITH buyers AS (
  SELECT contact_id, COUNT(*) AS order_count
  FROM sales_orders
  WHERE organization_id = $org
    AND deal_id IS NULL
    AND contact_id IS NOT NULL
    AND status NOT IN ('cancelled', 'draft')
  GROUP BY contact_id
)
SELECT
  COUNT(*) FILTER (WHERE order_count > 1)::float
  / NULLIF(COUNT(*), 0) AS repeat_purchase_rate
FROM buyers;
```

**Status:** Supported via `sales_orders` commerce filter.

---

## 8. Return/Refund Rate (B2C)

**Definition:** `SUM(refund_amount) / SUM(total)` from returns + orders.

### Schema gap

| Stated source | Present? |
|---------------|----------|
| `b2c_commerce_returns` | **No table** |
| `refund_amount` / `refund_total` | **No columns** on `sales_orders`, `order_lines`, or `invoices` |

**Weak proxies (not true refund rate):**

- Share of commerce orders with `status = 'cancelled'`
- Audit logs (`audit_logs`) with order-related actions — no structured refund amount

**To support this metric properly, CRM would need** (illustrative — not implemented):

- Returns / refunds table, or
- `refund_total` (and optionally `refunded_at`) on `sales_orders`

**Status:** Not calculable from current schema.

---

## 9. Time Since Last Touch (Engagement Recency)

**Definition:** `MAX(created_at)` per contact vs today.

| Table | Column | Role |
|-------|--------|------|
| `contact_activities` | `contact_id` | Person UUID (CDP / account contact) |
| `contact_activities` | `created_at` | Touch timestamp |
| `contact_activities` | `type` | `call`, `meeting`, `email`, `sms`, `note`, `task` — optional filter |
| `contact_activities` | `completed_at` | Prefer for completed tasks/meetings |
| `contact_activities` | `email_direction` | Inbound vs outbound if email-only recency |
| `contact_activities` | `folder` | Exclude `trash` / `draft` for mail |
| `contact_profiles` | `nurture_last_touch_at` | Agent nurture overlay (secondary) |
| `contact_profiles` | `account_contact_id` | Same UUID as `contact_activities.contact_id` |

**SQL sketch:**

```sql
SELECT
  contact_id,
  MAX(created_at) AS last_touch_at,
  NOW() - MAX(created_at) AS time_since_last_touch
FROM contact_activities
WHERE organization_id = $org
  AND folder NOT IN ('trash', 'draft')  -- optional
GROUP BY contact_id;
```

**Status:** Fully supported. Prefer `contact_activities` as system of record for “any touch”; use `nurture_last_touch_at` only for nurture-agent scope.

---

## 10. Lead/Account Score Momentum

**Definition:** `score − previous_score` from latest scoring job per contact.

| Table | Column | Role |
|-------|--------|------|
| `lead_scoring_jobs` | `contact_id` | Person |
| `lead_scoring_jobs` | `score` | Current score |
| `lead_scoring_jobs` | `previous_score` | Prior score (updated on re-queue) |
| `lead_scoring_jobs` | `fit_score`, `intent_score` | Optional component momentum |
| `lead_scoring_jobs` | `band`, `grade` | Band change companion |
| `lead_scoring_jobs` | `status` | Use `scored` rows for reporting |
| `lead_scoring_jobs` | `completed_at`, `updated_at` | Recency |
| `lead_scoring_jobs` | `organization_id` | Tenant |

**Uniqueness:** `@@unique([organizationId, contactId])` — one row per contact; history is **not** a multi-row time series. Momentum = `score - previous_score` on that row.

```sql
SELECT
  contact_id,
  score,
  previous_score,
  (score - previous_score) AS score_momentum
FROM lead_scoring_jobs
WHERE organization_id = $org
  AND status = 'scored'
  AND score IS NOT NULL
  AND previous_score IS NOT NULL;
```

**Status:** Supported for delta-on-latest-job. Full score history would need a new history table or audit of score changes.

---

## Entity relationship (metric-relevant)

```text
companies ──< contracts (arr, ends_at, renew_deal_id)
    │
    ├──< deals (stage, owner_user_id, contact_id, closed_at)
    │       └──< quotes (status, accepted_at, total)
    │       └──< sales_orders (deal path) ──< invoices
    │
    └──< invoices (total, paid_at, issue_date, due_at, status)

sales_orders (commerce: deal_id NULL, contact_id set)
    └── contact_id ── contact_profiles.account_contact_id
                          └── company_id → companies

contact_activities.contact_id ── same UUID as contact_profiles.account_contact_id
lead_scoring_jobs.contact_id  ── same UUID
```

---

## Enum quick reference

| Enum | Values (metric-relevant) |
|------|--------------------------|
| `DealStage` | `closed_won`, `closed_lost` (+ open stages) |
| `QuoteStatus` | `draft`, `sent`, `accepted`, `rejected`, `void` |
| `OrderStatus` | `draft`, `confirmed`, `fulfilled`, `cancelled` |
| `InvoiceStatus` | `draft`, `sent`, `paid`, `void`, `overdue` |
| `ActivityType` | `call`, `meeting`, `email`, `sms`, `note`, `task` |
| `LeadScoringStatus` | includes `scored` (see schema) |

---

## Implementation notes

1. Always scope by `organization_id`.
2. Exclude void/draft documents unless the metric explicitly includes them.
3. B2C finance: invoices are typically company-backed; pure B2C commerce often has **no** invoice (`createCommerceOrder` skips invoice when `company_id` is null) — CLV must use `sales_orders.total` for that path.
4. Metric 8 (refunds) is the only hard blocker; others map with naming/grain adjustments documented above.

---

*Generated from `prisma/schema.prisma` and commerce order DAO conventions (`backend/src/dao/sales/order-service.ts`).*
