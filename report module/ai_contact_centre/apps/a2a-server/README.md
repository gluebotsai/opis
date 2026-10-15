# Contact Centre A2A Spoke

Independent A2A Protocol v1.0 server for Worktual Contact Centre.

- Publishes Hub-needed Agent Card skills; Hub sends a skillId to the Contact Centre Super Agent
- Super agent assigns L2 → L3 (NLP MAS) without changing Copilot or Support Bot
- Persists durable tasks in cc-core (`ccass.a2a_*`)
- Triggers proactive webchat popups through existing Chat Service WebSocket delivery

## Endpoints

| Path | Purpose |
|------|---------|
| `GET /health` | Liveness |
| `GET /.well-known/agent-card.json` | Public Agent Card |
| `GET /a2a/agent-card/extended` | Authenticated extended card |
| `GET /internal/v1/agents` | SFT: list NLP agents (internal key) |
| `GET /internal/v1/agents/{id}` | SFT: one agent prompt/tools/skills/samples |
| `GET /internal/v1/agents/export` | SFT: all agent payloads |
| `POST /` | JSON-RPC A2A methods (`message/send`, `tasks/get`, `tasks/list`, `tasks/cancel`) |

SFT catalog contract: [docs/a2a/SFT_AGENT_CATALOG.md](../../docs/a2a/SFT_AGENT_CATALOG.md).

## Run

```bash
# from repo root
npm run sync -w a2a-server
npm run dev -w a2a-server
```

Required env (root `.env`):

```env
A2A_ENABLED=true
A2A_PUBLIC_URL=http://localhost:8020
A2A_OAUTH_ISSUER=
A2A_OAUTH_AUDIENCE=worktual-contact-centre-a2a
A2A_OAUTH_JWKS_URL=
A2A_OAUTH_TOKEN_URL=
CC_CORE_URL=http://localhost:3000
INTERNAL_SERVICE_KEY=dev-internal-key
```

For local development without JWKS, set `A2A_ALLOW_DEV_AUTH=true` and send
`Authorization: Bearer dev` with headers `X-Tenant-Id` and `X-A2A-Client-Id`.

Python package name is `cc_a2a` (avoids colliding with the NLP `app` package).
