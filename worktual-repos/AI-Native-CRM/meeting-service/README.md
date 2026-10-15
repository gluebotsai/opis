# Meeting Service

CRM talks **only** to this service (REST + WebSocket). It never talks to Vexa, Whisper, or the LLM. Vexa keys, Whisper tokens, and LLM keys stay in this service’s environment — never in the CRM frontend.

This directory is a sibling of the proposal agent, not inside it:

```
/Users/bharathi/Documents/vibe_coding/CRM/
  proposal agent/CRM-proposal agent/   # do not modify for this feature
  meeting-service/                    # this repo
```

The bot joins Meet / Teams / Zoom as a **guest** named `Worktual Notetaker`. The host clicks **Admit**. There is no Zoom Marketplace, Google OAuth, or Teams admin consent.

If CRM already has Recall, do **not** run both on the same meeting. Feature-flag `NOTETAKER_PROVIDER=vexa` here, and keep Recall off for that URL. Unique in-flight lock: `(organization_id, platform, native_meeting_id)`.

---

## What you run

| Process | Role |
|---|---|
| **Vexa** (official Docker stack, cloned on the host) | Guest bot, mixed audio, speaker names on text |
| **Your Whisper** | OpenAI-compatible `POST /v1/audio/transcriptions` — Vexa calls it |
| **meeting-service API** (`:8030`) | CRM contract, auth, webhooks |
| **meeting-worker** | Vexa WS + poll, lobby timeout, extract jobs, retention |
| **Postgres + Redis** | Source of truth + live fan-out |

Whisper credentials go in **Vexa’s** env (`deploy/vexa.env.example`), not in CRM.

---

## Quick start

```bash
cp .env.example .env
# set CRM_SERVICE_JWT_SECRET, WEBHOOK_SECRET, VEXA_API_KEY, LLM_*, WHISPER_*

docker compose up --build
# API + test UI: http://localhost:8030/ui  (also http://localhost:8031/ui)
# Whisper adapter (OpenAI transcriptions → your GPU translations): http://localhost:8032
# /healthz liveness, /readyz = DB + Redis + Vexa ping + Whisper preflight
```

The test UI is for local demo only (`ENABLE_TEST_UI=true`). Google Meet Assist add-on: `GET /addons/meet/` (see `addons/google-meet/README.md`). Production CRM compose (`deploy/docker-compose.yml`) runs this service and **must** keep the test UI off. Google Calendar tokens do **not** go in `.env`.

Join Vexa to the same Docker network:

```bash
docker network connect crm-meetings <vexa-gateway-container>
```

Point Vexa at the adapter (not the GPU URL directly), because your Whisper speaks `/v1/audio/translations` and Vexa calls `/v1/audio/transcriptions`:

```
TRANSCRIPTION_SERVICE_URL=http://whisper-adapter:8000
TRANSCRIPTION_SERVICE_TOKEN=EMPTY
TRANSCRIPTION_MODEL=worktual-large-v3
```

Copy `deploy/vexa.env.example` into `vexa/deploy/compose/.env` and preflight Whisper:

```bash
chmod +x scripts/preflight_whisper.sh
./scripts/preflight_whisper.sh sample.wav
```

Expect HTTP 2xx and `{ "text": "..." }`. If Whisper is not that shape, run `deploy/whisper-adapter`.

On API boot the service `PUT`s Vexa `/user/webhook` for `meeting.status_change`, `meeting.completed`, `bot.failed`.

Mint a CRM JWT for curl:

```bash
python scripts/mint_token.py --org 1003
```

---

## CRM contract

Auth: `Authorization: Bearer <JWT>`. HS256 with `CRM_SERVICE_JWT_SECRET`. Claims:

- `organization_id` (required) — **always** taken from the token. Body `organization_id` is ignored if it disagrees.
- `sub` — CRM user id
- `scopes` — must include `meetings:write` for POST/DELETE

WebSocket uses the same JWT: `WS /v1/meetings/{id}/live?token=<jwt>` (or `Authorization` header).

### Link the record: `entity_type` + `entity_id`

| Page | `entity_type` | `entity_id` |
|---|---|---|
| Contact | `contact` | CRM contact id |
| Deal / opportunity | `deal` | CRM deal id |
| Team / internal | `team` | CRM team / workspace id |

This service does **not** validate that the contact/deal/team exists. It stores the ids and returns them on extract so CRM can write notes to that record.

### Send notetaker

```http
POST /v1/meetings
Idempotency-Key: <crm-activity-id or uuid>
Authorization: Bearer <jwt>

{
  "organization_id": "1003",
  "entity_type": "contact",
  "entity_id": "C-4412",
  "meeting_url": "https://meet.google.com/abc-defg-hij",
  "bot_name": "Worktual Notetaker",
  "consent_captured": true,
  "join_at": null
}
```

`consent_captured: true` is required (`CONSENT_REQUIRED=true`). CRM must show a recording notice first. Otherwise **422**.

Invalid Meet/Teams/Zoom URL → **422** (`invalid_url`), no bot.

Same `Idempotency-Key` or same in-flight `(org, platform, native_meeting_id)` → existing meeting, **no second bot**.

At GPU/bot cap → **429** with `Retry-After`. Caps: `MAX_CONCURRENT_MEETINGS`, `MAX_CONCURRENT_PER_ORG`.

Response:

```json
{ "id": "m_01", "status": "joining", "entity_type": "contact", "entity_id": "C-4412",
  "error_code": null, "error_message": null }
```

### Statuses to show in CRM

`requested` → `joining` → `awaiting_admission` (banner: **Admit Worktual Notetaker**) → `active` (live) → `stopping` → `processing` → `completed` | `completed_partial` | `failed`

Typed `error_code`: `not_admitted`, `vexa_unavailable`, `whisper_unavailable`, `capacity`, `evicted`, `no_audio`, `invalid_url`, `llm_failed`.

If still in lobby after the admission deadline, the worker stops the bot and fails with `not_admitted`. With CRM `expected_end_at`, the bot waits until **scheduled slot end** (`LOBBY_TIMEOUT_UNTIL_SLOT_END=true`); otherwise `LOBBY_TIMEOUT_SEC` (default 1200) from entering the lobby.

**End of capture:** By default (`FINALIZE_ON_SCHEDULED_SLOT_END=false`) the worker stops the bot when the **host ends the call** or Vexa reports completed — not when the calendar slot ends. Like Recall’s `bot.done`, finalize is immediate when Vexa sets `end_time` / `completed`, drops the bot from `/bots/status`, or sends `meeting.completed`. If Vexa stays silent, **`HOST_ENDED_SILENCE_SEC`** (default 90s after last speech — never from admit alone) is the fallback. **`HOST_ENDED_ALONE_GRACE_SEC`** (default 90s) ignores bot-alone / empty-room snapshots right after admit. CRM pulls the transcript as soon as meeting-service enters `processing` / `stopping` / `completed`.

**Double dispatch:** Vexa `409 bot already active` is treated as reuse (keep joining), not failure. Calendar push does not `forceReschedule` CRM-owned captures.

### Live transcript

```
GET /v1/meetings/{id}
GET /v1/meetings/{id}/transcript
WS  /v1/meetings/{id}/live?token=<jwt>&last_event_id=<optional-segment_id>
WS  /v1/meetings/{id}/live-pcm?token=<jwt>   # CCaaS-style PCM16 @ 16 kHz (see LIVE_PCM_*)
WS  /v1/live-pcm/join/{platform}/{native_id}?bot_key=…   # Vexa bot (required)
```

**Live PCM (only STT path):** CRM always spawns Vexa with `transcribe_enabled=false`; the bot forwards PCM to the join URL above. meeting-service runs the CCaaS transcoder → CRM `/v1/assist/live-caption`. **Required on the bot container:** `VEXA_LIVE_PCM_WS_BASE=ws://meeting-service:8030`, `VEXA_LIVE_PCM_BOT_KEY=<CRM_BOT_API_KEY>`. Rebuild the Vexa bot image after changing `@vexa/bot` sources.

WS messages:

```json
{ "type": "segment", "speaker": "Jane Liu", "text": "Let's lock pricing by July 1.", "completed": true }
{ "type": "status", "status": "awaiting_admission", "error_code": null }
{ "type": "tip", "missing_fields": [], "objections": [], "suggested_question": "" }
```

Empty `speaker` is allowed. Live tips are **off** until `LIVE_TIPS_ENABLED=true`. Multiple API replicas: Redis pubsub `meeting:{id}`.

### After the call

```
GET /v1/meetings/{id}/extract
```

```json
{
  "summary": "Customer wants 30 licenses; price objection.",
  "next_step": "Send proposal tomorrow",
  "action_items": ["AE: send proposal"],
  "pain_points": ["cost"],
  "speakers": ["Jane Liu", "AE Name"],
  "entity_type": "contact",
  "entity_id": "C-4412"
}
```

If the LLM fails after retries, status is `completed_partial` and the **transcript is still there**.

Optional: set `CRM_COMPLETED_WEBHOOK_URL` and we POST `meeting.completed` (HMAC-SHA256 of the body). Polling extract is the default.

Stop / cancel: `DELETE /v1/meetings/{id}` (org-scoped, idempotent).

List for a record: `GET /v1/meetings?entity_type=contact&entity_id=C-4412`

Zoom passcodes are **redacted** on GET URLs.

### CRM UI checklist

1. Meeting URL on contact, deal, or team activity.
2. Recording consent copy, then **Send notetaker**.
3. Banner when `awaiting_admission`: host must Admit the bot.
4. Open live WS on that page (optional).
5. On `completed`, GET extract and PATCH notes/fields/tasks on **that** entity.
6. Feature-flag vs Recall so both cannot join the same URL.

Rate-limit: `POST /meetings` per org (`POST_MEETINGS_RATE_PER_MIN`).

---

## Vexa webhook (internal)

`POST /internal/vexa/webhook` is **not** on the CRM JWT. Verify `X-Webhook-Signature` (`sha256=` HMAC of `.{body}` or raw body) plus timestamp skew, or legacy `Authorization: Bearer $WEBHOOK_SECRET`. Replays (`event_id`) are ignored. Handler only updates status and enqueues extract — it never calls the LLM inline.

---

## Data model (owned by this service)

Tables: `meetings`, `transcript_segments` (unique `meeting_id, segment_id`), `meeting_extracts`, `meeting_events`, `webhook_receipts`, `jobs`.

Every row is tenant-scoped via `meetings.org_id`. Transcripts are PII. Logs record `meeting_id`, `segment_id`, `text_len` — never transcript bodies. Retention job deletes segments after `TRANSCRIPT_RETENTION_DAYS`.

Schema: Alembic (`alembic upgrade head`). Compose runs migrations on API start.

---

## Tests

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python -m pytest -q
```

Covers URL parse (Meet/Teams/Zoom + SafeLink), org isolation, idempotency, webhook replay, LLM failure → `completed_partial` with transcript intact, lobby timeout, capacity 429, consent, live WS snapshot.

---

## Runbook

**Bot not appearing**  
Vexa `/bots/status`, capacity 429, org-only Meet (guest blocked), Admit not clicked.

**No transcript**  
Whisper preflight on meeting-service (`/readyz`), `LIVE_PCM_ENABLED=true`, bot logs `live-pcm: connected`, and `VEXA_LIVE_PCM_WS_BASE` / `VEXA_LIVE_PCM_BOT_KEY` on the bot container. STT runs in meeting-service (not in-bot Vexa). If Whisper returns **500**, set **`WHISPER_MODEL=worktual-large-v3`** and rebuild `whisper-adapter`. Run `./scripts/preflight_whisper.sh`.

**End-to-end Assist preflight (CRM + meeting-service + Vexa):** from repo root, `./scripts/meet-assist-preflight.sh` (optional `MEET_ASSIST_PREFLIGHT_MEET_CODE=xxx-xxxx-xxx` for live-pcm WebSocket smoke).

**Stuck in lobby**  
Admit Worktual Notetaker. Then lobby timeout → `not_admitted`.

**Dual bots**  
CRM Recall flag still on, or missing in-flight lock. Check `NOTETAKER_PROVIDER` and unique native id.

**Extract missing, transcript present**  
Status `completed_partial` / `llm_failed`. Transcript GET still works. Retry after fixing LLM.

**Rotate keys**  
`VEXA_API_KEY`, Whisper token, `CRM_SERVICE_JWT_SECRET`, `WEBHOOK_SECRET` — change `.env`, recreate containers, no image rebuild.

**Whisper / GPU**  
Cap concurrent bots to what Whisper can do without starving the CRM LLM on the same GPU. Start `MAX_CONCURRENT_MEETINGS=1` or `2`. Isolate STT vs LLM if possible.

---

## Observability

- JSON logs: `meeting_id`, `org_id`, `error_code`
- `GET /metrics` Prometheus: join success/fail, 429s, webhooks, extract, segments, concurrent, admit latency, whisper/vexa ready
- Alert: whisper 5xx (`/readyz`), lobby timeout spike, extract job `failed`, disk on recordings (Vexa side)

---

## What this will not match Recall

Single mixed audio, text speaker labels, no video, no per-person wav, no vendor SLA. Enough for CRM notes.
