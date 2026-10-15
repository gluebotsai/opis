# ZoomInfo via Worktual gateway

CRM never holds ZoomInfo OAuth/MCP secrets. Search and enrich go through the
shared Worktual gateway.

## Env

| Variable | Where | Notes |
|---|---|---|
| `ZOOMINFO_GATEWAY_URL` | Fastify + ai-service | Default `http://173.234.75.165:8199` |
| `ZOOMINFO_GATEWAY_TOKEN` | Fastify + ai-service | Shared CRM Bearer token |
| `ZOOMINFO_ENRICH_MAX_PER_IMPORT` | Fastify | Cap enrich calls on prospect import (default `1`) |

Org must have ZoomInfo connected in MyAccounts (`organizationId` + `appKey=zoominfo`).

## Flows

1. **Prospect pull (Contact chat)** — `search_contacts` is free. Preview candidates in chat, then confirm import. At most `ZOOMINFO_ENRICH_MAX_PER_IMPORT` enrich(s) run on import (1 data credit each).
2. **Automatic lead enrich** — lead-enrichment calls ZoomInfo first with every
   available company name, company domain, email, and phone signal. It uses 1
   data credit. When ZoomInfo is unavailable or returns no enrichment fields,
   the existing domain-cache / AI / local enrichment chain runs as fallback.
3. **Explicit coworker enrich** — `propose_enrich_contact_zoominfo` remains
   available for a user-requested rerun. The contact-detail button was removed.

## Code

- Gateway client: `backend/src/service/zoominfo/zoominfo-gateway.ts`, `ai-service/app/integrations/zoominfo_gateway.py`
- Enrich write path: `backend/src/service/zoominfo/zoominfo-enrich.ts` → `POST /api/contacts/:id/enrichment/zoominfo`
- Prospect search provider: `ai-service/app/providers/zoominfo.py` (gateway-only; sentinel apiKey `__gateway__`)
