# Campaign ↔ Hub A2A

Campaign is an **A2A spoke** (`worktual-campaign`), not the Hub. Hub plans;
Campaign executes skills via the Super Agent (on-demand, contacts, monitoring).

Reference pattern: CRM spoke (`crm-hub-a2a-communication.md` / `a2a-spoke.md`).

## Ports

| Process | Default |
|---------|---------|
| Campaign chat agents (Socket.IO) | `:8005` |
| **Campaign A2A spoke** | `:8040` |
| Hub A2A | `http://192.168.13.112:8030` |

```bash
cd worktual-campaign/worktual-campaign/agents
PYTHONPATH=. .venv/bin/python -m uvicorn app.a2a_main:app --host 0.0.0.0 --port 8040
```

Set `A2A_PUBLIC_URL` to a Hub-reachable URL (LAN IP), e.g. `http://192.168.11.31:8040`.

## Endpoints

| URL | Auth | Purpose |
|-----|------|---------|
| `GET /health` | none | Liveness |
| `GET /.well-known/agent-card.json` | none | Skills + `tokenUrl` |
| `POST /token` | client id/secret JSON | Mint access JWT for Hub |
| `POST /` JSON-RPC | Bearer access | `message/send` → Super Agent |
| `POST /internal/escalate-hub` | internal | Campaign → Hub remainder |

## Tokens (two directions)

| Direction | `a2a_server_name` | `client_id` | Who mints |
|-----------|-------------------|-------------|-----------|
| Hub → Campaign | `worktual-campaign` | `worktual-hub-campaign` | Campaign `POST :8040/token` |
| Campaign → Hub | `worktual-hub` | `worktual-campaign-hub` | Hub `POST :8030/token` |

Set **`ACCOUNT_DATABASE_URL`** (same as campaign backend) so `/token` **UPSERT**s
`access_token` + `refresh_token` into `accounts.a2a_spoke_clients`.  
`GET /health` shows `"token_store": "db"` when configured.

```sql
SELECT access_token FROM accounts.a2a_spoke_clients
WHERE a2a_server_name = 'worktual-campaign';   -- Hub reads this

SELECT access_token FROM accounts.a2a_spoke_clients
WHERE a2a_server_name = 'worktual-hub';         -- Campaign reads this
```

Seed helper: `agents/scripts/sql/accounts_a2a_spoke_clients_campaign.sql`

## Hub → Campaign invoke

1. `GET {A2A_PUBLIC_URL}/.well-known/agent-card.json`
2. Mint/reuse access via `POST {tokenUrl}` with `worktual-hub-campaign` credentials
3. `POST {card.url}/` with Bearer access:

```json
{
  "jsonrpc": "2.0",
  "id": "1",
  "method": "message/send",
  "params": {
    "message": {
      "role": "user",
      "messageId": "<uuid>",
      "parts": [
        {
          "kind": "data",
          "data": {
            "source": "hub",
            "organizationId": "1001",
            "skillId": "on-demand-send",
            "cdpId": "bbbbbbbb-cccc-4ddd-8eee-ffff00000001",
            "request_text": "Email this contact about the CRM product",
            "channels": ["email"],
            "campaignToken": "<campaign-api-jwt>"
          }
        }
      ]
    }
  }
}
```

Always send `source: "hub"`, `organizationId`, `skillId`. Person key is `cdpId` when person-scoped.

For `on-demand-send`, send **`request_text`** (operator brief). **`instruction`** is an optional alias (same content). JSON schema does not require either, but email sends need **`emails`** / **`email`** (and usually `cdpId`).

`campaignToken` is **optional**. When omitted, Campaign A2A mints a short-lived Campaign SPA JWT for that `organizationId` using `JWT_SECRET` + `ACCOUNT_DATABASE_URL` (must match the Campaign backend). You may still set `A2A_CAMPAIGN_API_TOKEN` as a static override, or pass `campaignToken` explicitly.

Hub will not get clarifying questions.

### Skills

| skillId | Super Agent pipeline |
|---------|----------------------|
| `on-demand-send` | on_demand |
| `create-contact` | contacts |
| `campaign-report` | monitoring (report) |
| `stop-channel` | monitoring (stop channel) |
| `resume-channel` | monitoring (resume) |
| `stop-campaign` | monitoring (stop campaign) |
| `create-contact-and-send` | contacts → on_demand |

On `-32010 skill_version_stale`, Hub must call `/token` again, then retry.

## Campaign → Hub (remainder)

Never when `source=hub`. Format:

```json
{
  "cdp_id": "bbbbbbbb-cccc-4ddd-8eee-ffff00000001",
  "spoke": "Campaign",
  "recent_event": {
    "channel": "chat",
    "query": "I was charged twice this month and I want that fixed now."
  },
  "organization_id": 1000
}
```

```http
POST http://192.168.13.112:8030/
Authorization: Bearer <Hub access for worktual-campaign-hub>
```

Use `POST /internal/escalate-hub` or `send_remainder_to_hub(...)` from Python.

## Env

See `agents/.env.example` (`A2A_*`, `HUB_A2A_*`, `ACCOUNT_DATABASE_URL`).

## Code map

| Path | Role |
|------|------|
| `app/a2a_main.py` | uvicorn entry |
| `app/a2a/server.py` | card, token, JSON-RPC |
| `app/a2a/card.py` / `catalog.py` | Agent card skills |
| `app/a2a/dispatch.py` | skill → `hub_super.run_hub_task` |
| `app/a2a/escalate.py` | Campaign → Hub remainder |
| `app/hub_super/` | Super Agent + 3 sub-agents |
