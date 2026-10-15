# Worktual Campaign Track Links — Integration Spec

**Audience:** Campaign Management team  
**Owner:** Web Tracking + Campaign Management  
**Version:** 1.0  
**Status:** For Campaign review and implementation  

This document explains how campaign links must be built so Web Tracking can attribute visits to the **correct campaign and contact**, without exposing emails or personal data in the browser URL.

---

## 1. Summary (read this first)

| Topic | Rule |
|-------|------|
| **Link format (production)** | Email click → Campaign API → `https://beta.worktual.co.uk/?utm_*&wt={30-char token}` |
| **Legacy link format** | `https://beta.worktual.co.uk/t/{token}` (SDK fallback) |
| **Attribution handoff** | SDK reads `?wt=` + UTMs on `init()`; optional cookie `wt_attr` (not used in production) |
| **Never in URLs (final landing)** | Email, phone, name — use `wt` token instead of raw ids |

**Campaign owns:** link creation, token storage, redirect, click logging.  
**Web Tracking owns:** SDK capture, ingest, dashboards, session analytics.

---

## 2. Problem with current links

### What Campaign sends today (example)

```html
<a href="https://beta.worktual.co.uk" target="_blank">Shop LUKAS Now</a>
```

### Why this is not enough for Web Tracking

| What works | What does **not** work |
|------------|-------------------------|
| Page views and sessions (if SDK is installed) | Which **campaign** drove the visit |
| Anonymous `visitor_id` | Which **contact** clicked the email |
| General site traffic metrics | Join to Campaign DB on `campaign_id` + `contact_id` |
| | Reliable **email channel** attribution |

Email clients often strip referrer headers, so Web Tracking cannot infer campaign or contact from a plain homepage link.

### Rectification

**Stop using plain direct links** for tracked email / WhatsApp / SMS campaigns.

| Before (insufficient) | After (required) |
|----------------------|------------------|
| `https://beta.worktual.co.uk` | `https://go.worktual.com/l/Ab3xK9mN2pQr7sT8uV1wX2yZ` |

**Interim fallback (channel only, no per-contact tracking):**

```
https://beta.worktual.co.uk/?utm_source=worktual_campaign&utm_medium=email&utm_campaign={campaign_name}
```

Use track links for any campaign where you need **per-contact** reporting.

---

## 3. How it works end-to-end

```
┌─────────────────────────────────────────────────────────────────┐
│ 1. Campaign email / WhatsApp / SMS                              │
│    Link: https://go.worktual.com/l/Ab3xK9mN2pQr7sT8uV1wX2yZ     │
└───────────────────────────────┬─────────────────────────────────┘
                                │ click
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│ 2. Campaign Redirect Service (YOU build this)                   │
│    • Lookup token in database                                   │
│    • Reject if expired / invalid                                │
│    • Log click (campaign analytics)                             │
│    • Set cookie wt_attr (signed, ~5 min TTL)                    │
│    • HTTP 302 redirect to destination                           │
└───────────────────────────────┬─────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│ 3. Visitor lands on customer site                               │
│    Search bar shows: https://beta.worktual.co.uk/book-demo/     │
│    (clean URL — no email, no contact_id in query string)        │
└───────────────────────────────┬─────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│ 4. WorktualAnalytics SDK (Web Tracking)                        │
│    • Reads wt_attr cookie on init()                             │
│    • Sets profiles.campaign.lastTouch                           │
│    • Clears cookie after read                                   │
│    • Sends normal page_view / session / replay data             │
└───────────────────────────────┬─────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│ 5. ClickHouse / Dashboard                                       │
│    dim_sessions: wt_campaign_id, wt_contact_id, utm_*, …        │
│    Join keys for Campaign ↔ Web Tracking reporting              │
└─────────────────────────────────────────────────────────────────┘
```

---

## 4. Link design (Campaign responsibility)

### 4.1 Public link format

All attributed campaign links must use:

```
https://go.worktual.com/l/{token}
```

| Part | Rule |
|------|------|
| `{token}` | Random **24–32 character** opaque string (letters + numbers) |
| Domain | Agree with Web Tracking: `go.worktual.com` or existing `worktual.in/t/` |
| Same format | Email, WhatsApp, LinkedIn, SMS — one standard |

**Example token:** `Ab3xK9mN2pQr7sT8uV1wX2yZ`  
**Example full link:** `https://go.worktual.com/l/Ab3xK9mN2pQr7sT8uV1wX2yZ`

### 4.2 What the token maps to (database only — never in URL)

Store one row per link in a table such as `campaign_track_links`:

| Column | Type | Example | Notes |
|--------|------|---------|-------|
| `token` | string | `Ab3xK9mN2pQr7sT8uV1wX2yZ` | Unique lookup key |
| `organization_id` | uint64 | `1003` | Worktual org |
| `campaign_id` | uint64 | `10042` | Campaign record id |
| `contact_id` | uint64 | `55201` | Recipient id; use `0` if unknown |
| `channel` | string | `email` | `email`, `whatsapp`, `linkedin`, `sms`, … |
| `destination_url` | string | `https://beta.worktual.co.uk/book-demo/` | Must match registered site URL |
| `utm_source` | string | `worktual_campaign` | Optional — for traffic charts |
| `utm_medium` | string | `email` | Optional |
| `utm_campaign` | string | `10042` | Optional — campaign id or slug |
| `expires_at` | datetime | nullable | Optional link expiry |
| `created_at` | datetime | | Audit |

### 4.3 URL rules

**MUST:**

- Generate links only via Campaign UI / API (token + DB row).
- Redirect to a **clean** destination URL (path only, no PII in query).
- Set the `wt_attr` cookie on redirect (see Section 5).
- Ensure `destination_url` matches the site registered in Web Tracking ingest registry.

**MUST NOT:**

- Put email addresses in URLs (`?email=user@company.com`).
- Put phone numbers or names in URLs.
- Put raw `contact_id=` or `campaign_id=` in the **final** landing URL.
- Use plain `https://beta.worktual.co.uk` for 1:1 email campaigns that need attribution.

---

## 5. Redirect service (Campaign builds this)

### Endpoint

```
GET https://go.worktual.com/l/{token}
```

### Processing steps

1. **Lookup** `token` in `campaign_track_links`.
2. **Validate** — exists, not expired, campaign active.
3. **Log click** — token, timestamp, optional IP / user-agent (Campaign analytics).
4. **Build attribution payload** (see Section 5.2).
5. **Set cookie** `wt_attr` on response (signed JWT or HMAC JSON, TTL **5 minutes**, `SameSite=Lax`, domain e.g. `.worktual.co.uk`).
6. **Redirect** `302` to `destination_url` with **no sensitive query parameters**.

### 5.1 What the visitor sees in the browser

| Step | URL in address bar |
|------|---------------------|
| Link in message | `https://go.worktual.com/l/Ab3xK9mN2pQr7sT8uV1wX2yZ` |
| After redirect (target) | `https://beta.worktual.co.uk/book-demo/` |
| User navigates site | Normal paths, no tracking params repeated |

### 5.2 Cookie payload (`wt_attr`)

Web Tracking SDK reads this cookie on page load. Use **signed** payload (shared secret with Web Tracking team).

**Example JSON (before signing):**

```json
{
  "wt_organization_id": 1003,
  "wt_campaign_id": 10042,
  "wt_contact_id": 55201,
  "wt_channel": "email",
  "utm_source": "worktual_campaign",
  "utm_medium": "email",
  "utm_campaign": "10042",
  "exp": 1735689600
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `wt_organization_id` | Yes | Organization id |
| `wt_campaign_id` | Yes | Campaign database id |
| `wt_contact_id` | Yes | Contact id (`0` if unknown) |
| `wt_channel` | Yes | `email`, `whatsapp`, `linkedin`, `sms`, etc. |
| `utm_source` | Optional | For traffic source reports |
| `utm_medium` | Optional | e.g. `email` |
| `utm_campaign` | Optional | Campaign name or id |
| `exp` | Yes | Unix expiry (~5 min from click) |

**Do not** include email, phone, or name in this payload.

### 5.3 Fallback (if cookies are blocked)

Redirect with opaque token only, then Web Tracking strips it:

```
https://beta.worktual.co.uk/book-demo/?wt=Ab3xK9mN2pQr7sT8uV1wX2yZ
```

Provide resolve API:

```
GET /api/campaign/resolve?wt={token}
→ same JSON as cookie payload (authenticated / rate-limited)
```

SDK resolves once and removes `?wt=` from the address bar. Still no PII visible.

---

## 6. Email template example

### Before (do not use for attributed campaigns)

```html
<a href="https://beta.worktual.co.uk" style="...">Shop LUKAS Now</a>
```

### After (correct)

```html
<a href="https://go.worktual.com/l/Ab3xK9mN2pQr7sT8uV1wX2yZ" style="...">Shop LUKAS Now</a>
```

Generate `{token}` per recipient (or per campaign + contact pair) in Campaign UI when building the send list.

---

## 7. What Campaign Management must deliver

| # | Deliverable | Description |
|---|-------------|-------------|
| 1 | **Link builder** | UI or API: create token + DB row per contact/campaign |
| 2 | **Redirect service** | `GET /l/{token}` with cookie + 302 |
| 3 | **Click log** | Record clicks for Campaign-side reporting |
| 4 | **Signing secret** | Share with Web Tracking for `wt_attr` verification |
| 5 | **Resolve API** | Fallback `GET /api/campaign/resolve?wt={token}` |
| 6 | **QA test links** | 5–10 tokens for website `1001` / org `1003` (beta) |
| 7 | **Template migration** | Replace plain `beta.worktual.co.uk` hrefs in email templates |

---

## 8. What Web Tracking provides

| # | Deliverable | Description |
|---|-------------|-------------|
| 1 | **SDK update** | Read `wt_attr` cookie (and `?wt=` fallback) on `init()` |
| 2 | **Ingest pipeline** | Store `profiles.campaign.lastTouch` → `dim_sessions` |
| 3 | **Dashboard** | Campaign / contact attribution on sessions and visitors |
| 4 | **Registered sites** | Valid `destination_url` list (`websiteId`, `organizationId`) |
| 5 | **Verification query** | Sample query to confirm attribution in ClickHouse |
| 6 | **Joint QA** | End-to-end test with Campaign test links |

---

## 9. Data mapping (for your developers)

Token DB row + cookie → Web Tracking storage:

| Campaign field | SDK `profiles.campaign.lastTouch` | ClickHouse `dim_sessions` |
|----------------|-----------------------------------|---------------------------|
| `organization_id` | `wt_organization_id` | `wt_organization_id` |
| `campaign_id` | `wt_campaign_id` | `wt_campaign_id` |
| `contact_id` | `wt_contact_id` | `wt_contact_id` |
| `channel` | `wt_channel` | (in JSON / future column) |
| `utm_*` | `utm_source`, `utm_medium`, … | `utm_source`, `utm_medium`, … |

**Join keys for cross-product reporting:**

- Campaign → Web Tracking: `wt_campaign_id`, `wt_contact_id`, `organization_id`
- Web Tracking session: `visitor_id`, `session_id`, `website_id`

---

## 10. Comparison: link types

| Link type | Page views | Traffic source | Per-contact | Clean URL | Secure |
|-----------|------------|----------------|-------------|-----------|--------|
| Plain `https://beta.worktual.co.uk` | Yes | Weak | **No** | Yes | Yes |
| UTM query params only | Yes | Yes | **No** | No (UTM visible) | Yes |
| **Track link `go.worktual.com/l/{token}`** | Yes | Yes | **Yes** | **Yes** | **Yes** |

**Recommendation:** Use track links for all attributed outbound campaigns.

---

## 11. QA checklist (joint sign-off)

| # | Test | Expected result |
|---|------|-----------------|
| 1 | Click track link from test email | Lands on clean `destination_url` |
| 2 | Check browser address bar | No email, no `contact_id=` in URL |
| 3 | Web Tracking ingest payload | `profiles.campaign.lastTouch` has `wt_campaign_id`, `wt_contact_id` |
| 4 | ClickHouse `dim_sessions` | `wt_*` columns populated for session |
| 5 | Navigate 3 pages on site | Same session; attribution retained |
| 6 | Plain link control test | No `wt_*` on session (proves track link is required) |
| 7 | Expired token | Redirect service returns friendly error |
| 8 | Cookie blocked browser | Fallback `?wt=` resolves and URL is cleaned |

---

## 12. Rollout phases

| Phase | Owner | Actions |
|-------|--------|---------|
| **1 — Spec agreed** | Both | Review this document; agree domain and cookie domain |
| **2 — Campaign build** | Campaign | DB, link UI, redirect service, resolve API |
| **3 — Web Tracking build** | Web Tracking | SDK cookie reader, ingest verify, dashboard |
| **4 — Joint QA** | Both | Run Section 11 checklist on QA environment |
| **5 — Go-live** | Campaign | Update email/WhatsApp templates; retire plain links |

---

## 13. Web Tracking remaining work (internal backlog)

These items are **not** Campaign deliverables — Web Tracking team will implement after Campaign redirect is ready:

- [x] SDK: read `?wt=` (30-char only) + HMAC verify → `profiles.campaign.lastTouch`
- [x] SDK: contact segment 12 chars — exact CDP id in `wt_contact_id`
- [x] SDK: strip `wt` from URL after capture (`stripCampaignTokenFromUrl`, default true)
- [ ] SDK: read `wt_attr` cookie (optional — Campaign production uses homepage + `?wt=` instead)
- [ ] ClickHouse: ensure `dim_sessions` has `wt_organization_id`, `wt_campaign_id`, `wt_contact_id` on live
- [ ] Dashboard: show campaign/contact attribution on visitor and session views
- [ ] End-to-end QA script with Campaign test tokens
- [ ] Cookie consent: defer SDK `init()` until user accepts (site integration)

---

## 14. FAQ

**Q: Can we keep using Gmail “safe redirect” wrappers?**  
A: Yes. The underlying `href` must still be the track link (`go.worktual.com/l/{token}`).

**Q: Can we put campaign name in the URL for readability?**  
A: No. Use opaque token only. Campaign name stays in your DB.

**Q: One link per email or one link per campaign?**  
A: **One token per contact per send** (or per contact-campaign pair) for per-recipient tracking. One token per campaign only if you do not need contact-level attribution.

**Q: What if the customer site is not beta.worktual.co.uk?**  
A: `destination_url` must match the URL registered in Web Tracking for that `website_id` (ingest registry).

**Q: Do we still need UTMs?**  
A: Optional. Web Tracking can report from `wt_*` ids. UTMs in the cookie help traffic-source charts.

**Q: What about cookie consent banners?**  
A: Customer sites should init WorktualAnalytics **after** consent. Your redirect and cookie can still fire; SDK reads attribution once tracking is allowed.

---

## 15. References

**Web Tracking repo:**

- `docs/WEB_TRACKING_LINK_DECODE.md` — token format, decode steps, env vars
- `docs/CDP_PAYLOAD_FIELD_REFERENCE.md` — `profiles.campaign` field definitions
- `docs/CDP_EVENTS_CATALOG.md` — Section 3, email / campaign attribution
- `docs/CLIENT_INTEGRATION_GUIDE.md` — SDK install on customer sites
- `sdk/src/profiles/campaign.js` — SDK campaign profile
- `sdk/src/utils/attribution.js` — UTM capture (supplement to track links)

**One-line instruction for Campaign templates:**

> Replace every plain `https://beta.worktual.co.uk` campaign CTA with `https://go.worktual.com/l/{token}` generated in Campaign UI; never put email or contact details in the URL.

---

*Document prepared for Campaign Management. Questions: Web Tracking team.*
