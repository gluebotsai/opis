import assert from "node:assert/strict";
import test from "node:test";

import {
  additionalContactFields,
  buildContactUpdateInput,
  contactFormErrorMessage,
  emptyContactForm,
} from "./contacts-utils";

test("primary and secondary phones cannot be the same number", () => {
  const form = {
    ...emptyContactForm(),
    primaryEmail: "person@example.com",
    primaryPhone: "919876543210",
    secondaryPhone: "9876543210",
  };
  assert.throws(
    () => buildContactUpdateInput(form),
    /Primary phone and secondary phone must be different/,
  );
});

test("missing and invalid fields are named together", () => {
  const message = contactFormErrorMessage({
    ...emptyContactForm(),
    lastName: "wdwwdd",
    primaryPhone: "919626864691",
    secondaryEmail: "not-an-email",
    dateOfBirth: "2020-13-40",
  });
  assert.match(message ?? "", /First name is required/);
  assert.match(message ?? "", /Primary email is required/);
  assert.match(message ?? "", /Secondary email must be a valid email address/);
  assert.match(message ?? "", /Date of birth must be a valid date/);
});

test("additional information lists only extra custom fields that have values", () => {
  assert.deepEqual(additionalContactFields({}), []);
  assert.deepEqual(
    additionalContactFields({
      isActive: true,
      industry: "Software",
      customerName: "Fazil Mohammed",
      omniChannelSummary: "Already shown separately",
      profileAttributes: { tier: "gold" },
      notes: "  Prefers WhatsApp  ",
      customerType: "VIP",
      empty: "   ",
    }),
    [
      { key: "notes", label: "Notes", value: "Prefers WhatsApp" },
      { key: "customerType", label: "Customer Type", value: "VIP" },
    ],
  );
});

test("different phone numbers are saved", () => {
  const form = {
    ...emptyContactForm(),
    firstName: "Priya",
    primaryEmail: "person@example.com",
    primaryPhone: "919876543210",
    secondaryPhone: "919876543211",
  };
  const input = buildContactUpdateInput(form);
  assert.equal(input.primaryPhone, "919876543210");
  assert.equal(input.secondaryPhone, "919876543211");
});
