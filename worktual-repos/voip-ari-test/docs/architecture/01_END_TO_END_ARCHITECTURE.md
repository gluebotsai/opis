# End-to-End Enterprise ARI Telephony System Architecture

## 1. Executive Summary & Architecture Overview

The **Enterprise Telephony Platform** is a distributed, event-driven CPaaS (Communication Platform as a Service) designed for high-concurrency contact centers, CRMs, and AI voicebots.

The architecture decouples **telephony media/signaling** (handled strictly by Asterisk) from **business logic, state management, and real-time routing** (handled by NestJS microservices and Redis Pub/Sub).

```
┌─────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                             ENTERPRISE NETWORK TOPOLOGY                                         │
└─────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘

 [ PSTN Customer Phone ]
            │
            │ (SIP / UDP 5060)
            ▼
 [ Telecom Service Provider ]
            │
            │ (SIP / UDP 5060)
            ▼
 [ Inbound Gateway: 192.168.12.166 ]
            │
            │ (SIP / UDP 5060)
            ▼
 ┌───────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
 │ ASTERISK PBX MEDIA & SIGNALING ENGINE (82.113.92.45)                                                         │
 │                                                                                                               │
 │  • PJSIP SIP Engine (UDP/TCP 5060, WS/WSS 8088/5174)                                                         │
 │  • ARI Stasis Application: 'telephony'                                                                        │
 │  • Media Mixing Bridges (bridge_softmix / bridge_simple)                                                     │
 │  • ExternalMedia Audio Streams (16kHz PCM UDP)                                                                │
 │  • RTP / SRTP Port Range (UDP 10000 - 20000)                                                                │
 └────────────────────────────────────────────────┬──────────────────────────────────────────────────────────────┘
                                                  │
                                                  │ ARI HTTP REST & WebSockets (Port 8088)
                                                  ▼
 ┌───────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
 │ ASTERISK ADAPTER MICROSERVICE (@telephony/asterisk-adapter)                                                  │
 │                                                                                                               │
 │  • AriService (StasisStart/End, Stasis Bridge Management)                                                     │
 │  • MediaGatewayService (Bridges, ExternalMedia, MOH, Mute, Record, Playback)                                  │
 │  • CallSessionService (In-Memory Active Session Registry)                                                    │
 │  • CommandListenerService (Subscribes to Redis commands)                                                     │
 └──────────────────────────────┬─────────────────────────────────────────────────┬──────────────────────────────┘
                                │                                                 │
      Redis Commands            │ Publish Telephony Events                        │ ExternalMedia 16kHz PCM Audio
      (telephony.commands.*)    ▼ (telephony.events.*)                            ▼
 ┌───────────────────────────────────────────────────────────────┐   ┌───────────────────────────────────────────┐
 │ REDIS PUB/SUB EVENT BUS & IN-MEMORY STATE (Port 6379)         │   │ AI VOICEBOT / STT & TTS MEDIA ENGINE      │
 └──────────────────────────────┬────────────────────────────────┘   │ (Google Speech / Deepgram / ElevenLabs)  │
                                │                                    └───────────────────────────────────────────┘
                                ▼
 ┌───────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
 │ API GATEWAY & WEBSOCKET SERVER (@telephony/api) - Port 3000                                                   │
 │                                                                                                               │
 │  • CallsController (REST endpoints: /api/v1/calls/*)                                                          │
 │  • EventsGateway (Socket.IO WebSocket Server at /events)                                                      │
 │  • Webhook Dispatcher (HTTP POST to external CRM / Contact Center)                                            │
 └──────────────────────────────┬────────────────────────────────────────────────────────────────────────────────┘
                                │
                                │ HTTPS / WSS / REST APIs
                                ▼
 ┌───────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
 │ CONTACT CENTER AGENT CONSOLE (@telephony/agent-ui) - Port 5174 (HTTPS)                                        │
 │                                                                                                               │
 │  • SIP.js WebRTC Softphone (w1001-w1005 over WSS / DTLS-SRTP)                                                │
 │  • Socket.IO Real-time Call Event Listener                                                                    │
 │  • Interactive Live Call Controls (Accept, Decline, Mute, Hold, Record, Transfer, Outbound Dialer)            │
 └───────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Core Architectural Principles

1. **Asterisk as a Dumb Media Engine**: Asterisk contains zero hardcoded dialplan routing logic. Calls immediately enter `Stasis(telephony)` where NestJS controls channel creation, bridging, recording, and hangups via ARI.
2. **Stateless Service Scaling**: active call session metadata lives in `CallSessionService` and Redis, allowing API Gateway instances to remain stateless.
3. **Event-Driven Architecture**: Every state transition (ringing, answer, bridge, hold, mute, hangup) publishes an immutable event to Redis `telephony.events.asterisk`.
4. **Dual-Leg Bridge Model**: 1:1 calls use ARI mixing bridges (`MediaGatewayService.createBridge`). Inbound customer legs and agent WebRTC legs are joined as distinct channels, enabling independent mute, hold, transfer, and AI audio taps.

---

## 3. End-to-End Call Flow Specifications

### 3.1 Inbound Call Lifecycle (PSTN to Agent Console)

```
[Customer Phone]     [Gateway]         [Asterisk PBX]     [ARI Adapter]       [Redis Bus]       [API Gateway]     [Agent UI]
       │                 │                   │                  │                  │                  │              │
       │── SIP INVITE ──>│                   │                  │                  │                  │              │
       │ (+914440004407) │── SIP INVITE ────>│                  │                  │                  │              │
       │                 │                   │                  │                  │                  │              │
       │                 │                   │── StasisStart ──>│                  │                  │              │
       │                 │                   │   (telephony)    │                  │                  │              │
       │                 │                   │                  │── Create Session │                  │              │
       │                 │                   │── Answer() ─────>│                  │                  │              │
       │                 │                   │── Start MOH ────>│                  │                  │              │
       │                 │                   │                  │─ PUBLISH ───────>│                  │              │
       │                 │                   │                  │  call.started    │── Event Broadcast>│              │
       │                 │                   │                  │                  │  call.started    │── WebSocket >│
       │                 │                   │                  │                  │                  │   Inbound UI │
       │                 │                   │                  │                  │                  │  Ringing Card│
       │                 │                   │                  │                  │                  │              │
       │                 │                   │                  │                  │  [Agent Clicks ACCEPT & SPEAK] │
       │                 │                   │                  │                  │                  │              │
       │                 │                   │                  │                  │<─ POST /answer ──│<─ Click Accept
       │                 │                   │                  │<─ PUBLISH ───────│   (agentExt:     │              │
       │                 │                   │                  │   ANSWER cmd     │    w1001)        │              │
       │                 │                   │<─ Stop MOH ──────│                  │                  │              │
       │                 │                   │<─ Create Bridge ─│                  │                  │              │
       │                 │                   │<─ Originate ─────│                  │                  │              │
       │                 │                   │   PJSIP/w1001    │                  │                  │              │
       │                 │                   │                  │                  │                  │              │
       │                 │                   │── SIP INVITE (WSS/DTLS-SRTP) ────────────────────────────────────>│
       │                 │                   │<─ 200 OK (WebRTC Answer) ─────────────────────────────────────────│
       │                 │                   │                  │                  │                  │              │
       │                 │                   │── StasisStart ──>│                  │                  │              │
       │                 │                   │  (join_bridge)   │                  │                  │              │
       │                 │                   │<─ Add Channels ──│                  │                  │              │
       │                 │                   │   To Bridge      │                  │                  │              │
       │                 │                   │                  │── PUBLISH ──────>│                  │              │
       │                 │                   │                  │   call.bridged   │── Broadcast ────>│── WebSocket ─│
       │                 │                   │                  │                  │   call.bridged   │   Status:    │
       │ ◄═══════════════╧═══════════════════╧══════════════════╧══════════════════╧══════════════════╧═════► LIVE   │
       │                               2-WAY DTLS-SRTP / G.711 / OPUS AUDIO BRIDGE                               │
```

---

### 3.2 Outbound Call Lifecycle (Agent Console to PSTN)

```
[Agent UI]          [API Gateway]       [Redis Bus]       [ARI Adapter]     [Media Gateway]    [Asterisk PBX]   [PSTN Gateway]
    │                     │                  │                  │                 │                  │               │
    │─ Enter Phone & Click CALL ────────────>│                  │                 │                  │               │
    │  POST /api/v1/calls {from, to}         │                  │                 │                  │               │
    │                     │── PUBLISH ──────>│                  │                 │                  │               │
    │                     │   ORIGINATE cmd  │── Read Cmd ─────>│                 │                  │               │
    │                     │                  │                  │── Create Session│                  │               │
    │                     │                  │                  │── Create Bridge>│── ARI Bridge ───>│               │
    │                     │                  │                  │── Originate ───>│   PJSIP/w1001    │               │
    │                     │                  │                  │   Agent Leg     │   (WebRTC)       │               │
    │                     │                  │                  │                 │                  │               │
    │<───────────────────────────── SIP INVITE (WSS/DTLS-SRTP) ──────────────────────────────────────┤               │
    │────────200 OK (Agent Answers) ─────────────────────────────────────────────────────────────────>│               │
    │                     │                  │                  │                 │                  │               │
    │                     │                  │                  │── StasisStart ─>│                  │               │
    │                     │                  │                  │   (Agent Leg)   │                  │               │
    │                     │                  │                  │── Add Agent To Bridge ────────────>│               │
    │                     │                  │                  │── Originate PSTN Leg ─────────────>│── SIP INVITE─>│
    │                     │                  │                  │   PJSIP/to@trunk                   │  (PSTN)       │
    │                     │                  │                  │                 │                  │               │
    │                     │                  │                  │                 │                  │<─ 200 OK ─────│
    │                     │                  │                  │── StasisStart ─>│                  │   (PSTN Ans)  │
    │                     │                  │                  │   (PSTN Leg)    │                  │               │
    │                     │                  │                  │── Add PSTN Leg To Bridge ─────────>│               │
    │                     │                  │<─ PUBLISH ───────│                 │                  │               │
    │                     │                  │   call.bridged   │                 │                  │               │
    │<── WebSocket Event ─│<─ Subscribed ────│                  │                 │                  │               │
    │    call.bridged     │                  │                  │                 │                  │               │
    │ ◄═══════════════════╧══════════════════╧══════════════════╧═════════════════╧══════════════════╧═════════════► │
    │                                2-WAY BRIDGED AUDIO CONNECTED (PSTN + WEBRTC)                               │
```

---

## 4. Network Transport & Port Allocations

| Protocol / Transport | Port Number | Source / Destination | Function |
| :--- | :--- | :--- | :--- |
| **SIP (UDP/TCP)** | `5060` | Gateway (`192.168.12.166`) $\leftrightarrow$ Asterisk (`82.113.92.45`) | PSTN Trunk Signaling |
| **SIP over WebSocket (WS/WSS)** | `8088` / `5174` | Agent UI Browser $\leftrightarrow$ Asterisk / Vite Proxy | WebRTC SIP Signaling |
| **ARI HTTP REST & WS** | `8088` | Asterisk Adapter $\leftrightarrow$ Asterisk Engine | Call Control & Stasis Events |
| **RTP / SRTP** | `10000 - 20000` | Browser / Gateway $\leftrightarrow$ Asterisk | Voice Audio Media Streams |
| **HTTP / HTTPS REST API** | `3000` / `5174` | External CRM / Console $\leftrightarrow$ API Gateway | Control Plane APIs |
| **Socket.IO WebSockets** | `3000` / `5174` | Agent Console $\leftrightarrow$ API Gateway | Real-time CTI Call Events |
| **Redis TCP** | `6379` | Microservices $\leftrightarrow$ Redis Container | Pub/Sub Event & Command Bus |
| **PostgreSQL** | `5432` | API Services $\leftrightarrow$ Database | Persistent CDR & Analytics Storage |
