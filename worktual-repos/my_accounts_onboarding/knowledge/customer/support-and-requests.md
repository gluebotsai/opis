# Customer — support, product requests, cancellations

## Purpose

Portal self-service: support tickets, requests to add products, and branch/subscription cancellation workflows. Ticketing spoke may mirror ticket ids; commercial requests stay in My Account.

## Auth

Customer Bearer (`withCustomerAuth`).

## Source map

| Layer | Path |
|-------|------|
| Client | [`src/lib/supportTickets.js`](../../src/lib/supportTickets.js) (customer helpers), [`src/lib/customerProductRequests.js`](../../src/lib/customerProductRequests.js), [`src/lib/branchCancellationRequests.js`](../../src/lib/branchCancellationRequests.js) |
| Server | handlers in [`server/index.js`](../../server/index.js) under `/api/v1/me/...` |

## Endpoints

### Support tickets (customer)

| Method | Path | Client helper | Body / query | Response | Notes |
|--------|------|---------------|--------------|----------|-------|
| GET | `/api/v1/me/support/tickets` | `listMySupportTickets` | `status`, `productId`, `days` | `{ tickets }` | |
| GET | `/api/v1/me/support/tickets/:id` | `getMySupportTicket` | — | `{ ticket }` | |
| POST | `/api/v1/me/support/tickets` | `createSupportTicket` | subject, body, productId, … | `{ ticket }` | |
| POST | `/api/v1/me/support/tickets/:id/replies` | `replyToSupportTicket` | `{ body }` | `{ ticket }` / reply | |

Staff-side counterparts: [internal/support-tickets.md](../internal/support-tickets.md).

### Product requests

| Method | Path | Client helper | Body / query | Response | Notes |
|--------|------|---------------|--------------|----------|-------|
| GET | `/api/v1/me/product-requests` | `listMyProductRequests` | — | `{ requests }` | |
| POST | `/api/v1/me/product-requests` | `createCustomerProductRequest` | product / plan payload | `{ request }` | |
| POST | `/api/v1/me/product-requests/:id/cancel` | `cancelMyProductRequest` | — | `{ request }` | |

### Cancellation requests

| Method | Path | Client helper | Body / query | Response | Notes |
|--------|------|---------------|--------------|----------|-------|
| GET | `/api/v1/me/cancellation-requests` | `listMyCancellationRequests` | — | `{ requests }` | |
| POST | `/api/v1/me/cancellation-requests` | `submitCancellationRequest` | branch / reason payload | `{ request }` | |
| POST | `/api/v1/me/cancellation-requests/:id/withdraw` | `withdrawCancellationRequest` | — | `{ request }` | |

Admin approve/reject: [internal/auth-admin.md](../internal/auth-admin.md).

## Reuse notes

- **Ticketing:** may deep-link to My Account ticket ids or sync via these APIs; avoid a second customer-facing ticket create path without syncing.
- Product requests feed sales/admin workflows — spokes should not invent parallel “buy add-on” APIs.
