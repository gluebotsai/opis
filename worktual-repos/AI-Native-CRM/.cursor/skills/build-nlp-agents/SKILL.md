---
name: build-nlp-agents
description: >-
  Build NLP backend multi-agent systems with per-agent agent.md prompts, MCP
  server/client tools, supervisor-specialist orchestration, and working /
  short-term / long-term / preference memory. Use when creating or changing NLP
  agents, MCP tools, agent memory, multi-agent routing, coworker/support bots,
  or apps/nlp agent architecture.
---

# Build NLP Agents

Greenfield standard for Worktual NLP multi-agent systems. Prefer this over legacy prompt-module or keyword-routing patterns when they conflict.

## Non-negotiables

1. Every agent has `agents/<name>/agent.md` as the prompt source of truth.
2. Tools run as MCP servers; agents use an MCP client to list tools from declared servers and call them when needed.
3. Memory has four layers: working, short-term, long-term (Postgres), preference scratchpad (LLM-written).
4. Soft preferences inject into the prompt; hard preferences are enforced by verification tools.
5. Strictly, Agents should not work on rule based, if any query reach the nlp backend it should be processed only by agents not by any regex keyword match. Always llm should process and call tools to respond and perform Action.
6. Deterministic safety may remain outside agent reasoning: auth, tenant isolation, RBAC, payload limits, SQL/mutation deny-lists, schema validation.
7. Orchestration is supervisor/router + specialist agents. Handoffs are LLM tool calls (`route_to_agent` or equivalent), never keyword maps.

## When this skill applies

- New or changed agents under `apps/nlp`
- New MCP servers/tools for agents
- Agent memory / preference personalization
- Multi-agent routing / handoffs
- Refactors of support bot, coworker, or other NLP agents toward MAS

## Deliverables (v1)

When asked to build an agent or multi-agent slice, produce only:

1. `agents/<name>/agent.md`
2. Python `AgentDefinition` wiring that loads that file
3. MCP server stubs (if new tools are required)
4. Memory interfaces (working / short-term / long-term / preference)

Do **not** generate tests unless the user asks.

## Workflow

Copy and track:

```
Task Progress:
- [ ] 1. Define supervisor vs specialists
- [ ] 2. Write agents/<name>/agent.md for each agent
- [ ] 3. Wire AgentDefinition from agent.md
- [ ] 4. Declare MCP servers; implement/reuse servers
- [ ] 5. Ensure MCP client list_tools + call_tool path
- [ ] 6. Wire memory interfaces + preference injection
- [ ] 7. Wire hard-preference verification gates
- [ ] 8. Confirm no regex/keyword intent routing on query path
```

### 1. Orchestration

- One **supervisor/router** agent receives the user query.
- Supervisor uses LLM + tools to route to specialists.
- Specialists own bounded domains (inbox, contact, queue, analytics, support, etc.).
- Specialists may hand back or to another specialist via LLM tool call.
- Do not add `if "refund" in text` / regex intent tables for routing or replies.

### 2. Create `agent.md`

Path: `apps/nlp/agents/<name>/agent.md` (or project-agreed equivalent under NLP).

Required sections — use the template in [agent-template.md](agent-template.md):

- role
- goal
- instructions
- context
- skills
- guardrails
- input/output contract
- allowed MCP servers
- handoff targets
- memory policy
- approval policy
- evaluation criteria

Populate from product requirements. Keep instructions actionable. Put tool details in MCP servers, not giant prose.

### 3. Wire `AgentDefinition`

- Load/parse `agent.md` into the runtime system prompt (compose sections deterministically).
- Set `mcp_servers` from **allowed MCP servers**.
- Set handoff allowlist from **handoff targets**.
- Attach skill packs named in **skills**.
- Register the agent with the supervisor catalog.

Follow existing NLP package layout (`app/agents`, `app/runtime`, `app/mcp`) unless creating a new greenfield package the user names.

### 4. MCP tools

- Implement tools as MCP servers (FastMCP / project MCP pattern).
- In `agent.md`, declare only the servers that agent may use.
- At runtime:
  1. MCP client lists tools from those servers
  2. Tool schemas are exposed to the LLM
  3. LLM selects tools
  4. MCP client calls the tool with trusted tenant/user context
- Authorize every call (agent × surface × role) before execution.
- Never let the LLM invent server-side tenant IDs or bypass auth context.

### 5. Memory

| Layer | Store | Purpose | Who writes |
|---|---|---|---|
| Working | In-process | Current turn slot-filling / collected fields | Agent + tools |
| Short-term | In-process session | Current session messages / summary | Runtime |
| Long-term | Postgres | Past interaction memory across sessions | Tools / memory service |
| Preference scratchpad | Persist with user scope (Postgres recommended) | User preferences for personalization | **LLM via tools** |

Rules:

- Working memory clears or resets per task/turn boundary defined in agent.md memory policy.
- Short-term is session-scoped; summarize when overflowing.
- Long-term retrieval is tool-based or explicit memory service; inject only relevant snippets.
- Preferences: LLM calls tools such as `get_user_preferences` / `update_user_preference`.
- Soft preferences → prompt context for tone/format/personalization.
- Hard preferences → verification tools must block/allow (e.g. contact windows, channel bans).

See [memory.md](memory.md) for interface shapes.

### 6. Prompt assembly order

Build the system prompt in this order unless agent.md overrides:

1. role + goal
2. instructions + guardrails
3. input/output contract
4. skills excerpts (relevant only)
5. runtime context (tenant/surface/channel)
6. retrieved long-term memory (relevant only)
7. user preferences (soft)
8. hard preference constraints summary (for awareness; enforcement still in tools)
9. available tool list (from MCP list_tools)
10. handoff rules

### 7. Forbidden on the agent query path

- Regex/keyword intent classification for choosing the agent reply
- Hard-coded FAQ answer maps
- Keyword → tool name dispatch tables for business intents
- Borrowing another spoke’s permissions without declaration

Allowed outside agent reasoning:

- AuthN/AuthZ
- Rate limits
- Schema/payload validation
- SQL write deny-lists / tool authorization
- Hard preference verification after LLM proposes an action

## Review checklist

Before finishing:

- [ ] Every new agent has `agents/<name>/agent.md`
- [ ] Prompt includes all required sections
- [ ] MCP servers declared and tools discoverable via client
- [ ] Supervisor/specialist handoffs are LLM tool-based
- [ ] Working + short-term + long-term + preference paths exist
- [ ] Soft prefs injected; hard prefs verified by tools
- [ ] No regex/keyword intent routing on NLP request handling
- [ ] Outputs limited to the four v1 deliverables unless user asked for more

## References

- [agent-template.md](agent-template.md) — canonical `agent.md` template
- [memory.md](memory.md) — memory interface contracts
