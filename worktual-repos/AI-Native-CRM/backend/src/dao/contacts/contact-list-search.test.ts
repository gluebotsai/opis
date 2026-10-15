/**
 * run: npx tsx src/dao/contacts/contact-list-search.test.ts
 */
import assert from "node:assert/strict";
import {
  createdDayRange,
  interpretContactListSearch,
  normalizeContactTypeFilter,
  normalizeCreatedOn,
  normalizeLeadStatusFilter,
} from "./contact-list-search";

const now = new Date("2026-10-09T00:00:00+05:30");

const august = interpretContactListSearch(
  "filter the contacts that created august 23",
  now,
);
assert.equal(august.createdOn, "2026-08-23");
assert.equal(august.text, "");

const placed = interpretContactListSearch("contacts in Chennai created on 23 August 2026", now);
assert.equal(placed.createdOn, "2026-08-23");
assert.equal(placed.text, "Chennai");

const iso = interpretContactListSearch("2026-08-23", now);
assert.equal(iso.createdOn, "2026-08-23");
assert.equal(iso.text, "");

const name = interpretContactListSearch("Ashika", now);
assert.equal(name.createdOn, null);
assert.equal(name.text, "Ashika");

const owner = interpretContactListSearch("owner Daniel ben", now);
assert.equal(owner.createdOn, null);
assert.equal(owner.text, "Daniel ben");

const place = interpretContactListSearch("in Bangalore", now);
assert.equal(place.text, "Bangalore");

const source = interpretContactListSearch("lead source worktual", now);
assert.equal(source.text, "worktual");

const fillerOnly = interpretContactListSearch("filter", now);
assert.equal(fillerOnly.createdOn, null);
assert.equal(fillerOnly.text, "filter");

assert.equal(normalizeLeadStatusFilter("Qualified"), "qualified");
assert.equal(normalizeLeadStatusFilter("all"), null);
assert.equal(normalizeContactTypeFilter("Prospects"), "prospect");
assert.equal(normalizeContactTypeFilter("qualified"), null);

assert.equal(normalizeCreatedOn("23 Aug 2026", now), "2026-08-23");
assert.equal(normalizeCreatedOn("2026-08-23", now), "2026-08-23");
assert.equal(normalizeCreatedOn("not a date", now), null);

const range = createdDayRange("2026-08-23");
assert.equal(range?.start.toISOString(), "2026-08-22T18:30:00.000Z");
assert.equal(range?.end.toISOString(), "2026-08-23T18:30:00.000Z");

console.log("contact-list-search.test.ts ok");
