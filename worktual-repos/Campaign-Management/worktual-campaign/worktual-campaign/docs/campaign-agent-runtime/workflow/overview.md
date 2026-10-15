# End-to-end agent turn (overview)

```mermaid
sequenceDiagram
  participant U as User (SPA)
  participant T as Transport (Socket.IO agents :8005 today)
  participant A as Module agent.py
  participant P as prompts.build_system_prompt
  participant L as run_tool_loop + LLM
  participant H as Tool handlers
  participant API as Fastify :3001

  U->>T: join room + user message
  T->>A: run_*_turn(session_id, token, text)
  A->>P: build 6-section prompt (dynamic Context)
  A->>L: messages + tools
  loop up to max_rounds
    L->>H: tool_call(name, args)
    H->>API: REST when needed
    H-->>L: tool result JSON
  end
  L-->>A: assistant text + tool results
  A-->>T: reply + state_update + ui_events
  T-->>U: chat + sidebar sync
```

## Principles

1. **Module routing** — client sends `module` (or hub opens a destination). Server runs that module’s agent. Cross-module moves use LLM tools (`ROUTE_TO_MODULE`, `OPEN_HUB_DESTINATION`).
2. **No happy-path regex** on user text for tool choice.
3. **Tools change state**; chat text explains results.
4. **User-facing replies** prefer tool `message` when authoritative tools ran; never leak internal tool names.

## Shared runtime

- `agents/app/llm.py` — LLM client
- `agents/app/runtime/agent.py` — `run_tool_loop`
- `agents/app/memory.py` / `session_store.py` — session messages + campaign state
- `agents/app/prompt_sections.py` — sectioned prompts

See per-module files under `workflow/`.
