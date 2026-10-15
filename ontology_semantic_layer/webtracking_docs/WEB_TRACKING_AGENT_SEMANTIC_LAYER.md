# Web Tracking Agent — Semantic Layer Requirements

**Product:** Worktual Web Tracking  
**Agent:** AnalyticsAgent (`AI_CHAT/`) — natural-language analytics co-worker  
**Database:** ClickHouse `web_tracking`  
**Purpose:** This document defines the **required** metrics and dimensions for the semantic layer integration, plus **future** additions based on database capability and evolving product requirements.

**Scope:** Dashboard-aligned KPI chat, breakdowns, rankings, visitor/session drill-down, and domain analytics (forms, e-commerce, UX frustration, performance, errors). Session replay and raw pipeline tables are out of scope for the chat agent.

---

## Agent workflows this manifest supports

| Workflow | Example user question | Semantic need |
|----------|----------------------|---------------|
| Dashboard KPI | "How many visitors this week?" | Core traffic metrics + time period |
| Real-time | "Who is online right now?" | Online visitors metric |
| Geo breakdown | "Which country has the most sessions?" | Sessions/visitors + country dimension |
| Traffic source | "Where did traffic come from?" | Sessions + UTM / referrer dimensions |
| Rankings | "Top 10 pages by views" | Page views + page_path (list intent) |
| Visitor drill-down | "Show profile for visitor_abc" | Visitor/session dimensions + journey facts |
| Segment filter | "Mobile visitors from India" | Device + country dimensions |
| Multi-metric | "Sessions and page views this week" | Multiple core metrics, same period |
| Forms | "Form abandon rate on contact form" | Form funnel metrics + form_id |
| E-commerce | "Revenue and AOV this month" | Revenue metrics + product dimensions |
| UX frustration | "Rage clicks on checkout page" | Rage click metrics + page_path |
| Performance | "Average LCP this week" | Web vitals metrics + page/device |
| Errors | "How many JS errors today?" | Error metrics + page/browser |

---

## Required metrics

These metrics are needed for the AnalyticsAgent to answer current and near-term user questions reliably. Tier 1 must use **dashboard-aligned SQL** (no LLM fallback). Tier 2 uses semantic SQL recipes with the same guardrails.

### Tier 1 — Core KPIs (dashboard-aligned, known SQL)

Must match dashboard KPI cards and period pills (`today | week | month | overall`).

| Metric ID | Canonical name | Unit | Primary source | Notes |
|-----------|----------------|------|----------------|-------|
| `unique_visitors` | Unique Visitors | count | `dim_sessions` | `uniqExact(visitor_id)` — never `count()` |
| `web_session_volume` | Web Session Volume | count | `dim_sessions` | `uniqExact(session_id)` — never `count()` rows |
| `page_views` | Page Views | count | `fact_page_views` | `count()` on page load events |
| `total_clicks` | Total Clicks | count | `fact_interaction_events` | `event_type = 'click'` |
| `total_conversions` | Total Conversions | count | `fact_conversion_events` | Goal/purchase/signup events |
| `bounce_rate` | Bounce Rate | percent | `v_session_bounce` | **Only** from `v_session_bounce` — 1 pageview + duration < 10s |
| `average_session_duration` | Average Session Duration | seconds | `fact_page_views` + `fact_interaction_events` | Activity span per session (dashboard method) |
| `new_visitor_count` | New Visitor Count | count | `dim_sessions` | Visitors with ≤ 1 session in period |
| `returning_visitor_count` | Returning Visitor Count | count | `dim_sessions` | Visitors with > 1 session in period |
| `online_visitors` | Online Visitors | count | `dim_sessions` | Active in last 5 minutes — **add to catalog** |

### Tier 1 — Ranking / list intents (not single-value KPIs)

Semantic layer must treat these as first-class query patterns (metric + dimension + ORDER BY + LIMIT).

| Intent ID | Description | Metric(s) | Group by dimension |
|-----------|-------------|-----------|-------------------|
| `top_pages_by_views` | Most viewed pages | `page_views` | `page_path` |
| `top_pages_by_visitors` | Pages with most unique visitors | `unique_visitors` | `page_path` |
| `top_visitors_by_sessions` | Most active visitors | `web_session_volume` | `visitor_id` |
| `top_visitors_by_pageviews` | Visitors with most page views | `page_views` | `visitor_id` |
| `traffic_source_breakdown` | Sessions/visitors by channel | `web_session_volume` or `unique_visitors` | `referrer_domain`, `utm_source`, `utm_medium`, `utm_campaign` |
| `geo_breakdown` | Sessions/visitors by location | `web_session_volume` or `unique_visitors` | `country`, `city`, `region` |
| `device_breakdown` | Sessions/visitors by device | `web_session_volume` or `unique_visitors` | `device`, `browser`, `platform` |

### Tier 2 — Engagement & depth

| Metric ID | Canonical name | Unit | Primary source |
|-----------|----------------|------|----------------|
| `pages_per_session` | Pages per Session | ratio | `fact_page_views` + `dim_sessions` |
| `events_per_session` | Events per Session | ratio | `fact_*` + `dim_sessions` |
| `avg_time_on_page_seconds` | Average Time on Page | seconds | `fact_page_views` |
| `avg_scroll_depth` | Average Scroll Depth | percent | `fact_page_views`, `fact_interaction_events` |
| `scroll_engagement_rate` | Scroll Engagement Rate | percent | `fact_page_views` |
| `bounce_count` | Bounce Count | count | `v_session_bounce` |
| `clicks_per_session` | Clicks per Session | ratio | `fact_interaction_events` + `dim_sessions` |

### Tier 2 — Visitor identity & loyalty (ratios)

| Metric ID | Canonical name | Unit | Primary source |
|-----------|----------------|------|----------------|
| `new_visitor_rate` | New Visitor Rate | percent | Derived from new/total visitors |
| `returning_visitor_rate` | Returning Visitor Rate | percent | Derived from returning/total visitors |
| `identified_visitor_count` | Identified Visitor Count | count | `dim_visitors` / `dim_known_users` |
| `visitor_identification_rate` | Visitor Identification Rate | percent | Identified / total visitors |
| `identified_session_count` | Identified Session Count | count | `dim_sessions` + `dim_known_users` |
| `identified_session_rate` | Identified Session Rate | percent | Identified sessions / total sessions |

### Tier 2 — Marketing attribution

| Metric ID | Canonical name | Unit | Primary source |
|-----------|----------------|------|----------------|
| `campaign_attributed_sessions` | Campaign Attributed Sessions | count | `dim_sessions` (`wt_campaign_id` / UTM) |
| `campaign_attributed_session_rate` | Campaign Attributed Session Rate | percent | Campaign sessions / total sessions |
| `landing_page_conversion_rate` | Landing Page Conversion Rate | percent | `dim_sessions.entry_page` + `fact_conversion_events` |

### Tier 2 — UX frustration

| Metric ID | Canonical name | Unit | Primary source |
|-----------|----------------|------|----------------|
| `rage_clicks` | Rage Click Count | count | `fact_interaction_events` (`event_type = 'rage_click'`) |
| `rage_click_session_count` | Sessions with Rage Clicks | count | `fact_interaction_events` |
| `rage_click_rate` | Rage Click Rate | percent | Rage sessions / total sessions |
| `dead_clicks` | Dead Click Count | count | `fact_interaction_events` (`event_type = 'dead_click'`) |
| `dead_click_rate` | Dead Click Rate | percent | Dead click sessions / total sessions |

### Tier 2 — Form funnel

| Metric ID | Canonical name | Unit | Primary source |
|-----------|----------------|------|----------------|
| `form_views` | Form Views | count | `fact_form_events` |
| `form_starts` | Form Starts | count | `fact_form_events` |
| `form_submits` | Form Submits | count | `fact_form_events` |
| `form_successes` | Form Successes | count | `fact_form_events` |
| `form_failures` | Form Failures | count | `fact_form_events` |
| `form_abandons` | Form Abandons | count | `fact_form_events` |
| `form_submit_rate` | Form Submit Rate | percent | Derived funnel ratio |
| `form_success_rate` | Form Success Rate | percent | Derived funnel ratio |
| `form_abandon_rate` | Form Abandon Rate | percent | Derived funnel ratio |

### Tier 2 — E-commerce & revenue

| Metric ID | Canonical name | Unit | Primary source |
|-----------|----------------|------|----------------|
| `total_revenue` | Total Revenue | currency | `fact_conversion_events` / `ecommerce` view |
| `total_conversion_value` | Total Conversion Value | currency | `fact_conversion_events` (`sum(value)`) |
| `purchase_count` | Purchase Count | count | `fact_conversion_events` / `fact_product_interactions` |
| `average_order_value` | Average Order Value | currency | Revenue / purchase count |
| `signup_count` | Signup Count | count | `fact_conversion_events` (goal type) |
| `checkout_start_count` | Checkout Start Count | count | `fact_product_interactions` / conversions |
| `checkout_start_rate` | Checkout Start Rate | percent | Derived funnel ratio |
| `checkout_conversion_rate` | Checkout Conversion Rate | percent | Derived funnel ratio |
| `cart_add_count` | Cart Add Count | count | `fact_product_interactions` |
| `cart_add_rate` | Cart Add Rate | percent | Derived funnel ratio |
| `product_interaction_count` | Product Interaction Count | count | `fact_product_interactions` |
| `product_view_rate` | Product View Rate | percent | Product views / sessions |
| `conversion_rate` | Conversion Rate | percent | Conversions / sessions or visitors |

### Tier 2 — Core Web Vitals & performance

| Metric ID | Canonical name | Unit | Primary source |
|-----------|----------------|------|----------------|
| `avg_lcp_ms` | Average Largest Contentful Paint (LCP) | milliseconds | `fact_performance_events` |
| `avg_fcp_ms` | Average First Contentful Paint (FCP) | milliseconds | `fact_performance_events` |
| `avg_cls` | Average Cumulative Layout Shift (CLS) | score | `fact_performance_events` |
| `avg_inp_ms` | Average Interaction to Next Paint (INP) | milliseconds | `fact_performance_events` |
| `avg_ttfb_ms` | Average Time to First Byte (TTFB) | milliseconds | `fact_performance_events` |
| `poor_vitals_event_count` | Poor Web Vitals Event Count | count | `fact_performance_events` |
| `poor_vitals_rate` | Poor Web Vitals Rate | percent | Poor vitals / total vitals events |

### Tier 2 — Application stability

| Metric ID | Canonical name | Unit | Primary source |
|-----------|----------------|------|----------------|
| `error_count` | Total Frontend Errors | count | `fact_error_events` |
| `error_session_count` | Sessions with Errors | count | `fact_error_events` |
| `error_session_rate` | Error Session Rate | percent | Error sessions / total sessions |

### Tier 2 — Internal search (custom events)

Requires clients to emit `site_search` (or equivalent) via `fact_custom_events`.

| Metric ID | Canonical name | Unit | Primary source |
|-----------|----------------|------|----------------|
| `search_session_count` | Sessions with Search | count | `fact_custom_events` |
| `search_usage_rate` | Search Usage Rate | percent | Search sessions / total sessions |

---

## Required dimensions

Dimensions enable breakdowns, filters, drill-down, and time scoping. Tenant keys (`organization_id`, `website_id`) are mandatory filters on every query.

### Sessions (`dim_sessions` / `sem_web_sessions`)

| Dimension ID | Canonical name | Type | Agent use |
|--------------|----------------|------|-----------|
| `web_sessions__website_id` | Website ID | categorical | Tenant filter (required) |
| `web_sessions__organization_id` | Organization ID | categorical | Multi-tenant filter |
| `web_sessions__session_id` | Session ID | categorical | Session drill-down |
| `web_sessions__visitor_id` | Visitor ID | categorical | Visitor → session join |
| `web_sessions__user_id` | User ID | categorical | Identified user filter |
| `web_sessions__device` | Device Class | categorical | Segment: desktop / mobile / tablet |
| `web_sessions__browser` | Browser | categorical | Segment: Chrome, Safari, etc. |
| `web_sessions__platform` | Operating System | categorical | Segment: Windows, iOS, Android, etc. |
| `web_sessions__country` | Country | categorical | Geo breakdown & filter |
| `web_sessions__city` | City | categorical | Geo breakdown & filter |
| `web_sessions__region` | Region / State | categorical | Geo breakdown — **add to catalog** |
| `web_sessions__utm_source` | UTM Source | categorical | Traffic source breakdown |
| `web_sessions__utm_medium` | UTM Medium | categorical | Channel breakdown |
| `web_sessions__utm_campaign` | UTM Campaign | categorical | Campaign breakdown |
| `web_sessions__referrer_domain` | Referrer Domain | categorical | Traffic source breakdown |
| `web_sessions__referrer` | Referrer URL | categorical | Full referrer — **add to catalog** |
| `web_sessions__entry_page` | Landing Page Path | categorical | Landing page analysis |
| `web_sessions__exit_page` | Exit Page Path | categorical | Journey / exit analysis — **add to catalog** (derive from `fact_page_views`) |
| `web_sessions__wt_campaign_id` | Worktual Campaign ID | categorical | Cross-product campaign attribution |
| `web_sessions__wt_contact_id` | Worktual Contact ID | categorical | CDP contact attribution |
| `web_sessions__started_at` | Session Started At | time | Primary time dimension for session metrics |

### Visitors (`dim_visitors` / `sem_web_visitors`)

| Dimension ID | Canonical name | Type | Agent use |
|--------------|----------------|------|-----------|
| `web_visitors__visitor_id` | Visitor ID | categorical | Profile & drill-down key |
| `web_visitors__user_id` | User ID | categorical | Known user lookup |
| `web_visitors__is_identified_flag` | Is Identified Flag | categorical | Anonymous vs known filter |
| `web_visitors__country` | Visitor Country | categorical | Profile geo (fallback) |
| `web_visitors__first_seen_at` | First Seen At | time | Cohort / new visitor context |
| `web_visitors__last_seen_at` | Last Seen At | time | Recency / retention context |

### Page views (`fact_page_views` / `sem_page_views`)

| Dimension ID | Canonical name | Type | Agent use |
|--------------|----------------|------|-----------|
| `page_views__page_path` | Page Path | categorical | Top pages, page-level metrics |
| `page_views__page_title` | Page Title | categorical | Human-readable page label |
| `page_views__session_id` | Session ID | categorical | Journey reconstruction |
| `page_views__visitor_id` | Visitor ID | categorical | Visitor page history |
| `page_views__device` | Device Class | categorical | Page-level device slice |
| `page_views__country` | Country | categorical | Page-level geo slice |
| `page_views__created_at` | Page View Created At | time | Primary time dimension for page metrics |

### Interactions (`fact_interaction_events` / `sem_interaction_events`)

| Dimension ID | Canonical name | Type | Agent use |
|--------------|----------------|------|-----------|
| `interaction_events__event_type` | Interaction Type | categorical | click, rage_click, dead_click, scroll, etc. |
| `interaction_events__page_path` | Page Path | categorical | Clicks/frustration by page |
| `interaction_events__element` | Target DOM Element | categorical | Which element was clicked |
| `interaction_events__element_type` | Element Tag Type | categorical | button, a, input, etc. |
| `interaction_events__element_text` | Element Text | categorical | Button/link label analysis |
| `interaction_events__frustration_reason` | Frustration Reason | categorical | Rage/dead click diagnostics |
| `interaction_events__device` | Device Class | categorical | Interaction by device |
| `interaction_events__created_at` | Interaction Created At | time | Time scoping |

### Forms (`fact_form_events` / `sem_form_events`)

| Dimension ID | Canonical name | Type | Agent use |
|--------------|----------------|------|-----------|
| `form_events__form_id` | Form ID | categorical | Per-form funnel |
| `form_events__form_name` | Form Name | categorical | Human-readable form label |
| `form_events__form_event_type` | Form Event Type | categorical | view, start, submit, success, abandon |
| `form_events__form_field_name` | Form Field Name | categorical | Field-level drop-off (future detail) |
| `form_events__page_path` | Page Path | categorical | Form location |
| `form_events__created_at` | Form Event Created At | time | Time scoping |

### Conversions (`fact_conversion_events` / `sem_conversion_events`)

| Dimension ID | Canonical name | Type | Agent use |
|--------------|----------------|------|-----------|
| `conversion_events__conversion_goal_type` | Conversion Goal Type | categorical | purchase, signup, login, etc. |
| `conversion_events__product_id` | Product ID | categorical | Product-attributed conversions |
| `conversion_events__currency` | Currency | categorical | Multi-currency revenue |
| `conversion_events__attributed_source` | Attributed Source | categorical | Conversion attribution |
| `conversion_events__attributed_campaign` | Attributed Campaign | categorical | Campaign-attributed conversions |
| `conversion_events__created_at` | Conversion Created At | time | Time scoping |

### Products (`fact_product_interactions` / `sem_product_interactions`)

| Dimension ID | Canonical name | Type | Agent use |
|--------------|----------------|------|-----------|
| `product_interactions__product_id` | Product ID | categorical | Product rankings & funnel |
| `product_interactions__product_name` | Product Name | categorical | Human-readable product label |
| `product_interactions__product_category` | Product Category | categorical | Category breakdown |
| `product_interactions__product_brand` | Product Brand | categorical | Brand breakdown |
| `product_interactions__product_section` | Product Section | categorical | cart, wishlist, checkout, product_page_view |
| `product_interactions__created_at` | Product Interaction Created At | time | Time scoping |

### Performance (`fact_performance_events` / `sem_performance_events`)

| Dimension ID | Canonical name | Type | Agent use |
|--------------|----------------|------|-----------|
| `performance_events__metric_name` | Performance Metric Name | categorical | LCP, FCP, CLS, INP, TTFB filter |
| `performance_events__rating` | Performance Rating | categorical | good / needs-improvement / poor |
| `performance_events__page_path` | Page Path | categorical | Vitals by page |
| `performance_events__device` | Device Class | categorical | Vitals by device |
| `performance_events__created_at` | Performance Event Created At | time | Time scoping |

### Errors (`fact_error_events` / `sem_error_events`)

| Dimension ID | Canonical name | Type | Agent use |
|--------------|----------------|------|-----------|
| `error_events__error_class_type` | Error Class Type | categorical | Error type breakdown |
| `error_events__page_path` | Page Path | categorical | Errors by page |
| `error_events__browser` | Browser | categorical | Errors by browser |
| `error_events__session_id` | Session ID | categorical | Session error context |
| `error_events__visitor_id` | Visitor ID | categorical | Visitor error history |
| `error_events__created_at` | Error Created At | time | Time scoping |

### Custom events (`fact_custom_events`) — required for search & track()

| Dimension ID | Canonical name | Type | Agent use |
|--------------|----------------|------|-----------|
| `custom_events__event_name` | Custom Event Name | categorical | site_search, custom track() events — **add to catalog** |
| `custom_events__session_id` | Session ID | categorical | Session-scoped custom events |
| `custom_events__visitor_id` | Visitor ID | categorical | Visitor-scoped custom events |
| `custom_events__created_at` | Custom Event Created At | time | Time scoping |

### Known users (`dim_known_users`) — required for identity drill-down

| Dimension ID | Canonical name | Type | Agent use |
|--------------|----------------|------|-----------|
| `known_users__user_id` | User ID | categorical | CRM / identified user key |
| `known_users__visitor_id` | Visitor ID | categorical | Visitor ↔ user mapping |
| `known_users__email` | Email | categorical | Known user lookup — **add to catalog** |
| `known_users__phone` | Phone | categorical | Known user lookup — **add to catalog** |

### Time grains (semantic layer helpers)

| Dimension ID | Description | Agent use |
|--------------|-------------|-----------|
| `time__day` | Calendar day bucket | Daily trends |
| `time__week` | Calendar week bucket | Weekly trends |
| `time__month` | Calendar month bucket | Monthly trends |
| `period__dashboard` | today / week / month / overall | Match dashboard period pill |

---

## Metric guardrails (ontology rules)

These rules must be enforced by the semantic layer — not left to LLM SQL generation.

| Rule | Detail |
|------|--------|
| Bounce rate | **Only** `v_session_bounce` — never `dim_sessions.is_bounce` or `agg_web_daily.bounce_cnt_state` |
| Unique visitors | `uniqExact(visitor_id)` from `dim_sessions` — never `count()` |
| Sessions | `uniqExact(session_id)` — never `count()` rows on `dim_sessions` |
| Exit page | Derive from `fact_page_views` (`argMax(page_path, created_at)`) — `dim_sessions.exit_page` is not populated |
| Geo session counts | Geo lives on `dim_sessions` — not `dim_visitors.country` for session geo breakdowns |
| Tenant isolation | Every query must filter `website_id = {logged-in site}` |
| KPI consistency | Tier 1 metrics must refuse LLM fallback when known SQL fails |
| Online visitors | `greatest(updated_at, coalesce(ended_at, updated_at)) >= now() - INTERVAL 5 MINUTE` |

---

## Future metrics

> **Future** — available in database or catalog but not required for initial semantic layer rollout. Add when product surfaces or user demand justify them.

| Metric ID | Canonical name | Why future | Database readiness |
|-----------|----------------|------------|-------------------|
| `days_since_last_visit` | Days Since Last Visit | CDP / retention segments; not in dashboard chat today | `dim_visitors.last_seen_at` |
| `max_scroll_depth` | Max Scroll Depth (visitor) | Visitor profile metric; per-visitor not site KPI | `fact_page_views`, `fact_interaction_events` |
| `wishlist_add_count` | Wishlist Add Count | E-commerce sub-funnel; niche vs cart/checkout | `fact_product_interactions` |
| `refund_count` | Refund Count | Post-purchase; not in current dashboard chat | `fact_conversion_events` |
| `refund_value` | Refund Value | Revenue adjustment; multi-currency complexity | `fact_conversion_events` |
| `avg_pages_per_visitor` | Average Pages per Visitor | Derived engagement; low chat demand | `fact_page_views` |
| `session_replay_count` | Session Replay Count | Replay is excluded from chat agent scope | `fact_replay_chunks` |
| `heap_snapshot_count` | DOM Heap Snapshot Count | Developer/debug use; not business analytics | `fact_heap_snapshots` |
| `tracking_consent_granted_count` | Tracking Consent Granted Count | Compliance dashboard; niche chat use | `fact_cookie_operations` |
| `tracking_consent_denied_count` | Tracking Consent Denied Count | Compliance dashboard; niche chat use | `fact_cookie_operations` |
| `tracking_consent_grant_rate` | Tracking Consent Grant Rate | Privacy compliance reporting | `fact_cookie_operations` |
| `period_over_period_change` | Period-over-Period Change | Comparison analytics; needs trend infrastructure | Derived |
| `week_over_week_growth` | Week-over-Week Growth | Trend comparison; InsightsAgent territory | Derived |
| `funnel_step_conversion` | Generic Funnel Step Conversion | Custom funnel builder; not MVP chat | Multi-table derived |
| `cohort_retention_rate` | Cohort Retention Rate | Advanced analytics; not current co-worker scope | `dim_sessions` + cohort logic |
| `avg_time_to_convert` | Average Time to Convert | Attribution advanced metric | `fact_conversion_events` + sessions |
| `revenue_per_visitor` | Revenue per Visitor | Derived e-commerce KPI | Revenue / visitors |
| `revenue_per_session` | Revenue per Session | Derived e-commerce KPI | Revenue / sessions |

---

## Future dimensions

> **Future** — columns exist or are planned; add when workflows need them.

| Dimension ID | Canonical name | Why future | Database readiness |
|--------------|----------------|------------|-------------------|
| `web_sessions__utm_term` | UTM Term | Column exists but MV sets empty string | `dim_sessions.utm_term` (not populated) |
| `web_sessions__utm_content` | UTM Content | Column exists but MV sets empty string | `dim_sessions.utm_content` (not populated) |
| `web_sessions__ended_at` | Session Ended At | Useful for session duration validation | `dim_sessions.ended_at` |
| `web_sessions__updated_at` | Session Updated At | Real-time activity refinement | `dim_sessions.updated_at` |
| `page_views__referrer` | Referrer (page level) | Page-level traffic; session-level sufficient today | `fact_page_views.referrer` |
| `page_views__time_on_page_sec` | Time on Page | Filter "pages with > 30s dwell" | `fact_page_views.time_on_page_sec` |
| `page_views__max_scroll_depth` | Max Scroll Depth (page) | Page engagement filter | `fact_page_views.max_scroll_depth` |
| `interaction_events__coordinates_x/y` | Click Coordinates | Heatmap analysis; not text chat | `fact_interaction_events` |
| `custom_events__event_data_*` | Custom Event JSON keys | Dynamic track() payloads; needs schema discovery | `fact_custom_events.event_data` |
| `conversion_events__conversion_id` | Conversion ID | Row-level drill-down; rarely asked in chat | `fact_conversion_events` |
| `error_events__error_message` | Error Message | Top errors list; sensitive / verbose | `fact_error_events` |
| `error_events__stack_trace` | Stack Trace | Developer debug; not business user chat | `fact_error_events` |
| `cookie_operations__consent_action` | Consent Action | Privacy compliance slice | `fact_cookie_operations` |
| `cookie_operations__cookie_name` | Cookie Name | Granular consent audit | `fact_cookie_operations` |
| `replay_chunks__recorder_source` | Recorder Source | Session replay internals | `fact_replay_chunks` |
| `replay_chunks__session_id` | Session ID (Replays) | Replay ↔ session link | `fact_replay_chunks` |
| `agg_web_daily__event_date` | Event Date (daily rollup) | Pre-aggregated trend queries | `agg_web_daily.event_date` |
| `agg_page_daily__page_path` | Page Path (daily rollup) | Faster top-pages at scale | `agg_page_daily` |
| `agg_product_daily__product_id` | Product ID (daily rollup) | Faster product analytics at scale | `agg_product_daily` |
| `known_users__traits_*` | User Traits (JSON) | Arbitrary identify() traits | `dim_known_users.traits` |

---

## Summary counts

| Category | Count |
|----------|-------|
| **Required metrics (Tier 1 KPIs)** | 11 |
| **Required ranking/list intents** | 7 patterns |
| **Required metrics (Tier 2)** | 52 |
| **Required dimensions** | ~75 across 10 semantic models |
| **Future metrics** | 18 |
| **Future dimensions** | 20 |

---

## Catalog gaps to close before integration

Items marked **add to catalog** above that are required now but missing from `metric_catlog 4.py`:

1. **Metric:** `online_visitors` (Online Visitors)
2. **Metric:** `total_conversion_value` (may exist — confirm alias with `total_revenue`)
3. **Dimension:** `web_sessions__region` (Region / State)
4. **Dimension:** `web_sessions__referrer` (full Referrer URL)
5. **Dimension:** `web_sessions__exit_page` (Exit Page Path — fact-derived)
6. **Dimension:** `custom_events__event_name` (Custom Event Name)
7. **Dimension:** `known_users__email`, `known_users__phone`

---

## Related documentation

- [WEB_TRACKING_METRICS_REFERENCE.md](./WEB_TRACKING_METRICS_REFERENCE.md) — CDP / visitor profile metric calculations
- [METRICS_CONSISTENCY.md](./METRICS_CONSISTENCY.md) — Chat ↔ dashboard alignment rules
- [CLICKHOUSE_CDP_REFERENCE.md](./CLICKHOUSE_CDP_REFERENCE.md) — Table and field semantics
- [AI_CHAT/app/schema/registry.py](../AI_CHAT/app/schema/registry.py) — Current schema ontology
- [shared/analytics_metrics.py](../shared/analytics_metrics.py) — Dashboard-aligned known SQL
