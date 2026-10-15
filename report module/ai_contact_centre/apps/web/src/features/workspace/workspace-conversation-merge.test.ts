import { describe, expect, it } from "vitest";

import { mergeWorkspaceConversationUpdate } from "./api";
import type { WorkspaceConversation } from "./types";

function baseConversation(
  overrides: Partial<WorkspaceConversation> = {},
): WorkspaceConversation {
  return {
    id: "1",
    customer: {
      id: "c1",
      contactId: "c1",
      name: "Santhosh",
      email: "s@test.com",
      phone: "919999999999",
      company: "Worktual",
      location: "Chennai",
      tier: "standard",
      tags: [],
      lifetimeValue: "—",
      openTickets: 0,
      lastContact: "now",
      notes: "",
    },
    channel: "whatsapp",
    direction: "inbound",
    queue: "Support",
    mailboxEmail: null,
    status: "active",
    subject: "WhatsApp conversation",
    preview: "Hello",
    updatedAt: "now",
    unread: false,
    assignedUserId: "1003",
    messages: [
      {
        id: "m1",
        role: "customer",
        content: "Hello",
        sentAt: "now",
        deliveryState: "delivered",
      },
    ],
    crossChannelSummary: [{ channel: "whatsapp", summary: "Prior chat" }],
    ...overrides,
  };
}

describe("mergeWorkspaceConversationUpdate", () => {
  it("preserves messages and assignment when socket payload is partial", () => {
    const existing = baseConversation();
    const incoming = baseConversation({
      status: "resolved",
      messages: [],
      assignedUserId: undefined,
      customer: {
        ...existing.customer,
        email: "",
        company: undefined,
        location: undefined,
      },
      crossChannelSummary: [],
    });

    const merged = mergeWorkspaceConversationUpdate(existing, incoming);

    expect(merged.status).toBe("resolved");
    expect(merged.messages).toHaveLength(1);
    expect(merged.assignedUserId).toBe("1003");
    expect(merged.customer.email).toBe("s@test.com");
    expect(merged.customer.company).toBe("Worktual");
    expect(merged.crossChannelSummary).toHaveLength(1);
  });

  it("keeps enriched customer name when end payload falls back to visitor id", () => {
    const existing = baseConversation({
      channel: "webchat",
      customer: {
        ...baseConversation().customer,
        name: "Gwansik",
        email: "gwansik@gmail.com",
      },
    });
    const incoming = baseConversation({
      channel: "webchat",
      status: "resolved",
      customer: {
        ...existing.customer,
        name: "visitor_8fcedf70-335f-474e-a9bc-201ece3fe1b3",
      },
    });

    const merged = mergeWorkspaceConversationUpdate(existing, incoming);

    expect(merged.customer.name).toBe("Gwansik");
  });
});
