import assert from "node:assert/strict";
import test from "node:test";

import {
  cancelOfferExpiration,
  computeOfferExpiresAt,
  listExpiredOfferCandidates,
} from "./offer-lifecycle.js";
import { expectedCapacityDelta } from "./lifecycle-contract.js";

test("offer timeout capacity releases reservation only", () => {
  assert.deepEqual(expectedCapacityDelta("offer_timeout"), { reserved: -1, active: 0 });
});

test("computeOfferExpiresAt adds timeout seconds to offered_at", () => {
  const offeredAt = new Date("2026-01-01T00:00:00.000Z");
  const expires = computeOfferExpiresAt(offeredAt, 30);
  assert.equal(expires.toISOString(), "2026-01-01T00:00:30.000Z");
});

test("listExpiredOfferCandidates returns durable SQL filter shape", () => {
  const sql = listExpiredOfferCandidates();
  assert.match(sql, /state\s*=\s*'offered'/i);
  assert.match(sql, /expires_at|offered_at/i);
  assert.match(sql, /FOR UPDATE SKIP LOCKED/i);
});

test("persistOfferExpiration aligns expiry to offered_at plus timeout", () => {
  const offeredAt = new Date("2026-01-01T00:00:00.000Z");
  const expires = computeOfferExpiresAt(offeredAt, 20);
  assert.equal(expires.toISOString(), "2026-01-01T00:00:20.000Z");
});

test("cancelOfferExpiration is idempotent for unknown keys", () => {
  cancelOfferExpiration("00000000-0000-4000-8000-000000000001", "00000000-0000-4000-8000-000000000002");
});
