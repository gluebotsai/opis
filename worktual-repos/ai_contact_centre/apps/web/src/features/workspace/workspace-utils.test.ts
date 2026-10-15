import { describe, expect, it } from "vitest";

import {
  compareInboxActivityDesc,
  inboxActivityAt,
  insertMessageBySentAt,
  resolveWorkspaceConversationDirection,
  shouldOpenWebchatCustomerDisposition,
} from "./workspace-utils";

describe("resolveWorkspaceConversationDirection", () => {
  it("keeps an explicit outbound direction", () => {
    expect(resolveWorkspaceConversationDirection("outbound", "Inbound call")).toBe("outbound");
  });

  it("treats Outbound call subjects as outbound when direction was defaulted", () => {
    expect(resolveWorkspaceConversationDirection("inbound", "Outbound call")).toBe("outbound");
    expect(resolveWorkspaceConversationDirection(undefined, "Outbound callback")).toBe("outbound");
  });

  it("defaults other conversations to inbound", () => {
    expect(resolveWorkspaceConversationDirection("inbound", "Inbound call")).toBe("inbound");
    expect(resolveWorkspaceConversationDirection(undefined, "WhatsApp conversation")).toBe(
      "inbound",
    );
  });
});

describe("inboxActivityAt", () => {
  it("uses the end time for a closed conversation", () => {
    expect(
      inboxActivityAt({
        status: "resolved",
        updatedAt: "2026-10-02T07:07:00.000Z",
        endedAt: "2026-10-02T04:56:00.000Z",
        resolvedAt: "2026-10-02T04:56:00.000Z",
      }),
    ).toBe("2026-10-02T04:56:00.000Z");
  });

  it("uses the assign time while a conversation is still running", () => {
    expect(
      inboxActivityAt({
        status: "active",
        updatedAt: "2026-10-02T07:07:00.000Z",
        assignedAt: "2026-10-02T06:40:00.000Z",
        queuedAt: "2026-10-02T06:30:00.000Z",
      }),
    ).toBe("2026-10-02T06:40:00.000Z");
  });

  it("sorts a later end above a row whose update time is newer", () => {
    const laterEnd = {
      status: "resolved",
      updatedAt: "2026-10-02T06:25:00.000Z",
      endedAt: "2026-10-02T06:25:00.000Z",
    };
    const rewrittenEarlierEnd = {
      status: "resolved",
      updatedAt: "2026-10-02T07:07:00.000Z",
      endedAt: "2026-10-02T04:56:00.000Z",
    };
    expect(compareInboxActivityDesc(laterEnd, rewrittenEarlierEnd)).toBeLessThan(0);
  });
});

describe("insertMessageBySentAt", () => {
  it("appends a line that is newer than the thread", () => {
    const thread = insertMessageBySentAt(
      [{ id: "1", sentAt: "2026-10-02T02:00:00.000Z" }],
      { id: "2", sentAt: "2026-10-02T02:00:05.000Z" },
    );
    expect(thread.map((message) => message.id)).toEqual(["1", "2"]);
  });

  it("places an earlier voicebot line before lines already on screen", () => {
    const thread = insertMessageBySentAt(
      [
        { id: "live", sentAt: "2026-10-02T02:00:10.000Z" },
        { id: "agent", sentAt: "2026-10-02T02:00:12.000Z" },
      ],
      { id: "bot", sentAt: "2026-10-02T02:00:02.000Z" },
    );
    expect(thread.map((message) => message.id)).toEqual(["bot", "live", "agent"]);
  });

  it("does not duplicate a line that is already shown", () => {
    const existing = [{ id: "1", sentAt: "2026-10-02T02:00:00.000Z" }];
    expect(insertMessageBySentAt(existing, existing[0]!).map((message) => message.id)).toEqual([
      "1",
    ]);
  });
});

describe("shouldOpenWebchatCustomerDisposition", () => {
  it("opens when the customer ends a web chat that has no disposition", () => {
    expect(
      shouldOpenWebchatCustomerDisposition({
        channel: "chat",
        endActor: "customer",
        dispositionCode: null,
      }),
    ).toBe(true);
  });

  it("stays closed for other channels, agent ends, and saved dispositions", () => {
    expect(
      shouldOpenWebchatCustomerDisposition({
        channel: "voice",
        endActor: "customer",
        dispositionCode: null,
      }),
    ).toBe(false);
    expect(
      shouldOpenWebchatCustomerDisposition({
        channel: "email",
        endActor: "customer",
        dispositionCode: null,
      }),
    ).toBe(false);
    expect(
      shouldOpenWebchatCustomerDisposition({
        channel: "whatsapp",
        endActor: "customer",
        dispositionCode: null,
      }),
    ).toBe(false);
    expect(
      shouldOpenWebchatCustomerDisposition({
        channel: "chat",
        endActor: "agent",
        dispositionCode: null,
      }),
    ).toBe(false);
    expect(
      shouldOpenWebchatCustomerDisposition({
        channel: "chat",
        endActor: "customer",
        dispositionCode: "resolved",
      }),
    ).toBe(false);
  });
});
