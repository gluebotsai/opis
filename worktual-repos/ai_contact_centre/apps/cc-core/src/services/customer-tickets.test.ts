import assert from "node:assert/strict";
import test from "node:test";

import { compareCustomerTickets, mapCustomerTicket } from "./customer-tickets.js";

test("mapCustomerTicket keeps the case fields and attaches notes", () => {
  const ticket = mapCustomerTicket(
    {
      id: 15,
      ticket_number: "#12503",
      subject: "Late delivery",
      description: "Parcel has not arrived.",
      status: "Open",
      priority: "high",
      channel: "Email",
      assignee_name: "Asha",
      resolver_name: "  ",
      queue_name: "Support",
      category: "Shipping",
      due_at: "2026-09-26T10:00:00.000Z",
      resolved_at: null,
      csat_score: null,
      csat_comment: null,
      ai_summary: "Customer is waiting on a delivery.",
      portal_chat_session_id: "chat-session-9",
      created_at: "2026-09-25T08:00:00.000Z",
    },
    [
      {
        id: 3,
        ticket_id: 15,
        author_name: "Asha",
        body: "Checked the courier.",
        visibility: "internal",
        created_at: "2026-09-25T09:00:00.000Z",
      },
    ],
  );

  assert.equal(ticket.ticketNumber, "#12503");
  assert.equal(ticket.resolverName, null);
  assert.equal(ticket.orderId, null);
  assert.equal(ticket.interactionId, "chat-session-9");
  assert.equal(ticket.productId, null);
  assert.equal(ticket.aiSummary, "Customer is waiting on a delivery.");
  assert.deepEqual(ticket.notes, [
    {
      id: "3",
      authorName: "Asha",
      body: "Checked the courier.",
      visibility: "internal",
      createdAt: "2026-09-25T09:00:00.000Z",
    },
  ]);
});

test("compareCustomerTickets puts the newest ticket first", () => {
  const ticket = (priority: string, createdAt: string) =>
    mapCustomerTicket(
      {
        id: priority,
        ticket_number: priority,
        subject: priority,
        description: "",
        status: "Open",
        priority,
        channel: "Chat",
        assignee_name: null,
        resolver_name: null,
        queue_name: null,
        category: null,
        due_at: null,
        resolved_at: null,
        csat_score: null,
        csat_comment: null,
        ai_summary: null,
        portal_chat_session_id: null,
        created_at: createdAt,
      },
      [],
    );
  const ordered = [
    ticket("low", "2026-09-25T12:00:00.000Z"),
    ticket("high", "2026-09-24T12:00:00.000Z"),
    ticket("medium", "2026-09-25T11:00:00.000Z"),
    ticket("urgent", "2026-09-23T12:00:00.000Z"),
  ].sort(compareCustomerTickets);
  assert.deepEqual(
    ordered.map((item) => item.priority),
    ["low", "medium", "high", "urgent"],
  );
});
