# SFT handoff — Campaign agent catalog APIs

**Audience:** SFT / synthetic-data team  
**Producer:** Worktual Campaign agents (port **8005**)  
**Purpose:** Cron-pull agent definitions (system prompt, tools, skills, sample conversations) and generate synthetic conversation data with an LLM pipeline.  
**Format:** JSON only  
**Auth:** Internal service key (not the Hub Agent Card)

This is **not** the Hub Agent Card (`/.well-known/agent-card.json` on A2A `:8040`). That card lists Hub *skills* (`on-demand-send`, `create-contact`, …). These APIs list *agents* as they run in Campaign MAS (Super → Domain → Executor).

---

## 1. Base URL

| Environment | Base |
|-------------|------|
| Local (loopback) | `http://localhost:8005` |
| Local (LAN) | `http://<lan-ip>:8005` |
| Docker (default) | Host bind `127.0.0.1:8005` — chat browsers use SPA `/agents-socket/`; catalog only on-box or via SSH tunnel |
| QA / live (SFT) | `http://82.113.92.49:8005` when root `.env` has `AGENTS_HOST_BIND=0.0.0.0` (see `deploy/server/root.env`) |

Health check: `GET {BASE}/health` (no auth). Catalog paths still need `x-internal-service-key`.

**Remote discovery:** set `AGENTS_HOST_BIND=0.0.0.0`, recreate agents, and firewall-allow the scheduler IP. Without that bind, callers get `[Errno 111] Connection refused`.

---

## 2. Authentication

Every catalog request needs:

```http
x-internal-service-key: <INTERNAL_SERVICE_KEY>
```

Set on the Campaign agents process via env `INTERNAL_SERVICE_KEY` (see `agents/.env` / `deploy/server/agents.env`). Ask the Campaign owner for the QA value. Do **not** put system prompts on a public unauthenticated URL.

Missing or wrong key → **401**. Empty `INTERNAL_SERVICE_KEY` → all catalog calls fail closed (**401**).

---

## 3. The three APIs

Use **export** on the cron. Use **list** and **detail** for debugging or partial reruns.

| # | Method | Path | Use |
|---|--------|------|-----|
| 1 | `GET` | `/internal/v1/agents` | List agents (summaries) |
| 2 | `GET` | `/internal/v1/agents/{id}` | One agent, full payload |
| 3 | `GET` | `/internal/v1/agents/export` | All agents, full payload |

`{id}` examples: `campaign_super`, `audience`, `creation`, `contact`, `launch_scheduling`, `monitoring`.

Unknown `{id}` → **404**.

### 3.1 List

```http
GET /internal/v1/agents
x-internal-service-key: <key>
```

```json
{
  "version": "1.0.0",
  "source": "campaign-mas-agent-definitions",
  "agentCount": 33,
  "agents": [
    {
      "id": "contact",
      "name": "Contact Executor",
      "family": "campaign_coworker",
      "layer": "executor",
      "surfaces": ["contacts", "audience", "campaign-hub"],
      "promptVersion": "a1b2c3d4e5f6",
      "mcpServers": ["campaign"],
      "skillCount": 3,
      "toolCount": 10,
      "sampleConversationCount": 2
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
  "source": "campaign-mas-agent-definitions",
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
  "source": "campaign-mas-agent-definitions",
  "agentCount": 33,
  "agents": [ { "...full agent object..." } ]
}
```

Re-fetch when `version` or any agent's `promptVersion` changes. Cache the export for the job; it is large (full prompts + tool schemas + skill bodies).

---

## 4. Agent object (detail / export)

| Field | Type | Meaning |
|-------|------|---------|
| `id` / `name` | string | Agent id (`contact`, `campaign_super`, …) |
| `family` | `campaign_coworker` | Campaign MAS coworker family (do not mix with CCaaS Support Bot without a label) |
| `layer` | `super` \| `domain` \| `executor` | L1 router / L2 domain / L3 worker |
| `surfaces` | string[] | SPA modules / Hub surface this agent is allowed on |
| `systemPrompt` | string | Full `agent.md` text |
| `promptVersion` | string | Content hash of the prompt file (or `legacy`) |
| `agentDocumentPath` | string \| null | Repo path of `agent.md` if it exists |
| `mcpServers` | string[] | Logical server label (`campaign`) — tools are runtime, not MCP today |
| `tools` | object[] | Tools the model may call |
| `skills` | object[] | Procedural skill packs (workflow text from `mas/skills/`) |
| `handoffTargets` | string[] | Domains (super) or executors (domain) |
| `sampleConversations` | object[] | Gold threads for the generator to imitate |
| `metricDomains` | string[] | Reserved (usually empty) |
| `maxToolRounds` | number | Suggested tool-round cap |

### Tool

```json
{
  "server": "campaign",
  "name": "CREATE_SINGLE_CONTACT",
  "description": "…",
  "inputSchema": { "type": "object", "properties": {} },
  "kind": "runtime"
}
```

`kind`:

- `runtime` — business tool (contacts, launch, report, …)
- `runtime_handoff` — `route_to_domain` / `invoke_executor` / `request_domain_handoff`. Super/Domain must not call business tools.

### Skill

```json
{
  "id": "contact_creation",
  "name": "Contact Creation",
  "description": "Create contacts via chat or sheet…",
  "version": 1,
  "required": false,
  "triggers": [],
  "toolsPreferred": ["CREATE_SINGLE_CONTACT", "CREATE_BULK_CONTACT"],
  "workflow": [],
  "rules": [],
  "body": "…markdown skill body…",
  "missing": false,
  "module": "contacts",
  "executor_id": "contact"
}
```

Skills are **instructions**, not permissions. The model still needs the matching runtime tool.

### Sample conversation

```json
{
  "id": "contact-create-happy-path",
  "title": "Create a contact after confirmation",
  "turns": [
    { "role": "user", "content": "Add a contact named Rahul Nair…" },
    {
      "role": "assistant",
      "content": "<p>I can create <strong>Rahul Nair</strong>…</p>",
      "tools": ["SET_DRAFT_FIELDS"]
    }
  ]
}
```

Campaign coworker assistant text is usually compact **HTML** (`<p>`, lists). Hub autonomous turns have **no clarification**. Match the agent's `systemPrompt` I/O contract.

---

## 5. Agents in this catalog

| id | family | layer | Typical job |
|----|--------|-------|-------------|
| `campaign_super` | campaign_coworker | super | Route to one domain. No business tools. |
| `audience` | campaign_coworker | domain | Route to contact / audience_selection / audience_pull |
| `creation` | campaign_coworker | domain | Brief → audience → content → launch |
| `recommendation_run` | campaign_coworker | domain | Run one recommendation card |
| `library_run` | campaign_coworker | domain | Library template → campaign |
| `content` | campaign_coworker | domain | Channel templates / WA / coach |
| `image` | campaign_coworker | domain | Generate / refine / attach images |
| `optimization` | campaign_coworker | domain | Monitoring / analytics / recovery |
| `forms` | campaign_coworker | domain | Form theme / fields / design |
| `contact` | campaign_coworker | executor | Search / create / update contacts |
| `audience_selection` | campaign_coworker | executor | Segments / bulk / import |
| `audience_pull` | campaign_coworker | executor | Materialize audience lists |
| `brief_validation` | campaign_coworker | executor | Campaign overview fields |
| `campaign_audience` | campaign_coworker | executor | Named recipients / temp sheet |
| `campaign_content` | campaign_coworker | executor | `build_campaign` templates |
| `recommendation` | campaign_coworker | executor | Recommendation board |
| `launch_scheduling` | campaign_coworker | executor | Launch / schedule / on-demand |
| `email_content` / `whatsapp_content` / `app_push_content` / `web_push_content` | campaign_coworker | executor | Per-channel template gen |
| `whatsapp_approved_send` | campaign_coworker | executor | Send Meta-approved WA |
| `content_verification` | campaign_coworker | executor | Rejected WA fix / resubmit |
| `template_coach` | campaign_coworker | executor | Manual-edit assist |
| `image_generate` / `image_refine` / `image_attach` / `campaign_images` | campaign_coworker | executor | Image pipeline |
| `monitoring` | campaign_coworker | executor | Lists / reports / audience outcomes |
| `analytics` | campaign_coworker | executor | KPIs / ontology / events |
| `recovery` | campaign_coworker | executor | Stop / pause / resume / A/B |
| `form_theme` / `form_fields` / `form_design` | campaign_coworker | executor | Form specialists |

Exact count grows with MAS catalog; trust `agentCount` from the live export.

---

## 6. How to generate synthetic data

Recommended cron:

1. `GET /internal/v1/agents/export`
2. For each agent (or a family/layer subset):
   - Use `systemPrompt` as the teacher/system side
   - Offer `tools` (name + description + `inputSchema`)
   - When the task matches a skill, include that skill `body`
   - Use `sampleConversations` as few-shot seeds
3. Generate extra threads that stay on-policy:
   - Super/Domain: only handoff tools (`runtime_handoff`)
   - Contact / launch writes: confirm then mutate (`user_confirmed`)
   - Hub surfaces: no clarification questions
4. Keep `family` and `layer` as labels on every generated example

Do not train Hub on-demand flows as SPA clarify chat, or Super routing as executor tool use.

---

## 7. curl examples

```bash
# Local:
BASE=http://localhost:8005
KEY=change-me-campaign-sft-internal-key

curl -sS -H "x-internal-service-key: $KEY" "$BASE/internal/v1/agents" | jq '.agents[].id'

curl -sS -H "x-internal-service-key: $KEY" "$BASE/internal/v1/agents/contact" | jq '.agent | {id, layer, tools: [.tools[].name], skills: [.skills[].id]}'

curl -sS -H "x-internal-service-key: $KEY" "$BASE/internal/v1/agents/export" -o campaign-agents-export.json
```

---

## 8. Source of truth (Campaign)

| Data | Repo path |
|------|-----------|
| Prompts | `agents/app/mas/super_agent/agent.md`, `agents/app/mas/domains/<id>/agent.md`, `agents/app/mas/executors/<id>/agent.md` |
| Catalog wiring | `agents/app/mas/catalog.py` |
| Tools | Executor schemas under `agents/app/agents/*/tools/` + MAS adapters |
| Skills | `agents/app/mas/skills/` |
| Samples | `agents/app/mas/executors/<id>/samples.json` |
| HTTP | `agents/app/sft_catalog/routes.py` (mounted on `socket_server` FastAPI) |
| Builder | `agents/app/sft_catalog/builder.py` |

When Campaign adds an agent, tool, or skill, re-pull export; do not keep a stale snapshot as the only source.

Catalog schema version today: **`1.0.0`**.

---

## 9. Related docs

- Hub A2A skill card (different): [CAMPAIGN_HUB_A2A_AGENT_CARD.md](./CAMPAIGN_HUB_A2A_AGENT_CARD.md)
- Product MAS guide: [CAMPAIGN_AGENTS_SYSTEM_GUIDE.md](./CAMPAIGN_AGENTS_SYSTEM_GUIDE.md)

---

## 10. Contacts

- Campaign agents / MAS owner: Campaign engineering  
- This document: `docs/CAMPAIGN_SFT_AGENT_CATALOG.md`
