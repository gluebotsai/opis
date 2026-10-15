# Web Chat widget — My Accounts → CCaaS handoff

This document describes what **My Accounts** already built for Web Chat so the **CCaaS** team can implement the real chat service (bot, agents, routing, transcripts).

Use this as the contract. Do not reinvent the join key or the public config shape.

---

## 1. Ownership split

| Concern | Owner today | Notes for CCaaS |
|---------|-------------|-----------------|
| Sell / onboard / Setup UI | My Accounts | Customer configures widget in Setup Workspace |
| Persist branding, greeting, Primary Form | My Accounts DB | Source of truth |
| Embed snippet + Installation UI | My Accounts | Copy/paste HTML for customer websites |
| Public config + logo URLs | My Accounts API | Widget / CCaaS **pull** on session start |
| Temporary embed JS + stub WebSocket | My Accounts (v1 stub) | Replace with CCaaS-hosted script + real socket when ready |
| Bot NLU, agent inbox, queues, transcripts | **CCaaS (to build)** | Not in Accounts DB |

**Stable join key:** `webchat_id` (format `wc_` + 32 hex chars, no dashes).

Example: `wc_5d80cd9b1ace4080bc70717552472611`

---

## 2. Database (My Accounts)

Schema: `accounts` when `DATABASE_SCHEMA_MODE=accounts`.

### Parent channel row

`accounts.setup_channel_configs`

- `id` (UUID) — internal channel config id  
- `organization_id`  
- `channel_type` = `'web_chat'`  
- `name`, `status` (`pending` / `active` / `archived`), `product_ids`  
- `created_at`, `updated_at`

### Web Chat config row

`accounts.setup_webchat_configs`

| Column | Type | Purpose |
|--------|------|---------|
| `channel_config_id` | UUID PK/FK → `setup_channel_configs` | 1:1 with channel |
| `webchat_id` | VARCHAR(64) UNIQUE | **Public widget id** used in embed + APIs |
| `title` | VARCHAR | Chat header title |
| `alias_title` | VARCHAR | Subtitle (e.g. “AI Assistant”) |
| `description` | TEXT | Optional |
| `greeting_message` | TEXT | First bot bubble (may contain HTML) |
| `trigger_message` | TEXT | Optional launcher tooltip / bubble |
| `personalisation` | JSONB | Branding + Primary Form + agent copy (see below) |
| `created_at` / `updated_at` | TIMESTAMPTZ | Used for ETag / cache |

DDL reference: `database/v2/06_accounts_setup_tables.sql`

### What is **not** stored in Accounts

- Chat messages / transcripts  
- Live sessions / visitor presence  
- Bot model weights / intents  
- Agent assignment state  

Those belong in CCaaS.

---

## 3. `personalisation` JSONB (shape)

Defaults live in `src/pages/customer/setup/webchatPersonalisation.js` (`DEFAULT_PERSONALISATION` + `DEFAULT_PRIMARY_FORM`).

Public API returns the same object with **storage keys stripped** and **public asset URLs** filled in.

### Branding / layout (widget applies these today)

| Field | Meaning |
|-------|---------|
| `chatIconLogoUrl` / `widgetIconLogoUrl` / `botAvatarUrl` | Public image URLs |
| `fontStyle` | e.g. `Inter` |
| `brandColourMode` | `solid` \| `gradient` |
| `chatHeaderColour`, `chatHeaderGradientFrom/To`, `chatHeaderTextColour` | Header look |
| `chatIconColour`, `chatIconGradientFrom/To` | FAB / launcher look |
| `agentMessageColour`, `customerMessageColour`, `actionMessageColour`, `messageTextColour` | Bubbles / send button |
| `botAvatarPreset` | Colour preset when no custom avatar |
| `chatBackgroundPattern` | e.g. `none`, `dots-light`, … |
| `position` | `bottom_right` \| `bottom_left` |
| `roundedCorners` | 0–100 slider → CSS radius |
| `chatIconShape` | `circle` \| `square` |
| `widgetLauncher` | `icon` \| `text` |

### Stored but **not fully driven** by the stub widget yet (CCaaS should honour)

| Field | Meaning |
|-------|---------|
| `primaryForm` | Consent + prechat (see below) |
| `agentHandoffMessage`, `agentBusyMessage`, `agentUnavailableMessage`, `outOfHoursMessage` | Runtime copy |
| `*Callback` flags, `callbackThresholdHours` | Callback UX |
| `enableTracker`, `trackerType`, `trackerName`, `trackerDelay` | Engagement trackers |
| `notificationSound` | Sound id |
| `allowCustomerUploadDocuments` / transcript / language flags | Feature toggles |

### `personalisation.primaryForm`

| Field | Meaning |
|-------|---------|
| `consentEnabled`, `consentMessage`, `privacyPolicyUrl`, `privacyPolicyLinkText` | Consent gate |
| `optInButton`, `optOutButton`, `optOutConfirmation` | Consent actions |
| `prechatEnabled`, `prechatTitle`, `prechatMessage`, `prechatButtonLabel`, `prechatButtonBg` | Prechat screen |
| `customFields[]` | `{ id, label, mandatory }` |

CCaaS should collect consent/prechat **before** (or as part of) opening the WS session, then send answers on `session.start`.

---

## 4. Customer website snippet

Generated in Setup → Web Chat → **Installation**.

```html
<div id="chat_bot" data-webchat-id="wc_..."></div>
<script src="https://YOUR_PUBLIC_API_HOST/worktual_widget.js"></script>
```

Rules:

1. Mount element **must** have `id="chat_bot"` and `data-webchat-id="wc_…"`.  
   Legacy attr `data-myparam` is also accepted by the current script as a fallback.
2. Script URL defaults to `{MAIL_API_PUBLIC_URL}/worktual_widget.js` (override with `CCAAS_WIDGET_SCRIPT_URL`).
3. When CCaaS hosts the final CDN script, only change the `src` (and keep `data-webchat-id`).

Authenticated setup responses also include an `install` object:

```json
{
  "webchatId": "wc_…",
  "scriptUrl": "https://…/worktual_widget.js",
  "socketUrl": "wss://…/ccaas/chat",
  "embedHtml": "<div id=\"chat_bot\" …",
  "publicConfigUrl": "https://…/api/v1/public/webchat/wc_…/config",
  "testBotUrl": "https://…/webchat/test/wc_…"
}
```

---

## 5. Public APIs (no customer JWT)

Base URL = public API host (`MAIL_API_PUBLIC_URL` / ngrok / production Accounts API).

CORS: `Access-Control-Allow-Origin: *`  
Rate limit: ~120 req / IP / minute on public webchat routes.

### 5.1 Config pull (required for CCaaS)

```http
GET /api/v1/public/webchat/:webchatId/config
```

Optional: `If-None-Match` → `304` when unchanged.  
Response header: `ETag: "{webchatId}-{updatedAtMs}"`.

**Example response:**

```json
{
  "config": {
    "webchatId": "wc_…",
    "title": "Dummy",
    "aliasTitle": "AI Assistant",
    "description": "",
    "greetingMessage": "<strong>Hello…</strong>",
    "triggerMessage": "hola",
    "socketUrl": "wss://YOUR_HOST/ccaas/chat",
    "updatedAt": "2026-…",
    "personalisation": {
      "position": "bottom_right",
      "chatHeaderColour": "#5B55FF",
      "primaryForm": { "...": "..." },
      "chatIconLogoUrl": "https://YOUR_HOST/api/v1/public/webchat/wc_…/assets/…",
      "botAvatarUrl": "…",
      "widgetIconLogoUrl": "…"
    }
  }
}
```

**CCaaS recommendation:** fetch this on every new visitor session (cache briefly by `ETag` / `updatedAt`). Map tenant from `webchatId` (or a CCaaS-side mapping table).

### 5.2 Public assets

```http
GET /api/v1/public/webchat/:webchatId/assets/:assetKey
```

Serves only keys referenced on that widget’s personalisation (logos / avatar). No auth.

### 5.3 Embed script (Accounts-hosted stub)

```http
GET /worktual_widget.js
```

Source file: `server/static/worktual_widget.js`

Behaviour today:

1. Find `#chat_bot[data-webchat-id]`  
2. `GET` public config  
3. Render FAB + panel using personalisation  
4. Open WebSocket to `config.socketUrl` (default `wss://…/ccaas/chat`)

Live test page (blank white + widget only):

```http
GET /webchat/test/:webchatId
```

---

## 6. WebSocket contract (`/ccaas/chat`)

### Today (Accounts stub)

- Implemented in `server/ccaasChatSocket.js`  
- Path: `/ccaas/chat`  
- Query: `?webchatId=wc_…&visitorId=v_…`  
- Placeholder bot ack only — **not production chat**

### Connect URL

```
wss://YOUR_HOST/ccaas/chat?webchatId=wc_…&visitorId=v_…
```

Override with env `CCAAS_CHAT_SOCKET_URL` when CCaaS owns the socket.

### Frames used by the current widget

**Client → server**

```json
{ "type": "session.start", "webchatId": "wc_…", "visitorId": "v_…", "pageUrl": "https://…" }
```

```json
{ "type": "message", "webchatId": "wc_…", "visitorId": "v_…", "text": "hello", "pageUrl": "https://…" }
```

**Server → client (stub)**

```json
{ "type": "session.ready", "webchatId": "wc_…", "visitorId": "v_…", "stub": true }
```

```json
{ "type": "system", "text": "…" }
```

```json
{ "type": "message", "from": "bot", "text": "…", "stub": true }
```

### Suggested CCaaS extensions (backward compatible)

On `session.start`, also accept:

```json
{
  "type": "session.start",
  "webchatId": "wc_…",
  "visitorId": "v_…",
  "pageUrl": "https://…",
  "consent": { "accepted": true },
  "prechatAnswers": { "field_email": "a@b.com", "field_first_name": "Ada" }
}
```

Server events CCaaS should emit (widget can be updated to consume):

| `type` | Purpose |
|--------|---------|
| `session.ready` | Session accepted; include `conversationId` if useful |
| `message` | `{ from: "bot"\|"agent"\|"user", text }` |
| `system` | Status / errors |
| `agent.typing` / `agent.joined` | Optional UX |
| `handoff` | Use Accounts copy from config (`agentHandoffMessage`, busy, OOH) |

Keep using **JSON text frames**. Prefer additive fields so older widgets do not break.

---

## 7. End-to-end flow (target for CCaaS)

```text
Customer website
  └─ loads snippet (data-webchat-id + worktual_widget.js)
       ├─ GET Accounts public config by webchat_id
       │     └─ branding, greeting, primaryForm, socketUrl, asset URLs
       ├─ (optional) show consent / prechat from primaryForm
       └─ WS connect to CCaaS /ccaas/chat
             ├─ session.start (+ consent/prechat)
             ├─ visitor messages
             ├─ bot replies
             └─ handoff → CCaaS agent inbox / queues
```

My Accounts stays out of the realtime path after config fetch (except optional analytics later).

---

## 8. Env vars (Accounts)

| Variable | Role |
|----------|------|
| `MAIL_API_PUBLIC_URL` (or `META_API_PUBLIC_URL` / `APP_URL`) | Public base for config, assets, snippet, test URL |
| `CCAAS_WIDGET_SCRIPT_URL` | Optional override for embed `src` (point at CCaaS CDN when ready) |
| `CCAAS_CHAT_SOCKET_URL` | Optional override for `socketUrl` in public config |

---

## 9. Key source files (Accounts repo)

| File | Role |
|------|------|
| `server/static/worktual_widget.js` | Embed script source |
| `server/publicWebchat.js` | Public config/assets + install URL builders |
| `server/ccaasChatSocket.js` | `/ccaas/chat` stub |
| `server/setupWebchat.js` | Authenticated setup CRUD + `webchat_id` generation |
| `server/repositories/raw/setupWebchat.repo.js` | DB access (incl. public lookup by `webchat_id`) |
| `src/pages/customer/setup/SetupWebchatConfigPage.jsx` | Setup wizard UI |
| `src/pages/customer/setup/WebchatInstallationPanel.jsx` | Snippet + “Test your bot” |
| `src/pages/WebchatTestBotPage.jsx` | Public live test page |
| `src/pages/customer/setup/webchatPersonalisation.js` | Personalisation defaults |
| `database/v2/06_accounts_setup_tables.sql` | Table DDL |

---

## 10. Checklist for CCaaS chat service build

1. Accept `webchatId` as the tenant/widget key (`wc_…`).  
2. On session start, call Accounts `GET /api/v1/public/webchat/:webchatId/config` (cache with ETag).  
3. Apply branding + implement **Primary Form** (consent/prechat) before/at chat start.  
4. Host production WebSocket (replace Accounts stub); expose `wss://…/ccaas/chat` (or update `CCAAS_CHAT_SOCKET_URL`).  
5. Implement bot replies + agent handoff using config message copy.  
6. Optionally host `worktual_widget.js` on CCaaS CDN and set `CCAAS_WIDGET_SCRIPT_URL`.  
7. Store transcripts/sessions in CCaaS — do not write chat history into Accounts setup tables.

---

## 11. What “done in Accounts” means (summary)

**Done**

- DB tables + unique `webchat_id`  
- Setup UI (Basic, Personalisation, Primary Form, Installation)  
- Public config + asset APIs  
- Embed snippet generation + live test page  
- Temporary widget JS + stub `/ccaas/chat`

**Not done (CCaaS)**

- Real bot engine  
- Agent desktop / queue routing  
- Production WebSocket gateway  
- Transcript persistence  
- Full Primary Form / tracker / OOH behaviour in the live widget runtime
