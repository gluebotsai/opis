# CRM Reports & Analytics — Rebuilt Build Plan (for Claude Code CLI)

Target: `reports_analytics_agent_crm/` — a Domain agent + SQL executor + KG executor for the B2B CRM spoke, built on `REPORTING_V2_DESIGN.md` and reusing what is good from the ticketing pack.

Sources this plan is built from: the four CRM docs (`01` schema, `02` modules/roles/pipeline, `03` KPIs, `04` executors), the V2 design, the ticketing architecture guide, and the currency trace you supplied from the app (`DealDetailPage.tsx` → `amountCurrency`).

How to read it: everything is split into **small sessions**. Each is one Claude Code run with a fixed input list, a fixed output list, and a check command. Never ask one session to "do the module".

---

## 1. Locked decisions

| # | Decision | Effect |
|---|---|---|
| L1 | **Deal currency follows the app's `amountCurrency` rule** (Section 4). `crm.deals` has no currency column; currency is resolved per deal from quotes, then tenant country. | `rpt.deals.currency_code` exists. Every money total is **grouped by currency**. A mixed-currency sum is never a result. No FX conversion. |
| L2 | **UTC only.** Weeks Monday–Sunday; months, quarters, years are UTC calendar. | `time.py` has no timezone logic. `appointments.timezone` is display only. |
| L3 | **The CRM graph lives in the same Neo4j org database as ticketing.** | The CRM `cypher_guard` needs its own product boundary (Section 9). |
| L4 | **Wherever doc 03 says a role "may" see a metric, that role sees it.** | The role × metric matrix in Section 5 is definitive; no "maybe" cells. |
| L5 | **Deterministic where correctness matters, LLM where understanding matters.** | Every catalogued KPI runs through a certified template (`run_kpi`). Free SQL only for lists and lookups no KPI covers. |
| L6 | **Copy-then-diverge from the ticketing pack** for v1. | Copied files carry `# origin: ticketing_v2/core/<file>` headers so a later shared-core refactor is mechanical. |
| L7 | **v1 scope: sales, finance, agent-ops, and lead/contact metrics.** Marketing role gets own-contact metrics only. SEO and campaign tables are out of v1. | About 19 `rpt.*` views. |
| L8 | **The reports agent is read-only.** | Read-only DB role, read-only transactions, SELECT/WITH only, no export of secrets or message bodies. |

---

## 2. Boundaries

Each boundary has a rule, the component that enforces it, and the test that proves it.

| # | Boundary | Rule | Enforced by | Proven by |
|---|---|---|---|---|
| B1 | **Product scope** | In: read-only reporting on B2B CRM data (companies, contacts, deals, quotes, orders, invoices, contracts, activities, appointments, products, agent-job status). Out: B2C/Commerce, Service tickets (not in the CRM tables), any write or edit, forecasting models, external payment ledgers, SEO/campaign (v1). | Domain plan step; `kpis.yml` `status` | Refusal tests in the question bank |
| B2 | **Tenant** | Every query is scoped to the session's `organization_id`, injected by Python, never written or chosen by an LLM. `accounts.organizations.business_type` must be `b2b` or `b2b2c`; a `b2c` tenant gets **no finance metrics** and no B2B views. | `views.py`, `sql_guard.py` | Org 42 vs org 99 isolation tests; b2c tenant test |
| B3 | **Data surface** | SQL touches only `rpt.*` views. Nothing else in `crm`, `accounts`, `cdp` or `inventory` is queryable. From `accounts`: organization fields (country, business_type), user id/name/status. From `cdp`: name, email, phone, contact type through `rpt.contacts`. From `inventory`: `products`. Table tiers (A report-facing, K graph evidence, B ops, C excluded) live in `docs/crm/table_tiers.yml`. | `schema.yml`, guard | Guard escape tests |
| B4 | **Never exposed** | Password hashes, tokens, secrets, API keys, bank details, input hashes, payment session ids, mailbox credentials, transcript text, email bodies. | Column removal in `views.py` | Security-review session S10.3 |
| B5 | **Role and record scope** | The role and user id come from the authenticated session, never from the question or the LLM. Missing user id → no rows (fail closed). Record scope per role is in Section 3.6. The Reports sidebar item is **not** a data right. | `access.yml`, `views.py` | Role × view tests; access-denial pack |
| B6 | **Leaking existence** | Out-of-scope record lookups answer "not found in your records"; out-of-role metrics answer "not available for your role". Neither confirms that hidden data exists. | `resolve.py`, synthesis prompt | Access-denial pack |
| B7 | **Metric** | Only certified KPIs produce catalogued numbers. Metrics marked `unavailable` return their `missing_input` message and are **never approximated** (no keyword reads of notes, no won-reason from lost reason, no time-in-stage from `updated_at`). | `run_kpi.py`, `kpis.yml` | Unavailable-KPI tests |
| B8 | **Currency** | Deal-based money uses the resolved `currency_code`; quote, order and invoice money uses the row's own `currency`. Totals are grouped by currency, one figure per currency. A null currency is its own group, shown as a plain number. No conversion, no cross-currency ranking without a mixed-book warning. | `_base_deal.sql`, `run_kpi.py`, `facts.py`, `grounding.py` | Currency-rule tests (Section 4.3) |
| B9 | **Time** | UTC. "Now" is fixed once per request. Period metrics use `coalesce(closed_at, created_at)` as the close timestamp (deal metrics) or the metric's own timestamp. | `time.py` | Time tests |
| B10 | **Executor** | **SQL executor:** numbers, lists, lookups, breakdowns, trends, comparisons. **KG executor:** relationships, paths, and evidence; **never counts or sums for a certified number**. The two never call each other; the Domain orchestrates. The graph is never the source of a number the SQL executor can compute. | Prompts, orchestrator | Deep-question tests |
| B11 | **Graph** | CRM traversal stays inside CRM labels and allowlisted edges; ticketing stays out of CRM ones; shared labels (`Contact`, `Agent`/`User`) are leaf nodes; owner scope applies on **every hop**; graph may be stale, and answers say when it was last synced. | `cypher_guard.py` | Cross-product and cross-owner escape tests |
| B12 | **Output** | Row cap 500 for lists, top-N for rankings; every number in the answer must appear in the fact block; personal data only when the question needs it. | `run_sql.py`, `grounding.py` | Grounding tests |
| B13 | **Build process** | Sessions never modify the CRM application repo; never write to a production database; tests run only on the golden database; structural facts come from `inventory/`, never from memory. | `CLAUDE.md` | Review at each session end |

---

## 3. Roles, modules and permissions (reference for `access.yml`)

Source: doc 02, which reflects `backend/src/config/modules.ts` and `backend/src/service/auth/ownership-scope.ts`. Session S1.3 re-verifies every row against code.

### 3.1 Tenant business type

`accounts.organizations.business_type`:

| Value | Revenue path | Finance module | Reports agent |
|---|---|---|---|
| `b2b` | Company and deal → quote → order → invoice | Enabled | Full B2B set |
| `b2b2c` | Both paths, shared contact and company ids | Enabled | B2B set (the B2C side is out of scope) |
| `b2c` | Contact → Commerce orders | Never enabled | Refuse finance and B2B-only metrics |

Industry (`industry_type`) selects a field pack only; it is not a different set of tables.

### 3.2 Modules on a B2B tenant

| Module | Route | Purpose |
|---|---|---|
| Dashboard | `/dashboard` | Home numbers: pipeline, activity, agent status |
| Agents | `/agents` | Job status: enrichment, scoring, summary, nurture, lifecycle, assignment |
| Inbox | `/inbox` | Mail and timeline items (inbox, sent, draft, trash) |
| Contact | `/contact` | People (name/email from CDP; owner and lead status from `crm.contact_profiles`) |
| Company | `/company` | B2B accounts (`crm.companies`) |
| Marketing | `/marketing` | Campaign surface (not the sales pipeline) |
| Sales | `/sales` | Opportunities, quotes, path to an order |
| Activities | `/activities` | Tasks, calls, meetings, emails to work |
| Product | `/product` | Catalog (`inventory.products`), offers, add-ons, price books |
| Finance | `/finance` | Invoices: approval, send, payment |
| Service | `/service` | Link to the Service product (tickets are not in the CRM tables) |
| Reports | `/reports` | Sidebar item visible to marketing only (see 3.7) |
| Configuration | `/configuration/email` | Mail and calendar connection |

### 3.3 Roles and responsibilities

The CRM role comes from `accounts.setup_user_product_access` (`product_id = 'crm'`) joined to `accounts.setup_roles.name`; unknown names fall back to `sales_rep`. There is no CRM Super Admin.

| Role | Responsibility | Record visibility | Admin-type rights (context only) |
|---|---|---|---|
| `admin` | Runs the tenant | Whole organization | Manage users, edit org settings, assign owners, approve discounts, edit finance, manage templates |
| `sales_manager` | Runs the sales team | Whole organization | Edit org settings, assign owners, approve discounts, manage templates; no user management; no finance-settings edit |
| `sales_rep` | Owns a book of contacts, companies, deals; moves pipeline, logs activity, sends quotes | Own records, records created, plus channel companies owned and their direct children | — |
| `presales` | Supports discovery, proposals, meetings on deals they own | Same owner scope as a rep (not org-wide) | — |
| `marketing` | Runs campaigns and the marketing nav | Contacts and companies they own | — |
| `finance` | Owns invoices: approve, send, record payment | Whole organization | Edit finance settings |
| `viewer` | Read-only | Own records only | None; cannot connect a mailbox |

`canViewAllRecords` is true only for `admin`, `sales_manager`, `finance`. Everyone else is filtered by `owner_user_id`. Missing session user id → sentinel `0` → matches nothing.

### 3.4 Who can open which module

| Module | admin | sales_manager | sales_rep | presales | marketing | finance | viewer |
|---|---|---|---|---|---|---|---|
| Dashboard | yes | yes | yes | yes | yes | yes | yes |
| Agents | yes | yes | no | no | no | no | no |
| Inbox | yes | yes | yes | yes | yes | yes | yes |
| Contact | yes | yes | yes | yes | yes | yes | yes |
| Company | yes | yes | yes | yes | yes | yes | yes |
| Marketing | yes | yes | no | no | yes | no | no |
| Sales | yes | yes | yes | yes | no | no | yes |
| Activities | yes | yes | yes | yes | yes | no | yes |
| Product | yes | yes | yes | yes | yes | no | yes |
| Finance | yes | yes | no | no | no | yes | no |
| Service | yes | yes | yes | yes | no | no | no |
| Reports (sidebar) | no | no | no | no | yes | no | no |
| Configuration | yes | yes | yes | yes | yes | yes | no |

Deep links (route reachable without a sidebar item): finance → Sales (invoice row opens its deal); sales_rep, sales_manager, presales → Finance (accepted quote opens the invoice being approved).

### 3.5 Channel hierarchy

`crm.companies.channel_role`: `standard`, `franchise`, `owned_store`, `brand_hq`. When a non-org-wide user owns a company whose role is `franchise`, `owned_store` or `brand_hq`, they also see that company and its **direct children** (`parent_company_id`). `standard` companies do not expand. (Doc 02 says "direct children"; S1.3 confirms whether this is one level or recursive, and whether it extends to deals, quotes and invoices or only to company rows.)

### 3.6 Record scope per role and entity (draft; S1.3 replaces with code-verified rules)

| Entity / view | admin, sales_manager | finance | sales_rep, presales | viewer | marketing |
|---|---|---|---|---|---|
| Deals (`rpt.deals`, `rpt.deal_facts`) | org | no access | `owner_user_id = me` | same | no access |
| Companies | org | org (names, channel) | owner = me, plus channel expansion | same | owner = me |
| Contacts | org | converted contacts only | owner = me or created by me | same | owner = me |
| Activities (deal + contact) | org | no access | created by me, or on a record I own, or assigned to me | same | activities on contacts I own |
| Appointments | org | no access | host = me, or contact owned by me | same | no access |
| Quotes, orders (+ lines) | org | org | via the deal owner | same | no access |
| Invoices (+ lines) | org | org | via the deal owner (`deal_id`, or order → deal); invoices with no deal are invisible | no access | no access |
| Contracts, billing schedule | org | org | company or deal owned by me | no access | no access |
| Products | org | org | catalog | catalog | catalog |
| Users | names/status only | names/status only | names/status only | names/status only | names/status only |
| Org targets | org | org | no access | no access | no access |
| Agent jobs | org | no access | no access | no access | no access |

### 3.7 Reports data rights (what the agent enforces)

- **Pipeline, activity, win-rate:** Sales access plus record scope. Admin and sales manager see the organization; sales rep, presales and viewer see their own book. Viewer is read-only.
- **Invoice, collection, contract:** Finance access. Admin, finance and sales manager see the organization; sales roles see invoices reached from quotes on deals they own. Marketing and viewer get no collections book.
- **Campaign and SEO:** Marketing access, marketing tables only (v1: out).
- **Marketing** does not receive org-wide deal amounts just because the Reports sidebar item is visible.
- **Agent job counts:** admin and sales manager only.
- **Finance** does not get the sales dashboard set; it gets the invoice, contract and quote-rate metrics only.

### 3.8 Authoritative enums and pipeline

| Concept | Values |
|---|---|
| Deal stage (`crm.deals.stage`) | `qualification` 0.10, `discover` 0.25, `propose` 0.50, `negotiate` 0.75 (open); `closed_won` 1, `closed_lost` 0 |
| Open stages | qualification, discover, propose, negotiate |
| High probability | open deal with stage weight ≥ 0.75 (today: negotiate) |
| Lead status | `new`, `contacted`, `qualified`, `disqualified`, `converted` (`crm_status = active` for counts) |
| Company `channel_role` | `standard`, `franchise`, `owned_store`, `brand_hq` |
| Location type | `hq`, `branch` |
| Proposal status | `draft`, `shared`, `accepted`, `declined` |
| Quote status | `draft`, `sent`, `accepted`, `rejected`, `void` |
| Order status | `draft`, `confirmed`, `fulfilled`, `cancelled` |
| Invoice status | `draft`, `sent`, `paid`, `void`, `overdue` |
| Invoice `approval_status` | `drafting`, `pending_approval`, `approved` |
| Payment method | `offline`, `manual`, `stripe`, `razorpay` |
| Billing kind | `standard`, `setup`, `subscription_start`, `renewal`, `amendment`, `adjustment`, `credit` |
| Contract status | `active`, `expired`, `cancelled`; billing frequency `monthly`, `quarterly`, `annual` |
| Billing schedule status | `scheduled`, `generated`, `cancelled` |
| Product `billing_type` | `one_time`, `recurring` |
| Activity type | `call`, `meeting`, `email`, `sms`, `note`, `task` |
| Task status | `open`, `in_progress`, `completed` (overdue is derived: `due_at < now` and not completed) |
| Inbox folder / direction | `inbox`, `sent`, `draft`, `trash` / `outbound`, `inbound` |
| Business type | `b2b`, `b2c`, `b2b2c` |

Not stored (never invent): stage history, per-deal probability, won reason, per-rep quota, email open/click events, campaign-to-revenue chain, territory assignments.

---

## 4. Currency rule (from the app)

### 4.1 Rule

`crm.deals.amount` is a bare number. The page prints `formatMoneyFull(d.amount, d.amountCurrency)`; the API fills `amountCurrency` when a deal loads, using this order:

1. Read `crm.quotes` for the deal. Use the **accepted** quote if there is one; otherwise the **most recently updated** quote. Column: `crm.quotes.currency`.
2. If that currency is anything other than `USD` (for example `EUR`), the deal shows that currency.
3. If the quote currency is `USD` **and** the tenant country is not the United States, use the currency of the tenant country (`accounts.organizations.country`): India → INR, United Kingdom → GBP. It does not show dollars.
4. If the deal has no quote, use the tenant country's currency the same way.
5. If there is no quote and no known country, show a plain number with no symbol.

The pipeline uses the same `amountCurrency` value. The reports agent must resolve the same currency, so a report figure never disagrees with the label on the deal page.

### 4.2 Where it lives

`_base_deal.sql` is the single implementation; `rpt.deals.currency_code` and `rpt.deal_facts.currency_code` expose it. A country → currency map (`product/currency_map.yml`) is **extracted from the app code** in S1.6, not typed from memory (only INR and GBP are confirmed so far).

```sql
-- product/sql/_base_deal.sql (sketch; S1.6 verifies each branch against the app code)
WITH pick AS (                       -- accepted quote first, else latest updated
  SELECT DISTINCT ON (deal_id) deal_id, currency
  FROM crm.quotes
  WHERE organization_id = :org_id
  ORDER BY deal_id, (status = 'accepted') DESC, updated_at DESC
)
SELECT d.id AS deal_id, d.amount,
  CASE
    WHEN p.currency IS NOT NULL AND p.currency <> 'USD' THEN p.currency        -- step 2
    WHEN o.country IS NOT NULL AND o.country <> 'US'
         AND cm.currency IS NOT NULL THEN cm.currency                          -- steps 3 and 4
    WHEN p.currency = 'USD' THEN 'USD'                                         -- USD quote, US or unmapped country
    WHEN o.country = 'US' THEN 'USD'                                           -- step 4, US tenant
    ELSE NULL                                                                  -- step 5: plain number
  END AS currency_code
FROM crm.deals d
JOIN accounts.organizations o ON o.id = d.organization_id
LEFT JOIN pick p ON p.deal_id = d.id
LEFT JOIN currency_map cm ON cm.country = o.country;   -- VALUES CTE generated from product/currency_map.yml
```

Do **not** write step 2 as `COALESCE(NULLIF(accepted,'USD'), NULLIF(latest,'USD'), …)`: that would pick a later non-USD quote over an accepted USD quote, which the app does not do.

### 4.3 Currency tests (golden data)

| Case | Quote | Tenant country | Expected |
|---|---|---|---|
| 1 | accepted EUR | GB | EUR |
| 2 | accepted USD, plus a later EUR draft | GB | GBP (accepted wins; USD falls to country) |
| 3 | no accepted; latest EUR | GB | EUR |
| 4 | no accepted; latest USD | IN | INR |
| 5 | none | GB | GBP |
| 6 | none | IN | INR |
| 7 | none | US | USD |
| 8 | none | null | null (plain number) |
| 9 | USD | US | USD |
| 10 | USD | null | USD (assumption; S1.6 confirms) |
| 11 | two accepted quotes, different currencies | any | latest updated accepted (assumption; S1.6 confirms) |
| 12 | only `void`/`rejected` quotes | GB | S1.6 confirms whether they count |

### 4.4 Reporting consequences

- Every deal money KPI returns **one row per currency**; the Domain never adds across them.
- Deal-size bands are absolute numbers per currency (`<500,000`, `500,000–2,500,000`, `>2,500,000`); the answer names the currency when the book is mixed.
- `top_open_opportunities` sorts by amount, labels each currency, and warns when the list mixes currencies.
- Quote KPIs group by `crm.quotes.currency`; order KPIs by `crm.sales_orders.currency`; invoice KPIs by `crm.invoices.currency`; contract billing by its own currency. A deal's resolved currency and its invoices' currencies can differ; the answer says which one it used.
- `facts.py` records the currency on every figure; `grounding.py` checks number **and** currency.
- Null-currency groups are labelled "no currency (plain number)".

---

## 5. KPI catalogue — all 52 metrics in doc 03

Codes: `ORG` whole organization · `OWN` the user's own scope · `–` not available. Roles: **A** admin, **SM** sales manager, **F** finance, **R** sales rep, **P** presales, **M** marketing, **V** viewer.
`Cur` = money grouped by currency. `Cmp` = supports prior-period comparison (flow metric). Snapshot metrics (`no`) describe the book **now**; there is no stage history, so they have no prior-period value.
Time basis `close_ts` = `coalesce(closed_at, created_at)`.

### 5.1 Tier 1 — Dashboard metrics (21)

| # | id | Definition and formula | Base | Time basis | Cur | Cmp | A | SM | F | R | P | M | V |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `total_opportunities` | Count of deals in scope, including won and lost | deals | snapshot | – | no | ORG | ORG | – | OWN | OWN | – | OWN |
| 2 | `active_opportunities` | Count of deals in an open stage | deals | snapshot | – | no | ORG | ORG | – | OWN | OWN | – | OWN |
| 3 | `total_pipeline` | `sum(amount)` on open deals; null adds nothing; excludes won | deals | snapshot | yes | no | ORG | ORG | – | OWN | OWN | – | OWN |
| 4 | `weighted_pipeline` | `sum(amount × stage_weight)` on open deals | deals | snapshot | yes | no | ORG | ORG | – | OWN | OWN | – | OWN |
| 5 | `won_revenue` | `sum(amount)` where `closed_won` and close_ts in period (all-time = no filter) | deals | close_ts | yes | yes | ORG | ORG | – | OWN | OWN | – | OWN |
| 6 | `lost_revenue` | `sum(amount)` where `closed_lost` and close_ts in period | deals | close_ts | yes | yes | ORG | ORG | – | OWN | OWN | – | OWN |
| 7 | `win_rate` | `won / (won + lost)` for deals closed in period; 0 if both 0; small-sample note | deals | close_ts | – | yes | ORG | ORG | – | OWN | OWN | – | OWN |
| 8 | `average_deal_size` | Open pipeline ÷ count of open deals (not the average of won deals); 0 if none | deals | snapshot | yes | no | ORG | ORG | – | OWN | OWN | – | OWN |
| 9 | `average_probability` | `avg(stage_weight) × 100` over open deals | deals | snapshot | – | no | ORG | ORG | – | OWN | OWN | – | OWN |
| 10 | `average_aging` | Mean whole days from `created_at` to now on open deals (age since create) | deals | snapshot | – | no | ORG | ORG | – | OWN | OWN | – | OWN |
| 11 | `high_probability_deals` | Count of open deals with stage weight ≥ 0.75 | deals | snapshot | – | no | ORG | ORG | – | OWN | OWN | – | OWN |
| 12 | `new_pipeline_month` | `sum(amount)` of deals created this UTC month (open or not) | deals | created_at | yes | yes | ORG | ORG | – | OWN | OWN | – | OWN |
| 13 | `sales_velocity` | `(active × win_rate/100 × average_deal_size) ÷ avg cycle days` of period wins (cycle > 0 samples only); 0 if cycle 0 or no open deals | deals | close_ts + snapshot | yes | no | ORG | ORG | – | OWN | OWN | – | OWN |
| 14 | `pipeline_by_stage` | Count and sum per stage: qualification, discover, propose, negotiate, closed_won | deals | snapshot | yes | no | ORG | ORG | – | OWN | OWN | – | OWN |
| 15 | `win_loss_split` | Count of `closed_won` and `closed_lost` in scope | deals | snapshot | – | no | ORG | ORG | – | OWN | OWN | – | OWN |
| 16 | `aging_bands` | Open deals by age: 0–30, 31–60, 61–90, 91+ days | deals | snapshot | – | no | ORG | ORG | – | OWN | OWN | – | OWN |
| 17 | `deal_size_bands` | Open deals by amount: <500,000, 500,000–2,500,000, >2,500,000, per currency | deals | snapshot | yes | no | ORG | ORG | – | OWN | OWN | – | OWN |
| 18 | `pipeline_by_owner` | Open `amount` by `owner_user_id`, top 10, name from `setup_users`; null owner = "Unassigned" | deals | snapshot | yes | no | ORG | ORG | – | own total | own total | – | own total |
| 19 | `lost_reasons` | Lost deals by `lost_reason`, top 8; blank = "Unspecified" | deals | close_ts | – | yes | ORG | ORG | – | OWN | OWN | – | OWN |
| 20 | `won_revenue_trend` | Won `amount` per month for the last six UTC months, oldest first | deals | close_ts | yes | – | ORG | ORG | – | OWN | OWN | – | OWN |
| 21 | `top_open_opportunities` | Ten largest open deals: title, stage, company, owner, aging days, weight % | deals | snapshot | yes | no | ORG | ORG | – | OWN | OWN | – | OWN |

### 5.2 Tier 2 — Core metrics (17)

| # | id | Definition and formula | Base | Time basis | Cur | Cmp | A | SM | F | R | P | M | V |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 22 | `avg_sales_cycle` | Mean days `created_at` → close_ts for `closed_won` in period, positive durations only | deals | close_ts | – | yes | ORG | ORG | – | OWN | OWN | – | OWN |
| 23 | `quote_acceptance_rate` | `accepted / (accepted + rejected)` for quotes decided in period (decision timestamp when set, else `updated_at`); draft, sent, void excluded | quotes + deals | decision ts | – | yes | ORG | ORG | ORG | OWN | OWN | – | OWN |
| 24 | `open_quote_value` | Sum of quote totals with status `draft` or `sent`; not pipeline | quotes | snapshot | yes | no | ORG | ORG | ORG | OWN | OWN | – | OWN |
| 25 | `expected_close_value` | `sum(amount)` of open deals with `expected_close_date` in period; weighted variant × stage weight; null date counted aside as "no close date" | deals | expected_close_date | yes | no | ORG | ORG | – | OWN | OWN | – | OWN |
| 26 | `lead_status_mix` | Count of `contact_profiles` (`crm_status = active`) by `lead_status` | contacts | snapshot | – | no | ORG | ORG | ORG (converted only) | OWN | OWN | OWN | OWN |
| 27 | `unassigned_leads` | Active profiles with null owner, status not converted or disqualified | contacts | snapshot | – | no | ORG | ORG | – | – | – | – | – |
| 28 | `days_since_last_touch` | Days from latest activity `created_at` to now; deals read `deal_activities`, contacts read `contact_activities`; none = "no logged touch" | activities | snapshot | – | no | ORG | ORG | – | OWN | OWN | OWN (contacts) | OWN |
| 29 | `activity_volume` | Count of activities by type in period, stating the source table; never add both tables blindly | activities | created_at | – | yes | ORG | ORG | – | OWN | OWN | OWN (contacts) | OWN |
| 30 | `open_task_count` | Contact activities with type `task` and status `open` or `in_progress`; overdue = `due_at < now` | activities | snapshot | – | no | ORG | ORG | – | OWN | OWN | – | OWN |
| 31 | `invoice_outstanding` | `sum(total)` where status `sent` or `overdue`; paid, void, draft excluded | invoices | snapshot | yes | no | ORG | ORG | ORG | OWN | OWN | – | – |
| 32 | `overdue_amount` | `sum(total)` where status `overdue`, or `sent` with `due_at < now`; states which rule, mentions the second figure if they disagree | invoices | due_at | yes | no | ORG | ORG | ORG | OWN | OWN | – | – |
| 33 | `collected_revenue` | `sum(total)` where status `paid` and `paid_at` in period; gateway events support, not added | invoices | paid_at | yes | yes | ORG | ORG | ORG | OWN | OWN | – | – |
| 34 | `approval_queue` | Count of invoices with `approval_status = pending_approval` | invoices | snapshot | – | no | ORG | ORG | ORG | OWN | OWN | – | – |
| 35 | `contract_arr` | `sum(arr)` of `active` contracts; null ARR counted as "active with no ARR" | contracts | snapshot | yes | no | ORG | ORG | ORG | OWN | OWN | – | – |
| 36 | `renewal_book` | Count and ARR of active contracts with `ends_at` in the window, plus how many have `renew_deal_id` | contracts | ends_at | yes | no | ORG | ORG | ORG | OWN | OWN | – | – |
| 37 | `product_revenue` | Paid invoice line amounts by product (or order lines for booked mix); says which | invoice lines | paid_at | yes | yes | ORG | ORG | ORG | OWN | OWN | – | – |
| 38 | `average_discount` | Mean of discount ÷ pre-discount total on sent/accepted quotes (`discount_pct`) or sent/paid invoices (`discount_amount`); states the document | quotes / invoices | decision ts / paid_at | – | yes | ORG | ORG | ORG (invoices) | OWN | OWN | – | OWN (quotes) |

### 5.3 Tier 3 — Next-tier metrics (14)

`Status`: `available`, `partial` (computable in part), `unavailable` (missing input; refuse with the message), `pending` (decided by a probe session).

| # | id | Definition | Status and missing input | A | SM | F | R | P | M | V |
|---|---|---|---|---|---|---|---|---|---|---|
| 39 | `quota_attainment` | Won revenue ÷ target for the period | **unavailable per rep** (no per-rep target). Org-level: `partial` if `org_finance_settings` targets exist (S1.1 verifies) | ORG | ORG | ORG (org total) | – | – | – | – |
| 40 | `stage_conversion` | Share of deals moving stage N → N+1 in a period | **pending** S1.4 (needs stage history; today's stock is not a conversion rate) | ORG | ORG | – | OWN | OWN | – | OWN |
| 41 | `won_reason_mix` | Won deals by why they were won | **unavailable** (no won-reason column) | – | – | – | – | – | – | – |
| 42 | `time_in_stage` | Days a deal spent per stage | **pending** S1.4 (needs stage history) | ORG | ORG | – | OWN | OWN | – | OWN |
| 43 | `forecast_vs_target` | Weighted pipeline or expected-close value vs stored target | **partial**: forecast side available; target only if org-level target exists (S1.1) | ORG | ORG | ORG | forecast only | forecast only | – | forecast only |
| 44 | `territory_performance` | Won revenue, pipeline, activity by region | **partial**: only by a real `company_locations` column (city or region code where present); no territory hierarchy | ORG | ORG | – | OWN | OWN | – | OWN |
| 45 | `lead_source_conversion` | Leads and converted leads by `lead_source`, then won amount through `converted_deal_id` | **available** (no ROI: no spend stored) | ORG | ORG | – | OWN | OWN | OWN (counts only, no won amount) | OWN |
| 46 | `campaign_attribution` | Revenue from campaign id → lead → deal → invoice | **unavailable** (chain not stored) | – | – | – | – | – | – | – |
| 47 | `email_engagement_rates` | Opens ÷ sent, clicks ÷ sent | **unavailable** (events not stored) | – | – | – | – | – | – | – |
| 48 | `attach_rate` | Share of won deals or paid invoices whose lines include an add-on (denominator fixed and stated) | **available** | ORG | ORG | ORG | OWN | OWN | – | – |
| 49 | `customer_retention` | Active contracts reaching `ends_at` still active with `auto_renew` vs expired or cancelled (not CDP churn) | **available** | ORG | ORG | ORG | OWN | OWN | – | – |
| 50 | `meeting_completion` | Appointments in period with a later meeting activity, transcript or assist session ÷ scheduled | **available** (states which link was used) | ORG | ORG | – | OWN | OWN | – | – |
| 51 | `agent_operations` | Enrichment, scoring, nurture, lifecycle job counts by status | **available** (operations, not pipeline) | ORG | ORG | – | – | – | – | – |
| 52 | `sequence_compliance` | Share of completed tasks that produced the next scheduled task | **unavailable** (no repeat rules or outcome set) | – | – | – | – | – | – | – |

### 5.4 Cells I resolved (please confirm)

Doc 03 was conditional or silent in these places; I made them definite:
- Finance sees `lead_status_mix` on **converted contacts only**.
- Marketing sees `days_since_last_touch` and `activity_volume` on **its own contacts**, and `lead_source_conversion` as counts only.
- Sales manager sees `approval_queue` for the organization (it has Finance in its sidebar and can view all records).
- Finance sees `average_discount` on **invoices only**.
- Reps, presales and viewers see `forecast_vs_target` only on the **forecast side**.

### 5.5 Metric rules that apply to all

- Every deal metric is scoped **before** it is aggregated: a rep's pipeline is their own deals, never the team's with a different label.
- Null `amount` counts as 0; null close date is reported as "no close date", never dropped silently.
- Small-sample warning for `win_rate` when fewer than 5 decided deals.
- Snapshot metrics never claim a trend. "Why did pipeline change" uses the flow bridge (created − won − lost) in the deep playbook.
- Thresholds (stage weights, band edges, high-probability 0.75, stale-touch 14 days, top-N sizes) live in `product/thresholds.yml`, overridable per tenant.

---

## 6. Working rules for Claude Code (context strategy)

`01-database-schema.md` is about 369 KB (~90k tokens). **No session reads it whole.** S0.2 splits it into one file per table.

1. **One session, one deliverable group.** At most 3 output files, or one batch of the same type (for example 6 SQL templates).
2. **Read by slice.** Use `grep -n`, `sed -n 'a,bp'`, or the per-table split. Never `cat` a file over 300 lines.
3. **Handoff.** End every session by appending 3–6 lines to `docs/PROGRESS.md` (done, stubbed, what the next session must know). A new session reads only `CLAUDE.md`, `docs/PROGRESS.md` and its own inputs.
4. **Green before moving on.** Run the session's check. If it fails, fix it or record the failure.
5. **Commit per session:** `S<id>: <what>`.
6. **No guessing.** If a column, enum or edge is not in `inventory/`, say so and stop for that item.
7. **Generated beats hand-written** for structure (columns, types, enums, FKs). Hand-write only meaning.

Session template:

```
Read CLAUDE.md and docs/PROGRESS.md first.
Session: <ID> — <goal>.
Inputs (read only these): <paths / slices>.
Outputs (write only these): <paths>.
Constraints: <session-specific rules, plus the boundaries that apply (B#)>.
Done when: <check command> passes. Then append a handoff to docs/PROGRESS.md and commit.
```

---

## 7. Repository layout

```text
reports_analytics_agent_crm/
├── CLAUDE.md
├── docs/
│   ├── crm/                     4 source docs (fixed), tables/ split, table_tiers.yml
│   ├── DECISIONS.md   PROGRESS.md   ARCHITECTURE_EXPLAINED.md
├── inventory/                   GENERATED ground truth, never hand-edited
│   ├── pg_columns.json  prisma_enums.json  graph_inventory.md
│   ├── scope_rules.md   currency_rule.md   reuse_map.md
├── domain/                      agent.md, plan.md, review.md, synthesis.md, why_playbook.md
├── sql_executor/agent.md
├── kg_executor/agent.md
├── skills/                      crm-kpi-query, crm-breakdown, crm-record-lookup, crm-report-list, crm-graph-path, crm-export
├── product/
│   ├── schema.yml               ~19 rpt.* views
│   ├── access.yml               role -> views, scope predicate, hidden columns
│   ├── kpis.yml                 52 entries (Section 5)
│   ├── enums.yml  thresholds.yml  glossary.yml  currency_map.yml
│   ├── sql/                     _base_deal.sql, _base_*.sql, one template per available KPI
│   ├── kg/                      labels.yml, edges.yml
│   └── examples/                sql.yml, cypher.yml
├── organizations/org_<id>/tenant_thresholds.yml
├── core/                        loader, db, errors, time, resolve, access, views, sql_guard, templates,
│                                run_sql, run_kpi, facts, analysis, grounding, examples,
│                                cypher_guard, run_cypher, orchestrator, validate
└── tests/
    ├── pg/schema.sql   golden/seed.sql   golden/oracle.py   golden/expected.yml
    ├── unit/   graph/   questions/
```

---

## 8. Sessions

| Phase | Purpose | Sessions |
|---|---|---|
| 0 | Scaffold | S0.1–S0.2 |
| 1 | Ground truth from real systems | S1.1–S1.6 |
| 2 | Golden dataset and oracle | S2.1–S2.3 |
| 3 | Fix the four source docs | S3.1–S3.14 |
| 4 | Product pack | S4.1–S4.13 |
| 5 | Core engine | S5.1–S5.6 |
| 6 | Prompts and examples | S6.1–S6.8 |
| 7 | Quick and standard wiring | S7.1–S7.2 |
| 8 | Evaluation loop | S8.1–S8.3 |
| 9 | Knowledge graph and deep "why" | S9.1–S9.7 |
| 10 | Hardening and final docs | S10.1–S10.3 |

Phases 3–4 can run alongside S1.2 and Phase 9's inventory, since they touch different files.

### Phase 0 — Scaffold

| ID | Goal | Writes | Done when |
|---|---|---|---|
| S0.1 | Skeleton from Section 7; `CLAUDE.md` (Appendix A); `DECISIONS.md` (L1–L8, B1–B13); `PROGRESS.md`; copy ticketing `core/*.py` with `# origin:` headers | skeleton and docs | `tree` matches; `python -c "import core"` |
| S0.2 | `tools/split_schema_doc.py`: doc 01 → `docs/crm/tables/<schema>.<table>.md` + `_index.md` (table, schema, line count, PK, FKs, enums); docs 02–04 → `docs/crm/sections/` | tool and split files | 83 table files; `_index.md` under 400 lines |

### Phase 1 — Ground truth (needs read access to dev Postgres, dev Neo4j, and the CRM backend repo)

| ID | Goal | Reads | Writes | Done when |
|---|---|---|---|---|
| S1.1 | **Postgres inventory.** `information_schema` for the four schemas (columns, types, nullability, defaults), FKs, unique keys, Prisma enums; row counts. Record in PROGRESS.md: `crm.deals` has no `currency` column (confirm); which tables have `currency`; whether `org_finance_settings` holds `revenue_target_monthly/quarterly`; whether `crm.quotes` has a decision timestamp other than `accepted_at`; which tables have `created_by_user_id` | dev DB, `schema.prisma` | `inventory/pg_columns.json`, `prisma_enums.json` | all 83 doc-01 tables found; mismatches listed |
| S1.2 | **Neo4j inventory.** `db.labels()`, `db.relationshipTypes()`, property keys with null rates, node and edge counts, one sample node per label and one edge per type (no PII); **which product owns each label** (marker property and its coverage %); labels present in both products (expected `Contact`, `Agent`/`User`); cross-product edges; sync mechanics (trigger, staleness, delete propagation) | dev Neo4j, graph sync code | `inventory/graph_inventory.md` | all seven items answered or "not found" |
| S1.3 | **Ownership scope.** Per role and entity: exact predicate; how "records they created" applies; channel expansion (one level or recursive; **company rows only, or also deals/quotes/invoices**); fail-closed sentinel; re-verify Section 3.3–3.6 against `modules.ts` | `ownership-scope.ts`, `modules.ts` | `inventory/scope_rules.md` (cites file:line) | every entity has a predicate per role |
| S1.4 | **Stage history probe.** Sample `audit_logs` rows with `action = stage_change`: does `meta` hold from-stage, to-stage, deal id, for what share of deals? Decides `stage_conversion` and `time_in_stage` (pending → available or unavailable) | `crm.audit_logs`, the writer code | section in PROGRESS.md | decision recorded |
| S1.5 | **Ticketing reuse map** (function signatures only): each `core/*.py` → REUSE / ADAPT / REWRITE | ticketing `core/` headers | `inventory/reuse_map.md` | every file classified |
| S1.6 | **Currency rule extraction.** Find where `amountCurrency` is computed (`grep -rn amountCurrency backend/ frontend/`; `DealDetailPage.tsx` line 779 is the display). Record: exact quote selection (accepted tie-break; whether `void`/`rejected` quotes count); the full country → currency map; behavior for an unmapped country; behavior for USD quote + unknown country; whether pipeline/list pages use the same function. Generate `product/currency_map.yml`. Compare against the twelve cases in Section 4.3 | app code | `inventory/currency_rule.md`, `product/currency_map.yml` | each of the 12 cases has an expected value with file:line |

### Phase 2 — Golden dataset and oracle

| ID | Goal | Writes | Done when |
|---|---|---|---|
| S2.1 | DDL for the throwaway test Postgres from `pg_columns.json` (Tier A/K/B tables plus the `accounts`, `cdp`, `inventory` columns CRM uses) | `tests/pg/schema.sql` | loads into a clean Postgres |
| S2.2 | **Seed** (deterministic, fixed clock `2026-09-15T10:30:00Z`, all dates relative). Orgs: **42** (main, country GB, b2b), **99** (US, tenant-isolation), **77** (country null), one **b2c** tenant. Org 42 users: 1 admin, 1 sales manager, 2 reps (A, B), 1 presales, 1 marketing, 1 finance, 1 viewer, 1 inactive user. Companies: standard accounts, a brand HQ with 2 owned stores, a franchise with a child, one unowned. About 60 deals across all stages: null amount, null owner, null expected close, closed deal missing `closed_at`, 100+ days old, created this month, due this month, lost with and without reason. **Currency cases 1–12 from Section 4.3** (accepted EUR, USD-in-GB, latest USD in IN tenant, none, and so on) so org 42 has a mixed-currency book. Contacts across all lead statuses, BANT true/false/null, an unassigned pool, a converted lead. Activities of every type, overdue tasks, deals with no touch in 14+ days. Quotes in all five statuses, orders, invoices in all five statuses and all approval states (including `sent` past `due_at`, and one with null `deal_id`). Contracts (active with and without ARR, expiring this quarter, with and without renewal deal, expired, cancelled), billing schedule, appointments, one transcript, `org_finance_settings` | `tests/golden/seed.sql` | loads; per-table counts logged |
| S2.3 | **Independent oracle** `oracle.py` computes every available KPI × role × currency from the seed straight from doc 03 formulas (not from the SQL templates) | `oracle.py`, `expected.yml` | ≥ 40 KPIs × 7 roles; 5 values spot-checked by a human |

### Phase 3 — Fix the four source docs

**Problems in the current doc 01:** about 397 of ~1,090 column descriptions are template text; 22 of 83 sample rows cover under 80% of columns; sample values are nonsense (a company name in `domain`); money boilerplate is applied to `quantity`; `crm.quotes` describes "declined or expired" while the enum is `rejected, void`; some FKs point at `crm.addons` where the table is `crm.product_addons`; several `contact_id` FK notes are hedged; the `crm.deals` text claims amounts are "in the currency column on the same row", which does not exist.

Table tiers (Appendix D; S3.1 confirms with you): **A** report-facing (~24: full treatment), **K** graph evidence (~7), **B** agent-ops (~8: short), **C** excluded (~44: two lines and the reason).

| ID | Goal | Writes |
|---|---|---|
| S3.1 | Classify all 83 tables; you approve | `docs/crm/table_tiers.yml` |
| S3.2 | Tier A batch 1: `companies`, `company_locations`, `contact_profiles`, `cdp.customer_profile`, `cdp.identity_keys` | 5 table files |
| S3.3 | Batch 2: `deals` (**document the currency rule from Section 4; no currency column**), `deal_activities`, `contact_activities`, `appointments`, `accounts.setup_users` | 5 files |
| S3.4 | Batch 3: `quotes`, `quote_lines`, `sales_orders`, `order_lines`, `proposals` (say that quotes and orders **carry** currency and feed the deal rule) | 5 files |
| S3.5 | Batch 4: `invoices`, `invoice_lines`, `contracts`, `contract_billing_schedules`, `payment_gateway_events` | 5 files |
| S3.6 | Batch 5: `inventory.products`, `product_offers`, `product_addons`, `price_books`, `org_finance_settings`, `accounts.organizations` (country, business_type), `setup_roles`, `setup_user_product_access` | up to 8 files |
| S3.7 | Tier K: `meeting_analyses`, `meeting_assist_sessions`, `meeting_transcript_chunks`, `coaching_insights`, `lead_summaries`, `audit_logs`, `process_confirmations` | 7 files |
| S3.8 | Tier B and C short forms | ~52 files |
| S3.9 | Reassemble doc 01 (`tools/assemble_doc01.py`) and lint | `docs/crm/01-database-schema.md` |
| S3.10 | Patch doc 02 from `scope_rules.md`; make Sections 3.3–3.6 tables role × entity → predicate | doc 02 |
| S3.11 | Rewrite doc 03 dashboard section as metric cards (Section 5.1; card format below) | doc 03 §1 |
| S3.12 | Core section (Section 5.2): `average_discount` uses `discount_pct` on quotes and `discount_amount` on invoices; state the `accepted_at`-only decision timestamp fallback; replace every "may" | doc 03 §2 |
| S3.13 | Next-tier section (Section 5.3) with S1.1/S1.4 outcomes and `missing_input` | doc 03 §3 |
| S3.14 | Rewrite doc 04 to V2: SQL executor emits `run_kpi`/`run_sql` JSON only; KG is relationships and paths, not counts; add boundaries B10 and B11 and the SQL/KG split table | doc 04 |

**Batch prompt for S3.2–S3.7:**

```
Rewrite these table files under docs/crm/tables/: <list>.
For each, read only: its current file, its pg_columns.json entries, its Prisma enums, and 3 seed rows.
Rules:
- Structure: purpose (>=2 sentences: what a row is, why reports read it), PK, FKs with the reason for each join,
  categorical columns with every enum value, column table, one full-row sample.
- Every column description states its meaning in this table. Banned: "stores the X for this row", "typed as", "leave it out of the query".
- Say where a column is NOT reliable (null semantics, derived fields, columns duplicating CDP).
- Sample row: real values from tests/golden/seed.sql, every column present, consistent with the enums.
- Currency follows Section 4; no invented currency column. No "may see" wording; use role names.
- Secrets/tokens are marked `report: never`.
Done when: python tools/lint_tables.py <files> passes.
```

**Metric card format** (makes doc 03 machine-convertible):

```
### <Label>
id: <id>   tier: dashboard|core|next   status: available|partial|unavailable|pending
definition: <one sentence>      formula: <exact columns>      row_set: <base view and joins>
time_basis: ...   currency: yes|no|own-column   compare_periods: yes|no (why)
dimensions: <groupable columns>   null_rules: ...
roles: admin=ORG sales_manager=ORG finance=- sales_rep=OWN presales=OWN marketing=- viewer=OWN
missing_input: <if partial/unavailable>     notes: <pitfalls>
```

### Phase 4 — Product pack

| ID | Goal | Writes | Done when |
|---|---|---|---|
| S4.1 | `enums.yml` (from Prisma plus varchar code lists) and `thresholds.yml` | 2 yml | every enum in doc 01 present |
| S4.2 | `schema.yml` part 1: `rpt.deals` (with `currency_code`), `rpt.deal_facts`, `rpt.companies`, `rpt.company_locations` | schema.yml | `core/validate.py` passes |
| S4.3 | Part 2: `rpt.contacts` (profile + CDP name/email/phone), `rpt.activities` (union of deal and contact activities with a `source` column), `rpt.appointments`, `rpt.users` (id, name, status) | append | validate passes |
| S4.4 | Part 3: `rpt.quotes`, `rpt.quote_lines`, `rpt.orders`, `rpt.order_lines`, `rpt.invoices`, `rpt.invoice_lines`, `rpt.contracts`, `rpt.billing_schedule`, `rpt.products` (each keeps its own `currency`) | append | validate passes |
| S4.5 | Part 4: `rpt.org_targets` (if S1.1 confirms targets), `rpt.agent_jobs`, `rpt.audit_events` (only if S1.4 says usable) | append | validate passes |
| S4.6 | `access.yml`: per role, views, scope predicate (from `scope_rules.md`), removed columns, fail-closed rule; **business_type gate** (b2c tenant → no finance/B2B views) | access.yml | every role × view resolves; viewer has no finance views |
| S4.7 | `kpis.yml` dashboard (21) from doc 03 cards | kpis.yml | label, definition, ≥4 synonyms, roles, time basis, currency flag |
| S4.8 | `kpis.yml` core (17) | append | same |
| S4.9 | `kpis.yml` next-tier (14) with `status` and `missing_input` | append | unavailable KPIs have no SQL file and a refusal message |
| S4.10 | `_base_deal.sql` (Section 4.2), `_base_*.sql`, dashboard templates (≤ 8 per session, 3 sessions) | sql/ | golden: results equal `expected.yml` per role and currency |
| S4.11 | Core templates (17; ≤ 8 per session) | sql/ | same |
| S4.12 | Next-tier templates for the available and partial KPIs (attach, retention, meeting completion, agent ops, lead-source, territory, forecast side) | sql/ | same |
| S4.13 | `glossary.yml` (won = `closed_won`, "pipeline" = open amount, "my deals", "team", "AR", "stalled", "cold leads") and a tenant overlay example | 2 yml | every synonym resolves to a KPI, column or enum |

`kpis.yml` entry shape:

```yaml
win_rate:
  label: Win rate
  tier: dashboard
  status: available
  definition: Share of decided deals in the period that were won.
  synonyms: [win percentage, closing rate, close rate, how many do we win]
  base: rpt.deal_facts
  time_basis: close_ts
  currency: false
  compare_periods: true
  dimensions: [owner, month, quarter, company, industry, lead_source]
  roles: {admin: ORG, sales_manager: ORG, finance: null, sales_rep: OWN, presales: OWN, marketing: null, viewer: OWN}
  sample_size_note: true
  sql: sql/win_rate.sql
```

### Phase 5 — Core engine

| ID | Goal | Notes | Done when |
|---|---|---|---|
| S5.1 | `loader`, `db`, `errors`, `time`, `templates`, `thresholds` | `time.py`: UTC; this month/quarter/year, last 7/30/90 days, this week (Mon–Sun), last six months, comparison windows | `pytest tests/unit/test_time.py` |
| S5.2 | `resolve.py` | Names → ids (users, companies, contacts, products, deals by title/number); scope-aware; out-of-scope answers "not found" (B6) | exact, partial, ambiguous, not-found, out-of-scope tests |
| S5.3 | `access.py`, `views.py` | Scoped CTEs per role; per-parent scoping (invoice → deal owner); business_type gate; fail closed | every role × view; org 99 never appears; unknown user → 0 rows |
| S5.4 | `sql_guard.py` | sqlglot Postgres; one SELECT/WITH; only the role's `rpt.*`; function allowlist; no comments/INTO/locking/recursive CTE; parameter binding; LIMIT ≤ 500; clear rejection reasons for the one repair | ≥ 40 tests incl. `pg_*`, `information_schema`, direct `crm.deals`, `;` chaining, `pg_sleep` |
| S5.5 | `run_sql.py`, `run_kpi.py` | Read-only transaction, statement timeout, sanity signals; `run_kpi` supports group_by, segments, compare, **per-currency output**, and refuses unavailable KPIs with `missing_input` | golden: all KPI × role × currency match `expected.yml` |
| S5.6 | `facts.py`, `analysis.py`, `grounding.py`, `examples.py` | `facts` records currency on each figure; `analysis` keeps `period_delta`, `segment_share_of_change`, `rate_vs_volume` and adds `flow_bridge` and `mix_shift`; `grounding` checks number and currency; `examples` picks 6–10 | tests for each |

### Phase 6 — Prompts and examples

Prompts follow V2: **role → method → output contract → worked examples**. They never list KPIs, columns or thresholds; injected blocks supply those. Fix failures with examples, not new rules.

| ID | Goal | Writes |
|---|---|---|
| S6.1 | SQL examples: records and rosters (15 pairs) | `examples/sql.yml` |
| S6.2 | KPI and comparison (`run_kpi` JSON, group_by, compare; include mixed-currency answers) (20) | append |
| S6.3 | Lists and rankings, incl. rep-scoped variants (20) | append |
| S6.4 | Refusals and edge cases: unavailable KPI, out-of-role, name not found, empty result, b2c tenant (10) | append |
| S6.5 | `sql_executor/agent.md` (≤ 1.5k tokens) | 1 file |
| S6.6 | `domain/agent.md`, `plan.md`, `review.md`, `synthesis.md` (≤ 2.5k tokens each; 8–10 CRM examples per file) | 4 files |
| S6.7 | `domain/why_playbook.md` (≤ 1.2k tokens, injected only for deep) | 1 file |
| S6.8 | Six CRM `skills/*/SKILL.md` (≤ 40 lines each) | 6 files |

**CRM "why" playbook:** (1) measure the change against a baseline, **flow metrics only**; for snapshot metrics use the flow bridge (created − won − lost); (2) split by owner, stage, company, industry, lead source, size band, and **currency** (never blend); (3) volume or rate (`rate_vs_volume`); (4) stalls: open deals past `expected_close_date`, no touch in 14+ days, aging bands; (5) reasons: `lost_reason` mix (SQL), KG evidence for named deals; (6) finance leg for cash questions: `pending_approval`, `sent` unpaid, overdue; (7) conclude: what happened, size, likeliest cause with facts, confidence, next step, and the missing inputs (no stage history, no won reason, no per-rep quota).

### Phase 7 — Wiring

| ID | Goal | Done when |
|---|---|---|
| S7.1 | `core/orchestrator.py`: plan → Python pre-step (time words, names, early access and business_type check) → executors in parallel → facts → synthesis → grounding. Quick and standard only | 10 sample questions run end to end for all 7 roles |
| S7.2 | Harness: role, user and org switchers; shows plan JSON, SQL, guard output, facts, answer, grounding result | manual smoke test |

Depth targets (V2): quick 3 LLM calls, standard 3–4, deep 5–6.

### Phase 8 — Evaluation

| ID | Goal | Writes |
|---|---|---|
| S8.1 | ~150 questions by answer type (record, roster, ranking, filtered list, KPI, comparison, trend, diagnosis, follow-up, refusal) and role; each with `expect: {tool, kpi, filters, row_range, access, currency, numbers_grounded}` | `tests/questions/*.yml` |
| S8.2 | Access-denial pack: each role asks for each out-of-scope item (rep asks team pipeline, marketing asks deal amounts, viewer asks invoices, rep names another rep), prompt-injection ("ignore scope"), missing user id, b2c tenant | `tests/questions/access.yml` |
| S8.3 | Judge rubric (`judge.md`) and `run_bank.py` with deterministic checks plus judge scores; baseline committed | runner |

### Phase 9 — Knowledge graph (shared Neo4j with ticketing)

Neither product's guard may allow a cross-product hop.

**S9.1 — Boundary decision, `labels.yml`, `edges.yml`** from `graph_inventory.md`. Choose one:
- **Option 1 (preferred): product marker property** `product: 'crm' | 'ticketing'` on every node; the guard injects it on every node variable. Needs the sync owner to add and backfill it.
- **Option 2: namespaced labels** (`CrmDeal`, `CrmContact`, …). No property changes, but relabels nodes and touches every ticketing query.
- **Option 3: distinct labels only**, if the inventory shows no collisions. Weakest; a future label can slip through.

Shared labels (`Contact`, `Agent`/`User`) are **leaf nodes**: reachable through one allowlisted edge, no pattern continues from them, properties limited to id and display name.

Candidate CRM labels (reconcile with the inventory): `Company`, `Location`, `Contact`, `Deal`, `Activity`, `Appointment`, `MeetingSession`, `MeetingAnalysis`, `TranscriptChunk`, `Proposal`, `Quote`, `Order`, `Invoice`, `Contract`, `Product`, `User` (owner, leaf). Candidate edges (explicit triples; names are placeholders until the inventory): `(Deal)-[:FOR_COMPANY]->(Company)`, `(Deal)-[:OWNED_BY]->(User)`, `(Deal)-[:PRIMARY_CONTACT]->(Contact)`, `(Contact)-[:WORKS_AT]->(Company)`, `(Company)-[:PARENT_OF]->(Company)`, `(Activity)-[:ON_DEAL]->(Deal)`, `(Quote)-[:QUOTES]->(Deal)`, `(Order)-[:FROM_QUOTE]->(Quote)`, `(Invoice)-[:BILLS]->(Order)`, `(Contract)-[:WITH]->(Company)`, `(MeetingAnalysis)-[:ABOUT]->(Deal)`, `(TranscriptChunk)-[:IN_SESSION]->(MeetingSession)`.

| ID | Goal |
|---|---|
| S9.2 | `cypher_guard.py` + tests. Start from ticketing's guard and add: parse with an openCypher grammar, reject unparseable; explicit labels and allowlisted (from, rel, to) triples only; no `*`, `shortestPath`, `\|`, `!`, dynamic labels, procedures/APOC, writes; forced `LIMIT`; timeout; org database. **Owner scope on every node variable of an owner-scoped label** (`Deal`, `Contact`, `Activity`, `Appointment`, `Quote`, `Order`, `Invoice`, `Contract`), not just the start node, because one company can hold deals owned by several reps; re-check every returned node and path. Transcript and analysis nodes reachable only through a scoped `Deal` or `Contact`. Tests: rep A walks to rep B's deal via a shared company; finance reaches a deal; marketing reaches an invoice; CRM query reaches a ticketing node; ticketing query reaches a CRM node |
| S9.3 | `run_cypher.py`: read-only, timeout, sanity signals, one repair; facts include last graph sync time |
| S9.4 | `examples/cypher.yml` (~30): who touched deal X; brand → stores with deals; contact → company → open deals; what the last meeting on deal X committed or objected to; quote → order → invoice chain; contract → renewal deal; refusals ("stage path of deal X" → not stored) |
| S9.5 | `kg_executor/agent.md`: relationships and paths only; numbers come from SQL |
| S9.6 | Deep depth in the orchestrator: review call, one follow-up round, `flow_bridge`, playbook injection |
| S9.7 | 15 deep tests: why win rate dropped, why pipeline is down, why deal X was lost, why invoice Y is unpaid, which accounts risk not renewing; check grounded numbers and correct refusals where inputs are missing |

**SQL vs KG split:**

| Question | Executor |
|---|---|
| Lost reasons this quarter | SQL |
| Deals that slipped past expected close | SQL |
| Overdue invoices by company | SQL |
| Who touched this deal; what the last meeting committed to | KG |
| All deals, quotes, invoices across a brand and its stores | KG for the structure, SQL for the numbers |
| Why did we lose deal X | KG evidence + SQL `lost_reason` |
| Why is win rate down | SQL (change and segments) + KG (named-deal evidence) |

### Phase 10 — Hardening

| ID | Goal |
|---|---|
| S10.1 | Performance: context budgets per call, prefix-cache ordering (static prompt → tenant and role blocks → per-turn blocks → message), timing per depth on the golden DB |
| S10.2 | `docs/ARCHITECTURE_EXPLAINED.md` in the style of the ticketing guide |
| S10.3 | Security pass: run the access and guard packs; confirm B4 columns appear in no view; confirm no `rpt` view exposes transcript text or email bodies; confirm cross-org isolation in Postgres and Neo4j; confirm b2c gate |

---

## Appendix A — `CLAUDE.md` (paste as the file)

```markdown
# CRM Reports & Analytics agent — project rules

Build per docs/DECISIONS.md and REPORTING_V2_DESIGN.md.

## Locked
- Currency: deal currency follows the app's amountCurrency rule (docs/DECISIONS.md, Section 4). Totals grouped by currency, never mixed, no FX.
- UTC only; weeks Mon–Sun.
- Certified KPIs are mandatory for catalogued numbers (run_kpi). Free SQL only for lists and lookups.
- The LLM writes SQL/Cypher; Python validates, scopes and runs it. Python computes all math.
- SQL touches only rpt.* views. Graph touches only CRM labels and allowlisted edges. Executors never call each other.
- Role and user id come from the session, never from the question. Missing user id => no rows.
- Read-only everywhere. Never expose secrets, tokens, bank details, transcript text or email bodies.
- Unavailable KPIs are refused with their missing_input message; never approximate.

## Working rules
- Start every session by reading CLAUDE.md and docs/PROGRESS.md.
- Never cat a file over 300 lines; use grep/sed slices and docs/crm/tables/*.
- One session = one deliverable group. End by running its check, appending a handoff to docs/PROGRESS.md, and committing "S<id>: <what>".
- Structural facts come from inventory/ (generated). Do not invent columns, enums, labels or edges.
- Prompts: role -> method -> output contract -> examples. Fix failures with examples, not new rules.
```

## Appendix B — Ticketing files reused

Expected mapping (S1.5 confirms): `db`, `time`, `errors`, `facts`, `analysis`, `grounding`, `examples` → reuse or light adapt; `sql_guard`, `views`, `access`, `run_kpi`, `templates` → adapt; ticketing-specific logic → rewrite.

## Appendix C — View scope predicates

See Section 3.6. Missing `user_id` on any OWN role → the scoped CTE evaluates to `WHERE false`. Columns removed for every role: B4 list.

## Appendix D — Proposed table tiers (S3.1 confirms)

- **Tier A (SQL views):** `crm.companies`, `company_locations`, `contact_profiles`, `deals`, `deal_activities`, `contact_activities`, `appointments`, `quotes`, `quote_lines`, `sales_orders`, `order_lines`, `proposals`, `invoices`, `invoice_lines`, `contracts`, `contract_billing_schedules`, `payment_gateway_events`, `product_offers`, `product_addons`, `price_books`, `org_finance_settings`; `accounts.organizations`, `setup_users`, `setup_roles`, `setup_user_product_access`; `cdp.customer_profile`, `cdp.identity_keys`; `inventory.products`.
- **Tier K (graph evidence):** `meeting_analyses`, `meeting_assist_sessions`, `meeting_transcript_chunks`, `coaching_insights`, `lead_summaries`, `audit_logs`, `process_confirmations`.
- **Tier B (agent-ops):** `lead_enrichment_jobs`, `lead_scoring_jobs`, `lead_nurture_jobs`, `lead_lifecycle_jobs`, `email_auto_reply_jobs`, `agent_step_events`, `org_assignment_settings`, `sales_user_assignment_profiles`.
- **Tier C (excluded):** integrations and secrets, caches and fingerprints, SEO, proposal corpus, prospecting and research providers, templates, notifications, briefings, privacy requests, agent memories, report snapshots, and `cdp`/`accounts` tables CRM does not use.

## Appendix E — Assumptions and open items

1. **Marketing / SEO in v1?** Assumed no (L7). If yes, add a phase for `rpt.seo_*` views and a marketing section in doc 03.
2. **Resolved cells** in Section 5.4; tell me if any should change.
3. **Currency edge cases** (Section 4.3 cases 10–12) are assumptions until S1.6 reads the app code.
4. **Channel scope** on deals, quotes and invoices, and whether expansion is one level or recursive: S1.3 decides from code.
5. **Shared core** across products: copy-then-diverge (L6); revisit after CRM v1 is stable.
6. **Quote decision timestamp:** only `accepted_at` is known; rejected quotes fall back to `updated_at`, flagged approximate, unless S1.1 finds another column.
7. **Snapshot trends** are not in v1; optional v1.1 writes nightly `report_snapshots` to allow "pipeline vs last month".
