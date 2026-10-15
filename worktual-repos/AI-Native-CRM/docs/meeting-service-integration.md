# Meeting service (Vexa notetaker + Meet Sales Assist)

CRM uses the **`meeting-service/`** microservice for guest notetaker join (Vexa), live transcript, post-call extract, and the **Google Meet Sales Assist add-on** (Path B). CRM never talks to Vexa or Whisper directly.

## Architecture

| Component | Role |
|---|---|
| `meeting-service/` (port 8030) | Bot dispatch, transcript storage, Meet add-on host |
| CRM nginx (`FRONTEND_ORIGIN`) | Public HTTPS for `/addons/meet/` and `/v1/assist|meetings` |
| Vexa | Guest bot join (Meet / Teams / Zoom) |
| Whisper (existing GPU) | STT — via `meeting-whisper` adapter |
| CRM backend | JWT client, `/v1/users/by-email`, `/v1/assist/ask`, completed webhook |
| CRM frontend | Meeting activity shows capture status + Activities → Worktual Assist |
| **ai-service** | `assist-meeting` LLM (manual Ask + live coach) |

**Assist is not a fourth microservice.** The Meet panel is **hosted by meeting-service** (`/addons/meet/`), but coaching logic runs in **CRM** (`/v1/assist/*`, live SSE on `/api/meeting-assist/.../events`) and **ai-service**. meeting-service forwards Ask/bootstrap to CRM using `CRM_BOT_BASE_URL`.

## Path B (production)

The Meet side panel is **hosted by meeting-service**, then **proxied on the CRM SPA origin** so Google Marketplace can use the existing HTTPS certificate.

| Google Cloud field | Value |
|---|---|
| `sidePanelUrl` | `https://<FRONTEND_ORIGIN>/addons/meet/` |
| `addOnOrigins` | `https://<FRONTEND_ORIGIN>` |
| OAuth JS origin | `https://<FRONTEND_ORIGIN>` |

Canonical JSON: [`meeting-service/addons/google-meet/deployment.json`](../meeting-service/addons/google-meet/deployment.json) (production uses the CRM SPA origin, e.g. `https://rebuild-crm.worktual.com`). Regenerate from root `.env`:

```bash
./scripts/render-meet-deployment-json.sh   # reads FRONTEND_ORIGIN or MEETING_SERVICE_PUBLIC_URL
```

Paste the file into Google Cloud **HTTP add-on deployment**. Do **not** point `sidePanelUrl` at ngrok unless you are only doing local Meet testing.

### Server images + compose

From the repo root (same pattern as api/web/ai):

```bash
docker build -f backend/Dockerfile -t worktual-crm/api:local .
docker build -f frontend/Dockerfile -t worktual-crm/web:local .
docker build -f ai-service/Dockerfile -t worktual-crm/ai:local .
docker build -f meeting-service/Dockerfile -t worktual-crm/meeting:local meeting-service
docker build -f meeting-service/deploy/whisper-adapter/Dockerfile \
  -t worktual-crm/whisper-adapter:local \
  meeting-service/deploy/whisper-adapter

cd deploy
docker compose --env-file .env --env-file .env.images up -d --force-recreate --remove-orphans
```

Stop any **standalone** `meeting-service` compose first (port 8030 and Postgres would clash).

### CRM `deploy/.env` (required)

```bash
NOTETAKER_PROVIDER=vexa
MEETING_SERVICE_PUBLIC_URL=https://rebuild-crm.worktual.com
CRM_SERVICE_JWT_SECRET=<long random, same JWT meeting-service uses>
MEETING_SERVICE_WEBHOOK_SECRET=<long random>
CRM_BOT_API_KEY=<long random>
GOOGLE_ADDON_CLIENT_ID=<OAuth Web client>
GOOGLE_ADDON_CLOUD_PROJECT_NUMBER=<GCP project NUMBER>
VEXA_API_BASE=http://vexa-lite:8056
VEXA_API_KEY=<filled by deploy.sh from the vexa-lite container>
```

Compose hard-wires in-cluster URLs:

- CRM → meeting-service: `http://meeting-service:8030`
- meeting-service → CRM bot/users/webhook: `http://api:4000`
- meeting-service → Vexa: `http://vexa-lite:8056`

Vexa Lite is a service in `deploy/docker-compose.yml` (`container_name: vexa-lite`, gateway `http://vexa-lite:8056`). `deploy.sh` patches live PCM so Meet audio reaches both customer and internal assist, writes `VEXA_API_KEY` from `/run/vexa/key.env`, forces `VEXA_API_BASE=http://vexa-lite:8056`, and recreates meeting-service and meeting-worker. A previous standalone `vexa-lite` container is replaced. Do not point `VEXA_API_BASE` at `host.docker.internal:18056` — that bypasses the in-compose notetaker.

### Google Cloud (so it appears in Meet)

1. Workspace **work** GCP project. Enable Marketplace SDK + Workspace add-ons API.
2. **Meet sign-in (GIS):** use an **editable** OAuth Web client in `GOOGLE_ADDON_CLIENT_ID` (production: same as **`ACCOUNTS_GOOGLE_CLIENT_ID`**). Authorized JavaScript origins: **`FRONTEND_ORIGIN`** (e.g. `https://rebuild-crm.worktual.com`). The auto **Google Workspace Add-ons** client (**…4p9g…**) cannot be modified — do not use it in `/addons/meet/config`. HTTP deployment JSON may live in CRMproject (**853886404171**); `GOOGLE_ADDON_CLOUD_PROJECT_NUMBER` must match the **OAuth client project** (production: **714138144506** with `ACCOUNTS_GOOGLE_CLIENT_ID`).
3. HTTP add-on deployment from the JSON template (replace host).
4. **Private** listing → install for your domain → Meet → **Activities → Worktual Assist**.
5. First save as Private is permanent for that project.

### Verify

```bash
cd deploy
bash scripts/verify-meeting-assist.sh
bash scripts/verify-vexa-notetaker.sh   # Vexa ping + join prerequisites
```

Then: join a Meet, admit **Worktual Notetaker**, open the add-on, Google sign-in (same email as a CRM user), Ask a question.

## CRM env (local / non-compose)

```bash
NOTETAKER_PROVIDER=vexa
MEETING_SERVICE_URL=http://127.0.0.1:8030
CRM_SERVICE_JWT_SECRET=<same as meeting-service>
MEETING_SERVICE_WEBHOOK_SECRET=<same as meeting-service WEBHOOK_SECRET>
CRM_BOT_API_KEY=<optional key for meeting-service → CRM>
CRM_USERS_API_KEY=<optional; defaults to CRM_BOT_API_KEY>
```

Unset `MEETING_BOT_API_KEY` (Recall) when using Vexa.

## Flow

1. Schedule meeting in CRM → Assist session created → **notetaker auto-dispatched** via meeting-service.
2. Host admits **Worktual Notetaker** in lobby (`awaiting_admission`). There is no manual resend in the CRM UI when Vexa auto-dispatch is on.
3. Rep uses **Worktual Assist** in Meet (Activities) for Ask.
4. On `meeting.completed`, meeting-service POSTs CRM webhook → transcript attached → **post-meeting-process** runs. Host-ended is immediate when Vexa completes, sets `end_time`, or removes the bot from `/bots/status`. **`FINALIZE_ON_BOT_ALONE`** defaults to **false** (do not stop on empty-room snapshots). **`HOST_ENDED_SILENCE_SEC`** (local Docker often **600**) ends capture only after prolonged quiet *after real speech* — never from admit alone.

## Calendar meetings scheduled outside CRM

Google Calendar **`events.watch`** (HTTPS push with `X-Goog-*` headers) and **Gmail `users.watch` → Pub/Sub** can share one public URL. CRM multiplexes both on:

- `POST /api/webhooks/google-calendar/push` (recommended for GCP push subscription `mcp-push`)
- `POST /api/webhooks/gmail/push` (alias)

Calendar notifications trigger a sync; events with a **Google Meet link** auto-dispatch the Vexa notetaker. See [`docs/google-meet-scheduled-capture.md`](google-meet-scheduled-capture.md).

```bash
# Public HTTPS origin of the CRM API (ngrok in local)
CALENDAR_PUSH_WEBHOOK_URL=https://<ngrok>.ngrok-free.app/api/webhooks/google-calendar/push
# or
CRM_API_PUBLIC_URL=https://<ngrok>.ngrok-free.app

# Gmail Pub/Sub (e.g. gmail-test-502808 / Gmail_Mcp) — same push endpoint as above
GMAIL_PUBSUB_TOPIC=projects/gmail-test-502808/topics/Gmail_Mcp
GMAIL_PUBSUB_VERIFICATION_TOKEN=
CALENDAR_PUSH_VERIFICATION_TOKEN=
```

On API boot / Google reconnect, CRM registers calendar + Gmail watches when configured. Host admits **Worktual Notetaker** in Meet as usual.

## meeting-service env (see `meeting-service/.env.example`)

Production compose sets these; for a standalone `meeting-service/` stack:

```bash
CRM_BOT_BASE_URL=https://api.your-domain.com
CRM_USERS_BASE_URL=https://api.your-domain.com
CRM_COMPLETED_WEBHOOK_URL=https://api.your-domain.com/api/webhooks/meeting-service/completed
WHISPER_BASE_URL=http://<your-existing-whisper>
VEXA_API_BASE=http://vexa-lite:8056
GOOGLE_ADDON_CLIENT_ID=
GOOGLE_ADDON_CLOUD_PROJECT_NUMBER=
```

See [`meeting-service/README.md`](../meeting-service/README.md) for Vexa + Whisper wiring and [`meeting-service/addons/google-meet/README.md`](../meeting-service/addons/google-meet/README.md) for Marketplace steps.
