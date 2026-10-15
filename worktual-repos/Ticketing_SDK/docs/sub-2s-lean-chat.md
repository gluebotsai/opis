# Sub-2s lean chat (single graph, cheap intent)

**Status:** Implemented (ai-agents graph: prepare → workflow_manager → commands shim → intent → policy → agents)  
**Related:** Frozen Option 2 — [`.cursor/plans/hybrid_langgraph_option_2_e4e69909.plan.md`](../.cursor/plans/hybrid_langgraph_option_2_e4e69909.plan.md) · [`architecture-freeze.md`](./architecture-freeze.md)

## Goal

- **Hard SLO:** no-tool turns (GREETING / CHAT / simple NAVIGATE phrasing) **&lt;2s** end-to-end.
- **Tool turns:** max **one** tool round + one final LLM reply; pass **tool JSON only**; aim &lt;2s when Express is fast.
- **One LangGraph entry** — no separate FastLane / LeanAgent pipelines. **GeneralAgent is the fast path** (small prompt, no tools).
- **Hybrid unchanged:** reply + `ui_actions`; React applies nav/filters/wizards; Express sole mutate/RBAC/DB.
- **No static chat text:** every painted reply from the agent LLM; seeds = intent hints only.

## Refinements (locked)

| Rejected | Do instead |
|----------|------------|
| Separate Fast Lane + Hybrid + Lean Agent code paths | One graph; agents differ by prompt + tool allowlist |
| Expand `_is_greeting_or_chitchat()` regex forever | **Cheap Intent** classifier → `GREETING` / `CHAT` / … |
| `DATA_INSTRUCTION` + `build_live_context` dump every turn | Delete dump path; facts from **tool results only** |
| “Reason before answer” in prompts | Answer directly; no user-visible CoT instructions |
| Multi-hop tool loops | **Max one** tool round then final reply |

## Target graph

```mermaid
flowchart TD
  user[User]
  react[React]
  gateway[Express_Gateway]
  graph[LangGraph]
  hydrate[Context_Hydration]
  intent[Cheap_Intent]
  policy[Permission_Policy]
  router[Agent_Router]
  general[GeneralAgent]
  ticket[TicketAgent]
  customer[CustomerAgent]
  kb[KnowledgeAgent]
  toolReg[Tool_Registry]
  http[Shared_HTTP_Client]
  apis[Express_APIs]
  db[(Postgres)]
  fmt[Response_Formatter]

  user --> react --> gateway --> graph
  graph --> hydrate --> intent --> policy --> router
  router --> general
  router --> ticket
  router --> customer
  router --> kb
  general -->|"tools empty for GREETING"| fmt
  ticket -->|"Needs tool?"| toolReg
  customer --> toolReg
  kb --> toolReg
  toolReg --> http --> apis --> db
  toolReg -->|"tool JSON"| ticket
  ticket --> fmt
  customer --> fmt
  kb --> fmt
  fmt -->|"reply + ui_actions"| gateway --> react
```

**Example turns**

- `hiiii` / `wassup` → Intent `GREETING` → **GeneralAgent** → no tools → small prompt → LLM reply (&lt;2s).
- `open macros` → Intent `NAVIGATE` → GeneralAgent (or policy) → `ui_actions` + short LLM reply; no DB.
- `show my open tickets` → Intent `TICKET` / `SEARCH` → **TicketAgent** → may call `list_tickets` → Express → tool JSON → final LLM sentence.
- `escalate 123` → Intent `UPDATE` → TicketAgent → `escalate_ticket` tool → Express → confirm via LLM.

## Prompt architecture (every agent)

Only:

1. **Global** — identity, tone, safety, output format, never invent facts, never invent login walls
2. **Agent** — Ticket / Customer / Knowledge / General focus (short)
3. **Conversation** — bounded history
4. **Tool result** — only if a tool ran this turn (compact JSON)

**Delete from the normal path:** `DATA_INSTRUCTION`, org-wide live dumps, role-module essays unless policy injects a one-liner, forced “explain your reasoning” blocks.

## Cheap Intent (not regex)

Replace today’s dual path (commands greeting regex + router LLM) with **one** tiny classifier node:

- Labels: `GREETING` | `CHAT` | `TICKET` | `CUSTOMER` | `KB` | `CREATE` | `UPDATE` | `SEARCH` | `NAVIGATE` (extend only if product needs).
- Prompt: classify only; reply with **one label word**; no explanation.
- Same model OK if prompt stays tiny (today’s router ~0.6s is the budget ceiling); map label → agent + tool allowlist + whether `ui_actions` resolution is needed.
- **Do not** maintain elongated-greeting regex lists (`hiiii`, `heyyyy`, …).

Pending guided drafts (macro/team/kb/ticket wizards) stay **state-first**: if an active draft/nextStep exists in context, skip re-classify or force the matching CREATE/UPDATE path so hybrid multi-turn is not broken.

## Agent behavior

| Agent | Tools | Typical intents |
|-------|-------|-----------------|
| **GeneralAgent** | None (or nav-only helpers that emit `ui_actions`, no Postgres dump) | GREETING, CHAT, NAVIGATE, platform help |
| **TicketAgent** | Allowlist: list/get/escalate/update/note/create as today | TICKET, SEARCH, CREATE, UPDATE |
| **CustomerAgent** | `list_customers`, … | CUSTOMER |
| **KnowledgeAgent** | `list_kb`, … | KB |

Shared runner (evolve `ai-agents/app/agents/base.py`):

1. `bind_tools(allowlist)` — empty list for GREETING/CHAT on GeneralAgent.
2. First invoke → if `tool_calls`, execute **once** via registry → Shared HTTP → Express.
3. Second invoke with **tool JSON only** → final text.
4. If no tool_calls → use first reply text.
5. `max_tokens` capped (~120–200) so replies stay short.

## Hybrid / commands

- Keep emitting `{ reply, ui_actions }` for navigate / filters / create wizards; React (`ui-frontend/src/App.tsx`, coworker action helpers) unchanged.
- Fold imperative mutate/nav that today lives only in `ai-agents/app/tasks/chat_commands.py` into **intent → agent → tool / ui_actions** where safe; do **not** leave a permanent parallel “FastLane” that bypasses the graph.
- Short-term: thin compatibility shim inside the graph (intent NAVIGATE/CREATE still produces the same action shapes) so E2E hybrid does not regress.
- Dashboard metrics remain **React → Express only** (never through LangGraph).

## Implementation phases

### Phase 1 — Cheap Intent + graph routing

- Add intent node (tiny LLM classifier); map labels → `general` | `tickets` | `customers` | `kb`.
- Retire greeting regex as the routing source of truth; remove `_is_greeting_or_chitchat` from the critical path (may delete or leave unused until cleanup).
- Wire Agent Router from intent (replace/supersede current `ai-agents/app/agents/router.py` specialist labels).

### Phase 2 — Lean agents + tools

- Rewrite agent prompts in `ai-agents/app/prompts.py`: Global + Agent only; delete `_AGENT_REASONING` / “reason before answer”.
- Rewrite `ai-agents/app/agents/base.py`: remove `DATA_INSTRUCTION` and `build_live_context` from default; `bind_tools` + max 1 tool round; log `ms=`.
- Ensure GeneralAgent GREETING/CHAT path never hits Express/Postgres.

### Phase 3 — Hybrid verify + cleanup

- Preserve create/escalate/macro/nav E2E; replies still LLM-only.
- Latency smoke: GREETING &lt;2s, zero DB; SEARCH uses tool not dump.
- Remove dead `live_data` call sites when unused; no hardcoded chat strings or fake business data.

## Out of scope

- Streaming/SSE (Option 2 Phase 7).
- Extra agents (Priority/Resolver) until v1 stable.
- Changing Express RBAC or React metrics path.

## Key files

- `ai-agents/app/graph.py` — single path nodes/edges
- New or evolved intent module (e.g. `app/agents/intent.py`) — cheap classifier
- `ai-agents/app/agents/router.py` — map intent → agent
- `ai-agents/app/agents/base.py` — lean invoke + tools
- `ai-agents/app/prompts.py` — Global + Agent prompts
- `ai-agents/app/tools/registry.py` — allowlists
- `ai-agents/app/tasks/chat_commands.py` — shrink/fold into graph; no greeting FastLane
- Tests: intent labels, GREETING no tools/DB, tool JSON path, hybrid ui_actions

## Success criteria

- One `/chat` → LangGraph path for all message types.
- `hiiii` / `wassup` / `good morning`: Intent GREETING → GeneralAgent → **one** small LLM → **0** tools/DB → LLM reply **&lt;2s**.
- Ticket questions: tool JSON in, no org dump, max one tool round.
- Hybrid nav/create/escalate still work; no static painted replies; no fake metrics.

## Implementation todos

1. Replace router + regex greetings with one Cheap Intent classifier (`GREETING` / `CHAT` / `TICKET` / `CUSTOMER` / `KB` / `CREATE` / `UPDATE` / `SEARCH` / `NAVIGATE`); tiny prompt, label only.
2. One graph entry — Context → Intent → Policy → AgentRouter → General | Ticket | Customer | Knowledge → Formatter; GeneralAgent empty tools for GREETING/CHAT; no FastLane/LeanAgent forks.
3. Delete `DATA_INSTRUCTION` + forced CoT; Global + Agent + history (+ tool JSON only); bind_tools allowlist; max 1 tool round; retire `build_live_context` from default path.
4. Preserve ui_actions / create / escalate hybrid; E2E + latency smoke (greeting &lt;2s, 0 DB); no static replies or hardcoded business data.
