# Ops — health, events, webhooks

## Purpose

Runtime health, server-sent events for UI live updates, and inbound webhooks (mail Graph, payment providers as configured).

## Auth

| Endpoint | Auth |
|----------|------|
| `/api/health` | Public |
| `/api/events/stream` | Session/query as implemented (SSE) |
| `/api/mail/graph/webhook` | Provider validation |
| Payment provider webhooks | Provider signatures (if mounted) |

## Source map

| Layer | Path |
|-------|------|
| Client | [`src/lib/eventStream.js`](../../src/lib/eventStream.js) |
| Server | [`server/index.js`](../../server/index.js) health + SSE; mail Graph webhook; payments config |

## Endpoints

| Method | Path | Client / consumer | Notes |
|--------|------|-------------------|-------|
| GET | `/api/health` | probes / smoke tests | Liveness |
| GET | `/api/events/stream` | `eventStream` helpers | SSE for UI |
| POST | `/api/mail/graph/webhook` | Microsoft Graph | Mail sync notifications |
| GET | `/api/payments/config` | `fetchPaymentConfig` | Publishable keys / provider flags |
| GET | `/api/pricing-catalog` | catalog UI | Public plans |

OAuth browser callbacks (ops-relevant):

- `/auth/google/callback`
- `/auth/microsoft/callback`
- `/auth/yahoo/callback`

## Reuse notes

- Product spokes should not depend on My Account SSE unless sharing the same deployment.
- Prefer entitlements polling or spoke-local websockets for runtime bots (Lola).
- Smoke script: [`scripts/smoke-test-api.mjs`](../../scripts/smoke-test-api.mjs) (if present).
