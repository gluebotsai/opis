# WebSocket Event Stream Specifications

## Endpoint
`ws://localhost:3000/events`

## Client Handshake
Pass your Tenant JWT token in query parameters or auth headers:
`ws://localhost:3000/events?token=<tenant_jwt_token>`

---

## Event Payload Structure
All events emitted over WebSockets follow a unified JSON schema:

```json
{
  "event": "call.answered",
  "tenantId": "tenant-uuid",
  "timestamp": "2026-08-02T00:00:00.000Z",
  "data": {}
}
```

---

## Emitted Events

### 1. Call Events
- `call.started`: Emitted when a channel is created/originated.
- `call.ringing`: Emitted when the destination endpoint is ringing.
- `call.answered`: Emitted when the call is picked up.
- `call.ended`: Emitted when the call hangs up. Include duration & disconnect reason.

### 2. Agent Events
- `agent.status`: Emitted when an agent changes status (`ONLINE`, `OFFLINE`, `BUSY`).

### 3. Queue Events
- `queue.updated`: Emitted when calls enter or leave queues, or queue metrics change.
