# Phase 9: Testing & End-to-End Validation

## 1. Overview
Execute comprehensive end-to-end testing across all call features (Originate, Answer, Hold, Transfer, Conference, Recording) and perform load testing for high-concurrency event streams.

---

## 2. Test Execution Matrix

| Test Suite | Component | Scope / Tool | Target Result |
| --- | --- | --- | --- |
| **Unit Tests** | All Services | Jest (`npm run test`) | > 85% Code Coverage |
| **SIP Softphone Integration** | Asterisk PBX | Linphone / MicroSIP | Extension-to-Extension audio bidirectional flow |
| **API End-to-End** | API Gateway | Supertest / Postman | All REST APIs return 200/201 with valid schemas |
| **WebSocket Performance** | Events Gateway | `k6` / `artillery` | 500 concurrent WebSocket connections receiving events < 50ms latency |
| **Webhook Delivery** | Webhook Service | Mock HTTP Listener | 100% delivery rate with HMAC signature verification |

---

## 3. Automated Call Test Script (`test/e2e/call_flow.spec.ts`)
```typescript
import request from 'supertest';

describe('Telephony Platform End-to-End Call Flow', () => {
  const API_URL = 'http://localhost:3000/api/v1';
  const API_KEY = 'test-tenant-api-key';

  let activeCallId: string;

  it('1. Should originate a call between extension 101 and 102', async () => {
    const res = await request(API_URL)
      .post('/calls')
      .set('X-API-Key', API_KEY)
      .send({ from: '101', to: '102' });

    expect(res.status).toBe(201);
    expect(res.body.callId).toBeDefined();
    activeCallId = res.body.callId;
  });

  it('2. Should place the call on hold', async () => {
    const res = await request(API_URL)
      .post(`/calls/${activeCallId}/hold`)
      .set('X-API-Key', API_KEY);

    expect(res.status).toBe(200);
  });

  it('3. Should hangup the call', async () => {
    const res = await request(API_URL)
      .post(`/calls/${activeCallId}/hangup`)
      .set('X-API-Key', API_KEY);

    expect(res.status).toBe(200);
  });
});
```

---

## 4. Verification Steps
1. Run unit test suite: `npm run test`.
2. Run end-to-end integration suite: `npm run test:e2e`.
3. Confirm all tests pass with 0 regressions.
