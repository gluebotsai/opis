#!/usr/bin/env node
/**
 * Manual intake example (server-to-server).
 *
 *   export WORKTUAL_API_BASE=http://127.0.0.1:3001
 *   export WORKTUAL_API_KEY=wt_live_…
 *   node packages/ticketing-sdk/examples/intake-create.mjs
 *
 * Requires a built package: npm run sdk:build
 */
import { createTicketingClient } from "../dist/index.js";

const baseUrl = process.env.WORKTUAL_API_BASE || "http://127.0.0.1:3001";
const apiKey = process.env.WORKTUAL_API_KEY;

if (!apiKey) {
  console.error("Set WORKTUAL_API_KEY to a wt_live_… org API key (server-side only).");
  process.exit(1);
}

const client = createTicketingClient({ baseUrl, apiKey });

const ticket = await client.intake.createTicket({
  channel: "api",
  requester: {
    name: "SDK Example",
    email: `sdk.example.${Date.now()}@example.com`,
  },
  subject: "Headless SDK intake example",
  description: "Created via @worktual/ticketing example script",
  priority: "medium",
  externalRef: `sdk-example-${Date.now()}`,
});

console.log("Created:", ticket.ticketNumber, ticket.status, ticket.channel);
