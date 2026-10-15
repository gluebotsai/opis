#!/usr/bin/env node
/**
 * Manual staff list example.
 *
 *   export WORKTUAL_API_BASE=http://127.0.0.1:3001
 *   export WORKTUAL_JWT=<staff or CRM JWT>
 *   node packages/ticketing-sdk/examples/staff-list-tickets.mjs
 *
 * Tip: login returns a token —
 *   curl -s -X POST "$WORKTUAL_API_BASE/api/auth/login" \
 *     -H 'Content-Type: application/json' \
 *     -d '{"email":"jane.smith@worktual.com","password":"Worktual@123"}'
 *
 * Requires a built package: npm run sdk:build
 */
import { createTicketingClient } from "../dist/index.js";

const baseUrl = process.env.WORKTUAL_API_BASE || "http://127.0.0.1:3001";
const accessToken = process.env.WORKTUAL_JWT;

if (!accessToken) {
  console.error("Set WORKTUAL_JWT to a staff or CRM Bearer token.");
  process.exit(1);
}

const client = createTicketingClient({ baseUrl, accessToken });
const tickets = await client.tickets.list({ scope: "org", limit: 10 });
console.log(`Fetched ${tickets.length} ticket(s):`);
for (const t of tickets.slice(0, 10)) {
  console.log(`- ${t.id} [${t.status}] ${t.subject}`);
}
