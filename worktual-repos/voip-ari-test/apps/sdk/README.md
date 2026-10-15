# @telephony/sdk

Official JavaScript / TypeScript SDK for integrating the Telephony Platform into CRM, Contact Center, and AI Voice applications.

---

## Installation

```bash
npm install @telephony/sdk
```

---

## Quickstart

```typescript
import { TelephonyClient } from '@telephony/sdk';

// Initialize Client
const telephony = new TelephonyClient({
  apiKey: 'YOUR_TENANT_API_KEY',
  baseUrl: 'http://localhost:3000/api/v1',
  wsUrl: 'ws://localhost:3000/events',
});

// 1. Originate Outbound Call
async function makeCall() {
  const call = await telephony.calls.originate({
    from: '1001',
    to: '1002',
  });
  console.log('Call Originated:', call.callId);
}

// 2. Control Call Channels
async function controlCall(callId: string) {
  await telephony.calls.hold(callId);
  await telephony.calls.resume(callId);
  await telephony.calls.hangup(callId);
}

// 3. Listen to Real-Time Call Events over WebSocket
telephony.events.on('call.started', (event) => {
  console.log('Call Started:', event.data.channelId);
});

telephony.events.on('call.answered', (event) => {
  console.log('Call Answered:', event.data.channelId);
});

telephony.events.on('call.ended', (event) => {
  console.log('Call Ended:', event.data.channelId);
});
```
