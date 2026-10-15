# Webtracking ClickHouse reference SQL

Ground-truth SELECT recipes for org **`1003`** / website **`1001`**, aligned with
[`semantic/sql/metric_templates/webtracking.yml`](../semantic/sql/metric_templates/webtracking.yml).

**Hard filter:** every query MUST constrain **both** `organization_id = 1003` **and**
`website_id = 1001` (on each subquery / joined alias as shown).

**Conventions (match templates):**

| Rule | Detail |
|------|--------|
| Rates | Returned as **percent** (`× 100.0`), not 0–1 ratios |
| `avg_scroll_depth` / `avg_time_on_page_seconds` | `avgIf(..., col > 0)` |
| `bounce_rate` | Denominator = sessions with `page_view_count > 0` |
| `average_session_duration` | `avgIf(duration_seconds, page_view_count > 0)` |
| `landing_page_conversion_rate` | Converted when `conversion_id IS NOT NULL AND conversion_id != ''` |

Validate template path vs these refs:

```bash
env -u http_proxy -u https_proxy -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u all_proxy \
  PYTHONPATH=. python3 scripts/validate_webtracking_ch_refs.py
```

---

## Tier-1 + engagement

### `web_session_volume`

```sql
SELECT uniqExact(session_id) AS web_session_volume
FROM webtracking_marts.mart_web_sessions
WHERE organization_id = 1003
  AND website_id = 1001
```

### `unique_visitors`

```sql
SELECT uniqExact(visitor_id) AS unique_visitors
FROM webtracking_marts.mart_web_sessions
WHERE organization_id = 1003
  AND website_id = 1001
```

### `page_views`

```sql
SELECT count(page_view_id) AS page_views
FROM webtracking_marts.mart_page_views
WHERE organization_id = 1003
  AND website_id = 1001
```

### `average_session_duration`

```sql
SELECT avgIf(duration_seconds, page_view_count > 0) AS average_session_duration
FROM webtracking_marts.mart_web_sessions
WHERE organization_id = 1003
  AND website_id = 1001
```

### `bounce_rate`

```sql
SELECT
  sum(is_bounce_flag) * 100.0
  / nullIf(uniqExactIf(session_id, page_view_count > 0), 0) AS bounce_rate
FROM webtracking_marts.mart_web_sessions
WHERE organization_id = 1003
  AND website_id = 1001
```

### `bounce_count`

```sql
SELECT sum(is_bounce_flag) AS bounce_count
FROM webtracking_marts.mart_web_sessions
WHERE organization_id = 1003
  AND website_id = 1001
```

### `avg_time_on_page_seconds`

```sql
SELECT avgIf(time_on_page_sec, time_on_page_sec > 0) AS avg_time_on_page_seconds
FROM webtracking_marts.mart_page_views
WHERE organization_id = 1003
  AND website_id = 1001
```

### `avg_scroll_depth`

```sql
SELECT avgIf(max_scroll_depth, max_scroll_depth > 0) AS avg_scroll_depth
FROM webtracking_marts.mart_page_views
WHERE organization_id = 1003
  AND website_id = 1001
```

### `scroll_engagement_rate`

```sql
SELECT
  sum(has_deep_scroll) * 100.0 / nullIf(uniqExact(session_id), 0) AS scroll_engagement_rate
FROM webtracking_marts.mart_web_sessions
WHERE organization_id = 1003
  AND website_id = 1001
```

---

## Former `no_reference_sql` (11) + related rates

### `events_per_session`

```sql
SELECT
  (SELECT count(event_id)
   FROM webtracking_marts.mart_interaction_events
   WHERE organization_id = 1003 AND website_id = 1001)
  / nullIf(
      (SELECT uniqExact(session_id)
       FROM webtracking_marts.mart_web_sessions
       WHERE organization_id = 1003 AND website_id = 1001),
      0
    ) AS events_per_session
```

### `landing_page_conversion_rate`

```sql
SELECT
  uniqExactIf(
    s.session_id,
    c.conversion_id IS NOT NULL AND c.conversion_id != ''
  ) * 100.0
  / nullIf(uniqExact(s.session_id), 0) AS landing_page_conversion_rate
FROM webtracking_marts.mart_web_sessions s
LEFT JOIN webtracking_marts.mart_conversion_events c
  ON s.session_id = c.session_id
 AND s.organization_id = c.organization_id
 AND s.website_id = c.website_id
WHERE s.organization_id = 1003
  AND s.website_id = 1001
```

### `form_submit_rate`

```sql
SELECT
  countIf(event_type = 'form_submit') * 100.0
  / nullIf(countIf(event_type = 'form_view'), 0) AS form_submit_rate
FROM webtracking_marts.mart_form_events
WHERE organization_id = 1003
  AND website_id = 1001
```

### `form_success_rate`

```sql
SELECT
  countIf(event_type = 'form_success') * 100.0
  / nullIf(countIf(event_type = 'form_submit'), 0) AS form_success_rate
FROM webtracking_marts.mart_form_events
WHERE organization_id = 1003
  AND website_id = 1001
```

### `form_abandon_rate`

```sql
SELECT
  countIf(event_type = 'form_abandon') * 100.0
  / nullIf(countIf(event_type = 'form_start'), 0) AS form_abandon_rate
FROM webtracking_marts.mart_form_events
WHERE organization_id = 1003
  AND website_id = 1001
```

### `checkout_start_rate`

```sql
SELECT
  sum(has_checkout_start) * 100.0 / nullIf(uniqExact(session_id), 0) AS checkout_start_rate
FROM webtracking_marts.mart_web_sessions
WHERE organization_id = 1003
  AND website_id = 1001
```

### `checkout_conversion_rate`

```sql
SELECT
  coalesce(
    countIf(conversion_type = 'purchase') * 100.0
      / nullIf(countIf(conversion_type = 'begin_checkout'), 0),
    0
  ) AS checkout_conversion_rate
FROM webtracking_marts.mart_conversion_events
WHERE organization_id = 1003
  AND website_id = 1001
```

### `cart_add_rate`

```sql
SELECT
  sum(has_cart_add) * 100.0 / nullIf(uniqExact(session_id), 0) AS cart_add_rate
FROM webtracking_marts.mart_web_sessions
WHERE organization_id = 1003
  AND website_id = 1001
```

### `product_view_rate`

```sql
SELECT
  sum(has_product_view) * 100.0 / nullIf(uniqExact(session_id), 0) AS product_view_rate
FROM webtracking_marts.mart_web_sessions
WHERE organization_id = 1003
  AND website_id = 1001
```

### `poor_vitals_rate`

```sql
SELECT
  coalesce(
    countIf(rating = 'poor') * 100.0 / nullIf(count(event_id), 0),
    0
  ) AS poor_vitals_rate
FROM webtracking_marts.mart_performance_events
WHERE organization_id = 1003
  AND website_id = 1001
```

### `campaign_attributed_sessions`

```sql
SELECT sum(is_campaign_attributed) AS campaign_attributed_sessions
FROM webtracking_marts.mart_web_sessions
WHERE organization_id = 1003
  AND website_id = 1001
```

### `campaign_attributed_session_rate`

```sql
SELECT
  sum(is_campaign_attributed) * 100.0 / nullIf(uniqExact(session_id), 0)
    AS campaign_attributed_session_rate
FROM webtracking_marts.mart_web_sessions
WHERE organization_id = 1003
  AND website_id = 1001
```

---

## Metric set covered

| Bucket | Metrics |
|--------|---------|
| Tier-1 / volume | `web_session_volume`, `unique_visitors`, `page_views`, `average_session_duration`, `bounce_rate`, `bounce_count` |
| Engagement | `avg_time_on_page_seconds`, `avg_scroll_depth` |
| Former no_ref (11) | `events_per_session`, `scroll_engagement_rate`, `landing_page_conversion_rate`, `form_submit_rate`, `form_success_rate`, `form_abandon_rate`, `checkout_start_rate`, `checkout_conversion_rate`, `cart_add_rate`, `product_view_rate`, `poor_vitals_rate` |
| Campaign | `campaign_attributed_sessions`, `campaign_attributed_session_rate` |
