import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CRITICAL_ALERT_SCENARIOS,
  buildReopenAlertCopy,
  isTicketReopen,
} from "./criticalAlertHelpers.js";

import { customerLifecycleNextStatus } from "./statuses.js";

describe("criticalAlerts helpers", () => {
  it("isTicketReopen is true only for terminal to Reopened", () => {
    assert.equal(isTicketReopen("Resolved", "Reopened", true), true);
    assert.equal(isTicketReopen("Open", "Reopened", false), false);
    assert.equal(isTicketReopen("Resolved", "Pending", true), false);
  });

  it("buildReopenAlertCopy includes actor and status transition", () => {
    const copy = buildReopenAlertCopy({
      ticketNumber: "#12503",
      subject: "Payment failure",
      actorName: "Customer",
      prevStatus: "Resolved",
    });
    assert.equal(copy.title, "Ticket reopened");
    assert.match(copy.message, /#12503/);
    assert.match(copy.message, /Payment failure/);
    assert.match(copy.message, /Customer/);
    assert.match(copy.message, /Resolved → Reopened/);
  });

  it("scenario registry covers all planned scenarios", () => {
    assert.ok(CRITICAL_ALERT_SCENARIOS.sla_breach);
    assert.ok(CRITICAL_ALERT_SCENARIOS.escalation_to_resolver);
    assert.ok(CRITICAL_ALERT_SCENARIOS.ticket_assigned);
    assert.ok(CRITICAL_ALERT_SCENARIOS.ticket_reopened);
    assert.equal(CRITICAL_ALERT_SCENARIOS.sla_breach.severity, "critical");
    assert.equal(
      CRITICAL_ALERT_SCENARIOS.escalation_to_resolver.pref,
      "notify_ticket_assignments"
    );
    assert.equal(
      CRITICAL_ALERT_SCENARIOS.ticket_reopened.pref,
      "notify_ticket_updates"
    );
  });
});

describe("customerLifecycleNextStatus", () => {
  it("maps customer close to Closed from Resolved, including a Resolved request", () => {
    assert.deepEqual(customerLifecycleNextStatus("Resolved", "Closed"), {
      ok: true,
      next: "Closed",
    });
    assert.deepEqual(customerLifecycleNextStatus("Resolved", "Resolved"), {
      ok: true,
      next: "Closed",
    });
  });

  it("allows reopen only from Closed", () => {
    assert.deepEqual(customerLifecycleNextStatus("Closed", "Reopened"), {
      ok: true,
      next: "Reopened",
    });
    const fromResolved = customerLifecycleNextStatus("Resolved", "Reopened");
    assert.equal(fromResolved.ok, false);
    const fromOpen = customerLifecycleNextStatus("Open", "Reopened");
    assert.equal(fromOpen.ok, false);
  });

  it("rejects close when not Resolved", () => {
    const fromOpen = customerLifecycleNextStatus("Open", "Closed");
    assert.equal(fromOpen.ok, false);
    const again = customerLifecycleNextStatus("Closed", "Closed");
    assert.equal(again.ok, false);
  });
});
