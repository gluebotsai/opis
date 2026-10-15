# NLP Backend Documentation

Architecture and implementation plans for the Worktual CCaaS AI/NLP layer.

| Document | Description |
|----------|-------------|
| [NLP_BACKEND_ROADMAP.md](./NLP_BACKEND_ROADMAP.md) | Platform-wide NLP service: stack, folder structure, phases |
| [COPILOT_BACKEND_SSE.md](./COPILOT_BACKEND_SSE.md) | **Unified Copilot** — one SSE backend for all surfaces (queues, dashboard, inbox); flowcharts + code structure |
| [WEBCHAT_LIVE_AGENT_PLAN.md](./WEBCHAT_LIVE_AGENT_PLAN.md) | Webchat NLP, live-agent handoff, routing, and Copilot plan |
| [WEBCHAT_SCHEMA_ERD.md](./WEBCHAT_SCHEMA_ERD.md) | **ERD** — `ccass` / `cdp` / `accounts` tables and relationships |
| [WEBCHAT_SERVICE_FLOW.md](./WEBCHAT_SERVICE_FLOW.md) | **Service flows** — protocols, sequence diagrams, table touchpoints |
| [PRESENCE_REDIS_CACHE.md](./PRESENCE_REDIS_CACHE.md) | **Presence Redis cache** — keys, write-through, routing reads |

## Quick reference

```text
SAME COPILOT everywhere:
  web panel → SSE → nlp/modules/copilot → tools HTTP → cc-core APIs
  context.surface picks tools (queues-list | dashboard | inbox | ...)

DIFFERENT medium for live ops (later):
  Socket.IO → cc-core → inbox badges (not Copilot chat)
```

## Related docs

- [AI Contact Center Plan](../AI_CONTACT_CENTER_PLAN.md)
- [Chat Service Plan](../chatservice/PLAN.md)
