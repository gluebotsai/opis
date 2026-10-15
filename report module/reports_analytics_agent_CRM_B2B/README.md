# CRM reports & analytics agent

**Folder:** `reports_analytics_agent_CRM_B2B`

This pack is a **read-only** assistant on top of your CRM warehouse (Postgres) and commercial graph (Neo4j). A sales or ops user asks in plain English. The agent returns numbers from certified metrics, lists of records, or a short explanation from the graph. It does **not** write to CRM.

Hand this folder to the CRM product as the reporting spoke. Your product UI only needs to send **org id, user id, role, and the question**, then show the answer.

---

## What the user gets

| They ask… | What happens |
|---|---|
| How many / how much / by owner / this month | Certified **KPI** from Postgres (`run_kpi`) |
| List / find / show “expansion”, “Orange” | Free SQL with name match (`ILIKE`) |
| Why / compare / blocking / 360 on an account | **SQL for the number** (if needed) **and Neo4j** for the story |

Answers are grounded in query rows. The agent must not invent pipeline or revenue.

---

## How one question runs

```text
User question + identity (org, user, role)
        │
        ▼
   Domain agent          ← understands the question, does not write SQL
   (plan JSON)
        │
        ├── SQL executor → Postgres  (counts, money, lists)
        └── KG executor  → Neo4j     (why, 360, path, stall)
        │
        ▼
   Domain briefing       ← CEO-style answer from facts only
```

There is **no keyword router**. Domain plans from meaning. Python binds time, org, and role, then guards SQL/Cypher as read-only.

**Demo UI (not the product):** `test_streamlit/crm_b2b/` — `turn.py` is the one-turn API you can copy.

---

## What to send from CRM product

Trusted session only (never from the chat box):

| Field | Example | Notes |
|---|---|---|
| `organization_id` | `1003` | Tenant |
| `user_id` | `1017` | Logged-in user |
| `role` | `admin` | See roles below |
| `question` | `"How many open deals?"` | Natural language |

Call `run_turn(...)` in `test_streamlit/crm_b2b/turn.py` (or the same flow in your backend). Return `answer` to the UI. `trace` is for debugging.

---

## Roles (who sees what)

| Role | Default view |
|---|---|
| `admin`, `sales_manager`, `finance` | Whole org |
| `sales_rep`, `presales`, `marketing`, `viewer` | **Own** rows only |

**“Revenue” by role (unless they say won / collected / pipeline / AR):**

- Sales / manager → **booked** (`won_revenue` on closed-won deals)
- Finance → **collected** (paid invoices)
- Admin “revenue” with no qualifier → **both**, labeled, **never added**

Config: `product/access.yml`.

---

## Objects (do not mix)

| User says | Warehouse view | Examples |
|---|---|---|
| Deals / opportunities / pipeline | `rpt.deals` | Open deals, win rate, pipeline $ |
| Leads | `rpt.contacts` where `contact_type = 'lead'` | Lead count, unassigned, status mix |
| Contacts (people) | `rpt.contacts` | List/find by name; not `lead_count` |
| Quotes | `rpt.quotes` | Open quote value, acceptance |
| Invoices / AR | `rpt.invoices` | Outstanding, collected, overdue |
| Activities / tasks | `rpt.activities` | Volume by type, open tasks |
| Contracts | `rpt.contracts` | ARR, renewals |

“How many **leads**” is **not** deal count and **not** every contact. A lead is `cdp.customer_profile.contact_type = 'lead'` on `rpt.contacts`. Unassigned is only if they said unassigned. Sales reps see leads they **own** (`owner_user_id`).

---

## Certified metrics (Postgres)

Templates live in `product/sql/<kpi_id>.sql`. Catalog: `product/kpis.yml`.

**Deals / pipeline:** total opportunities, active (open) opportunities, total & weighted pipeline, won/lost count & revenue, win rate, average deal size / probability / aging, high-probability deals, new pipeline this month, sales velocity, pipeline by stage / owner, win-loss split, aging bands, deal size bands, lost reasons, won revenue trend, top open opportunities, expected close value.

**Leads:** lead count, status mix, unassigned leads, lead source conversion — each restricted to `contact_type = 'lead'`.

**Quotes / commercial:** quote acceptance, open quote value, average discount.

**Touch:** activity volume, days since last touch, open tasks, meeting completion.

**Finance / contracts:** invoice outstanding, overdue, collected revenue, approval queue, contract ARR, renewal book, product revenue, attach rate.

**Other:** territory performance, customer retention, agent operations (CRM **jobs**, not talk time), forecast vs target (pipeline vs empty quota).

Most KPIs can slice by **owner, stage, company, industry, month** (see `allowed_dimensions` in `kpis.yml`). Time phrases Python understands: today, last 7/30 days, this month, August 2026, `YYYY-MM-DD to YYYY-MM-DD`, or all time.

**Find by name:** list/find/fetch uses `ILIKE '%name%'` on titles, companies, owners, contacts — not exact `=`.

---

## Graph (Neo4j) — why and 360

Used when the user wants **explanation**, not only a total.

Typical walks:

`Account → Deal → Quote → Invoice → Contract`  
plus contacts, activities, BANT, lost_reason, forecast stall.

Examples: why we lost; why more email than meetings; why unassigned; 360 on **Orange**; what is blocking a deal.

The graph **explains rows**. Certified **counts and money** still come from SQL.

---

## What we cannot answer (honest refuse)

CRM does not store these, so the agent says so instead of guessing:

| Ask | Why not |
|---|---|
| Quota / target attainment | No monthly rep targets |
| Stage conversion / time in stage | No stage history |
| Won-reason mix | No `won_reason` (lost_reason exists) |
| Email open rate | No open/click events |
| Campaign ROI | No spend / attribution chain |
| Sequence compliance | No sequence tables |

---

## Money words (product copy)

| User language | Metric |
|---|---|
| Pipeline / open pipeline | `total_pipeline` |
| Won / booked / closed-won $ | `won_revenue` |
| Collected / paid invoices | `collected_revenue` |
| Outstanding / AR | `invoice_outstanding` |

Do not add booked + collected.

**Data quality:** many live deals have **amount 0**. Pipeline can look like one priced deal. That is warehouse data, not a bug. The briefing should say so.

---

## Folder map (for engineers)

```text
reports_analytics_agent_CRM_B2B/
  domain/agent.md          # Plan + briefing
  sql_executor/agent.md    # run_kpi or SELECT
  kg_executor/             # Cypher planner, templates, Neo4j
  skills/                  # Split instructions (KPI catalog, money, KG jobs, …)
  product/                 # kpis.yml, schema.yml, access.yml, sql/*.sql
  core/                    # Time, views, sqlglot guard, run_kpi / run_sql
  tests/
```

Python: bind dates and tenant, **sqlglot** on SQL, Cypher parse on graph. Do not paste user text into SQL strings.

Demo: Streamlit under `test_streamlit/crm_b2b/`. Env: Postgres + Neo4j + Gemma URL (see existing `.env`).

---

## Integrating in CRM product

1. Copy this pack; keep `product/` as the source of truth for metrics and roles.
2. Your chat backend calls the same turn as Streamlit (`organization_id`, `user_id`, `role`, `question`).
3. Show `answer` (markdown). Optionally show tables from `rows`.
4. Do **not** let the browser pick `role` or `org_id`.
5. New metric → add `kpis.yml` + `product/sql/<id>.sql`, then validate. Do not teach the LLM ad-hoc SQL for a certified KPI.
6. New “why” behaviour → examples in Domain / KG **skills**, not a giant if/else on the question.

---

## Quick test questions

- How many deals are there?
- How many open deals by owner?
- What is the total pipeline?
- How many unassigned leads?
- Why are there unassigned leads?
- Why is email activity higher than other types?
- 360 on Orange
- Find open deals named expansion
- What is won revenue? / Collected revenue? (admin should label both if they only say “revenue”)

If a number looks wrong, check CRM amounts and invoice **status** (draft is not outstanding) before changing the agent.
