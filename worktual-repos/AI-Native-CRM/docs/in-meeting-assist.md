# Enterprise in-meeting Sales Assist

**Google Meet (production):** Path B — meeting-service hosts the side panel at `/addons/meet/`, proxied on the CRM HTTPS origin. See [`meeting-service-integration.md`](./meeting-service-integration.md). **Scheduled** Calendar Meet → auto notetaker: [`google-meet-scheduled-capture.md`](./google-meet-scheduled-capture.md).

Assist also has a **shared CRM UI** for Zoom / Teams / local preview via official provider apps.

## Architecture

| Surface | URL |
|---|---|
| **Meet add-on (Path B, production)** | `https://<FRONTEND_ORIGIN>/addons/meet/` |
| Shared panel (CRM SPA) | `/meeting-assist/panel/:sessionId` |
| Meet host (legacy Path A) | `/meeting-assist/hosts/meet` (alias `/meet-addon/sidepanel`) |
| Zoom inMeeting | `/meeting-assist/hosts/zoom` |
| Teams meetingSidePanel | `/meeting-assist/hosts/teams` |
| Connect CRM popup | `/meeting-assist/link` |
| Mic fallback window | Retired (Chrome mic cannot isolate customer) |
| Meet Media worker | `meet-media-worker/` → port 4010 (optional) |

### Live customer transcript (default: meeting bot)

Product buyers should **not** enroll in Google Workspace Developer Preview or wire GCP themselves.

| Mode | Env | Buyer setup | Notes |
|---|---|---|---|
| **bot** (default) | `MEETING_ASSIST_LIVE_SOURCE=bot` | Send notetaker from CRM + Meet Assist add-on | **Vexa:** [`meeting-service-integration.md`](./meeting-service-integration.md). Legacy Recall: `MEETING_BOT_API_KEY`. |
| **meet_media** | `…=meet_media` | Connect Google + Preview | Native Meet Media API (`meet-media-worker/`). |
| **ask_only** | `…=ask_only` | — | No live captions; Ask bar only. |

**Bot flow (turnkey):**

1. Sales opens Assist in Meet (after Connect CRM).
2. Panel calls `POST …/media/start` → CRM creates a Recall bot for the Meet URL (or **reuses** Worktual Notetaker / an existing Assist bot on the same session — no second lobby knock).
3. Status is `waiting_admit` until the bot is in-call and the first **customer** caption arrives → then `listening`.
4. Recall streams `transcript.data` → `POST /api/webhooks/meeting-bot/recall`.
5. Host lines are skipped; customer lines → auto-Assist (with CRM context pack + product KB).

**Sales vs presales (customer meetings):** Live coaching is **per viewer** — only users who open the Meet add-on receive SSE assist. The viewer’s CRM role selects the persona: **sales** (rep/manager/admin) vs **presales** (technical talk track + fit/gap bullets). Auto-assist runs once per active persona on the session (parallel LLM calls when both roles have panels open).

**Latency (live):** Meeting-service sends one completed utterance to Whisper after Silero `speech_end`. If Vexa stops delivering a channel's audio before Silero receives trailing silence, a **600ms transport-idle fallback** closes that utterance once. There are no cumulative rolling Whisper drafts. The Meet add-on still polls `sync-live` as backup when SSE is quiet.

**Live STT (only path):** Vexa **`transcribe_enabled=false`** always; the bot forwards capture PCM to meeting-service (`VEXA_LIVE_PCM_WS_BASE`, `VEXA_LIVE_PCM_BOT_KEY`). Transcoder control path: **gain×2 → high-pass → DTLN → Silero VAD** (`LIVE_PCM_VAD_MODE=silero`); STT buffer = **raw PCM** + **`LIVE_PCM_PRE_SPEECH_MS`** (default **500**) pre-roll; **`LIVE_PCM_DRAFT_MS=0`** keeps each VAD-delimited customer utterance independent. Raw-PCM energy does not veto text after Silero has accepted speech. DTLN ONNX weights are baked in the meeting-service image (`models/dtln/`). Bot WS: `/v1/live-pcm/join/{platform}/{native_meeting_id}?bot_key=…`. In-bot Vexa Whisper is not used for Assist.

**Channel-routed transcoding (not name-routed):** Google Meet gives the bot each active speaker on its own audio **channel** — real per-participant track separation, the same signal Vexa's own `@vexa/gmeet-pipeline` diarizer consumes. The bot forwarder (`meeting-service/patches/vexa-live-pcm-forward.ts`) tags every PCM frame with its channel index (2-byte header) instead of collapsing everyone onto one "current speaker" string. `LivePcmSession` (`meeting-service/app/services/pcm_session.py`) keeps one `PcmTranscoder` **per channel**, so:
- A single continuous utterance never fragments or gets relabeled mid-sentence just because Meet's active-speaker glow highlight flickers off for a beat (name updates are queued in-band with that channel's audio and only take effect between utterances — `PcmTranscoder.set_speaker`).
- Two participants speaking genuinely at once (real overlap) transcribe independently and concurrently instead of contending for one shared label.
- Segment IDs are namespaced per channel (`pcm-ch-<n>-…`) so two channels' independent sequence counters can never collide into one DB row.
A channel slot **can** be reassigned to a different participant later in a long call (Meet reuses tile slots) — `set_speaker` treats that the same as any other label change: finalize whatever is buffered under the old name, then switch.

Tune `LIVE_ASSIST_MIN_GAP_MS` (default **650**), `LIVE_ASSIST_QUERY_DEBOUNCE_MS` (default **150**), and `LIVE_PCM_WHISPER_TIMEOUT_SEC` (default **1.35**) for end-to-end budget.

Chrome mic is disabled (cannot isolate the customer). Optional `REDIS_URL` fans out live Assist events.

## Auth

Meeting iframes block third-party cookies. Flow:

1. Host opens Connect CRM → `/meeting-assist/link?popup=1`
2. Cookie session issues a short-lived **panel JWT** (`userId`, `organizationId`, optional `sessionId`)
3. Host stores token and sends `x-meeting-assist-panel-token` (or `?token=` for SSE)

Issue session-scoped token from CRM:

`POST /api/meeting-assist/sessions/:sessionId/panel-token`

## Provider manifests

Replace `YOUR_PUBLIC_ORIGIN` with your HTTPS CRM origin (no trailing slash). **Meet production is Path B** (`/addons/meet/`).

| Provider | Manifest |
|---|---|
| Google Meet | [`meeting-service/addons/google-meet/deployment.json`](../meeting-service/addons/google-meet/deployment.json) |
| Zoom | [`zoom-app/manifest.json`](../zoom-app/manifest.json) |
| Teams | [`teams-app/manifest.json`](../teams-app/manifest.json) |

### Env

```bash
FRONTEND_ORIGIN=https://your-domain.com
VITE_GOOGLE_CLOUD_PROJECT_NUMBER=…   # Meet Add-ons SDK

# Live Assist — bot path (recommended for product buyers)
MEETING_ASSIST_LIVE_SOURCE=bot
MEETING_BOT_API_KEY=…                # Recall.ai
MEETING_BOT_WEBHOOK_BASE_URL=https://api.your-domain.com   # public HTTPS
# MEETING_BOT_WEBHOOK_SECRET=…       # optional; require x-meeting-bot-secret
# MEETING_BOT_DISPLAY_NAME=Worktual Assist

# Optional Meet Media path
# MEETING_ASSIST_LIVE_SOURCE=meet_media
# MEET_MEDIA_WORKER_URL=http://127.0.0.1:4010
# CRM_API_PUBLIC_URL=https://api.your-domain.com

# ZOOM_WEBHOOK_SECRET=…              # Zoom transcript HMAC
# ENRICH_INTERNAL_SECRET=…           # Meet/Teams/RTMS adapters
```

## Transcript webhooks → chunks

| Endpoint | Auth | Source tag |
|---|---|---|
| `POST /api/webhooks/meeting-bot/recall` | optional `x-meeting-bot-secret` | `meeting_bot` |
| `POST /api/webhooks/google-meet/transcript` | `x-internal-secret` | `google_meet_transcript` |
| `POST /api/webhooks/teams/transcript` | `x-internal-secret` | `teams_graph` |
| `POST /api/webhooks/zoom/transcript` | Zoom HMAC / secret | `zoom_webhook` |
| `POST /api/webhooks/zoom/rtms` | `x-internal-secret` | `zoom_rtms` (STT fallback) |

Body shape (Meet / Teams / RTMS):

```json
{
  "meetingId": "external-id",
  "activityId": "optional-crm-activity",
  "chunks": [{ "text": "…", "speaker": "Customer" }],
  "transcript": "optional full text",
  "finalize": false
}
```

## Local preview

```bash
# terminal 1
cd backend && npm run dev
# terminal 2
cd frontend && npm run dev
open http://localhost:5173/meeting-assist/hosts/meet
```

For the **bot** path locally, expose the API with a public HTTPS URL (e.g. ngrok) and set `MEETING_BOT_WEBHOOK_BASE_URL` + `MEETING_BOT_API_KEY`.

SDK init warns outside the real client; Connect CRM + meeting list still work when logged in.
