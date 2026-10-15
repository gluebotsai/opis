# Meet Media worker (optional native path)

> **Default live Assist for product buyers is the meeting-bot path**  
> (`MEETING_ASSIST_LIVE_SOURCE=bot` — see [`docs/in-meeting-assist.md`](../docs/in-meeting-assist.md)).  
> Use this worker only when ops sets `MEETING_ASSIST_LIVE_SOURCE=meet_media`.

Optional production path for **Google Meet** in-meeting Sales Assist:

1. Host is already in the Meet call and has connected Google with Meet Media scopes  
2. CRM starts this worker for the Assist session  
3. Worker joins via **Meet Media API** (`spaces.connectActiveConference`)  
4. Audio from non-sales participants → Worktual STT  
5. Chunks posted to `POST /api/webhooks/google-meet/transcript` with customer speaker labels  
6. Existing Assist auto-coach runs on customer lines only  

## Requirements

- Google Cloud project with **Meet REST API** enabled  
- Enrolled in **Google Workspace Developer Preview** for Meet Media API (project + OAuth users + meeting participants)  
- Host OAuth includes:
  - `https://www.googleapis.com/auth/meetings.conference.media.readonly`
  - `https://www.googleapis.com/auth/meetings.space.readonly`
- Optional native WebRTC: `npm i wrtc` in this package (Node RTP). Without it, the worker reports a clear error instead of pretending Chrome mic works.  
- `WORKTUAL_STT_*` and `ENRICH_INTERNAL_SECRET` in root `.env`

## Run

```bash
cd meet-media-worker
npm install
npm run dev
```

Listens on `MEET_MEDIA_WORKER_PORT` (default **4010**).

CRM calls:

- `POST /jobs/start` `{ sessionId, meetCode, accessToken, contactName, salesNames, activityId, crmBaseUrl, crmInternalSecret }`
- `POST /jobs/stop` `{ sessionId }`
- `GET /jobs/:sessionId`

Auth: header `x-internal-secret` = `MEET_MEDIA_WORKER_SECRET` or `ENRICH_INTERNAL_SECRET`.

## Admin / consent notes

Meet Media joins require host/org consent dialogs and correct Calendar/Meet admin settings. See Google’s Meet Media API lifecycle docs. Consumer `@gmail.com` meetings require the initiator present for consent.

## Not in scope

- Chrome microphone capture (cannot isolate the customer)  
- Post-meeting REST transcript files alone (too late for live Assist; still useful for CRM archive)
