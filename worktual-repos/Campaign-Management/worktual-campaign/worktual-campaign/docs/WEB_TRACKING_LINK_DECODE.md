# Web tracking link decode (Campaign email clicks)

Campaign email CTAs use a **two-step** click path:

1. **Campaign API** records click rate:  
   `{API_PUBLIC_URL}/api/campaigns/track/click/{recipientId}?u={encodedDest}`
2. **Redirect** to the **template destination URL** (from knowledge, form, or user) with UTMs + token:

```text
{destination}?utm_source=worktual_campaign&utm_medium=email&utm_campaign={name}&wt={30-char-token}
```

**Template creation / preview** uses that same real `https://` href (no merge-tag placeholder).  
**Send** wraps it as `track/click?u=` and stamps `utm_*` + `wt=` onto the destination.

## Environment (shared with Campaign backend)

| Variable | Example | Purpose |
|----------|---------|---------|
| `WEB_TRACKING_HMAC_SECRET` | `change-me-32-byte-minimum-secret` | **Same value on Campaign backend and web tracking** |
| `API_PUBLIC_URL` | `https://…` or LAN API origin | Must be reachable from recipients’ mail clients |

Generate a strong secret once and share securely with the web tracking team:

```bash
openssl rand -base64 32
```

## URL format (lab + production email CTAs)

**In the email / lab click href:**

```text
{API_PUBLIC_URL}/api/campaigns/track/click/{recipientId}?u={urlencoded destination + UTM + wt}
```

**Final redirect (web tracking):**

```text
{destination}?utm_source=worktual_campaign&utm_medium=email&utm_campaign={name}&wt={token}
```

| Query param | Value |
|-------------|--------|
| `utm_source` | `worktual_campaign` |
| `utm_medium` | `email` (channel) |
| `utm_campaign` | Campaign display name (URL-encoded) |
| `wt` | **30-char** HMAC token (v2 — exact CDP contact id) |

Homepage always loads (same as UTM ads). SDK reads `wt` + UTMs and decodes contact from the token — no raw contact id query param.

## Legacy path URL (decode fallback only)

```text
{destination_origin}/t/{token}
```

## Token v2 (30 chars) — current

```text
{org:6}{campaign:6}{contact:12}{sig:6}
```

Contact uses **12** base62 characters so full CDP/snowflake ids decode to the **exact** original value (no fold).

## Token v1 (24 chars) — legacy only

```text
{org:6}{campaign:6}{contact:6}{sig:6}
```

Old emails may still carry 24-char tokens where contact was SHA-256-folded. Prefer v2 for all new sends.

## Encoding

- **Alphabet:** `0-9A-Za-z` (base62)
- **Org / campaign:** 6 characters each (`< 62^6` ≈ 56.8B)
- **Contact:** 12 characters (`< 62^12` ≈ 3.2×10²¹) — exact bigint, **no fold**
- **IDs:** Campaign DB numeric ids as decimal strings / bigint. Missing contact → `0`.
- **Signature:** `HMAC-SHA256(secret, "{orgSeg}|{campSeg}|{custSeg}")`, first 4 bytes → base62 padded to 6 chars

## Decode steps (web tracking SDK)

1. Read query param `wt` (preferred).
2. (Legacy) Or parse path `/t/{token}`.
3. If `token.length === 30` (v2):
   - `O = token[0:6]`, `C = token[6:12]`, `U = token[12:24]`, `sig = token[24:30]`
4. Else if `token.length === 24` (v1 legacy):
   - `O = token[0:6]`, `C = token[6:12]`, `U = token[12:18]`, `sig = token[18:24]`
5. Recompute signature from `O|C|U` with shared secret; reject if mismatch.
6. Decode each segment from base62 → bigint:
   - `organization_id = decode(O)`
   - `campaign_id = decode(C)`
   - `contact_id = decode(U)` (0 = unknown; **v2 = exact CDP id**)
7. Attribute visit using token ids + optional UTMs (`utm_source`, `utm_medium`, `utm_campaign`).

Reference implementation: `backend/src/helpers/web-tracking-link.ts` (`parseWebTrackingToken`, `buildWebTrackingUtmLandingUrl`).

## ID limits

| Field | Width | Capacity |
|-------|-------|----------|
| org | 6 | ≈ 56.8B |
| campaign | 6 | ≈ 56.8B |
| contact (v2) | 12 | ≈ 3.2×10²¹ (full snowflake CDP ids) |

Pass contact ids as **decimal strings** (not JS `Number`) so values above `Number.MAX_SAFE_INTEGER` keep precision.

## Email open tracking

Email **opens** still use Campaign API pixel (`API_PUBLIC_URL/api/campaigns/track/open/{recipientId}`). Clicks stamp `wt=` onto the template destination URL.
