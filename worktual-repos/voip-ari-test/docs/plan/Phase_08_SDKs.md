# Phase 8: Client SDKs (JavaScript & Python)

## 1. Overview
Build lightweight client SDK packages that product teams can install in their CRM or Contact Center projects to control calls and listen to real-time telephony events with a few lines of code.

---

## 2. TypeScript / JavaScript SDK (`apps/sdk`)

### Installation
`npm install @telephony/sdk`

### Usage Example
```typescript
import { TelephonyClient } from '@telephony/sdk';

const telephony = new TelephonyClient({
  apiKey: 'YOUR_TENANT_API_KEY',
  baseUrl: 'https://telephony.example.com/api/v1',
  wsUrl: 'wss://telephony.example.com/events',
});

// 1. Originate a Call
async function makeCall() {
  const call = await telephony.calls.originate({
    from: '101',
    to: '102',
  });
  console.log('Call Originated:', call.callId);
}

// 2. Listen to Real-time Events
telephony.events.on('call.answered', (event) => {
  console.log('Call Answered:', event.data.callId);
});

telephony.events.on('call.ended', (event) => {
  console.log('Call Ended:', event.data.callId, 'Duration:', event.data.durationSeconds);
});
```

---

## 3. Python SDK (`telephony-sdk`)

### Installation
`pip install telephony-sdk`

### Usage Example
```python
from telephony import TelephonyClient

client = TelephonyClient(api_key="YOUR_TENANT_API_KEY", base_url="https://telephony.example.com/api/v1")

# Originate call
call = client.calls.originate(from_ext="101", to_ext="102")
print("Call ID:", call.id)

# Hangup call
client.calls.hangup(call_id=call.id)
```

---

## 4. Verification Steps
1. Build `@telephony/sdk`: `npm run build -w apps/sdk`.
2. Run a local sample node script importing `@telephony/sdk` to originate a test call and verify event listeners fire cleanly.
