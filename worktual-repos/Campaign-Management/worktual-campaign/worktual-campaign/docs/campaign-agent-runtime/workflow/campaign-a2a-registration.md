# Campaign A2A spoke — Hub registration card

Same layout as CRM spoke registration. **This pair is Campaign only.** Other spokes get their own client.

## Hub → Campaign (Hub calls our A2A)

**Production host:** `82.113.92.49` — Hub registers by **IP + :8080** (not DNS).

| Field | Value |
|-------|--------|
| Spoke id (`a2a_server_name`) | `worktual-campaign` |
| Firewall / whitelist IP | `82.113.92.49` |
| A2A base | `http://82.113.92.49:8080/a2a` |
| Agent Card | `http://82.113.92.49:8080/a2a/.well-known/agent-card.json` |
| Token | `http://82.113.92.49:8080/a2a/token` |
| Invoke | `POST http://82.113.92.49:8080/a2a/` |
| Health | `http://82.113.92.49:8080/a2a/health` |
| `client_id` | `worktual-hub-campaign` |
| `client_secret` | Set in server `agents/.env` (`A2A_SPOKE_CLIENT_SECRET`) — share via secure channel only |

Optional: Campaign **outbound** NAT may appear as `82.113.64.2` (`curl -4 -s ifconfig.me` on server) if Hub whitelists source IPs.

DNS (`https://rebuild-campaign.worktual.com/a2a`) is for browser/UI; Hub platform uses IP above unless they agree otherwise.

This pair is **Campaign only**. Do not reuse CRM’s `worktual-hub-crm` / CRM secret.

### Mint access (Hub)

```http
POST http://82.113.92.49:8080/a2a/token
Content-Type: application/json
```

```json
{
  "grant_type": "client_credentials",
  "client_id": "worktual-hub-campaign",
  "client_secret": "<A2A_SPOKE_CLIENT_SECRET from Campaign team>",
  "a2a_server_name": "worktual-campaign"
}
```

Tokens are written to:

```sql
SELECT access_token, refresh_token, access_expires_at
FROM accounts.a2a_spoke_clients
WHERE a2a_server_name = 'worktual-campaign';
```

Requires `ACCOUNT_DATABASE_URL` on the `a2a` service (`token_store: db` on `/health`).

### Invoke

```http
POST http://82.113.92.49:8080/a2a/
Authorization: Bearer <access_token>
```

JSON-RPC `message/send` with `source: "hub"`, `organizationId`, `skillId`.

---

## Campaign → Hub (remainder escalate)

| Field | Value |
|-------|--------|
| Hub Agent Card | `http://82.113.92.49:8030/.well-known/agent-card.json` |
| Hub URL | `http://82.113.92.49:8030` |
| Token URL | `http://82.113.92.49:8030/token` |
| Invoke URL | `POST http://82.113.92.49:8030/` |
| A2A Server Name | `worktual-hub` |
| Client ID | `worktual-campaign-hub` (confirm with Hub) |
| Client Secret | Issued by Hub — set `HUB_A2A_CLIENT_ID` / `HUB_A2A_CLIENT_SECRET` in `agents/.env` |

Configured in agents `.env` as `HUB_A2A_*`. After changing, **recreate `a2a` container**.

Diagnose: `GET http://82.113.92.49:8080/a2a/internal/hub-ping` (on-server: `http://127.0.0.1:8080/a2a/internal/hub-ping`)

---

## Compare with CRM

| | CRM | Campaign |
|--|-----|----------|
| Spoke id | `worktual-crm` | `worktual-campaign` |
| A2A server | `http://192.168.13.159:8020` | `http://82.113.92.49:8080/a2a` |
| Hub→spoke `client_id` | `worktual-hub-crm` | `worktual-hub-campaign` |
| Spoke→Hub `client_id` | `worktual-crm-hub` | `worktual-campaign-hub` |

---

## Seed SQL

See `agents/scripts/sql/accounts_a2a_spoke_clients_campaign.sql`.
