# Google Meet scheduled capture (Phase 1 MVP)

Automatic **Vexa notetaker** for **scheduled** Google Meet calls when the CRM user connects Google in **Configuration → Email**. **Instant Meet** (no calendar event) is **Phase 2** — see [Phase 2](#phase-2-deferred) below.

## What triggers a bot (Phase 1)

| Source | Mechanism |
|--------|-----------|
| Google Calendar event with Meet link on the connected user’s primary calendar | `events.watch` → HTTPS push → sync → [`ingestGoogleCalendarMeetEvent`](../backend/src/service/calendar/google-calendar-push.ts) → meeting-service |
| CRM meeting activity with Meet link + due time | Existing schedule / [`dispatchMeetingCaptureBot`](../backend/src/service/transcripts/meeting-capture.ts) |

Requires `NOTETAKER_PROVIDER=vexa`, `MEETING_SERVICE_URL`, and `CRM_SERVICE_JWT_SECRET`.

## Webhook multiplexer

One URL handles **two** Google delivery formats:

| Format | Detection | Handler |
|--------|-----------|---------|
| Calendar watch | `X-Goog-Channel-Id` header | Calendar incremental sync |
| Gmail Pub/Sub | JSON `{ "message": { "data": "<base64>" } }` | Inbox incremental sync |

Routes (same logic):

- `POST /api/webhooks/google-calendar/push`
- `POST /api/webhooks/gmail/push`

Implementation: [`google-push-multiplex.ts`](../backend/src/service/webhooks/google-push-multiplex.ts).

Always return **HTTP 200** quickly for Pub/Sub (except optional auth failure → 401).

## GCP (`gmail-test-502808` example)

| Resource | Example |
|----------|---------|
| Pub/Sub topic | `projects/gmail-test-502808/topics/Gmail_Mcp` |
| Push subscription | `mcp-push` → `https://<public-api>/api/webhooks/google-calendar/push` |
| Topic IAM publishers | `gmail-api-push@system.gserviceaccount.com`, `meet-api-event-push@system.gserviceaccount.com` (Phase 2 Meet events) |

APIs: Gmail, Calendar, Pub/Sub; Phase 2 adds Workspace Events + Meet REST as needed.

## CRM env

```bash
GOOGLE_CLIENT_ID=...          # same OAuth client as connect flow (project aligned with Pub/Sub topic)
GOOGLE_CLIENT_SECRET=...
GOOGLE_REDIRECT_URI=https://<public-api>/api/google/oauth/callback

GMAIL_PUBSUB_TOPIC=projects/gmail-test-502808/topics/Gmail_Mcp
GMAIL_PUBSUB_VERIFICATION_TOKEN=   # optional; append ?token= on push URL if set

CALENDAR_PUSH_WEBHOOK_URL=https://<public-api>/api/webhooks/google-calendar/push
CALENDAR_PUSH_VERIFICATION_TOKEN=  # optional; appended to calendar watch address

CRM_API_PUBLIC_URL=https://<public-api>   # fallback to derive calendar push URL

NOTETAKER_PROVIDER=vexa
MEETING_SERVICE_URL=http://127.0.0.1:8030
CRM_COMPLETED_WEBHOOK_URL=https://<public-api>/api/webhooks/meeting-service/completed
```

On Google connect, CRM registers Gmail + Calendar watches ([`oauth-bff.ts`](../backend/src/service/oauth/oauth-bff.ts)). Cron renews watches.

## Consumer Gmail (`@gmail.com`)

Phase 1 relies on **Calendar watch + primary calendar sync**, not Workspace Events. Most users are consumer Gmail; that is supported for **scheduled** Meet on their calendar.

## Database migrations

Calendar push requires CRM tables from:

- `20260916180000_google_calendar_push` — `google_calendar_watches`, `calendar_meet_captures`
- `20260917133000_calendar_meet_capture_status_enum` — Prisma enum on `status`

```bash
npx prisma migrate deploy
```

## Register watches (after migrate)

```bash
cd backend && npx tsx --tsconfig tsconfig.json scripts/bootstrap-calendar-watches.ts
```

Or reconnect Google in **Configuration → Email** (same registration path). Expect `[google-calendar-push] watch_registered` in API logs.

## Verify locally

```bash
./scripts/verify-scheduled-meet-capture.sh
```

Manual: create/update a Calendar event **with Meet link** on the connected account → API logs should show `incremental_sync_done` with `dispatched=…` → admit **Worktual Notetaker** in Meet.

## Phase 2 (deferred)

Not implemented in Phase 1:

- **Instant Meet** without a calendar event
- **Workspace Events** subscriptions (`workspaceevents.googleapis.com`) on OAuth connect
- Pub/Sub Meet lifecycle (`conference.v2.started`, participant join/leave) → bot / UI
- Cloud Identity `USER_ID` target for subscriptions

Spec reference: [`GOOGLE_MEET_WORKSPACE_EVENTS.md`](file:///Users/macbook/Documents/assist/GOOGLE_MEET_WORKSPACE_EVENTS.md) (external assist doc).

For consumer accounts, Workspace subscriptions may fail; Phase 2 should store `unsupported_consumer` and not block Google connect.

Meet add-on Assist (Path B) remains separate: `GOOGLE_ADDON_*` on meeting-service, project `853886404171`. See [`meeting-service-integration.md`](meeting-service-integration.md) and [`in-meeting-assist.md`](in-meeting-assist.md).
