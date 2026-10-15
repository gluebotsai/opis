# Web Tracking — Cross-Product Touchpoint Reference

**Version:** 1.0 (terminology aligned to planned schema)  
**Database:** ClickHouse — schema `web_tracking`  
**Status:** Documentation only. Code/DB migration (`domain_id` → `website_id`, org table) is **on hold** until this doc is signed off.

---

## Identity hierarchy (planned model)

```
organization_id          ← Super-tenant (one company / customer account)
    └── website_id       ← Unique per tracked site (replaces legacy domain_id)
            └── website_url   ← Public URL of the site (replaces legacy domain_name)
                    └── visitor_id → session_id → page_view_id
```

| Key | Scope | Description |
|-----|--------|-------------|
| `organization_id` | Org-wide | Parent of all websites under one customer. **New table planned** (`dim_organizations`). |
| `website_id` | Per site | Unique identifier for each tracked website. Replaces `domain_id`. |
| `website_url` | Per site | Canonical site URL (e.g. `https://shop.example.com`). Replaces `domain_name`. |
| `visitor_id` | Per browser | Anonymous SDK identity. |
| `session_id` | Per visit | Single browsing session. |
| `page_view_id` | Per page load | Links page-level facts to interactions. |
| `user_id` | Per known user | Set after CRM/CDP `identify()` — bridges anonymous → known. |

**Standard filter (always apply):**
```sql
WHERE organization_id = {organization_id}
  AND website_id = {website_id}
```

**Standard joins:**
| Join | Keys |
|------|------|
| Visitor ↔ Session | `organization_id`, `website_id`, `visitor_id` |
| Session ↔ Page view | `organization_id`, `website_id`, `session_id` |
| Page view ↔ Interaction | `organization_id`, `website_id`, `page_view_id` |
| Visitor ↔ Known user (CRM) | `user_id` (when populated) |

> **Migration note:** Current ClickHouse tables still use `domain_id` / `domain_name`. When migration runs, map `domain_id` → `website_id` and `domain_name` → `website_url`. Column references below use **target terminology**.

---

## Table glossary (target names)

| Table | Purpose |
|-------|---------|
| `dim_organizations` *(planned)* | Org master: `organization_id`, org name, status |
| `dim_websites` *(planned rename of dim_domains)* | `organization_id`, `website_id`, `website_url`, site type |
| `dim_visitors` | Visitor profile: first/last seen, totals |
| `dim_sessions` | Session: UTM, geo, device, bounce, duration |
| `fact_page_views` | Page views, scroll, referrer, UTM |
| `fact_interaction_events` | Clicks, moves, scroll, rage/dead clicks |
| `fact_form_events` | Form funnel events |
| `fact_product_interactions` | Product views / ecommerce engagement |
| `fact_conversion_events` | Goals, purchases, lead conversions |
| `fact_custom_events` | Custom business events |
| `fact_performance_events` | Web vitals (LCP, CLS, etc.) |
| `fact_error_events` | JavaScript errors |
| `fact_replay_chunks` | Session replay data |
| `raw_payloads` | Raw SDK JSON (campaign profiles) |
| `agg_web_daily` | Daily site-level KPIs |
| `agg_page_daily` | Daily page-level KPIs |
| `agg_product_daily` | Daily product-level KPIs |

---

## Touchpoint catalog

Format for each entry:
**Touchpoint → Use → Product(s) → Table / Columns**

---

### SECTION A — Visitor identity & lifecycle

---

#### TP-01 · Customer recency (days since last visit)

| | |
|--|--|
| **Use** | Score lead freshness; trigger re-engagement campaigns; prioritize callbacks in CCaaS; CDP recency trait. |
| **Products** | Campaign, CRM, CCaaS, CDP |
| **Table / Columns** | `dim_visitors.last_seen_at` · Compute: `dateDiff('day', last_seen_at, today()) AS recency_days` · Fallback: `max(fact_page_views.created_at)` per `visitor_id` |
| **Join keys** | `organization_id`, `website_id`, `visitor_id` |

---

#### TP-02 · First seen timestamp

| | |
|--|--|
| **Use** | Know when a prospect first appeared; cohort analysis; CRM "customer since" field; CDP identity timeline start. |
| **Products** | CRM, CDP, Campaign |
| **Table / Columns** | `dim_visitors.first_seen_at` · Fallback: `min(fact_page_views.created_at)` grouped by `visitor_id` |
| **Join keys** | `organization_id`, `website_id`, `visitor_id` |

---

#### TP-03 · Last seen timestamp

| | |
|--|--|
| **Use** | Detect dormant vs active users; campaign win-back rules; agent screen-pop "last online" in CCaaS. |
| **Products** | Campaign, CRM, CCaaS, CDP |
| **Table / Columns** | `dim_visitors.last_seen_at` · Fallback: `max(fact_page_views.created_at)` |
| **Join keys** | `organization_id`, `website_id`, `visitor_id` |

---

#### TP-04 · Lifetime sessions count

| | |
|--|--|
| **Use** | Measure visit frequency; CRM engagement tier; CDP frequency trait; campaign loyalty segments. |
| **Products** | Campaign, CRM, CDP |
| **Table / Columns** | `dim_visitors.total_sessions` · Or: `count()` from `dim_sessions` grouped by `visitor_id` · Or: `uniqExact(session_id)` from `fact_page_views` |
| **Join keys** | `organization_id`, `website_id`, `visitor_id` |

---

#### TP-05 · Returning visitor status

| | |
|--|--|
| **Use** | Separate new vs returning audiences in campaigns; CRM lead stage; CDP segment "returning_customer". |
| **Products** | Campaign, CRM, CDP |
| **Table / Columns** | Computed: `lifetime_sessions > 1` · Source: `dim_visitors.total_sessions` or session count from `dim_sessions` |
| **Join keys** | `organization_id`, `website_id`, `visitor_id` |

---

#### TP-05A · Multi-session visitor (adjustable session threshold)

| | |
|--|--|
| **Touchpoint** | Visitor has **more than N sessions** on a website (default **N = 2**, meaning **3+ sessions**). Threshold N is configurable per product rule. |
| **Use** | Build **loyal / high-frequency visitor** segments for retention campaigns; CRM tier "engaged prospect" or "repeat browser"; CDP trait `is_multi_session_visitor`; CCaaS priority routing for callers who visited multiple times; exclude one-time bouncers from upsell audiences. |
| **Products** | Campaign, CRM, CDP, CCaaS |
| **Table / Columns** | **Primary:** `dim_visitors.total_sessions` · **Or compute:** `uniqExact(session_id) AS lifetime_sessions` from `dim_sessions` · **Or:** `count(DISTINCT session_id)` from `fact_page_views` |
| **Join keys** | `organization_id`, `website_id`, `visitor_id` |
| **Rule (default N=2)** | `lifetime_sessions > 2` → visitor has 3 or more sessions |
| **Adjustable parameter** | `{session_threshold}` — change N per use case (e.g. N=1 for 2+ sessions, N=5 for 6+ sessions) |

**Boolean flag per visitor:**
```sql
lifetime_sessions > {session_threshold} AS is_multi_session_visitor
-- Default: {session_threshold} = 2  →  3+ sessions
```

**List visitors matching threshold:**
```sql
SELECT
  v.organization_id,
  v.website_id,
  v.visitor_id,
  v.user_id,
  coalesce(v.total_sessions, sc.lifetime_sessions) AS lifetime_sessions,
  v.first_seen_at,
  v.last_seen_at,
  lifetime_sessions > {session_threshold} AS is_multi_session_visitor
FROM dim_visitors v FINAL
LEFT JOIN (
  SELECT
    organization_id,
    website_id,
    visitor_id,
    uniqExact(session_id) AS lifetime_sessions
  FROM dim_sessions FINAL
  WHERE organization_id = {organization_id}
    AND website_id = {website_id}
  GROUP BY organization_id, website_id, visitor_id
) sc ON sc.organization_id = v.organization_id
   AND sc.website_id = v.website_id
   AND sc.visitor_id = v.visitor_id
WHERE v.organization_id = {organization_id}
  AND v.website_id = {website_id}
  AND lifetime_sessions > {session_threshold}
ORDER BY lifetime_sessions DESC, v.last_seen_at DESC
```

**Count / segment size (for Campaign audience export):**
```sql
SELECT count() AS multi_session_visitor_count
FROM (
  SELECT visitor_id, uniqExact(session_id) AS lifetime_sessions
  FROM dim_sessions FINAL
  WHERE organization_id = {organization_id}
    AND website_id = {website_id}
  GROUP BY visitor_id
  HAVING lifetime_sessions > {session_threshold}
)
```

**Threshold examples:**

| `{session_threshold}` | Condition | Meaning |
|----------------------|-----------|---------|
| `1` | `sessions > 1` | 2+ sessions (any return visit) |
| `2` *(default)* | `sessions > 2` | 3+ sessions (repeat engaged visitor) |
| `5` | `sessions > 5` | 6+ sessions (loyal / power visitor) |

**Related touchpoints:** TP-04 (raw session count), TP-05 (returning = >1 session only)

---

#### TP-06 · Lifetime pageviews count

| | |
|--|--|
| **Use** | Depth of browsing interest; CRM activity score; CDP engagement depth trait. |
| **Products** | CRM, CDP |
| **Table / Columns** | `dim_visitors.total_pageviews` · Or: `count()` from `fact_page_views` per `visitor_id` |
| **Join keys** | `organization_id`, `website_id`, `visitor_id` |

---

#### TP-07 · Anonymous → known identity bridge

| | |
|--|--|
| **Use** | Merge web behavior with CRM contact, CDP unified profile, CCaaS caller lookup, ticket requester history. |
| **Products** | CRM, CDP, CCaaS, Ticketing |
| **Table / Columns** | `dim_visitors.user_id` · `dim_visitors.visitor_id` · `dim_visitors.anonymous_id` · `dim_sessions.user_id` |
| **Join keys** | `organization_id`, `website_id`, `user_id` ↔ CRM contact ID |

---

#### TP-08 · Organization-level rollup

| | |
|--|--|
| **Use** | Aggregate behavior across all websites under one customer account; CDP org-wide profile; executive dashboards. |
| **Products** | CDP, CRM (enterprise) |
| **Table / Columns** | `organization_id` on all `dim_*` and `fact_*` tables · Join via `dim_websites.organization_id` |
| **Join keys** | `organization_id` (group across multiple `website_id`) |

---

#### TP-09 · Website URL context

| | |
|--|--|
| **Use** | Display which site the visitor was on; multi-brand org routing in CCaaS; campaign per-brand reporting. |
| **Products** | CRM, CCaaS, CDP, Campaign |
| **Table / Columns** | `dim_websites.website_url` · `dim_websites.website_id` |
| **Join keys** | `organization_id`, `website_id` |

---

### SECTION B — Session quality & engagement

---

#### TP-10 · Average session duration

| | |
|--|--|
| **Use** | Engagement quality for CRM scoring; content effectiveness; CDP trait; identify low-engagement campaign landing pages. |
| **Products** | CRM, CDP, Campaign |
| **Table / Columns** | `dim_sessions.duration_seconds` · Computed: `avg(duration_seconds)` per `visitor_id` · Capped variant: `avg(least(duration_seconds, 1800))` |
| **Join keys** | `organization_id`, `website_id`, `visitor_id`, `session_id` |

---

#### TP-11 · Average pages per session

| | |
|--|--|
| **Use** | Content stickiness; CRM intent signal; CDP engagement metric; campaign LP quality check. |
| **Products** | CRM, CDP, Campaign |
| **Table / Columns** | `dim_sessions.pageview_count` · Computed: `avg(pageview_count)` · Or: `count(fact_page_views) / uniqExact(session_id)` |
| **Join keys** | `organization_id`, `website_id`, `visitor_id`, `session_id` |

---

#### TP-12 · Bounce rate

| | |
|--|--|
| **Use** | Detect poor campaign landing pages; content relevance; CDP site health trait; campaign optimization. |
| **Products** | Campaign, CDP |
| **Table / Columns** | `dim_sessions.is_bounce` · `dim_sessions.pageview_count` · Formula: `countIf(is_bounce=1 AND pageview_count>0) / countIf(pageview_count>0) * 100` |
| **Join keys** | `organization_id`, `website_id`, `session_id` |

---

#### TP-13 · Entry page / landing page

| | |
|--|--|
| **Use** | Know where visitor entered; tie to campaign LP; CRM conversation context; CCaaS "what page did you start on?". |
| **Products** | Campaign, CRM, CCaaS |
| **Table / Columns** | `dim_sessions.entry_page` · `dim_sessions.entry_url` |
| **Join keys** | `organization_id`, `website_id`, `session_id` |

---

#### TP-14 · Exit page

| | |
|--|--|
| **Use** | Identify drop-off points; campaign funnel leaks; CRM objection handling context. |
| **Products** | Campaign, CRM |
| **Table / Columns** | `dim_sessions.exit_page` · `dim_sessions.exit_url` |
| **Join keys** | `organization_id`, `website_id`, `session_id` |

---

#### TP-15 · Full page journey (ordered path)

| | |
|--|--|
| **Use** | Sales call prep in CRM; agent understanding in CCaaS; ticket reproduction in Ticketing; CDP event timeline. |
| **Products** | CRM, CCaaS, Ticketing, CDP |
| **Table / Columns** | `fact_page_views.page_path` · `fact_page_views.page_title` · `fact_page_views.created_at` · Order by `created_at ASC` |
| **Join keys** | `organization_id`, `website_id`, `visitor_id`, `session_id`, `page_view_id` |

---

#### TP-16 · Time on page

| | |
|--|--|
| **Use** | Content engagement depth; CRM interest scoring; identify pages where users spend most time. |
| **Products** | CRM, CDP |
| **Table / Columns** | `fact_page_views.time_on_page_sec` |
| **Join keys** | `organization_id`, `website_id`, `page_view_id`, `session_id` |

---

#### TP-17 · Average scroll depth

| | |
|--|--|
| **Use** | Content consumption quality; CRM intent (read pricing to bottom); CDP engagement trait; campaign content A/B analysis. |
| **Products** | CRM, CDP, Campaign |
| **Table / Columns** | `fact_page_views.max_scroll_depth` · Or: `fact_interaction_events.scroll_depth` where `event_type IN ('scroll','scroll_depth')` · Join: `ie.page_view_id = pv.page_view_id` |
| **Join keys** | `organization_id`, `website_id`, `visitor_id`, `page_view_id` |

---

### SECTION C — Interaction & frustration signals

---

#### TP-18 · Total clicks

| | |
|--|--|
| **Use** | Active engagement measure; CRM activity score; heatmap input; CDP click frequency trait. |
| **Products** | CRM, CDP |
| **Table / Columns** | `fact_interaction_events` where `event_type = 'click'` · Columns: `x_coord`, `y_coord`, `element`, `element_text`, `page_path` |
| **Join keys** | `organization_id`, `website_id`, `visitor_id`, `page_view_id` |

---

#### TP-19 · Rage click count

| | |
|--|--|
| **Use** | Frustration detection → priority ticket routing; CCaaS escalate to senior agent; CRM "at risk" flag; proactive support outreach. |
| **Products** | Ticketing, CCaaS, CRM |
| **Table / Columns** | `fact_interaction_events` where `event_type = 'rage_click'` · `click_count`, `x_coord`, `y_coord`, `page_path` |
| **Join keys** | `organization_id`, `website_id`, `visitor_id`, `session_id` |

---

#### TP-20 · Dead click count

| | |
|--|--|
| **Use** | Broken UI / misleading elements → auto-create ticket context; dev backlog for UX fixes; CCaaS agent warning. |
| **Products** | Ticketing, CCaaS |
| **Table / Columns** | `fact_interaction_events` where `event_type = 'dead_click'` · `reason`, `element`, `element_type`, `page_path` |
| **Join keys** | `organization_id`, `website_id`, `visitor_id`, `session_id` |

---

#### TP-21 · Click target element context

| | |
|--|--|
| **Use** | Know exactly what user clicked (button label, link href); CRM notes; ticket "I clicked X and nothing happened". |
| **Products** | Ticketing, CRM, CCaaS |
| **Table / Columns** | `fact_interaction_events.element` · `element_type` · `element_text` · `href` |
| **Join keys** | `organization_id`, `website_id`, `page_view_id` |

---

#### TP-22 · Mouse movement / hover patterns

| | |
|--|--|
| **Use** | UX research; identify hesitation areas; advanced CDP behavioral traits. |
| **Products** | CDP |
| **Table / Columns** | `fact_interaction_events` where `event_type = 'move'` · `x_coord`, `y_coord`, `viewport_w`, `viewport_h` |
| **Join keys** | `organization_id`, `website_id`, `session_id`, `page_view_id` |

---

### SECTION D — Campaign & attribution

---

#### TP-23 · UTM source / medium / campaign (session-level)

| | |
|--|--|
| **Use** | Attribute sessions to marketing campaigns; ROI reporting; CRM "how did you hear about us?"; CDP channel trait. |
| **Products** | Campaign, CRM, CDP |
| **Table / Columns** | `dim_sessions.utm_source` · `utm_medium` · `utm_campaign` · `utm_term` · `utm_content` |
| **Join keys** | `organization_id`, `website_id`, `session_id` |

---

#### TP-24 · UTM on page view (content-level attribution)

| | |
|--|--|
| **Use** | Attribute specific page views to campaigns when session UTM varies; content performance by channel. |
| **Products** | Campaign, CDP |
| **Table / Columns** | `fact_page_views.utm_source` · `utm_medium` · `utm_campaign` |
| **Join keys** | `organization_id`, `website_id`, `page_view_id` |

---

#### TP-25 · Referrer & referrer domain

| | |
|--|--|
| **Use** | Organic vs paid vs referral traffic classification; campaign partner tracking; CRM source field enrichment. |
| **Products** | Campaign, CRM, CDP |
| **Table / Columns** | `dim_sessions.referrer` · `referrer_domain` · `fact_page_views.referrer` |
| **Join keys** | `organization_id`, `website_id`, `session_id` |

---

#### TP-26 · First-touch / last-touch campaign profile (JSON)

| | |
|--|--|
| **Use** | Multi-touch attribution models in Campaign product; CDP campaign history; CRM marketing source of truth. |
| **Products** | Campaign, CDP, CRM |
| **Table / Columns** | `raw_payloads.payload` → `JSONExtractRaw(payload, 'profiles', 'campaign')` · Filter: `visitor_id`, `organization_id`, `website_id` |
| **Join keys** | `organization_id`, `website_id`, `visitor_id` |

 
---

#### TP-28 · Bounced campaign landing page sessions

| | |
|--|--|
| **Use** | Identify wasted ad spend; auto-pause underperforming campaigns; LP optimization alerts. |
| **Products** | Campaign |
| **Table / Columns** | `dim_sessions.is_bounce` · `dim_sessions.entry_page` · `dim_sessions.utm_campaign` · Filter: `is_bounce = 1` |
| **Join keys** | `organization_id`, `website_id`, `session_id` |

---
 
 

### SECTION H — Geo, device & technical context

---

#### TP-41 · Country / city / region

| | |
|--|--|
| **Use** | Geo-segmentation in Campaign; CRM territory assignment; CCaaS language routing; CDP geo traits. |
| **Products** | Campaign, CRM, CCaaS, CDP |
| **Table / Columns** | `dim_sessions.country` · `city` · `region` · `latitude` · `longitude` · `geo_data` · Also: `dim_visitors.country`, `fact_page_views.country` |
| **Join keys** | `organization_id`, `website_id`, `session_id` |

---

#### TP-42 · Device / browser / platform

| | |
|--|--|
| **Use** | Device-specific campaign targeting; ticket reproduction steps; CCaaS troubleshooting; CDP device preference trait. |
| **Products** | Campaign, Ticketing, CCaaS, CDP |
| **Table / Columns** | `dim_sessions.device` · `browser` · `browser_version` · `platform` · `user_agent` · `screen_width` · `screen_height` |
| **Join keys** | `organization_id`, `website_id`, `session_id` |

---

#### TP-43 · JavaScript errors

| | |
|--|--|
| **Use** | Auto-enrich support tickets; dev alerting; CCaaS agent sees "site error occurred before call"; CDP quality signal. |
| **Products** | Ticketing, CCaaS, CDP |
| **Table / Columns** | `fact_error_events.error_type` · `message` · `stack` · `page_path` · `browser` · `created_at` |
| **Join keys** | `organization_id`, `website_id`, `visitor_id`, `session_id`, `page_view_id` |

---

#### TP-44 · Web performance vitals (LCP, CLS, etc.)

| | |
|--|--|
| **Use** | Explain slow experience in tickets; CCaaS "page was loading slowly"; CDP site quality score. |
| **Products** | Ticketing, CCaaS, CDP |
| **Table / Columns** | `fact_performance_events.metric_name` · `metric_value` · `rating` · `page_path` |
| **Join keys** | `organization_id`, `website_id`, `session_id`, `page_view_id` |

---

### SECTION I — Real-time & replay

---

#### TP-45 · Live current page (visitor on site now)

| | |
|--|--|
| **Use** | CCaaS screen-pop while caller is on hold; live campaign monitoring; proactive chat trigger. |
| **Products** | CCaaS, Campaign |
| **Table / Columns** | Latest row from `fact_page_views` where `created_at >= now() - INTERVAL 5 MINUTE` · `page_path`, `page_title`, `visitor_id`, `session_id` |
| **Join keys** | `organization_id`, `website_id`, `visitor_id` |

---

#### TP-46 · Session replay chunks

| | |
|--|--|
| **Use** | Visual reproduction for Ticketing disputes; CRM sales review; CCaaS supervisor QA; training. |
| **Products** | Ticketing, CRM, CCaaS |
| **Table / Columns** | `fact_replay_chunks.session_id` · `page_view_id` · `chunk_index` · `events_data` · `encoding` · `event_count` |
| **Join keys** | `organization_id`, `website_id`, `session_id`, `visitor_id` |

---

### SECTION J — Custom events & CDP export

---

#### TP-47 · Custom business events

| | |
|--|--|
| **Use** | Any product-specific trigger (e.g. "clicked pricing", "downloaded PDF"); CDP event stream; CRM custom activity log. |
| **Products** | CDP, CRM, Campaign |
| **Table / Columns** | `fact_custom_events.event_name` · `event_data` · `created_at` |
| **Join keys** | `organization_id`, `website_id`, `visitor_id`, `session_id`, `page_view_id` |

---

#### TP-48 · Daily site KPI aggregates

| | |
|--|--|
| **Use** | Fast dashboards for all products without scanning raw facts; ML feature store input for CDP. |
| **Products** | Campaign, CDP |
| **Table / Columns** | `agg_web_daily`: `website_id`, `event_date`, merge states — `visitors_state`, `sessions_state`, `pageviews_state`, `clicks_state`, `conversions_state`, `conversion_value_state`, `bounce_cnt_state`, `scroll_depth_state` |
| **Join keys** | `organization_id`, `website_id`, `event_date` |

---

#### TP-49 · Daily page KPI aggregates

| | |
|--|--|
| **Use** | Content team reporting; campaign LP comparison; CDP page-level features. |
| **Products** | Campaign, CDP |
| **Table / Columns** | `agg_page_daily`: `website_id`, `page_path`, `event_date`, `views_state`, `visitors_state`, `scroll_depth_state`, `rage_clicks_state` |
| **Join keys** | `organization_id`, `website_id`, `page_path`, `event_date` |

---

#### TP-50 · Cookie / consent operations

| | |
|--|--|
| **Use** | Privacy compliance in CDP; consent-aware campaign targeting; audit trail. |
| **Products** | CDP, Campaign |
| **Table / Columns** | `fact_cookie_operations.action` · `cookie_name` · `cookie_value` · `expiry_days` · `page_path` |
| **Join keys** | `organization_id`, `website_id`, `visitor_id`, `session_id` |

---

## Product quick-reference (which touchpoints matter most)

| Product | Primary touchpoints |
|---------|---------------------|
| **Campaign** | TP-01, TP-05, TP-05A, TP-12, TP-23–28, TP-29, TP-31–33, TP-34–37, TP-38–40, TP-41, TP-45, TP-48–49 |
| **CRM** | TP-01–07, TP-05A, TP-10–18, TP-23, TP-25–27, TP-29–40, TP-41–42, TP-46–47 |
| **Ticketing** | TP-19–21, TP-32, TP-43–44, TP-46, TP-15, TP-42 |
| **CCaaS** | TP-01, TP-03, TP-05A, TP-07, TP-09, TP-13, TP-15, TP-19–21, TP-32–33, TP-36, TP-39, TP-41–42, TP-43–46 |
| **CDP** | All touchpoints — especially TP-01–08, TP-05A, TP-10–12, TP-17–18, TP-23–27, TP-31, TP-34, TP-38–40, TP-41–42, TP-47–50 |

---

## Planned schema additions (not yet in code)

| Item | Description |
|------|-------------|
| `dim_organizations` | New table: `organization_id` (PK), org name, status, created_at |
| `dim_websites` | Rename/refactor from `dim_domains`: add `organization_id`, rename `domain_id` → `website_id`, `domain_name` → `website_url` |
| All fact/dim tables | Add/rename `organization_id`, `website_id` on every table that currently has `domain_id` |

---

## Visitor 360 — example query pattern (target terminology)

```sql
-- Single visitor profile for CRM / CDP export
SELECT
  v.organization_id,
  v.website_id,
  w.website_url,
  v.visitor_id,
  v.user_id,
  v.first_seen_at,
  v.last_seen_at,
  dateDiff('day', v.last_seen_at, today()) AS recency_days,
  v.total_sessions AS lifetime_sessions,
  v.total_sessions > 1 AS is_returning_customer,
  v.total_sessions > 2 AS is_multi_session_visitor,  -- adjustable: > {session_threshold}
  avg(s.duration_seconds) AS avg_session_duration_sec,
  avg(least(s.duration_seconds, 1800)) AS avg_session_duration_sec_capped,
  avg(s.pageview_count) AS avg_pages_per_session,
  round(countIf(s.is_bounce = 1 AND s.pageview_count > 0)
        / countIf(s.pageview_count > 0) * 100, 2) AS bounce_rate_pct,
  (SELECT round(avg(max_scroll_depth), 1)
   FROM fact_page_views pv
   WHERE pv.website_id = v.website_id AND pv.visitor_id = v.visitor_id
     AND pv.max_scroll_depth > 0) AS avg_scroll_depth,
  (SELECT countIf(event_type = 'click')
   FROM fact_interaction_events ie
   WHERE ie.website_id = v.website_id AND ie.visitor_id = v.visitor_id) AS total_clicks,
  (SELECT countIf(event_type = 'rage_click')
   FROM fact_interaction_events ie
   WHERE ie.website_id = v.website_id AND ie.visitor_id = v.visitor_id) AS rage_click_count,
  (SELECT count() FROM fact_product_interactions pi
   WHERE pi.website_id = v.website_id AND pi.visitor_id = v.visitor_id) AS product_interaction_count,
  (SELECT countIf(event_type = 'form_submit') * 100.0
          / nullIf(countIf(event_type = 'form_view'), 0)
   FROM fact_form_events fe
   WHERE fe.website_id = v.website_id AND fe.visitor_id = v.visitor_id) AS form_submission_rate_pct,
  (SELECT count() FROM fact_conversion_events ce
   WHERE ce.website_id = v.website_id AND ce.visitor_id = v.visitor_id) AS conversion_count,
  (SELECT sum(value) FROM fact_conversion_events ce
   WHERE ce.website_id = v.website_id AND ce.visitor_id = v.visitor_id) AS total_conversion_value
FROM dim_visitors v FINAL
JOIN dim_websites w ON w.website_id = v.website_id
LEFT JOIN dim_sessions s FINAL
  ON s.website_id = v.website_id AND s.visitor_id = v.visitor_id
WHERE v.organization_id = {organization_id}
  AND v.website_id = {website_id}
  AND v.visitor_id = {visitor_id}
GROUP BY
  v.organization_id, v.website_id, w.website_url,
  v.visitor_id, v.user_id, v.first_seen_at, v.last_seen_at,
  v.total_sessions
```

---

*Document prepared for internal cross-team integration planning. Schema migration (`domain_id` → `website_id`, org table) to follow after sign-off.*
