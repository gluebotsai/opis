import assert from "node:assert/strict";
import test from "node:test";
import { parseProposalId, proposalMatches, shapeSdkProposal } from "./sdkProposals.ts";

test("shapes a pending approval and an open recommendation", () => {
  const approval = shapeSdkProposal({
    kind: "approval",
    id: "12",
    agentId: "crda",
    ticketNumber: "#128",
    summary: "Send this reply",
    status: "pending",
    toolName: "add_ticket_note",
    toolArgs: { text: "Hola", ticket_number: "#128" },
    createdAt: "2026-10-06T00:00:00.000Z",
  });
  assert.equal(approval?.id, "approval:12");
  assert.equal(approval?.status, "confirmation_required");
  assert.equal(approval?.draft, "Hola");

  const recommendation = shapeSdkProposal({
    kind: "recommendation",
    id: "4",
    agentId: "rkaa",
    ticketNumber: "#128",
    summary: "Try the VPN article",
    status: "open",
  });
  assert.equal(recommendation?.id, "recommendation:4");
  assert.equal(recommendation?.status, "recommendation");
  assert.equal(recommendation?.draft, undefined);
});

test("filters the open inbox by ticket and hides decided rows", () => {
  const waiting = shapeSdkProposal({
    kind: "approval",
    id: "1",
    agentId: "ara",
    ticketNumber: "#128",
    status: "pending",
    summary: "Resolve",
  });
  const other = shapeSdkProposal({
    kind: "recommendation",
    id: "2",
    agentId: "stda",
    ticketNumber: "#90",
    status: "open",
    summary: "Similar",
  });
  const done = shapeSdkProposal({
    kind: "approval",
    id: "3",
    agentId: "ara",
    ticketNumber: "#128",
    status: "approved",
    summary: "Done",
  });
  assert.ok(waiting && other && done);
  assert.equal(proposalMatches(waiting, { ticketNumber: "#128" }), true);
  assert.equal(proposalMatches(other, { ticketNumber: "128" }), false);
  assert.equal(proposalMatches(done, {}), false);
  assert.equal(proposalMatches(done, { status: "decided" }), true);
  assert.equal(proposalMatches(waiting, { status: "confirmation_required" }), true);
});

test("proposal ids stay on their own table", () => {
  assert.deepEqual(parseProposalId("approval:9"), { kind: "approval", id: "9" });
  assert.equal(parseProposalId("ticket:9"), null);
  assert.equal(parseProposalId("approval:abc"), null);
});
