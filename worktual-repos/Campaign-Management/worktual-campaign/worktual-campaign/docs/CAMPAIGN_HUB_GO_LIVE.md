# Campaign Hub A2A — go live (Docker)

Checklist to expose the Campaign spoke to **Worktual Hub** on the docker host **`82.113.92.49`**.

## What Hub calls (IP registration)

| Purpose | URL |
|---------|-----|
| Agent card | `http://82.113.92.49:8080/a2a/.well-known/agent-card.json` |
| OAuth token | `http://82.113.92.49:8080/a2a/token` |
| JSON-RPC invoke | `http://82.113.92.49:8080/a2a/` (`message/send`) |
| Health | `http://82.113.92.49:8080/a2a/health` |

Browser/UI may still use `https://rebuild-campaign.worktual.com`; Hub platform uses IP above unless agreed otherwise.

Spoke id: **`worktual-campaign`**. Skill list: see [CAMPAIGN_HUB_A2A_AGENT_CARD.md](./CAMPAIGN_HUB_A2A_AGENT_CARD.md).

Hub does **not** register against `:3001` REST or `:8005` chat socket.

---

## 1. Deploy stack (includes `a2a` service)

From repo root (`worktual-campaign/`):

```bash
cp deploy/docker.env.example .env
cp deploy/agents.env.example agents/.env   # or ./deploy/server/install-env.sh on 82.113.92.49
# Edit agents/.env — see section 2
docker compose build web backend agents a2a
docker compose up -d
```

Compose runs:

- **`a2a`** — uvicorn `app.a2a_main:app` on **8040** (internal)
- **`web`** — nginx proxies **`/a2a/`** → `a2a:8040`

---

## 2. Required `agents/.env` (A2A block)

| Variable | Production value |
|----------|------------------|
| `A2A_PUBLIC_URL` | `http://82.113.92.49:8080/a2a` (Hub IP registration; no trailing slash) |
| `A2A_SERVER_NAME` | `worktual-campaign` |
| `A2A_SPOKE_CLIENT_ID` / `A2A_SPOKE_CLIENT_SECRET` | Give **client_id + secret** to Hub team (secure channel) |
| `A2A_HUB_JWT_SECRET` | Strong secret; **never** send to Hub |
| `JWT_SECRET` | **Same as** `backend/.env` |
| `ACCOUNT_DATABASE_URL` | **Same as** backend (DB token rows + mint Campaign JWT per org) |
| `CAMPAIGN_API_BASE` | `http://backend:3001/api` (Docker) |
| `MAS_ENABLED_DOMAINS` | `all` (recommended) |
| `GEMINI_API_KEY` | If using `generate-image` skill |

Optional: `HUB_A2A_*` only if Campaign **escalates** to Hub.

Seed DB row (once): `agents/scripts/sql/accounts_a2a_spoke_clients_campaign.sql`.

---

## 3. Verify before handing to Hub

```bash
BASE=http://82.113.92.49:8080/a2a

curl -sS "$BASE/health" | jq .
curl -sS "$BASE/.well-known/agent-card.json" | jq '.id, .skillVersion, (.skills | length)'

# Token (use your real client secret)
curl -sS "$BASE/token" -H 'Content-Type: application/json' -d '{
  "grant_type": "client_credentials",
  "client_id": "worktual-hub-campaign",
  "client_secret": "<A2A_SPOKE_CLIENT_SECRET>",
  "a2a_server_name": "worktual-campaign"
}' | jq .
```

`/health` should show `"token_store": "db"` when `ACCOUNT_DATABASE_URL` is set.

---

## 4. Packet for Hub platform team

Send:

1. **Whitelist IP**: `82.113.92.49`
2. **Agent card URL**: `http://82.113.92.49:8080/a2a/.well-known/agent-card.json`
3. **Spoke id**: `worktual-campaign`
4. **OAuth**: `client_id` + `client_secret` for Hub → Campaign
5. **Doc**: [CAMPAIGN_HUB_A2A_AGENT_CARD.md](./CAMPAIGN_HUB_A2A_AGENT_CARD.md)
6. After each Campaign release that adds/removes skills: **re-fetch card** (`skillVersion` changes)

---

## 5. TLS / edge nginx

Hub platform registers **`http://82.113.92.49:8080/a2a`** — set `A2A_PUBLIC_URL` to match so the agent card `url` / `tokenUrl` align.

Direct host port **8040** is bound to `127.0.0.1` only; Hub uses **8080** + path **`/a2a/`** via nginx.

---

## Local dev (no Docker)

```bash
cd agents
PYTHONPATH=. .venv/bin/python -m uvicorn app.a2a_main:app --host 0.0.0.0 --port 8040
```

Set `A2A_PUBLIC_URL` to a LAN IP Hub can reach (see `docs/campaign-agent-runtime/workflow/campaign-a2a-registration.md`).
