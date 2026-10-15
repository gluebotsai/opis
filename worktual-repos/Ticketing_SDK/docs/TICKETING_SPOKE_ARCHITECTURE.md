# Ticketing spoke architecture

Campaign-style standalone microservice: own SPA, API, agents, and `ticketing` schema. Accounts is read-only for identity; CRM/CCaaS host modules that embed or call this spoke.

## Runnables

| Component | Stack | Default port | Health / docs |
|-----------|--------|--------------|---------------|
| **Ticketing API** | Node, Express, TypeScript | **3001** | `GET /health`, `GET /docs` |
| **Ticketing SPA** | React, Vite | **5173** | Proxies `/api` → API in dev |
| **Agent service** | Python, LangGraph | **8012** | `GET /health` |
| **A2A spoke** | Python, FastAPI | **8021** | `GET /health`, `GET /.well-known/agent-card.json` |
| **MCP tools** | Python, FastAPI | **8020** | `GET /health` (when `TOOLS_TRANSPORT=mcp`) |

### Dev modes

```bash
npm run dev:api        # API only :3001
npm run dev:frontend   # SPA :5173 → proxies /api to :3001 (set TICKETING_API_URL=http://127.0.0.1:3001)
npm run dev:agents     # LangGraph :8012
npm run dev:a2a        # Hub-facing A2A spoke :8021
```

Set `TICKETING_API_URL=http://127.0.0.1:3001` in repo `.env` when using split mode.

## Public DNS / Nginx (rebuild)

| Public URL | Nginx path prefix | Upstream | Service | Protocol notes |
|---|---|---|---|---|
| `https://rebuild-ticketing.worktual.com` | `/` | `127.0.0.1:3355` | `web` | SPA—static `ui-frontend/dist` (Docker `Dockerfile.web`) |
| `https://rebuild-ticketing-api.worktual.com/api/*` | `/api/` | `127.0.0.1:4000` | `api` | REST—Express API-only (`TICKETING_API_ONLY=1`) |

**Also on the SPA host** (browser uses relative `/api` + cookie session): proxy `/api/` and `/uploads/` → `127.0.0.1:4000`. Do **not** publish agents (`8012`) publicly.

```bash
npm run dev:api        # :3001
npm run dev:frontend   # :5173
npm run dev:agents     # :8012 (internal)
```

## Ownership

| Ticketing owns | Ticketing does not own |
|----------------|------------------------|
| `ticketing` schema, migrations, SLA/mail workers | Accounts passwords / org provisioning |
| Staff SPA, portal, help widget, embed mode | CRM/CCaaS JWT minting (hosts mint; Ticketing verifies) |
| LangGraph co-worker + proactive agents | Call media / telephony (CCaaS) |
| Intake, org API keys, product `ticketing` entitlements | Campaign/Social credentials |

## Frozen API contract

Existing `/api/*` prefixes are the spoke contract (no `/v1` yet). Stable groups:

- `/api/auth/*` — staff session
- `/api/tickets*`, `/api/queues*`, `/api/customers*`, `/api/kb*`, `/api/macros*`
- `/api/intake/*` — multi-channel intake
- `/api/portal/*` — customer portal
- `/api/coworker/agent-turn` — co-worker turn envelope
- `/api/coworker/conversation-context` — durable agent memory (service actor)
- `/api/proactive/*` — proactive approvals

OpenAPI: `GET /api/openapi.json`, interactive `GET /docs`.

## AI-native boundary

| Layer | Owns |
|-------|------|
| Super Agent (Gemma NLU) | Park / resume / side quest — not writes |
| Specialist LLM + tools | Ask or `tool_call`; semantic confirm |
| LangGraph | Conversation + workflow state |
| Express | RBAC, validation, Postgres writes |
| React | Agent-turn envelope |

Agents call **HTTP tools → Ticketing API**. Durable `conversation_context` persists via API (`/api/coworker/conversation-context`). SLA/mail stay in API workers, not the chat graph.

See also: [architecture-freeze.md](./architecture-freeze.md), [INTEGRATIONS_README.md](./INTEGRATIONS_README.md).

## Auth surfaces

Documented in [TICKETING_AUTH_HANDOFF.md](./TICKETING_AUTH_HANDOFF.md).

## CRM / CCaaS modules

- [CRM_TICKETING_HANDOFF.md](./CRM_TICKETING_HANDOFF.md)
- [CCAAS_TICKETING_HANDOFF.md](./CCAAS_TICKETING_HANDOFF.md)

## Hub A2A (bidirectional)

Ticketing is an A2A **spoke** for Hub delegation and can send **remainders** back to Hub when staff chat has out-of-product leftovers.

| Direction | Process | Port | Client id on peer |
|-----------|---------|------|-------------------|
| Hub → Ticketing | `uvicorn app.a2a_main:app` | **8021** | `worktual-hub-ticketing` (row on `accounts.a2a_spoke_clients`, `a2a_server_name=worktual-ticketing`) |
| Ticketing → Hub | `ask_hub` / `hub_a2a_client.py` | Hub **8030** | `worktual-ticketing-hub` (row on `accounts.a2a_spoke_clients`, `a2a_server_name=worktual-hub`) |

### Hub team checklist (inbound)

1. Set `A2A_PUBLIC_URL` to a Hub-reachable base (e.g. `http://192.168.13.42:8021`).
2. `GET {base}/.well-known/agent-card.json` — expect `id: worktual-ticketing`, `skillVersion`, and the **10 Hub skills** (`tk.super-agent.route`, ticket create/read/list/update, customer verify, customer 360, KB search, inbound capture/deflect). Unpublished Ticketing skills (teams, macros, escalate, WLOA/SEMA, `tk.proactive.run`, …) are not advertised; `message/send` with those `skillId`s returns unknown skill; `GET /a2a/contracts/skills/{skillId}.v1.json` for unpublished ids returns 404. Hub remints the access token when `skillVersion` changes.
3. Seed inbound client: `python scripts/seed_a2a_spoke_client.py` (uses `A2A_SPOKE_CLIENT_SECRET` from `.env`).
4. Hub loads row `a2a_server_name = worktual-ticketing`, `client_id = worktual-hub-ticketing`.
5. `POST {base}/token` with client credentials → Bearer access JWT (signed with Ticketing-only `A2A_HUB_JWT_SECRET`).
6. `POST {base}/` JSON-RPC `message/send` with `source: hub`, `organizationId`, `skillId`, optional `cdpId`, and `instruction`.
7. On JSON-RPC `-32010 skill_version_stale`, re-mint token after card change.
8. Register Ticketing outbound client on Hub: `worktual-ticketing-hub` (for Ticketing → Hub remainders).

Hub-originated invokes use actor `hub:<client_id>` with role `admin`, auto-confirm writes, and never bounce back via `ask_hub`.

Watch Hub traces (CRM-style JSON lines):

```bash
tail -f ai-agents/logs/a2a-$(date +%F).log
```

Each line looks like:

```text
2026-08-28 23:29:12,096 ERROR {"agent": "a2a-spoke", "step": "token", "channel": "a2a", "ok": false, "hub": {...}, "ticketing": {"error": "invalid_request", "message": "a2a_server_name must be worktual-ticketing", "http": 400}}
```

## Outbound events

Audit actions enqueue rows in `ticketing.ticket_event_outbox`. When `TICKETING_WEBHOOK_URL` is set, a background worker POSTs signed webhooks (`X-Worktual-Signature: sha256=…`).

Event types: `ticket.created`, `ticket.assigned`, `ticket.escalated`, `ticket.status_changed`, `ticket.updated`, `ticket.note_added`.

See [ticketing-events.md](./ticketing-events.md).

Production: [TICKETING_PRODUCTION_CHECKLIST.md](./TICKETING_PRODUCTION_CHECKLIST.md).
