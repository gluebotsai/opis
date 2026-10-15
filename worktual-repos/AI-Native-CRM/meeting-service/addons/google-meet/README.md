# Worktual Assist — Google Meet add-on

The add-on is a **web page** hosted by meeting-service. In production it is **proxied on the CRM HTTPS origin** (`FRONTEND_ORIGIN`) so Google Workspace Marketplace stores a pointer to that URL (`sidePanelUrl`), not an SDK zip.

| In this repo | What you paste in Google Cloud |
|---|---|
| **Local (ngrok)** | [deployment.json](deployment.json) — default `https://studied-clamp-galvanize.ngrok-free.dev/addons/meet/` |
| **Server** | [deployment.production.json](deployment.production.json) until you replace with your new host/client |
| `./scripts/render-meet-deployment-json.sh` | Regenerate JSON from root `.env` (`CRM_API_PUBLIC_URL` or `MEETING_SERVICE_PUBLIC_URL`) |

Local sign-in OAuth client: use an **editable** Web client (e.g. **Web client 1** `…2s9fp…`), **not** the auto **Google Workspace Add-ons** client (`…4p9g…` — Google shows *“can't be modified”*; you cannot add JS origins there).

Set `GOOGLE_ADDON_CLIENT_ID` in meeting-service to that editable client. The HTTP deployment **Authorization resource** may still list `…4p9g…`; GIS uses whatever `/addons/meet/config` returns.

### `401 invalid_client` / `no registered origin` (Meet sign-in)

Saving **deployment.json** does **not** register JavaScript origins. Fix all of:

1. **APIs & Services → Credentials** → open your **editable** OAuth Web client (not the locked **Google Workspace Add-ons** row).
   - **Authorized JavaScript origins:** `https://studied-clamp-galvanize.ngrok-free.dev` (exact host, no path)
   - Same client ID must be in `GOOGLE_ADDON_CLIENT_ID` → recreate meeting-service
2. **Google Workspace Marketplace SDK → App configuration**
   - **Google Workspace add-on** + **HTTP deployment** `sales_assist` (saved)
   - **Meet add-ons integration → Web app:** must be **checked**, then **Save**
3. **OAuth consent screen:** if **Testing**, add your Google account under **Test users**
4. Wait 5–15 minutes; start a **new** Meet; reinstall the add-on if needed

Production wiring: [`docs/meeting-service-integration.md`](../../../docs/meeting-service-integration.md).

Meet will not load `http://127.0.0.1`. Local HTTPS via **your** ngrok account:

**Option A — one tunnel you may already have (CRM API :4000):**

If ngrok already points at `http://localhost:4000`, the Fastify app proxies `/addons/meet/` and `/v1/assist/*` to `MEETING_SERVICE_URL` (default `http://127.0.0.1:8030`; use `:8050` only with `docker-compose.local.yml`). Use that HTTPS host as `sidePanelUrl` (no second ngrok process).

**Option B — tunnel Vite :5173:**

```bash
# CRM Vite on :5173, meeting-service Docker on :8050, authtoken in ~/Library/.../ngrok/ngrok.yml
cd meeting-service
ngrok start meet-addon \
  --config "$HOME/Library/Application Support/ngrok/ngrok.yml" \
  --config addons/google-meet/ngrok.yml
```

Ngrok prints a URL like `https://xxxx.ngrok-free.dev`. Paste in Google Cloud (Meet add-on + OAuth Web client):

| Field | Value |
|---|---|
| `sidePanelUrl` | `https://<your-ngrok-host>/addons/meet/` |
| `addOnOrigins` | `https://<your-ngrok-host>` |
| OAuth authorized JS origin | `https://<your-ngrok-host>` and `https://meet.google.com` |

For a **stable** hostname, reserve a domain on [ngrok domains](https://dashboard.ngrok.com/domains/new), copy `ngrok.local.yml.example` → `ngrok.local.yml`, set the URL, and add `--config addons/google-meet/ngrok.local.yml` to the start command.

Do **not** use a domain reserved on another ngrok account (ERR_NGROK_320).

Keep ngrok running while you test in Meet. Free ngrok may show a browser warning interstitial — open the side panel URL once in a tab and click through, or use a reserved domain.

**Local port trap:** If SSH forwards `:8030`–`:8041` to QA, host curls and ngrok must use **`:8050`** (see `docker-compose.local.yml` + `ngrok.yml`). Otherwise Meet sign-in hits remote meeting-service and you may see `invalid google_id_token` while local Docker looks fine.

## APIs the sidebar uses

- `GET /addons/meet/config` — public Google OAuth client id + Cloud project number
- `POST /v1/assist/session` — `{ google_id_token }` → short-lived meeting-service JWT (user never pastes this)
- `GET /v1/meetings/lookup?meeting_url=` — in-flight notetaker
- `POST /v1/assist/ask` — `{ meeting_url, query, intent }` → CRM bot

Identity: Google Sign-In in the panel. meeting-service verifies the ID token, looks up the CRM user by email (`CRM_USERS_BASE_URL` or dummy org `CRM_ASSIST_DUMMY_ORG_ID`), then mints a session JWT. Restrictions belong in the **CRM bot**.

## Env

```env
# Dummy until the real CRM bot exists: in-process OpenAI client
CRM_BOT_BASE_URL=internal
CRM_BOT_OPENAI_BASE_URL=http://127.0.0.1:8011/v1
CRM_BOT_OPENAI_API_KEY=
CRM_BOT_OPENAI_MODEL=worktual-gemma
# Later: CRM_BOT_BASE_URL=https://your-crm-bot.example
CRM_BOT_API_KEY=
GOOGLE_ADDON_CLIENT_ID=
GOOGLE_ADDON_CLOUD_PROJECT_NUMBER=
```

If `CRM_BOT_BASE_URL` is empty, Ask returns **503**. `internal` (or any URL containing `/internal/crm-bot`) uses the dummy OpenAI bot in-process — do not HTTP-loop to this process. If `GOOGLE_ADDON_CLIENT_ID` is set, `google_id_token` is required.

CRM bot contract (`POST {CRM_BOT_BASE_URL}/v1/assist/ask`):

```json
{
  "meeting_id": "...",
  "organization_id": "...",
  "entity_type": "deal",
  "entity_id": "...",
  "query": "...",
  "intent": "ask",
  "user": { "email": "rep@company.com", "crm_sub": "user-1", "google_sub": "..." }
}
```

Bot loads transcript with `GET /v1/meetings/{id}/transcript` (same JWT). Reply `{ "reply": "..." }`.

## Publish (you do this in Google Cloud)

Docs: [Deploy a Meet add-on](https://developers.google.com/meet/add-ons/guides/build-add-on) · [Marketplace SDK](https://developers.google.com/workspace/marketplace/enable-configure-sdk)

### Before listing

1. Serve meeting-service (or the static page) at `https://<your-domain>/addons/meet/`.
2. Google Cloud project on a **Workspace work account**.
3. Enable **Google Workspace Marketplace SDK** and **Google Workspace add-ons API**.
4. OAuth consent: app name, support email, `https://www.googleapis.com/auth/userinfo.email`.
5. HTTP add-on deployment using [deployment.json](deployment.json) (replace host).
6. Marketplace SDK → HTTP deployments → **Install** for yourself. Meet → Activities → Worktual Assist.

### Private (your company)

1. App configuration. Set **App visibility = Private before the first Save**. Permanent for that project.
2. Integration = Google Workspace add-on → HTTP deployment.
3. Store listing name must match the OAuth app name.
4. Publish. Admin Console → Marketplace apps → assign to OUs.

### Public (any customer)

Private cannot become Public on the same project. New Cloud project if you already saved Private. OAuth verification + Google review (days to weeks).

Do not commit OAuth client secrets or API keys.
