# SFT handoff — Ticketing agent catalog APIs

**Audience:** SFT / synthetic-data team  
**Producer:** Worktual Ticketing SFT catalog process (port **8022**, `TICKETING_SFT_PORT`)  
**Purpose:** Cron-pull agent definitions (system prompt, tools, skills, sample conversations) and generate synthetic conversation data with an LLM pipeline.  
**Format:** JSON only  
**Auth:** Internal service key (not the public Agent Card)

This is **not** the Hub Agent Card (`/.well-known/agent-card.json` on A2A `:8021`). That card lists Hub *skills* (`tk.super-agent.route`, …). These APIs list *agents* as they run in Ticketing NLP.

Short codes such as `ARA`, `STDA`, `WLOA`, `ITRA` are **internal** Python / `SPEC.agent_id` only. They are **not** catalog keys. Every `id` and `name` on these three APIs is a full agent name.

After adding a new `agent.md` or a new proactive `_MODULES` entry, restart the `:8022` process so the next GET sees it. The catalog is rebuilt per request from disk + the registry; it is not a hardcoded id list.

---

## 1. Base URL

| Environment | Base |
|-------------|------|
| Local (loopback) | `http://localhost:8022` |
| Local (LAN IP) | `http://<ticketing-host-lan-ip>:8022` |
| QA | Ask Ticketing DevOps for the public prefix that routes to port 8022 |

Same process, two local URLs. Use the LAN IP when the SFT cron or another machine cannot reach `localhost`. Health check: `GET {BASE}/health` — e.g. `http://localhost:8022/health`.

Start locally:

```bash
npm run dev:sft
# or
cd ai-agents && .venv/bin/uvicorn app.sft_main:app --host 0.0.0.0 --port 8022
```

LAN IP can change with DHCP; if it does, update this table.

---

## 2. Authentication

Every catalog request needs:

```http
x-internal-service-key: <INTERNAL_SERVICE_KEY>
```

Ticketing setting: `INTERNAL_SERVICE_KEY`. If that is empty **locally**, the `:8022` process falls back to `COWORKER_TASKS_SECRET` (same secret Express already uses). Read the value from the Ticketing host env (root `.env`); never paste a live secret into this document or into chat.

**QA / prod:** do not use a local or laptop hex. Ask the Ticketing owner for that environment’s `INTERNAL_SERVICE_KEY` (or the `COWORKER_TASKS_SECRET` they mapped for SFT). Wrong or missing key → **401**.

Do **not** put system prompts on a public unauthenticated URL.

`GET /health` does not require the key.

---

## 3. The three APIs

Use **export** on the cron. Use **list** and **detail** for debugging or partial reruns.

| # | Method | Path | Use |
|---|--------|------|-----|
| 1 | `GET` | `/internal/v1/agents` | List agents (summaries) |
| 2 | `GET` | `/internal/v1/agents/{id}` | One agent, full payload |
| 3 | `GET` | `/internal/v1/agents/export` | All agents, full payload |

`{id}` examples: `ticketing_super_agent`, `catalog_administration_domain`, `ticket_lifecycle_executor`, `autonomous_resolution_agent`, `similar_ticket_detection_agent`.

Unknown `{id}` → **404**. Do not call `/internal/v1/agents/ara` or other short codes.

### 3.1 List

```http
GET /internal/v1/agents
x-internal-service-key: <key>
```

```json
{
  "version": "1.0.0",
  "source": "ticketing-nlp-agent-definitions",
  "agentCount": 46,
  "agents": [
    {
      "id": "ticketing_super_agent",
      "name": "Ticketing Super Agent",
      "family": "coworker",
      "layer": "super",
      "surfaces": ["staff-chat"],
      "promptVersion": "a1b2c3d4e5f6",
      "mcpServers": [],
      "skillCount": 0,
      "toolCount": 4,
      "sampleConversationCount": 0
    }
  ]
}
```

`agentCount` is live (`len(coworker agent.md folders) + len(proactive registry)`). Do not treat a snapshot number as the contract.

### 3.2 One agent

```http
GET /internal/v1/agents/autonomous_resolution_agent
x-internal-service-key: <key>
```

```json
{
  "version": "1.0.0",
  "source": "ticketing-nlp-agent-definitions",
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
  "source": "ticketing-nlp-agent-definitions",
  "agentCount": 46,
  "agents": [ { "...full agent object..." } ]
}
```

Re-fetch when `version` or any agent's `promptVersion` changes. Cache the export for the job; it is large (full prompts + tool schemas + skill bodies).

---

## 4. Agent object (detail / export)

| Field | Type | Meaning |
|-------|------|---------|
| `id` / `name` | string | Full-name slug and title. Never `ara` / `STDA`. |
| `family` | `coworker` \| `proactive` | Staff chat MAS vs event-driven proactive. Do **not** mix these in one SFT mix without a label. Ticketing has no Support Bot family. |
| `layer` | `super` \| `domain` \| `executor` | Super routes; Domain delegates; Executor / proactive worker |
| `surfaces` | string[] | Staff modules or `approvals` for proactive |
| `systemPrompt` | string | Full `agent.md` (coworker) or synthesized contract (proactive) |
| `promptVersion` | string | sha256 of the prompt text, 12 hex chars |
| `agentDocumentPath` | string \| null | Repo path of `agent.md` or the proactive module |
| `mcpServers` | string[] | MCP servers the agent may call |
| `tools` | object[] | Tools the model may call (MCP + runtime handoff) |
| `skills` | object[] | Procedural skill packs (workflow text) |
| `handoffTargets` | string[] | Agents this one may hand off to |
| `sampleConversations` | object[] | Gold threads from `definitions/<id>/samples.json` when present |
| `metricDomains` | string[] | Unused today (empty) |
| `maxToolRounds` | number | Runtime tool-round cap |

### Tool

```json
{
  "server": "ticketing",
  "name": "create_ticket",
  "description": "Create a ticket after explicit confirmation.",
  "inputSchema": { "type": "object", "properties": {}, "required": [] },
  "kind": "mcp"
}
```

`kind`:

- `mcp` — business / skill tool
- `runtime_handoff` — Super / Domain only (`route_to_domain`, `continue_active_task`, `resume_task`, `refuse_capability`, `delegate_to_executor`, `return_to_super`). Super and Domain must not call business tools.

### Skill

```json
{
  "id": "ticket-reassign",
  "name": "Ticket Reassign",
  "description": "Collect the ticket and assignee, confirm, then reassign.",
  "version": "1.0.0",
  "required": false,
  "triggers": [],
  "toolsPreferred": ["list_tickets", "get_ticket", "update_ticket"],
  "workflow": [],
  "rules": [],
  "body": "Start by resolving the focused ticket...",
  "missing": false
}
```

Skills are **instructions**, not permissions. The model still needs the matching MCP tool.

### Sample conversation

```json
{
  "id": "ticket-reassign-happy-path",
  "title": "Reassign the focused ticket after confirmation",
  "turns": [
    { "role": "user", "content": "Reassign this ticket to Priya" },
    {
      "role": "assistant",
      "content": "I can move this ticket to Priya after you confirm.",
      "tools": ["patch_reassign_draft", "update_ticket"]
    }
  ]
}
```

Staff coworker replies are **plain conversational prose** (no `#` headings, no `*` bold/bullets). Proactive agents write Approvals summaries, not staff-chat HTML.

---

## 5. Agents in this catalog

Counts come from the API, not this table. A new `agent.md` or proactive module appears on the next GET after `:8022` restart.

### 5.1 Coworker (staff chat MAS)

| id | family | layer | Typical job |
|----|--------|-------|-------------|
| `ticketing_super_agent` | coworker | super | Route to one Domain. No business tools. |
| `catalog_administration_domain` | coworker | domain | Delegate catalog / analytics Executors |
| `intake_deflection_domain` | coworker | domain | Delegate ticket create or intake deflection |
| `knowledge_domain` | coworker | domain | Delegate similar-ticket / resolution-knowledge Executors |
| `resolution_lifecycle_domain` | coworker | domain | Delegate ticket list / update / reassign / escalate Executors |
| `triage_routing_domain` | coworker | domain | Delegate classify / assign / workload Executors |
| `ai_resolution_executor` | coworker | executor | Intake self-service deflection |
| `analytics_audit_query_executor` | coworker | executor | Analytics, CSAT, audit queries |
| `automation_rule_crud_executor` | coworker | executor | Automation rules CRUD |
| `autonomous_resolution_executor` | coworker | executor | Close / reopen after confirmation |
| `classification_priority_executor` | coworker | executor | Classify and prioritize a ticket |
| `customer_directory_crud_executor` | coworker | executor | Customer directory CRUD / import |
| `customer_reply_drafting_executor` | coworker | executor | Draft a customer reply |
| `insights_analytics_executor` | coworker | executor | Narrative insights |
| `intelligent_assignment_executor` | coworker | executor | Assign the best agent |
| `investigation_summary_executor` | coworker | executor | Ticket investigation summary |
| `kb_quality_crud_executor` | coworker | executor | KB article CRUD / publish |
| `macro_crud_executor` | coworker | executor | Macro CRUD |
| `notification_inbox_executor` | coworker | executor | Personalized notification delivery |
| `org_settings_integrations_executor` | coworker | executor | Org prefs, widgets, keys |
| `personalized_notification_executor` | coworker | executor | Staff notification personalization |
| `priority_status_crud_executor` | coworker | executor | Priority / status catalog CRUD |
| `resolution_knowledge_executor` | coworker | executor | Recommend KB for a ticket |
| `resolution_quality_executor` | coworker | executor | Resolution quality check |
| `root_cause_learning_executor` | coworker | executor | Learn routing weights |
| `similar_ticket_detection_executor` | coworker | executor | Detect similar tickets (assist) |
| `sla_escalation_executor` | coworker | executor | SLA monitor / escalate |
| `team_queue_crud_executor` | coworker | executor | Teams / queues / members |
| `ticket_creation_executor` | coworker | executor | Create ticket |
| `ticket_lifecycle_executor` | coworker | executor | List, open, update, note, reassign, resolve |
| `workload_optimization_executor` | coworker | executor | Workload balancing |

### 5.2 Proactive (events / schedules → Approvals)

| id | name | family | layer | Typical job |
|----|------|--------|-------|-------------|
| `ticket_creation_and_capture_agent` | Ticket Creation and Capture Agent | proactive | executor | Inbound message → propose create ticket |
| `deflection_and_self_service_agent` | Deflection and Self-Service Agent | proactive | executor | Inbound how-to → KB deflection |
| `classification_and_prioritization_agent` | Classification and Prioritization Agent | proactive | executor | New ticket category / priority |
| `intelligent_routing_agent` | Intelligent Routing Agent | proactive | executor | Suggest assignee / queue |
| `resolution_knowledge_agent` | Resolution Knowledge Agent | proactive | executor | Recommend KB on a ticket |
| `similar_ticket_detection_agent` | Similar Ticket Detection Agent | proactive | executor | Similar / duplicate recommendation |
| `autonomous_resolution_agent` | Autonomous Resolution Agent | proactive | executor | Propose resolve / reopen (Approvals) |
| `ticket_summary_assistant` | Ticket Summary Assistant | proactive | executor | Keep the ticket summary current |
| `customer_response_drafting_agent` | Customer Response Drafting Agent | proactive | executor | Draft a customer reply |
| `resolution_quality_agent` | Resolution Quality Agent | proactive | executor | Check a Resolved close |
| `sla_and_escalation_agent` | SLA and Escalation Agent | proactive | executor | SLA risk / escalate |
| `personalized_notifications_agent` | Personalized Notifications Agent | proactive | executor | Staff bell notifications |
| `workload_optimization_agent` | Workload Optimization Agent | proactive | executor | Load-balance recommendation |
| `insights_and_analytics_agent` | Insights and Analytics Agent | proactive | executor | Org metric insights |
| `root_cause_and_learning_agent` | Root Cause and Learning Agent | proactive | executor | Recurring-issue routing weights |

ASGA is not an agent and is not listed.

---

## 6. How to generate synthetic data

Recommended cron:

1. `GET /internal/v1/agents/export`
2. For each agent (or a family/layer subset):
   - Use `systemPrompt` as the teacher/system side
   - Offer `tools` (name + description + `inputSchema`)
   - When the task matches a skill, include that skill `body` / `toolsPreferred`
   - Use `sampleConversations` as few-shot seeds when the array is not empty
3. Generate extra threads that stay on-policy:
   - Super: only `route_to_domain` / `continue_active_task` / `resume_task` / `refuse_capability`. No slot collect, no writes.
   - Domain: only `delegate_to_executor` / `return_to_super` / `refuse_capability`.
   - Executor writes: collect via `patch_*_draft`, confirm, then mutate. Existing ids come from list/get tool results — never invent ticket numbers or catalog ids.
   - Proactive: Approvals / recommendation family. Not Super → Domain → Executor staff chat. High-risk writes stay behind Confirm.
4. Keep `family` and `layer` as labels on every generated example

Do not train coworker ticket flows as proactive Approvals cards, or Super routing as Executor tool use.

---

## 7. curl examples

```bash
# Local loopback, or LAN IP from another machine:
# KEY = INTERNAL_SERVICE_KEY, or local COWORKER_TASKS_SECRET if that env is empty.
# QA/prod: get KEY from Ticketing — do not reuse a laptop secret.
BASE=http://localhost:8022
KEY=

curl -sS "$BASE/health"

curl -sS -H "x-internal-service-key: $KEY" "$BASE/internal/v1/agents" \
  | jq '.agents[] | {id,name,family,layer}'

curl -sS -H "x-internal-service-key: $KEY" \
  "$BASE/internal/v1/agents/ticketing_super_agent" \
  | jq '.agent | {id, name, layer, tools: [.tools[].name]}'

curl -sS -H "x-internal-service-key: $KEY" \
  "$BASE/internal/v1/agents/autonomous_resolution_agent" \
  | jq '.agent | {id, name, family, tools: [.tools[].name], skills: [.skills[].id]}'

curl -sS -H "x-internal-service-key: $KEY" \
  "$BASE/internal/v1/agents/export" -o ticketing-agents-export.json
```

---

## 8. Source of truth (Ticketing)

| Data | Repo path |
|------|-----------|
| Coworker prompts | `ai-agents/app/agents/definitions/<id>/agent.md` |
| Skills | `ai-agents/app/skills/<skill-id>/SKILL.md` |
| Tools | `shared/ticketing_tool_catalog.json` |
| Proactive registry | `ai-agents/app/proactive/registry_agents.py` (`_MODULES`) |
| Proactive display name | `AgentSpec.full_name` in each proactive module |
| Samples | `ai-agents/app/agents/definitions/<id>/samples.json` (optional) |
| HTTP | `ai-agents/app/sft/server.py` |
| Builder | `ai-agents/app/sft/catalog.py` |
| Process | `ai-agents/app/sft_main.py` (port 8022) |

When Ticketing adds an agent, tool, or skill, this export updates from those files. Re-pull export; do not keep a stale snapshot as the only source.

Catalog schema version today: **`1.0.0`**.

---

## 9. Contacts

- Ticketing NLP / coworker owner: Ticketing engineering
- This document: `docs/SFT_AGENT_CATALOG.md`
