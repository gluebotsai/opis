import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  isOutboundTransferBlocking,
  matchesInboxTab,
  resolveTransferOfferFlags,
} from "./inbox-matching.ts";
import type { WorkspaceConversation } from "./types.ts";

const here = dirname(fileURLToPath(import.meta.url));

function conversation(
  overrides: Partial<WorkspaceConversation> = {},
): WorkspaceConversation {
  return {
    id: "conv-1",
    customer: {
      id: "c1",
      contactId: "c1",
      name: "Customer",
      email: "c@test.com",
      phone: "",
      company: undefined,
      location: undefined,
      tier: "standard",
      tags: [],
      lifetimeValue: "—",
      openTickets: 0,
      lastContact: "now",
      notes: "",
    },
    channel: "chat",
    direction: "inbound",
    queue: "support",
    mailboxEmail: null,
    status: "waiting",
    subject: "Help",
    preview: "hi",
    updatedAt: "now",
    unread: false,
    offerPending: false,
    assignedUserId: "user-b",
    transferred: undefined,
    transfer: null,
    messages: [],
    botMemory: null,
    crossChannelSummary: [],
    createdAt: "now",
    queuedAt: null,
    assignedAt: null,
    resolvedAt: null,
    endedAt: null,
    endReason: null,
    endActor: null,
    handoffReason: null,
    dispositionCode: null,
    resolutionCode: null,
    botActive: false,
    sentiment: null,
    ...overrides,
  };
}

test("explicit pending offer to current agent is not marked transferred", () => {
  const flags = resolveTransferOfferFlags({
    status: "assigned",
    assignedUserId: "user-b",
    currentUserId: "user-b",
    pendingOffer: true,
    transferredHint: true,
  });
  assert.equal(flags.offerPending, true);
  assert.equal(flags.transferred, undefined);
});

test("assigned status alone is not an offer", () => {
  const flags = resolveTransferOfferFlags({
    status: "assigned",
    assignedUserId: "user-b",
    currentUserId: "user-b",
    transferredHint: true,
  });
  assert.equal(flags.offerPending, false);
});

test("sender viewing transferred conversation keeps transferred flag", () => {
  const flags = resolveTransferOfferFlags({
    status: "assigned",
    assignedUserId: "user-b",
    currentUserId: "user-a",
    transferredHint: true,
  });
  assert.equal(flags.offerPending, false);
  assert.equal(flags.transferred, true);
});

test("queued transfer without assignee is not an offer", () => {
  const flags = resolveTransferOfferFlags({
    status: "queued",
    assignedUserId: null,
    currentUserId: "user-b",
    transferredHint: true,
  });
  assert.equal(flags.offerPending, false);
  assert.equal(flags.transferred, true);
});

test("pending offer for current agent stays in Open tab", () => {
  const offer = conversation({
    status: "waiting",
    offerPending: true,
    assignedUserId: "user-b",
    transferred: true,
    transfer: { transferredAt: "now" },
  });
  assert.equal(matchesInboxTab(offer, "open", "user-b"), true);
  assert.equal(matchesInboxTab(offer, "transferred", "user-b"), false);
});

test("completed transfer without offer lands in Transferred tab", () => {
  const done = conversation({
    status: "waiting",
    offerPending: false,
    assignedUserId: "user-b",
    transferred: true,
  });
  assert.equal(matchesInboxTab(done, "open", "user-a"), false);
  assert.equal(matchesInboxTab(done, "transferred", "user-a"), true);
  assert.equal(matchesInboxTab(done, "open", "user-b"), false);
});

test("active owned conversation stays in Open and is unaffected by transfer rules", () => {
  const active = conversation({
    status: "active",
    offerPending: false,
    assignedUserId: "user-a",
    transferred: undefined,
  });
  assert.equal(matchesInboxTab(active, "open", "user-a"), true);
  assert.equal(matchesInboxTab(active, "transferred", "user-a"), false);
  assert.equal(matchesInboxTab(active, "closed", "user-a"), false);
});

test("sender pending transfer stays Ongoing and blocks controls", () => {
  const pending = conversation({
    status: "active",
    assignedUserId: "user-b",
    transfer: {
      id: "transfer-1",
      state: "offered",
      fromUserId: "user-a",
      offeredAgentId: "agent-b",
      requestedAt: "2026-09-04T08:00:00.000Z",
    },
  });
  assert.equal(matchesInboxTab(pending, "open", "user-a"), true);
  assert.equal(matchesInboxTab(pending, "transferred", "user-a"), false);
  assert.equal(isOutboundTransferBlocking(pending, "user-a"), true);
});

test("accepted transfer remains Ongoing for sender until completion", () => {
  const accepted = conversation({
    status: "active",
    assignedUserId: "user-b",
    transfer: {
      state: "accepted",
      fromUserId: "user-a",
      acceptedUserId: "user-b",
      acceptedAt: "2026-09-04T08:00:10.000Z",
    },
  });
  assert.equal(matchesInboxTab(accepted, "open", "user-a"), true);
  assert.equal(matchesInboxTab(accepted, "transferred", "user-a"), false);
  assert.equal(matchesInboxTab(accepted, "open", "user-b"), true);
});

test("only completed sender transfer appears in Transferred", () => {
  const completed = conversation({
    status: "active",
    assignedUserId: "user-b",
    transfer: {
      state: "completed",
      fromUserId: "user-a",
      acceptedUserId: "user-b",
      completedAt: "2026-09-04T08:01:00.000Z",
    },
  });
  assert.equal(matchesInboxTab(completed, "transferred", "user-a"), true);
  assert.equal(matchesInboxTab(completed, "open", "user-a"), false);
  assert.equal(matchesInboxTab(completed, "transferred", "user-b"), false);
  assert.equal(matchesInboxTab(completed, "open", "user-b"), true);
});

test("rejected transfer returns sender to normal Ongoing flow", () => {
  const rejected = conversation({
    status: "active",
    assignedUserId: "user-a",
    transfer: {
      state: "rejected",
      fromUserId: "user-a",
      rejectedAt: "2026-09-04T08:00:10.000Z",
    },
  });
  assert.equal(matchesInboxTab(rejected, "open", "user-a"), true);
  assert.equal(isOutboundTransferBlocking(rejected, "user-a"), false);
});

test("socket subscribes to every canonical transfer lifecycle event", () => {
  const socket = readFileSync(join(here, "use-workspace-socket.ts"), "utf8");
  for (const event of ["offered", "accepted", "rejected", "expired", "cancelled", "completed"]) {
    assert.match(socket, new RegExp(`conversation\\.transfer\\.${event}`));
  }
});

test("refresh recovers pending offers and accepted sender wrap-up", () => {
  const state = readFileSync(join(here, "use-workspace-state.ts"), "utf8");
  assert.match(state, /offerPending && isAssignedToCurrentUser|offerPending && isAssignedToMe/);
  assert.match(state, /isTransferSource\(item\.transfer, currentUserId\)/);
  assert.match(state, /isTransferAccepted\(item\.transfer\)/);
  assert.match(state, /setTransferDispositionConversationId\(acceptedOutbound/);
});

test("accepted transfer wrap-up is locked and sends selected disposition", () => {
  const dialogs = readFileSync(
    join(here, "../../components/workspace/workspace-action-dialogs.tsx"),
    "utf8",
  );
  assert.match(dialogs, /Complete transfer/);
  assert.match(dialogs, /dismissible=\{false\}|dismissible=\{false\}/);
  assert.match(dialogs, /resolutionLocked|resolution locked/i);

  const api = readFileSync(join(here, "api.ts"), "utf8");
  assert.match(api, /dispositionCode:\s*details\.disposition|disposition:\s*details\.disposition/);
});

test("sender ringing UI does not treat offered transfers as accepted", () => {
  const chat = readFileSync(
    join(here, "../../components/workspace/workspace-chat-panel.tsx"),
    "utf8",
  );
  assert.match(chat, /Calling \$\{target\}/);
  assert.match(chat, /Ringing/);
  assert.match(chat, /transfer\?\.state === "accepted"/);

  const state = readFileSync(join(here, "use-workspace-state.ts"), "utf8");
  assert.match(state, /isTransferPending\(transfer\)/);
  assert.match(state, /transfer\.state !== "accepted"/);
});

test("transfer dialog waits for load before showing empty agents", () => {
  const dialogs = readFileSync(
    join(here, "../../components/workspace/workspace-action-dialogs.tsx"),
    "utf8",
  );
  assert.match(dialogs, /sawTargetsLoadingRef/);
  assert.match(dialogs, /showEmptyTargets/);
  assert.match(dialogs, /awaitingTargets/);
});

test("warm transfer route does not emit accepted while ringing", () => {
  const route = readFileSync(
    join(here, "../../../../cc-core/src/routes/workspace.ts"),
    "utf8",
  );
  assert.match(route, /!explicitWarm && safeResult\.conversation\.status === "active"/);
});
