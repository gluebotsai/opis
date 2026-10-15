import assert from "node:assert/strict";
import test from "node:test";

import {
  buildContactSearchFilter,
  contactCreatedCountQuerySchema,
  contactCreateSchema,
  contactUpdateSchema,
  formatContactSchemaError,
  splitContactSearchTokens,
} from "./contacts.js";

test("contact created count validates an inclusive date range", () => {
  assert.deepEqual(
    contactCreatedCountQuerySchema.parse({
      startDate: "2026-09-14",
      endDate: "2026-09-14",
    }),
    { startDate: "2026-09-14", endDate: "2026-09-14" },
  );
  assert.throws(
    () =>
      contactCreatedCountQuerySchema.parse({
        startDate: "2026-09-15",
        endDate: "2026-09-14",
      }),
    /startDate must be on or before endDate/,
  );
});

test("contact create validation normalizes email and blank optional fields", () => {
  const input = contactCreateSchema.parse({
    firstName: "  Priya ",
    lastName: "",
    primaryEmail: " PRIYA@EXAMPLE.COM ",
    secondaryEmail: "",
    customFields: { tier: "enterprise" },
  });

  assert.equal(input.firstName, "Priya");
  assert.equal(input.lastName, null);
  assert.equal(input.primaryEmail, "priya@example.com");
  assert.equal(input.secondaryEmail, null);
  assert.deepEqual(input.customFields, { tier: "enterprise" });
});

test("contact create validation rejects missing first name or invalid email", () => {
  assert.throws(
    () => contactCreateSchema.parse({ firstName: "", primaryEmail: "priya@example.com" }),
    /First name is required/i,
  );
  assert.throws(
    () => contactCreateSchema.parse({ firstName: "Priya", primaryEmail: "not-an-email" }),
    /email/i,
  );
});

test("contact create validation permits phone without email when first name present", () => {
  const input = contactCreateSchema.parse({
    firstName: "Priya",
    primaryPhone: "+1234567890",
  });
  assert.equal(input.firstName, "Priya");
  assert.equal(input.primaryEmail, null);
  assert.equal(input.primaryPhone, "+1234567890");
  assert.equal(input.blocked, false);
});

test("contact create rejects the same email or phone on primary and secondary", () => {
  assert.throws(
    () =>
      contactCreateSchema.parse({
        firstName: "Priya",
        primaryEmail: "priya@example.com",
        secondaryEmail: "PRIYA@example.com",
      }),
    /Primary email and secondary email must be different/,
  );
  assert.throws(
    () =>
      contactCreateSchema.parse({
        firstName: "Priya",
        primaryPhone: "9007788990",
        secondaryPhone: "+91 90077 88990",
      }),
    /Primary phone and secondary phone must be different/,
  );
});

test("contact create and update accept blocked", () => {
  const created = contactCreateSchema.parse({
    firstName: "Priya",
    primaryEmail: "priya@example.com",
    blocked: true,
  });
  assert.equal(created.blocked, true);
  const patch = contactUpdateSchema.parse({ blocked: true });
  assert.equal(patch.blocked, true);
});

test("contact search splits a full name into tokens", () => {
  assert.deepEqual(splitContactSearchTokens("  Sanju   Ravi "), ["Sanju", "Ravi"]);
});

test("contact search matches the shown name and a phone with separators", () => {
  const named = buildContactSearchFilter(2, "Subaz");
  assert.match(named.sql, /custom_fields->>'customerName'/);
  assert.match(named.sql, /email2_ik/);
  assert.doesNotMatch(named.sql, /regexp_replace/);

  const phone = buildContactSearchFilter(2, "+919150911820");
  assert.match(phone.sql, /regexp_replace/);
  assert.deepEqual(phone.values, ["%+919150911820%", "%919150911820%"]);

  const spaced = buildContactSearchFilter(2, "+91 91509 11820");
  assert.match(spaced.sql, /regexp_replace/);
  assert.ok(spaced.values.includes("%919150911820%"));
});

test("contact search matches concatenated and tokenized full names", () => {
  const single = buildContactSearchFilter(2, "Sanju");
  assert.match(single.sql, /concat_ws\(' ', cp\.first_name, cp\.last_name\)/);
  assert.deepEqual(single.values, ["%Sanju%"]);

  const full = buildContactSearchFilter(2, "Sanju Ravi");
  assert.match(full.sql, /concat_ws\(' ', cp\.first_name, cp\.last_name\)/);
  assert.match(full.sql, /\$3/);
  assert.match(full.sql, /\$4/);
  assert.deepEqual(full.values, ["%Sanju Ravi%", "%Sanju%", "%Ravi%"]);
});

test("contact validation names every invalid field", () => {
  const created = contactCreateSchema.safeParse({
    firstName: null,
    primaryEmail: "not-an-email",
    dateOfBirth: "32/13/2020",
  });
  assert.equal(created.success, false);
  if (created.success) return;
  const message = formatContactSchemaError(created.error);
  assert.match(message, /First name is required/);
  assert.match(message, /Primary email must be a valid email address/);
  assert.match(message, /Date of birth must be a valid date/);

  const updated = contactUpdateSchema.safeParse({ firstName: null, secondaryEmail: "bad" });
  assert.equal(updated.success, false);
  if (updated.success) return;
  const updateMessage = formatContactSchemaError(updated.error);
  assert.match(updateMessage, /First name is required/);
  assert.match(updateMessage, /Secondary email must be a valid email address/);
});

test("contact update requires at least one field and supports explicit clears", () => {
  assert.throws(() => contactUpdateSchema.parse({}), /At least one contact field/);

  const patch = contactUpdateSchema.parse({
    company: null,
    primaryPhone: " +44 1234 ",
  });
  assert.equal(patch.company, null);
  assert.equal(patch.primaryPhone, "+44 1234");
});
