# Worktual combine contracts (CRM pillar)

CRM owns sales system-of-record + CRM agents. Marketing / Service / CCaaS stay separate microservices. Combine later via **shared CDP identity**, **events**, **MCP**, **A2A tasks**, and **memory read** — not a monolith.

## Identity

- Shared person key: **`cdp_id`** (`cdp.customer_profile.cdp_id` / CRM `contact_profiles.account_contact_id`).
- Do **not** invent parallel person IDs. Do **not** alter `cdp` / `accounts` schema from CRM, except the approved Hub token table `accounts.a2a_spoke_clients`.

## Event catalog

Emitted from CRM (see `backend/src/lib/crm-platform-events.ts`):

| Event | When | Key fields |
|---|---|---|
| `activity.logged` | Contact activity created (email, meeting, note, task) | `cdpId`, `entityId` (activity), `payload.type` |
| `deal.stage_changed` | Deal stage update | `entityId` (deal), `cdpId`, `payload.from`/`to` |
| `meeting.analyzed` | Meeting transcript analysis done | `cdpId`, activity id, outcome |
| `lead.scored` | Lead scoring job completed | `cdpId`, score/band |
| `proposal.approved` | Proposal left draft / approved | deal id, proposal id, `cdpId` |

Listeners register with `onCrmPlatformEvent`. These events stay **CRM-internal**. Hub does not consume CRM as a read model (Hub has CDP and DB access). Cross-product **work** uses A2A, not this event catalog.

## A2A spoke (Hub tasks)

How the spoke was built and how Hub connects: [`docs/a2a-spoke.md`](./a2a-spoke.md). Two-way communication (what we send Hub, what Hub sends us): [`docs/crm-hub-a2a-communication.md`](./crm-hub-a2a-communication.md).

Hub (separate server) delegates CRM **actions** to the CRM A2A spoke. Hub sends an instruction and does **not** answer follow-up questions — CRM agents must execute that instruction in one shot.

| Endpoint | Purpose |
|---|---|
| `GET /.well-known/agent-card.json` | Public Agent Card: skills + `inputSchema` / `outputSchema` + `tokenUrl` |
| `GET /a2a/agent-card/extended` | Authenticated extended card (typed-skills `extensions`) |
| `GET /a2a/contracts/...` | Envelope, result, and per-skill JSON Schemas |
| `POST /token` | Client credentials or refresh; access 6h, refresh ~2 months |
| `POST /` JSON-RPC `message/send` | Run a CRM skill; result in artifacts |
| `POST /` JSON-RPC `tasks/get` / `tasks/cancel` | Task inspect / cancel |

Default: `http://127.0.0.1:8020` (`uvicorn app.a2a_main:app --port 8020`). Each spoke has its own `client_id` / `client_secret`, stored with live tokens on **`accounts.a2a_spoke_clients`** (`a2a_server_name` unique, CRM = `worktual-crm`). Hub `SELECT`s `access_token` from that row. Card and `/token` are unauthenticated; `/token` authenticates with the spoke’s client id/secret. Access JWT is a **snapshot** (`skills` + `skillVersion` + `a2a_server_name`). When access expires, Hub reads `tokenUrl` from the card and `POST`s `grant_type=refresh_token`; CRM **replaces** access and refresh on that row. Catalog change before expiry → JSON-RPC `-32010 skill_version_stale` → refresh (or client credentials) for a new snapshot. Invoke uses `Authorization: Bearer <access_token>`. Hub is the actor on delegated work (`actorId=hub:<client>`, role `admin`). Hub sends `organizationId`, `skillId`, and `cdpId` (plus CRM-owned ids when needed). CRM does not expose get/list/analytics skills to Hub. CRM escalates to Hub only for leftover non-CRM work (`source≠hub`), using Hub `POST /token` and storing Hub access/refresh on `accounts.a2a_spoke_clients` (`a2a_server_name=worktual-hub`). Never escalate clarifying follow-ups.

Mint:

```json
{
  "grant_type": "client_credentials",
  "client_id": "<crm-client-id>",
  "client_secret": "<crm-client-secret>",
  "a2a_server_name": "worktual-crm"
}
```

Refresh (same path; rotates both tokens):

```json
{
  "grant_type": "refresh_token",
  "client_id": "<crm-client-id>",
  "client_secret": "<crm-client-secret>",
  "refresh_token": "<current refresh>",
  "a2a_server_name": "worktual-crm"
}
```

### Hub checklist (other server — not this repo)

1. Resolve CRM A2A base URL (`A2A_PUBLIC_URL`, default `http://<crm-host>:8020`).
2. `GET {base}/.well-known/agent-card.json` — use `id` (`worktual-crm`), `url`, `skillVersion`, `skills[].id`, and `securitySchemes.oauth2.flows.clientCredentials.tokenUrl`.
3. Load Hub credentials from **`accounts.a2a_spoke_clients`** where `a2a_server_name = 'worktual-crm'` (this spoke’s `client_id` / `client_secret` only — never reuse marketing/service clients).
4. If `access_token` is null or `access_expires_at <= now()`, `POST tokenUrl` with client credentials (or refresh). CRM writes the new access **and** refresh onto **this same row**. Then `SELECT` again.
5. Invoke: `POST {card.url}/` JSON-RPC `message/send` with `Authorization: Bearer <access_token>`.
6. Always send `organizationId`, `skillId`, `source: "hub"`. Person key is **`cdpId`**. Add CRM-owned ids only when the skill needs them (`dealId`, `quoteId`, `invoiceId`, …).
7. On `-32010 skill_version_stale`, call `/token` again (refresh or client credentials), then retry. Do not patch the JWT.
8. Hub will **not** reply to clarifying questions. CRM executes the instruction in one shot (auto-confirm Hub-originated mutations). Return `input-required` only when a typed skill field is missing (e.g. `cdpId` for `score-lead`), never to ask Hub what it meant.
9. Do **not** call CRM as a read/query API (no get/list/analytics). Identity/products come from CDP + shared DB.
10. If CRM later posts leftover work to Hub, never bounce it back (`source=hub` / `delegated`).

Example invoke:

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

## Action surface (MCP) — HTTP server on ai-service

Coworker MCP lives in **`ai-service/app/mcp/`** as its only catalog/dispatch source. Production exposes it through the dedicated `app.mcp_main:app` ASGI process, separate from the agent API:

| Endpoint | Purpose |
|---|---|
| `GET /mcp/v1/health` | Authenticated liveness |
| `POST /mcp/v1/tools/list` | Filtered tool catalog |
| `POST /mcp/v1/tools/call` | Execute tool (may write `crm.*`) |

Default base URL: `http://127.0.0.1:8010/mcp/v1` (`MCP_BASE_URL`). Start it with `uvicorn app.mcp_main:app --host 0.0.0.0 --port 8010`. Production clients are HTTP-only. Explicit test mode may enable in-process dispatch.

- **Not** a browser product surface; Vite never receives MCP credentials.
- Fastify issues short-lived HS256 execution JWTs with issuer, audience, expiry, JTI, tenant, actor, role, business type, module/surface, policy version, and run correlation claims. MCP binds every request context to those claims.
- Legacy `x-internal-secret` authentication is disabled by default and can only be enabled explicitly in development/test.
- Business mutations forward to curated authenticated Fastify commands. Direct MCP SQL is limited to CRM-owned agent state and read-only analytics. SELECT on shared schemas remains read-only; no shared-schema DDL.
- High-risk tools require `confirmed=true`. UI Confirm → agent-turn `confirmTool` → MCP call.
- After writes, agent-turn returns **`uiRefresh`** so Vite reloads lists/detail.
- Manual forms remain on Fastify (dual path forever).

Documented mutation tools (confirm high-risk with `confirmed=true`):

- Contacts: `propose_create_contact`, `propose_update_contact`, `propose_delete_contact`, `propose_merge_contacts`
- Deals: `propose_create_deal`, `propose_update_deal`, `propose_delete_deal`, `propose_stage_change`
- Companies / products / activities / quotes / invoices / proposals (create + rewrite/personalize)
- Memory: `remember_memory`, `clear_memory`
- Analytics (read-only): `query_analytics`

UI-only (no CRM write): `navigate`, `open_entity`, `set_workspace`, draft patches, `ask_clarification`.

Catalog: `ai-service/app/mcp/catalog.py`. Dispatch: `ai-service/app/mcp/dispatch.py`.

## Memory read API

- Table: `crm.agent_memories` (Prisma `AgentMemory`) — structured slots only (v1; no vectors).
- HTTP: `GET/POST/DELETE /api/agent-memory` (session).
- Slots: `prefs`, `last_intent`, `open_ask`, `entity_hint`, `tone`, `follow_up`, `note`.
- Scopes: `org` | `user` | `contact` | `deal`.
- Coworker hydrates `durableMemory` next to client STM on each agent turn.

## Dual path (forever)

Automation may propose / fill / execute when confident. **Manual create/edit** (contacts, deals, activities, notes, stages) remains first-class for offline / field sales under the same RBAC (Fastify commands). Agent MCP does not replace forms.

## Out of scope here

Building CCaaS, campaign CVM, or web-tracking product inside this CRM repo.
