# Campaign Agent Runtime

Living documentation for the Worktual Campaign **agent brain**: how agents run, how prompts are built, and how workflows change over time.

Related product/infra overview: [`../CAMPAIGN_MICROSERVICE.md`](../CAMPAIGN_MICROSERVICE.md)  
Architecture target (CRM blueprint): `ai-service-architecture-migration.md` (shared team doc)

---

## How to run (local)

From repo root `worktual-campaign/worktual-campaign/`:

```bash
npm run dev:backend      # Fastify API :3001
npm run dev:frontend     # Vite SPA :5173
npm run dev:agents       # Python agents :8005 (Socket.IO today)
```

Optional:

```bash
npm run dev:webpush      # Web-push demo site :5500
npm run dev:public-site  # Public Vite :4173
```

| Service | Port | Health |
|---------|------|--------|
| Campaign API | 3001 | `GET /health` |
| Portal SPA | 5173 | UI |
| Agents | 8005 | `GET /health` |

Agents use a separate Python venv — see `agents/README.md`.

---

## Docs in this pack

| File | Purpose |
|------|---------|
| [`topology.md`](./topology.md) | Processes today vs CRM target (MCP, Fastify Socket.IO) |
| [`folder-map.md`](./folder-map.md) | Folder & file responsibilities |
| [`prompt-contract.md`](./prompt-contract.md) | Mandatory 6-section prompts + dynamic Context |
| [`workflow/overview.md`](./workflow/overview.md) | End-to-end chat turn flow |
| [`workflow/create-campaign.md`](./workflow/create-campaign.md) | Create-campaign tools & when to call them |
| [`workflow/template-generation.md`](./workflow/template-generation.md) | Planned Template Generation Director architecture |
| [`workflow/*.md`](./workflow/) | Per-module workflows |
| [`changelog.md`](./changelog.md) | **Update this on every workflow change** |

---

## Hard rules

1. **LLM owns user intent** — no regex/static routing of what the user meant.
2. **No LangChain / LangGraph** in `agents/app`.
3. **Prompts** use Role → Goal → Instructions → Context → Output → Guardrails.
4. **Context is dynamic** every turn (session snapshot, org, audience, open asks).
5. When workflow/tools/prompt contracts change → update this pack + `changelog.md`.
