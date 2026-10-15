# CRM A2A spoke — how it was built and how Hub connects

Worktual CRM is an **A2A spoke**, not a Hub. Hub (a separate server, not this repo) delegates **actions**. CRM runs the work on existing Python agents and returns a receipt. Vite → Fastify → coworker chat is unchanged.

Two-way request/response shapes: [`crm-hub-a2a-communication.md`](./crm-hub-a2a-communication.md). Contract summary: [`worktual-combine-contracts.md`](./worktual-combine-contracts.md). Process layout: [`agent-runtime-deployment.md`](./agent-runtime-deployment.md).

## What we decided

| Rule | Why |
|---|---|
| CRM is a spoke (`id`: `worktual-crm`) | Hub plans; CRM executes CRM work |
| Actions only — no get/list/analytics skills | Hub already has CDP + shared DB |
| Reuse `crm-agent` + named agents | No second planner or parallel agent stack |
| Hub is the actor (`actorId=hub:<client>`, role `admin`) | Hub-originated work is authorized |
| Always send `organizationId` | Multi-tenant; never infer org |
| Person key is **`cdpId`** | `crm.contact_profiles.account_contact_id` / `cdp.customer_profile.cdp_id` |
| Hub will not reply to questions | CRM must execute in one shot |
| Hub multi-step goals | CRM spoke **supervisor** reads the Hub **instruction** (authoritative over optional `skillId` hint), plans which agents to run, executes the chain, then may add follow-ups from the latest result (LLM, capped). Deterministic shortcut: send-email intent → `compose-email` → `send-outbound-email`. |
| High-risk MCP tools auto-confirm on Hub path | Vite Confirm chip stays for humans |
| If `source=hub`, never bounce work back to Hub | No ping-pong |
| Different `client_id` / `client_secret` per spoke | Marketing/service must not reuse CRM credentials |
| Do **not** share `A2A_HUB_JWT_SECRET` with Hub | Hub authenticates `/token` with client id/secret; CRM signs access JWTs |

CRM does **not** implement the Hub server.

## How the pieces connect

```text
Hub (other server)
  │
  │  1. GET  {A2A_PUBLIC_URL}/.well-known/agent-card.json     (no auth)
  │  2. SELECT access_token FROM accounts.a2a_spoke_clients
  │     WHERE a2a_server_name = 'worktual-crm'
  │  3. if missing/expired → POST {tokenUrl}  /token          (client id/secret)
  │  4. POST {card.url}/  JSON-RPC message/send               (Bearer access JWT)
  ▼
CRM A2A spoke   uvicorn app.a2a_main:app   :8020
  │  flatten payload → dispatch_skill
  │    supervisor:
  │      1) plan agents from Hub instruction (skillId is optional hint)
  │      2) if send-email intent → compose-email → send-outbound-email
  │      3) execute plan; LLM decide-next (0–2 follow-ups) when goal still open
  ▼
Existing CRM agents (LLM) + MCP tools → Fastify commands → crm.*
  │
  └── receipt in JSON-RPC artifacts  (Hub does not get a clarifying question)
```

Coworker Inbox compose, HTTP `/ai/v1/agents/*/run`, nurture, and auto-reply are **unchanged** — the supervisor runs only on Hub A2A `dispatch_skill`.

**CRM → Hub (remainder only, never follow-ups):** if a **CRM-originated** turn is leftover work CRM does not own (campaign / CCaaS / service / CVM), CRM `POST`s Hub with the **query only**. Hub already has the CRM card; CRM does **not** fetch Hub skills or send a Hub `skillId`. Hub-originated tasks (`source=hub`) never take this path.

```text
CRM
  │  1. SELECT access_token FROM accounts.a2a_spoke_clients
  │     WHERE a2a_server_name = 'worktual-hub'
  │  2. if missing/expired → POST {HUB_A2A_TOKEN_URL}  (client_id worktual-crm-hub)
  │     CRM UPDATEs access + refresh on that row
  │  3. POST {HUB_A2A_URL}/  JSON-RPC message/send     (Bearer Hub access)
  ▼
Hub   :8030
```

Remainder `parts[0].data`:

```json
{
  "cdp_id": "<cdp.customer_profile.cdp_id>",
  "spoke": "CRM",
  "recent_event": {
    "channel": "chat",
    "query": "<leftover user query>"
  },
  "organization_id": 1000
}
```

`channel` is `chat` for coworker, `email` for inbox leftover. `spoke` is this product (`HUB_A2A_SPOKE_LABEL`, default `CRM`).

## Process and ports

A2A is its own Python process, next to orchestrator (`:8000`) and MCP (`:8010`):

```bash
cd ai-service
PYTHONPATH=. .venv/bin/python -m uvicorn app.a2a_main:app --host 0.0.0.0 --port 8020
```

| URL | Auth | Purpose |
|---|---|---|
| `GET /health` | none | Liveness |
| `GET /.well-known/agent-card.json` | none | **Public Agent Card** — skills, `inputSchema` / `outputSchema`, `tokenUrl`, typed-skills capability |
| `GET /.well-known/oauth-authorization-server` | none | OAuth metadata (`token_endpoint` = `{url}/token`) |
| `GET /a2a/contracts/worktual-envelope.v1.json` | none | Hub request envelope JSON Schema |
| `GET /a2a/contracts/skill-result.v1.json` | none | Skill result artifact JSON Schema |
| `GET /a2a/contracts/skills/{skillId}.v1.json` | none | Per-skill argument JSON Schema |
| `GET /a2a/agent-card/extended` | Bearer | **Extended Agent Card** (per-skill specialist/risk/MCP metadata) |
| `GET /internal/v1/agents` | Bearer (spoke access or Hub JWT) | SFT catalog list (summaries). See [`sft-agent-catalog.md`](./sft-agent-catalog.md) |
| `GET /internal/v1/agents/export` | Bearer | SFT catalog export (full prompts + tools) |
| `GET /internal/v1/agents/{id}` | Bearer | One SFT agent payload |
| `POST /token` (alias `POST /oauth/token`) | client id + secret in JSON body | Mint or refresh access JWT |
| `POST /` JSON-RPC | `Authorization: Bearer <access>` | `message/send`, `tasks/get`, `tasks/cancel`, `agent/getAuthenticatedExtendedCard` |

`A2A_PUBLIC_URL` is what Hub must be able to hit (LAN IP, Docker service name, or public host). **Not** `127.0.0.1` if Hub is on another machine. Example LAN:

```text
A2A_PUBLIC_URL=http://192.168.13.159:8020
```

Docker Compose service: `ai-a2a` in `deploy/docker-compose.yml` (`uvicorn app.a2a_main:app --port 8020`).

## Auth and tokens

### Table Hub and CRM share

Approved one-time `accounts` DDL (CRM does not own other `accounts.*` schema):

- Migration: `prisma/migrations/20260827180000_a2a_spoke_clients/`
- Split-DB copy: `scripts/sql/accounts_a2a_spoke_clients.sql`

`accounts.a2a_spoke_clients` — **one row per spoke**. Unique on `a2a_server_name` and on `client_id`.

| Row | `a2a_server_name` | Who mints | Who reads access |
|---|---|---|---|
| Hub → CRM | `worktual-crm` | CRM `POST :8020/token` | Hub `SELECT` |
| CRM → Hub | `worktual-hub` | Hub `POST :8030/token` (CRM stores the result) | CRM `SELECT` then invoke Hub |

CRM spoke client: `A2A_SPOKE_CLIENT_ID` / `A2A_SPOKE_CLIENT_SECRET`. Hub peer client: `HUB_A2A_CLIENT_ID` / `HUB_A2A_CLIENT_SECRET`. Tests fall back to in-memory clients when `ACCOUNT_DATABASE_URL` is empty.

### Token lifetimes

| Token | TTL | Notes |
|---|---|---|
| Access JWT | 6 hours (`21600`) | Snapshot: `skills`, `skillVersion`, `a2a_server_name`. Cannot be patched. |
| Refresh | ~60 days (`5184000`) | Opaque; stored on the same row |

Mint:

```json
{
  "grant_type": "client_credentials",
  "client_id": "<crm-client-id>",
  "client_secret": "<crm-client-secret>",
  "a2a_server_name": "worktual-crm"
}
```

Refresh (same `POST /token`; CRM replaces **both** tokens on that row):

```json
{
  "grant_type": "refresh_token",
  "client_id": "<crm-client-id>",
  "client_secret": "<crm-client-secret>",
  "refresh_token": "<current refresh>",
  "a2a_server_name": "worktual-crm"
}
```

If Hub’s access JWT `skillVersion` is older than the live card, invoke returns JSON-RPC **`-32010 skill_version_stale`**. Hub must call `/token` again, then retry. Do not edit the JWT.

Access JWT is signed with **`A2A_HUB_JWT_SECRET`** (CRM-only). Audience `worktual-crm-a2a`, issuer `worktual-crm-a2a-access`.

## Hub invoke

Always send `organizationId`, `source: "hub"`, and a Hub **instruction** (string or object with `description` / `actionType`). Person key is **`cdpId`**. Send `skillId` as an optional hint when Hub already picked a card skill; the CRM supervisor may override it when the instruction implies different agents. Add CRM ids only when the skill needs them (`dealId`, `quoteId`, `invoiceId`, `activityId`, …).

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
            "organizationId": "<accounts.organizations.id>",
            "skillId": "score-lead",
            "cdpId": "<cdp.customer_profile.cdp_id>"
          }
        }
      ]
    }
  }
}
```

Coworker skills (log activity, create deal, …) should put the work in `instruction` (string or object with `description` / `actionType`). Hub will **not** get a second turn to clarify. Before validation, CRM **hydrates** missing typed fields from DB when unambiguous (email → `contactId`, contact → `companyId`, deal title in instruction → `dealId`, description → `instruction`/`body`). Returns `input-required` only when hydration cannot fill a required field.

Example Hub activity notify:

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

`actionType: notify` is logged as activity type **note**.

## Dispatch (what CRM does with a skill)

Live card skills are projected from existing registries in `ai-service/app/a2a/catalog.py`:

- **Named / job agents** — `score-lead`, `enrich-lead`, `summarize-lead`, `nurture-lead`, meeting agents, … Bound to the Python `REGISTRY` kwargs (`contact_id` from `cdpId`, `organization_id`, …).
- **Coworker skills** — `contact-crud`, `company-crud`, `deals`, `activities`, `meetings`, `quotes`, `invoices`, `proposals`. Routed to `crm-agent` with `source=hub`, `hubExecute=true`.

Excluded from Hub: `hello`, `chat`, and read-style coworker skills (`reports`, `nurture`, `scoring`, `lifecycle` as coworker modules).

Task receipts are stored on **`crm.a2a_spoke_tasks`** (`prisma/migrations/20260827120000_a2a_spoke_tasks/`).

## Env (CRM spoke)

See `ai-service/.env.example` and `deploy/.env.example`.

| Variable | Role |
|---|---|
| `A2A_PUBLIC_URL` | Advertised card `url` and `tokenUrl` (must be Hub-reachable) |
| `A2A_SERVER_NAME` | Spoke id, default `worktual-crm` |
| `A2A_SPOKE_CLIENT_ID` / `A2A_SPOKE_CLIENT_SECRET` | This spoke’s Hub client (seeded on `accounts.a2a_spoke_clients`) |
| `A2A_HUB_JWT_SECRET` | Signs CRM access JWTs — **not** shared with Hub |
| `A2A_HUB_JWT_AUDIENCE` | `worktual-crm-a2a` |
| `A2A_ACCESS_TOKEN_ISSUER` | `worktual-crm-a2a-access` |
| `A2A_ACCESS_TOKEN_TTL_SECONDS` | `21600` |
| `A2A_REFRESH_TOKEN_TTL_SECONDS` | `5184000` |
| `HUB_A2A_URL` | Hub invoke base (remainder escalate only; empty = off) |
| `HUB_A2A_TOKEN_URL` | Hub `POST /token` (default `{HUB_A2A_URL}/token`) |
| `HUB_A2A_SERVER_NAME` | Hub row on `accounts.a2a_spoke_clients` (`worktual-hub`) |
| `HUB_A2A_CLIENT_ID` / `HUB_A2A_CLIENT_SECRET` | CRM’s client on Hub; tokens stored on that same row |
| `HUB_A2A_SPOKE_LABEL` | Remainder `spoke` field (default `CRM`) |
| `HUB_A2A_TIMEOUT_SECONDS` | Hub invoke wait (default `300`, clamp 60–900) |
| `ACCOUNT_DATABASE_URL` | Shared DB for `accounts.a2a_spoke_clients` |

## Code map

| Path | Role |
|---|---|
| `ai-service/app/a2a_main.py` | ASGI entry |
| `ai-service/app/a2a/server.py` | Card, `/token`, JSON-RPC |
| `ai-service/app/a2a/card.py` | Agent Card JSON |
| `ai-service/app/a2a/catalog.py` | Hub-facing skills from CRM registries |
| `ai-service/app/a2a/access_token.py` | Mint / refresh JWTs |
| `ai-service/app/a2a/clients.py` | `accounts.a2a_spoke_clients` + test memory |
| `ai-service/app/a2a/auth.py` | Bearer access JWT on invoke |
| `ai-service/app/a2a/payload.py` | Flatten Hub parts; `cdpId` → `contact_id`; execute-now text |
| `ai-service/app/a2a/dispatch.py` | skill → named agent or `crm-agent`; auto-confirm |
| `ai-service/app/a2a/escalate.py` | Leftover work to Hub; skip when `source=hub` |
| `ai-service/app/a2a/mcp_token.py` | Hub MCP execution JWT |
| `ai-service/app/a2a/store.py` | `crm.a2a_spoke_tasks` |
| `ai-service/app/a2a/log.py` | Day-wise Hub traces |
| `ai-service/tests/test_a2a_spoke.py` | Card, token, dispatch, Hub execute-now |

Logs: `ai-service/logs/a2a-YYYY-MM-DD.log` (one file, both directions). `http_in` is Hub → CRM HTTP request + our HTTP response. `http_out` is CRM → Hub HTTP request + Hub’s HTTP response. Skill traces: `hub_instruct` / `crm_respond` / `complete`. Remainder: `crm_instruct` / `hub_reply`. Secrets redacted.

Watch from `ai-service/`: `tail -f logs/a2a-$(date +%F).log`  
HTTP both ways: `grep -E 'http_in|http_out' logs/a2a-$(date +%F).log`

## Hub checklist (other server)

1. Resolve CRM A2A base URL (`A2A_PUBLIC_URL`).
2. `GET {base}/.well-known/agent-card.json` — `id` (`worktual-crm`), `url`, `skillVersion`, `skills[].id`, `skills[].description`, `skills[].requiredArgumentKeys`, `skills[].inputSchema` / `outputSchema`, `tokenUrl`. Optional: `GET /a2a/agent-card/extended` with Bearer.
3. Load this spoke’s row from `accounts.a2a_spoke_clients` (`a2a_server_name = 'worktual-crm'`). Do not reuse another product’s client.
4. If `access_token` is null or expired, `POST tokenUrl` (credentials or refresh). CRM writes new access **and** refresh on that row. `SELECT` again.
5. `POST {card.url}/` JSON-RPC `message/send` with `Authorization: Bearer <access_token>`.
6. Always send `organizationId`, `source: "hub"`, a Hub **instruction**, and `cdpId` when the work is about a person. `skillId` is an optional hint.
7. On `-32010`, mint a new token, then retry.
8. Do not wait for CRM to ask a question. Do not call CRM as a read API.
9. If CRM later posts leftover work, never bounce it back (`source=hub` / `delegated`).
