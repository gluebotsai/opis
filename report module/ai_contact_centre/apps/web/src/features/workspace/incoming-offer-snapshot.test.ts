import assert from "node:assert/strict";
import test from "node:test";

import { incomingOfferReducer } from "./incoming-offer-snapshot";
import type { WorkspaceConversation } from "./types";

const digital = {
  id: "conversation-1",
  channel: "chat",
  offerPending: true,
} as WorkspaceConversation;

test("banner and local ring are atomic for SIP and digital offers", () => {
  const sip = incomingOfferReducer(null, {
    type: "sip",
    active: true,
    id: "call-1",
    generation: 1,
  });
  assert.equal(sip?.showBanner, true);
  assert.equal(sip?.playLocalRing, true);

  const next = incomingOfferReducer(sip, {
    type: "digital",
    conversation: digital,
    generation: 2,
  });
  assert.equal(next?.showBanner, next?.playLocalRing);
});

test("stale hydrate cannot clear a newer live offer", () => {
  const live = incomingOfferReducer(null, {
    type: "digital",
    conversation: digital,
    generation: 4,
  });
  assert.equal(
    incomingOfferReducer(live, {
      type: "hydrate",
      conversation: null,
      generation: 3,
    }),
    live,
  );
});
