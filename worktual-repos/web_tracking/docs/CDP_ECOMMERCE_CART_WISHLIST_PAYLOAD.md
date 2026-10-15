# CDP reference — E-commerce cart & wishlist payloads (`events_v3`)

**Audience:** CDP / data engineering  
**Endpoint:** `POST /v1/tracking/nfs-ingestions`  
**Format:** `events_v3` (SDK default)

**Event names in scope:**

| `events[].name` | SDK method |
|-----------------|------------|
| `add_to_cart` | `WorktualAnalytics.addToCart()` |
| `remove_from_cart` | `WorktualAnalytics.removeFromCart()` |
| `add_to_wishlist` | `WorktualAnalytics.addToWishlist()` |
| `remove_from_wishlist` | `WorktualAnalytics.removeFromWishlist()` |

All four share the **same event object keys** and the **same `props` key set**. Only `name` differs.

**ClickHouse:** `web_tracking.fact_product_interactions` — column `section` = `events[].name`; product fields from `props`; full `props` JSON also in `extra_data`.

**Related:** [CDP_PAYLOAD_FIELD_REFERENCE.md](./CDP_PAYLOAD_FIELD_REFERENCE.md), [CDP_EVENTS_CATALOG.md](./CDP_EVENTS_CATALOG.md), [CDP_DEMO_PAYLOAD.json](./CDP_DEMO_PAYLOAD.json)

---

## 1. Full batch envelope — keys and sample values

Synthetic example; one batch may contain 1–100 events.

| Key path | Type | Required | Sample value | Description |
|----------|------|----------|--------------|-------------|
| `type` | string | Yes (SDK) | `"events_v3"` | Payload schema version |
| `websiteId` | integer | Yes | `1009` | Site ID (`domainId` accepted as alias on ingest) |
| `websiteUrl` | string | Yes | `"https://booxoo.co.uk"` | Registered store URL (`domainName` alias on ingest) |
| `organizationId` | integer | No | `1010` | Org ID from `init()` |
| `visitorId` | string | Yes | `"visitor_syn_7k2m9x"` | Persistent visitor id |
| `sessionId` | string | Yes | `"session_syn_4p8q1w"` | Current session id |
| `userId` | string | No | `"user_syn_88201"` | After login / identify |
| `anonymousId` | string | No | `"anon_syn_abc123"` | Secondary anonymous id |
| `sdkVersion` | string | No | `"3.0.0"` | SDK version |
| `sentAt` | integer | No | `1789487335000` | Batch send time (Unix ms) |
| `payloadId` | string (UUID) | No | `"f47ac10b-58cc-4372-a567-0e02b2c3d479"` | Batch deduplication |
| `clientIp` | string | No | `"203.0.113.45"` | Client IP hint (SDK optional fetch) |
| `events` | array | Yes | `[ { ... } ]` | Event objects (see §2–§3) |
| `profiles` | object | No | `{ ... }` | Shared context for batch (see §4) |

**Server-added (not in browser JSON):** e.g. `_geo` on stored raw payload, validated `organizationId`.

---

## 2. Event object — keys outside `props` (all four event names)

Each element of `events[]`:

| Key | Type | Required | Sample value | Description |
|-----|------|----------|--------------|-------------|
| `eventId` | string | Yes | `"evt_syn_add_cart_001"` | Unique event id |
| `name` | string | Yes | `"add_to_cart"` | One of: `add_to_cart`, `remove_from_cart`, `add_to_wishlist`, `remove_from_wishlist` |
| `ts` | integer | Yes | `1789487332990` | Event time (Unix ms) |
| `props` | object | Yes* | `{ ... }` | Product payload (§3); *SDK omits if empty |
| `pid` | string | No | `"pg_syn_pdp_001"` | Page id → key in `profiles.pages` |
| `cid` | string | No | `"cp_syn_campaign_001"` | Campaign profile id (optional) |

Built-in ecommerce events **do not** set `event_mode`.

---

## 3. `props` — keys inside (all four event names)

Set by SDK `normalizeProduct()` when using official helpers. **Wire keys are always camelCase.**

| Key | Type | Required | Sample value | ClickHouse column |
|-----|------|----------|--------------|-------------------|
| `props.productId` | string | **Yes** | `"cmtrficey02a3pb01pb3hfewo"` | `product_id` |
| `props.productName` | string | No | `"Brown midi dress"` | `product_name` |
| `props.productCategory` | string | No | `"Dresses"` | `product_category` |
| `props.productPrice` | number | No | `30` | `product_price` |
| `props.currency` | string | No | `"GBP"` | `currency` |
| `props.quantity` | number | No | `1` | *(no dedicated column; present in `extra_data`)* |
| `props.sku` | string | No | `"AVE-1001B-UK-6"` | `product_sku` |
| `props.brand` | string | No | `"Booxoo"` | `product_brand` |

**`extra_data`:** entire `props` JSON string (includes all keys above, not “overflow only”).

**Custom keys (e.g. `size`):** Not emitted by `addToCart()` / wishlist helpers today — SDK strips non-listed fields. CDP should not expect `size` unless ingest used raw `track()` (unsupported).

**Call-time aliases (SDK only, not on wire):** `id` → `productId`, `name` → `productName`, `price` → `productPrice`, `category` → `productCategory`.

---

## 4. `profiles` object — common child keys (batch context)

Included when profiles changed in batch; structure shared across event types.

### 4.1 `profiles.browser`

| Key path | Sample |
|----------|--------|
| `profiles.browser.id` | `"br_syn_001"` |
| `profiles.browser.userAgent` | `"Mozilla/5.0 ... Chrome/120.0.0.0"` |
| `profiles.browser.browser` | `"Chrome"` |
| `profiles.browser.browserVersion` | `"120.0.0.0"` |
| `profiles.browser.os` | `"Windows"` |
| `profiles.browser.device` | `"desktop"` |
| `profiles.browser.language` | `"en-GB"` |
| `profiles.browser.screen.width` | `1920` |
| `profiles.browser.screen.height` | `1080` |
| `profiles.browser.viewport.width` | `1096` |
| `profiles.browser.viewport.height` | `966` |

### 4.2 `profiles.visitor`

| Key path | Sample |
|----------|--------|
| `profiles.visitor.id` | `"visitor_syn_7k2m9x"` |
| `profiles.visitor.userId` | `"user_syn_88201"` |
| `profiles.visitor.traits.email` | `"shopper@example.com"` |

### 4.3 `profiles.session`

| Key path | Sample |
|----------|--------|
| `profiles.session.id` | `"session_syn_4p8q1w"` |
| `profiles.session.landingPath` | `"/"` |
| `profiles.session.referrer` | `"https://www.google.com/"` |
| `profiles.session.referrerDomain` | `"www.google.com"` |

### 4.4 `profiles.campaign` (optional)

| Key path | Sample |
|----------|--------|
| `profiles.campaign.id` | `"cp_syn_001"` |
| `profiles.campaign.lastTouch.utm_source` | `"email"` |
| `profiles.campaign.lastTouch.utm_medium` | `"newsletter"` |
| `profiles.campaign.lastTouch.utm_campaign` | `"spring_sale"` |

### 4.5 `profiles.pages` (map keyed by `pid`)

| Key path | Sample |
|----------|--------|
| `profiles.pages.pg_syn_pdp_001.path` | `"/products/brown-midi-dress"` |
| `profiles.pages.pg_syn_pdp_001.title` | `"Brown midi dress \| Booxoo"` |

### 4.6 `profiles.location` (optional, consent)

| Key path | Sample |
|----------|--------|
| `profiles.location.latitude` | `51.5074` |
| `profiles.location.longitude` | `-0.1278` |
| `profiles.location.permission` | `"granted"` |

---

## 5. Complete JSON examples (synthetic) — one event per batch

### 5.1 `add_to_cart`

```json
{
  "type": "events_v3",
  "websiteId": 1009,
  "websiteUrl": "https://booxoo.co.uk",
  "organizationId": 1010,
  "visitorId": "visitor_syn_7k2m9x",
  "sessionId": "session_syn_4p8q1w",
  "sdkVersion": "3.0.0",
  "sentAt": 1789487335000,
  "payloadId": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  "events": [
    {
      "eventId": "evt_syn_add_cart_001",
      "name": "add_to_cart",
      "ts": 1789487332990,
      "pid": "pg_syn_pdp_001",
      "props": {
        "productId": "cmtrficey02a3pb01pb3hfewo",
        "productName": "Brown midi dress",
        "productCategory": "Dresses",
        "productPrice": 30,
        "currency": "GBP",
        "quantity": 1,
        "sku": "AVE-1001B-UK-6",
        "brand": "Booxoo"
      }
    }
  ],
  "profiles": {
    "browser": {
      "id": "br_syn_001",
      "device": "desktop",
      "browser": "Chrome"
    },
    "session": {
      "id": "session_syn_4p8q1w",
      "landingPath": "/"
    },
    "pages": {
      "pg_syn_pdp_001": {
        "path": "/products/brown-midi-dress",
        "title": "Brown midi dress"
      }
    }
  }
}
```

### 5.2 `remove_from_cart`

Same envelope; event object:

```json
{
  "eventId": "evt_syn_remove_cart_001",
  "name": "remove_from_cart",
  "ts": 1789487333100,
  "pid": "pg_syn_cart_001",
  "props": {
    "productId": "cmtrficey02a3pb01pb3hfewo",
    "productName": "Brown midi dress",
    "productCategory": "Dresses",
    "productPrice": 30,
    "currency": "GBP",
    "quantity": 1,
    "sku": "AVE-1001B-UK-6",
    "brand": "Booxoo"
  }
}
```

### 5.3 `add_to_wishlist`

```json
{
  "eventId": "evt_syn_add_wish_001",
  "name": "add_to_wishlist",
  "ts": 1789487333200,
  "pid": "pg_syn_pdp_001",
  "props": {
    "productId": "cmtrficey02a3pb01pb3hfewo",
    "productName": "Brown midi dress",
    "productCategory": "Dresses",
    "productPrice": 30,
    "currency": "GBP",
    "quantity": 1,
    "sku": "AVE-1001B-UK-6",
    "brand": "Booxoo"
  }
}
```

### 5.4 `remove_from_wishlist`

```json
{
  "eventId": "evt_syn_remove_wish_001",
  "name": "remove_from_wishlist",
  "ts": 1789487333300,
  "pid": "pg_syn_wishlist_001",
  "props": {
    "productId": "cmtrficey02a3pb01pb3hfewo",
    "productName": "Brown midi dress",
    "productCategory": "Dresses",
    "productPrice": 30,
    "currency": "GBP",
    "quantity": 1,
    "sku": "AVE-1001B-UK-6",
    "brand": "Booxoo"
  }
}
```

---

## 6. Single batch with all four events (synthetic)

```json
{
  "type": "events_v3",
  "websiteId": 1009,
  "websiteUrl": "https://booxoo.co.uk",
  "organizationId": 1010,
  "visitorId": "visitor_syn_7k2m9x",
  "sessionId": "session_syn_4p8q1w",
  "sentAt": 1789487335000,
  "events": [
    {
      "eventId": "evt_syn_add_cart_001",
      "name": "add_to_cart",
      "ts": 1789487332990,
      "pid": "pg_syn_pdp_001",
      "props": {
        "productId": "prod_syn_001",
        "productName": "Brown midi dress",
        "productPrice": 30,
        "currency": "GBP",
        "quantity": 1,
        "sku": "AVE-1001B-UK-6"
      }
    },
    {
      "eventId": "evt_syn_remove_cart_001",
      "name": "remove_from_cart",
      "ts": 1789487333100,
      "pid": "pg_syn_cart_001",
      "props": {
        "productId": "prod_syn_001",
        "productName": "Brown midi dress",
        "productPrice": 30,
        "currency": "GBP",
        "quantity": 1,
        "sku": "AVE-1001B-UK-6"
      }
    },
    {
      "eventId": "evt_syn_add_wish_001",
      "name": "add_to_wishlist",
      "ts": 1789487333200,
      "pid": "pg_syn_pdp_001",
      "props": {
        "productId": "prod_syn_002",
        "productName": "Linen blazer",
        "productPrice": 85,
        "currency": "GBP",
        "quantity": 1,
        "sku": "AVE-2002B-M"
      }
    },
    {
      "eventId": "evt_syn_remove_wish_001",
      "name": "remove_from_wishlist",
      "ts": 1789487333300,
      "pid": "pg_syn_wishlist_001",
      "props": {
        "productId": "prod_syn_002",
        "productName": "Linen blazer",
        "productPrice": 85,
        "currency": "GBP",
        "quantity": 1,
        "sku": "AVE-2002B-M"
      }
    }
  ]
}
```

---

## 7. CDP routing cheat sheet

| `events[].name` | Fact table | `section` | Identity columns from envelope |
|-----------------|------------|-----------|--------------------------------|
| `add_to_cart` | `fact_product_interactions` | `add_to_cart` | `websiteId`, `visitorId`, `sessionId`, `organizationId` |
| `remove_from_cart` | `fact_product_interactions` | `remove_from_cart` | same |
| `add_to_wishlist` | `fact_product_interactions` | `add_to_wishlist` | same |
| `remove_from_wishlist` | `fact_product_interactions` | `remove_from_wishlist` | same |

| `props` key | Fact column |
|-------------|-------------|
| `productId` / `sku` | `product_id` |
| `productName` / `name` | `product_name` |
| `productCategory` / `category` | `product_category` |
| `productPrice` / `price` | `product_price` |
| `currency` | `currency` |
| `sku` | `product_sku` |
| `brand` | `product_brand` |
| *(entire props object)* | `extra_data` |

---

## 8. Source code references

| Topic | Location |
|-------|----------|
| Product `props` normalization | `sdk/src/ecommerce/index.js` → `normalizeProduct()` |
| Batch envelope | `sdk/src/core/payload.js` → `buildPayloadV3()` |
| Ingest aliases | `etl/ingest/validation.py` (`websiteId` / `domainId`) |
| ClickHouse MV | `clickhouse/ddl/05_materialized_views_pipeline.sql` → `mv_fact_product` |
