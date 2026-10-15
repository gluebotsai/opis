# Context Layer validation report

**Date:** 2026-09-20  
**Scope:** AI_CHAT wiring + read-only ClickHouse `web_tracking` vs Context Layer `http://192.168.11.25:8765`  
**Tenant:** organizationId 1003, userId 1019  
**Sites:** website_id 1001 (beta.worktual.co.uk), 1011 (booxoo.co.uk)  
**Raw log:** `docs/CONTEXT_LAYER_VALIDATION_AUDIT.json`  
**Harness:** `scripts/context_layer_validation_audit.py` (SELECT + POST only)

## Verdict

**Go for entitled `(organizationId, websiteId)` pairs** after the 2026-09-20 multi-tenant amendments. Site **1001** under org **1003** Tier-1 counts match ClickHouse. Site **1011** lives under org **1012** (not 1003); cross-tenant requests return `website_not_entitled` instead of silent zeros. `online_visitors` is certified webtracking. Month pill is calendar unless `WEBTRACKING_MONTH_ROLLING=1`.

---

## Trace-back (wiring)

| Check | Result |
|---|---|
| JWT `organization_id` + `sub` → agent | Pass |
| Slice `webtracking.analytics` / `webtracking.insights` | Pass |
| Semantic body structured only | Pass (no `query` / `instruction`) |
| Agent known SQL / visitor SQL / LLM SQL gated | Pass |
| `shared/analytics_metrics.py` not used by agent | Pass |
| `live_web_tracking_folder_2` not edited | Pass |
| Dashboard `analyticsRepository` not edited | Pass |
| Insights `metrics[]` empty; no semantic | Pass |

Restart AI_CHAT so `CONTEXT_LAYER_URL=http://192.168.11.25:8765` is loaded.

---

## ClickHouse vs semantic

Corrected ClickHouse periods use `dashboard_period` (the first JSON dump used question=`overall`, which forced all-time CH). Semantic values are from the live API with `filters: website_id`.

### Website 1001

| Period | Metric | ClickHouse | Semantic | Verdict |
|---|---|---|---|---|
| today | unique_visitors | 1 | 1 | Match |
| today | web_session_volume | 1 | 1 | Match |
| today | page_views | 1 | 1 | Match |
| today | bounce_rate | 100 | 100 | Match |
| today | total_clicks | 0 | 0 | Match |
| week | unique_visitors | 40 | 40 | Match |
| week | web_session_volume | 57 | 57 | Match |
| week | page_views | 61 | 61 | Match |
| week | total_clicks | 423 | 423 | Match |
| week | bounce_rate | 48.15 | 46.43 | Review (percent, ~1.7pt) |
| month | unique_visitors | 122 | 95 | Fail — rolling 30d vs calendar month |
| month | web_session_volume | 267 | 205 | Fail |
| month | page_views | 473 | 381 | Fail |
| overall | unique_visitors | 122 | 121 | Match (off-by-one) |
| overall | web_session_volume | 267 | 266 | Match |
| overall | page_views | 473 | 471 | Match |
| overall | bounce_rate | 42.58 | 42.58 | Match |
| overall | total_clicks | 2086 | 2085 | Match |
| overall | online_visitors | 0 | 400 error | Fail — product `contact_centre` |

### Website 1011

**Correction (2026-09-20 re-audit):** `website_id=1011` **is present** in `webtracking_marts` under **`organization_id=1012`** (17 sessions / 7 visitors), matching raw `dim_sessions`. It is **not** owned by organization 1003.

Semantic with JWT org **1003** + `websiteId=1011` must return structured error **`website_not_entitled`** (not HTTP 200 with zeros). Querying as org **1012** + `websiteId=1011` returns non-zero KPIs.

Unfiltered org-1003 volume ≈ site 1001 only because that is the only site entitled to org 1003 in `mart_web_sites`.

### Dimensions (1001)

- `group_by country` ≈ CH (blank 147, IN 103, US 16–17)
- `group_by device` ≈ CH (desktop 245–246, mobile 21)
- `group_by page_path` ≈ CH (`/` 181)
- `group_by referrer_domain` ≈ CH
- Filter `country=IN` on sessions = 103; on unique_visitors = 38
- Filter `device=mobile` on unique_visitors → **400** (dim not allowed)
- `group_by` + two metrics → **502** (“one metric at a time”)

---

## Agent harness (10 sessions, 30 turns)

Classification: **22 tool_ok**, **4 unsupported_ok**, **1 missing_filter**, **1 agent_crash**, **2 agent_refused_wrongly**.

| Session | Site | Notes |
|---|---|---|
| s1 KPI pills | 1001 | Correct metric ids, `time.period`, `website_id` |
| s2 Follow-ups | 1011 | Tools correct; answers empty because marts lack 1011 |
| s3 Geo | 1001 | India → `country=IN` OK; Chennai → `country=chennai` (should be city) |
| s4 Device | 1011 | Linux/desktop filters OK; mobile sent `unique_visitors`+`device` → 400 |
| s5 Traffic | 1001 | UTM question grouped `referrer_domain` (not `utm_source`) |
| s6 Rankings | 1011 | `page_path` OK; top visitors dual-metric + `visitor_id` → 502 |
| s7 Multi-metric | 1001 | sessions + page_views week OK (no group_by) |
| s8 Tier-2 | 1001 | rage/dead/form/revenue called; LCP crashed dashboard builder; JS errors unmapped |
| s9 Drill-down | 1011 | No semantic (correct) |
| s10 Control | 1001 | Greeting/off-topic OK; “who is online” not mapped |

Insights slice: agent `webtracking.insights`, **0 metrics**, no semantic.

---

## A. Ontology — additions and reductions

**Already good:** visitor ≠ session ≠ page view; one-website rule; Insights subset + empty metric grant; data-only YAML injected as-is.

**Add**

1. City / place aliases (Chennai → `city`, not `country`).
2. Online-visitor wording so “who is online right now” maps to `online_visitors` (once semantic owns it).
3. Error synonyms (“JS errors”, “JavaScript errors”) → `error_count`.
4. Explicit rule: visitor/session **profiles are not certified KPIs**.
5. Form identifier (`form_id`) on form funnel questions.

**Reduce / clean**

1. Do not grant `online_visitors` to `webtracking.analytics` until it is a webtracking metric (or fix ownership).
2. Insights does not need KnownUser / Interaction / full commerce entities.
3. Slice prompt is large (~10.6k / ~7.1k); keep data-only, avoid duplicating entity blocks.

---

## B. Semantic layer — metrics and dimensions

**Enough for 1001 dashboard-style chat:** volume, visitors, page views, bounce (percent), clicks, conversions, new/returning, engagement rates, rage/dead clicks, form abandon, revenue, LCP, country/device/page/referrer breakdowns.

**Must fix or add (Context Layer / dbt — not this repo)**

1. ~~Build marts for every `website_id` (1011)~~ — **resolved:** 1011 is under org 1012; entitlement errors replace silent zeros.
2. **Month pill** = enable `WEBTRACKING_MONTH_ROLLING=1` for rolling 30d, or keep calendar and document in UI.
3. ~~`online_visitors` as webtracking certified~~ — **done.**
4. ~~`city` / `region` / `device` on `unique_visitors`~~ — **done** (session-grain dims).
5. Enforce **one metric** when `group_by` is set (agent should split calls).
6. **`utm_source`** group_by when the user says UTM (not only referrer_domain).
7. **`average_order_value`** with revenue in multi-ask.
8. ~~Bounce week drift~~ — **aligned** to `v_session_bounce` (≤0.5pp for qualifying pairs).

---

## Go / no-go

- **Go** for any `(organizationId, websiteId)` pair present in `webtracking_marts.mart_web_sites` (and matching JWT org), with `websiteId` **required** on semantic.
- Cross-tenant `websiteId` → **`website_not_entitled`** (not silent zeros).
- **Conditional** only on month pill until `WEBTRACKING_MONTH_ROLLING=1` is enabled in the deploy env (rolling 30d vs calendar).
- `online_visitors` is a certified webtracking CH template metric.

Do not re-enable agent ClickHouse SQL. Do not apply DB writes from this audit.
