# Webhook Specifications

## Overview
The Telephony Platform dispatches HTTP POST requests to configured Tenant Webhook URLs for major asynchronous events.

---

## Headers Included
```http
Content-Type: application/json
X-Telephony-Signature: sha256=<hmac_signature>
X-Telephony-Event: call.ended
```

---

## Dispatched Events

### `call.ended`
Sent when a call finishes.
```json
{
  "event": "call.ended",
  "callId": "call-uuid-1234",
  "tenantId": "tenant-uuid",
  "from": "101",
  "to": "102",
  "durationSeconds": 45,
  "disconnectReason": "NORMAL_CLEARING",
  "recordingUrl": "https://telephony.local/recordings/call-uuid-1234.mp3"
}
```

### `recording.ready`
Sent when a call audio recording is processed and available for download.
```json
{
  "event": "recording.ready",
  "callId": "call-uuid-1234",
  "tenantId": "tenant-uuid",
  "recordingUrl": "https://telephony.local/recordings/call-uuid-1234.mp3",
  "durationSeconds": 45
}
```
