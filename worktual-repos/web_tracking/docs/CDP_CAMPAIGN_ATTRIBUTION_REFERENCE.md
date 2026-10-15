# CDP — Campaign attribution payload reference

**Audience:** CDP / data platform team  
**Purpose:** How Worktual Campaign email clicks appear in Web Tracking ingest payloads and ClickHouse.

Campaign clicks do **not** use a separate event name. Attribution is carried on **`profiles.campaign`** inside every `events_v3` batch (when the SDK captured UTMs and/or a valid `?wt=` token).

---

## Ingest

| Item | Value |
|------|--------|
| **Method** | `POST` |
| **URL (current / QA)** | `https://qatrackingapi.worktual.com/webtracking/v1/tracking/nfs-ingestions` |
| **Path** | `/v1/tracking/nfs-ingestions` (under `/webtracking` prefix on QA host) |
| **Payload type** | `events_v3` |

This is the endpoint used today by the SDK default config and beta sites. Same payload shape applies if the host changes later; only the base URL differs.

---

## How the user arrives (Campaign → site)

1. User clicks link in email.
2. Campaign API records the click and redirects to the client site, e.g.:

```text
https://beta.worktual.co.uk/?utm_source=worktual_campaign&utm_medium=email&utm_campaign=Industry+Mastery+Guide&wt={30-char-token}
```

3. Web Tracking SDK on the site reads URL params on load, decodes `?wt=` (when valid), and attaches **`profiles.campaign`** to ingest batches.

**Campaign click tracker example (redirect wrapper):**

```text
https://rebuild-campaign-api.worktual.com/api/campaigns/track/click/{campaignId}?u={url-encoded-landing-url}
```

The `u=` parameter must include both UTMs **and** a **30-character** `wt` token for CDP ids to be populated.

---

## `profiles.campaign` shape

```json
{
  "id": "cp_jttthq7ekmttzg47j",
  "firstTouch": { },
  "lastTouch": { }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Stable campaign profile id (`cp_…`). Referenced by event field **`cid`**. |
| `firstTouch` | object | First attributed visit in the visitor lookback window. |
| `lastTouch` | object | Most recent attributed visit (updated when new UTMs / valid `wt` arrive). |

Both touch objects use the **same field set** (see table below).

---

## Touch object fields (`firstTouch` / `lastTouch`)

### From URL (always available when Campaign adds UTMs)

| Field | Type | Example | Notes |
|-------|------|---------|--------|
| `utm_source` | string | `worktual_campaign` | Standard UTM |
| `utm_medium` | string | `email` | Standard UTM |
| `utm_campaign` | string | `Industry Mastery Guide` | Campaign display name |
| `utm_term` | string | optional | Paid search |
| `utm_content` | string | optional | Creative variant |
| `referrer` | string | optional | Document referrer at capture |
| `capturedAt` | number | `1788954363201` | Unix ms when SDK captured this touch |

### From decoded `?wt=` token (v2 only — **30 chars**)

Present only when Campaign sends a valid v2 token and HMAC verifies.

| Field | Type | Example | CDP use |
|-------|------|---------|---------|
| `wt_organization_id` | number | `1003` | Worktual org that owns the campaign |
| `wt_campaign_id` | number | `1195` | Campaign row id in Campaign DB |
| `wt_contact_id` | number or string | `1830917733048487` | **Exact CDP contact id** (large ids sent as string) |

**Not sent / not used:**

| Field | Status |
|-------|--------|
| Raw `wt` token | Never stored in payload or ClickHouse |
| `wt_cid` | Never used |
| `wt_channel` | Spec only — SDK does not set it (use `utm_medium=email`) |

---

## `wt` token (v2 — required for `wt_*` ids)

```text
org(6) + campaign(6) + contact(12) + sig(6) = 30 characters (base62)
```

**Example token:**

```text
wt=0000GB0000JH0008NuKfj5tP0asHSz
```

| Segment | Chars | Decodes to |
|---------|-------|------------|
| `0000GB` | 0–5 | `wt_organization_id` = **1003** |
| `0000JH` | 6–11 | `wt_campaign_id` = **1195** |
| `0008NuKfj5tP` | 12–23 | `wt_contact_id` = **1830917733048487** |
| `0asHSz` | 24–29 | HMAC signature |

**HMAC:** `HMAC-SHA256(WEB_TRACKING_HMAC_SECRET, "{O}|{C}|{U}")` → first 4 bytes → base62 padded to 6 chars.

**Legacy v1 (24-char tokens) are not supported.** If Campaign sends 24 chars, CDP will see UTMs only (see partial example below).

Token decode spec: [WEB_TRACKING_LINK_DECODE.md](./WEB_TRACKING_LINK_DECODE.md)

---

## Full example payload (email click — complete)

Use this as the **reference shape** CDP should expect when Campaign + SDK are aligned.

```json
{
  "type": "events_v3",
  "payloadId": "uuid-…",
  "websiteId": 1001,
  "websiteUrl": "beta.worktual.co.uk",
  "organizationId": 1003,
  "visitorId": "visitor_abc123",
  "sessionId": "session_xyz789",
  "sdkVersion": "2.0.0",
  "profiles": {
    "browser": { },
    "visitor": { },
    "session": { },
    "campaign": {
      "id": "cp_email_touch_001",
      "firstTouch": {
        "utm_source": "worktual_campaign",
        "utm_medium": "email",
        "utm_campaign": "Industry Mastery Guide",
        "wt_organization_id": 1003,
        "wt_campaign_id": 1195,
        "wt_contact_id": 1830917733048487,
        "capturedAt": 1788951355471
      },
      "lastTouch": {
        "utm_source": "worktual_campaign",
        "utm_medium": "email",
        "utm_campaign": "Industry Mastery Guide",
        "wt_organization_id": 1003,
        "wt_campaign_id": 1195,
        "wt_contact_id": 1830917733048487,
        "capturedAt": 1788951355471
      }
    },
    "pages": { }
  },
  "events": [
    {
      "eventId": "evt_001",
      "name": "page_view",
      "ts": 1788951355500,
      "pid": "pg_home",
      "cid": "cp_email_touch_001",
      "props": {
        "path": "/",
        "title": "Home"
      }
    }
  ]
}
```

### Linking events to campaign

| Event field | Points to |
|-------------|-----------|
| `cid` | `profiles.campaign.id` |
| Touch UTMs + `wt_*` | `profiles.campaign.firstTouch` / `lastTouch` |

---

## Partial example (UTMs only — incomplete handoff)

If Campaign redirect has UTMs but **no valid 30-char `wt`**, CDP will see **only**:

```json
"campaign": {
  "id": "cp_jttthq7ekmttzg47j",
  "firstTouch": {
    "utm_source": "worktual_campaign",
    "utm_medium": "email",
    "utm_campaign": "Industry Mastery Guide",
    "capturedAt": 1788951355471
  },
  "lastTouch": {
    "utm_source": "worktual_campaign",
    "utm_medium": "email",
    "utm_campaign": "Industry Mastery Guide",
    "capturedAt": 1788954363201
  }
}
```

**Missing:** `wt_organization_id`, `wt_campaign_id`, `wt_contact_id`

| Cause | Campaign / SDK action |
|-------|-------------------------|
| No `&wt=` on landing URL | Campaign must append 30-char token to redirect |
| `wt` is 24 chars (v1) | Campaign must upgrade to v2 token builder |
| HMAC secret mismatch | Align `WEB_TRACKING_HMAC_SECRET` with SDK `webTrackingHmacSecret` |

CDP should treat **`wt_contact_id` absent** as “contact not resolved on this session” — do not infer contact from UTMs alone.

---

## ClickHouse (Web Tracking schema)

Database: **`web_tracking`**

### Session-level columns (`dim_sessions`)

| Column | Source in payload |
|--------|-------------------|
| `utm_source` | `profiles.campaign.lastTouch.utm_source` (or firstTouch fallback in MV) |
| `utm_medium` | `profiles.campaign.lastTouch.utm_medium` |
| `utm_campaign` | `profiles.campaign.lastTouch.utm_campaign` |
| `wt_organization_id` | `profiles.campaign.lastTouch.wt_organization_id` |
| `wt_campaign_id` | `profiles.campaign.lastTouch.wt_campaign_id` |
| `wt_contact_id` | `profiles.campaign.lastTouch.wt_contact_id` |

### Example queries

**Sessions with campaign contact resolved:**

```sql
SELECT
  session_id,
  visitor_id,
  utm_campaign,
  wt_organization_id,
  wt_campaign_id,
  wt_contact_id,
  started_at
FROM web_tracking.dim_sessions FINAL
WHERE website_id = 1001
  AND wt_campaign_id IS NOT NULL
ORDER BY started_at DESC
LIMIT 50;
```

**UTM-only sessions (no CDP contact link):**

```sql
SELECT session_id, utm_campaign, wt_campaign_id, wt_contact_id
FROM web_tracking.dim_sessions FINAL
WHERE website_id = 1001
  AND utm_source = 'worktual_campaign'
  AND wt_campaign_id IS NULL
ORDER BY started_at DESC
LIMIT 50;
```

---

## CDP integration checklist

| # | Rule |
|---|------|
| 1 | Read **`profiles.campaign.lastTouch`** for current session attribution; use **`firstTouch`** for original acquisition. |
| 2 | Join events to campaign via **`events[].cid` = `profiles.campaign.id`**. |
| 3 | Use **`wt_contact_id`** to link session to CDP contact (not `utm_campaign` name). |
| 4 | Use **`wt_campaign_id`** for Campaign DB join (numeric id, not display name). |
| 5 | Do **not** expect raw `wt` token or `wt_cid` in any payload field. |
| 6 | **`utm_medium=email`** + missing `wt_*` → flag as incomplete Campaign handoff, not SDK failure. |

---

## Related documents

| Document | Contents |
|----------|----------|
| [CDP_PAYLOAD_FIELD_REFERENCE.md](./CDP_PAYLOAD_FIELD_REFERENCE.md) | Full `events_v3` batch schema (all profiles + events) |
| [WEB_TRACKING_LINK_DECODE.md](./WEB_TRACKING_LINK_DECODE.md) | `wt` token encode/decode spec for Campaign engineering |
| [CDP_EVENTS_CATALOG.md](./CDP_EVENTS_CATALOG.md) | All event names (campaign is profile-only, not a separate event) |
| [CAMPAIGN_TRACK_LINK_SPEC.md](./CAMPAIGN_TRACK_LINK_SPEC.md) | End-to-end Campaign ↔ Web Tracking link spec |

---

## Contact / ownership

| Area | Team |
|------|------|
| Campaign redirect + `wt` token generation | Campaign API (`rebuild-campaign-api.worktual.com`) |
| SDK decode + payload shape | Web Tracking SDK |
| Ingest + ClickHouse storage | Web Tracking ETL / platform |
