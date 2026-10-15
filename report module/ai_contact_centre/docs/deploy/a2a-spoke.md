# Contact Centre A2A Spoke

Independent A2A Protocol **v1.0** spoke for Hub CDP/CVM integration.

## Service

| Item | Value |
|------|-------|
| Workspace | `apps/a2a-server` |
| Container | `worktual-a2a` |
| Port | **8020** (NLP remains on **8000**) |
| Agent Card | `GET /.well-known/agent-card.json` |
| Extended Card | `GET /a2a/agent-card/extended` (authenticated) |
| JSON-RPC | `POST /` |

## Feature flags / rollback

| Variable | Purpose |
|----------|---------|
| `A2A_ENABLED` | Master switch (default `false`) |
| `A2A_ENABLED_TENANTS` | Comma-separated org allowlist (empty = all when enabled) |
| `A2A_ENABLED_SKILLS` | Comma-separated skill allowlist |
| `A2A_STREAMING_ENABLED` | Keep `false` until streaming store is proven |

Immediate rollback: set `A2A_ENABLED=false` and restart `a2a-server` only. Copilot and Support Bot paths are unchanged.

## Required environment

```env
A2A_ENABLED=false
A2A_PUBLIC_URL=https://rebuild-ccaas-api.worktual.com/a2a
A2A_OAUTH_ISSUER=
A2A_OAUTH_AUDIENCE=worktual-contact-centre-a2a
A2A_OAUTH_JWKS_URL=
A2A_OAUTH_TOKEN_URL=
A2A_ALLOW_DEV_AUTH=false
CC_CORE_URL=http://cc-core:3000
INTERNAL_SERVICE_KEY=
WEBCHAT_TRIGGER_API_KEY=

# Outbound Hub remote agent (CCaaS → Hub). Distinct from inbound A2A_HUB_CLIENT_*.
HUB_A2A_URL=
HUB_A2A_TOKEN_URL=
HUB_A2A_CLIENT_ID=worktual-ccaas-hub
HUB_A2A_CLIENT_SECRET=
HUB_A2A_SPOKE_LABEL=CCaaS
HUB_A2A_SERVER_NAME=worktual-hub
HUB_A2A_TIMEOUT_SECONDS=120
```

Inbound Hub→CCaaS auth uses `A2A_HUB_CLIENT_ID` / `A2A_HUB_CLIENT_SECRET` (or JWKS in prod).
Outbound CCaaS→Hub uses the dedicated `HUB_A2A_*` client (`worktual-ccaas-hub`).
Hub tokens are stored on `accounts.a2a_spoke_clients` (`a2a_server_name=worktual-hub`) via cc-core internal APIs.

## Outbound Hub delegation (internal only)

Protected endpoint (not on Agent Card):

`POST /internal/v1/hub/delegate` with `x-internal-service-key` and `x-tenant-id`.

```json
{
  "organizationId": "1000",
  "query": "Suggest the next best cross-product action.",
  "channel": "chat",
  "cdpId": "42",
  "commandId": "ccaas-hub-cmd-0001",
  "hopCount": 0
}
```

Rules:
- Only CCaaS-originated requests (`source` must not be `hub`)
- Never bounce Hub-delegated work back to Hub
- Hub receives `metadata.source=ccaas`, `spoke=CCaaS`, and no Hub `skillId`

## Nginx / DNS

Add pass-through on the API host:

| Public path | Upstream |
|-------------|----------|
| `/a2a/` | `127.0.0.1:8020/` |

Recommended Agent Card URL for Hub registration:

`https://rebuild-ccaas-api.worktual.com/a2a/.well-known/agent-card.json`

Health: `GET https://rebuild-ccaas-api.worktual.com/a2a/health`

## Database

Migration: `packages/db-cc/prisma/migrations/a2a_spoke_tasks_v1.sql`

Tables: `ccass.a2a_tasks`, `ccass.a2a_task_events`, `ccass.a2a_artifacts`, `accounts.a2a_spoke_clients`

Run: `npm run db:migrate`

## Staged rollout

1. Shadow / disabled (`A2A_ENABLED=false`) — deploy container only
2. Read-only skills for one tenant
3. Proactive webchat + reversible writes
4. Approved high-impact operations (`cc.queue.delete`, force logout, presence)

Gate every stage with `A2A_ENABLED_TENANTS` and `A2A_ENABLED_SKILLS`.

## Observability

Structured audit logs include task id, commandId, tenant, skill, specialist, and outcome.
Never log bearer tokens, raw prompts, or unnecessary PII (webchat personalized text is redacted).
