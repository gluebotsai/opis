/**
 * Channel-binding regression cases. The flag stays off in production until
 * these pass; hostMeetName is not an input here.
 *
 * Run: npx tsx --tsconfig tsconfig.json src/lib/meet-channel-bindings.test.ts
 */
import assert from "node:assert/strict";
import { shouldAutoAssistFromChunk } from "./meeting-assist-speakers";
import {
  BIND_CONFIRM_TURNS,
  channelResolutionForAssist,
  decideChannelBinding,
  googleSubMatchesRoster,
  meetChannelBindingsEnabled,
  meetChannelBindingsMode,
  type ChannelBindingDecision,
  type ChannelBindingState,
  type MeetRosterEntry,
} from "./meet-channel-bindings";

assert.equal(meetChannelBindingsMode({ MEET_CHANNEL_BINDINGS: "0" } as NodeJS.ProcessEnv), "off");
assert.equal(meetChannelBindingsMode({} as NodeJS.ProcessEnv), "off");
assert.equal(meetChannelBindingsMode({ MEET_CHANNEL_BINDINGS: "shadow" } as NodeJS.ProcessEnv), "shadow");
assert.equal(meetChannelBindingsMode({ MEET_CHANNEL_BINDINGS: "1" } as NodeJS.ProcessEnv), "on");
assert.equal(meetChannelBindingsEnabled({ MEET_CHANNEL_BINDINGS: "shadow" } as NodeJS.ProcessEnv), false);
assert.equal(meetChannelBindingsEnabled({ MEET_CHANNEL_BINDINGS: "1" } as NodeJS.ProcessEnv), true);
assert.equal(meetChannelBindingsEnabled({ MEET_CHANNEL_BINDINGS: "0" } as NodeJS.ProcessEnv), false);
assert.deepEqual(
  googleSubMatchesRoster({ googleSubs: ["99"], userIds: ["users/99", "users/7"] }),
  { equal: true, matches: [{ googleSub: "99", userId: "users/99" }] },
);
assert.equal(
  googleSubMatchesRoster({ googleSubs: ["100"], userIds: ["users/99"] }).equal,
  false,
);

const MINUTE = 60_000;

function roster(rows: MeetRosterEntry[]): ChannelBindingState {
  return {
    rosterStatus: "ready",
    roster: rows,
    employeeEmails: ["alice@co.com", "bob@co.com"],
    bindings: [],
  };
}

function speak(
  state: ChannelBindingState,
  input: {
    channel: string;
    at: number;
    glow?: string;
    text?: string;
    recent?: ChannelBindingDecision["recentEmployee"];
  },
): ChannelBindingDecision {
  return decideChannelBinding({
    channel: input.channel,
    glow: input.glow,
    activityAtMs: input.at,
    utteranceText: input.text,
    state,
    recentEmployee: input.recent ?? null,
  });
}

function confirm(first: ChannelBindingDecision, text?: string): ChannelBindingDecision {
  const binding = first.state.bindings.find((row) => row.email === first.email);
  assert.ok(binding);
  return speak(first.state, {
    channel: binding.channel,
    at: binding.firstActivityMs + 1_000,
    glow: binding.glow,
    text,
    recent: first.recentEmployee,
  });
}

function assertNotCoached(decision: ChannelBindingDecision, role: "customer" | "other" = "customer"): void {
  const resolution = channelResolutionForAssist(decision);
  assert.equal(decision.coaching === true, false);
  assert.equal(
    shouldAutoAssistFromChunk({
      source: "live_pcm",
      attendeeRole: decision.role === "host" ? "host" : role,
      channelBindingsEnabled: true,
      channelResolution: resolution,
    }),
    false,
  );
}

// Flag off: existing role check is unchanged.
assert.equal(
  shouldAutoAssistFromChunk({ source: "live_pcm", attendeeRole: "customer", channelBindingsEnabled: false }),
  true,
);
assert.equal(
  shouldAutoAssistFromChunk({
    source: "live_pcm",
    attendeeRole: "customer",
    channelBindingsEnabled: false,
  }),
  true,
);

// (a) Two reps, neither identity comes from a panel name. Alice joined
// first and speaks before Bob joins, so each channel has one candidate.
{
  const base = roster([
    { email: "alice@co.com", userId: "users/1", earliestStartMs: 0, latestEndMs: null },
    { email: "bob@co.com", userId: "users/2", earliestStartMs: MINUTE, latestEndMs: null },
  ]);
  const alice1 = speak(base, { channel: "ch-0", at: 10_000, glow: "A", text: "hello from alice" });
  assert.equal(alice1.log.candidateCount, 1);
  assert.equal(alice1.log.reason, "awaiting_confirmation");
  assert.equal(alice1.role, "unknown");
  assertNotCoached(alice1);

  const alice2 = confirm(alice1, "hello from alice");
  assert.equal(alice2.role, "host");
  assert.equal(alice2.email, "alice@co.com");
  assert.equal(alice2.state.bindings.find((row) => row.channel === "ch-0")?.confirmedTurns, BIND_CONFIRM_TURNS);
  assertNotCoached(alice2);

  const bob1 = speak(alice2.state, { channel: "ch-1", at: 2 * MINUTE, glow: "B", text: "bob here", recent: alice2.recentEmployee });
  assert.equal(bob1.email, "bob@co.com");
  assert.equal(bob1.log.reason, "awaiting_confirmation");
  assertNotCoached(bob1);
  const bob2 = confirm(bob1, "bob here");
  assert.equal(bob2.role, "host");
  assert.equal(bob2.email, "bob@co.com");
  assertNotCoached(bob2);

  // Same join time cannot be separated. Hold, and do not coach.
  const tied = roster([
    { email: "alice@co.com", userId: "users/1", earliestStartMs: 0, latestEndMs: null },
    { email: "bob@co.com", userId: "users/2", earliestStartMs: 0, latestEndMs: null },
  ]);
  const ambiguous = speak(tied, { channel: "ch-0", at: 5_000, glow: "Someone" });
  assert.equal(ambiguous.log.reason, "ambiguous_candidates");
  assert.equal(ambiguous.log.candidateCount, 2);
  assert.equal(ambiguous.state.bindings.length, 0);
  assert.equal(channelResolutionForAssist(ambiguous), "ambiguous");
  assertNotCoached(ambiguous);
}

// (b) A rep who stays silent for 2 minutes is still the active employee.
{
  const base = roster([
    { email: "alice@co.com", userId: "users/1", earliestStartMs: 0, latestEndMs: null },
  ]);
  const first = speak(base, { channel: "ch-0", at: 2 * MINUTE, glow: "Alice" });
  assert.equal(first.log.candidateCount, 1);
  assert.equal(first.log.earliestStartMs, 0);
  assert.equal(first.email, "alice@co.com");
  assertNotCoached(first);
  const second = confirm(first);
  assert.equal(second.role, "host");
  assert.equal(second.email, "alice@co.com");
  assertNotCoached(second);
}

// (c) Mid-call tile reuse drops the old binding and does not coach until
// the new person is confirmed.
{
  let state = roster([
    { email: "alice@co.com", userId: "users/1", earliestStartMs: 0, latestEndMs: 200_000 },
    { email: "bob@co.com", userId: "users/2", earliestStartMs: 200_000, latestEndMs: null },
  ]);
  const alice1 = speak(state, { channel: "ch-0", at: 10_000, glow: "Alice Tile" });
  const alice2 = confirm(alice1);
  assert.equal(alice2.email, "alice@co.com");
  state = alice2.state;
  const rearm = speak(state, { channel: "ch-0", at: 210_000, glow: "Bob Tile" });
  assert.equal(rearm.email, "bob@co.com");
  assert.equal(rearm.log.reason, "awaiting_confirmation");
  assert.equal(rearm.role, "unknown");
  assertNotCoached(rearm);
  const rebound = confirm(rearm);
  assert.equal(rebound.role, "host");
  assert.equal(rebound.email, "bob@co.com");
  assert.equal(rebound.state.bindings.filter((row) => row.channel === "ch-0").length, 1);
  assert.equal(rebound.state.bindings.find((row) => row.channel === "ch-0")?.email, "bob@co.com");
  assertNotCoached(rebound);
}

// (d) The duplicate transport channel inherits the employee binding and
// is not coached as the customer.
{
  const base = roster([
    { email: "alice@co.com", userId: "users/1", earliestStartMs: 0, latestEndMs: null },
  ]);
  const first = speak(base, {
    channel: "ch-0",
    at: 10_000,
    glow: "Alice",
    text: "What are the products you have?",
  });
  const bound = confirm(first, "What are the products you have?");
  assert.equal(bound.role, "host");
  assert.ok(bound.recentEmployee);
  const duplicate = speak(bound.state, {
    channel: "ch-3",
    at: bound.recentEmployee.atMs + 40,
    glow: "Alice",
    text: "What are the products you have?",
    recent: bound.recentEmployee,
  });
  assert.equal(duplicate.log.reason, "duplicate_channel");
  assert.equal(duplicate.role, "host");
  assert.equal(duplicate.email, "alice@co.com");
  assertNotCoached(duplicate);
  assert.equal(
    shouldAutoAssistFromChunk({
      source: "live_pcm",
      attendeeRole: "customer",
      channelBindingsEnabled: true,
      channelResolution: "employee",
    }),
    false,
  );
}

// Pending roster never coaches, even if a caller still has a customer role.
{
  const pending = decideChannelBinding({
    channel: "ch-1",
    glow: "Lucifer",
    activityAtMs: 5_000,
    state: { ...roster([]), rosterStatus: "pending", roster: [] },
  });
  assert.equal(pending.log.reason, "roster_pending");
  assert.equal(channelResolutionForAssist(pending), "pending");
  assert.equal(
    shouldAutoAssistFromChunk({
      source: "live_pcm",
      attendeeRole: "customer",
      channelBindingsEnabled: true,
      channelResolution: "pending",
    }),
    false,
  );
}

// Each employee mailbox is already resolved. The caption joins by the exact
// Meet tile. Lucifer is the remaining person, so that tile is the customer.
// The capture bot is not.
{
  const state: ChannelBindingState = {
    ...roster([
      {
        email: "yaswanthmg1@gmail.com",
        userId: "users/creator",
        displayName: "Yaswanth M G",
        earliestStartMs: 1,
        latestEndMs: null,
      },
      {
        email: "sample151102@gmail.com",
        userId: "users/sample",
        displayName: "Sample",
        earliestStartMs: 2,
        latestEndMs: null,
      },
    ]),
    employeeEmails: ["yaswanthmg1@gmail.com", "sample151102@gmail.com", "y.gunasekaran@worktual.com"],
    customerTiles: ["lucifer", "MYACCOUNT"],
  };
  const creator = speak(state, { channel: "ch-0", at: 5_000, glow: "Yaswanth M G", text: "hello" });
  assert.equal(creator.role, "host");
  assert.equal(creator.email, "yaswanthmg1@gmail.com");
  assert.equal(channelResolutionForAssist(creator), "employee");
  const sample = speak(creator.state, { channel: "ch-1", at: 6_000, glow: "Sample" });
  assert.equal(sample.role, "host");
  assert.equal(sample.email, "sample151102@gmail.com");
  const customer = speak(sample.state, { channel: "ch-2", at: 7_000, glow: "lucifer", text: "What are the products" });
  assert.equal(customer.role, "customer");
  assert.equal(customer.log.reason, "customer_tile");
  assert.equal(channelResolutionForAssist(customer), "ready-unbound");
  assert.equal(
    shouldAutoAssistFromChunk({
      source: "live_pcm",
      attendeeRole: "customer",
      channelBindingsEnabled: true,
      channelResolution: channelResolutionForAssist(customer),
    }),
    true,
  );
  const bot = speak(customer.state, { channel: "ch-3", at: 8_000, glow: "Worktual Notetaker" });
  assert.equal(bot.role, "unknown");
  assert.equal(
    shouldAutoAssistFromChunk({
      source: "live_pcm",
      attendeeRole: bot.role === "customer" ? "customer" : "unknown",
      channelBindingsEnabled: true,
      channelResolution: channelResolutionForAssist(bot),
    }),
    false,
  );
  const leftover = speak(sample.state, {
    channel: "ch-4",
    at: 9_000,
    glow: "Speaker",
    text: "Can you share pricing",
  });
  assert.equal(leftover.role, "customer");
  assert.equal(leftover.log.reason, "leftover_non_employee");
  assert.equal(channelResolutionForAssist(leftover), "ready-unbound");
  assert.equal(
    shouldAutoAssistFromChunk({
      source: "live_pcm",
      attendeeRole: "customer",
      channelBindingsEnabled: true,
      channelResolution: channelResolutionForAssist(leftover),
    }),
    true,
  );
}

console.log("meet-channel-bindings.test.ts ok");
