# @worktual/ticketing

Headless TypeScript client for the Worktual Ticketing API.  
Functions only — no UI, no iframe, no agents process inside this package.

## Install

```bash
git clone https://github.com/Worktual-vibecoding/SDK_ticketing.git
cd SDK_ticketing
npm install
npm run build
```

Import as `@worktual/ticketing` from this package (or link via `npm link` / workspace).

## Auth

| Credential | Header | Used for |
|------------|--------|----------|
| `apiKey` (`wt_live_…`) | `X-Api-Key` | Intake create (`POST /api/intake/tickets`) |
| `accessToken` (staff or CRM JWT) | `Authorization: Bearer` | Tickets, notes, customers, queues |

**Never put `apiKey` in a browser.** Use it only on a trusted server or BFF.  
Create keys in Org preferences, or `POST /api/integration/keys` while logged in as admin.

## Quick start

```ts
import { createTicketingClient, verifyWorktualSignature } from "@worktual/ticketing";

const client = createTicketingClient({
  baseUrl: "http://127.0.0.1:3001",
  apiKey: process.env.WORKTUAL_API_KEY,
  accessToken: process.env.WORKTUAL_JWT,
});

// Server-to-server intake
const created = await client.intake.createTicket({
  channel: "api",
  requester: { name: "Riya", email: "riya@clienta.com" },
  subject: "VPN not connecting",
  description: "Unable to connect since morning",
  priority: "high",
  externalRef: "crm_case_98213",
});

// Staff routes (Bearer JWT)
const tickets = await client.tickets.list({ scope: "org", limit: 20 });
const one = await client.tickets.get(created.ticketNumber);
await client.notes.add(created.ticketNumber, {
  text: "Called customer",
  visibility: "internal",
});
await client.customers.list({ q: "riya@" });
await client.queues.list();

// Webhook receiver (raw body string)
const ok = verifyWorktualSignature(
  rawBody,
  req.headers["x-worktual-signature"],
  process.env.WEBHOOK_SIGNING_SECRET
);
```

## API surface (v1)

- `client.intake.createTicket(input)`
- `client.tickets.list(params?)` / `.get(ticketNumber)` / `.update(ticketNumber, body)`
- `client.notes.list(ticketNumber)` / `.add(ticketNumber, { text, visibility? })`
- `client.customers.list(params?)`
- `client.queues.list()`
- `verifyWorktualSignature(rawBody, header, secret)`

Errors: `TicketingAuthError` (missing credential), `TicketingApiError` (`status`, `body`, optional `code`).

## Examples

```bash
npm run build

export WORKTUAL_API_BASE=http://127.0.0.1:3001
export WORKTUAL_API_KEY=wt_live_…
node examples/intake-create.mjs

export WORKTUAL_JWT=<token from POST /api/auth/login>
node examples/staff-list-tickets.mjs
```

## Tests

```bash
# Unit (mocked fetch) — no server
npm test

# Live integration — Ticketing API must be running on :3001
RUN_SDK_INTEGRATION=1 npm run test:integration
```

Integration flow: admin login → create `sdk-integration-*` API key → intake create → staff list/get/notes/customers/queues with login JWT.

## Out of scope (for now)

Coworker / agent-turn, portal OTP, help widget public APIs, iframe embed SDK, publishing to public npm (`private: true`).
