# Campaign Web push — onboarding handoff (Crusher / My Accounts)

**Audience:** Onboarding (Crusher), My Accounts Channel Setup, solution engineers  
**Purpose:** When a company wants **browser Web Push** from Campaign, the tenant configures **VAPID in My Accounts**, pastes a **site snippet**, and Campaign stores subscriptions and sends.  
**Status:** Campaign SDK and subscribe API are live on **rebuild-campaign-api**. Quota (`webPushSubscribers`) is **not** in this handoff.

Related: [CAMPAIGN_PUSH_ACCOUNTS_INTEGRATION.md](./CAMPAIGN_PUSH_ACCOUNTS_INTEGRATION.md) (credentials at send), [CAMPAIGN_APP_PUSH_ONBOARDING_HANDOFF.md](./CAMPAIGN_APP_PUSH_ONBOARDING_HANDOFF.md) (mobile tokens — different path).

---

## 1. When to use this flow

| Situation | Use Web push onboarding |
|-----------|-------------------------|
| Customer’s **website** should receive Campaign browser notifications | Yes |
| Customer asks for the **install snippet** / `web-push.js` URL | Yes |
| Customer only needs **App push** (mobile FCM/APNs) | No — [App push handoff](./CAMPAIGN_APP_PUSH_ONBOARDING_HANDOFF.md) |
| Customer only needs email / SMS / WhatsApp | No |

**Trigger:** “We need Web Push on our site” / “snippet from Channel Setup doesn’t subscribe.”

**Outcome:**

- Tenant **Web Push** is **active** in **My Accounts → Setup → Channel Setup**.
- Customer hosts a **same-origin service worker** and loads Campaign **`web-push.js`**.
- Browsers POST to Campaign **`/api/v1/push/subscribe`**. Campaign stores the endpoint on **`campaign.push_endpoints`** (`channel = web`).

---

## 2. Who does what

```text
My Accounts Channel Setup          Customer website                 Campaign API
  generate VAPID keys                paste snippet                    /api/sdk/web-push.js
  show snippet (org + channel        host /worktual-web-push-sw.js    POST /api/v1/push/subscribe
    + public key + SDK URL)          permission + PushManager         push_endpoints + send
```

| Role | Responsibility |
|------|----------------|
| **My Accounts** | Create Web Push channel, generate VAPID, show snippet. **Never** send the private key to the browser. |
| **Onboarding** | Confirm channel **active**, give the customer the **SDK URL**, **service-worker file**, and this pack. |
| **Customer website** | HTTPS page, paste snippet, host **`/worktual-web-push-sw.js`** on **their origin**. |
| **Campaign** | Host SDK + SW script, accept subscribe, load VAPID **in memory at send**, evaluate compliance. |

Campaign **must not** copy the VAPID **private** key into `campaign.push_channel_settings`.

---

## 3. URLs (live rebuild)

| Surface | URL |
|---------|-----|
| Campaign API | `https://rebuild-campaign-api.worktual.com` |
| **SDK (for Accounts `VITE_CAMPAIGN_WEB_PUSH_SDK_URL`)** | `https://rebuild-campaign-api.worktual.com/api/sdk/web-push.js` |
| Service worker implementation | `https://rebuild-campaign-api.worktual.com/api/sdk/web-push-sw.js` |
| Same-origin stub (copy to customer site) | `https://rebuild-campaign-api.worktual.com/api/sdk/worktual-web-push-sw.js` |
| Subscribe | `POST https://rebuild-campaign-api.worktual.com/api/v1/push/subscribe` |
| Public VAPID config | `GET https://rebuild-campaign-api.worktual.com/api/v1/push/config?organization_id={org}` |
| Legacy public APIs (still supported) | `GET\|POST /api/public/web-push/config\|visit\|subscribe` |

---

## 4. My Accounts snippet (what Channel Setup should emit)

Set frontend env:

```bash
VITE_CAMPAIGN_WEB_PUSH_SDK_URL=https://rebuild-campaign-api.worktual.com/api/sdk/web-push.js
```

Copy-paste for the customer site **`<head>`** (values come from Channel Setup, not Campaign UI):

```html
<script>
  window.WorktualWebPush = {
    organizationId: 1000,
    channelId: 1200,
    applicationServerKey: "<VAPID_PUBLIC_KEY_FROM_CHANNEL_SETUP>",
    email: "<SHOPPER_EMAIL_AFTER_LOGIN>"
  };
</script>
<script src="https://rebuild-campaign-api.worktual.com/api/sdk/web-push.js" async></script>
```

Aliases the SDK also accepts: `organization_id`, `channel_config_id`, `vapidPublicKey`, `userEmail`, `phone` / `userPhone`. `autoSubscribe` defaults to **true**.

Without **email** or **phone**, Campaign still stores the browser subscription but **does not** fill the Contacts Web Push ID. After login, set `email` (same as the Campaign contact) and call `WorktualWebPush.subscribe()` again if the shopper already opted in anonymously.

### Service worker (required)

Browsers only allow a service worker from the **page origin**. The customer must publish this file at **`https://their-site/worktual-web-push-sw.js`**:

```js
importScripts("https://rebuild-campaign-api.worktual.com/api/sdk/web-push-sw.js");
```

That one-liner is also served from Campaign at `/api/sdk/worktual-web-push-sw.js` for copy-paste. If register fails, the SDK logs this hint in the console.

---

## 5. Subscribe API (snippet / SDK)

```http
POST /api/v1/push/subscribe
Content-Type: application/json
```

```json
{
  "organization_id": 1000,
  "channel_config_id": 1200,
  "endpoint": "https://fcm.googleapis.com/fcm/send/…",
  "keys": { "p256dh": "…", "auth": "…" }
}
```

No staff JWT. `organizationId` / `channelId` / nested `subscription` are accepted. Email/phone are **optional**; if they match an Audience contact, Web push is attached to that contact.

**Alias:** `POST /api/public/web-push/subscribe` (same handler). Origin + `?key=` still works for the local demo site.

---

## 6. Email to the customer (template)

**Subject:** Worktual Campaign — Web Push site snippet

---

Hello,

Web Push is enabled for **&lt;Company&gt;** in My Accounts Channel Setup.

**1. Confirm** Setup → Channel Setup → Web Push is **Active**.

**2. Paste the Channel Setup snippet** on your HTTPS site (it loads Worktual’s script from `https://rebuild-campaign-api.worktual.com/api/sdk/web-push.js`).

**3. Host this file** at `https://your-site/worktual-web-push-sw.js`:

```js
importScripts("https://rebuild-campaign-api.worktual.com/api/sdk/web-push-sw.js");
```

**4. Open the site, allow notifications.** Campaign stores the browser subscription. You can then include those contacts in a Web push campaign.

Do **not** put VAPID private keys on the website. Sending credentials stay in My Accounts; Campaign fetches them at send time.

---

## 7. What Campaign / Accounts must **not** do

| Mistake | Why |
|---------|-----|
| Persist VAPID **private** key in Campaign DB | Ownership is My Accounts; Campaign keeps it in memory at send |
| Register the service worker from the Campaign API origin only | SW must be **same-origin** as the customer site |
| Expect email/phone on every snippet subscribe | Anonymous opt-in is valid; audience attach is best-effort |
| Invent `webPushSubscribers` quota checks | No quote API in the current contract |

---

## 8. Troubleshooting

| Symptom | Check |
|---------|-------|
| 404 `not_configured` | Web Push channel missing in Channel Setup |
| 409 `channel_inactive` | Set status **active** |
| Subscribe 400 missing VAPID public key | Channel not ready / Accounts overlay failed; wait for `vapidConfigured` |
| SW register error | `/worktual-web-push-sw.js` not on the **customer** origin |
| Sends fail after rotate | Key rotation invalidates existing subscriptions (out of scope this phase) |

Ops: Campaign server needs `ACCOUNTS_API_BASE_URL` + `PRODUCT_MCP_CONNECTORS_TOKEN` (or `INTERNAL_SERVICE_KEY`) so send loads VAPID from Accounts.

---

*Last updated: 2026-09-21 — SDK `/api/sdk/web-push.js` + `POST /api/v1/push/subscribe`.*
