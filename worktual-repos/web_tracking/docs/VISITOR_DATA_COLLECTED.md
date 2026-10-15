# Visitor Data Collection Reference

What information Worktual Web Analytics receives from a tracked website when a visitor browses with the SDK installed.

**Collection point:** Browser SDK → `POST /v1/tracking/collect` (or `/webtracking/v1/tracking/nfs-ingestions` in QA)  
**Storage:** ClickHouse `web_tracking` (analytics) · raw JSON audit in `raw_payloads`  
**Auth DB:** PostgreSQL is **not** used for visitor events — only admin login.

For event names and fact tables, see also [EVENTS_REFERENCE.md](./EVENTS_REFERENCE.md).

---

## 1. Summary by category

| Category | Examples | Source | Default |
|----------|----------|--------|---------|
| Identity & session | Visitor ID, session ID, optional user ID | SDK (cookie + localStorage) | On |
| Page & URL | Page path, title, referrer, landing URL | SDK (browser) | On (`autoTrack`) |
| Device & browser | Browser, OS, screen, viewport, language, timezone | SDK (browser APIs) | On |
| Marketing attribution | UTM params, gclid, fbclid, referrer | SDK (URL + referrer) | On (when present) |
| Location | Country, city, region (IP) · GPS (optional) | Server (IP GeoIP) + SDK (GPS if enabled) | IP on · GPS **off** |
| Interactions | Clicks, scroll depth, heatmap x/y, rage/dead clicks | SDK | Heatmap on · move/hover off |
| Forms | Field focus, change (masked), submit, abandon | SDK | On (`trackForms`) |
| Performance | LCP, CLS, INP, FCP, navigation timing | SDK | **Off** (`trackPerformance: false`) |
| Errors | JS errors, failed fetch/XHR | SDK | **Off** (`trackErrors: false`) |
| Ecommerce | Product view, cart, purchase | SDK helpers | On (`trackEcommerce`) |
| Custom events | Any business event you define | Your site via `track()` | When you call it |
| Server metadata | IP address, User-Agent | Ingest (HTTP request) | On |

---

## 2. Identity & session (every payload)

Sent on each batch to the ingest API.

| Field | Description | Storage |
|-------|-------------|---------|
| `domainId` | Site identifier (assigned to your account) | All facts |
| `domainName` | Hostname (e.g. `beta.worktual.co.uk`) | All facts |
| `visitorId` | Persistent anonymous ID (`visitor_…`) — first-party cookie, ~400 days | `dim_visitors` |
| `sessionId` | Session ID (`session_…`) — resets after 30 min idle by default | `dim_sessions` |
| `anonymousId` | Secondary anonymous ID in localStorage | Visitor profile |
| `userId` | **Only if you call** `WorktualAnalytics.identify(id)` | `dim_visitors.user_id`, sessions |
| `sdkVersion` | SDK build version | Payload metadata |
| `sentAt` | Client timestamp when batch was sent | Payload metadata |
| `payloadId` | Unique batch UUID (deduplication) | `raw_payloads` |

**Session profile** (sent once per session):

| Field | Description |
|-------|-------------|
| `startedAt` | Session start time |
| `landingPath` | First page path in session |
| `landingUrl` | Full landing URL |
| `referrer` | Document referrer or `direct` |
| `referrerDomain` | Parsed referrer hostname |
| `title` | Page title at session start |

**Visitor profile** (sent once per visitor):

| Field | Description |
|-------|-------------|
| `fingerprint` | Hash of browser/device signals (not hardware fingerprinting API) |
| `traits` | Key/value traits from `identify(userId, traits)` only |

---

## 3. Device & browser profile

Collected once per visitor (cached in localStorage), resent according to config.

| Field | Description |
|-------|-------------|
| `userAgent` | Full browser User-Agent string |
| `browser` / `browserVersion` | e.g. Chrome, Firefox, Safari |
| `engine` | Rendering engine (e.g. WebKit) |
| `os` | Windows, macOS, Linux, Android, iOS |
| `device` | `desktop`, `mobile`, or `tablet` |
| `language` | Primary language (`navigator.language`) |
| `languages` | Preferred languages list |
| `timezone` | IANA timezone (e.g. `Europe/London`) |
| `screen.width` / `screen.height` / `colorDepth` | Physical screen |
| `viewport.width` / `viewport.height` | Browser viewport at capture time |
| `dpr` | Device pixel ratio |
| `touch` | Touch support boolean |
| `cpu` | `navigator.hardwareConcurrency` (if available) |
| `memory` | `navigator.deviceMemory` GB (if available) |
| `connection` | Network effective type, downlink, RTT (if available) |

---

## 4. Page & navigation

| Data | When collected | Notes |
|------|----------------|-------|
| Page URL (`url`) | Every page view | Full URL including query string |
| Page path (`path`) | Every page view | Pathname + search |
| Page title | Every page view | `document.title` |
| Referrer | Page view / session | Previous page URL |
| Hash | Page context | URL fragment |
| SPA transitions | Auto journey tracking | From page A → B + time on page |
| Tab visibility | `page_visible` / `page_hidden` | When user switches tabs |
| Scroll depth | Scroll milestones | 25%, 50%, 75%, 90%, 100% (configurable) |
| Heartbeat | Every 30s while active | “Still on site” ping |
| Idle / active | After 30s no input | `user_idle` / `user_active` |

---

## 5. Marketing & traffic attribution

Parsed from landing URL query string and referrer (first-touch + last-touch).

**UTM parameters:**

- `utm_source`, `utm_medium`, `utm_campaign`, `utm_term`, `utm_content`

**Ad / click IDs:**

- `gclid`, `fbclid`, `msclkid`, `ttclid`, `twclid`, `gbraid`, `wbraid`, `li_fat_id`

**Referrer:**

- Full referrer URL and domain

Stored in campaign profile and rolled into session/traffic-source analytics.

---

## 6. Location data

### 6.1 IP-based (server-side — always on ingest)

Resolved from the visitor’s IP when the batch hits the ingest server (not from the browser directly).

| Field | Description |
|-------|-------------|
| `ip` | Client IP (from `X-Forwarded-For`, `X-Real-IP`, etc.) |
| `country` / `countryName` | ISO country code and name |
| `region` / `regionName` | State / region |
| `city` | City name |
| `lat` / `lon` | Approximate coordinates from GeoIP |
| `timezone` | Timezone from GeoIP database |

GeoIP uses MaxMind DB if `GEOIP_DB_PATH` is set, else optional HTTP fallback.

### 6.2 GPS (browser — **opt-in, default OFF**)

Only if `geolocation: true` in SDK init **and** the visitor grants browser permission.

| Field | Description |
|-------|-------------|
| `latitude` / `longitude` | GPS coordinates |
| `accuracy` | Meters |
| `altitude`, `heading`, `speed` | If available from device |
| `permission` | `granted`, `denied`, `unsupported` |

---

## 7. Interactions & heatmaps

| Data | Description | Default |
|------|-------------|---------|
| Click `x`, `y` | Viewport coordinates | On |
| `viewportW`, `viewportH` | Viewport size at click | On |
| Element tag | e.g. `button`, `a`, `div` | On |
| Element `type` | Input type if applicable | On |
| Element text | First ~N chars of visible text | On |
| `href` | Link URL if clicked element is a link | On |
| Mouse move samples | Trail for heatmap | **Off** (`trackMove: false`) |
| Hover events | Element hover | **Off** (`trackHover: false`) |
| Rage clicks | 3+ rapid clicks same area | On |
| Dead clicks | Click on non-interactive area | On |
| Outbound link clicks | External URL + link text | On |
| File download clicks | URL + file extension | On |
| Site search | Search query (**truncated/masked**) + form id | On |

---

## 8. Form analytics

When `trackForms: true` (default):

| Event | Data captured |
|-------|---------------|
| Form view | Form enters viewport |
| Form start / focus / blur | Field name, id, type |
| Form change | Field value — **masked** for sensitive fields |
| Form validation | Validation error type |
| Form submit / success / failure | Form id, name |
| Form abandon | Unsubmitted form on leave |

**Automatic masking** — values replaced with `[MASKED]` for:

- Input types: `password`, `hidden`
- Field names/ids/autocomplete matching: password, token, cvv, ssn, pin, secret, etc.
- Custom event properties with sensitive key names → `[REDACTED]`

Search queries are truncated/masked before send.

---

## 9. Performance metrics (optional)

When `trackPerformance: true`:

| Metric | Description |
|--------|-------------|
| LCP | Largest Contentful Paint |
| CLS | Cumulative Layout Shift |
| INP | Interaction to Next Paint |
| FCP | First Contentful Paint |
| Navigation timing | TTFB, DOM load, etc. |
| Resource timing | Slow resource loads |
| Long tasks | Main-thread blocking |
| Memory | JS heap snapshot (if API available) |

**Default: off.**

---

## 10. JavaScript errors (optional)

When `trackErrors: true`:

| Field | Description |
|-------|-------------|
| Error type | `javascript`, `fetch`, `xhr`, `resource`, `unhandledrejection` |
| Message | Error message |
| Stack trace | Stack string (if available) |
| URL | Script or page URL |
| HTTP status | For network errors |

**Default: off.**

---

## 11. Ecommerce (when you use SDK helpers)

| Event | Typical properties |
|-------|-------------------|
| `product_view` | Product id, name, price, category |
| `add_to_cart` / `remove_from_cart` | Product, quantity, price |
| `begin_checkout` | Cart value, items |
| `purchase` | Order id, revenue, currency, items |
| `refund` | Order id, amount |

Only sent when your site calls the ecommerce helpers or `track()` with these names.

---

## 12. Custom events

Your site can send any event name matching `^[a-z][a-z0-9_]{0,63}$` via:

```javascript
WorktualAnalytics.track('newsletter_signup', { plan: 'pro', source: 'hero' });
```

- Up to **50 property keys** per event  
- Sensitive property **names** are auto-redacted (see §8)  
- Stored in `custom_events` with full JSON `event_data`

---

## 13. User identification (only if you implement it)

| API | What is sent |
|-----|--------------|
| `identify(userId, traits)` | Links anonymous visitor to your CRM/login ID; optional trait object |
| `alias(oldId, newId)` | Declares two IDs are the same person |
| `group(groupId, props)` | Account/organization association |
| `login()` / `logout()` / `signup()` | Identity lifecycle helpers |

**Worktual does not collect login credentials.** Only IDs and traits **you explicitly pass** are stored.

---

## 14. Server-side request metadata

Added by ingest for every accepted payload:

| Field | Source |
|-------|--------|
| `source_ip` | HTTP connection / proxy headers |
| `user_agent` | `User-Agent` request header |
| `received_at` / `ingested_at` | Server timestamps |
| Full payload JSON | Audit copy in `raw_payloads` |

---



 