# Folder & file map

Root: `worktual-campaign/worktual-campaign/`

## Agents service (`agents/`)

```text
agents/app/
  llm.py                 # Direct OpenAI-compatible client (no LangChain)
  memory.py              # Session memory facade over session_store
  session_store.py       # Durable session JSON (messages, campaign state)
  prompt_sections.py     # Shared 6-section prompt builder
  runtime/agent.py       # Bounded tool loop (LLM ↔ tools)
  socket_server.py       # Socket.IO + health (transport; to move to Fastify in P3)
  agents/
    routing.py           # Cross-module ROUTE_TO_MODULE helpers
    create_campaign/
      prompts.py         # 6-section builder + dynamic Context
      agent.py           # Turn coordinator (primary)
      graph.py           # Compatibility shim → agent.py
      tools/
        schemas.py       # Tool JSON schemas
        handlers.py      # Legacy/full handlers
        core_handlers.py # Core 5-tool wrappers
      user_replies.py    # User-facing tool message formatting
      org_context.py     # Org / audience summary for Context
    contacts/
      prompts.py
      agent.py / graph.py
      tools/
    forms/ ...
    reports/ ...
    monitoring/ ...
    recommendations/ ...
    events_report/ ...
    whatsapp_approved/ ...
    whatsapp_rejected/ ...
    template_coach/agent.py
    template_library/ ...
    template_generation_director/ ...  # planned generation orchestrator
    template_regulatory_advisor/ ...   # planned content-policy advisor
```

### Per-module layout (target)

| File | Role |
|------|------|
| `prompts.py` | `build_system_prompt(session, …)` → 6 sections; Context dynamic |
| `agent.py` | `run_*_turn` / coordinator; calls `run_tool_loop` |
| `tools/schemas.py` | OpenAI tool definitions |
| `tools/handlers.py` | Execute tools → backend APIs / session updates |
| `graph.py` | Thin re-export for old imports (until callers migrate) |

## Backend (`backend/`)

| Area | Role |
|------|------|
| `src/routes/` | REST API |
| `src/dao/` | Persistence (incl. push endpoints) |
| `src/plugins/socket.ts` | Socket.IO host (P3: agent turns) |
| Prisma `campaign` schema | Campaign-owned tables |

## Frontend (`frontend/`)

| Area | Role |
|------|------|
| Vite SPA | Portal UI |
| Agent socket clients | Join module rooms, send turns |
| Campaign drafts | Client-side draft list / handoff |

## Docs (`docs/campaign-agent-runtime/`)

This pack — update on every agent workflow change.
