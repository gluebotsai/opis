import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertIntakeReferencesPolicy,
  derivedOrderProductFromRefs,
  mergeIntakeReferencePolicy,
  normalizeIntakeReferences,
  redactIntegrationApiPayload,
  sanitizeIntakeAttachments,
  summarizeIntegrationAuthHeaders,
  webchatLookupTicketRef,
  intakeIssueTextsMatch,
  normalizeIntakeIssueText,
  mapIntakeChannel,
  isAllowedIntakeChannel,
} from "./intake.js";
import { staffAssignBellModes } from "./ticketCreatedSideEffects.js";
import {
  DEFAULT_RESOLVED_AUTO_CLOSE_HOURS,
  isResolvedSilentAutoCloseDue,
} from "./slaSweep.js";

describe("normalizeIntakeReferences", () => {
  it("parses references[] and deduplicates", () => {
    const refs = normalizeIntakeReferences({
      references: [
        { type: "order", id: "ORD-8821" },
        { type: "product", id: "SKU-123" },
        { type: "product", id: "SKU-123" },
        { type: "product", id: "SKU-456" },
      ],
    });
    assert.deepEqual(refs, [
      { type: "order", id: "ORD-8821" },
      { type: "product", id: "SKU-123" },
      { type: "product", id: "SKU-456" },
    ]);
  });

  it("merges legacy orderId/productId aliases into references", () => {
    const refs = normalizeIntakeReferences({
      orderNumber: "ORD-1",
      product_id: "SKU-9",
    });
    assert.deepEqual(refs, [
      { type: "order", id: "ORD-1" },
      { type: "product", id: "SKU-9" },
    ]);
  });

  it("allows product without order", () => {
    const refs = normalizeIntakeReferences({
      references: [{ type: "product", id: "PROD-456" }],
    });
    assert.deepEqual(refs, [{ type: "product", id: "PROD-456" }]);
    const derived = derivedOrderProductFromRefs(refs);
    assert.equal(derived.orderId, null);
    assert.equal(derived.productId, "PROD-456");
  });

  it("returns empty when omitted", () => {
    assert.deepEqual(normalizeIntakeReferences({}), []);
    assert.deepEqual(normalizeIntakeReferences(null), []);
  });

  it("skips RFC Message-ID strings in references", () => {
    assert.deepEqual(
      normalizeIntakeReferences({
        references: ["<abc@mail.example>", { type: "order", id: "ORD-1" }],
      }),
      [{ type: "order", id: "ORD-1" }]
    );
  });
});

describe("mergeIntakeReferencePolicy", () => {
  it("defaults allowedTypes to order and product", () => {
    const policy = mergeIntakeReferencePolicy({});
    assert.deepEqual(policy.allowedTypes, ["order", "product"]);
    assert.deepEqual(policy.requiredTypes, []);
    assert.equal(policy.productRequiresOrder, false);
  });

  it("honors org policy allowedTypes", () => {
    const policy = mergeIntakeReferencePolicy({
      allowedTypes: ["product", "subscription"],
      productRequiresOrder: true,
    });
    assert.deepEqual(policy.allowedTypes, ["product", "subscription"]);
    assert.equal(policy.productRequiresOrder, true);
  });

  it("rejects types not in org policy", () => {
    const policy = mergeIntakeReferencePolicy({});
    assert.throws(
      () =>
        assertIntakeReferencesPolicy(
          [{ type: "subscription", id: "sub-1" }],
          policy
        ),
      /not allowed for this organization/
    );
  });

  it("allows product-only when productRequiresOrder is false", () => {
    const policy = mergeIntakeReferencePolicy({});
    assertIntakeReferencesPolicy(
      [{ type: "product", id: "PROD-456" }],
      policy
    );
  });
});

describe("sanitizeIntakeAttachments", () => {
  it("keeps /uploads filenames only", () => {
    assert.deepEqual(
      sanitizeIntakeAttachments([
        "/uploads/receipt.pdf",
        "http://evil.example/x.pdf",
        "/uploads/../secret",
        "/uploads/a/b.pdf",
        "/uploads/ok.png",
      ]),
      ["/uploads/receipt.pdf", "/uploads/ok.png"]
    );
  });

  it("returns empty for missing or invalid input", () => {
    assert.deepEqual(sanitizeIntakeAttachments(undefined), []);
    assert.deepEqual(sanitizeIntakeAttachments(" /uploads/a.pdf "), []);
  });
});

describe("redactIntegrationApiPayload", () => {
  it("strips live keys and attachment bytes", () => {
    const redacted = redactIntegrationApiPayload({
      organizationId: "1012",
      apiKey: "wt_live_supersecret",
      description: "short",
      attachments: [{ name: "a.pdf", content: "AAAA", contentType: "application/pdf" }],
    }) as Record<string, unknown>;
    assert.equal(redacted.apiKey, "[redacted]");
    assert.equal(redacted.organizationId, "1012");
    const atts = redacted.attachments as Array<Record<string, unknown>>;
    assert.equal(atts[0].name, "a.pdf");
    assert.equal(atts[0].bytes, 4);
    assert.equal(atts[0].hasContent, true);
    assert.equal(atts[0].content, undefined);
  });

  it("summarizes auth headers without the secret", () => {
    const auth = summarizeIntegrationAuthHeaders({
      headers: { authorization: "Bearer wt_live_abcdefghij" },
    });
    assert.equal(auth.authorization, "Bearer [redacted]");
    assert.equal(auth.keyHint, "wt_live_…");
  });
});

describe("webchatLookupTicketRef", () => {
  it("reads optional ticket aliases", () => {
    assert.equal(webchatLookupTicketRef({ ticketId: "#20006" }), "#20006");
    assert.equal(webchatLookupTicketRef({ ticket_number: "20006" }), "20006");
    assert.equal(webchatLookupTicketRef({ email: "a@b.com" }), "");
  });
});

describe("staffAssignBellModes", () => {
  it("uses assigned for first L1/L2 and reassigned only person to person", () => {
    const first = staffAssignBellModes({
      assigneeId: "10",
      assigneeName: "Shobana R",
      resolverId: "20",
      resolverName: "Arun",
      prevAssigneeId: null,
      prevAssigneeName: "Unassigned",
      prevResolverId: null,
    });
    assert.equal(first.agent, "new");
    assert.equal(first.resolver, "new");
    const move = staffAssignBellModes({
      assigneeId: "11",
      assigneeName: "Lokesh B",
      resolverId: "21",
      resolverName: "Anshu",
      prevAssigneeId: "10",
      prevAssigneeName: "Shobana R",
      prevResolverId: "20",
    });
    assert.equal(move.agent, "reassign");
    assert.equal(move.resolver, "reassign");
    const escalate = staffAssignBellModes({
      resolverId: "21",
      resolverName: "Anshu",
      prevResolverId: "20",
      escalate: true,
    });
    assert.equal(escalate.resolver, "escalate");
    assert.equal(escalate.agent, null);
  });
});

describe("normalizeIntakeIssueText", () => {
  it("matches the same issue after intake footer and spacing", () => {
    assert.equal(
      normalizeIntakeIssueText(
        "Account Locked Due to Multiple Failed Login Attempts\n\n---\nIntake: metadata={}"
      ),
      "account locked due to multiple failed login attempts"
    );
    assert.equal(
      intakeIssueTextsMatch(
        "Account Locked Due to Multiple Failed Login Attempts",
        "account   locked due to multiple failed login attempts"
      ),
      true
    );
    assert.equal(
      intakeIssueTextsMatch("Account locked", "Payment failed"),
      false
    );
  });
});

describe("mapIntakeChannel", () => {
  it("stores the sent channel type and keeps legacy Chat on read", () => {
    assert.equal(mapIntakeChannel("email"), "Email");
    assert.equal(mapIntakeChannel("webchat"), "Webchat");
    assert.equal(mapIntakeChannel("chat"), "Webchat");
    assert.equal(mapIntakeChannel("Chat"), "Chat");
    assert.equal(mapIntakeChannel("whatsapp"), "WhatsApp");
    assert.equal(mapIntakeChannel("instagram"), "Instagram");
    assert.equal(mapIntakeChannel("facebook"), "Facebook");
    assert.equal(mapIntakeChannel("api"), "Web");
    assert.equal(mapIntakeChannel("web_form"), "Web");
    assert.equal(isAllowedIntakeChannel("instagram"), true);
    assert.equal(isAllowedIntakeChannel("sms"), false);
  });
});

describe("isResolvedSilentAutoCloseDue", () => {
  const now = new Date("2026-09-30T12:00:00.000Z");
  const hours = DEFAULT_RESOLVED_AUTO_CLOSE_HOURS;

  it("closes Resolved after 48h with no customer inbound after resolve", () => {
    assert.equal(
      isResolvedSilentAutoCloseDue({
        status: "Resolved",
        resolvedAt: "2026-09-28T11:00:00.000Z",
        lastCustomerInboundAt: null,
        now,
        hours,
      }),
      true
    );
  });

  it("keeps Resolved when the customer inbound is after resolve", () => {
    assert.equal(
      isResolvedSilentAutoCloseDue({
        status: "Resolved",
        resolvedAt: "2026-09-28T11:00:00.000Z",
        lastCustomerInboundAt: "2026-09-28T15:00:00.000Z",
        now,
        hours,
      }),
      false
    );
  });

  it("does not close before 48h or when not Resolved", () => {
    assert.equal(
      isResolvedSilentAutoCloseDue({
        status: "Resolved",
        resolvedAt: "2026-09-29T12:00:00.000Z",
        lastCustomerInboundAt: null,
        now,
        hours,
      }),
      false
    );
    assert.equal(
      isResolvedSilentAutoCloseDue({
        status: "Open",
        resolvedAt: "2026-09-20T12:00:00.000Z",
        lastCustomerInboundAt: null,
        now,
        hours,
      }),
      false
    );
    assert.equal(
      isResolvedSilentAutoCloseDue({
        status: "Closed",
        resolvedAt: "2026-09-20T12:00:00.000Z",
        lastCustomerInboundAt: null,
        now,
        hours,
      }),
      false
    );
  });
});
