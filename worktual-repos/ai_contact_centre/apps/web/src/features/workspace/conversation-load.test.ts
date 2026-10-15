import { describe, expect, it } from "vitest";

import { placeLoadedConversation } from "./conversation-load";
import type { WorkspaceConversation, WorkspaceMessage } from "./types";

function conversation(
  overrides: Partial<WorkspaceConversation> = {},
): WorkspaceConversation {
  return {
    id: "1",
    customer: {
      id: "c1",
      contactId: "c1",
      name: "Aiswarya",
      email: "a@example.com",
      phone: "",
      tier: "standard",
      tags: [],
      lifetimeValue: "—",
      openTickets: 0,
      lastContact: "now",
      notes: "",
    },
    channel: "voice",
    direction: "inbound",
    queue: "Support",
    mailboxEmail: null,
    status: "resolved",
    subject: "Call",
    preview: "Hello",
    updatedAt: "now",
    unread: false,
    assignedUserId: "1001",
    messages: [],
    ...overrides,
  };
}

function message(id: string): WorkspaceMessage {
  return {
    id,
    role: "customer",
    content: "Hello",
    sentAt: "now",
    deliveryState: "delivered",
  };
}

describe("placeLoadedConversation", () => {
  it("inserts a conversation that is not in the inbox yet", () => {
    const loaded = conversation({ messages: [message("m1")] });

    const next = placeLoadedConversation([], loaded);

    expect(next).toHaveLength(1);
    expect(next[0]?.messages.map((item) => item.id)).toEqual(["m1"]);
  });

  it("replaces the selected row without dropping its loaded messages", () => {
    const existing = conversation();
    const loaded = conversation({ messages: [message("m1")] });

    const next = placeLoadedConversation([existing, conversation({ id: "2" })], loaded);

    expect(next.map((item) => item.id)).toEqual(["1", "2"]);
    expect(next[0]?.messages.map((item) => item.id)).toEqual(["m1"]);
  });
});
