# CDP Payload Field Reference

Complete description of **every key** in the Worktual Web Tracking ingest JSON.  
Use with demo files: [CDP_DEMO_PAYLOAD.json](./CDP_DEMO_PAYLOAD.json) and [CDP_REPLAY_DEMO_PAYLOAD.json](./CDP_REPLAY_DEMO_PAYLOAD.json).

**Event catalog (names, purpose, props, storage):** [CDP_EVENTS_CATALOG.md](./CDP_EVENTS_CATALOG.md)

**Endpoint:** `POST /v1/tracking/nfs-ingestions` (QA: `https://qatrackingapi.worktual.com/webtracking/v1/tracking/nfs-ingestions`)

**Payload format:** `events_v3` (current SDK default). Legacy `events_v2` uses `timestamp` instead of `ts` and `properties` instead of `props`.

---

## 1. Top-level envelope keys

These keys wrap the whole batch (one HTTP POST = one payload).

| Key | Type | Required | Description | Why we keep it |
|-----|------|----------|-------------|----------------|
| `type` | string | No (default `events_v2`) | Payload schema version. Use **`events_v3`** for current SDK. | Tells ingest how to parse events (`ts`/`props` vs `timestamp`/`properties`). |
| `domainId` | integer | **Yes** | Numeric site ID assigned when the website is registered in Worktual admin. | Primary key for multi-tenant routing; all analytics filtered by this ID. |
| `domainName` | string | **Yes** | Hostname of the tracked site (e.g. `demo.worktual.co.uk`). Must match admin registration. | Validation + human-readable site identifier; prevents wrong-domain data injection. |
| `visitorId` | string | **Yes** | Persistent anonymous visitor ID (`visitor_…`), stored in first-party cookie (~400 days). | Links all sessions and events to one browser/user over time. |
| `sessionId` | string | **Yes** | Session ID (`session_…`). New session after ~30 min idle or tab close (configurable). | Groups events into one visit; used for funnels and session replay. |
| `events` | array | **Yes** | List of 1–100 event objects that happened in this batch. | Batches reduce network calls; each item is one tracked action. |
| `profiles` | object | No | Shared context sent **once per batch** (browser, visitor, session, campaign, pages, location). | v3 optimization: avoid repeating device/UTM data on every event. |
| `userId` | string | No | Logged-in user ID after `WorktualAnalytics.identify()` or `login()`. | Connects anonymous behaviour to known CRM/account user. |
| `anonymousId` | string | No | Secondary anonymous ID in `localStorage`. | Backup identity if cookies blocked; used in identity merge. |
| `sdkVersion` | string | No | SDK release version (e.g. `3.0.0`). | Debugging, compatibility, and rollout tracking. |
| `sentAt` | integer | No | Unix timestamp in **milliseconds** when the browser sent this batch. | Detect clock skew; ordering and latency analysis. |
| `payloadId` | string (UUID) | No | Unique ID for this batch. Server generates one if omitted. | Deduplication if the same batch is retried. |
| `clientIp` | string | No | Visitor public IP from `getip.worktual.co.uk` (SDK fetches and attaches). | GeoIP (country/city) on server; not from browser GPS alone. |

### Server-added keys (not sent by website)

| Key | Description | Why |
|-----|-------------|-----|
| `organizationId` | UUID of the customer organisation owning the site. | Multi-org B2B accounts; CDP tenant isolation. |
| `_geo` | Geo object derived from `clientIp` (+ optional GPS merge). | Normalised location for analytics without storing raw IP in all tables. |

**`_geo` sub-keys (when present):**

| Sub-key | Description |
|---------|-------------|
| `ip` | Normalised IP used for lookup |
| `country` | ISO country code |
| `countryName` | Country display name |
| `region` / `regionName` | State/region |
| `city` | City name |
| `postal` | Postal/ZIP code |
| `latitude` / `longitude` | Coordinates from IP or GPS |
| `timezone` | IANA timezone |
| `location_source` | `ip`, `gps`, or merged source |
| `accuracy` | GPS accuracy in metres (if GPS) |
| `altitude` / `altitudeAccuracy` | GPS altitude (if GPS) |
| `ip_geo` | Snapshot of IP-only geo before GPS merge |
| `gps` | Nested GPS snapshot (`latitude`, `longitude`, `accuracy`, `altitude`, `capturedAt`) |

---

## 2. `profiles` object keys

Sent once per batch in v3. Events reference profiles via `pid`, `cid`, etc.

### 2.1 `profiles.browser`

Device and browser capabilities (cached per visitor).

| Key | Type | Description | Why |
|-----|------|-------------|-----|
| `id` | string | Stable profile ID (`br_…`). | Internal reference for this browser profile blob. |
| `fingerprint` | string | Hash of browser/OS/screen signals (`fp_…`). | Soft device recognition without invasive fingerprint APIs. |
| `userAgent` | string | Full `navigator.userAgent`. | Raw string for bot detection and unsupported UA analysis. |
| `browser` | string | Browser name (Chrome, Firefox, Safari, …). | Segmentation and compatibility reports. |
| `browserVersion` | string | Browser version. | Version-specific issue tracking. |
| `engine` | string | Rendering engine (Blink, WebKit, …). | Technical diagnostics. |
| `os` | string | Operating system (Windows, macOS, Android, …). | OS-level segmentation. |
| `device` | string | `desktop`, `mobile`, or `tablet`. | Responsive vs desktop behaviour. |
| `language` | string | Primary language (`en-GB`). | Locale targeting. |
| `languages` | array | Ordered list of preferred languages. | Multi-language site personalisation. |
| `timezone` | string | IANA timezone (`Europe/London`). | Time-of-day analysis in visitor local time. |
| `screen.width` | number | Physical screen width (px). | Display capability. |
| `screen.height` | number | Physical screen height (px). | Display capability. |
| `screen.colorDepth` | number | Colour depth (bits). | Rarely used; completeness. |
| `viewport.width` | number | Browser viewport width (px). | Layout/heatmap alignment. |
| `viewport.height` | number | Browser viewport height (px). | Layout/heatmap alignment. |
| `dpr` | number | Device pixel ratio. | Retina/hi-DPI detection. |
| `touch` | boolean | Touch support. | Mobile vs desktop interaction models. |
| `cpu` | number | `navigator.hardwareConcurrency` (CPU cores). | Performance context. |
| `memory` | number | `navigator.deviceMemory` (GB), if exposed. | Low-end device detection. |
| `connection.effectiveType` | string | Network type (`4g`, `3g`, …). | Performance and UX correlation. |
| `connection.downlink` | number | Estimated bandwidth (Mbps). | Load time context. |
| `connection.rtt` | number | Round-trip time (ms). | Latency context. |

### 2.2 `profiles.visitor`

Identity snapshot for this visitor.

| Key | Type | Description | Why |
|-----|------|-------------|-----|
| `id` | string | Same as top-level `visitorId`. | Join key to events and dimensions. |
| `anonymousId` | string | Secondary anonymous ID. | Identity stitching when cookies limited. |
| `userId` | string | Known user ID after identify/login. | CRM / CDP known-user profile link. |
| `fingerprint` | string | Copy of browser fingerprint. | Quick join to device profile. |
| `traits` | object | Key/value pairs from `identify(userId, traits)`. | Custom user attributes (plan, company, …) for CDP. |

**`traits`:** Open object — keys are defined by the website (e.g. `email`, `plan`, `company`). Sensitive fields may be redacted client-side.

### 2.3 `profiles.session`

Metadata for the current visit.

| Key | Type | Description | Why |
|-----|------|-------------|-----|
| `id` | string | Same as top-level `sessionId`. | Join key for session-scoped analysis. |
| `startedAt` | integer | Session start time (ms). | Session duration and funnel timing. |
| `landingPath` | string | First page path in this session. | Entry page reporting. |
| `landingUrl` | string | Full first URL including query string. | Attribution parameters on landing. |
| `referrer` | string | Referrer URL or `direct`. | Traffic source analysis. |
| `referrerDomain` | string | Parsed referrer hostname. | Source domain rollups (google.com, …). |
| `title` | string | Document title at session start. | Human-readable entry context. |

### 2.4 `profiles.campaign`

Marketing attribution (first-touch + last-touch). **Sent on every ingest batch** when attribution exists (not once per session).

| Key | Type | Description | Why |
|-----|------|-------------|-----|
| `id` | string | Campaign profile ID (`cp_…`). | Referenced by event `cid`. |
| `firstTouch` | object | Attribution at **first** visit in lookback window. | Multi-touch: how user originally arrived. |
| `lastTouch` | object | Attribution at **most recent** visit with params. | Multi-touch: what drove this session. |

**Each touch object (`firstTouch` / `lastTouch`) may include:**

| Key | Description | Why |
|-----|-------------|-----|
| `utm_source` | Traffic source (google, newsletter, …). | Standard UTM reporting. |
| `utm_medium` | Medium (cpc, email, organic, …). | Channel classification. |
| `utm_campaign` | Campaign name. | Campaign ROI. |
| `utm_term` | Paid search keyword. | Keyword performance. |
| `utm_content` | Ad variant / creative. | A/B ad testing. |
| `gclid` | Google Ads click ID. | Google Ads offline conversion import. |
| `fbclid` | Meta/Facebook click ID. | Meta attribution. |
| `msclkid` | Microsoft Ads click ID. | Bing attribution. |
| `ttclid` | TikTok click ID. | TikTok attribution. |
| `twclid` | Twitter/X click ID. | X ads attribution. |
| `gbraid` / `wbraid` | Google iOS privacy click IDs. | iOS Google Ads attribution. |
| `li_fat_id` | LinkedIn first-party ad tracking ID. | LinkedIn attribution. |
| `referrer` | Referrer URL at capture time. | Non-UTM traffic source. |
| `capturedAt` | When this touch was recorded (ms). | Touch timing in journey. |
| `wt_organization_id` | Organization id from email click token decode (alias: `wt_org_id`). | Stored on `dim_sessions.wt_organization_id`. |
| `wt_campaign_id` | Campaign DB id from token decode. | Stored on `dim_sessions.wt_campaign_id`. |
| `wt_contact_id` | Exact CDP contact id from decoded 30-char `wt` token (`0` = unknown). | Stored on `dim_sessions.wt_contact_id`. |
| `wt_channel` | Channel marker e.g. `email`. | Distinguish Worktual Campaign email clicks. |

**Email click (production):** Campaign redirects to `/?utm_source=worktual_campaign&…&wt={30-char-token}`. SDK verifies HMAC with `webTrackingHmacSecret` → `lastTouch`. See [CDP_CAMPAIGN_ATTRIBUTION_REFERENCE.md](./CDP_CAMPAIGN_ATTRIBUTION_REFERENCE.md).

Null values mean that parameter was not present in the URL.

### 2.5 `profiles.pages`

Map of page IDs → page metadata for this batch.

| Key pattern | Type | Description | Why |
|-------------|------|-------------|-----|
| `{pageId}` | object | Key is page ID (e.g. `pg_blog_article`). | Events use `pid` to point here without repeating URL/title. |
| `{pageId}.path` | string | URL path (+ query) of the page. | Page path reports. |
| `{pageId}.title` | string | Page title. | Human-readable page name in UI/CDP. |

### 2.6 `profiles.location` (optional)

GPS from browser Geolocation API (only if site enables `geolocation: true` and user allows).

| Key | Type | Description | Why |
|-----|------|-------------|-----|
| `source` | string | Always `gps` for this profile. | Distinguish from IP geo. |
| `permission` | string | `granted`, `denied`, `unsupported`, or `unavailable`. | Data quality / consent audit. |
| `latitude` | number | GPS latitude. | Precise location (with consent). |
| `longitude` | number | GPS longitude. | Precise location (with consent). |
| `accuracy` | number | Accuracy radius (metres). | Confidence in coordinates. |
| `altitude` | number | Altitude (metres). | Optional geographic context. |
| `altitudeAccuracy` | number | Altitude accuracy. | Optional. |
| `heading` | number | Compass direction (degrees). | Optional movement context. |
| `speed` | number | Speed (m/s). | Optional movement context. |
| `capturedAt` | integer | When GPS was read (ms). | Freshness of location. |
| `error` | string | Error message if failed. | Debugging denied/unavailable GPS. |
| `reason` | string | e.g. `consent` if tracking blocked. | Privacy compliance audit. |

---

## 3. Event object keys (each item in `events[]`)

| Key | Type | Required | Description | Why |
|-----|------|----------|-------------|-----|
| `eventId` | string | **Yes** | Unique ID for this event (`evt_…` or UUID). | Deduplication and exact-once processing. |
| `name` | string | **Yes** | Event type in snake_case (`page_view`, `purchase`, `newsletter_signup`, …). | Routes event to correct analytics tables and CDP logic. |
| `event_mode` | string | No | **`"custom"` only** on owner-defined custom events. Omitted on built-in events. | Lets CDP filter `event.event_mode === "custom"` without guessing from name. |
| `ts` | integer | **Yes** | When the event occurred (Unix **ms**). | Timeline, funnels, session ordering. |
| `pid` | string | No | Page ID → key in `profiles.pages`. | Links event to page path/title without duplicating URL. |
| `sid` | string | No | Session profile reference (validated; SDK rarely sends). | Optional explicit session profile link. |
| `cid` | string | No | Campaign profile ID → `profiles.campaign.id`. | Attach UTM/click IDs to this event. |
| `props` | object | No | Event-specific data (structure depends on `name`). | Flexible payload for each event type; stored in fact tables / JSON. |

---

## 4. `props` keys by event type

### 4.1 Page and engagement

| Event `name` | `props` keys | Description |
|--------------|--------------|-------------|
| `page_view` | `pageName`, `path`, `title` | Logical page name, path, and title for this view. |
| `page_visible` | *(empty)* | Tab/window became visible again. |
| `page_hidden` | *(empty)* | Tab hidden or user switched away. |
| `page_transition` | `fromPageId`, `toPageId`, `duration` | SPA navigation from one page ID to another; `duration` = ms on previous page. |
| `scroll_milestone` | `milestone`, `maxDepth` | User reached scroll % milestone (e.g. 25, 50); `maxDepth` = deepest scroll so far. |
| `scroll_depth` | `milestone`, `maxDepth` | Alias/normalised scroll event for analytics pipeline. |
| `scroll` | `scrollY`, `maxDepth` | Raw scroll position variant. |
| `user_active` | *(empty)* | User returned after idle period. |
| `user_idle` | `idleMs` | No activity for configured timeout (e.g. 300000 ms). |
| `heartbeat` | `intervalMs` | Periodic ping while user is active (e.g. every 30000 ms). |

### 4.2 Clicks and interactions

| Event `name` | `props` keys | Description |
|--------------|--------------|-------------|
| `click` | `element`, `text`, `href`, `x`, `y`, `pageX`, `pageY`, `viewportW`, `viewportH`, `elementType`, `elementText` | Click target CSS selector, label, link, coordinates (viewport + page), element metadata for heatmaps. |
| `move` | `x`, `y`, `viewportW`, `viewportH` | Mouse/touch move sample for heatmap (when enabled). |
| `hover` | `x`, `y`, `element`, `elementType`, `elementText`, `href` | Hover target for engagement analysis. |
| `rage_click` | `x`, `y`, `clickCount` | Many clicks same spot — frustration signal. |
| `dead_click` | `x`, `y`, `reason` | Click with no effect (`no_handler`, …). |
| `outbound_link` | `href`, `text` | Click to external domain. |
| `file_download` | `href`, `fileName` | Download link clicked. |
| `site_search` | `query`, `formId` | Internal site search query (may be truncated/masked). |

### 4.3 Forms

Common keys on all form events:

| Key | Description |
|-----|-------------|
| `formId` | Stable form identifier (HTML `id`, `data-wt-form`, or registered ID). |
| `formName` | Human-readable form label. |
| `formAction` | Form submit URL or API endpoint. |
| `fieldName` | Field name (focus/blur/change/validation). |
| `fieldType` | Input type (`email`, `textarea`, …). |
| `fieldValue` | Field value on change (may be masked for passwords). |
| `valid` | Boolean validation result. |
| `fields` | Object map of field name → value on submit/success. |
| `reason` / `errorCode` | Failure reason on `form_failure`. |
| `leadId` | Optional CRM lead ID on success (custom). |

| Event `name` | When it fires |
|--------------|---------------|
| `form_view` | Form entered viewport. |
| `form_start` | User interacted with form. |
| `form_focus` / `form_blur` | Field focus lost/gained. |
| `form_change` | Field value changed. |
| `form_validation` | Client-side validation ran. |
| `form_submit` | Submit attempted. |
| `form_success` | Submit succeeded (call `formSuccess()` for AJAX forms). |
| `form_failure` | Submit failed. |
| `form_abandon` | User left form without completing. |

### 4.4 Ecommerce

**Product events** (`product_view`, `add_to_cart`, `remove_from_cart`):

| Key | Description |
|-----|-------------|
| `productId` | Product identifier (or `sku`). |
| `productName` | Display name. |
| `productCategory` | Category for merchandising reports. |
| `productPrice` | Unit price. |
| `currency` | ISO currency code (GBP, USD, …). |
| `quantity` | Items affected. |
| `sku` | Stock keeping unit. |
| `brand` | Brand name. |

**`begin_checkout`:** Open props — e.g. `cartValue`, `currency`, `itemCount`, `coupon`.

**`purchase` / `refund`:**

| Key | Description |
|-----|-------------|
| `orderId` | Order/transaction ID. |
| `revenue` | Total monetary value (refund = partial amount). |
| `currency` | ISO currency. |
| `tax` | Tax amount. |
| `shipping` | Shipping cost. |
| `products` | Array of line items (same product keys as above). |

### 4.5 Identity

**Sample payloads (login & register):** [CDP_LOGIN_REGISTER_PAYLOAD.md](./CDP_LOGIN_REGISTER_PAYLOAD.md)

| Event `name` | `props` keys | Description |
|--------------|--------------|-------------|
| `identify` | `userId`, `previousAnonymousId`, `traits` | Link anonymous visitor to known user + traits. |
| `login` | `userId`, `method`, … | User authenticated. |
| `logout` | *(empty)* | User signed out. |
| `register` | `userId`, `method`, `source`, … | New account created (standard name). |
| `signup` | `userId`, `method`, `source`, … | Legacy alias for `register` (still accepted on ingest). |
| `alias` | `oldId`, `newId` | Merge two visitor IDs. |
| `group` | `groupId`, … | B2B account/group association. |
| `user_properties` | `traits` | Update user trait dictionary. |

### 4.6 Performance

**`performance_vitals`:** `lcp`, `cls`, `inp`, `fcp`, `ttfb`, `lcpRating`, `clsRating`, `inpRating` — Core Web Vitals.

| Event `name` | Typical `props` |
|--------------|-----------------|
| `performance_lcp` | `value`, `rating`, `lcp` |
| `performance_cls` | `value`, `rating`, `cls` |
| `performance_inp` | `value`, `rating`, `inp` |
| `performance_fcp` | `value`, `fcp` |
| `performance_navigation` | `domContentLoaded`, `loadEventEnd`, `ttfb` |
| `performance_resource` | `name`, `duration`, `transferSize` |
| `performance_long_task` | `duration`, `startTime` |
| `performance_memory` | `usedJSHeapSize`, `totalJSHeapSize` |

### 4.7 Errors

Event `name` is always `error`. Discriminate with `props.type`:

| `props.type` | Keys | Description |
|--------------|------|-------------|
| `javascript` | `message`, `filename`, `lineno`, `colno`, `stack` | Uncaught JS error. |
| `unhandledrejection` | `message`, `stack` | Unhandled Promise rejection. |
| `fetch` | `url`, `status`, `statusText` or `message` | Failed `fetch()` call. |
| `xhr` | `url`, `method`, `status` or `message` | Failed XMLHttpRequest. |
| `resource` | `tagName`, `src` | Failed image/script/CSS load. |

### 4.8 Custom events (website owner defined)

| Key | Description |
|-----|-------------|
| `event_mode` | Always `"custom"` when sent by SDK. |
| `name` | Any snake_case name chosen by site (e.g. `newsletter_signup`, `article_read`, `cdp_integration_test`). |
| `props` | **Fully custom** — any keys the site passes to `WorktualAnalytics.track(name, props)` (max 50 keys, depth 4). |

**Demo custom events in CDP_DEMO_PAYLOAD.json:**

| `name` | Example `props` keys | Meaning |
|--------|----------------------|---------|
| `article_read` | `articleId`, `category`, `readPercent`, `timeOnPageSec` | Blog article engagement. |
| `newsletter_signup` | `listId`, `source`, `email_domain` | Newsletter subscription. |
| `brochure_download` | `brochureId`, `format`, `language` | Marketing PDF download. |
| `cdp_integration_test` | `source`, `testId`, `journey`, `metadata` | CDP pipeline test event. |

---

## 5. Replay payload keys (`replay_chunk_v1`)

Separate POST; not inside `events[]`. See [CDP_REPLAY_DEMO_PAYLOAD.json](./CDP_REPLAY_DEMO_PAYLOAD.json).

| Key | Type | Required | Description | Why |
|-----|------|----------|-------------|-----|
| `type` | string | **Yes** | Must be `replay_chunk_v1`. | Distinguishes replay from analytics batch. |
| `domainId` | integer | **Yes** | Site ID. | Same as events payload. |
| `domainName` | string | **Yes** | Site hostname. | Validation. |
| `visitorId` | string | **Yes** | Visitor ID. | Join replay to visitor journey. |
| `sessionId` | string | **Yes** | Session ID. | Join replay to session. |
| `pageViewId` | string | **Yes** | Page view ID (`pg_…`). | Replay segment for one page. |
| `chunkIndex` | integer | **Yes** | Sequential chunk number (0, 1, 2, …). | Order chunks for playback. |
| `chunkId` | string (UUID) | **Yes** | Unique chunk ID. | Deduplication. |
| `encoding` | string | **Yes** | Always `gzip_b64` (gzip + base64). | Compression format for rrweb data. |
| `eventsData` | string | **Yes** | Encoded rrweb recording bytes. | Actual session replay DOM/events. |
| `eventCount` | integer | **Yes** | Number of rrweb records in chunk. | Validation and metrics. |
| `source` | string | No | Recorder library (default `rrweb`). | Player compatibility. |
| `payloadId` | string (UUID) | No | Batch dedup ID. | Same as events envelope. |
| `clientIp` | string | No | Visitor IP. | Geo/context. |

---

## 6. CDP integration quick rules

1. **Filter custom events:** `event.event_mode === "custom"` OR event name not in [built-in list](./EVENTS_REFERENCE.md).
2. **Join page context:** `event.pid` → `profiles.pages[event.pid].path` / `.title`.
3. **Join campaign:** `event.cid` → `profiles.campaign` (UTM + click IDs).
4. **Join user:** top-level `userId` or `profiles.visitor.traits`.
5. **Timestamps:** all client times are Unix **milliseconds** unless noted.
6. **Blog vs ecommerce:** same schema; ecommerce adds `product_view`, `purchase`, etc.

---

 