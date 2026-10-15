# Telephony Platform V1 - Real-Time WebSockets & Webhooks Specification

## 1. Socket.IO Real-Time Gateway

The Telephony Platform streams real-time call states, agent presence, queue dynamics, and recording readiness via Socket.IO.

### Gateway Connection Details

- **Namespace**: `/events`
- **Protocol**: WebSocket / HTTP Long-Polling fallback (Socket.IO v4)
- **URL**: `ws://localhost:3000/events`

### Connection Query Parameters

When establishing a connection, clients pass their `tenantId` (or Tenant API key) in the query parameters:

```javascript
import { io } from "socket.io-client";

const socket = io("http://localhost:3000/events", {
  query: {
    tenantId: "demo-tenant-api-key-12345"
  }
});
```

---

## 2. Real-Time Event Catalogue

### 2.1 Call Events

#### `call.initiated`
Fired when an outbound call origination request is sent to Asterisk.
```json
{
  "event": "call.initiated",
  "timestamp": "2026-08-02T01:22:00.000Z",
  "data": {
    "channelId": "1785612.100",
    "callId": "call-uuid-1234",
    "from": "1001",
    "to": "1002"
  }
}
```

#### `call.started`
Fired when a call channel enters Stasis.
```json
{
  "event": "call.started",
  "timestamp": "2026-08-02T01:22:01.000Z",
  "data": {
    "channelId": "1785612.100",
    "callerNumber": "1001",
    "connectedNumber": "1002"
  }
}
```

#### `call.ringing`
Fired when the target channel begins ringing.
```json
{
  "event": "call.ringing",
  "timestamp": "2026-08-02T01:22:02.000Z",
  "data": {
    "channelId": "1785612.100",
    "state": "Ringing"
  }
}
```

#### `call.answered`
Fired when the callee answers the call (channel state becomes `Up`).
```json
{
  "event": "call.answered",
  "timestamp": "2026-08-02T01:22:05.000Z",
  "data": {
    "channelId": "1785612.100",
    "state": "Up"
  }
}
```

#### `call.transferred`
Fired when a blind or attended transfer is initiated.
```json
{
  "event": "call.transferred",
  "timestamp": "2026-08-02T01:22:15.000Z",
  "data": {
    "channelId": "1785612.100",
    "target": "1003",
    "type": "BLIND"
  }
}
```

#### `call.ended`
Fired when a call hangs up and exits Stasis.
```json
{
  "event": "call.ended",
  "timestamp": "2026-08-02T01:23:00.000Z",
  "data": {
    "channelId": "1785612.100"
  }
}
```

#### `call.dtmf`
Fired when a DTMF digit is pressed by either party.
```json
{
  "event": "call.dtmf",
  "timestamp": "2026-08-02T01:22:30.000Z",
  "data": {
    "channelId": "1785612.100",
    "digit": "1"
  }
}
```

---

### 2.2 Agent Presence Events

#### `agent.online`
Fired when an agent logs in.
```json
{
  "event": "agent.online",
  "timestamp": "2026-08-02T01:00:00.000Z",
  "data": {
    "agentId": "ag-1",
    "agentName": "Linphone Agent 1001",
    "extension": "1001",
    "status": "AVAILABLE"
  }
}
```

#### `agent.status`
Fired when an agent's presence status changes (e.g. `AVAILABLE` → `BUSY` → `ON_BREAK`).
```json
{
  "event": "agent.status",
  "timestamp": "2026-08-02T01:22:05.000Z",
  "data": {
    "agentId": "ag-1",
    "agentName": "Linphone Agent 1001",
    "previousStatus": "AVAILABLE",
    "newStatus": "BUSY"
  }
}
```

#### `agent.offline`
Fired when an agent logs out.
```json
{
  "event": "agent.offline",
  "timestamp": "2026-08-02T01:59:59.000Z",
  "data": {
    "agentId": "ag-1",
    "agentName": "Linphone Agent 1001",
    "status": "OFFLINE"
  }
}
```

---

### 2.3 Queue & Recording Events

#### `queue.updated`
Fired when queue membership or caller state changes.
```json
{
  "event": "queue.updated",
  "timestamp": "2026-08-02T01:22:00.000Z",
  "data": {
    "queueId": "q-1",
    "queueName": "General Support Queue",
    "agentId": "ag-2",
    "action": "member_added"
  }
}
```

#### `recording.ready`
Fired when a call audio recording is saved and ready for download/playback.
```json
{
  "event": "recording.ready",
  "timestamp": "2026-08-02T01:23:05.000Z",
  "data": {
    "channelId": "1785612.100",
    "recordingName": "rec_call-123_1785612300",
    "filePath": "/var/spool/asterisk/recording/rec_call-123_1785612300.wav"
  }
}
```

---

## 3. Webhook Delivery & Signature Verification

Registered webhooks receive HTTP `POST` notifications for matching events.

### Webhook HTTP Headers
| Header | Value |
|---|---|
| `Content-Type` | `application/json` |
| `X-Telephony-Signature` | `HMAC-SHA256(payload_body, webhook_secret)` |

### Verification Code Example (Node.js)

```javascript
const crypto = require('crypto');

function verifyWebhook(payloadBodyString, receivedSignature, secret) {
  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(payloadBodyString)
    .digest('hex');

  return crypto.timingSafeEqual(
    Buffer.from(receivedSignature),
    Buffer.from(expectedSignature)
  );
}
```

### Webhook Retry Policy
- **Attempts**: 3 attempts per webhook event.
- **Timeout**: 5000ms per attempt.
- **Backoff**: Immediate first attempt, followed by linear backoff.
