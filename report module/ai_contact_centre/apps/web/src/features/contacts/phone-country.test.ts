import assert from "node:assert/strict";
import test from "node:test";

import {
  nationalFromStored,
  PHONE_COUNTRIES,
  phoneFromNationalInput,
  splitPhoneNumber,
} from "./phone-country";

test("lists a calling code for every supported country", () => {
  assert.ok(PHONE_COUNTRIES.length >= 200);
  assert.ok(PHONE_COUNTRIES.every((country) => /^\+\d{1,3}$/.test(country.dial)));
  assert.equal(new Set(PHONE_COUNTRIES.map((country) => country.iso)).size, PHONE_COUNTRIES.length);
});

test("stores a national number with the selected calling code", () => {
  assert.deepEqual(phoneFromNationalInput("IN", "9876543210"), {
    iso: "IN",
    stored: "919876543210",
  });
  assert.deepEqual(phoneFromNationalInput("IN", "09876543210"), {
    iso: "IN",
    stored: "919876543210",
  });
  assert.deepEqual(phoneFromNationalInput("IN", "919876543210"), {
    iso: "IN",
    stored: "919876543210",
  });
});

test("an explicit international number selects that country", () => {
  assert.deepEqual(phoneFromNationalInput("IN", "+44 7700 900123"), {
    iso: "GB",
    stored: "447700900123",
  });
  assert.deepEqual(phoneFromNationalInput("IN", "447700900123"), {
    iso: "GB",
    stored: "447700900123",
  });
  assert.equal(splitPhoneNumber("447700900123").iso, "GB");
  assert.equal(nationalFromStored("447700900123", "GB"), "7700900123");
});

test("shared calling codes keep the country the agent picked", () => {
  const stored = phoneFromNationalInput("CA", "4165550199");
  assert.equal(stored.stored, "14165550199");
  assert.equal(stored.iso, "CA");
  assert.equal(nationalFromStored(stored.stored, "CA"), "4165550199");
});

test("empty input does not store a bare calling code", () => {
  assert.deepEqual(phoneFromNationalInput("IN", ""), { iso: "IN", stored: "" });
  assert.deepEqual(phoneFromNationalInput("IN", "0"), { iso: "IN", stored: "" });
});
