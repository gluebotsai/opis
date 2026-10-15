# Web tracking link decode (Campaign email clicks)

## Landing URL

```text
https://beta.worktual.co.uk/?utm_source=worktual_campaign&utm_medium=email&utm_campaign={name}&wt={30-char-token}
```

## Shared secret

| Variable | Where |
|----------|--------|
| `WEB_TRACKING_HMAC_SECRET` | Campaign backend `.env` |
| `webTrackingHmacSecret` | SDK default in `config.js` — must match Campaign secret |

Default (QA): `change-me-web-tracking-hmac-secret-min-32-chars`

No `init()` key needed unless production uses a different secret:

```javascript
WorktualAnalytics.init({
  websiteId: 1001,
  websiteUrl: 'https://beta.worktual.co.uk',
  // webTrackingHmacSecret: '<prod secret>', // optional override
});
```

## Token format (30 characters only)

```text
org(6) + campaign(6) + contact(12) + sig(6)
```

Example:

```text
wt=0000GB0000JH0008NuKfj5tP0asHSz
→ org 1003, campaign 1195, contact 1830917733048487
```

| Segment | Chars | Field |
|---------|-------|--------|
| O | 0–5 | `wt_organization_id` |
| C | 6–11 | `wt_campaign_id` |
| U | 12–23 | `wt_contact_id` (exact CDP id) |
| sig | 24–29 | HMAC signature |

HMAC: `HMAC-SHA256(secret, "{O}|{C}|{U}")` → first 4 bytes → base62 padded to 6 chars.

SDK: `sdk/src/utils/web-tracking-link.js`

## Payload

Decoded ids + UTMs → `profiles.campaign.lastTouch` → `dim_sessions.wt_*`.

See [CDP_CAMPAIGN_ATTRIBUTION_REFERENCE.md](./CDP_CAMPAIGN_ATTRIBUTION_REFERENCE.md)
