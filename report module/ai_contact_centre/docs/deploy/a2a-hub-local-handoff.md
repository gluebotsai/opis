# Hub handoff — local Contact Centre A2A spoke

Use these values to register/call the Contact Centre A2A spoke from Intelligent Hub on the LAN.

## Endpoints

| Item | Value |
|------|-------|
| Base URL | `http://192.168.13.164:8020` |
| Agent Card | `http://192.168.13.164:8020/.well-known/agent-card.json` |
| Extended Agent Card | `http://192.168.13.164:8020/a2a/agent-card/extended` |
| **OAuth Token URL** | `http://192.168.13.164:8020/oauth/token` |
| OAuth metadata | `http://192.168.13.164:8020/.well-known/oauth-authorization-server` |
| JSON-RPC | `POST http://192.168.13.164:8020/` |
| Health | `http://192.168.13.164:8020/health` |
| Protocol | A2A v1.0 (`preferredTransport`: JSONRPC) |
| Issuer | `http://192.168.13.164:8020` |
| Audience | `worktual-contact-centre-a2a` |

Lab client credentials are in `apps/a2a-server/.hub-lab-credentials` (gitignored).

Hub DB row: `accounts.a2a_spoke_clients` where `a2a_server_name = 'worktual-contact-centre'`
(`client_id = worktual-hub-ccaas`; tokens are stored on that row, not in ccass).

| Field | Value |
|--------|--------|
| `client_id` | `worktual-hub-ccaas` |
| `client_secret` | *(set in root `.env` as `A2A_HUB_CLIENT_SECRET`)* |
| `organization_id` | `1000` |

## Token refresh flow (Hub)

When an A2A call returns `401` / invalid-or-expired token:

1. `POST /oauth/token` with client credentials
2. Spoke issues a new access token and **upserts** it in DB (`ccass.a2a_oauth_tokens`)
3. Hub stores the new `access_token` and retries the A2A request

### Token request

```http
POST http://192.168.13.164:8020/oauth/token
Content-Type: application/x-www-form-urlencoded
```

```
grant_type=client_credentials
&client_id=worktual-hub-ccaas
&client_secret=<from .hub-lab-credentials>
&organization_id=1000
&scope=cc.contact.read cc.queue.read
```

Or JSON:

```json
{
  "grant_type": "client_credentials",
  "client_id": "worktual-hub-ccaas",
  "client_secret": "<from .hub-lab-credentials>",
  "organization_id": "1000"
}
```

### Token response

```json
{
  "access_token": "<jwt>",
  "refresh_token": "<jwt>",
  "token_type": "Bearer",
  "expires_in": 3600,
  "refresh_expires_in": 2592000,
  "scope": "...",
  "organization_id": "1000",
  "skill_version": "1.0.0"
}
```

Hub should persist `access_token`, `access_expires_at`, `refresh_token`, `refresh_expires_at`, and `skill_version` on `accounts.a2a_spoke_clients` for `a2a_server_name='worktual-contact-centre'`.

When access expires, either:

- `grant_type=refresh_token` + `refresh_token=...` + client credentials, or
- `grant_type=client_credentials` again

Then call A2A with:

```http
Authorization: Bearer <access_token>
```

(`X-Tenant-Id` is optional when the JWT already carries `organization_id`.)

## Example `message/send` with access token

```http
POST http://192.168.13.164:8020/
Authorization: Bearer <access_token>
Content-Type: application/json
```

```json
{
  "jsonrpc": "2.0",
  "id": "1",
  "method": "message/send",
  "params": {
    "message": {
      "messageId": "hub-msg-1",
      "role": "user",
      "parts": [
        {
          "kind": "data",
          "data": {
            "commandId": "hub-cmd-0001",
            "skillId": "cc.contact.list",
            "contractVersion": "1.0",
            "organizationId": "1000",
            "arguments": {}
          }
        }
      ]
    }
  }
}
```

## Notes for Hub

- Discover skills from the Agent Card; Phase 1 publishes only currently executable capabilities.
- Worktual envelope must be an `application/json` DataPart.
- High-impact writes require Hub `approval` evidence in the envelope.
- LAN IP may change with DHCP; update `A2A_PUBLIC_URL` / issuer / token URL if it does.

## Outbound CCaaS → Hub (remote agent)

Contact Centre can delegate CCaaS-originated leftover work to Hub via an internal endpoint (not on the Agent Card).

| Item | Value |
|------|-------|
| Hub base URL | `http://192.168.13.26:8030` |
| Hub token URL | `http://192.168.13.26:8030/token` |
| Hub invoke | `POST http://192.168.13.26:8030/` |
| CCaaS delegate endpoint | `POST http://<ccaas-a2a>/internal/v1/hub/delegate` |
| Outbound client id | `worktual-ccaas-hub` |
| Hub server name | `worktual-hub` |

Register on Hub and seed `accounts.a2a_spoke_clients`:

| Field | Value |
|--------|--------|
| `a2a_server_name` | `worktual-hub` |
| `client_id` | `worktual-ccaas-hub` |
| `organization_id` | `1000` |

Set in CCaaS root `.env`:

```env
HUB_A2A_URL=http://192.168.13.26:8030
HUB_A2A_TOKEN_URL=http://192.168.13.26:8030/token
HUB_A2A_CLIENT_ID=worktual-ccaas-hub
HUB_A2A_CLIENT_SECRET=<Hub-issued secret>
HUB_A2A_SPOKE_LABEL=CCaaS
```

CCaaS mints/refreshes Hub tokens and persists them via cc-core `accounts.a2a_spoke_clients`.
Never delegate Hub-originated work back (`source=hub` is rejected).
