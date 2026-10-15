# Campaign metrics, KPIs, and the SQL agent

Reports and analytics for Campaign should be handled by a **SQL agent**: a read-only planner that turns a question + caller identity into **allowlisted SELECT** (or an equivalent semantic query), then returns numbers the UI/chat can show.

This note has three layers of “role”:

1. **User RBAC** — who is allowed to see which rows (`admin` vs everyone else)
2. **Job-role KPI packs** — which metrics a CMO vs campaign manager vs analyst vs channel owner typically needs
3. **SQL metric roles** — fact vs dimension vs numerator vs denominator vs filter

Sources for **today’s formulas:** `backend/src/dao/campaign-metrics.ts`, `backend/src/dao/portfolio-metrics.ts`, reports `org_context.py`. Contact listing today: `agents/app/agents/contacts/contact_sql_agent.py` (CDP SELECT only — not campaign KPIs).

---

## What exists today vs what the SQL agent is for

| Today | SQL agent (expected) |
|-------|----------------------|
| Dashboard / `LIST_MONITOR_CAMPAIGNS` totals from Python/TS aggregating campaign list + recipient rows | Same formulas, expressed as parameterized SQL (or semantic metrics that compile to that SQL) |
| `query_analytics` / semantic gateway `/ask` (`product=campaign`) then allowlisted `POST /api/analytics/ask` | SQL agent is the **system of record** behind that ask: listing, fetching, grouping |
| `GET_CAMPAIGN_REPORT` / `GET_CAMPAIGN_AUDIENCE` | One-campaign and per-recipient breakdowns via SQL |
| Contact **view** SQL agent: `SELECT` on `cdp.customer_profile` + `identity_keys` | Keep for people search; **join** to campaign facts when the question is “who opened” |
| `ask_ontology` | **Not** SQL. Themes and “similar past campaigns”. SQL agent must not fake graph answers |
| Daily report email | Same KPI catalog, period = previous calendar day in recipient timezone |

The SQL agent **must not** INSERT/UPDATE/DELETE. Audience freeze and sends stay on product tools.

---

# Standard method (industry + this product)

Unless a metric says otherwise:

- **Tenant filter:** `organization_id = :org` on every campaign fact. Never cross tenants.
- **Time:** Dashboard and agents use **launch calendar date in campaign `timezone`** (default `Asia/Kolkata`), not UTC send timestamp, unless the user asks for sent-at time.
- **Ran campaigns:** status `live`, `completed`, or `cancelled` (draft/scheduled are not “ran”).
- **PPC-only campaigns** are excluded from messaging headline KPIs when Dashboard does (`excludePpcOnly`).
- **Delivered (denominator for rates):** accepted real sends, **excluding** bounces and **stub** sends (`provider_message_id` starting `stub-` / `stub://`, or status `stub` / `stub_sent`).
- **Unique opens:** recipients with `opened_at IS NOT NULL` (first open). `open_count` is total hits (including repeats).
- **Unique clicks:** `clicked_at IS NOT NULL`. `click_count` is total hits.
- **Open rate:** unique opens / delivered, **email only** (push/web do not track opens). Cap at 100%.
- **Click rate:** unique clicks / delivered on **email, app push, web push**. Cap at 100%.
- **CTOR:** unique clicks / unique opens (email). Null if opens = 0.
- Rates are stored internally as 0…1 fractions; UI/agent display is one decimal percent (`open_rate_pct`).

Recipient status mapping (`recipientDeliveryOutcome`):

| status (lowercase) | Outcome |
|--------------------|---------|
| `failed`, `cancelled` | failed |
| `skipped` | skipped (not failed volume) |
| `stub`, `stub_sent` | stub (not delivered) |
| `pending`, `queued`, `sending`, empty | pending |
| `sent`, `delivered` | sent if not stub provider id |
| `bounced`, `hard_bounce`, `soft_bounce` | bounce (also if `skip_fail_reason` looks like bounce) |

---

# Metric catalog

Each metric has a **SQL role**: fact (count from rows), ratio (num/den), dimension (group by), filter.

## Portfolio / Dashboard KPIs

These match `PortfolioTotals` / `PORTFOLIO_KPI_GLOSSARY`.

| Metric | SQL role | Standard method | Default dimensions | Notes |
|--------|----------|-----------------|--------------------|--------|
| `campaigns` | fact | Count campaign rows in the filtered set | period, status, channel, creator | All statuses unless filtered |
| `campaigns_ran` | fact | Count campaigns with status in (`live`,`completed`,`cancelled`) | period, channel | Dashboard headline |
| `live_count` / `scheduled_count` / `completed_count` / `draft_count` | fact | Count by `campaigns.status` | period | Monitoring tabs |
| `messaging_campaigns` | fact | Ran campaigns that are not PPC-only | period | |
| `campaigns_with_send` | fact | Ran campaigns with ≥1 **delivered** message | period, channel | Dashboard **Sent** KPI is this **count of campaigns**, not message volume |
| `campaigns_with_failure` | fact | Ran campaigns with ≥1 failed recipient | period, channel | Dashboard **Failed** KPI is campaign count |
| `sent` (volume) | fact | Count delivered messages (see delivered) | period, channel, campaign, variant | Glossary: volume, not campaign count |
| `failed` (volume) | fact | Count failed recipients | period, channel, campaign | |
| `stub_sent` | fact | Stub deliveries | period, channel | Exclude from delivered |
| `delivered` | fact | sent volume minus bounces minus stubs | period, channel, campaign, variant | Rate denominator |
| `opens` | fact | Unique openers (`opened_at` not null) on open-tracked channels | period, campaign, variant | Email |
| `clicks` | fact | Unique clickers on click-tracked channels | period, campaign, channel, variant | email, push, web |
| `total_opens` / `total_clicks` | fact | Sum of `open_count` / `click_count` | same | Repeat engagement |
| `open_rate` | ratio | `opens / delivered` on email | period, campaign, variant | Null if delivered=0 |
| `click_rate` | ratio | `clicks / delivered` on tracked channels | period, campaign, channel, variant | |
| `ctor` | ratio | `clicks / opens` | period, campaign, variant | Email |
| `impressions` / `spend` / `conversions` | fact | From `launch_plan.channel_run` (PPC/ads) when no live ad table | campaign, channel | Not recipient-based today |

### Channel rollup

Group `campaign_send_recipients` ⋈ `campaign_send_batches.channel` (or recipient’s batch channel):

| Metric | Method |
|--------|--------|
| `channel_rollup[].sent/failed/delivered/opens/clicks` | Same as above restricted to that channel |
| `channel_rollup[].campaigns` | Distinct ran campaigns that include that channel |

Agent-canonical channels: `email`, `whatsapp`, `sms`, `push`, `web`, `ppc`, …

---

## One-campaign KPIs

Same formulas, `WHERE campaign_id = :id`. Extra:

| Metric | SQL role | Method | Dimensions |
|--------|----------|--------|------------|
| `selected` | fact | Audience size: `campaigns.audience_count` or count `campaign_audience` / pending recipients | channel |
| `email_sent` / `email_opens` / `email_clicks` | fact | Channel = email slice | variant |
| `ab_variant` performance | fact/ratio | Filter `ab_variant IN ('a','b','holdout','winner')` | variant |
| Audience sent vs missed | fact | Recipients `sent` vs audience ids with no successful send | channel, reason (`skip_fail_reason`) |

---

## Email health / compliance (needed for ops reports)

| Metric | Method | Dimensions |
|--------|--------|------------|
| Bounce rate | bounces / (sent + bounces) or bounces / attempted | campaign, period, domain |
| Complaint / unsub count | `email_suppressions` by `reason` | period, reason |
| Suppression hits skipped | recipients `skipped` with unsub reason | campaign |
| Cap utilization | batches size vs `email_sending_caps` hourly/daily | org, hour |
| Domain auth | `email_domains.spf_ok/dkim_ok/dmarc_ok` | org, domain |

---

## Push / web / WhatsApp / SMS (needed even if tracking is thinner)

| Metric | Method | Notes |
|--------|--------|--------|
| Push delivered | recipient sent on `channel=push`, not stub | Opens usually N/A |
| Web push delivered | `channel=web` | Clicks if tracked |
| WhatsApp sent/failed | batches `channel=whatsapp` | Template status is not a send KPI |
| SMS sent/failed | when batches exist | DLT template approval is separate |
| Website visitors / subscribers | `website_contacts` counts | `subscribed`, visits |
| Form conversion | `submission_count` / `open_count` on opportunity | Event, period |
| Form submissions | count `campaign_form_submissions` | event, day |

---

## Contact extras (exists today + expected)

**Today (contact SQL agent):** list/filter people from CDP with org + not deleted:

- Identity: email/phone present
- Profile: name, company, city
- `custom_fields`: job_title, segment, score, industry, etc.

**Expected joins for reporting SQL agent:**

| Question | Join |
|----------|------|
| Who was in campaign X? | `campaign_audience` → `customer_profile` |
| Who was sent / opened / clicked? | `campaign_send_recipients` → profile + identity |
| Who is unsubscribed? | `campaign_contact_engagement` / `email_suppressions` |
| Who can get app/web push? | `push_endpoints` active |
| Website-only people | `website_contacts` where `contact_id` is null |

SQL agent must not return other tenants’ contacts. Always `organization_id` on both campaign and CDP sides.

---

# Dimensions (GROUP BY)

Use these consistently. Combinations must still filter `organization_id`.

| Dimension | Column / expression | Typical use |
|-----------|---------------------|-------------|
| Organization | `organization_id` | Always in WHERE, rarely in SELECT for a single tenant |
| Branch | `campaigns.branch_id` | Multi-branch later |
| Creator | `campaigns.created_by_user_id` | Admin may group; **employee role cannot ask SQL for other people if product still lacks per-employee API** — see RBAC |
| Campaign | `campaign_id`, `campaigns.name`, `status` | One-campaign and lists |
| Channel | `campaign_send_batches.channel` / `campaign_channels.channel` | Rollup |
| Variant | `ab_variant` | Email A/B |
| Period | `campaigns.launch_local_date` (preferred) or `scheduled_for::date` at timezone | Dashboard buckets |
| Status | `campaigns.status` | Tabs |
| Recipient status | `campaign_send_recipients.status` | Ops |
| Contact attrs | city, company, custom_fields keys | Audience analytics (future) |
| Event | `event_public_id` / `form_slug` | Forms |
| Template | `regulated_channel_templates.id` / library id | Content ops |

**Period presets** the agent must understand: `last_7_days`, `last_30_days`, today, custom `from_date`/`to_date`, dashboard `bucket=all` with the Overview window. Align with IST launch date unless asked otherwise.

---

# 1) User RBAC (how to calculate **for whom**)

From `accounts.setup_roles.name` via session (`org_context.py`):

| Role name | `data_scope` | How SQL must filter |
|-----------|--------------|---------------------|
| `admin` | `org` | All campaigns in the org/branch. Totals are **branch-wide**. Do not label them “your campaigns”. Per-named-employee breakdown is **not supported today** — do not fake it with SQL unless product adds it. |
| Any other role (`marketing`, `user`, …) | `mine` | `campaigns.created_by_user_id = :user_id`. Lists and KPIs are **this user’s campaigns only**. Say “your campaigns”. |

**SQL agent rules:**

- Bind `:organization_id` from the JWT/session, never from user text.
- Bind `:created_by_user_id` when `data_scope=mine`.
- Do not expand scope because the prompt said “company-wide” unless the caller is admin.
- Contacts: still org-scoped; “my contacts” is the org CDP, not created_by (CDP profiles are not owned per user today).

---

# 2) Job-role KPI packs (what to compute **for which job**)

These are **default metric sets**, not extra database roles. The SQL agent should pick a pack from the question + user job if known; otherwise use Dashboard pack.

### Campaign operator / campaign manager

List campaigns; one-campaign sent/failed/delivered; audience selected vs sent; channel mix; schedule vs live; A/B a vs b; stop/resume is **not** SQL (recovery tools).

### Channel owner (email / WA / push)

Filter to one `channel`; delivered, failed, bounce; email: open, click, CTOR, unsub; WhatsApp: sent/failed + template approval counts; push: delivered + active endpoints.

### Analyst / Past analyst

All Dashboard ratios; group by period and channel; campaign list with rates; **handoff to ontology** for “why / similar ideas”. SQL returns tables; ontology returns graph language.

### CMO / org admin

`campaigns_ran`, `campaigns_with_send`, `campaigns_with_failure`, portfolio open/click, channel_rollup, period comparison. Branch-wide (`data_scope=org`).

### Compliance / deliverability

Suppressions, bounce/complaint, domain auth flags, cap/health_status. No marketing vanity rates as the headline.

### Forms / growth

Opportunity open vs submit rate; submissions over time; optional join email in answers (careful with PII in logs).

---

# 3) SQL construction roles (how to write the query)

When compiling a metric:

| Role in the query | Meaning | Example |
|-------------------|---------|---------|
| **Fact table** | Grain of the number | `campaign_send_recipients` for send KPIs; `campaigns` for campaign counts; `customer_profile` for people lists |
| **Dimension table** | Group/filter attributes | `campaigns`, `campaign_send_batches`, `customer_profile` |
| **Numerator** | Count/sum in the rate | `COUNT(*) FILTER (WHERE opened_at IS NOT NULL)` |
| **Denominator** | Delivered (or opens for CTOR) | delivered expression above |
| **Filter** | WHERE | org, period, mine, channel, not stub |
| **Window** | Rank/compare | period-over-period (future) |

**Forbidden:** dividing unique opens by **selected** audience (inflates poorly). Product standard is **delivered**.

**Listing vs aggregating:**

- Listing: `SELECT` campaign/contact/recipient rows with `LIMIT`, stable `ORDER BY`
- Fetching one entity: `WHERE id = :id` plus org (and creator if mine)
- Aggregating: `GROUP BY` dimensions the user asked for; never mix grains in one unlabeled result

---

# SQL agent responsibilities

## Must do (all questions)

1. Identify **intent**: list, fetch one, aggregate KPI, contact extra, or “this is ontology — refuse SQL”.
2. Identify **entities** (Campaign, Recipient, Contact, Event, Template, …).
3. Apply **org** and **RBAC** binds.
4. Apply **period** and **channel** filters from the question or dashboard context.
5. Use **this catalog’s formulas**; return both raw fractions and `*_pct` / `*_display` when rates.
6. Return **grain** in the payload (`campaign` vs `channel` vs `recipient` vs `contact`).
7. Cap rows (contacts today max 500; reporting lists should use an explicit LIMIT).
8. One statement, SELECT only. No `INTO`, no multiple statements.

## Listing (expected)

| List | From | Filters |
|------|------|---------|
| Campaigns | `campaigns` + optional metric join | status bucket, period, channel, mine |
| Recipients of a campaign | `campaign_send_recipients` | status, channel, variant |
| Audience of a campaign | `campaign_audience` ⋈ CDP | |
| Contacts | CDP + identity (existing agent) | city, email present, custom_fields |
| Events | `campaign_opportunity_events` | status |
| Submissions | `campaign_form_submissions` | event, date |
| Suppressions | `email_suppressions` | reason |
| Templates | library / regulated | channel, status |

## Fetching (expected)

| Fetch | Key |
|-------|-----|
| One campaign + channels + launch | `campaigns.id` |
| One campaign KPI | same + recipient aggregate |
| One contact + identities + engagement | `cdp_id` |
| One event + recent submissions | `public_id` / slug |
| One batch | `campaign_send_batches.id` |

## Contact extras (expected)

- Exists today: filtered contact **view** SQL.
- Add: last campaign sent, last open/click (`campaign_contact_engagement` + latest recipient), unsub flag, reachable channels (email identity, phone, push endpoint, web subscribe).
- Never dump `password_hash`, DKIM private keys, OAuth tokens, API `key_hash`.

## Must not do

- Mutate send/audience/template rows
- Answer ontology/theme questions with invented SQL
- Return other orgs
- Treat stub sends as delivered
- Treat Dashboard “Sent” as message volume (it is **campaigns_with_send** unless the user asked for volume)
- Claim per-employee splits for admin aggregates (not in product today)

## Future (plan for, do not fake as live until built)

- Period-over-period and funnel (selected → sent → delivered → open → click → conversion)
- True conversion from forms/CRM, not only `launch_plan.channel_run.conversions`
- Per-creator breakdown for admin
- SMS/WhatsApp richer engagement if providers supply it
- Website visitor → campaign attribution
- Semantic metric layer as the only compiler (gateway already started)

---

# Mapping to MAS

- **Numbers:** optimization → `analytics` skill `report_kpis` → SQL agent / `query_analytics`
- **Names/lists:** `report_campaigns` / `monitoring` tools until SQL agent lists campaigns the same way
- **Graph:** `report_ontology` / `ask_ontology` — **not** this agent
- **People search:** audience `contact` / existing contact SQL agent; reporting SQL agent **joins** when the question is engagement

---

# Related files

| File | Use |
|------|-----|
| `docs/CAMPAIGN_DB_ONTOLOGY.md` | Tables and entities |
| `docs/CAMPAIGN_AGENTS_ONTOLOGY.md` | Which agent calls SQL vs ontology |
| `backend/src/dao/campaign-metrics.ts` | Live recipient math |
| `backend/src/dao/portfolio-metrics.ts` | Dashboard glossary |
| `agents/app/agents/contacts/contact_sql_agent.py` | Contact SELECT contract |
