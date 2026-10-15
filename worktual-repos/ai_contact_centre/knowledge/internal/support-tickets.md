# Internal — support tickets (staff)

## Purpose

Staff-side support desk for tickets created by customers in the portal. Complements [customer/support-and-requests.md](../customer/support-and-requests.md).

## Auth

Staff Bearer (`requireAuth` / support roles as enforced in handlers).

## Source map

| Layer | Path |
|-------|------|
| Client | [`src/lib/supportTickets.js`](../../src/lib/supportTickets.js) — `listSalesSupportTickets`, `getSalesSupportTicket`, `replyToSalesSupportTicket`, `updateSalesSupportTicketStatus` |
| Server | `/api/support/tickets/*` in [`server/index.js`](../../server/index.js) |

## Endpoints

| Method | Path | Client helper | Body / query | Notes |
|--------|------|---------------|--------------|-------|
| GET | `/api/support/tickets` | `listSalesSupportTickets` | status, product, days, assignee filters | |
| GET | `/api/support/tickets/:id` | `getSalesSupportTicket` | — | |
| POST | `/api/support/tickets/:id/replies` | `replyToSalesSupportTicket` | `{ body, status? }` | |
| PATCH | `/api/support/tickets/:id/status` | `updateSalesSupportTicketStatus` | `{ status }` | `requireSalesWorkspaceAuth` |

## Reuse notes

- **Ticketing product:** may own a richer ticket model; if integrating, map My Account portal tickets explicitly or migrate — do not silently fork customer create paths.
