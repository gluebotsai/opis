import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildStaffCall, forwardStaffCall } from "./integrationToolApi.js";

describe("buildStaffCall", () => {
  it("maps escalate onto the staff escalate route", () => {
    const built = buildStaffCall(
      "escalate_ticket",
      { ticketNumber: "#12899" },
      { assignee_id: "456", rationale: "Needs L2" }
    );
    assert.equal(built.ok, true);
    if (!built.ok) return;
    assert.equal(built.call.method, "POST");
    assert.equal(built.call.path, "/api/tickets/%2312899/escalate");
    assert.deepEqual(built.call.body, {
      assigneeId: "456",
      rationale: "Needs L2",
    });
  });

  it("maps a ticket status change onto the staff ticket update", () => {
    const built = buildStaffCall(
      "update_ticket_status",
      { ticketNumber: "#12899" },
      { status: "Resolved", priority: "high" }
    );
    assert.equal(built.ok, true);
    if (!built.ok) return;
    assert.equal(built.call.method, "PUT");
    assert.equal(built.call.path, "/api/tickets/%2312899");
    assert.equal(built.call.orgScope, true);
    assert.deepEqual(built.call.body, { status: "Resolved" });
  });

  it("rejects a ticket status change without status", () => {
    const built = buildStaffCall(
      "update_ticket_status",
      { ticketNumber: "#12899" },
      {}
    );
    assert.equal(built.ok, false);
  });

  it("maps a note onto the staff notes route", () => {
    const built = buildStaffCall(
      "add_ticket_note",
      { ticketNumber: "#12899" },
      { text: "Called the customer." }
    );
    assert.equal(built.ok, true);
    if (!built.ok) return;
    assert.equal(built.call.path, "/api/tickets/%2312899/notes");
    assert.deepEqual(built.call.body, { text: "Called the customer." });
  });

  it("rejects a note without text", () => {
    const built = buildStaffCall("add_ticket_note", { ticketNumber: "#1" }, {});
    assert.equal(built.ok, false);
  });

  it("maps queue create and add-members update", () => {
    const created = buildStaffCall(
      "create_queue",
      {},
      { name: "Billing", description: "Invoices", members: ["Ada"] }
    );
    assert.equal(created.ok, true);
    if (!created.ok) return;
    assert.equal(created.call.path, "/api/queues");
    assert.equal(created.call.body.queueName, "Billing");

    const updated = buildStaffCall(
      "update_queue",
      { queueId: "42" },
      { description: "Credits", members: ["Priya"], add_members: true }
    );
    assert.equal(updated.ok, true);
    if (!updated.ok) return;
    assert.equal(updated.call.method, "PATCH");
    assert.equal(updated.call.path, "/api/queues/42");
    assert.equal(updated.call.body.addMembers, true);
  });

  it("maps KB create, draft, update, and publish", () => {
    const created = buildStaffCall(
      "create_kb_article",
      {},
      { title: "Reset VPN", content: "Open the client and reconnect.", category: "Network" }
    );
    assert.equal(created.ok, true);
    if (!created.ok) return;
    assert.equal(created.call.body.status, "Published");

    const draft = buildStaffCall(
      "draft_kb_article",
      {},
      { title: "Reset VPN", content: "Open the client and reconnect.", category: "Network" }
    );
    assert.equal(draft.ok, true);
    if (!draft.ok) return;
    assert.equal(draft.call.body.status, "Draft");

    const updated = buildStaffCall(
      "update_kb_article",
      { articleId: "KB-1" },
      { content: "Updated steps." }
    );
    assert.equal(updated.ok, true);
    if (!updated.ok) return;
    assert.equal(updated.call.path, "/api/kb/KB-1");

    const published = buildStaffCall("publish_kb_article", { articleId: "KB-1" }, {});
    assert.equal(published.ok, true);
    if (!published.ok) return;
    assert.deepEqual(published.call.body, { status: "Published" });
    assert.equal(published.call.path, "/api/kb/KB-1");
  });

  it("maps priority and status create and update", () => {
    const priority = buildStaffCall(
      "create_priority",
      {},
      { display_name: "P1", resolution_hours: 4 }
    );
    assert.equal(priority.ok, true);
    if (!priority.ok) return;
    assert.deepEqual(priority.call.body, { displayName: "P1", resolutionHours: 4 });

    const priorityPatch = buildStaffCall(
      "update_priority",
      { priorityId: "7" },
      { resolutionHours: 2, active: true }
    );
    assert.equal(priorityPatch.ok, true);
    if (!priorityPatch.ok) return;
    assert.equal(priorityPatch.call.path, "/api/priorities/7");

    const status = buildStaffCall("create_status", {}, { display_name: "Waiting on customer" });
    assert.equal(status.ok, true);
    if (!status.ok) return;
    assert.deepEqual(status.call.body, { displayName: "Waiting on customer" });

    const statusPatch = buildStaffCall(
      "update_status",
      { statusId: "3" },
      { displayName: "Waiting on customer", active: true }
    );
    assert.equal(statusPatch.ok, true);
    if (!statusPatch.ok) return;
    assert.equal(statusPatch.call.path, "/api/statuses/3");
  });
});

describe("forwardStaffCall", () => {
  it("sends coworker service headers and returns the staff response", async () => {
    let seen: { url: string; init: RequestInit } | undefined;
    const result = await forwardStaffCall({
      baseUrl: "http://127.0.0.1:3000",
      tasksSecret: "secret",
      actor: { id: "12", name: "Ada", role: "agent", organizationId: "9" },
      call: {
        method: "POST",
        path: "/api/tickets/%231/notes",
        body: { text: "Hello" },
      },
      fetchImpl: (async (url: string | URL | Request, init?: RequestInit) => {
        seen = { url: String(url), init: init || {} };
        return new Response(JSON.stringify({ id: "1" }), {
          status: 201,
          headers: { "Content-Type": "application/json" },
        });
      }) as typeof fetch,
    });
    assert.equal(result.status, 201);
    assert.deepEqual(result.body, { id: "1" });
    assert.equal(seen?.url, "http://127.0.0.1:3000/api/tickets/%231/notes");
    const headers = seen?.init.headers as Record<string, string>;
    assert.equal(headers["X-Coworker-Tasks-Key"], "secret");
    assert.equal(headers["X-Coworker-Actor-Id"], "12");
    assert.equal(headers["X-Coworker-Org-Id"], "9");
    assert.equal(headers["X-Coworker-Actor-Role"], "agent");
    assert.equal(headers["X-Integration-Org-Scope"], undefined);
  });

  it("marks an org-scoped status update for the staff handler", async () => {
    let headers: Record<string, string> = {};
    await forwardStaffCall({
      baseUrl: "http://127.0.0.1:3000",
      tasksSecret: "secret",
      actor: { id: "12", name: "Ada", role: "agent", organizationId: "9" },
      call: {
        method: "PUT",
        path: "/api/tickets/%23112",
        body: { status: "Resolved" },
        orgScope: true,
      },
      fetchImpl: (async (_url: string | URL | Request, init?: RequestInit) => {
        headers = (init?.headers || {}) as Record<string, string>;
        return new Response(JSON.stringify({ status: "Resolved" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }) as typeof fetch,
    });
    assert.equal(headers["X-Integration-Org-Scope"], "1");
    assert.equal(headers["X-Coworker-Tasks-Key"], "secret");
  });
});
