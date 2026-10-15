# Campaign ↔ Web Tracking — track link QA handoff

**Date:** September 2026  
**From:** Campaign rebuild team  
**To:** Web Tracking team  
**Purpose:** Explain what Campaign has shipped for email click attribution, what we fixed during QA, why beta currently shows a “page not found” screen, and what Web Tracking needs to deploy for joint QA to pass.

You can attach or paste this document in email. Technical decode details remain in [`WEB_TRACKING_LINK_DECODE.md`](./WEB_TRACKING_LINK_DECODE.md).

---

## TL;DR for stakeholders

**Why doesn’t the link “open” properly today?**

**Update (lab):** Campaign Track link lab now redirects to the homepage with UTMs + `wt={token}`:

```text
https://example.com/?utm_source=worktual_campaign&utm_medium=email&utm_campaign={name}&wt={30-char-token}
```

The homepage should load even if the SDK does not yet read `wt`. Campaign click log still works via the click wrapper.

**Earlier `/t/{token}` 404:** that path form is no longer used by the lab. Production email send still uses `/t/{token}` until cutover.

**What is needed on Web Tracking:** read query params `wt` + UTMs in the SDK; decode the same 30-char HMAC token (v2: org6+camp6+contact12+sig6) (see `WEB_TRACKING_LINK_DECODE.md`).

---

## End-to-end click flow (current implementation)

```text
User clicks link in email (or Track link lab)
        │
        ▼
┌───────────────────────────────────────────────────────────────┐
│ 1. Campaign API (click log)                                   │
│    GET {API_PUBLIC_URL}/api/campaigns/track/click/{recipient} │
│        ?u={urlencoded https://example.com/t/{token}}  │
│    • Records click on CampaignSendRecipient (clickedAt)       │
│    • HTTP 302 redirect to u=                                  │
└───────────────────────────────────────────────────────────────┘
        │
        ▼
┌───────────────────────────────────────────────────────────────┐
│ 2. Web Tracking landing (YOUR SIDE — not live on beta yet)    │
│    GET https://example.com/t/{token}                  │
│    • Parse 30-char token (v2)                                      │
│    • Verify HMAC signature (shared secret)                    │
│    • Decode org / campaign / contact ids                      │
│    • Attribute session (SDK / ClickHouse)                     │
│    • Redirect to https://example.com/ (or landing)    │
└───────────────────────────────────────────────────────────────┘
        │
        ▼
   User sees homepage (expected after successful decode)
```

**Email opens** (separate from clicks) still use Campaign’s open pixel:

```text
{API_PUBLIC_URL}/api/campaigns/track/open/{recipientId}
```

Only **clicks** use the beta `/t/{token}` path.

---

## What Campaign has built

### Production email sends

| Capability | Status | Location |
|------------|--------|----------|
| Per-recipient HMAC token at send time | ✅ Live | `backend/src/helpers/web-tracking-link.ts` |
| Two-step click: Campaign log → redirect to `/t/{token}` | ✅ Live | `backend/src/helpers/email-track.ts`, `email-send-worker.ts` |
| Click recording (`clickedAt` on recipient) | ✅ Live | `backend/src/modules/campaign/handler.ts` |
| Open pixel | ✅ Live | Same handler module |
| Shared secret env var | ✅ Configured | `WEB_TRACKING_HMAC_SECRET` in Campaign `backend/.env` |
| Landing base URL env var | ✅ Configured | `WEB_TRACKING_LANDING_URL` (default `https://example.com`) |
| Decode spec for your team | ✅ Documented | `docs/WEB_TRACKING_LINK_DECODE.md` |

### Temporary QA tooling (Configuration → Email)

| Capability | Status | Notes |
|------------|--------|-------|
| **Track link lab** UI | ✅ Shipped | Configuration → Email → “Track link lab (temporary QA)” |
| Preview API | ✅ Shipped | `POST /api/configuration/email/track-link-preview` |
| Generate token + URLs without sending email | ✅ Shipped | Uses same encoding as production |
| Fixed lab recipient id for click log | ✅ Shipped | `00000000-0000-4000-8000-000000000099` |

**Lab defaults for joint QA:**

| Field | Example value |
|-------|----------------|
| Organization id | `1003` |
| Campaign id | `10042` |
| Contact id | `55201` |

---

## What Campaign fixed during QA (September 2026)

These were Campaign-side issues we resolved. They explain earlier confusion during testing.

| Issue | Cause | Campaign fix |
|-------|--------|--------------|
| `Route POST …/track-link-preview not found` | API running old code | Route registered; API restart required after deploy |
| Track link lab email click skipped `/t/{token}` when “destination URL” was filled | Lab used destination as redirect target (unlike production) | **Fixed:** lab `email_click_url` always redirects via `/t/{token}`, matching production sends |
| Misleading default destination `…/book-demo/` | Form default pointed at a page that does not exist on beta | **Fixed:** default cleared; field relabelled “Future landing page (not used yet)” |
| UI said “redirects to web tracking” but sometimes went to plain homepage | Copy did not match lab behaviour | **Fixed:** UI copy updated to describe `/t/{token}` path |

**Important:** Production email sends **always** used `/t/{token}` when `WEB_TRACKING_HMAC_SECRET` is set. The destination-URL confusion applied only to the temporary lab (now fixed).

---

## What we verified on our side

We tested the redirect chain from Campaign API:

```text
GET /api/campaigns/track/click/{recipientId}
    ?u=https%3A%2F%2Fexample.com%2Ft%2F{token}

→ 302 Location: https://example.com/t/{token}
→ beta responds with redirect to /page-not-found
→ user sees “page not found” on beta
```

**Conclusion:** Campaign’s redirect target is correct. Beta does not handle `/t/{token}` yet.

---

## Why the page looks like “not found” (plain language for users)

If someone asks *“Why doesn’t the tracking link work?”*, you can say:

1. **The link does open** — the browser reaches `example.com`.
2. **Campaign has already logged the click** on our side when they used the email-style URL (first hop).
3. **The path `/t/…` is not wired on beta yet.** The website treats it like an unknown page and shows its standard 404 / “page not found” screen.
4. **No campaign/contact attribution happens** on the Web Tracking side until your team decodes the token at that URL.
5. This is **expected until Web Tracking deploys the `/t/{token}` handler** — not a user error and not a wrong destination URL.

Direct navigation to `https://example.com/` (homepage only) will never show attribution — there is no token in the URL.

---

## What Web Tracking needs to do

### Required for joint QA (current `/t/{token}` phase)

1. **Deploy route handler on beta**  
   - Accept: `GET https://example.com/t/{token}`  
   - Token length: **30 characters** (v2) (base62)

2. **Use the shared HMAC secret**  
   - Same value as Campaign `WEB_TRACKING_HMAC_SECRET`  
   - Coordinate securely out of band (do not commit production secrets to git)  
   - Generate example: `openssl rand -base64 32`

3. **Decode token** (see [`WEB_TRACKING_LINK_DECODE.md`](./WEB_TRACKING_LINK_DECODE.md))  
   - Split: `{org:6}{campaign:6}{contact:6}{sig:6}`  
   - Verify signature: `HMAC-SHA256(secret, "{orgSeg}|{campSeg}|{custSeg}")`  
   - Decode segments from base62 → bigint ids

4. **Attribute the visit**  
   - e.g. set session fields / send to ClickHouse:  
     `wt_organization_id`, `wt_campaign_id`, `wt_contact_id`  
   - Ensure **WorktualAnalytics SDK** on beta reads attribution after redirect

5. **Redirect after decode**  
   - Default: `https://example.com/`  
   - Invalid/expired token: safe fallback (homepage or error page — agree with Campaign)

6. **Confirm with Campaign QA ids**  
   After deploy, we will retest with org **1003**, campaign **10042**, contact **55201** and expect those ids in your analytics.

### Reference implementation (Campaign side)

Your decode logic should match:

- `backend/src/helpers/web-tracking-link.ts` — `parseWebTrackingToken`, `decodeSegment`, `buildWebTrackingToken`

---

## Token format (quick reference)

**URL:**

```text
https://example.com/t/{30-char-token}
```

**Token layout:**

```text
{organization:6}{campaign:6}{contact:6}{signature:6}
```

- Alphabet: `0-9A-Za-z` (base62)  
- Missing contact id → encoded as `0`  
- Max id per segment: `< 62^6` (56,800,235,583)

**Example lab token shape** (ids 1003 / 10042 / 55201):

```text
https://example.com/t/0000CB0002by000EML3Pt210
```

(Exact token varies with secret and ids; always 30 chars after `/t/`.)

---

## Environment alignment checklist

| Variable | Campaign | Web Tracking |
|----------|----------|--------------|
| `WEB_TRACKING_HMAC_SECRET` | Set in `backend/.env` | **Must match exactly** |
| Landing origin | `WEB_TRACKING_LANDING_URL=https://example.com` | Serve `/t/{token}` on this host |
| SDK on beta | N/A | Required for post-redirect attribution |

---

## How to test together (step-by-step)

### Campaign team

1. Open **Configuration → Email → Track link lab**
2. Enter org `1003`, campaign `10042`, contact `55201`
3. Leave **Future landing page** empty
4. Click **Generate link**
5. Open **Email-style click URL** (full production path) **or** **Web tracking URL** (`/t/…` directly)

### Expected after Web Tracking deploy

| Step | Expected result |
|------|-----------------|
| Click email-style URL | Brief hop via Campaign API → land on beta (homepage after decode) |
| Click web tracking URL | Same `/t/{token}` decode path |
| Campaign DB | Click recorded on lab recipient or send recipient |
| Web Tracking analytics | Session shows org 1003, campaign 10042, contact 55201 |

### Current behaviour (before your deploy)

| Step | Result |
|------|--------|
| Campaign redirect | ✅ Correct — sends user to `/t/{token}` |
| Beta page | ❌ “Page not found” — `/t/` route missing |

---

## Out of scope for this phase (future spec)

The full track-link spec (shared separately) may include items **not implemented yet** on either side:

- Short links on `go.worktual.com/l/{token}`
- `wt_attr` cookie + resolve API
- `campaign_track_links` DB table and token expiry/revoke
- Registered per-campaign destination URLs in redirect service
- Mass template migration

**Do not** mass-update live email templates until Phase 4 joint QA passes for the agreed flow.

Campaign’s **current** production path is: **Campaign click log → `example.com/t/{token}`**.

---

## Campaign contacts & docs

| Resource | Path |
|----------|------|
| Decode specification | `docs/WEB_TRACKING_LINK_DECODE.md` |
| Token builder / parser | `backend/src/helpers/web-tracking-link.ts` |
| Email click wrapper | `backend/src/helpers/email-track.ts` |
| Track link lab API | `POST /api/configuration/email/track-link-preview` |
| QA UI | Frontend → Configuration → Email → Track link lab |

---

## Summary email snippet (copy/paste)

> Hi Web Tracking team,
>
> Campaign has implemented email click tracking with a two-step flow: our API logs the click, then redirects to `https://example.com/t/{30-char-HMAC-token}`. We added a Track link lab in Configuration for joint QA (test ids: org 1003, campaign 10042, contact 55201).
>
> During QA we confirmed Campaign redirects correctly, but beta returns “page not found” for `/t/{token}` — the route needs to be implemented on your side per `WEB_TRACKING_LINK_DECODE.md`, using the same `WEB_TRACKING_HMAC_SECRET` as our backend.
>
> Full handoff: see attached **`WEB_TRACKING_JOINT_QA_HANDOFF.md`**.
>
> Once `/t/{token}` is live on beta, we can rerun QA and confirm attribution in ClickHouse/SDK together.

---

*Document version: September 2026 — Campaign rebuild track link lab + production send path.*
