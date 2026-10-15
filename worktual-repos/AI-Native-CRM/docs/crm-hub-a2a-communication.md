# CRM ↔ Hub A2A communication

Worktual CRM is an **A2A spoke** (`worktual-crm`). Hub is a **separate server** (not this repo). They talk over JSON-RPC `message/send` with Bearer access tokens stored on the shared table `accounts.a2a_spoke_clients`.

Build / env / skill catalog: [`a2a-spoke.md`](./a2a-spoke.md). Combine contracts: [`worktual-combine-contracts.md`](./worktual-combine-contracts.md).

## Who does what

| | Hub | CRM |
|---|---|---|
| Role | Plans leftover / cross-product work; picks a CRM **skill** when CRM must act | Executes CRM skills; sends leftover **queries** to Hub |
| Skills | Hub owns its own catalog. CRM does **not** fetch Hub skills | Hub learns CRM skills from `GET {A2A_PUBLIC_URL}/.well-known/agent-card.json` |
| Person key | `cdp_id` / `cdpId` = `cdp.customer_profile.cdp_id` | Same |
| Org | Always `organization_id` / `organizationId` | Never infer org |
| Questions | Hub will not answer clarifying questions | CRM executes Hub instructions in one shot |

**No ping-pong:** if Hub sent the work (`source=hub` / delegated), CRM never escalates that turn back to Hub.

```text
                    accounts.a2a_spoke_clients
                 ┌─────────────────────────────┐
                 │ worktual-crm  (Hub → CRM)   │
                 │ worktual-hub  (CRM → Hub)   │
                 └─────────────────────────────┘
                              ▲
         Hub :8030            │            CRM A2A :8020
    ┌─────────────────┐       │       ┌──────────────────┐
    │  plan / leftover│───────┼──────▶│  agent card       │
    │  dispatch skill │ Bearer│Bearer │  /token + invoke  │
    │                 │◀──────┼───────│  remainder query  │
    └─────────────────┘       │       └──────────────────┘
```

LAN example: Hub `http://192.168.13.112:8030`, CRM `http://192.168.13.159:8020`.

---

## Shared tokens

Two rows, two directions. Unique on `a2a_server_name` and `client_id`.

| Direction | `a2a_server_name` | `client_id` | Who mints | Who uses access |
|---|---|---|---|---|
| Hub → CRM | `worktual-crm` | `worktual-hub-crm` (`A2A_SPOKE_CLIENT_ID`) | CRM `POST :8020/token` | Hub `SELECT` then `POST` CRM `/` |
| CRM → Hub | `worktual-hub` | `worktual-crm-hub` (`HUB_A2A_CLIENT_ID`) | Hub `POST :8030/token`; CRM `UPDATE`s the row | CRM `SELECT` then `POST` Hub `/` |

Access ~6 hours, refresh ~60 days. Do **not** share `A2A_HUB_JWT_SECRET` with Hub. Hub authenticates CRM `/token` with client id/secret; CRM signs the access JWT.

---

## How Hub communicates with us

Hub already has CDP and the DB. It does **not** call CRM as a get/list/analytics API. It only delegates **actions**.

### 1. Discover CRM skills

```http
GET {A2A_PUBLIC_URL}/.well-known/agent-card.json
```

No auth. Card `id` is `worktual-crm`. Use `url`, `tokenUrl`, `skillVersion`, `skills[].id`, `skills[].description`, `skills[].examples`, and `skills[].requiredArgumentKeys` (Hub keys: `organizationId`, `cdpId` for person work, plus skill-specific ids). `crm-agent` is the runtime, not a skill.

### 2. Mint or reuse CRM access

```text
SELECT access_token FROM accounts.a2a_spoke_clients
WHERE a2a_server_name = 'worktual-crm'
```

If missing or expired:

```http
POST {card.tokenUrl}     # CRM :8020/token
```

```json
{
  "grant_type": "client_credentials",
  "client_id": "<A2A_SPOKE_CLIENT_ID>",
  "client_secret": "<A2A_SPOKE_CLIENT_SECRET>",
  "a2a_server_name": "worktual-crm"
}
```

CRM writes access + refresh on that same row. On `-32010 skill_version_stale`, mint again (do not patch the JWT).

### 3. Invoke a CRM skill

```http
POST {card.url}/
Authorization: Bearer <access>
```

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
            "organizationId": "1000",
            "skillId": "score-lead",
            "cdpId": "42"
          }
        }
      ]
    }
  }
}
```

Always send `source: "hub"`, `organizationId`, `skillId`, and `cdpId` when the work is about a person.

Coworker mutations (log activity, create deal, send mail) put the command in `instruction`:

```json
{
  "source": "hub",
  "organizationId": "1000",
  "skillId": "activities",
  "cdpId": "42",
  "instruction": {
    "actionType": "notify",
    "description": "Lead score increased from 41 to 82."
  }
}
```

CRM actor is `hub:<client>` with role `admin`. High-risk MCP tools auto-confirm on this path (Vite Confirm stays for humans). CRM returns a receipt in artifacts. It does **not** ask Hub a follow-up question.

### What CRM does with that

`dispatch_skill(skillId)`:

- Named agents — `score-lead`, `enrich-lead`, `compose-email`, …
- Coworker — `contact-crud`, `activities`, `deals`, …
- If Hub’s instruction implies send after compose, the spoke supervisor may chain `compose-email` → `send-outbound-email`

Logs (`ai-service/logs/a2a-YYYY-MM-DD.log`): `hub_instruct` → `dispatch` → `complete` → `crm_respond` (join by `traceId`). `crm_respond` is the JSON-RPC task CRM returned to Hub.

---

## How we communicate with Hub

CRM does **not** load Hub’s agent card or send a Hub `skillId`. Hub already knows CRM’s skills. Remainder is the **query** plus tenant keys.

### When CRM sends

- CRM-originated leftover that CRM does not own (campaign / marketing / CCaaS / service / CVM), or a CRM-capable ask where we still want Hub’s plan/suggestion.
- **Never** when `source=hub` / delegated (that would bounce).

### 1. Mint or reuse Hub access

```text
SELECT access_token FROM accounts.a2a_spoke_clients
WHERE a2a_server_name = 'worktual-hub'
```

If missing or expired, CRM `POST`s Hub `/token` as `worktual-crm-hub` and `UPDATE`s that row.

### 2. Send the query

```http
POST {HUB_A2A_URL}/
Authorization: Bearer <Hub access>
```

`parts[0].data` (this is the remainder body):

```json
{
  "cdp_id": "42",
  "spoke": "CRM",
  "recent_event": {
    "channel": "chat",
    "query": "This CRM contact has a stale proposal. Suggest the next best action only."
  },
  "organization_id": 1000
}
```

| Field | Meaning |
|---|---|
| `cdp_id` | `cdp.customer_profile.cdp_id` (text) |
| `spoke` | This product (`HUB_A2A_SPOKE_LABEL`, default `CRM`) |
| `recent_event.channel` | `chat` (coworker), `email` (inbox) |
| `recent_event.query` | The leftover / suggestion query only |
| `organization_id` | Integer org id |

A2A message `metadata` is `{ "source": "crm" }` so Hub must not bounce this back as a Hub follow-up.

Logs: `crm_instruct` (what we sent) → `hub_reply` (what Hub returned). Invoke timeout is `HUB_A2A_TIMEOUT_SECONDS` (default 300s, clamp 60–900). A read/write timeout is **pending**, not failure — Hub often dispatches a CRM skill after our wait. A Hub task `state` of `failed` is reported as failure, not “Hub finished”.

### What Hub may do next

Hub plans. If the next step is CRM work, Hub calls **us** with `source=hub` and a CRM `skillId` (same as “How Hub communicates with us”). CRM executes and does not escalate again.

Example from a live remainder (stale proposal on `cdpId=42`):

1. CRM → Hub: remainder query, no Hub skill id.
2. Hub → CRM: `skillId=compose-email`, `actionType=send_email`, instruction to follow up on the pending proposal, then log the activity.
3. CRM completed `compose-email` and returned a receipt.

---

## Watch logs

```bash
# From repo root
tail -f ai-service/logs/a2a-$(date +%F).log
# From ai-service/
tail -f logs/a2a-$(date +%F).log

# Every HTTP request + response (both directions)
grep -E 'http_in|http_out' logs/a2a-$(date +%F).log
```

| Step | Direction | Meaning |
|---|---|---|
| `http_in` | Hub → CRM | Full HTTP request Hub sent us + HTTP response we returned |
| `http_out` | CRM → Hub | Full HTTP request we sent Hub + HTTP response Hub returned |
| `hub_instruct` | Hub → CRM | Parsed skill instruction |
| `crm_respond` | Hub → CRM | Parsed JSON-RPC task we returned |
| `dispatch` / `complete` | Hub → CRM | What CRM ran / receipt |
| `crm_instruct` | CRM → Hub | Remainder body we posted |
| `hub_reply` | CRM → Hub | Parsed Hub task state / error |
| `crm_reply` | CRM → Hub | Speech coworker would show (if escalate ran) |

Secrets (`access_token`, `client_secret`, …) are redacted.
