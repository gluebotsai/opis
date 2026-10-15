# Process topology

## Today (campaign-ms)

```mermaid
flowchart TB
  subgraph Browser
    Vite[Vite :5173]
  end

  subgraph Host["Fastify API :3001"]
    REST[REST /api]
    SIO_idle[Socket.IO ping only]
  end

  subgraph Agents["Python agents :8005"]
    SIO[Socket.IO module turns]
    Loop[run_tool_loop]
    LLM[OpenAI-compatible LLM]
  end

  subgraph Data
    PG[(PostgreSQL campaign + accounts/cdp)]
  end

  Vite -->|REST JWT| REST
  Vite -->|Socket.IO JWT| SIO
  SIO --> Loop
  Loop --> LLM
  Loop -->|HTTP tools| REST
  REST --> PG
```

**Note:** Agent chat transport currently lands on **Python Socket.IO**. Backend Socket.IO is not the coworker turn path yet.

## Target (CRM migration blueprint)

```mermaid
flowchart TB
  subgraph Browser
    Vite[Vite SPA]
  end

  subgraph Fastify["Fastify :3001"]
    SIO[Socket.IO agent-turn]
    HTTP[POST /api/.../agent-turn]
    MCPJWT[Issue MCP JWT]
  end

  subgraph Python["Agents HTTP-only"]
    Orch[Agent API :8000]
    MCP[MCP :8010]
  end

  Vite --> SIO
  Vite --> HTTP
  SIO --> MCPJWT
  Fastify -->|POST /ai/v1/agents/:name/run| Orch
  Orch -->|McpClient| MCP
  MCP -->|mutations| Fastify
  Orch --> LLM[(LLM_BASE_URL)]
```

### Migration phases

| Phase | Status | Work |
|-------|--------|------|
| P0 | Done | This docs pack |
| P1 | Done | 6-section prompts + dynamic Context (all modules) |
| P2 | Done | `agent.py` layout, strip happy-path regex routing |
| P2b | Done | Create-campaign strategist journey (chat accept) |
| P3 | Planned | HTTP agent API; Fastify owns Socket.IO; Python HTTP-only |
| P4 | Planned | MCP `:8010` catalog + JWT |
| P5 | Planned | Orchestrator envelope, tool budget, optional Redis STM |

Never expose MCP or LLM URLs to the browser.
