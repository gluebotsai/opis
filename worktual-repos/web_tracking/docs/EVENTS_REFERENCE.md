# Worktual Analytics — Event Names, Purpose & Storage Reference

Complete guide to every SDK event name, what it does, where it is stored in PostgreSQL, and how to create **custom events**.

**Payload format:** `events_v3` (SDK default) → expanded to `events_v2` → ETL mappers  
**Ingest:** `POST /v1/tracking/collect`

---

## How an event travels (end to end)

```text
Browser (SDK)
  WorktualAnalytics.track('my_event', { ... })
       │
       ▼
  Batch queue → POST /v1/tracking/collect
       │
       ├─ raw_payload_dedup     (1 row per payloadId — duplicate guard)
       ├─ raw_payloads          (full JSON — bronze audit)
       │
       ▼
  ETL worker (process_events_v2)
       │
       ├─ etl_event_dedup       (1 hash row per unique event — duplicate guard)
       ├─ event_catalog         (counter +1 for event name — registry)
       │
       └─ Fact table            (page_views, interaction_events, custom_events, …)
```

---

## Event name rules (including custom events)

| Rule | Value |
|------|--------|
| Pattern | `^[a-z][a-z0-9_]{0,63}$` (lowercase, starts with letter) |
| Max length | 64 characters |
| Max properties keys | 50 per event |
| Max batch size | 100 events per POST |
| Reserved / built-in names | Listed below — also allowed as custom if sent via `track()` |

**Custom event names** must follow the pattern. Examples: `button_clicked`, `newsletter_signup`, `pricing_cta_click`.

---

## Master event list

### 1. Page & navigation

| Event name | Purpose | How it is fired | Stored in | `event_catalog` source |
|------------|---------|-----------------|-----------|------------------------|
| **`page_view`** | User viewed a page (traffic, landing pages, journeys) | Auto on load + SPA navigation (`autoTrack: true`) | **`page_views`** | `events_v2` |
| **`page_transition`** | SPA journey step (from page A → page B + duration) | Auto when `trackJourney !== false` | Converted to **`page_view`** in ETL | — |
| **`page_visible`** | Tab/window became visible again | Auto (`visibilitychange`) | **`custom_events`** | `custom` |
| **`page_hidden`** | Tab/window hidden / user switched away | Auto (`visibilitychange`) | **`custom_events`** | `custom` |

---

### 2. Engagement & session

| Event name | Purpose | How it is fired | Stored in | `event_catalog` source |
|------------|---------|-----------------|-----------|------------------------|
| **`user_active`** | User returned from idle (mouse/key/scroll/touch) | Auto after 30s idle (`USER_IDLE_MS`) | **`custom_events`** | `custom` |
| **`user_idle`** | No activity for 30 seconds | Auto timeout | **`custom_events`** | `custom` |
| **`heartbeat`** | Periodic “still on site” ping while active | Auto every 30s (`trackHeartbeat`, default on) | **`custom_events`** | `custom` |

---

### 3. Clicks, scroll & heatmap (`interaction_events`)

| Event name | Purpose | How it is fired | Stored in | `event_catalog` source |
|------------|---------|-----------------|-----------|------------------------|
| **`click`** | Click with x/y, element, viewport (heatmap + analytics) | Heatmap module and/or auto click tracking | **`interaction_events`** | `interaction` |
| **`move`** | Mouse movement sample (heatmap trails) | Heatmap when `trackMove: true` | **`interaction_events`** | `interaction` |
| **`scroll`** | Scroll interaction with depth | Heatmap / SDK | **`interaction_events`** | `interaction` |
| **`hover`** | Mouse hover on element | Heatmap when `trackHover: true` | **`interaction_events`** (stored as `move` if invalid) | `interaction` |
| **`rage_click`** | 3+ rapid clicks same spot (UX frustration) | Heatmap rage detector | **`interaction_events`** | `interaction` |
| **`dead_click`** | Click on non-interactive area (UX frustration) | Heatmap dead-click detector | **`interaction_events`** | `interaction` |
| **`scroll_milestone`** | User reached scroll depth 25/50/75/90/100% | Auto scroll milestones | **`page_views.max_scroll_depth`** (updated, no separate fact row) | — |
| **`scroll_depth`** | Max scroll depth value for current page | Expanded from `scroll_milestone` in v3 | **`page_views.max_scroll_depth`** | — |

**Dashboard use:** Behavior heatmaps, engagement rage/dead clicks, scroll depth reports.

---

### 4. Auto tracking — links, downloads, search

| Event name | Purpose | How it is fired | Stored in | `event_catalog` source |
|------------|---------|-----------------|-----------|------------------------|
| **`outbound_link`** | Click left site to external URL | Auto click on external `<a>` | **`custom_events`** | `custom` |
| **`file_download`** | Click downloaded a file (pdf, zip, …) | Auto click on download links | **`custom_events`** | `custom` |
| **`site_search`** | Site search form submitted (query masked/truncated) | Auto on search form submit | **`custom_events`** | `custom` |

---

### 5. Form analytics (`form_events`)

| Event name | Purpose | How it is fired | Stored in | `event_catalog` source |
|------------|---------|-----------------|-----------|------------------------|
| **`form_view`** | Form entered viewport | Auto (`IntersectionObserver`) | **`form_events`** | `form` |
| **`form_start`** | User first interacted with form | Auto first focusin | **`form_events`** | `form` |
| **`form_focus`** | Field received focus | Auto focusin | **`form_events`** | `form` |
| **`form_blur`** | Field lost focus | Auto focusout | **`form_events`** | `form` |
| **`form_change`** | Field value changed | Auto change (sensitive fields masked) | **`form_events`** | `form` |
| **`form_validation`** | HTML5 validation failed | Auto invalid event | **`form_events`** | `form` |
| **`form_submit`** | Form submit attempted | Auto submit | **`form_events`** | `form` |
| **`form_success`** | Form submitted successfully | Call `WorktualAnalytics.trackFormSuccess(form, props)` | **`form_events`** | `form` |
| **`form_failure`** | Form submit failed | Call `trackFormFailure` | **`form_events`** | `form` |
| **`form_abandon`** | User left page with started but unsubmitted form | Auto beforeunload | **`form_events`** | `form` |

**Dashboard use:** `/behavior` form funnel API.

---

### 6. Performance (`performance_events`)

| Event name | Purpose | How it is fired | Stored in | `event_catalog` source |
|------------|---------|-----------------|-----------|------------------------|
| **`performance_vitals`** | Combined Web Vitals snapshot (SDK sends once) | Auto on page hide | Split by ETL into rows below | — |
| **`performance_lcp`** | Largest Contentful Paint (ms) | Expanded from `performance_vitals` | **`performance_events`** | `performance` |
| **`performance_cls`** | Cumulative Layout Shift | Expanded from `performance_vitals` | **`performance_events`** | `performance` |
| **`performance_inp`** | Interaction to Next Paint | Expanded from `performance_vitals` | **`performance_events`** | `performance` |
| **`performance_fcp`** | First Contentful Paint | SDK / navigation timing | **`performance_events`** | `performance` |
| **`performance_navigation`** | TTFB, navigation timing bundle | Expanded from `performance_vitals` | **`performance_events`** | `performance` |
| **`performance_resource`** | Slow resource loads | Performance observer | **`performance_events`** | `performance` |
| **`performance_long_task`** | Main-thread long tasks | Performance observer | **`performance_events`** | `performance` |
| **`performance_memory`** | JS heap memory snapshot | Performance API | **`performance_events`** | `performance` |

**Dashboard use:** `/api/analytics/behavior/performance`.

---

### 7. Errors (`error_events`)

| Event name | Purpose | How it is fired | Stored in | `event_catalog` source |
|------------|---------|-----------------|-----------|------------------------|
| **`error`** | JavaScript, fetch, XHR, resource load errors | Auto when `trackErrors !== false` | **`error_events`** | `error` |

Properties include: `type` (`javascript`, `fetch`, `xhr`, `resource`, `unhandledrejection`), `message`, `stack`, `url`, `status`.

**Dashboard use:** `/errors` page, `/api/analytics/errors`.

---

### 8. Ecommerce (via SDK helpers → `custom_events` today)

| Event name | Purpose | How it is fired | Stored in | `event_catalog` source |
|------------|---------|-----------------|-----------|------------------------|
| **`product_view`** | Product detail viewed | `WorktualAnalytics.productView({...})` | **`custom_events`** | `ecommerce` |
| **`add_to_cart`** | Item added to cart | `addToCart({...})` | **`custom_events`** | `ecommerce` |
| **`remove_from_cart`** | Item removed | `removeFromCart({...})` | **`custom_events`** | `ecommerce` |
| **`add_to_wishlist`** | Item saved to wishlist | `addToWishlist({...})` | **`custom_events`** → **`fact_product_interactions`** | `ecommerce` |
| **`remove_from_wishlist`** | Item removed from wishlist | `removeFromWishlist({...})` | **`custom_events`** → **`fact_product_interactions`** | `ecommerce` |
| **`begin_checkout`** | Checkout started | `beginCheckout({...})` | **`custom_events`** | `ecommerce` |
| **`purchase`** | Order completed | `purchase({ orderId, revenue, ... })` | **`custom_events`** | `ecommerce` |
| **`refund`** | Order refunded | `refund({...})` | **`custom_events`** | `ecommerce` |

**Note:** Tables `product_interactions` and `conversion_events` exist in schema for rollups/backfill; current ETL writes ecommerce SDK events to **`custom_events`** with `event_data` JSON.

---

### 9. Identity & user (no fact row — updates profiles / metadata)

| Event name | Purpose | How it is fired | Stored in | `event_catalog` source |
|------------|---------|-----------------|-----------|------------------------|
| **`identify`** | Link browser to known user ID (CRM, login ID) | `WorktualAnalytics.identify(userId, traits)` | **`visitors.user_id`**, **`sessions.user_id`** via payload `userId`; event itself not stored as fact | — |
| **`alias`** | Declare two IDs are same person | `alias(oldId, newId)` | Event tracked but **not** stored in fact tables | — |
| **`group`** | Associate user with account/org | `group(groupId, props)` | localStorage + event only | — |
| **`login`** | User logged in | `login({ userId, ... })` | Calls `identify` + **`custom_events`** for login event? — login is in exclude list, so **no custom row**; sets `user_id` | — |
| **`logout`** | User logged out | `logout()` | Resets identity; excluded from facts | — |
| **`signup`** | User registered | `signup(props)` | If `props.userId` → identify; signup excluded from custom insert | — |
| **`user_properties`** | Update user trait dictionary | `setUserProperties(traits)` | **`custom_events`** (unless excluded — not in exclude list, so **yes custom_events**) | `custom` |

**Important:** `identify()` sets `user_id` on the payload. ETL stores it on `visitors` and `sessions`. It does **not** change `visitor_id`.

---

### 10. Custom events (your own)

Any event name matching the pattern that is **not** in the built-in list is a **custom event**. The SDK automatically adds **`event_mode: "custom"`** at the event root (sibling of `name`, `ts`, `pid`) so CDP exports can filter owner-defined events:

```json
{
  "eventId": "evt_abc",
  "name": "newsletter_signup",
  "event_mode": "custom",
  "ts": 1730000000000,
  "pid": "pg_home",
  "props": { "source": "footer" }
}
```

Built-in events (`page_view`, `click`, `form_*`, `purchase`, etc.) never include `event_mode`.

| Event name | Purpose | How it is fired | Stored in | `event_catalog` source |
|------------|---------|-----------------|-----------|------------------------|
| **`*` (your name)** | Any business action you define | `WorktualAnalytics.track('your_event', { ... })` | **`custom_events`** | `custom` |

**SDK auto-tracked (built-in, no `event_mode`):** `outbound_link`, `file_download`, `site_search`, `heartbeat`, `user_active`, `user_idle`, `page_visible`, `page_hidden`.

---

## How to create a custom event

### Step 1 — Initialize SDK

```javascript
WorktualAnalytics.init({
  domainId: 12345,
  domainName: 'beta.worktual.co.uk',
  endpoint: 'https://your-api/v1/tracking/collect',
});
```

### Step 2 — Track your event

```javascript
WorktualAnalytics.track('newsletter_signup', {
  plan: 'pro',
  source: 'homepage_hero',
  buttonId: 'cta-subscribe',
});
```

### Step 3 — Naming rules

```javascript
// ✅ Valid
WorktualAnalytics.track('button_clicked', { section: 'pricing' });
WorktualAnalytics.track('video_play', { videoId: 'intro-2026' });

// ❌ Invalid (rejected at ingest)
WorktualAnalytics.track('Button-Clicked');  // uppercase / hyphen
WorktualAnalytics.track('123_start');       // must start with letter
```

### Step 4 — Optional: identify user before/after

```javascript
WorktualAnalytics.identify('CRM-LEAD-99', { email: 'user@example.com' });
WorktualAnalytics.track('demo_requested', { product: 'enterprise' });
```

---

## Where custom events are stored

### Table: `custom_events`

| Column | What is stored |
|--------|----------------|
| `id` | Internal row id (composite PK with `created_at`) |
| `page_view_id` | Page context at time of event |
| `session_id` | Session id |
| `visitor_id` | Browser cookie id |
| `domain_id` | Site id |
| **`event_name`** | **Your custom name** (e.g. `newsletter_signup`) |
| **`event_data`** | **JSONB** — `{ "properties": { ...your props... }, "source": "events_v2" }` |
| `created_at` | Timestamp (partition key — monthly) |

### Registry: `event_catalog`

One row per `(domain_id, event_name, event_source='custom')`:

- `total_count` increments each time the event fires  
- `first_seen_at` / `last_seen_at` updated  

### Example query

```sql
SELECT event_name, event_data->'properties' AS props, created_at
FROM custom_events
WHERE domain_id = 12345
  AND event_name = 'newsletter_signup'
ORDER BY created_at DESC
LIMIT 20;
```

### API explorer

```
GET /api/analytics/custom-events?period=overall
```

Returns event names with counts and last seen (dashboard Custom Events explorer).

---

## Storage map summary (event name → table)

| Database table | Event names routed here |
|----------------|-------------------------|
| **`page_views`** | `page_view`, `page_transition` (as page view) |
| **`interaction_events`** | `click`, `move`, `scroll`, `rage_click`, `dead_click`, `hover` |
| **`form_events`** | `form_view`, `form_start`, `form_focus`, `form_blur`, `form_change`, `form_validation`, `form_submit`, `form_success`, `form_failure`, `form_abandon` |
| **`performance_events`** | `performance_lcp`, `performance_cls`, `performance_inp`, `performance_fcp`, `performance_navigation`, `performance_resource`, `performance_long_task`, `performance_memory` |
| **`error_events`** | `error` |
| **`custom_events`** | All other track names + ecommerce + auto extras (see sections above) |
| **`page_views` column update only** | `scroll_depth`, `scroll_milestone` → updates `max_scroll_depth` |
| **`visitors` / `sessions` update** | `identify`, `login` (via payload `userId`) — no dedicated fact row |
| **Not stored as facts** | `identify`, `alias`, `group`, `logout`, `signup` (identity control events) |
| **`raw_payloads`** | Entire batch JSON (all events together) |

---

## `event_catalog` — what gets registered

After ETL processes events, these **`event_source`** values appear in `event_catalog`:

| `event_source` | Meaning |
|----------------|---------|
| `events_v2` | Core page views |
| `interaction` | Heatmap / click events |
| `form` | Form funnel events |
| `performance` | Web vitals / timing |
| `error` | JS/network errors |
| `ecommerce` | product_view, purchase, … |
| `custom` | Custom + auto engagement events |

Query catalog:

```sql
SELECT event_name, event_source, total_count, first_seen_at, last_seen_at
FROM event_catalog
WHERE domain_id = 12345
ORDER BY total_count DESC;
```

---

## SDK configuration vs automatic events

| Config flag | Default | Controls |
|-------------|---------|----------|
| `autoTrack` | `true` | `page_view`, SPA, engagement, outbound, download, search |
| `trackHeatmap` | `true` | `click`, `move`, `rage_click`, `dead_click`, `hover` |
| `trackForms` | `true` | All `form_*` events |
| `trackPerformance` | `true` | `performance_vitals` → split vitals |
| `trackErrors` | `true` | `error` |
| `trackHeartbeat` | `true` | `heartbeat` |
| `trackScroll` | `true` | `scroll_milestone` / scroll depth |
| `trackJourney` | `true` | `page_transition` |

Disable example:

```javascript
WorktualAnalytics.init({
  domainId: 12345,
  trackHeatmap: false,   // fewer click/move events
  trackHeartbeat: false, // no heartbeat custom events
});
```

---

## Quick reference — all known event names (alphabetical)

```
add_to_cart          begin_checkout       click
conversion (N/A SDK) custom (* yours)     dead_click
error                file_download        form_abandon
form_blur            form_change          form_failure
form_focus           form_start           form_submit
form_success         form_validation      form_view
group                heartbeat            hover
identify             login                logout
move                 outbound_link        page_hidden
page_transition      page_view            page_visible
performance_cls      performance_fcp      performance_inp
performance_lcp      performance_long_task performance_memory
performance_navigation performance_resource performance_vitals
product_view         purchase             rage_click
refund               remove_from_cart     scroll
scroll_depth         scroll_milestone     signup
site_search          user_active          user_idle
user_properties      alias
```

---

## Related documentation

| File | Content |
|------|---------|
| `docs/DATABASE_TABLES_RETENTION.md` | ClickHouse tables, TTL, materialized views |
| `clickhouse/ddl/` | Schema source of truth |

---

*Event names from SDK source (`sdk/src/`) and ingest validation (`etl/ingest/validation.py`). Pipeline: `raw_payloads` → `events_staging` → `fact_*` via ClickHouse materialized views.*
