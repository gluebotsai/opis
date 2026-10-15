# SFT handoff — CRM agent catalog APIs

**Audience:** SFT / synthetic-data team  
**Producer:** Worktual CRM A2A spoke (port **8020**)  
**Purpose:** Cron-pull agent definitions (system prompt, tools, skills, sample conversations) and generate synthetic conversation data with an LLM pipeline.  
**Format:** JSON only  
**Auth:** Internal service key (not the public Agent Card)

This is **not** the Hub Agent Card (`/.well-known/agent-card.json`). That card lists Hub *skills* (`contact-crud`, `enrich-lead`, …). These APIs list *agents* as they run in NLP.

---

## 1. Base URL

| Environment | Base |
|-------------|------|
| Local (LAN IP) | `http://192.168.13.159:8020` |

Health check: `GET {BASE}/health` — e.g. `http://192.168.13.159:8020/health`.

LAN IP can change with DHCP; if it does, update `A2A_PUBLIC_URL` and this table.

---

## 2. Authentication

Every catalog request needs:

```http
x-internal-service-key: <A2A_SPOKE_CLIENT_SECRET from ai-service/.env>
```

Same value as **`A2A_SPOKE_CLIENT_SECRET`** on the machine running `uvicorn app.a2a_main:app` (local: `ai-service/.env`). Ask the CRM owner for the current dev/QA value. Do **not** put system prompts on a public unauthenticated URL.

Missing or wrong key → **401**.

Bearer Hub / spoke access JWTs are also accepted (`Authorization: Bearer <access_token>` from `POST /token`).

---

## 3. The three APIs

Use **export** on the cron. Use **list** and **detail** for debugging or partial reruns.

| # | Method | Path | Use |
|---|--------|------|-----|
| 1 | `GET` | `/internal/v1/agents` | List agents (summaries) |
| 2 | `GET` | `/internal/v1/agents/{id}` | One agent, full payload |
| 3 | `GET` | `/internal/v1/agents/export` | All agents, full payload |

`{id}` examples: `contact-agent`, `deal-agent`, `crm_super`, `enrich-lead`, `proposal-generate`. `crm-agent` is an alias of `crm_super`.

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
  "agentCount": 61,
  "agents": [
    {
      "id": "contact-agent",
      "name": "contact-agent",
      "family": "coworker",
      "layer": "executor",
      "surfaces": ["contact-list", "contact-create", "contact-detail"],
      "promptVersion": "a1b2c3d4e5f6",
      "mcpServers": ["coworker"],
      "skillCount": 0,
      "toolCount": 10,
      "sampleConversationCount": 0
    }
  ]
}
```

### 3.2 One agent

```http
GET /internal/v1/agents/contact-agent
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
  "agentCount": 61,
  "agents": [ { "...full agent object..." } ]
}
```

Re-fetch when `version` or any agent's `promptVersion` changes. Cache the export for the job; it is large (full prompts + tool schemas). CRM v1 ships empty `skills` and `sampleConversations` arrays.

---

## 4. Agent object (detail / export)

| Field | Type | Meaning |
|-------|------|---------|
| `id` / `name` | string | Agent id (`contact-agent`, `enrich-lead`, …) |
| `family` | `coworker` \| `job` | Do **not** mix these in one SFT mix without a label |
| `layer` | `super` \| `executor` | L1 router / worker |
| `surfaces` | string[] | UI or job surfaces this agent is allowed on |
| `systemPrompt` | string | Full assembled system prompt (Role→Goal→… template) |
| `promptVersion` | string | Content hash of the prompt |
| `agentDocumentPath` | string \| null | Repo path of `agent.md` if it exists |
| `mcpServers` | string[] | MCP servers the agent may call |
| `tools` | object[] | Tools the model may call (MCP + runtime handoff) |
| `skills` | object[] | Procedural skill packs (empty in CRM v1) |
| `handoffTargets` | string[] | Agents this one may `route_to_agent` to |
| `sampleConversations` | object[] | Gold threads (empty in CRM v1; handwritten JSON is restamped separately) |
| `metricDomains` | string[] | Analytics metric domains when used |
| `maxToolRounds` | number | Runtime tool-round cap |

### Tool

```json
{
  "server": "coworker",
  "name": "propose_create_contact",
  "description": "Persist a new contact overlay after explicit confirmation.",
  "inputSchema": { "type": "object", "properties": {}, "required": [] },
  "kind": "mcp"
}
```

`kind`:

- `mcp` — business / coworker MCP tool
- `runtime_handoff` — `route_to_agent` (L1 super and executors). L1 must not call business tools.

### Skill

```json
{
  "id": "contact-create",
  "name": "Contact Create",
  "description": "Collect fields, stage a draft, create only after confirmation.",
  "version": 2,
  "required": false,
  "triggers": ["create contact"],
  "toolsPreferred": ["patch_contact_draft", "propose_create_contact"],
  "workflow": ["..."],
  "rules": ["..."],
  "body": "Start by staging mode=create ...",
  "missing": false
}
```

Skills are **instructions**, not permissions. CRM v1 exports `skills: []`. The model still needs the matching MCP tool.

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
      "tools": ["patch_contact_draft", "propose_create_contact"]
    }
  ]
}
```

CRM v1 exports `sampleConversations: []`. Handwritten coworker threads live in `scripts/generate_crm_sft_conversations.py` and are restamped from this export. Coworker assistant text is usually compact **HTML** (`<p>`, lists, tables). Job agents return structured JSON. Match the agent's `input/output` style from `systemPrompt`.

---

## 5. Agents in this catalog

| id | family | layer | Typical job |
|----|--------|-------|-------------|
| `crm_super` | coworker | super | Route to one specialist. No business tools. Empty user-visible text on handoff. |
| `contact-agent` | coworker | executor | Search / create / update / delete contact overlays |
| `company-agent` | coworker | executor | Company and location drafts |
| `deal-agent` | coworker | executor | Pipeline deals and proposal-create (after BRD attach) |
| `proposal-agent` | coworker | executor | Open proposal document rewrite / patch / send |
| `product-agent` | coworker | executor | `inventory.products` DML only |
| `reports-analytics-agent` | coworker | executor | Dashboard / reports KPIs |
| `link-agent` | coworker | executor | Quotes, invoices, activities, cross-module nav |
| `seo-content-generator` | coworker | executor | Marketing keywords, content, social |
| `hello` | job | executor | Probe / liveness |
| `chat` | job | executor | Prompt-only chat assist |
| `enrich-lead` | job | executor | Firmographic overlay enrich |
| `score-lead` | job | executor | Fit + intent score |
| `summarize-lead` | job | executor | Persist lead summary |
| `nurture-lead` | job | executor | Below-gate nurture |
| `lifecycle-lead` | job | executor | Lifecycle step |
| `hygiene` | job | executor | Data hygiene |
| `daily-briefing` | job | executor | Daily briefing |
| `assign-sales` | job | executor | Owner assign |
| `welcome-lead` | job | executor | Welcome email |
| `owner-change-notify` | job | executor | Owner-change mail |
| `audit-forecast` | job | executor | Forecast audit |
| `compliance-privacy` | job | executor | Privacy / compliance |
| `invoice-escalation` | job | executor | Overdue invoice escalate |
| `expansion-matcher` | job | executor | Expansion match |
| `analyze-transcript` | job | executor | Meeting transcript |
| `auto-reply-email` | job | executor | Inbox auto-reply |
| `assist-meeting` | job | executor | In-meeting assist |
| `meeting-brief-email` | job | executor | Pre-meeting brief |
| `meeting-mom` | job | executor | Minutes of meeting |
| `meeting-miss-escalation` | job | executor | Missed-meeting escalate |
| `post-meeting-process` | job | executor | Post-meeting follow-up |
| `prospect-search` | job | executor | Prospect search |
| `prospect-qualify` | job | executor | Prospect qualify |
| `prospect-personnel` | job | executor | Prospect personnel |
| `sales-coach` | job | executor | Call / meeting coach |
| `compose-email` | job | executor | Compose outbound mail |
| `send-outbound-email` | job | executor | Send composed mail |
| `document-template` | job | executor | Document template |
| `document-template-edit` | job | executor | Template edit |
| `document-template-chat` | job | executor | Template chat |
| `document-clone-personalize` | job | executor | Clone / personalize |
| `proposal-content` | job | executor | Proposal content fill |
| `proposal-corpus-ingest` | job | executor | Corpus ingest |
| `proposal-corpus-extract` | job | executor | Corpus extract |
| `proposal-corpus-structure` | job | executor | Corpus structure |
| `proposal-corpus-pair` | job | executor | BRD–proposal pair |
| `proposal-corpus-case-study` | job | executor | Case-study analysis |
| `proposal-corpus-design-geometry` | job | executor | Design geometry |
| `proposal-corpus-design-critique` | job | executor | Design critique |
| `proposal-corpus-section-deep` | job | executor | Section deep-read |
| `proposal-corpus-features` | job | executor | Feature schema |
| `proposal-playbook-freeze` | job | executor | Freeze playbook HTML |
| `proposal-playbook-synthesize` | job | executor | Synthesize playbook |
| `proposal-playbook-cluster` | job | executor | Cluster playbooks |
| `proposal-playbook-qa` | job | executor | Playbook QA |
| `proposal-requirement-profile` | job | executor | Requirement profile |
| `proposal-playbook-match` | job | executor | Match playbook |
| `proposal-generate` | job | executor | Generate proposal |
| `proposal-generate-section` | job | executor | Generate one section |
| `proposal-content-qa` | job | executor | Generated-content QA |

---

## 6. How to generate synthetic data

Recommended cron:

1. `GET /internal/v1/agents/export`
2. For each agent (or a family/layer subset):
   - Use `systemPrompt` as the teacher/system side
   - Offer `tools` (name + description + `inputSchema`)
   - When the task matches a skill, include that skill `body` / `workflow` / `rules`
   - Use `sampleConversations` as few-shot seeds (empty in CRM v1 — restamp handwritten threads from `scripts/generate_crm_sft_conversations.py`)
3. Generate extra threads that stay on-policy:
   - L1: only `route_to_agent` (tool-only handoff turns in gold threads)
   - Contact/company/deal writes: patch draft, then confirm, then `propose_*`
   - Proposal create: wait for `requirementPdfAttached` before `propose_create_proposal`
   - Job agents: structured JSON only — do not invent coworker HTML
4. Keep `family` and `layer` as labels on every generated example

Do not train coworker contact flows as job-agent JSON, or L1 routing as L3 tool use.

---

## 7. curl examples

```bash
BASE=http://192.168.13.159:8020
KEY=<A2A_SPOKE_CLIENT_SECRET>

curl -sS -H "x-internal-service-key: $KEY" "$BASE/internal/v1/agents" | jq '.agents[].id'

curl -sS -H "x-internal-service-key: $KEY" "$BASE/internal/v1/agents/contact-agent" | jq '.agent | {id, layer, tools: [.tools[].name], skills: [.skills[].id]}'

curl -sS -H "x-internal-service-key: $KEY" "$BASE/internal/v1/agents/export" -o agents-export.json
```

---

## 8. Source of truth (CRM)

| Data | Repo path |
|------|-----------|
| Prompts | `ai-service/app/agents/crm_tools.py` (`build_system_prompt`) and module-level `SYSTEM` / `COMPOSE_SYSTEM` on job agents; `agent.md` when present |
| Wiring | `ai-service/app/agents/__init__.py` (`REGISTRY`) + `ai-service/app/agents/coworker_native.py` |
| Tools | `ai-service/app/mcp/catalog.py` |
| Skills | none in CRM v1 (`skills: []`) |
| Samples | `scripts/generate_crm_sft_conversations.py` (restamped; catalog arrays stay empty) |
| HTTP | `ai-service/app/a2a/server.py` |
| Builder | `ai-service/app/a2a/sft_catalog.py` |

When CRM adds an agent, tool, or skill, this export updates automatically from those files. Re-pull export; do not keep a stale snapshot as the only source.

Catalog schema version today: **`1.0.0`**.

---

## 9. Contacts

- CRM A2A / NLP owner: CRM engineering
- This document: `docs/sft-agent-catalog.md`
