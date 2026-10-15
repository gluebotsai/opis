# SFT handoff — Contact Centre agent catalog APIs

**Audience:** SFT / synthetic-data team  
**Producer:** Worktual CCaaS `a2a-server` (port **8020**)  
**Purpose:** Cron-pull agent definitions (system prompt, tools, skills, sample conversations) and generate synthetic conversation data with an LLM pipeline.  
**Format:** JSON only  
**Auth:** Internal service key (not the public Agent Card)

This is **not** the Hub Agent Card (`/.well-known/agent-card.json`). That card lists Hub *skills* (`cc.contact.list`, …). These APIs list *agents* as they run in NLP.

---

## 1. Base URL

| Environment | Base |
|-------------|------|
| Local (loopback) | `http://localhost:8020` |
| Local (LAN IP) | `http://192.168.13.164:8020` |
| QA (typical) | `https://rebuild-ccaas-api.worktual.com` plus the A2A public prefix your DevOps routes to port 8020 |

Same process, two local URLs. Use the LAN IP when the SFT cron or another machine cannot reach `localhost`. Health check: `GET {BASE}/health` — e.g. `http://192.168.13.164:8020/health`.

LAN IP can change with DHCP; if it does, update `A2A_PUBLIC_URL` and this table.

---

## 2. Authentication

Every catalog request needs:

```http
x-internal-service-key: <INTERNAL_SERVICE_KEY>
```

Same key CCaaS services already share. Ask the CCaaS owner for the QA value. Do **not** put system prompts on a public unauthenticated URL.

Missing or wrong key → **401**.

---

## 3. The three APIs

Use **export** on the cron. Use **list** and **detail** for debugging or partial reruns.

| # | Method | Path | Use |
|---|--------|------|-----|
| 1 | `GET` | `/internal/v1/agents` | List agents (summaries) |
| 2 | `GET` | `/internal/v1/agents/{id}` | One agent, full payload |
| 3 | `GET` | `/internal/v1/agents/export` | All agents, full payload |

`{id}` examples: `contact`, `queue`, `inbox`, `analytics`, `contact_center_super`, `support_bot`.

Unknown `{id}` → **404**.

### 3.1 List

```http
GET /internal/v1/agents
x-internal-service-key: <key>
```

```json
{
  "version": "1.0.0",
  "source": "nlp-agent-definitions",
  "agentCount": 15,
  "agents": [
    {
      "id": "contact",
      "name": "contact",
      "family": "coworker",
      "layer": "executor",
      "surfaces": ["contacts-list", "contacts-detail"],
      "promptVersion": "a1b2c3d4e5f6",
      "mcpServers": ["contact", "skill", "preferences"],
      "skillCount": 5,
      "toolCount": 10,
      "sampleConversationCount": 3
    }
  ]
}
```

### 3.2 One agent

```http
GET /internal/v1/agents/contact
x-internal-service-key: <key>
```

```json
{
  "version": "1.0.0",
  "source": "nlp-agent-definitions",
  "agent": { "...full agent object..." }
}
```

### 3.3 Export (cron)

```http
GET /internal/v1/agents/export
x-internal-service-key: <key>
```

```json
{
  "version": "1.0.0",
  "source": "nlp-agent-definitions",
  "agentCount": 15,
  "agents": [ { "...full agent object..." } ]
}
```

Re-fetch when `version` or any agent's `promptVersion` changes. Cache the export for the job; it is large (full prompts + tool schemas + skill bodies).

---

## 4. Agent object (detail / export)

| Field | Type | Meaning |
|-------|------|---------|
| `id` / `name` | string | Agent id (`contact`, `queue`, …) |
| `family` | `coworker` \| `support_bot` | Do **not** mix these in one SFT mix without a label |
| `layer` | `super` \| `domain` \| `executor` | L1 router / L2 domain / L3 worker |
| `surfaces` | string[] | UI or channel surfaces this agent is allowed on |
| `systemPrompt` | string | Full system prompt (`agent.md` when present) |
| `promptVersion` | string | Content hash of the prompt file (or `legacy`) |
| `agentDocumentPath` | string \| null | Repo path of `agent.md` if it exists |
| `mcpServers` | string[] | MCP servers the agent may call |
| `tools` | object[] | Tools the model may call (MCP + runtime handoff) |
| `skills` | object[] | Procedural skill packs (workflow text) |
| `handoffTargets` | string[] | Agents this one may `route_to_agent` to |
| `sampleConversations` | object[] | Gold threads for the generator to imitate |
| `metricDomains` | string[] | Analytics metric domains when used |
| `maxToolRounds` | number | Runtime tool-round cap |

### Tool

```json
{
  "server": "contact",
  "name": "create_contact",
  "description": "Persist a new contact after explicit confirmation.",
  "inputSchema": { "type": "object", "properties": {}, "required": [] },
  "kind": "mcp"
}
```

`kind`:

- `mcp` — business / skill / preference tool
- `runtime_handoff` — `route_to_agent` (L1/L2 and some L3s). L1/L2 must not call business tools.

### Skill

```json
{
  "id": "contact-create",
  "name": "Contact Create",
  "description": "Collect fields, stage a draft, create only after confirmation.",
  "version": 2,
  "required": false,
  "triggers": ["create contact"],
  "toolsPreferred": ["stage_contact_draft", "create_contact"],
  "workflow": ["..."],
  "rules": ["..."],
  "body": "Start by staging mode=create ...",
  "missing": false
}
```

Skills are **instructions**, not permissions. The model still needs the matching MCP tool.

### Sample conversation

```json
{
  "id": "contact-create-happy-path",
  "title": "Create a contact after confirmation",
  "turns": [
    { "role": "user", "content": "Add a contact named Rahul Nair, email rahul.nair@zifo.com" },
    {
      "role": "assistant",
      "content": "<p>I can create <strong>Rahul Nair</strong>…</p>",
      "tools": ["update_skill_in_system", "stage_contact_draft"]
    }
  ]
}
```

Coworker assistant text is usually compact **HTML** (`<p>`, lists, tables). Support Bot is plain text. Conversation Assist returns a **JSON object** string (`replyDraft`, `privateNotes`, …). Match the agent's `input/output` style from `systemPrompt`.

---

## 5. Agents in this catalog

| id | family | layer | Typical job |
|----|--------|-------|-------------|
| `contact_center_super` | coworker | super | Route to one L2 domain. No business tools. Empty user-visible text on handoff. |
| `agent_assist_domain` | coworker | domain | Route to inbox / contact / general / coworker_task_assist |
| `interaction_operations_domain` | coworker | domain | Route to `task` |
| `workforce_management_domain` | coworker | domain | Route to `queue` or `monitoring` |
| `performance_intelligence_domain` | coworker | domain | Route to `analytics` |
| `contact` | coworker | executor | Search / create / update / deactivate contacts |
| `inbox` | coworker | executor | Conversation summary and suggested replies (never send) |
| `queue` | coworker | executor | Queue list, staffing, presence |
| `monitoring` | coworker | executor | Live wait, callbacks, presence |
| `analytics` | coworker | executor | KPIs, reports, plots |
| `task` | coworker | executor | Agent task list / complete |
| `general` | coworker | executor | Greeting, org/nav, hand off domain work |
| `conversation_assist` | coworker | executor | Passive assist JSON (draft only, never send) |
| `coworker_task_assist` | coworker | executor | Propose actions; execute only after explicit approval |
| `support_bot` | support_bot | executor | Customer-channel bot (webchat / WhatsApp / …). Separate from coworker. |

---

## 6. How to generate synthetic data

Recommended cron:

1. `GET /internal/v1/agents/export`
2. For each agent (or a family/layer subset):
   - Use `systemPrompt` as the teacher/system side
   - Offer `tools` (name + description + `inputSchema`)
   - When the task matches a skill, include that skill `body` / `workflow` / `rules`
   - Use `sampleConversations` as few-shot seeds
3. Generate extra threads that stay on-policy:
   - L1/L2: only `route_to_agent`, empty assistant content
   - Contact/queue writes: stage or preview, then confirm, then mutate
   - Inbox / conversation assist: never send a customer message
   - Support Bot: do not invent coworker HTML or admin queue edits
4. Keep `family` and `layer` as labels on every generated example

Do not train coworker contact flows as Support Bot webchat, or L1 routing as L3 tool use.

---

## 7. curl examples

```bash
# Local loopback, or LAN IP from another machine:
# BASE=http://localhost:8020
BASE=http://192.168.13.164:8020
KEY=dev-internal-key

curl -sS -H "x-internal-service-key: $KEY" "$BASE/internal/v1/agents" | jq '.agents[].id'

curl -sS -H "x-internal-service-key: $KEY" "$BASE/internal/v1/agents/contact" | jq '.agent | {id, layer, tools: [.tools[].name], skills: [.skills[].id]}'

curl -sS -H "x-internal-service-key: $KEY" "$BASE/internal/v1/agents/export" -o agents-export.json
```

---

## 8. Source of truth (CCaaS)

| Data | Repo path |
|------|-----------|
| Prompts | `apps/nlp/agents/<id>/agent.md` |
| Wiring | `apps/nlp/src/app/agents/definitions.py` |
| Tools | MCP servers under `apps/nlp/src/app/mcp/servers/` |
| Skills | `apps/nlp/src/app/skills/packs/<skill-id>/skill.yaml` |
| Samples | `apps/nlp/agents/<id>/samples.json` |
| HTTP | `apps/a2a-server/src/cc_a2a/main.py` |
| Builder | `apps/a2a-server/src/cc_a2a/agent_catalog.py` |

When CCaaS adds an agent, tool, or skill, this export updates automatically from those files. Re-pull export; do not keep a stale snapshot as the only source.

Catalog schema version today: **`1.0.0`**.

---

## 9. Contacts

- CCaaS A2A / NLP owner: Contact Centre engineering
- This document: `docs/a2a/SFT_AGENT_CATALOG.md`
