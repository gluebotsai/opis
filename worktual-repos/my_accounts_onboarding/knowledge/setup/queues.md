# Setup — CCaaS queues

## Purpose

Map Contact Centre **queues** to exactly one team and assign agents with channel concurrency. Routing UX lives in CCaaS; My Account owns the queue ↔ people mapping.

## Auth

Customer Bearer + org admin. Requires active `contact-center`.

## Source map

| Layer | Path |
|-------|------|
| Client | [`src/lib/setup/setupApi.js`](../../src/lib/setup/setupApi.js) |
| Server | [`server/setupQueues.js`](../../server/setupQueues.js) |
| Schema | `setup_ccaas_queues`, `setup_ccaas_queue_agents` |
| Docs note | [`docs/setup-channels-phase2.md`](../../docs/setup-channels-phase2.md) |

## Endpoints

| Method | Path | Client helper | Body / query | Response | Notes |
|--------|------|---------------|--------------|----------|-------|
| GET | `/api/v1/me/setup/ccaas/queues` | `listQueues` | — | `{ queues }` | |
| GET | `/api/v1/me/setup/ccaas/queues/:id` | `getQueue` | — | `{ queue }` | Includes agents |
| POST | `/api/v1/me/setup/ccaas/queues` | `createQueue` | `{ name, teamId, ... }` | `{ queue }` | One team per queue |
| PATCH | `/api/v1/me/setup/ccaas/queues/:id` | `updateQueue` | partial | `{ queue }` | |
| DELETE | `/api/v1/me/setup/ccaas/queues/:id` | `deleteQueue` | — | `204` | |
| PUT | `/api/v1/me/setup/ccaas/queues/:id/agents` | `replaceQueueAgents` | `{ agents: [...] }` | `{ queue }` | Full replace |
| GET | `/api/v1/me/setup/ccaas/eligible-agents` | `listCcaasEligibleAgents` | — | `{ agents }` | Users eligible to assign |

## Agent row fields (typical)

| Field | Meaning |
|-------|---------|
| `userId` | Setup user id |
| `handlesCalls` / `handlesEmail` / `handlesChat` / social flags | Channel toggles |
| `*_concurrency` | Parallel capacity |
| `callType` | e.g. inbound/outbound/both |

## Dependencies / gates

- Contact Centre purchase.
- **One agent → one queue** (unique index on `user_id` in queue agents).
- Team must exist (see [organization.md](./organization.md)).

## Reuse notes

- **CCaaS runtime:** resolve queue membership and concurrency from these APIs or replicated read models — do not invent a second assignment table in the spoke.
