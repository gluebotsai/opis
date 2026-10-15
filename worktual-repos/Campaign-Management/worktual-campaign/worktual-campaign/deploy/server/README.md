# Server env templates (`deploy/server/`)

These files are **git templates** for the QA/production host. They are **not** a vault.

- Real **`agents/.env`**, **`backend/.env`**, and root **`.env`** are **gitignored** after copy.
- **`install-env.sh` overwrites** those three files. It backs up existing copies to `*.bak.<timestamp>` first.
- Never commit real **`A2A_SPOKE_CLIENT_SECRET`**, **`A2A_HUB_JWT_SECRET`**, or production **`JWT_SECRET`** here.

## Current Campaign docker host (Hub inbound)

| Item | Value |
|------|--------|
| Public IP (Hub whitelist + A2A URLs) | `82.113.92.49` |
| App + A2A path | `http://82.113.92.49:8080` → nginx **`/a2a/`** |
| Outbound NAT (optional Hub source allowlist) | often `82.113.64.2` — run `curl -4 -s ifconfig.me` on server to confirm |

DNS (`rebuild-campaign.worktual.com`) may still front the UI/API; **Hub registration uses IP** per platform team.

## After `install-env.sh` — required before Hub go-live

1. **`JWT_SECRET`** in `agents/.env` must **match** `backend/.env`.
2. Set **`A2A_SPOKE_CLIENT_SECRET`** (`openssl rand -base64 32`) — share with Hub; upsert `accounts.a2a_spoke_clients` (`agents/scripts/sql/accounts_a2a_spoke_clients_campaign.sql`).
3. Set **`A2A_HUB_JWT_SECRET`** (`openssl rand -base64 48`) — Campaign only, never send to Hub.
4. **`docker compose up -d --force-recreate a2a`**
5. Verify: `curl -sS http://127.0.0.1:8080/a2a/health` → `"token_store": "db"`

See **`docs/CAMPAIGN_HUB_GO_LIVE.md`** and **`docs/campaign-agent-runtime/workflow/campaign-a2a-registration.md`**.
