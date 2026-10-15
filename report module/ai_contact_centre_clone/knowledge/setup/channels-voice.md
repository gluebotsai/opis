# Setup — Voice / Call (prompts + DIDs)

## Purpose

Configure **call prompt profiles** (12 reusable audio/text slots) and map **phone numbers (DIDs)** to:

- **CCaaS (`contact-center`):** route to a **user** or **queue**
- **CRM (`crm`):** route to a **user** only

Prompts are **not** owned by the queue. Each DID references a `promptProfileId`.

## Auth

Customer Bearer + org admin for writes. Requires active **Contact Centre and/or CRM** subscription.

## Source map

| Layer | Path |
|-------|------|
| Slot catalog | [`src/lib/setup/voicePromptSlots.js`](../../src/lib/setup/voicePromptSlots.js) |
| Client | [`src/lib/setup/setupApi.js`](../../src/lib/setup/setupApi.js) |
| UI | `SetupCommunicationPage.jsx`, `SetupVoicePromptsPage.jsx`, `SetupVoicePromptDetailPage.jsx`, `SetupVoiceNumbersPage.jsx`, `SetupVoiceNumberDetailPage.jsx` |
| Server | [`server/setupVoice.js`](../../server/setupVoice.js) |
| TTS stub | [`server/voice/ttsProvider.js`](../../server/voice/ttsProvider.js) |
| Repo | [`server/repositories/raw/setupVoice.repo.js`](../../server/repositories/raw/setupVoice.repo.js) |
| Schema | `setup_voice_prompt_profiles`, `setup_voice_dids` |
| Media | `{VOICE_MEDIA_ROOT}/{orgId}/{profileId}/` (default `uploads/voice`) |

## Prompt slots

| id | Label | TTS |
|----|-------|-----|
| `welcome_greeting` | Welcome Greeting | yes |
| `hold_music` | Hold Music | upload only |
| `queue_announcement` | Queue Announcement | yes |
| `queue_position` | Queue Position | yes |
| `out_of_business_hours` | Out of Business Hours Message | yes |
| `maximum_queue_announcement` | Maximum Queue Announcement | yes |
| `maximum_wait_time_announcement` | Maximum Wait Time Announcement | yes |
| `agent_available` | Agent Available | yes |
| `agent_busy` | Agent Busy | yes |
| `agent_unavailable` | Agent Unavailable | yes |
| `voicemail_prompt` | Voicemail Prompt | yes |
| `callback_prompt` | Callback Prompt | yes |

Per slot in JSONB: `text`, `audioKey`, `audioUrl` (API path), `source` (`none`\|`upload`\|`tts`), `status` (`pending`\|`ready`\|`failed`).

Upload always replaces TTS audio for that slot.

## Endpoints

### Prompt profiles

| Method | Path | Notes |
|--------|------|-------|
| GET | `/api/v1/me/setup/voice/prompt-profiles` | List |
| POST | `/api/v1/me/setup/voice/prompt-profiles` | Create |
| GET/PATCH/DELETE | `/api/v1/me/setup/voice/prompt-profiles/:id` | CRUD |
| POST | `…/:id/slots/:slotId/audio` | Multipart `file` ≤10MB |
| POST | `…/:id/slots/:slotId/generate` | TTS from text (stub provider) |
| GET | `…/:id/audio/:slotId` | Authenticated audio bytes |

### DIDs

| Method | Path | Notes |
|--------|------|-------|
| GET/POST | `/api/v1/me/setup/voice/dids` | List / create |
| GET/PATCH/DELETE | `/api/v1/me/setup/voice/dids/:id` | CRUD |

## Env

```bash
# Local disk now; point at NFS mount later without schema change
VOICE_MEDIA_ROOT=uploads/voice
```

## UI routes

- `/customer/setup/communication` — Voice section when CRM or CCaaS purchased
- `/customer/setup/communication/voice/prompts[/:profileId]`
- `/customer/setup/communication/voice/numbers[/:didId]`

## Reuse notes

- **CCaaS / CRM spokes:** resolve inbound DID → routing target + prompt profile; play `audioUrl` assets with customer/product auth as designed by the spoke.
- Do not duplicate prompt packs per queue. Optional queue default inheritance is out of scope for v1.
- TTS: [`server/voice/tts_synthesize.py`](../../server/voice/tts_synthesize.py) (called by [`ttsProvider.js`](../../server/voice/ttsProvider.js)) POSTs `{ text, session_id }` to `TTS_URL`, writes mono 16-bit 24kHz WAV via Python `wave` (same as the product sample). Set `TTS_USE_STUB=true` for offline tone stub.
