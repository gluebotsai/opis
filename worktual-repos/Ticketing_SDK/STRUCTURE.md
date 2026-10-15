# Repository layout

Structure-only split (behavior unchanged):

| Folder | Role |
|--------|------|
| [`ui-frontend/`](ui-frontend/) | React + Vite UI |
| [`ui-backend/`](ui-backend/) | Express API + Vite middleware in dev (ticket/customer/KB CRUD) |
| [`ai-agents/`](ai-agents/) | LangGraph co-worker: chat, filters/escalate/create commands, triage, phrase |

`ai-agents` is **not** a full FastAPI product API — Express owns DB writes. Agents expose task endpoints (`/chat`, `/ui-actions`, `/phrase`, triage, …) on `:8012`.

## Dev

```bash
# Terminal 1 — API (http://127.0.0.1:3001)
npm run dev:api

# Terminal 2 — SPA (http://127.0.0.1:5173, proxies /api → :3001)
npm run dev:frontend

# Terminal 3 — AI agents (http://127.0.0.1:8012)
npm run dev:agents
```

Local browser URL: **http://127.0.0.1:5173** (dev). Production Docker SPA host: **:3355**.
