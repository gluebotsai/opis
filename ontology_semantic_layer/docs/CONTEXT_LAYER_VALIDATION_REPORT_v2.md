# Context Layer — tier metric issues (what to change)

**Date:** 2026-09-20 (updated)  
**Who this is for:** Context Layer / dbt maintainers on `http://192.168.11.25:8765`, plus AI_CHAT mapper owners.  
**Truth:** ClickHouse `web_tracking` (dashboard recipes in `shared/analytics_metrics.py`).  
**Sites:** `1001` beta.worktual.co.uk · `1011` booxoo.co.uk  
**Tenant:** organization `1003`, user `1019`  
**This repo must not change:** `live_web_tracking_folder_2/`, dashboard KPI SQL, Context Layer YAML/dbt on the 8765 host.

## How to read this

The previous short report only listed a few 1001 pills. This file is the **full required catalog** from [WEB_TRACKING_AGENT_SEMANTIC_LAYER.md](./WEB_TRACKING_AGENT_SEMANTIC_LAYER.md).

**Evidence**

| Wave | What it proved |
|------|----------------|
| Agent audit (this evening) | Structured `POST /v1/semantic/query` with `filters.website_id`. Periods `today/week/month/overall` for **Tier 1**. Site **1011** always 0. Dimensions on 1001. |
| Catalog test (same day, earlier) | All-time values for **every required metric** on 1001. At that time `today/week` were ignored (fixed later). Bounce was a 0–1 fraction (now percent). |

**Status words**

| Word | Meaning |
|------|---------|
| OK | Chat-safe on 1001 for today / week / overall (or all-time count match). |
| Issue | Wrong number, wrong unit, 400/502, or zero when ClickHouse has data. |
| Site gap | Metric itself may be fine on 1001; **every** filtered query for 1011 is 0. |
| Not proven | API returned something but we have no dashboard SQL to compare. |

---

## Cross-cutting (hits every tier)

These are not one-metric bugs. Fix them first or every row below stays red for some customers.

| # | Issue | What the user sees | What to change | Owner |
|---|--------|--------------------|----------------|-------|
| C1 | **Marts only contain website 1001.** Unfiltered `web_session_volume` = 266. Filter `website_id=1011` = 0. ClickHouse has 17 sessions / 7 visitors on 1011. | Booxoo chat: “0 visitors” while the dashboard shows traffic. | Rebuild / include **all** `website_id`s in `webtracking_marts` (or whatever feeds semantic). Verify 1011 rows exist, then re-run filters. | Context Layer / dbt |
| C2 | **`month` pill ≠ dashboard month.** Dashboard = rolling last 30 days. Semantic = calendar month. 1001 visitors: CH 122 vs semantic 95. Same gap on sessions (267 vs 205) and page views (473 vs 381). | “This month” in chat ≠ KPI card. | Either change semantic `time.period=month` to rolling 30d, or change the dashboard pill and document calendar month. Pick one. | Product + Context Layer |
| C3 | **`website_id` must be on every query.** Filter works. If the agent omits it, totals are 1001-only and look “global”. | Wrong site’s numbers. | Keep agent filter (already wired). Do not treat unfiltered volume as org-wide. | Already in AI_CHAT; keep |
| C4 | **Rates: catalog says percent, older API used 0–1.** This run: `bounce_rate` overall **42.58 = 42.58**. Other rates in the catalog test were still fractions (`new_visitor_rate` 0.64 vs 64.46). | Agent may print 0.64% or 64% depending on metric. | Return **the same unit for every `*_rate`**. Prefer percent to match dashboard. | Context Layer |
| C5 | **`group_by` allows only one metric.** Two metrics + dimension → HTTP 502. | “Top visitors by sessions and page views” dies. | Document and enforce one metric per grouped call; agent should split. Optional: support multi-metric group later. | Context Layer + AI_CHAT mapper |
| C6 | **Dimension allow-lists differ by metric.** `device` is valid on sessions, **400** on `unique_visitors`. | “Mobile visitors” can 400. | Either add `device` to unique_visitors dims, or keep mapper on `web_session_volume` for device questions. | Context Layer and/or mapper |

---

## Tier 1 — dashboard KPI cards

Must match cards and pills `today | week | month | overall`. Counts must be integers (`uniqExact`, never row `count()`). Bounce must come from `v_session_bounce` (1 pageview + duration &lt; 10s) as **percent**.

### `unique_visitors`

**What it is:** Distinct `visitor_id`s. Dashboard card “Unique visitors”.

| Site / period | ClickHouse | Semantic | Status |
|---------------|------------|----------|--------|
| 1001 today | 1 | 1 | OK |
| 1001 week | 40 | 40 | OK |
| 1001 month | 122 | 95 | Issue — C2 month grain |
| 1001 overall | 122 | 121 | OK (1-row FINAL drift) |
| 1011 any period | 7 overall / 6 today | 0 | Site gap — C1 |

**Also:** `filters` or `group_by` `device` → 400 (allowed: visitor_id, country, website_id, returning flag, …). City questions must not use this metric with `country=chennai`.

**Change:** C1 + C2. Add `device` (and `city`) to this metric’s dims **or** teach the mapper to switch to `web_session_volume`.

### `web_session_volume`

**What it is:** Distinct `session_id`s. Dashboard “Sessions”.

| Site / period | ClickHouse | Semantic | Status |
|---------------|------------|----------|--------|
| 1001 today | 1 | 1 | OK |
| 1001 week | 57 | 57 | OK |
| 1001 month | 267 | 205 | Issue — C2 |
| 1001 overall | 267 | 266 | OK |
| 1011 today / week / overall | 10 / 17 / 17 | 0 | Site gap — C1 |

**Also:** `group_by` country / device / page_path / referrer_domain on 1001 ≈ ClickHouse. Filter `country=IN` = 103 sessions.

**Change:** C1 + C2 only. Recipe is good when the mart has the site.

### `page_views`

**What it is:** Count of page-load events. Dashboard “Page views”.

| Site / period | ClickHouse | Semantic | Status |
|---------------|------------|----------|--------|
| 1001 today | 1 | 1 | OK |
| 1001 week | 61 | 61 | OK |
| 1001 month | 473 | 381 | Issue — C2 |
| 1001 overall | 473 | 471 | OK |
| 1011 overall | 78 | 0 | Site gap — C1 |

**Change:** C1 + C2.

### `bounce_rate`

**What it is:** Percent of bounced sessions from `v_session_bounce` only.

| Site / period | ClickHouse | Semantic | Status |
|---------------|------------|----------|--------|
| 1001 today | 100 | 100 | OK |
| 1001 week | 48.15 | 46.43 | Issue — ~1.7pt vs view |
| 1001 month | ~42.58 (rolling) | 44.39 | Issue — C2 + recipe |
| 1001 overall | 42.58 | 42.58 | OK |
| 1011 overall | 17.65 | 0 | Site gap — C1 |

**Earlier same day:** API returned `0.407` (fraction). **Fixed** to percent on this run.

**Change:** Diff semantic bounce SQL against `v_session_bounce` for **week**. Keep percent. Then C1 + C2.

### `total_clicks`

**What it is:** `event_type = 'click'` on interaction facts.

| Site / period | ClickHouse | Semantic | Status |
|---------------|------------|----------|--------|
| 1001 today | 0 | 0 | OK |
| 1001 week | 423 | 423 | OK |
| 1001 month | 2086 | 1803 | Issue — C2 |
| 1001 overall | 2086 | 2085 | OK |
| 1011 overall | 125 | 0 | Site gap — C1 |

**Change:** C1 + C2.

### `total_conversions`

**What it is:** Goal / purchase / signup events. Dashboard conversions card.

| Evidence | ClickHouse | Semantic | Status |
|----------|------------|----------|--------|
| 1001 overall (this run) | 1 | 0 | Issue — event not in mart / wrong type |
| 1011 | (not the gap) | 0 | Site gap — C1 |

**Change:** Map conversion facts the same way the dashboard does (`fact_conversion_events`). Confirm the one CH conversion on 1001 is included. Do not treat 0 vs 1 as “close enough” in production.

### `average_session_duration`

**What it is:** Seconds. Dashboard = activity span (page views + interactions), not clock from session start to a stale end.

| Evidence | ClickHouse | Semantic | Status |
|----------|------------|----------|--------|
| 1001 all-time (catalog test) | 4018 | 3878 | Issue — ~3.5% / different recipe |
| 1001 today (agent audit, 1 session) | short / 0-ish | 0 | Weak — one session |
| 1001 week (agent audit; CH period was wrong in raw JSON) | — | 2408 | Not proven vs corrected CH |

**Change:** Copy dashboard activity-span SQL into the semantic model. Re-test today/week/month/overall on 1001 after C2. Skip unbounded overall scans in harnesses (they hang).

### `new_visitor_count`

**What it is:** Visitors with ≤ 1 session **in the selected period**.

| Evidence | ClickHouse | Semantic | Status |
|----------|------------|----------|--------|
| 1001 all-time | 78 | 77 | OK (1 drift) |
| 1001 today / week / month | Dashboard period | Semantic period | Issue if C2; today likely 1 = 1 |
| 1011 | &gt; 0 | 0 | Site gap — C1 |

**Change:** C1 + C2. Confirm “new” is period-scoped, not lifetime-first-seen, or chat will disagree with the card.

### `returning_visitor_count`

**What it is:** Visitors with &gt; 1 session in the period.

| Evidence | ClickHouse | Semantic | Status |
|----------|------------|----------|--------|
| 1001 all-time | 43 | 43 | OK |
| 1011 | — | 0 | Site gap — C1 |

**Change:** C1 + C2. Same period definition as new visitors (they must sum toward unique visitors).

### `online_visitors`

**What it is:** Distinct visitors active in the **last 5 minutes**. Real-time card / “who is online”.

| Evidence | Result |
|----------|--------|
| On `webtracking.analytics` slice | Entitled |
| `POST /v1/semantic/query` | **400** — metric requires product `contact_centre`, not `webtracking` |
| Agent “who is online right now” | Not mapped (refused / missed) |
| ClickHouse at audit | 0 (no one in the 5-minute window) |

**Change:** Implement as a **webtracking** certified metric (5-minute window on session/activity). Until then **remove it from the analytics grant** so the slice does not advertise a broken KPI. Add ontology wording so the agent maps “online now” once the metric works.

---

## Tier 1 — ranking / list intents (not single cards)

These are metric + `group_by` + ORDER BY + LIMIT. Failures here break “top pages / top countries / traffic source”.

| Intent | Need | What happened | Change |
|--------|------|---------------|--------|
| `top_pages_by_views` | `page_views` + `page_path` | 1001 works (`/` ≈ 181). 1011 empty. | C1 |
| `top_pages_by_visitors` | `unique_visitors` + `page_path` | Unique visitors dims may not include `page_path` (device already 400). | Allow `page_path` on unique_visitors **or** use sessions/page_views |
| `top_visitors_by_sessions` | `web_session_volume` + `visitor_id` | Dual-metric + `visitor_id` → **502** (C5) | One metric per call |
| `top_visitors_by_pageviews` | `page_views` + `visitor_id` | Same 502 if combined | Split calls |
| `traffic_source_breakdown` | sessions + `referrer_domain` **and** `utm_*` | Referrer ≈ CH. Agent mapped “UTM” → `referrer_domain`, not `utm_source`. Wave-1 prefixed dim names failed. | Short names `utm_source/medium/campaign`. Mapper: UTM ≠ referrer |
| `geo_breakdown` | `country`, `city`, `region` | `country` ≈ CH (blank 147, IN 103, US 16–17). Agent sent Chennai as `country=chennai`. `city` not proven on unique_visitors. | Allow `city`/`region` on session **and** visitor metrics. Ontology: city aliases |
| `device_breakdown` | `device`, `browser`, `platform` | `device` on sessions ≈ CH (desktop 245–246, mobile 21). `unique_visitors`+device = 400. | C6 |

**Visitor / session profile** (“show visitor_abc”) is **out of certified KPI scope**. Agent correctly did **not** call semantic. Do not add SQL fallback.

---

## Tier 2 — engagement

All-time 1001 from the catalog test unless noted. After C1, re-test with `website_id`.

| Metric | Meaning | CH | Semantic | Issue | Change |
|--------|---------|----|----------|-------|--------|
| `pages_per_session` | page_views / sessions | 1.774 | 1.774 | OK | None |
| `events_per_session` | all events / sessions | no dashboard SQL | 12.07 | Not proven | Publish formula + CH reference |
| `avg_time_on_page_seconds` | time on page | 45 | **0** | Engagement join empty | Fix page-timing source in semantic model |
| `avg_scroll_depth` | scroll 0–1 or % | 0.78 | **0** | Zeroed (earlier report wrongly called this pass) | Fix scroll field / join |
| `scroll_engagement_rate` | scrolled enough / views | no SQL | 0 | Not proven + likely zeroed | Define threshold + source |
| `bounce_count` | bounced sessions | 108 | 108 | OK | Keep aligned with bounce_rate |
| `clicks_per_session` | clicks / sessions | 7.84 | 7.87 | OK | None |

---

## Tier 2 — identity & loyalty

| Metric | Meaning | CH | Semantic | Issue | Change |
|--------|---------|----|----------|-------|--------|
| `new_visitor_rate` | new / unique | 64.46% | 0.642 | Unit only (C4) | Return percent **or** document fraction everywhere |
| `returning_visitor_rate` | returning / unique | 35.54% | 0.358 | Unit only | Same |
| `identified_visitor_count` | known users | 0 | 0 | OK for this tenant (no IDs) | Re-test when identified traffic exists |
| `visitor_identification_rate` | identified / unique | 0 | 0 | OK here | C4 if non-zero later |
| `identified_session_count` | sessions with user_id | 0 | 0 | OK here | Same |
| `identified_session_rate` | identified sessions / all | 0 | 0 | OK here | C4 |

---

## Tier 2 — marketing

| Metric | Meaning | CH | Semantic | Issue | Change |
|--------|---------|----|----------|-------|--------|
| `campaign_attributed_sessions` | UTM or `wt_campaign_id` | 1 | 0 | Missed the one campaign session | Align campaign predicate with dashboard |
| `campaign_attributed_session_rate` | campaign / all | 0.38% | 0 | Follows the miss + C4 | Same + unit |
| `landing_page_conversion_rate` | convert on `entry_page` | no SQL | 0 | Not proven | Add recipe + `entry_page` group_by |

---

## Tier 2 — UX frustration

| Metric | Meaning | CH | Semantic | Issue | Change |
|--------|---------|----|----------|-------|--------|
| `rage_clicks` | rage_click events | 59 | 59 | OK on 1001 | C1 for other sites |
| `rage_click_session_count` | sessions with rage | 11 | 11 | OK | C1 |
| `rage_click_rate` | rage sessions / all | 4.14% | 0.0415 | Unit (C4) | Percent |
| `dead_clicks` | dead_click events | 592 | 592 | OK | C1 |
| `dead_click_rate` | dead sessions / all | 33.08% | 0.332 | Unit (C4) | Percent |

Agent session s8 called rage/dead/form/revenue. That is mapping OK; numbers still sit on 1001-only marts.

---

## Tier 2 — forms

Counts match 1001 all-time. Rates have no dashboard SQL. `form_id` breakdown failed in the first dim wave (wrong name / not allowed).

| Metric | CH | Semantic | Issue | Change |
|--------|----|----------|-------|--------|
| `form_views` | 261 | 261 | OK | C1; add `form_id` dim |
| `form_starts` | 191 | 191 | OK | Same |
| `form_submits` | 108 | 108 | OK | Same |
| `form_successes` | 20 | 20 | OK | Same |
| `form_failures` | 0 | 0 | OK (no failures) | Same |
| `form_abandons` | 93 | 93 | OK | Same |
| `form_submit_rate` | — | 0.414 | Not proven | Document: submits/starts (or views) |
| `form_success_rate` | — | 0.185 | Not proven | Document: successes/submits |
| `form_abandon_rate` | — | 0.487 | Not proven | Document: abandons/starts |

**Change:** Allow `form_id` (short name) on form metrics so “abandon on contact form” works.

---

## Tier 2 — e-commerce

| Metric | Meaning | CH | Semantic | Issue | Change |
|--------|---------|----|----------|-------|--------|
| `total_revenue` | sum of order value | **99** | **0.00** | Revenue fact not wired | Join conversion/ecommerce value the dashboard uses |
| `total_conversion_value` | sum(`value`) | not in catalog test | — | Not tested | Add to harness; same join as revenue |
| `purchase_count` | purchases | 1 | 0 | Same miss as conversions | Event type / mart |
| `average_order_value` | revenue / purchases | 99 | **null** | Null when purchases=0 in mart | Fix revenue + divide; never null if CH has a purchase |
| `conversion_rate` | conversions / sessions | 0.38% | 0 | Follows conversion miss + C4 | Fix conversions; percent |
| `signup_count` | signup goals | 0 | 0 | OK if no signups | Re-test when events exist |
| `checkout_start_count` | checkout start | 0 | 0 | No events **or** not mapped | Confirm fact_product_interactions |
| `checkout_start_rate` | starts / sessions | — | 0 | Not proven | Formula |
| `checkout_conversion_rate` | purchase / checkout | — | 0 | Not proven | Formula |
| `cart_add_count` | add to cart | 0 | 0 | Same | Confirm event names |
| `cart_add_rate` | adds / sessions | — | 0 | Not proven | Formula |
| `product_interaction_count` | PDP interactions | 0 | 0 | Same | Confirm |
| `product_view_rate` | views / sessions | — | 0 | Not proven | Formula |

Zero-vs-zero is **not** a pass if ClickHouse later has carts and the mart still drops them. Revenue **99 vs 0** proves the commerce path is broken even with one order.

---

## Tier 2 — Web Vitals

No vital events in ClickHouse for this tenant at test time (null = null). Agent LCP turn **crashed the dashboard chart builder** (AI_CHAT), not the semantic HTTP.

| Metric | CH | Semantic | Issue | Change |
|--------|----|----------|-------|--------|
| `avg_lcp_ms` | null | null | No data; agent UI crash | Fix chart null in AI_CHAT; re-test when `fact_performance_events` has rows |
| `avg_fcp_ms` | null | null | No data | Same |
| `avg_cls` | null | null | No data | Same |
| `avg_inp_ms` | null | null | No data | Same |
| `avg_ttfb_ms` | null | null | No data | Same |
| `poor_vitals_event_count` | 0 | 0 | No data | Same |
| `poor_vitals_rate` | — | 0 | Not proven | Formula + C4 |

---

## Tier 2 — errors & search

| Metric | Meaning | CH | Semantic | Issue | Change |
|--------|---------|----|----------|-------|--------|
| `error_count` | frontend JS errors | 0 | 0 | No events; agent did **not** map “JS errors” | Ontology synonym → `error_count`. Re-test when errors exist |
| `error_session_count` | sessions with errors | 0 | 0 | No data | Same |
| `error_session_rate` | error sessions / all | 0 | 0 | OK here | C4 |
| `search_session_count` | `site_search` custom events | 0 | 0 | No client events | Needs tracker emit + mart |
| `search_usage_rate` | search sessions / all | 0 | 0 | Same | Same + C4 |

---

## Ontology (language that caused wrong tools)

Not metric SQL — but they produce the wrong semantic body.

| User said | Agent did | Should do |
|-----------|-----------|-----------|
| “from Chennai” | `country=chennai` | `city` (alias table) |
| “mobile visitors” | `unique_visitors` + `device` | sessions + device, or allow the dim |
| “UTM / where from” | `referrer_domain` | `utm_source` when they say UTM |
| “JS errors” | no metric | `error_count` |
| “who is online” | no metric | `online_visitors` after C6 product fix |
| visitor profile / session id | no semantic | keep refuse; no CH SQL |

Insights agent: slice `webtracking.insights`, **0 metrics**, **0 semantic** — correct.

---

## Fix order (do this, not YAML in this repo)

1. **Backfill marts for every website_id** (prove 1011 sessions = 17).  
2. **Align `month`** with the dashboard pill.  
3. **Move `online_visitors` to webtracking** or drop it from the grant.  
4. **Wire revenue / conversions / AOV** (99 and 1 are sitting in ClickHouse).  
5. **Fix time-on-page and scroll** (0 vs real engagement).  
6. **One unit for all rates** (percent).  
7. **Dims:** `city`, `form_id`, `utm_*`, `device` on visitor metrics or mapper rules.  
8. **Bounce week** vs `v_session_bounce`.  
9. **Duration** = dashboard activity span.  
10. AI_CHAT: city aliases, error synonyms, split grouped multi-metric, LCP null chart.

## Go / no-go

- **Go** for any `(organizationId, websiteId)` in `webtracking_marts.mart_web_sites` (matching JWT org). Site **1011** is org **1012**. Cross-tenant `websiteId` → `website_not_entitled`.
- All **85** certified webtracking templates must execute per entitled site (`scripts/smoke_webtracking_catalog_85.py`).
- Categorical dims come from `semantic_layer.yml` (not per-metric 400s for `device` / `page_path` / `form_id`).
- Enable `WEBTRACKING_MONTH_ROLLING=1` so `month` matches dashboard rolling 30d.
- One metric per `group_by`. Do not re-enable agent ClickHouse SQL.

Do not apply DB writes from this document.
