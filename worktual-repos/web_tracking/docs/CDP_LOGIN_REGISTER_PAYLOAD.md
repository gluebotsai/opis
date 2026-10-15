# CDP reference — Login & register payloads (`events_v3`)

**Audience:** CDP / data engineering  
**Endpoint:** `POST /v1/tracking/nfs-ingestions`  
**Format:** `events_v3` (SDK default)

**Event names in scope:**

| `events[].name` | SDK method | Notes |
|-----------------|------------|-------|
| `login` | `WorktualAnalytics.login({ … })` | Also emits `identify` when `userId` is set |
| `register` | `WorktualAnalytics.register({ … })` | Also emits `identify` when `userId` is set |
| `identify` | Emitted by `login()` / `register()` | Links anonymous visitor to known user |
| `form_success` | `WorktualAnalytics.formSuccess('login' \| 'register')` | Optional — Forms dashboard funnel |

**Standard names:** Use **`login`** and **`register`** only. Do not send `signin`, `sign-in`, `signup`, or `sign_up` from new integrations. Legacy `WorktualAnalytics.signup()` still maps to event name **`register`**.

**ClickHouse:**

| Event | Table | Key column |
|-------|-------|------------|
| `login`, `register` | `web_tracking.fact_conversion_events` | `conversion_type` = event name |
| `identify` | `web_tracking.fact_custom_events` | `event_name` = `identify` |
| `form_success` | `web_tracking.fact_form_events` | `form_id` from `props.formId` |
| All identity events | `web_tracking.dim_known_users` | Refreshed from `identify`, `login`, `register`, `signup` in staging |

**Related:** [CDP_PAYLOAD_FIELD_REFERENCE.md](./CDP_PAYLOAD_FIELD_REFERENCE.md), [CDP_EVENTS_CATALOG.md](./CDP_EVENTS_CATALOG.md), [CLIENT_ECOMMERCE_LOGIN_REGISTER.md](./CLIENT_ECOMMERCE_LOGIN_REGISTER.md), [CDP_DEMO_PAYLOAD.json](./CDP_DEMO_PAYLOAD.json)

---

## 1. Full batch envelope — keys and sample values

One HTTP POST = one batch (1–100 events). After login or register, top-level `userId` is set on subsequent batches.

| Key path | Type | Required | Sample value | Description |
|----------|------|----------|--------------|-------------|
| `type` | string | Yes (SDK) | `"events_v3"` | Payload schema version |
| `websiteId` | integer | Yes | `1009` | Site ID (`domainId` accepted as alias on ingest) |
| `websiteUrl` | string | Yes | `"https://booxoo.co.uk"` | Registered store URL (`domainName` alias on ingest) |
| `organizationId` | integer | No | `1010` | Org ID from `init()` |
| `visitorId` | string | Yes | `"visitor_syn_7k2m9x"` | Persistent browser visitor id (cookie) |
| `sessionId` | string | Yes | `"session_syn_4p8q1w"` | Current session id |
| `userId` | string | No* | `"user_syn_88201"` | Known CRM user id — *present after `login` / `register` / `identify`* |
| `anonymousId` | string | No | `"anon_syn_abc123"` | Secondary anonymous id (`localStorage`) |
| `sdkVersion` | string | No | `"3.0.1"` | SDK version |
| `sentAt` | integer | No | `1789487335000` | Batch send time (Unix ms) |
| `payloadId` | string (UUID) | No | `"f47ac10b-58cc-4372-a567-0e02b2c3d479"` | Batch deduplication |
| `clientIp` | string | No | `"203.0.113.45"` | Client IP hint (SDK optional fetch) |
| `events` | array | Yes | `[ { … } ]` | Event objects (see §2–§3) |
| `profiles` | object | No | `{ … }` | Shared context for batch (see §4) |

**Server-added (not in browser JSON):** e.g. `_geo` on stored raw payload, validated `organizationId`.

**Never send in `props` or traits:** `password`, OTP, tokens, card numbers — SDK redacts keys matching sensitive patterns.

---

## 2. Event object — keys outside `props`

Each element of `events[]`:

| Key | Type | Required | Sample value | Description |
|-----|------|----------|--------------|-------------|
| `eventId` | string | Yes | `"evt_syn_login_001"` | Unique event id (`evt_…` or UUID) |
| `name` | string | Yes | `"login"` | One of: `login`, `register`, `identify`, `form_success` |
| `ts` | integer | Yes | `1789487332990` | Event time (Unix ms) |
| `props` | object | Yes* | `{ … }` | Event payload (§3); *SDK omits if empty* |
| `pid` | string | No | `"pg_syn_login_001"` | Page id → key in `profiles.pages` |
| `cid` | string | No | `"cp_syn_campaign_001"` | Campaign profile id (optional) |

Built-in identity events **do not** set `event_mode`.

### SDK emission order

| User action | Events in batch (typical order) |
|-------------|----------------------------------|
| Login (email form) | `form_success` (optional) → `identify` → `login` |
| Register (email form) | `form_success` (optional) → `register` → `identify` |

**Scope:** This document covers **email login/register only** — after your login/register API succeeds and the client calls `WorktualAnalytics.login()` / `register()`. Social/OAuth sign-in does **not** emit these events unless the storefront explicitly calls the SDK after OAuth completes.

---

## 3. `props` — keys by event name

### 3.1 `login`

Set by `WorktualAnalytics.login(props)`. SDK calls `identify(userId, traits)` first when `userId` is present.

| Key | Type | Required | Sample value | `dim_known_users` column |
|-----|------|----------|--------------|--------------------------|
| `props.userId` | string | **Yes** | `"user_syn_88201"` | `user_id` |
| `props.method` | string | **Yes** | `"email"` | `method` |
| `props.email` | string | No | `"shopper@example.com"` | `email` |
| `props.phone` | string | No | `"+441234567890"` | `phone` |
| `props.firstName` | string | No | `"Jane"` | `first_name` |
| `props.lastName` | string | No | `"Doe"` | `last_name` |

**`fact_conversion_events`:** `conversion_type` = `login`; `product_id` and `value` are empty/zero for login.

### 3.2 `register`

Set by `WorktualAnalytics.register(props)`. SDK emits `register` first, then `identify(userId, props)` when `userId` is present.

| Key | Type | Required | Sample value | `dim_known_users` column |
|-----|------|----------|--------------|--------------------------|
| `props.userId` | string | **Yes** | `"user_syn_new_001"` | `user_id` |
| `props.method` | string | **Yes** | `"email"` | `method` |
| `props.email` | string | No | `"new@example.com"` | `email` |
| `props.phone` | string | No | `"+441234567890"` | `phone` |
| `props.firstName` | string | No | `"John"` | `first_name` |
| `props.lastName` | string | No | `"Smith"` | `last_name` |
| `props.source` | string | No | `"register_page"` | *(traits_json only)* |

**`fact_conversion_events`:** `conversion_type` = `register`.

**Legacy alias:** `signup` event name is still accepted on ingest and stored like `register`.

### 3.3 `identify` (companion event)

Emitted automatically by `login()` and `register()` when `userId` is set.

| Key | Type | Required | Sample value | Description |
|-----|------|----------|--------------|-------------|
| `props.userId` | string | **Yes** | `"user_syn_88201"` | Known user id |
| `props.previousAnonymousId` | string | No | `"anon_syn_abc123"` | Anonymous id before link |
| `props.traits` | object | No | `{ "email": "…", "firstName": "…" }` | CRM traits (credentials stripped) |

On **`register`**, `traits` may include the full register props object (including `userId`, `method`, `source`).

**`fact_custom_events`:** full `props` stored in `event_data` JSON.

### 3.4 `form_success` (optional)

Call `WorktualAnalytics.formSuccess('login')` or `formSuccess('register')` after API success.

| Key | Type | Required | Sample value | Description |
|-----|------|----------|--------------|-------------|
| `props.formId` | string | **Yes** | `"login"` or `"register"` | Must match `data-wt-form` / `leadForms` |
| `props.formName` | string | No | `"Customer login"` | Human-readable label |
| `props.fields` | object | No | `{ "email": "shopper@example.com" }` | Field snapshot (passwords masked) |

---

## 4. `profiles` object — common child keys (batch context)

Included when profiles changed in batch. Identity traits also appear under `profiles.visitor.traits`.

### 4.1 `profiles.visitor` (identity)

| Key path | Sample |
|----------|--------|
| `profiles.visitor.id` | `"visitor_syn_7k2m9x"` |
| `profiles.visitor.anonymousId` | `"anon_syn_abc123"` |
| `profiles.visitor.userId` | `"user_syn_88201"` |
| `profiles.visitor.traits.email` | `"shopper@example.com"` |
| `profiles.visitor.traits.firstName` | `"Jane"` |
| `profiles.visitor.traits.lastName` | `"Doe"` |

### 4.2 `profiles.browser`, `profiles.session`, `profiles.pages`

Same structure as other `events_v3` batches — see [CDP_PAYLOAD_FIELD_REFERENCE.md](./CDP_PAYLOAD_FIELD_REFERENCE.md) §2 and [CDP_ECOMMERCE_CART_WISHLIST_PAYLOAD.md](./CDP_ECOMMERCE_CART_WISHLIST_PAYLOAD.md) §4.

Typical login page:

| Key path | Sample |
|----------|--------|
| `profiles.pages.pg_syn_login_001.path` | `"/account/login"` |
| `profiles.pages.pg_syn_login_001.title` | `"Sign in \| Booxoo"` |
| `profiles.session.landingPath` | `"/"` |
| `profiles.session.referrer` | `"https://www.google.com/"` |

---

## 5. Complete JSON examples (synthetic)

### 5.1 Login (full batch)

Typical flow: `formSuccess('login')` → `login({ userId, method: 'email', … })`.

```json
{
  "type": "events_v3",
  "websiteId": 1009,
  "websiteUrl": "https://booxoo.co.uk",
  "organizationId": 1010,
  "visitorId": "visitor_syn_7k2m9x",
  "sessionId": "session_syn_4p8q1w",
  "userId": "user_syn_88201",
  "anonymousId": "anon_syn_abc123",
  "sdkVersion": "3.0.1",
  "sentAt": 1789487335000,
  "payloadId": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  "events": [
    {
      "eventId": "evt_syn_form_success_login",
      "name": "form_success",
      "ts": 1789487332980,
      "pid": "pg_syn_login_001",
      "props": {
        "formId": "login"
      }
    },
    {
      "eventId": "evt_syn_identify_login",
      "name": "identify",
      "ts": 1789487332990,
      "pid": "pg_syn_login_001",
      "props": {
        "userId": "user_syn_88201",
        "previousAnonymousId": "anon_syn_abc123",
        "traits": {
          "email": "shopper@example.com",
          "firstName": "Jane",
          "lastName": "Doe"
        }
      }
    },
    {
      "eventId": "evt_syn_login_001",
      "name": "login",
      "ts": 1789487333000,
      "pid": "pg_syn_login_001",
      "props": {
        "userId": "user_syn_88201",
        "method": "email",
        "email": "shopper@example.com",
        "firstName": "Jane",
        "lastName": "Doe"
      }
    }
  ],
  "profiles": {
    "browser": {
      "id": "br_syn_001",
      "device": "desktop",
      "browser": "Chrome"
    },
    "visitor": {
      "id": "visitor_syn_7k2m9x",
      "anonymousId": "anon_syn_abc123",
      "userId": "user_syn_88201",
      "traits": {
        "email": "shopper@example.com",
        "firstName": "Jane",
        "lastName": "Doe"
      }
    },
    "session": {
      "id": "session_syn_4p8q1w",
      "landingPath": "/"
    },
    "pages": {
      "pg_syn_login_001": {
        "path": "/account/login",
        "title": "Sign in | Booxoo"
      }
    }
  }
}
```

### 5.2 Register (full batch)

Typical flow: `formSuccess('register')` → `register({ userId, method: 'email', source, … })`.

Note: SDK emits **`register` before `identify`**.

```json
{
  "type": "events_v3",
  "websiteId": 1009,
  "websiteUrl": "https://booxoo.co.uk",
  "organizationId": 1010,
  "visitorId": "visitor_syn_7k2m9x",
  "sessionId": "session_syn_4p8q1w",
  "userId": "user_syn_new_001",
  "anonymousId": "anon_syn_abc123",
  "sdkVersion": "3.0.1",
  "sentAt": 1789487350000,
  "events": [
    {
      "eventId": "evt_syn_form_success_register",
      "name": "form_success",
      "ts": 1789487349980,
      "pid": "pg_syn_register_001",
      "props": {
        "formId": "register"
      }
    },
    {
      "eventId": "evt_syn_register_001",
      "name": "register",
      "ts": 1789487349990,
      "pid": "pg_syn_register_001",
      "props": {
        "userId": "user_syn_new_001",
        "method": "email",
        "email": "new@example.com",
        "phone": "+441234567890",
        "firstName": "John",
        "lastName": "Smith",
        "source": "register_page"
      }
    },
    {
      "eventId": "evt_syn_identify_register",
      "name": "identify",
      "ts": 1789487350000,
      "pid": "pg_syn_register_001",
      "props": {
        "userId": "user_syn_new_001",
        "previousAnonymousId": "anon_syn_abc123",
        "traits": {
          "userId": "user_syn_new_001",
          "method": "email",
          "email": "new@example.com",
          "phone": "+441234567890",
          "firstName": "John",
          "lastName": "Smith",
          "source": "register_page"
        }
      }
    }
  ],
  "profiles": {
    "visitor": {
      "id": "visitor_syn_7k2m9x",
      "userId": "user_syn_new_001",
      "traits": {
        "email": "new@example.com",
        "firstName": "John",
        "lastName": "Smith"
      }
    },
    "pages": {
      "pg_syn_register_001": {
        "path": "/account/register",
        "title": "Create account | Booxoo"
      }
    }
  }
}
```

### 5.3 Single event snippets (for CDP parsers)

**`login` event only:**

```json
{
  "eventId": "evt_syn_login_001",
  "name": "login",
  "ts": 1789487333000,
  "pid": "pg_syn_login_001",
  "props": {
    "userId": "user_syn_88201",
    "method": "email",
    "email": "shopper@example.com",
    "firstName": "Jane",
    "lastName": "Doe"
  }
}
```

**`register` event only:**

```json
{
  "eventId": "evt_syn_register_001",
  "name": "register",
  "ts": 1789487349990,
  "pid": "pg_syn_register_001",
  "props": {
    "userId": "user_syn_new_001",
    "method": "email",
    "email": "new@example.com",
    "firstName": "John",
    "lastName": "Smith",
    "source": "register_page"
  }
}
```

---

## 6. CDP routing cheat sheet

| `events[].name` | Fact / dim table | Identity columns from envelope |
|-----------------|------------------|--------------------------------|
| `login` | `fact_conversion_events` (`conversion_type` = `login`) | `websiteId`, `visitorId`, `sessionId`, `organizationId` |
| `register` | `fact_conversion_events` (`conversion_type` = `register`) | same |
| `signup` (legacy) | `fact_conversion_events` (`conversion_type` = `signup`) | same |
| `identify` | `fact_custom_events` | same |
| `form_success` | `fact_form_events` | same |
| All four identity types | `dim_known_users` (refreshable MV, 1 min) | `visitor_id`, `user_id`, traits from `props` |

| `props` key | `dim_known_users` column | Notes |
|-------------|--------------------------|-------|
| `userId` | `user_id` | Required on login/register |
| `method` | `method` | e.g. `email` |
| `email` | `email` | |
| `phone` | `phone` | |
| `firstName` | `first_name` | |
| `lastName` | `last_name` | |
| *(remaining props)* | `traits_json` | Full JSON blob |
| Event name | `last_event_type` | Latest identity event per visitor |

**Join key for CDP:** `visitorId` (anonymous journey) + `userId` (known user) on the same batch after successful login/register.

---

## 7. Client integration (SDK calls)

```javascript
// Login
WorktualAnalytics.formSuccess('login');
WorktualAnalytics.login({
  userId: String(customer.id),
  method: 'email',
  email: customer.email,
  firstName: customer.firstName,
  lastName: customer.lastName,
});
await WorktualAnalytics.flush();

// Register
WorktualAnalytics.formSuccess('register');
WorktualAnalytics.register({
  userId: String(customer.id),
  method: 'email',
  email: customer.email,
  source: 'register_page',
});
await WorktualAnalytics.flush();
```

Full integration guide: [CLIENT_ECOMMERCE_LOGIN_REGISTER.md](./CLIENT_ECOMMERCE_LOGIN_REGISTER.md)

---

## 8. Source code references

| Topic | Location |
|-------|----------|
| `login()` / `register()` | `sdk/src/index.js` |
| Batch envelope | `sdk/src/core/payload.js` → `buildPayloadV3()` |
| Credential stripping | `sdk/src/privacy/consent.js` → `stripCredentials()` |
| Allowed event names | `etl/ingest/validation.py`, `sdk/src/core/event-names.js` |
| Conversion MV | `clickhouse/ddl/05_materialized_views_pipeline.sql` → `mv_fact_conversions` |
| Known users dim | `clickhouse/ddl/15_dim_known_users.sql`, `17_fix_dim_known_users.sql` |
