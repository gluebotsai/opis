import assert from "node:assert/strict";
import test from "node:test";

import { parseSipDialogMessage, SipDialogRegistry } from "./sip-dialog";

const customerBye = [
  "BYE sip:1000@example.test SIP/2.0",
  "From: <sip:customer@example.test>;tag=remote-customer",
  "To: <sip:1000@example.test>;tag=local-customer",
  "Call-ID: customer-call",
  "CSeq: 2 BYE",
  "",
  "",
].join("\r\n");

test("parses Call-ID and tags from an in-dialog request", () => {
  assert.deepEqual(parseSipDialogMessage(customerBye), {
    method: "BYE",
    callId: "customer-call",
    localTag: "local-customer",
    remoteTag: "remote-customer",
  });
});

test("routes customer and consult dialogs independently", () => {
  const registry = new SipDialogRegistry();
  registry.register(
    {
      callId: "customer-call",
      localTag: "local-customer",
      remoteTag: "remote-customer",
    },
    "customer",
  );
  registry.register(
    {
      callId: "consult-call",
      localTag: "local-consult",
      remoteTag: "remote-consult",
    },
    "consult",
  );

  assert.equal(registry.resolve(customerBye)?.leg, "customer");
  assert.equal(
    registry.resolve(
      customerBye
        .replace("customer-call", "consult-call")
        .replaceAll("customer", "consult"),
    )?.leg,
    "consult",
  );
});

test("does not route unknown or tag-mismatched requests", () => {
  const registry = new SipDialogRegistry();
  registry.register(
    {
      callId: "customer-call",
      localTag: "local-customer",
      remoteTag: "remote-customer",
    },
    "customer",
  );
  assert.equal(registry.resolve(customerBye.replace("customer-call", "other-call")), null);
  assert.equal(registry.resolve(customerBye.replace("local-customer", "wrong-tag")), null);
});
