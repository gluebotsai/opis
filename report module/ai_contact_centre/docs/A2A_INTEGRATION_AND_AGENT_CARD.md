# Worktual CCaaS — A2A Integration & Agent Card

**Audience:** Engineering / Hub / platform teams  
**Protocol:** [A2A](https://a2a-protocol.org/) **v1.0**  
**Spoke service:** `apps/a2a-server` (`cc_a2a`)  
**Source of truth for card shape:** `apps/a2a-server/src/cc_a2a/card.py`  
**Source of truth for skills:** `apps/a2a-server/src/cc_a2a/catalog.py`  
**SFT agent export (prompts / tools / samples):** [docs/a2a/SFT_AGENT_CATALOG.md](./a2a/SFT_AGENT_CATALOG.md)

---

## 1. Integration overview

Worktual Contact Centre exposes an **A2A Protocol spoke** so Intelligent Hub (CDP / CVM) can discover and invoke Contact Centre capabilities as remote agent skills.

| Role | System | Direction |
|------|--------|-----------|
| **Spoke (this product)** | CCaaS `a2a-server` on port **8020** | Serves Agent Card + executes Hub skill requests |
| **Client / remote caller** | Intelligent Hub | Discovers card, obtains OAuth token, calls JSON-RPC |
| **Domain runtime** | L1 Contact Center Super Agent → L2 domain → L3 executor + MCP (cc-core) | Actual contact/queue/inbox/etc. work |
| **Outbound reverse path** | CCaaS → Hub (`HUB_A2A_*`) | Optional internal delegation; **not** advertised on the Agent Card |

### What this integration does

1. **Discovery** — Hub fetches the public Agent Card at `/.well-known/agent-card.json`.
2. **Auth** — Hub obtains a bearer token via OAuth2 client credentials (`POST /oauth/token`).
3. **Optional deep discovery** — Hub may fetch the authenticated **extended** Agent Card for richer skill metadata.
4. **Invoke** — Hub sends A2A JSON-RPC (`message/send`, `tasks/get`, …) with a typed Worktual envelope (`skillId`, `commandId`, `organizationId`, `arguments`).
5. **Execute** — Spoke validates policy/scopes, enters L1 Contact Center Super Agent, assigns the Hub skillId to the L2 domain then L3 executor, runs the mapped MCP/webchat path, and returns a durable task + `SkillResultArtifact`.

### What it deliberately does *not* change

- Copilot and Support Bot UX paths stay independent.
- UI-only actions (navigate, stage drafts, send/transfer/close conversation, etc.) are **excluded** from the catalog and never published on the Agent Card.
- Streaming is gated (`A2A_STREAMING_ENABLED`, default off).

### High-level architecture

```text
┌─────────────────┐     GET /.well-known/agent-card.json      ┌──────────────────────┐
│ Intelligent Hub │ ─────────────────────────────────────────►│  a2a-server (:8020)  │
│  (CDP / CVM)    │     POST /oauth/token                     │  Agent Card + OAuth  │
│                 │     POST /  (JSON-RPC message/send)       │  L1 Super Agent      │
└────────┬────────┘ ◄─────────────────────────────────────────┤  L2 domain → L3      │
         │                                                    └──────────┬───────────┘
         │                                                               │
         │                          MCP / internal APIs                  ▼
         │                                                    ┌──────────────────────┐
         │                                                    │ L3 executors +       │
         │                                                    │ cc-core / chat-svc   │
         │                                                    └──────────────────────┘
         │
         │   (optional, internal only)
         │   POST /internal/v1/hub/delegate  ◄── CCaaS → Hub outbound
```

### Key endpoints

| Path | Auth | Purpose |
|------|------|---------|
| `GET /health` | Public | Liveness |
| `GET /.well-known/agent-card.json` | Public | **Public Agent Card** (Hub registration URL) |
| `GET /a2a/agent-card/extended` | Bearer | **Extended Agent Card** (richer skill metadata) |
| `POST /oauth/token` | Client credentials | Access (+ refresh) tokens |
| `GET /.well-known/oauth-authorization-server` | Public | OAuth metadata |
| `POST /` | Bearer | A2A JSON-RPC |
| `GET /a2a/contracts/...` | Public | Envelope / result / per-skill JSON Schemas |
| `POST /internal/v1/hub/delegate` | Internal service key | Outbound Hub help (not on Agent Card) |

**Typical production Agent Card URL (via Nginx `/a2a/` → `:8020`):**

`https://<api-host>/a2a/.well-known/agent-card.json`

### Runtime feature flags

| Variable | Meaning |
|----------|---------|
| `A2A_ENABLED` | Master switch (default `false`) |
| `A2A_ENABLED_TENANTS` | Org allowlist (empty = all when enabled) |
| `A2A_ENABLED_SKILLS` | Skill allowlist for staged rollout |
| `A2A_STREAMING_ENABLED` | Advertise/use streaming (keep false until proven) |

Rollback: set `A2A_ENABLED=false` and restart `a2a-server` only.

---

## 2. Agent Card — what it is and why it matters

An **Agent Card** is the A2A discovery document: a machine-readable description of *who* the agent is, *how* to talk to it, *what* it can do (skills), and *how* to authenticate.

For Hub, the Agent Card answers:

- Where is the Contact Centre spoke? (`url`, preferred transport)
- Which protocol version? (`protocolVersion`)
- What skills can I call? (`skills[]`)
- What OAuth scopes and token URL do I need? (`securitySchemes`, per-skill `security`)
- Where are input/output schemas? (`inputSchema` / `outputSchema` + capability extension params)
- Is there a richer authenticated card? (`supportsAuthenticatedExtendedCard`)

We publish **two** cards from the same catalog:

| Card | Endpoint | Auth | Detail level |
|------|----------|------|--------------|
| **Public** | `GET /.well-known/agent-card.json` | None | Full skill list; schema paths; OAuth schemes; **no** per-skill `extensions` block |
| **Extended** | `GET /a2a/agent-card/extended` (also JSON-RPC `agent/getAuthenticatedExtendedCard`) | Required | Same as public **plus** per-skill typed-skills `extensions`, plus `additionalInterfaces` |

Both are built in `build_public_agent_card` / `build_extended_agent_card` in `card.py`. Skills always come from `list_skills()` in `catalog.py` — the card never invents skills at runtime.

---

## 3. Public Agent Card — field-by-field data returned

Top-level JSON shape (conceptual):

```json
{
  "name": "...",
  "description": "...",
  "url": "...",
  "version": "...",
  "protocolVersion": "1.0",
  "preferredTransport": "JSONRPC",
  "defaultInputModes": ["application/json", "text/plain"],
  "defaultOutputModes": ["application/json", "text/plain"],
  "capabilities": { "...": "..." },
  "skills": [ { "...": "..." } ],
  "securitySchemes": { "oauth2": { "...": "..." } },
  "security": [ { "oauth2": [] } ],
  "supportsAuthenticatedExtendedCard": true,
  "provider": { "organization": "Worktual", "url": "https://worktual.com" }
}
```

### 3.1 Identity & transport

| Field | Type | What it means | Typical value / source |
|-------|------|---------------|------------------------|
| `name` | string | Human-readable agent name | `A2A_AGENT_NAME` (default: `Worktual Contact Centre`) |
| `description` | string | What the spoke is for | `A2A_AGENT_DESCRIPTION` |
| `url` | string | Base public URL of the spoke | `A2A_PUBLIC_URL` (trailing slash stripped) |
| `version` | string | Catalog / agent version Hub can cache | `A2A_CATALOG_VERSION` (e.g. `1.1.0`) |
| `protocolVersion` | string | A2A protocol version | `A2A_PROTOCOL_VERSION` → `1.0` |
| `preferredTransport` | string | How Hub should call us | Always `JSONRPC` |
| `defaultInputModes` | string[] | Default accepted content types | `application/json`, `text/plain` |
| `defaultOutputModes` | string[] | Default returned content types | `application/json`, `text/plain` |
| `provider.organization` | string | Vendor | `Worktual` |
| `provider.url` | string | Vendor site | `https://worktual.com` |
| `supportsAuthenticatedExtendedCard` | boolean | Hub may request extended card | Always `true` |

### 3.2 `capabilities`

| Field | Type | What it means |
|-------|------|---------------|
| `streaming` | boolean | Whether streaming task updates are supported | From `A2A_STREAMING_ENABLED` |
| `pushNotifications` | boolean | Push notification support | Always `false` today |
| `stateTransitionHistory` | boolean | Task state history available | Always `true` |
| `extensions[]` | array | Worktual typed-skills capability extension | See below |

**Capability extension** (`capabilities.extensions[0]`):

| Field | Meaning |
|-------|---------|
| `uri` | `urn:worktual:a2a:typed-skills:v1` |
| `description` | Human text: Worktual typed skill contracts and schemas |
| `required` | `true` — Hub should honor typed contracts |
| `params.catalogVersion` | Catalog version (`A2A_CATALOG_VERSION`) |
| `params.overlayVersion` | Overlay version (`A2A_OVERLAY_VERSION`) |
| `params.contractSchema` | Path to envelope schema: `/a2a/contracts/worktual-envelope.v1.json` |
| `params.resultSchema` | Path to result schema: `/a2a/contracts/skill-result.v1.json` |
| `params.skillContractPathTemplate` | `/a2a/contracts/skills/{skillId}.v1.json` |
| `params.excludedCapabilities` | Explicit list of **non-published** capabilities (navigate, stage drafts, conversation send/transfer/close, …) |

Hub uses these params to fetch JSON Schema documents without guessing paths.

### 3.3 `skills[]` (public card — one object per skill)

Each public skill entry includes:

| Field | Type | What it means |
|-------|------|---------------|
| `id` | string | Stable skill id Hub must send as `skillId` (e.g. `cc.contact.create`) |
| `name` | string | Short display name |
| `description` | string | What the skill does / constraints |
| `tags` | string[] | Discovery tags (`contact`, `read`, `webchat`, …) |
| `examples` | string[] | Example natural-language intents for routing/docs |
| `inputModes` | string[] | Always `["application/json"]` |
| `outputModes` | string[] | Always `["application/json"]` |
| `security` | array | OAuth2 scope required for this skill: `[{"oauth2": ["<scope>"]}]` |
| `inputSchema` | string | Relative path to per-skill JSON Schema |
| `outputSchema` | string | Always `/a2a/contracts/skill-result.v1.json` |

**Not present on the public card:** per-skill `extensions` (L2 domain, L3 executor, risk, MCP mapping, required args, etc.). Those appear only on the **extended** card.

### 3.4 `securitySchemes` and top-level `security`

| Field | Meaning |
|-------|---------|
| `securitySchemes.oauth2.type` | `oauth2` |
| `securitySchemes.oauth2.flows.clientCredentials.tokenUrl` | `A2A_OAUTH_TOKEN_URL` or `{A2A_PUBLIC_URL}/oauth/token` |
| `securitySchemes.oauth2.flows.clientCredentials.scopes` | Map of **all** skill scopes → themselves (Hub can request subset) |
| `security` | `[{"oauth2": []}]` — OAuth2 required; empty list means “any configured oauth2 scheme” at card level; **per-skill** scopes still apply |

---

## 4. Extended Agent Card — additional data returned

Endpoint: `GET /a2a/agent-card/extended`  
Requires: valid Bearer token (OAuth JWT or lab `Bearer dev` when `A2A_ALLOW_DEV_AUTH=true`).

Extended card = public card **plus**:

### 4.1 `additionalInterfaces`

```json
[
  {
    "url": "{A2A_PUBLIC_URL}/",
    "transport": "JSONRPC"
  }
]
```

Explicit alternate/primary RPC interface listing for Hub clients that prefer interface arrays.

### 4.2 Per-skill `extensions` (detailed skills)

Each skill gains an `extensions` array. Today one extension:

| Field | Meaning |
|-------|---------|
| `uri` | `urn:worktual:a2a:typed-skills:v1` |
| `required` | `true` |
| `params.contractVersion` | `"1.0"` |
| `params.specialist` | Internal specialist routing key: `general`, `contact`, `inbox`, `task`, `queue`, `analytics`, `monitoring`, `webchat`, `super` |
| `params.surface` | Product surface hint: `contacts-list`, `inbox`, `dashboard`, … |
| `params.risk` | `read` \| `reversible_write` \| `high_impact` (policy / approval gating) |
| `params.scope` | OAuth scope string for this skill |
| `params.requiredArgumentKeys` | Arguments Hub must supply in the envelope |
| `params.mcpServer` | MCP server name used internally (or `null` for non-MCP skills) |
| `params.mcpTool` | MCP tool name (or `null`) |
| `params.orchestration` | For composite skills (e.g. anomaly): child skill ids executed in order |
| `params.inputSchema` | Relative schema path |
| `params.inputSchemaUrl` | Absolute URL to the skill contract |
| `params.outputSchema` | Relative result schema path |

**Example (truncated) extended skill:**

```json
{
  "id": "cc.contact.create",
  "name": "Create contact",
  "description": "Create a contact after Hub policy approval for the write.",
  "tags": ["contact", "write", "reversible"],
  "examples": ["Create contact Jane Doe with primaryEmail."],
  "inputModes": ["application/json"],
  "outputModes": ["application/json"],
  "security": [{ "oauth2": ["cc.contact.write"] }],
  "inputSchema": "/a2a/contracts/skills/cc.contact.create.v1.json",
  "outputSchema": "/a2a/contracts/skill-result.v1.json",
  "extensions": [
    {
      "uri": "urn:worktual:a2a:typed-skills:v1",
      "required": true,
      "params": {
        "contractVersion": "1.0",
        "specialist": "contact",
        "surface": "contacts-list",
        "risk": "reversible_write",
        "scope": "cc.contact.write",
        "requiredArgumentKeys": ["firstName"],
        "mcpServer": "contact",
        "mcpTool": "create_contact",
        "orchestration": [],
        "inputSchema": "/a2a/contracts/skills/cc.contact.create.v1.json",
        "inputSchemaUrl": "https://…/a2a/contracts/skills/cc.contact.create.v1.json",
        "outputSchema": "/a2a/contracts/skill-result.v1.json"
      }
    }
  ]
}
```

---

## 5. Linked schemas (fetched using Agent Card pointers)

These are **not** embedded in the Agent Card body; the card only advertises paths/URLs.

| Document | Path | Contents |
|----------|------|----------|
| Worktual request envelope | `/a2a/contracts/worktual-envelope.v1.json` | `commandId`, `skillId`, `contractVersion`, `organizationId`, `arguments`, optional `approval`, `deadline`, `traceparent`, `hopCount`, … |
| Skill result artifact | `/a2a/contracts/skill-result.v1.json` | `outcome`, `evidence`, `affectedIds`, `policy`, `warnings`, `retryable`, … |
| Per-skill input contract | `/a2a/contracts/skills/{skillId}.v1.json` | JSON Schema constraining that skill’s envelope `arguments` |

**Envelope fields Hub sends inside `message/send` data part:**

| Field | Required | Notes |
|-------|----------|-------|
| `commandId` | Yes | Idempotency key (8–128 chars) |
| `skillId` | Yes | Must match a published card skill `id` |
| `contractVersion` | Yes | Must be `"1.0"` |
| `organizationId` | Yes | Tenant; must match token / headers |
| `arguments` | Yes (may be `{}`) | Skill-specific |
| `approval` | For high-impact | Hub approval evidence when policy requires it |
| `deadline` / `traceparent` / `hopCount` | Optional | Ops / tracing / anti-loop |

**Result outcomes:** `succeeded` | `failed` | `rejected` | `input_required` | `auth_required` | `canceled` | `visitor_offline`

---

## 6. Skills published on the Agent Card (current catalog)

Allowlisted in `catalog.py`. Hub discovers these skills and sends the `skillId`; the spoke always enters **L1 Contact Center Super Agent**, which assigns the task to the skill's **L2 domain**, then **L3 executor**. Hub does not call L2/L3 directly.

| L2 domain | L3 executor | Skill IDs |
|-----------|-------------|-----------|
| Interaction Operations | `contact` | `cc.contact.list`, `cc.contact.read`, `cc.contact.create`, `cc.contact.update`, `cc.contact.status.update`, `cc.contact.enrich` |
| Agent Assist | `inbox` | `cc.conversation.context.read` |
| Workforce Management | `queue` | `cc.queue.list`, `cc.queue.agent-eligibility.read`, `cc.agent.presence.read`, `cc.queue.agent.add`, `cc.queue.agent.remove` |
| Workforce Management | `monitoring` | `cc.monitoring.callback-channels.read`, `cc.callback.create` |
| Performance Intelligence | `analytics` | `cc.analytics.query` |
| Omnichannel Engagement | `webchat` | `cc.webchat.proactive-engagement.trigger` |
| Performance Intelligence (L1 coordinates) | composite | `cc.anomaly.investigate` (unpublished inner reads: `cc.analytics.root-cause.analyze`, `cc.monitoring.snapshot.read`) |

**Explicitly excluded** (listed in card `excludedCapabilities`, never in `skills[]`):  
`navigate`, `open_task_workspace`, stage drafts, skill/metric administration, conversation send/transfer/close, conversation reply suggest, coworker task inbox, organization/knowledge coworker reads, queue create/status/delete, full queue editing, supervisor force logout and presence, `generate_plot`, analytics report generate.

---

## 7. End-to-end flow after Agent Card discovery

```text
1. Hub GET  /.well-known/agent-card.json
2. Hub (optional) GET /a2a/agent-card/extended   + Bearer
3. Hub GET  skill / envelope / result schemas from card paths
4. Hub POST /oauth/token  (client_credentials + organization_id + scopes)
5. Hub POST /  JSON-RPC message/send
      message.parts[].data = WorktualEnvelope
6. Spoke → L1 Super Agent → L2 domain → L3 executor → MCP / webchat / composite
7. Spoke returns A2A Task (status + artifacts including SkillResultArtifact)
8. Hub may tasks/get / tasks/list / tasks/cancel with same tenant scope
```

**Auth notes**

- Audience: `worktual-contact-centre-a2a` (configurable).
- Inbound Hub client: `A2A_HUB_CLIENT_ID` / `A2A_HUB_CLIENT_SECRET` (or JWKS in prod).
- Outbound CCaaS→Hub uses separate `HUB_A2A_*` credentials — unrelated to what the Agent Card advertises for *inbound* Hub→CCaaS.

---

## 8. Operational references

| Doc / code | Use |
|------------|-----|
| `docs/deploy/a2a-spoke.md` | Deploy, env, Nginx, rollout stages |
| `docs/deploy/a2a-hub-local-handoff.md` | Lab Hub registration / token examples |
| `apps/a2a-server/README.md` | Local run |
| `apps/a2a-server/src/cc_a2a/card.py` | Card builders |
| `apps/a2a-server/src/cc_a2a/catalog.py` | Skill allowlist |
| `apps/a2a-server/src/cc_a2a/contracts.py` | Envelope + result models |
| `apps/a2a-server/tests/contract/test_agent_card.py` | Contract tests for card + schemas |

---

## 9. Quick FAQ for Hub integrators

**Q: Do we need the extended card to call skills?**  
No. Public card + schemas + OAuth is enough to invoke. Extended card helps with routing, risk, required args, and MCP metadata.

**Q: Where do I register the spoke?**  
Register the **public** Agent Card URL (`…/.well-known/agent-card.json`).

**Q: Why isn’t “send message” or “navigate” on the card?**  
Those are UI / unsupported remote capabilities and are listed under `excludedCapabilities`.

**Q: Does the card return live tenant data (contacts, queues, etc.)?**  
No. The Agent Card is **capability metadata only**. Tenant data is returned only after authenticated skill execution via JSON-RPC.

**Q: What changes when we add a skill?**  
Add `SkillSpec` to `catalog.py` (+ contract in `skill_contracts.py`). It automatically appears on both cards and in OAuth scope enumeration.

---

*Generated from the current `apps/a2a-server` implementation for team handoff.*
