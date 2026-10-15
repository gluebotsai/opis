# @worktual/ticketing

Headless TypeScript client for the Worktual Ticketing API.  
Functions only — no UI, no iframe, no agents process inside this package.

## Install (monorepo)

```bash
# from Ticketing-System root
npm install
npm run sdk:build
```

Workspace package: `packages/ticketing-sdk` → import `@worktual/ticketing`.

The package is not on npm yet. A local test app installs `file:packages/ticketing-sdk`. The full walkthrough is [docs/local-partner-sdk.md](../../docs/local-partner-sdk.md).

## Auth

| Credential | Header | Used for |
|------------|--------|----------|
| `apiKey` (`wt_live_…`) | `X-Api-Key` | Intake create (`POST /api/intake/tickets`) |
| `partnerApiKey` (same `wt_live_…` key; falls back to `apiKey`) | `X-Api-Key` | `auth.createSession`, `usage.summary`, `usage.logins` |
| `accessToken` or per-call `sessionToken` | `Authorization: Bearer` | Tickets, notes, customers, queues, `ai.turn` / `ai.stream` |

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

## Partner session and co-worker

Server-side only. `auth.createSession` writes a login and returns an 8-hour staff JWT for an existing Ticketing user (`actor.id` or `actor.email` in the key’s org). AI calls with that token are metered (`usage.summary`).

```ts
const session = await client.auth.createSession({
  actor: { email: "jane.smith@worktual.com" },
  locale: "es",
});

const turn = await client.ai.turn({
  sessionToken: session.sessionToken,
  sessionId: session.sessionId,
  message: "Resume el ticket #128",
  focusedTicketId: "#128",
  locale: "es",
});

if (turn.status === "confirmation_required") {
  await client.ai.confirm({
    sessionToken: session.sessionToken,
    sessionId: session.sessionId,
    locale: "es",
    confirmTool: { name: turn.toolProposals[0].name, args: turn.toolProposals[0].args },
  });
}

await client.ai.stream({
  sessionToken: session.sessionToken,
  message: "Who should own it?",
  onProgress: (event) => console.log(event),
});

await client.ai.reject({
  sessionToken: session.sessionToken,
  message: "No apliques ese cambio",
});

const usage = await client.usage.summary({ from: "2026-10-01T00:00:00.000Z" });
```

`locale` is sent on the turn and forwarded to the co-worker as the reply language. `ai.stream` reads `POST /api/coworker/agent-turn/stream` (SSE). Confirm and reject use the same turn endpoint with `X-Worktual-Sdk-Feature` so usage can split turns, streams, confirms, and rejects.

`askMetrics`, `askWhy`, and `listTickets` take a `message`. They do not accept SQL. Counts and rows are copied from the tool payload. When Context Layer or the knowledge graph URL is unset, the status is `temporarily_unavailable` and the reply is the unavailable sentence.

`usage.summary` includes `bySkill`, `quotaExceeded`, and `quota` (the active `ratePerMinute` and `concurrent` caps; `0` means that cap is off). Each `bySkill` entry is the Skill that ran and how many metered calls used it. `quotaExceeded` counts `429` responses and is not included in `turns`. A row in `ticketing.sdk_partner_quota` sets the org cap, then `SDK_QUOTA_TIERS`, then `SDK_TURN_RATE_PER_MINUTE` and `SDK_CONCURRENT_TURNS`.

`usage.events` returns each row with `partnerId` (the org API key id), `agentTurns`, and `confirmRequired`. `debug: true` on `ai.turn` or `ai.stream` adds `trace` (agent names and route endpoints).

Failed calls throw `TicketingApiError` with `code` and `message`. A turn that the co-worker refuses sets `result.code` and replaces the reply with the same sentence in the turn locale (`en`, `es`, `fr`, `de`, `pt`, `hi`, `ar`). Unknown locales use English.

## API surface (v1)

- `client.auth.createSession` / `endSession` / `refreshSession`
- `client.auth.login` and `client.auth.portal.requestOtp` / `verifyOtp` / `login` (no API key on these calls)
- `client.inbox.list` / `markRead` / `markAllRead`
- `client.usage.summary` / `logins` / `events` (`surface: "ui"` and `component` mark widget calls)
- `client.widgets.list` / `create` / `update` (partner key) and `getPublic` / `submitTicket` (no API key; `wgt_…` only)
- `client.ai.turn` / `stream` / `confirm` / `reject`
- `client.ai.tasks.summarize` / `classify` / `draftReply` / `similar` / `recommendKb` / `deflect`
- `client.ai.tasks.createTicket` / `assign` / `resolveSuggest` / `qualityCheck` / `slaAdvise` / `workload`
- `client.ai.tasks.askMetrics` / `askWhy` / `listTickets`
- `client.ai.proposals.list` / `decide`
- `client.intake.createTicket(input)`
- `client.tickets.list(params?)` / `.get(ticketNumber)` / `.update(ticketNumber, body)`
- `client.notes.list(ticketNumber)` / `.add(ticketNumber, { text, visibility? })`
- `client.customers.list(params?)`
- `client.queues.list()`
- `verifyWorktualSignature(rawBody, header, secret)`

Errors: `TicketingAuthError` (missing credential), `TicketingApiError` (`status`, `body`, optional `code`).

## Examples

```bash
npm run sdk:build

export WORKTUAL_API_BASE=http://127.0.0.1:3001
export WORKTUAL_API_KEY=wt_live_…
node packages/ticketing-sdk/examples/intake-create.mjs

export WORKTUAL_JWT=<token from POST /api/auth/login>
node packages/ticketing-sdk/examples/staff-list-tickets.mjs
```

## Tests

```bash
# Unit (mocked fetch) — no server
npm run sdk:test

# Live integration — API must be running
npm run dev:api
RUN_SDK_INTEGRATION=1 npm run sdk:test:integration
```

Integration flow: admin login → create `sdk-integration-*` API key → intake create → staff list/get/notes/customers/queues with login JWT.

## Other languages

`packages/ticketing-sdk-python` and `packages/ticketing-sdk-dotnet` call the same session, turn, stream, named-task, proposal, login, inbox, and usage routes. Confirm and reject are included. Ticket CRUD stays in this package. Widgets stay in `@worktual/ticketing-ui`.

## Publish

`@worktual/ticketing` and `@worktual/ticketing-ui` are public packages. Publish the client first, then the UI package (`npm run sdk:publish` from the repo). The iframe helpers are `mountWorktualFrame` and `mountHelpFrame` in `@worktual/ticketing-ui`.

SFT (`:8022`), the Hub A2A agent card, and MCP (`:8020`) stay internal. Partners call these packages. The packages call Express. Express calls the agents.
