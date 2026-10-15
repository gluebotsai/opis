# Production-Grade Telephony Platform Architecture (Asterisk ARI + Node.js Microservices)

## Overview
This document specifies the architecture, data models, call lifecycles, and event-driven pipeline for the Enterprise Telephony Platform. The system uses **Asterisk** strictly as a media and signaling engine, executing all telephony logic via **Asterisk REST Interface (ARI)**, **ExternalMedia PCM 16kHz audio streams**, **Redis Pub/Sub Event Bus**, **NestJS Microservices**, and a modern **Web-based Contact Center Experience Console**.

---

## 1. System Architecture & Topology

```
 [ Inbound PSTN Caller ] ──> [ Gateway 192.168.12.166 ] ──> [ Asterisk PBX 82.113.92.45 (Port 5060) ]
                                                                      │
                                                                      ▼
                                                         [ Dialplan / Stasis(telephony) ]
                                                                      │
                                                                      ▼
                                                     [ @telephony/asterisk-adapter (Port 8088) ]
                                                                      │
                                                                      ├── ARI Event Handlers (StasisStart/End, StateChange)
                                                                      ├── ExternalMedia 16kHz PCM Stream ──> [ AI STT / TTS Engine ]
                                                                      └── Redis Event Bus (telephony.events.*)
                                                                      │
                                                                      ▼
                                                          [ API Gateway / WSS (Port 3000) ]
                                                                      │
                                                                      ▼
                                                          [ Contact Center Console UI ]
                                                            (Softphone, CRM, Queues, Voicebot)
```

---

## 2. Inbound & Outbound Call Flow Specifications

### 2.1 Inbound Call Flow
1. **PSTN Caller** dials `+914440004407`.
2. **Asterisk Gateway (`192.168.12.166`)** routes SIP INVITE to `82.113.92.45:5060`.
3. Asterisk PJSIP matches endpoint `nlp_ccaas_sipserver` or `[anonymous]` fallback and executes `Answer()` -> `Stasis(telephony)`.
4. `@telephony/asterisk-adapter` receives `StasisStart` and publishes `stasis.start` to Redis.
5. **API Gateway** broadcasts `call.started` over WebSockets to all connected Contact Center Console clients.
6. When the agent clicks **`ACCEPT & SPEAK`**, Asterisk creates a mixing audio bridge (`client.bridges.create({ type: 'mixing' })`), connects agent extension `1001` (or browser WebRTC), and joins both channels into the bridge for **2-way crystal clear audio**.
7. If AI handoff is enabled, `ExternalMedia` streams raw PCM audio to/from Google Speech-to-Text (STT) and Text-to-Speech (TTS).
8. Upon call completion, recordings and transcripts are linked to CRM customer records.

### 2.2 Outbound Call Flow
1. Agent enters number (e.g. `9952282829`) into the Softphone Outbound Dialer and clicks **`CALL NUMBER`**.
2. **API Gateway** receives `POST /calls` with `{ from: '1001', to: '9952282829' }` and dispatches `ORIGINATE` to Redis.
3. `@telephony/asterisk-adapter` originates `PJSIP/9952282829@nlp_ccaas_sipserver` directly into Stasis.
4. Asterisk establishes the RTP audio stream, publishes `call.initiated` with `direction: 'OUTBOUND'`, and updates the UI in real-time.

---

## 3. Real-Time Telephony Events & Event Bus Schema

All state changes emit JSON events over Redis channels (`telephony.events.asterisk`, `telephony.events.agent`, `telephony.events.queue`):

| Event Name | Source | Description |
| :--- | :--- | :--- |
| `call.started` / `stasis.start` | ARI Adapter | Issued when a call enters Asterisk Stasis |
| `call.ringing` | ARI Adapter | Issued when channel state changes to Ringing |
| `call.answered` | ARI Adapter | Issued when channel state changes to Up |
| `call.bridged` | ARI Adapter | Issued when 2 or more channels are joined in a mixing bridge |
| `call.initiated` | ARI Adapter | Issued when an outbound PSTN call is originated |
| `call.hold` / `call.resume` | ARI Adapter | Issued when Music-on-Hold is started/stopped |
| `call.muted` / `call.unmuted` | ARI Adapter | Issued when inbound mic transmission is muted/unmuted |
| `call.ended` / `stasis.end` | ARI Adapter | Issued when a channel hangs up |
| `recording.started` / `recording.ready` | Recording Service | Issued when call recording starts/finishes |
| `agent.online` / `agent.status` | Agent Service | Issued when agent presence status changes |

---

## 4. Contact Center Experience UI Features

The Contact Center Web Application (`apps/admin-ui`) provides:
- **Telephony Dashboard**: Real-time operational metrics, active call cards, system health monitor.
- **Agent Softphone & Active Call Console**: Live call controls (Answer, Reject, Hangup, Hold, Resume, Mute, Unmute, Transfer, Record), CRM customer cards, live STT transcript, and keypad dialpad.
- **Call Queues & Agent Routing**: ACD queue management, agent skills, and round-robin distribution.
- **AI Voicebot Configuration**: System prompts, STT/TTS models, and handoff trigger rules.
- **Call History & Recordings**: Audios, transcripts, analytics, and duration counters.
- **Live Event Stream Monitor**: Real-time WebSocket event trace log.

---

## 5. Deployment Instructions (Server 82.113.92.45)

```bash
# 1. Pull latest production code from GitHub
git pull origin main

# 2. Build and restart Asterisk container
docker compose up -d --build asterisk

# 3. Start microservices
npm run start:all
```
