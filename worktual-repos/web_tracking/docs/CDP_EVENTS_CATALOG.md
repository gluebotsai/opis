# Worktual Web Tracking — CDP Events Catalog

Complete reference for the **CDP team**: every event name, what it is used for, what data it contains, and where it is stored.

**Related docs**

| Document | Purpose |
|----------|---------|
| [CDP_CAMPAIGN_ATTRIBUTION_REFERENCE.md](./CDP_CAMPAIGN_ATTRIBUTION_REFERENCE.md) | Campaign email clicks → payload → ClickHouse |
| [CDP_PAYLOAD_FIELD_REFERENCE.md](./CDP_PAYLOAD_FIELD_REFERENCE.md) | Every JSON key in the ingest envelope |
| [CDP_DEMO_PAYLOAD.json](./CDP_DEMO_PAYLOAD.json) | Full worked `events_v3` example |
| [CDP_REPLAY_DEMO_PAYLOAD.json](./CDP_REPLAY_DEMO_PAYLOAD.json) | Session replay chunk example |
| [CLICKHOUSE_CDP_REFERENCE.md](./CLICKHOUSE_CDP_REFERENCE.md) | ClickHouse `fact_*` column reference |

**Ingest endpoint (QA):** `POST https://qatrackingapi.worktual.com/webtracking/v1/tracking/nfs-ingestions`  
**Payload type:** `events_v3` (SDK default)

---

## 1. How events are sent

Each HTTP POST contains one **batch** with up to **100 events**. Shared context lives in `profiles` (browser, visitor, session, campaign, pages). Each event in `events[]` references pages/campaign via `pid` and `cid`.

```json
{
  "type": "events_v3",
  "domainId": 12345,
  "domainName": "demo.worktual.co.uk",
  "visitorId": "visitor_abc",
  "sessionId": "session_xyz",
  "userId": "crm_user_99",
  "profiles": { "browser": {}, "visitor": {}, "session": {}, "campaign": {}, "pages": {} },
  "events": [
    {
      "eventId": "evt_unique_id",
      "name": "page_view",
      "ts": 1730000000000,
      "pid": "pg_home",
      "cid": "cp_001",
      "props": { "path": "/", "title": "Home" }
    }
  ]
}
```

### Common fields on every event

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `eventId` | string | Yes | Unique ID for deduplication (`evt_…` or UUID) |
| `name` | string | Yes | Event type in `snake_case` (max 64 chars) |
| `ts` | integer | Yes | When the event occurred — Unix **milliseconds** |
| `pid` | string | No | Page ID → `profiles.pages[pid]` (path, title) |
| `cid` | string | No | Campaign ID → `profiles.campaign` (UTM, click IDs, `wt_*`) |
| `props` | object | No | Event-specific data (max 50 keys, depth 4) |
| `event_mode` | string | No | **`"custom"` only** on owner-defined events; omitted on built-ins |

### Event naming rules

| Rule | Value |
|------|--------|
| Pattern | `^[a-z][a-z0-9_]{0,63}$` |
| Custom events | Any valid name **not** in the built-in list below |
| Custom marker | SDK sets `event_mode: "custom"` on custom events |

**Built-in event count:** 52 (listed below) + unlimited custom events + separate `replay_chunk_v1` payload.

---

## 2. Storage map (ClickHouse)

After ingest, events are written to **`raw_payloads`** (bronze audit), then fan-out via materialized views:

| ClickHouse table | Event names stored here |
|------------------|-------------------------|
| `fact_page_views` | `page_view` |
| `fact_interaction_events` | `click`, `move`, `scroll`, `scroll_depth`, `rage_click`, `dead_click`, `hover` |
| `fact_form_events` | All `form_*` (10 events) |
| `fact_performance_events` | All `performance_*` |
| `fact_error_events` | `error` |
| `fact_product_interactions` | `product_view`, `add_to_cart`, `remove_from_cart`, `add_to_wishlist`, `remove_from_wishlist`, `begin_checkout` |
| `fact_conversion_events` | `purchase`, `refund`, `signup`, `login`, `begin_checkout` |
| `fact_custom_events` | Identity/engagement built-ins + **all custom event names** + catch-all (e.g. `outbound_link`, `page_transition`) |
| `fact_replay_chunks` | `replay_chunk_v1` (separate payload, not in `events[]`) |
| `dim_visitors` / `dim_sessions` | Updated from every batch (session-level attribution, device, geo) |

**Pipeline transforms (important for CDP):**

| SDK sends | Stored as | Notes |
|-----------|-----------|-------|
| `scroll_milestone` | `scroll_depth` in `fact_interaction_events` | Renamed in MV |
| `performance_vitals` | `performance_navigation` in `fact_performance_events` | Single combined row |

Full `props` JSON is stored in `extra_data` (most fact tables) or `event_data` (`fact_custom_events`).

---

## 3. Email / campaign attribution (not an event)

Worktual Campaign **email clicks** (`?wt=` 30-char token) do **not** use a separate event name. The landing page sets **`profiles.campaign.lastTouch`** with decoded token fields:

| Field | Description |
|-------|-------------|
| `wt_organization_id` (alias `wt_org_id`) | Organization from token |
| `wt_campaign_id` | Campaign DB id |
| `wt_contact_id` | Contact / customer id (`0` = unknown) |
| `wt_channel` | e.g. `"email"` |
| `utm_source`, `utm_medium`, `utm_campaign`, … | Standard UTM + ad click IDs |

These flow to **`dim_sessions`**: `wt_organization_id`, `wt_campaign_id`, `wt_contact_id`.  
WhatsApp, LinkedIn, ads, etc. use normal SDK UTM capture on the customer site.

---

## 4. Built-in events — full catalog

For each event: **purpose**, **how it fires**, **`props` data**, **ClickHouse destination**.

---

### 4.1 Page & navigation

#### `page_view`

| | |
|---|---|
| **Purpose** | Record a page load or SPA navigation — core traffic metric |
| **Trigger** | SDK auto when `autoTrack: true` (initial load + history changes) |
| **ClickHouse** | `fact_page_views` |
| **Dashboard use** | Page views, top pages, visitor journeys, landing pages |

**`props` fields:**

| Field | Type | Description |
|-------|------|-------------|
| `pageName` | string | Logical page name (site-defined) |
| `path` | string | URL path (+ query if present) |
| `title` | string | Document title |

---

#### `page_transition`

| | |
|---|---|
| **Purpose** | SPA journey step: user moved from page A → B with dwell time on previous page |
| **Trigger** | SDK auto when `trackJourney !== false` |
| **ClickHouse** | `fact_custom_events` (also contributes to session pageview count in `dim_sessions`) |
| **Dashboard use** | Journey analysis, time-on-page between steps |

**`props` fields:**

| Field | Type | Description |
|-------|------|-------------|
| `fromPageId` | string | Previous page ID (`profiles.pages` key) |
| `toPageId` | string | New page ID |
| `duration` | integer | Milliseconds spent on previous page |

---

#### `page_visible`

| | |
|---|---|
| **Purpose** | Browser tab/window became visible again |
| **Trigger** | SDK auto (`document.visibilitychange`) |
| **ClickHouse** | `fact_custom_events` |
| **Dashboard use** | Engagement / attention metrics |

**`props`:** empty object `{}`

---

#### `page_hidden`

| | |
|---|---|
| **Purpose** | Tab hidden or user switched away; also triggers Web Vitals send |
| **Trigger** | SDK auto (`document.visibilitychange`) |
| **ClickHouse** | `fact_custom_events` |
| **Dashboard use** | Session quality, exit timing |

**`props`:** empty object `{}`

---

### 4.2 Engagement & session

#### `user_active`

| | |
|---|---|
| **Purpose** | User returned from idle (mouse, keyboard, scroll, touch) |
| **Trigger** | SDK auto after idle timeout (default 30s) |
| **ClickHouse** | `fact_custom_events` |

**`props`:** empty object `{}`

---

#### `user_idle`

| | |
|---|---|
| **Purpose** | No user activity for configured idle period |
| **Trigger** | SDK auto (default 30s / 300000 ms) |
| **ClickHouse** | `fact_custom_events` |

**`props` fields:**

| Field | Type | Description |
|-------|------|-------------|
| `idleMs` | integer | Idle threshold in ms (e.g. `300000`) |

---

#### `heartbeat`

| | |
|---|---|
| **Purpose** | Periodic “still on site” ping while user is active and tab is visible |
| **Trigger** | SDK auto when `trackHeartbeat: true` (default on), every ~30s |
| **ClickHouse** | `fact_custom_events` |
| **Dashboard use** | Live users, session duration refinement |

**`props` fields:**

| Field | Type | Description |
|-------|------|-------------|
| `intervalMs` | integer | Heartbeat interval (e.g. `30000`) |

---

### 4.3 Clicks, scroll & heatmap

#### `click`

| | |
|---|---|
| **Purpose** | User clicked an element — heatmap coordinates + element metadata |
| **Trigger** | SDK auto via heatmap module and/or auto click tracking |
| **ClickHouse** | `fact_interaction_events` |
| **Dashboard use** | Heatmaps, click analytics, element performance |

**`props` fields:**

| Field | Type | Description |
|-------|------|-------------|
| `x`, `y` | number | Viewport coordinates |
| `pageX`, `pageY` | number | Page coordinates |
| `viewportW`, `viewportH` | number | Viewport size at click time |
| `element` | string | CSS selector path |
| `elementType` | string | Tag name (e.g. `A`, `BUTTON`) |
| `elementText` | string | Visible text (truncated) |
| `text` | string | Link/button label |
| `href` | string | Link URL if applicable |

---

#### `move`

| | |
|---|---|
| **Purpose** | Mouse movement sample for heatmap trails |
| **Trigger** | SDK auto when `trackMove: true` (sampled ~1s / 25px) |
| **ClickHouse** | `fact_interaction_events` |

**`props` fields:** `x`, `y`, `viewportW`, `viewportH`

---

#### `hover`

| | |
|---|---|
| **Purpose** | Mouse hovered over an element |
| **Trigger** | SDK auto when `trackHover: true` |
| **ClickHouse** | `fact_interaction_events` |

**`props` fields:** `x`, `y`, `element`, `elementType`, `elementText`, `href`

---

#### `rage_click`

| | |
|---|---|
| **Purpose** | UX frustration — 3+ rapid clicks in the same spot |
| **Trigger** | SDK auto (heatmap rage detector) |
| **ClickHouse** | `fact_interaction_events` |
| **Dashboard use** | Frustration signals, broken UI detection |

**`props` fields:** `x`, `y`, `clickCount`

---

#### `dead_click`

| | |
|---|---|
| **Purpose** | Click on non-interactive area (no handler / no effect) |
| **Trigger** | SDK auto (heatmap dead-click detector) |
| **ClickHouse** | `fact_interaction_events` |

**`props` fields:** `x`, `y`, `reason` (e.g. `non_interactive`)

---

#### `scroll_milestone`

| | |
|---|---|
| **Purpose** | User reached a scroll depth milestone (25, 50, 75, 90, 100%) |
| **Trigger** | SDK auto when `trackScroll: true` |
| **ClickHouse** | `fact_interaction_events` (stored as `scroll_depth`) |
| **Dashboard use** | Scroll depth reports, content engagement |

**`props` fields:**

| Field | Type | Description |
|-------|------|-------------|
| `milestone` | integer | Percent reached (25, 50, …) |
| `maxDepth` | integer | Maximum scroll depth so far (%) |

---

#### `scroll_depth`

| | |
|---|---|
| **Purpose** | Scroll depth value (alias / direct send) |
| **Trigger** | Manual `track('scroll_depth', …)` or pipeline alias of `scroll_milestone` |
| **ClickHouse** | `fact_interaction_events` |

**`props` fields:** `milestone`, `maxDepth`, optionally `scrollY`

---

#### `scroll`

| | |
|---|---|
| **Purpose** | Raw scroll position (reserved — SDK does not auto-fire) |
| **Trigger** | Manual only: `WorktualAnalytics.track('scroll', { … })` |
| **ClickHouse** | `fact_interaction_events` |

**`props` fields:** `scrollY`, `maxDepth`

---

### 4.4 Auto tracking — links, downloads, search

#### `outbound_link`

| | |
|---|---|
| **Purpose** | User clicked a link to an external domain |
| **Trigger** | SDK auto on external `<a>` clicks |
| **ClickHouse** | `fact_custom_events` |

**`props` fields:** `href`, `text`

---

#### `file_download`

| | |
|---|---|
| **Purpose** | User clicked a file download link (pdf, zip, doc, …) |
| **Trigger** | SDK auto on download link clicks |
| **ClickHouse** | `fact_custom_events` |

**`props` fields:** `href`, `fileName`

---

#### `site_search`

| | |
|---|---|
| **Purpose** | Internal site search submitted |
| **Trigger** | SDK auto on search form submit |
| **ClickHouse** | `fact_custom_events` |

**`props` fields:**

| Field | Type | Description |
|-------|------|-------------|
| `query` | string | Search query (may be truncated/masked) |
| `formId` | string | Form identifier |

---

### 4.5 Form analytics (10 events)

All form events share these **`props`** keys where applicable:

| Field | Description |
|-------|-------------|
| `formId` | Stable form ID (HTML `id`, `data-wt-form`, or registered ID) |
| `formName` | Human-readable label |
| `formAction` | Submit URL or API endpoint |
| `fieldName` | Field name (focus/blur/change/validation events) |
| `fieldType` | Input type (`email`, `textarea`, …) |
| `fieldValue` | Field value on change (passwords masked) |
| `valid` | Boolean — validation result |
| `fields` | Map of field name → value on submit/success |
| `reason` / `errorCode` | Failure reason on `form_failure` |
| `leadId` | Optional CRM lead ID on success |

**ClickHouse (all):** `fact_form_events`  
**Trigger default:** `trackForms: true`  
**Dashboard use:** Form funnel, field-level analytics, abandonment

| Event | Purpose | When it fires |
|-------|---------|---------------|
| **`form_view`** | Form entered viewport | `IntersectionObserver` |
| **`form_start`** | First interaction with form | First `focusin` on any field |
| **`form_focus`** | Field received focus | `focusin` |
| **`form_blur`** | Field lost focus | `focusout` |
| **`form_change`** | Field value changed | `change` / `input` |
| **`form_validation`** | HTML5 validation failed | `invalid` event |
| **`form_submit`** | Submit attempted | `submit` |
| **`form_success`** | Submit succeeded | Manual: `WorktualAnalytics.trackFormSuccess(form, props)` for AJAX |
| **`form_failure`** | Submit failed | Manual: `trackFormFailure(form, props)` |
| **`form_abandon`** | Left page with started but incomplete form | `beforeunload` |

---

### 4.6 Performance (9 events)

**ClickHouse (all):** `fact_performance_events`  
**Trigger default:** `trackPerformance: true`  
**Dashboard use:** Web Vitals, performance page

#### `performance_vitals` *(SDK primary)*

| | |
|---|---|
| **Purpose** | Combined Core Web Vitals snapshot sent once on page hide |
| **Trigger** | SDK auto when tab hidden / page unload |
| **ClickHouse** | Stored as `performance_navigation` (single row) |

**`props` fields:** `lcp`, `cls`, `inp`, `fcp`, `ttfb`, `lcpRating`, `clsRating`, `inpRating`

#### Individual performance events *(manual / legacy)*

| Event | Purpose | Typical `props` |
|-------|---------|-----------------|
| `performance_lcp` | Largest Contentful Paint | `value`, `rating`, `lcp` |
| `performance_cls` | Cumulative Layout Shift | `value`, `rating`, `cls` |
| `performance_inp` | Interaction to Next Paint | `value`, `rating`, `inp` |
| `performance_fcp` | First Contentful Paint | `value`, `fcp` |
| `performance_navigation` | Navigation timing | `domContentLoaded`, `loadEventEnd`, `ttfb` |
| `performance_resource` | Slow resource load | `name`, `duration`, `transferSize` |
| `performance_long_task` | Main-thread block | `duration`, `startTime` |
| `performance_memory` | JS heap snapshot | `usedJSHeapSize`, `totalJSHeapSize` |

---

### 4.7 Errors

#### `error`

| | |
|---|---|
| **Purpose** | JavaScript, network, or resource load failures |
| **Trigger** | SDK auto when `trackErrors: true` |
| **ClickHouse** | `fact_error_events` |
| **Dashboard use** | Errors page, stability monitoring |

Discriminate by **`props.type`**:

| `props.type` | Description | Key `props` fields |
|--------------|-------------|-------------------|
| `javascript` | Uncaught JS error | `message`, `filename`, `lineno`, `colno`, `stack` |
| `unhandledrejection` | Unhandled Promise rejection | `message`, `stack` |
| `fetch` | Failed `fetch()` | `url`, `status`, `statusText` or `message` |
| `xhr` | Failed XMLHttpRequest | `url`, `method`, `status` or `message` |
| `resource` | Failed image/script/CSS load | `tagName`, `src` |

---

### 4.8 Ecommerce (6 events)

#### `product_view`

| | |
|---|---|
| **Purpose** | Product detail page viewed |
| **Trigger** | Manual: `WorktualAnalytics.productView({ … })` |
| **ClickHouse** | `fact_product_interactions` |

#### `add_to_cart`

| | |
|---|---|
| **Purpose** | Item added to cart |
| **Trigger** | Manual: `addToCart({ … })` |
| **ClickHouse** | `fact_product_interactions` |

#### `remove_from_cart`

| | |
|---|---|
| **Purpose** | Item removed from cart |
| **Trigger** | Manual: `removeFromCart({ … })` |
| **ClickHouse** | `fact_product_interactions` |

#### `add_to_wishlist`

| | |
|---|---|
| **Purpose** | Item saved to wishlist |
| **Trigger** | Manual: `addToWishlist({ … })` |
| **ClickHouse** | `fact_product_interactions` |

#### `remove_from_wishlist`

| | |
|---|---|
| **Purpose** | Item removed from wishlist |
| **Trigger** | Manual: `removeFromWishlist({ … })` |
| **ClickHouse** | `fact_product_interactions` |

#### `begin_checkout`

| | |
|---|---|
| **Purpose** | Checkout flow started |
| **Trigger** | Manual: `beginCheckout({ … })` |
| **ClickHouse** | `fact_product_interactions` **and** `fact_conversion_events` (dual-routed) |

**Product event `props` (view / cart):**

| Field | Description |
|-------|-------------|
| `productId` | Product ID (or `sku`) |
| `productName` | Display name |
| `productCategory` | Category |
| `productPrice` | Unit price |
| `currency` | ISO code (GBP, USD, …) |
| `quantity` | Item count |
| `sku` | Stock keeping unit |
| `brand` | Brand name |

**`begin_checkout` open props:** e.g. `cartValue`, `currency`, `itemCount`, `coupon`

#### `purchase`

| | |
|---|---|
| **Purpose** | Order completed — primary conversion |
| **Trigger** | Manual: `purchase({ orderId, revenue, … })` |
| **ClickHouse** | `fact_conversion_events` (`conversion_type=purchase`, `value=revenue`) |

#### `refund`

| | |
|---|---|
| **Purpose** | Order refunded (full or partial) |
| **Trigger** | Manual: `refund({ … })` |
| **ClickHouse** | `fact_conversion_events` |

**`purchase` / `refund` `props`:**

| Field | Description |
|-------|-------------|
| `orderId` | Order / transaction ID |
| `revenue` | Total monetary value |
| `currency` | ISO currency code |
| `tax` | Tax amount |
| `shipping` | Shipping cost |
| `products` | Array of line items (same product keys as above) |

---

### 4.9 Identity & user (7 events)

| Event | Purpose | Trigger | ClickHouse | Key `props` |
|-------|---------|---------|------------|-------------|
| **`identify`** | Link anonymous visitor to known CRM user | `WorktualAnalytics.identify(userId, traits)` | `fact_custom_events` + updates `dim_visitors.user_id` | `userId`, `previousAnonymousId`, `traits` |
| **`alias`** | Declare two IDs are the same person | `alias(oldId, newId)` | `fact_custom_events` | `oldId`, `newId` |
| **`group`** | B2B account / org association | `group(groupId, props)` | `fact_custom_events` | `groupId`, … |
| **`login`** | User authenticated | `login({ userId, method, … })` | `fact_conversion_events` | `userId`, `method`, … |
| **`logout`** | User signed out | `logout()` | `fact_custom_events` | *(empty)* |
| **`signup`** | New account registered | `signup({ userId, method, source, … })` | `fact_conversion_events` | `userId`, `method`, `source`, … |
| **`user_properties`** | Update user trait dictionary | `setUserProperties(traits)` | `fact_custom_events` | `traits` (object) |

**Notes for CDP:**

- `identify` / `login` / `signup` also set top-level `userId` on the batch.
- `profiles.visitor.traits` carries CRM attributes on every subsequent batch.
- `visitorId` (cookie) stays stable; `userId` links to known identity.

---

## 5. Custom events (unlimited)

Any event name matching the naming rules that is **not** in the 52 built-ins is a **custom event**.

| | |
|---|---|
| **Purpose** | Business-specific actions defined by the website owner |
| **Trigger** | `WorktualAnalytics.track('your_event_name', { … })` or server-side POST |
| **ClickHouse** | `fact_custom_events` |
| **CDP filter** | `event.event_mode === "custom"` OR name ∉ built-in list |

**SDK automatically adds:** `event_mode: "custom"` on the event object.

**Example:**

```javascript
WorktualAnalytics.track('newsletter_signup', {
  listId: 'footer_promo',
  source: 'homepage',
  email_domain: 'worktual.co.uk',
});
```

**Example payload:**

```json
{
  "eventId": "evt_custom_001",
  "name": "newsletter_signup",
  "event_mode": "custom",
  "ts": 1730000000000,
  "pid": "pg_home",
  "props": {
    "listId": "footer_promo",
    "source": "homepage",
    "email_domain": "worktual.co.uk"
  }
}
```

**Demo custom events** (see [CDP_DEMO_PAYLOAD.json](./CDP_DEMO_PAYLOAD.json)):

| Event name | Example `props` | Meaning |
|------------|-----------------|---------|
| `article_read` | `articleId`, `category`, `readPercent`, `timeOnPageSec` | Blog engagement |
| `newsletter_signup` | `listId`, `source`, `email_domain` | Newsletter subscription |
| `brochure_download` | `brochureId`, `format`, `language` | Marketing PDF download |
| `cdp_integration_test` | `source`, `testId`, `journey`, `metadata` | CDP pipeline test |

**Constraints:** max 50 keys in `props`, nesting depth 4, snake_case name.

---

## 6. Session replay (`replay_chunk_v1`)

Not an event in `events[]`. Separate POST with `type: "replay_chunk_v1"`.

| | |
|---|---|
| **Purpose** | DOM/session replay for playback in dashboard |
| **Trigger** | SDK auto when `trackReplay !== false` (rrweb recorder) |
| **ClickHouse** | `fact_replay_chunks` |

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | string | Yes | Must be `replay_chunk_v1` |
| `domainId`, `domainName` | — | Yes | Site identity |
| `visitorId`, `sessionId` | string | Yes | Join to analytics session |
| `pageViewId` | string | Yes | Links chunk to one page view |
| `chunkIndex` | integer | Yes | Sequential order (0, 1, 2, …) |
| `chunkId` | string (UUID) | Yes | Deduplication |
| `encoding` | string | Yes | Always `gzip_b64` |
| `eventsData` | string | Yes | gzip + base64 rrweb recording bytes |
| `eventCount` | integer | Yes | Records in this chunk |
| `source` | string | No | Recorder library (default `rrweb`) |

See [CDP_REPLAY_DEMO_PAYLOAD.json](./CDP_REPLAY_DEMO_PAYLOAD.json).

---

## 7. SDK configuration vs events

| Config flag | Default | Events controlled |
|-------------|---------|-------------------|
| `autoTrack` | `true` | `page_view`, SPA navigation, engagement, outbound, download, search |
| `trackHeatmap` | `true` | `click`, `move`, `rage_click`, `dead_click`, `hover` |
| `trackHeatmapClicks` | `true` | Heatmap vs generic auto click |
| `trackMove` | `false` | `move` |
| `trackHover` | `false` | `hover` |
| `trackForms` | `true` | All `form_*` |
| `trackPerformance` | `true` | `performance_vitals` |
| `trackErrors` | `true` | `error` |
| `trackHeartbeat` | `true` | `heartbeat` |
| `trackScroll` | `true` | `scroll_milestone` |
| `trackJourney` | `true` | `page_transition` |
| `trackReplay` | `true` | `replay_chunk_v1` chunks |
| `geolocation` | `false` | Populates `profiles.location` (GPS) |

---

## 8. CDP integration checklist

1. **Filter custom events:** `event.event_mode === "custom"` or name not in [built-in list](#9-alphabetical-index-52-built-ins).
2. **Page context:** `event.pid` → `profiles.pages[event.pid].path` and `.title`.
3. **Campaign / email attribution:** `profiles.campaign.lastTouch` / `firstTouch` → `dim_sessions` UTM + `wt_*` columns.
4. **Known user:** top-level `userId` or `profiles.visitor.traits`.
5. **Timestamps:** all client times are Unix **milliseconds**.
6. **Raw audit:** full batch JSON in `raw_payloads` before MV fan-out.
7. **Deduplication:** `payloadId` (batch), `eventId` (event), `chunkId` (replay).

---

## 9. Alphabetical index (52 built-ins)

```
add_to_cart          alias                begin_checkout
click                dead_click           error
file_download        form_abandon         form_blur
form_change          form_failure         form_focus
form_start           form_submit          form_success
form_validation      form_view            group
heartbeat            hover                identify
login                logout               move
outbound_link        page_hidden          page_transition
page_view            page_visible         performance_cls
performance_fcp      performance_inp      performance_lcp
performance_long_task performance_memory  performance_navigation
performance_resource performance_vitals   product_view
purchase             rage_click           refund
remove_from_cart     scroll               scroll_depth
scroll_milestone     signup               site_search
user_active          user_idle            user_properties
```

Plus: **unlimited custom events** + **`replay_chunk_v1`** payload type.

---

## 10. Source code references

| Concern | File |
|---------|------|
| Built-in event names (SDK) | `sdk/src/core/event-names.js` |
| Built-in event names (ingest validation) | `etl/ingest/validation.py` |
| Payload builder | `sdk/src/core/context.js`, `sdk/src/core/payload.js` |
| ClickHouse MV routing | `clickhouse/ddl/05_materialized_views_pipeline.sql` |
| Fact table schemas | `clickhouse/ddl/03_silver_facts.sql` |

---

*Document version: aligned with SDK 3.x / `events_v3` / ClickHouse pipeline. Last updated for CDP team handoff.*
