# Enterprise Telephony Platform Integration Guide

This guide describes how third-party products (**Contact Centers, CRMs like Salesforce/HubSpot, Omnichannel Platforms, AI Voicebots, and BI Dashboards**) integrate with and consume the Telephony System.

---

## 1. Integration Touchpoints Overview

External enterprise systems interact with the telephony platform through **5 standard interfaces**:

```
 ┌─────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
 │                                       THIRD-PARTY ENTERPRISE CONSUMERS                                      │
 │                                                                                                             │
 │    [ Contact Center UI ]    [ Enterprise CRM ]    [ AI Voicebot / STT Engine ]    [ Analytics / BI Engine ]   │
 └───────────┬──────────────────────────┬──────────────────────────┬──────────────────────────┬────────────────┘
             │                          │                          │                          │
             │ 1. REST Control APIs     │ 2. Real-Time WebSockets  │ 3. ExternalMedia Stream │ 4. Webhooks
             │    (HTTP POST/GET)       │    (Socket.IO Events)    │    (16kHz Raw PCM UDP)  │    (HTTP Callbacks)
             ▼                          ▼                          ▼                          ▼
 ┌─────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
 │                                   ENTERPRISE TELEPHONY CPaaS PLATFORM                                       │
 │                                                                                                             │
 │  • REST API Gateway (Port 3000)                                                                             │
 │  • Real-Time Event Gateway (/events)                                                                        │
 │  • Asterisk ARI MediaGatewayService                                                                         │
 │  • Webhook Delivery Pipeline                                                                                │
 └─────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. REST API Integration (`/api/v1`)

All API requests require an API key header: `x-api-key: <TENANT_API_KEY>`.

### 2.1 Originate Outbound Call
Initiates an outbound call from an agent extension or AI bot to a customer phone number.

- **Endpoint**: `POST /api/v1/calls`
- **Request Body**:
```json
{
  "from": "w1001",
  "to": "+919952282829",
  "callerId": "+914440004407",
  "agentExtension": "w1001"
}
```
- **Response**:
```json
{
  "success": true,
  "message": "Call origination initiated",
  "status": "INITIATED",
  "from": "w1001",
  "to": "+919952282829",
  "callId": "7a3b1029-41e8-4a9f-889a-0e9b2104bf23"
}
```

### 2.2 Answer Inbound Call
Connects an inbound waiting customer to a specific agent WebRTC extension.

- **Endpoint**: `POST /api/v1/calls/:channelId/answer`
- **Request Body**:
```json
{
  "agentExtension": "w1001",
  "callId": "7a3b1029-41e8-4a9f-889a-0e9b2104bf23"
}
```

### 2.3 Live In-Call Controls
- **Hold Call**: `POST /api/v1/calls/:channelId/hold`
- **Resume Call**: `POST /api/v1/calls/:channelId/resume`
- **Mute Mic**: `POST /api/v1/calls/:channelId/mute`
- **Unmute Mic**: `POST /api/v1/calls/:channelId/unmute`
- **Hangup Call**: `POST /api/v1/calls/:channelId/hangup`
- **Start Call Recording**: `POST /api/v1/calls/:channelId/record` `{ "name": "rec_1001_call123" }`
- **Stop Call Recording**: `POST /api/v1/calls/:channelId/record/stop` `{ "name": "rec_1001_call123" }`

---

## 3. Real-Time WebSocket CTI Integration

CRMs and Contact Center softphone toolbars connect via **Socket.IO** to receive instant CTI (Computer Telephony Integration) popups.

### 3.1 Connection
- **URL**: `wss://<HOST>:3000/events?tenantId=<TENANT_API_KEY>`
- **Transports**: `['websocket', 'polling']`

### 3.2 Key Telephony Events & CRM Handlers

| Event Name | Trigger | CRM / UI Action Required |
| :--- | :--- | :--- |
| `call.started` | Inbound customer call arrives | Trigger **Screen Pop** (lookup caller number in CRM contact records) |
| `call.answered` | Agent leg is ringing | Change agent UI state to `RINGING_AGENT` |
| `call.bridged` | Customer and agent joined in mixing bridge | Start live call timer, open active call workspace |
| `call.hold` / `call.resume` | Call placed on hold / resumed | Update call state pill to `ON_HOLD` / `LIVE` |
| `call.ended` | Call terminates | Close softphone session, open **After-Call Work (ACW)** disposition form |
| `recording.finished` | Audio recording processed | Attach MP3/WAV recording URL to CRM ticket / record |

#### Example Event Payload (`call.started` Screen Pop):
```json
{
  "event": "call.started",
  "callId": "7a3b1029-41e8-4a9f-889a-0e9b2104bf23",
  "channelId": "1786028299.14",
  "direction": "INBOUND",
  "callerNumber": "+919150911820",
  "did": "+914440004407",
  "timestamp": "2026-08-06T14:50:00.000Z"
}
```

---

## 4. Webhook Subscriptions (Server-to-Server Async Callbacks)

Enterprise CRMs (e.g. Salesforce / Zendesk) subscribe to webhooks to sync Call Detail Records (CDRs) and recording links asynchronously.

### 4.1 Configuring Webhooks
Register callback endpoints via API:
- **Endpoint**: `POST /api/v1/webhooks`
```json
{
  "url": "https://crm.yourcompany.com/api/telephony/webhook-receiver",
  "events": ["call.started", "call.bridged", "call.ended", "recording.finished"],
  "secret": "whsec_x89a3n10984128937"
}
```

### 4.2 Webhook Signature Verification
Webhooks contain a cryptographic HMAC SHA-256 signature header:
`x-telephony-signature: t=1786028299,v1=9f8a...`

Receiver pseudocode:
```ts
const expectedSignature = crypto
  .createHmac('sha256', WEBHOOK_SECRET)
  .update(`${timestamp}.${rawBody}`)
  .digest('hex');
```

---

## 5. WebRTC Softphone Integration (Agent Extensions)

Contact Center UIs embed the softphone using `sip.js`:

### 5.1 Endpoint Parameters
- **SIP Domain**: `<ASTERISK_HOST>` (e.g. `82.113.92.45`)
- **WebSocket Server**: `wss://<HOST>:5174/asterisk-ws` (proxied to Asterisk `ws://127.0.0.1:8088/ws`)
- **Extensions**: `w1001` through `w1005`
- **Credentials**: `username: w1001`, `password: webrtc_pass1001`
- **Audio Encryption**: Mandatory DTLS-SRTP (`media_encryption=dtls`)

### 5.2 Browser Permission Best Practice
Browser WebRTC requires **HTTPS secure context** (`window.isSecureContext === true`) for `navigator.mediaDevices.getUserMedia`.
- SIP registration can occur without microphone permissions.
- Microphone permissions must be requested during the click gesture for **Accept Call** or **Call Number**.

---

## 6. AI Voicebot & ExternalMedia Integration

For AI-driven IVR, Speech-to-Text (STT), and Text-to-Speech (TTS) voicebot automation:

1. Dispatch an `EXTERNAL_MEDIA` command via Redis or API:
```json
{
  "action": "EXTERNAL_MEDIA",
  "channelId": "1786028299.14",
  "externalHost": "127.0.0.1:5000",
  "format": "slin16",
  "transport": "udp"
}
```
2. Asterisk spawns a bidirectional RTP socket streaming **raw 16kHz PCM audio** (`slin16`) directly to the AI service at `127.0.0.1:5000`.
3. The AI engine processes live customer speech in real time and streams back synthesized speech into the mixing bridge.
