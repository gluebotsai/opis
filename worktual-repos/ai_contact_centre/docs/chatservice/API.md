# Chat Service API Reference

**Service:** `chat-service`  
**Default port:** `3002`  
**Channel:** `webchat`

Machine-readable spec: [api.openapi.json](./api.openapi.json)

## Base URLs

| Environment | HTTP base | WebSocket base |
|-------------|-----------|----------------|
| Local | `http://localhost:3002` | `ws://localhost:3002` |
| ngrok (dev) | `https://engraving-flatness-dime.ngrok-free.dev` | `wss://engraving-flatness-dime.ngrok-free.dev` |

---

## HTTP endpoints

### `GET /health`

Liveness probe.

**Response `200`**

```json
{
  "status": "ok",
  "service": "chat-service",
  "channel": "webchat",
  "webchatWsPath": "/ws/webchat",
  "timestamp": "2026-07-24T13:45:00.000Z"
}
```

---

### `GET /health/ready`

Readiness probe.

**Response `200`**

```json
{
  "status": "ok",
  "service": "chat-service",
  "timestamp": "2026-07-24T13:45:00.000Z"
}
```

---

### `POST /internal/messages`

Internal ingest endpoint (service-to-service). Not for public/widget use.

`channel_type` in the body is overridden to `webchat` by the service.

**Request body**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `schema_version` | `"1.0"` | yes | Event schema version |
| `event_id` | UUID | yes | Unique event id |
| `tenant_id` | UUID | yes | Tenant id |
| `external_thread_id` | string | yes | Thread key (e.g. `wc_…:v_…`) |
| `external_message_id` | string | yes | Message id |
| `customer_ref` | string | yes | Customer/visitor reference |
| `direction` | `"inbound"` \| `"outbound"` | yes | Message direction |
| `body` | string | yes | Message text |
| `occurred_at` | ISO datetime | yes | Event timestamp |
| `attachments` | array | no | `{ url, mime_type }[]` |
| `metadata` | object | no | Arbitrary metadata |

**Example request**

```http
POST /internal/messages HTTP/1.1
Content-Type: application/json

{
  "schema_version": "1.0",
  "event_id": "550e8400-e29b-41d4-a716-446655440000",
  "tenant_id": "660e8400-e29b-41d4-a716-446655440001",
  "external_thread_id": "wc_5d80cd9b1ace4080bc70717552472611:v_test1",
  "external_message_id": "msg_001",
  "customer_ref": "v_test1",
  "direction": "inbound",
  "body": "hello",
  "occurred_at": "2026-07-24T13:45:00.000Z"
}
```

**Response `200`**

```json
{
  "accepted": true,
  "event_id": "550e8400-e29b-41d4-a716-446655440000"
}
```

**Response `400`** — Zod validation failure.

---

## WebSocket — `GET /ws/webchat` (upgrade)

Realtime webchat gateway. Uses **JSON text frames** (not Socket.IO).

Path is configurable via `WEBCHAT_WS_PATH` (default `/ws/webchat`).

### Connect

```
ws://localhost:3002/ws/webchat?webchatId=wc_<32hex>&visitorId=v_<id>
```

**ngrok (Accounts team):**

```
wss://engraving-flatness-dime.ngrok-free.dev/ws/webchat?webchatId=wc_<32hex>&visitorId=v_<id>
```

Set in My Accounts:

```
CCAAS_CHAT_SOCKET_URL=wss://engraving-flatness-dime.ngrok-free.dev/ws/webchat
```

### Query parameters

| Param | Required | Format | Description |
|-------|----------|--------|-------------|
| `webchatId` | yes | `wc_` + 32 hex | Widget id from My Accounts |
| `visitorId` | yes | non-empty string | Anonymous visitor id (widget-generated) |

### Upgrade errors

| Condition | Result |
|-----------|--------|
| Missing `webchatId` or `visitorId` | `400 Bad Request`, connection closed |
| Invalid `webchatId` format | `400 Bad Request`, connection closed |

---

### Client → server frames

#### `session.start`

Opens a chat session. Must be sent before `message` frames.

```json
{
  "type": "session.start",
  "webchatId": "wc_5d80cd9b1ace4080bc70717552472611",
  "visitorId": "v_test1",
  "pageUrl": "https://example.com/pricing"
}
```

Optional fields:

```json
{
  "consent": { "accepted": true },
  "prechatAnswers": {
    "field_email": "user@example.com",
    "field_first_name": "Ada"
  }
}
```

#### `message`

Visitor chat message. Requires an active session (`session.start` sent first).

```json
{
  "type": "message",
  "webchatId": "wc_5d80cd9b1ace4080bc70717552472611",
  "visitorId": "v_test1",
  "text": "hello"
}
```

---

### Server → client frames

#### `session.ready`

Session accepted.

```json
{
  "type": "session.ready",
  "webchatId": "wc_5d80cd9b1ace4080bc70717552472611",
  "visitorId": "v_test1",
  "conversationId": "d6ac1bc1-00e8-4c27-b134-4614d0e2b8f6",
  "stub": false
}
```

#### `message`

Bot (or future agent) reply.

```json
{
  "type": "message",
  "from": "bot",
  "text": "Hello! How can I help you today?",
  "stub": false
}
```

`stub` is retained as an optional backward-compatible field and is always `false`.
Customer replies come from guarded NLP or an approved tenant service-message policy.

#### `system`

Status or error message. Connection stays open unless fatal.

```json
{
  "type": "system",
  "text": "Session not started. Send session.start first."
}
```

---

### Session flow

```
1. Widget connects  →  WS upgrade with webchatId + visitorId
2. Client sends     →  session.start
3. Server sends     →  session.ready
4. Server sends     →  message (configured bot greeting, stub: false)
5. Client sends     →  message (visitor text)
6. Server sends     →  guarded bot reply or durable live-agent handoff
7. Client disconnects
```

### Bot behaviour

| Event | Server action |
|-------|---------------|
| `session.start` | Resolve canonical tenant configuration and persist the conversation; reject unavailable or conflicting configuration |
| `message` | Persist inbound first, call guarded NLP, or route to the configured live-agent queue on disabled NLP, low confidence, explicit human request, or provider failure |

---

## External dependencies (read-only)

chat-service may call My Accounts public API on session start:

```http
GET {ACCOUNTS_PUBLIC_API_URL}/api/v1/public/webchat/:webchatId/config
```

Used for `greetingMessage` only in v1. See [webchat_widget.md](./webchat_widget.md).

---

## Logging

WebSocket events are logged with `component: "webchat-ws"`.

```bash
# From repo root
tail -f apps/chat-service/logs/chat-service.log | grep '"component":"webchat-ws"'
```

---

## Related docs

- [PLAN.md](./PLAN.md) — implementation phases
- [README.md](./README.md) — quick start
- [webchat_widget.md](./webchat_widget.md) — My Accounts handoff contract
- [api.openapi.json](./api.openapi.json) — OpenAPI 3.1 spec
