/**
 * run: npx tsx --tsconfig tsconfig.json src/service/voice/call-transcript-line.test.ts
 */
import assert from "node:assert/strict";
import {
  isCustomerUtterance,
  isStoredCustomerUtterance,
  lineMatchesSession,
  parseGatewayLine,
  phoneTail,
} from "./call-transcript-line";

assert.equal(phoneTail("+91 94923 17136"), "9492317136");
assert.equal(phoneTail("919492317136"), "9492317136");
assert.equal(phoneTail("203"), "203");

const raw = JSON.stringify({
  session_id: "gw-1",
  is_bot: 0,
  speaker: "919492317136",
  domain_id: 20556,
  text: "What is the price?",
  transcriptTm: "2026-10-01T10:00:00Z",
  emotion: "neutral",
  customer_number: "+91 94923 17136",
  agent: { name: "Sam", ext: "203", userId: "9", email: "sam@example.com" },
});

const line = parseGatewayLine(raw);
assert.ok(line);
assert.equal(line.domainId, "20556");
assert.equal(line.customerTail, "9492317136");
assert.equal(line.isBot, false);
assert.deepEqual(line.agentExts, ["203"]);
assert.equal(isCustomerUtterance(line), true);
assert.equal(
  lineMatchesSession(line, {
    organizationId: "1003",
    ext: "203",
    remoteDigits: "9492317136",
  }),
  true,
);
assert.equal(
  lineMatchesSession(line, {
    organizationId: "1003",
    ext: "0203",
    remoteDigits: "9492317136",
  }),
  true,
);
assert.equal(
  lineMatchesSession(line, {
    organizationId: "20556",
    ext: "204",
    remoteDigits: "9492317136",
  }),
  false,
);

const named = parseGatewayLine(
  JSON.stringify({
    session_id: "gw-name",
    is_bot: 0,
    speaker: "yas M G",
    domain_id: "20556",
    text: "Can you explain the CRM?",
    customer_number: "8883369379",
    agent: [{ ext: "101" }],
  }),
);
assert.ok(named);
assert.equal(isCustomerUtterance(named, "101"), true);
assert.equal(isCustomerUtterance(named, "101", ["Yaswanth M G"]), true);

const employee = parseGatewayLine(
  JSON.stringify({
    session_id: "gw-agent",
    is_bot: 0,
    speaker: "Yaswanth",
    domain_id: "20556",
    text: "Hello am I audible",
    customer_number: "916883369379",
    agent: [{ ext: "101", name: "Yaswanth M G" }],
  }),
);
assert.ok(employee);
assert.equal(isCustomerUtterance(employee, "101"), false);
assert.equal(
  isStoredCustomerUtterance({
    isBot: false,
    speaker: "Yaswanth M G",
    customerTail: "6883369379",
    agentExt: "101",
    agentNames: ["Yaswanth M G"],
  }),
  false,
);
assert.equal(
  isStoredCustomerUtterance({
    isBot: false,
    speaker: "6883369379",
    customerTail: "916883369379",
    agentExt: "101",
    agentNames: ["Yaswanth M G"],
  }),
  true,
);
assert.equal(
  lineMatchesSession(named, {
    organizationId: "1003",
    ext: "101",
    remoteDigits: "8883369379",
  }),
  true,
);

const noAgent = parseGatewayLine(
  JSON.stringify({
    is_bot: 0,
    speaker: "8883369379",
    text: "Hello",
    customer_number: "918883369379",
  }),
);
assert.ok(noAgent);
assert.equal(noAgent.customerTail, "8883369379");
assert.equal(isCustomerUtterance(noAgent), true);

const bot = parseGatewayLine(
  JSON.stringify({
    session_id: "gw-1",
    is_bot: 1,
    speaker: "919492317136",
    domain_id: "20556",
    text: "I can help with that.",
    customer_number: "919492317136",
    agent: [{ ext: "203" }],
  }),
);
assert.ok(bot);
assert.equal(bot.isBot, true);
assert.equal(isCustomerUtterance(bot), false);
const wrapped = parseGatewayLine(
  JSON.stringify({
    transcript_data: JSON.stringify({
      session_id: "gw-2",
      is_bot: 0,
      speaker: "+919080423182",
      domain_id: "1000",
      text: "Hello there",
      transcriptTm: "0:0:4",
      customer_number: "+919080423182",
      agent: [{ ext: 100, name: "Agent" }],
    }),
  }),
);
assert.ok(wrapped);
assert.equal(wrapped.domainId, "1000");
assert.equal(wrapped.customerTail, "9080423182");
assert.deepEqual(wrapped.agentExts, ["100"]);
assert.equal(isCustomerUtterance(wrapped), true);

assert.equal(parseGatewayLine("not-json"), null);
assert.equal(
  parseGatewayLine(JSON.stringify({ domain_id: "1", text: "hi", customer_number: "1" })),
  null,
);

console.log("call-transcript-line.test.ts ok");
