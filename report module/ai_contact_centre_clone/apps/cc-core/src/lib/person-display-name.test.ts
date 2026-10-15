import assert from "node:assert/strict";
import test from "node:test";

import {
  formatPersonDisplayName,
  resolveCustomerDisplayLabel,
} from "./person-display-name.js";

test("formatPersonDisplayName uses first name only", () => {
  assert.equal(
    formatPersonDisplayName({ firstName: "Santhosh", lastName: null }),
    "Santhosh",
  );
});

test("formatPersonDisplayName uses last name only", () => {
  assert.equal(formatPersonDisplayName({ firstName: "", lastName: "Kumar" }), "Kumar");
});

test("formatPersonDisplayName falls back to Customer", () => {
  assert.equal(formatPersonDisplayName({}), "Customer");
});

test("formatPersonDisplayName avoids repeating identical first and last name", () => {
  assert.equal(
    formatPersonDisplayName({ firstName: "Bharathi", lastName: "Bharathi" }),
    "Bharathi",
  );
});

test("formatPersonDisplayName collapses duplicated full name tokens", () => {
  assert.equal(formatPersonDisplayName({ fullName: "Bharathi Bharathi" }), "Bharathi");
});

test("resolveCustomerDisplayLabel prefers profile over channel name", () => {
  assert.equal(
    resolveCustomerDisplayLabel({
      profileFirstName: "Bharathi",
      profileLastName: "Sivakumar",
      channelDisplayName: "WA Nick",
      visitorId: "919999999999",
      channelFallback: "WhatsApp",
    }),
    "Bharathi Sivakumar",
  );
});

test("resolveCustomerDisplayLabel falls back to channel name then visitor", () => {
  assert.equal(
    resolveCustomerDisplayLabel({
      channelDisplayName: "WA Nick",
      visitorId: "919999999999",
      channelFallback: "WhatsApp",
    }),
    "WA Nick",
  );
  assert.equal(
    resolveCustomerDisplayLabel({
      visitorId: "919999999999",
      channelFallback: "WhatsApp",
    }),
    "Visitor 919999999999",
  );
});
