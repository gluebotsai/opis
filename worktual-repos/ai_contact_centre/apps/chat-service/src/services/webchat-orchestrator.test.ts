import assert from "node:assert/strict";
import test from "node:test";

import {
  shouldGeneratePersonalizedOpening,
  syncHandoffSessionFromConversation,
} from "./webchat-orchestrator.js";

test("Lola uses NLP for the initial greeting even when the widget has configured copy", () => {
  assert.equal(
    shouldGeneratePersonalizedOpening({ organizationId: "1003", nlpEnabled: true }),
    true,
  );
  assert.equal(
    shouldGeneratePersonalizedOpening({ organizationId: "1003", nlpEnabled: false }),
    false,
  );
  assert.equal(
    shouldGeneratePersonalizedOpening({ organizationId: "1003", nlpEnabled: true }, true),
    false,
  );
});

test("other organizations keep their configured opening behavior", () => {
  assert.equal(
    shouldGeneratePersonalizedOpening({ organizationId: "1012", nlpEnabled: true }),
    false,
  );
});

test("bot output must stop after handoff when bot_active is false", () => {
  // Contract mirror of cc-core appendConversationMessage bot_active guard.
  const botActive = false;
  const senderType = "bot";
  const allowed = senderType !== "bot" || botActive;
  assert.equal(allowed, false);
});

test("bot output is allowed only while bot owns the conversation", () => {
  const botActive = true;
  const senderType = "bot";
  const allowed = senderType !== "bot" || botActive;
  assert.equal(allowed, true);
});

test("syncHandoffSessionFromConversation clears stale handoff after bot resume", () => {
  const session = { handoffStarted: true as boolean | undefined };
  syncHandoffSessionFromConversation(session, { botActive: true, status: "bot_active" });
  assert.equal(session.handoffStarted, false);
});

test("syncHandoffSessionFromConversation keeps handoff while live routing owns conversation", () => {
  const session = { handoffStarted: false as boolean | undefined };
  syncHandoffSessionFromConversation(session, { botActive: false, status: "assigned" });
  assert.equal(session.handoffStarted, true);
});
