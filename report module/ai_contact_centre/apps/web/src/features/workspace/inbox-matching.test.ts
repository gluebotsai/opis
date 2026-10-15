import { describe, expect, it } from "vitest";

import {
  matchesInboxTab,
  resolveInitialInboxTab,
  resolveTabForConversation,
} from "./inbox-matching";
import type { WorkspaceConversation } from "./types";

function conversation(
  overrides: Partial<WorkspaceConversation> = {},
): WorkspaceConversation {
  return {
    id: "1",
    customer: {
      id: "c1",
      contactId: "c1",
      name: "Customer",
      email: "",
      phone: "",
      tier: "standard",
      tags: [],
      lifetimeValue: "—",
      openTickets: 0,
      lastContact: "now",
      notes: "",
    },
    channel: "voice",
    direction: "outbound",
    queue: "Support",
    mailboxEmail: null,
    status: "active",
    subject: "Call",
    preview: "",
    updatedAt: "now",
    unread: false,
    assignedUserId: "1001",
    messages: [],
    ...overrides,
  };
}

describe("resolveInitialInboxTab", () => {
  it("keeps an active voice consult participant in Open without ownership", () => {
    const consult = conversation({
      assignedUserId: "1001",
      consultParticipant: true,
      offerPending: false,
    });
    expect(matchesInboxTab(consult, "open", "1002")).toBe(true);
  });

  it("opens the requested live call instead of a persisted Closed tab", () => {
    const live = conversation({ id: "104689", assignedUserId: "1001" });
    expect(
      resolveInitialInboxTab([live], {
        userSetTab: true,
        persistedTab: "closed",
        persistedSelectionId: "old-closed",
        requestedConversationId: "104689",
        currentUserId: "1001",
      }),
    ).toBe("open");
  });

  it("stays on Closed when the URL conversation is resolved", () => {
    const closed = conversation({ id: "9", status: "resolved" });
    expect(resolveTabForConversation(closed)).toBe("closed");
    expect(
      resolveInitialInboxTab([closed], {
        userSetTab: true,
        persistedTab: "closed",
        persistedSelectionId: "9",
        requestedConversationId: "9",
        currentUserId: "1001",
      }),
    ).toBe("closed");
  });

  it("uses Ongoing when the requested conversation is not in the inbox yet", () => {
    expect(
      resolveInitialInboxTab([], {
        userSetTab: true,
        persistedTab: "closed",
        persistedSelectionId: null,
        requestedConversationId: "104689",
      }),
    ).toBe("open");
  });
});
