# Chat Service — Webchat

CCaaS implementation notes for the My Accounts webchat widget handoff.

## Ownership

| Concern | Owner |
|---------|-------|
| Widget UI, branding config, embed snippet | My Accounts |
| Realtime chat, bot replies, transcripts, agent routing | **chat-service** (this repo) |

See [webchat_widget.md](./webchat_widget.md) for the full handoff contract (join key, config shape, frame types).

**Implementation plan:** [PLAN.md](./PLAN.md)  
**API reference:** [API.md](./API.md) · [api.openapi.json](./api.openapi.json)  
**Gmail email:** [GMAIL_EMAIL.md](./GMAIL_EMAIL.md) — Pub/Sub pull (`Gmail_Mcp` / `mcp`), no webhook  
**File locator:** [locator.js](./locator.js) — `node docs/chatservice/locator.js webchat_ws`

## Accounts team — socket URL (ngrok dev)

Set this in My Accounts as `CCAAS_CHAT_SOCKET_URL`:

```
wss://engraving-flatness-dime.ngrok-free.dev/ws/webchat
```

Widget will connect as:

```
wss://engraving-flatness-dime.ngrok-free.dev/ws/webchat?webchatId=wc_<32hex>&visitorId=v_<id>
```

Local dev fallback:

```
CCAAS_CHAT_SOCKET_URL=ws://localhost:3002/ws/webchat
```

## Frame contract

JSON text frames — see section 6 of [webchat_widget.md](./webchat_widget.md).

**Client → server:** `session.start`, `message`

**Server → client:** `session.ready`, `system`, `message` (`from: "bot" | "agent"`)

## Current runtime

- WebSocket gateway at `/ws/webchat`
- Canonical tenant configuration and persisted conversations/messages in cc-core
- Guarded NLP integration with deterministic live-agent handoff
- Channel-aware queue routing, offers, capacity, receipts, transfers, and workspace delivery
- Tenant-approved service messages only; customer-facing dummy/stub fallbacks are disabled
- Backward-compatible optional `stub` fields remain in the frame contract but are always `false`
- Provider/NLP failure routes to a durable handoff when live-agent policy permits

## Monitor webchat socket logs

Log file path (relative to `apps/chat-service/`):

```
apps/chat-service/logs/chat-service.log
```

From repo root:

```bash
tail -f apps/chat-service/logs/chat-service.log | grep '"component":"webchat-ws"'
```

From `apps/chat-service/`:

```bash
tail -f logs/chat-service.log | grep '"component":"webchat-ws"'
```

`npm run dev` writes to this file automatically (`LOG_FILE=logs/chat-service.log` in package.json).

## Run locally

```bash
npm run dev:chat-service
```

## Manual test

```bash
# Connect (websocat or similar)
websocat "ws://localhost:3002/ws/webchat?webchatId=wc_5d80cd9b1ace4080bc70717552472611&visitorId=v_test1"

# Send session.start
{"type":"session.start","webchatId":"wc_5d80cd9b1ace4080bc70717552472611","visitorId":"v_test1","pageUrl":"http://localhost"}

# Send a message
{"type":"message","webchatId":"wc_5d80cd9b1ace4080bc70717552472611","visitorId":"v_test1","text":"hello"}
```

## Environment variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `PORT` | `3002` | HTTP + WebSocket server port |
| `LOG_FILE` | _(unset)_ | Write JSON logs to this file (set to `logs/chat-service.log` in dev) |
| `LOG_LEVEL` | `info` | Pino log level (`debug` shows upgrade + frame detail) |
| `WEBCHAT_WS_PATH` | `/ws/webchat` | WebSocket upgrade path |
| `ACCOUNTS_PUBLIC_API_URL` | _(unset)_ | Accounts public API base for config pull |
| `CCAAS_CHAT_SOCKET_URL` | — | Document for Accounts team (not read by chat-service) |
| `GMAIL_PUBSUB_*` | see `.env.example` | Gmail Pub/Sub pull (`Gmail_Mcp` topic, `mcp` subscription) |
| `MS_TOKEN_ENCRYPTION_KEY` | — | Decrypt Gmail OAuth tokens from `setup_app_connections` |

See [GMAIL_EMAIL.md](./GMAIL_EMAIL.md) for full Gmail setup.

## Related docs

- [Golden path: Webchat → Agent](../golden-path/webchat-to-agent.md)
- [AI Contact Center Plan](../AI_CONTACT_CENTER_PLAN.md)
