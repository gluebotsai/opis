# Campaign ↔ My Accounts push credentials

**Audience:** Campaign backend / onboarding  
**Purpose:** App Push and Web Push **provider secrets** live in My Accounts (Setup → Channel Setup). Campaign fetches them at send time and **must not** copy FCM JSON, APNs PEM, or VAPID private keys into `campaign.push_channel_settings`.

Device tokens and browser subscriptions stay in `campaign.push_endpoints`. Company backends still register App Push tokens with **`X-Api-Key`** (`wk_ap_…`) — that flow is unchanged. See [`CAMPAIGN_APP_PUSH_ONBOARDING_HANDOFF.md`](./CAMPAIGN_APP_PUSH_ONBOARDING_HANDOFF.md).

---

## 1. Env (Campaign backend + agents)

| Variable | Role |
|----------|------|
| `ACCOUNTS_API_BASE_URL` | My Accounts host, e.g. `https://staging-onboarding.worktual.com`. **Empty = legacy** (read/write local `push_channel_settings`). |
| `PRODUCT_MCP_CONNECTORS_TOKEN` | Preferred service token (`Authorization: Bearer` + `x-product-mcp-token`). |
| `INTERNAL_SERVICE_KEY` | Fallback (`x-internal-service-key`) if MCP token is unset. Must match Accounts. |

---

## 2. APIs Campaign calls (backend only)

```http
GET /api/v1/internal/campaign-channels/app-push?organization_id={org}
GET /api/v1/internal/campaign-channels/app-push/credentials?organization_id={org}
GET /api/v1/internal/campaign-channels/web-push?organization_id={org}
GET /api/v1/internal/campaign-channels/web-push/credentials?organization_id={org}
POST /api/v1/internal/compliance/evaluate
```

List has **no secrets**. Credentials are kept **in memory** (short TTL cache) for send.

| HTTP | `code` | Campaign behaviour |
|------|--------|-------------------|
| 404 | `not_configured` | Fall back to local Campaign settings (migration). |
| 409 | `channel_inactive` | Do not send. Ask customer to activate in Channel Setup. |
| 409 | `needs_reauth` | Do not send. Customer re-uploads keys in Channel Setup. |
| 401 / network | — | Log and fall back to local settings so send is not bricked. |

---

## 3. Code map

| Concern | Path |
|---------|------|
| Mapping + Python client | `agents/app/integrations/accounts_campaign_channels.py` |
| TS send adapter | `backend/src/services/accounts-campaign-channels.ts` |
| Status / config bundle overlay | `backend/src/dao/push-config.ts` |
| FCM/APNs/VAPID send | `backend/src/services/push-providers.ts` |
| Compliance before batch | `backend/src/services/push-send-worker.ts` |

---

## 4. What Campaign still owns

- `POST /api/app-push/endpoints` + org `wk_ap_` key
- `campaign.push_endpoints` (`channel = web` for browsers, `app` for devices)
- Web Push SDK: `GET /api/sdk/web-push.js` (Accounts env **`VITE_CAMPAIGN_WEB_PUSH_SDK_URL`** = `{API_PUBLIC_URL}/api/sdk/web-push.js`; edge nginx proxies `/api` only)
- Snippet subscribe: `POST /api/v1/push/subscribe` (`organization_id` + `channel_config_id` + endpoint + keys)
- Legacy Web public APIs (`/api/public/web-push/*`) site origin + subscribe_key
- Compliance evaluate is called per push **batch** (`channel: app_push` or `web_push`). 404 on that route is skipped until Accounts deploys it.

**Not in this change:** `appPushSubscribers` / `webPushSubscribers` quota (no quote API URL in the onboarding contract).

See [`CAMPAIGN_WEB_PUSH_ONBOARDING_HANDOFF.md`](./CAMPAIGN_WEB_PUSH_ONBOARDING_HANDOFF.md) for the Crusher / customer snippet pack.
