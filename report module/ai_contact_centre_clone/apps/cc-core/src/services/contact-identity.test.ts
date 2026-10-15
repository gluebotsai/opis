import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyContactEnrichmentOutcome,
  enrichConversationContactSchema,
  extractContactEntitiesFromFacts,
  extractIdentityFromText,
  extractLocationFromText,
  extractPrechatIdentity,
  getAppliedEnrichmentFields,
  hasEnrichableContactData,
  hasProfileEnrichmentData,
  mergeContactCaptureSources,
  normalizeEmail,
  normalizePhone,
  partitionContactEnrichment,
  pruneRedundantEnrichmentFields,
  resolveContactInputSchema,
  resolveExplicitNameEnrichment,
  resolveNameEnrichment,
  isStoredConversationId,
  voiceSessionIdsMatch,
  omitIdentityOwnedByAnotherContact,
  blockIdentityOwnedByAnotherContact,
} from "./contact-identity.js";
import type { CdpContactRecord } from "./contacts.js";
import { buildContactEnrichedPayload } from "./realtime.js";

test("voice enrich accepts a numeric conversation id and matches a session id", () => {
  assert.equal(isStoredConversationId("147512"), true);
  assert.equal(
    isStoredConversationId("+9188833693792858e382-3b66-1240-3482-bc2411477a90"),
    false,
  );
  assert.equal(
    voiceSessionIdsMatch(
      "+9188833693792858e382-3b66-1240-3482-bc2411477a90",
      "+9188833693792858e382-3b66-1240-3482-bc2411477a90",
    ),
    true,
  );
  assert.equal(
    voiceSessionIdsMatch(
      "2858e382-3b66-1240-3482-bc2411477a90",
      "+9188833693792858e382-3b66-1240-3482-bc2411477a90",
    ),
    true,
  );
});

test("normalizeEmail lowercases and trims", () => {
  assert.equal(normalizeEmail("  Alice@Co.COM "), "alice@co.com");
  assert.equal(normalizeEmail("invalid"), null);
  assert.equal(normalizeEmail("alice @example.com"), null);
  assert.equal(normalizeEmail("alice@example"), null);
});

test("normalizePhone strips formatting", () => {
  assert.equal(normalizePhone("+1 (555) 123-4567"), "15551234567");
  assert.equal(normalizePhone("123"), null);
  assert.equal(normalizePhone("+1 555 123 4567 ext 9"), null);
  assert.equal(normalizePhone("++1 555 123 4567"), null);
  assert.equal(normalizePhone("+1234567890123456"), null);
});

test("mergeContactCaptureSources extracts phone from natural language", () => {
  const merged = mergeContactCaptureSources({
    customerText: "My mobile number is +91 91509 11820 and email is rahul@example.com",
  });
  assert.equal(merged.phone, "919150911820");
  assert.equal(merged.email, "rahul@example.com");
});

test("getAppliedEnrichmentFields detects lastName updates directly", () => {
  const before = contact({ firstName: "Bharathi", lastName: "Sivakumar", fullName: "Bharathi Sivakumar" });
  const after = contact({ firstName: "Bharathi", lastName: "S", fullName: "Bharathi S" });
  assert.deepEqual(getAppliedEnrichmentFields(before, after, { lastName: "S" }), ["lastName"]);
});

test("enrichment schema accepts first and last name fields", () => {
  const parsed = enrichConversationContactSchema.parse({
    firstName: "Bharathi",
    lastName: "S",
    sourceMessageId: "5337",
  });
  assert.equal(parsed.firstName, "Bharathi");
  assert.equal(parsed.lastName, "S");
});

test("enrichment schema accepts field-scoped confirmation", () => {
  const parsed = enrichConversationContactSchema.parse({
    email: "new@example.com",
    confirmedFields: ["email"],
  });
  assert.deepEqual(parsed.confirmedFields, ["email"]);
});

test("enrichment schema accepts an idempotency source but ignores contact ids", () => {
  const parsed = enrichConversationContactSchema.parse({
    email: "alice@example.com",
    sourceMessageId: "5337",
    contactId: "00000000-0000-4000-8000-000000000099",
  });
  assert.equal(parsed.sourceMessageId, "5337");
  assert.equal("contactId" in parsed, false);
});

function contact(overrides: Partial<CdpContactRecord> = {}): CdpContactRecord {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    organizationId: "00000000-0000-4000-8000-000000000002",
    firstName: "Alice",
    lastName: null,
    fullName: "Alice",
    primaryEmail: null,
    primaryPhone: null,
    secondaryEmail: null,
    secondaryPhone: null,
    gender: null,
    dateOfBirth: null,
    company: null,
    industry: null,
    city: null,
    region: null,
    country: null,
    language: null,
    timezone: null,
    sourceSystem: null,
    customFields: {},
    isActive: true,
    createdAt: "2026-08-07T00:00:00.000Z",
    updatedAt: "2026-08-07T00:00:00.000Z",
    profile: null,
    ...overrides,
  };
}

test("getAppliedEnrichmentFields reports only authoritative changes", () => {
  const before = contact();
  const after = contact({
    primaryEmail: "alice@example.com",
    company: "Acme",
    city: "Chennai",
  });
  assert.deepEqual(
    getAppliedEnrichmentFields(before, after, {
      email: " ALICE@example.com ",
      company: "Acme",
      city: "Chennai",
      country: "India",
    }),
    ["email", "company", "city"],
  );
});

test("pruneRedundantEnrichmentFields drops values already on profile", () => {
  const existing = contact({
    primaryEmail: "alice@example.com",
    firstName: "Alice",
    city: "London",
  });
  const pruned = pruneRedundantEnrichmentFields(existing, {
    email: "alice@example.com",
    firstName: "Alice",
    city: "Paris",
  });
  assert.equal(pruned.email, undefined);
  assert.equal(pruned.firstName, undefined);
  assert.equal(pruned.city, "Paris");
});

test("partitionContactEnrichment fills an empty phone and replaces a free email", () => {
  const existing = contact({
    primaryEmail: "henry.cavill@example.com",
    primaryPhone: null,
  });
  const result = partitionContactEnrichment(existing, {
    email: "henry16@gmail.com",
    phone: "8467565853",
  });

  assert.equal(result.applicable.email, "henry16@gmail.com");
  assert.equal(result.applicable.phone, "8467565853");
  assert.deepEqual(result.requiresConfirmation, []);
  assert.deepEqual(result.skippedFields, []);
});

test("omitIdentityOwnedByAnotherContact blocks a taken email and phone", () => {
  const result = omitIdentityOwnedByAnotherContact(
    { email: "taken@example.com", phone: "919876543210", city: "Chennai" },
    { email: true, phone: true },
  );
  assert.equal(result.enrich.email, undefined);
  assert.equal(result.enrich.phone, undefined);
  assert.equal(result.enrich.city, "Chennai");
  assert.deepEqual(
    result.skippedFields.map((field) => field.reason),
    ["identity_owned_by_other_contact", "identity_owned_by_other_contact"],
  );
});

test("omitIdentityOwnedByAnotherContact keeps a free email", () => {
  const result = omitIdentityOwnedByAnotherContact(
    { email: "free@example.com" },
    { email: false, phone: false },
  );
  assert.equal(result.enrich.email, "free@example.com");
  assert.deepEqual(result.skippedFields, []);
});

test("an empty identity is recognized instead of blocked", () => {
  assert.deepEqual(
    blockIdentityOwnedByAnotherContact(
      { email: true, phone: true },
      { email: null, phone: "" },
    ),
    { email: false, phone: false },
  );
  assert.deepEqual(
    blockIdentityOwnedByAnotherContact(
      { email: true, phone: false },
      { email: "ada@example.com", phone: null },
    ),
    { email: true, phone: false },
  );
});

test("partitionContactEnrichment skips duplicate email with explicit tool guidance", () => {
  const existing = contact({ primaryEmail: "sansanthosh965@gmail.com" });
  const result = partitionContactEnrichment(existing, {
    email: "sansanthosh965@gmail.com",
  });

  assert.equal(result.applicable.email, undefined);
  assert.equal(result.skippedFields[0]?.reason, "already_on_profile");
  assert.match(result.skippedFields[0]?.message ?? "", /Do not call contact_enrich/i);
});

test("partitionContactEnrichment allows an explicitly confirmed email replacement", () => {
  const existing = contact({ primaryEmail: "old@example.com" });
  const result = partitionContactEnrichment(existing, {
    email: "new@example.com",
    confirmedFields: ["email"],
  });

  assert.equal(result.applicable.email, "new@example.com");
  assert.deepEqual(result.requiresConfirmation, []);
  assert.deepEqual(result.skippedFields, []);
});

test("classifyContactEnrichmentOutcome covers the normalized contract", () => {
  const classify = (
    overrides: Partial<Parameters<typeof classifyContactEnrichmentOutcome>[0]>,
  ) =>
    classifyContactEnrichmentOutcome({
      created: false,
      merged: false,
      previousContactId: "00000000-0000-4000-8000-000000000001",
      appliedFields: [],
      ...overrides,
    });

  assert.equal(classify({ created: true }), "created");
  assert.equal(classify({ merged: true }), "merged_existing");
  assert.equal(classify({ previousContactId: null }), "linked_existing");
  assert.equal(classify({ appliedFields: ["city"] }), "enriched");
  assert.equal(
    classify({
      appliedFields: ["phone"],
      skippedFields: [{
        field: "email",
        proposedValue: "new@example.com",
        currentValue: "old@example.com",
        reason: "profile_conflict",
        message: "confirmation required",
      }],
    }),
    "partial",
  );
  assert.equal(
    classify({
      skippedFields: [{
        field: "email",
        proposedValue: "new@example.com",
        currentValue: "old@example.com",
        reason: "profile_conflict",
        message: "confirmation required",
      }],
    }),
    "confirmation_required",
  );
  assert.equal(classify({}), "no_change");
});

test("contact.enriched payload includes tenant, conversation, and authoritative contact", () => {
  const authoritativeContact = contact({ primaryEmail: "alice@example.com" });
  const payload = buildContactEnrichedPayload(
    authoritativeContact.organizationId,
    "00000000-0000-4000-8000-000000000003",
    {
      outcome: "enriched",
      canonicalContactId: authoritativeContact.id,
      previousContactId: authoritativeContact.id,
      appliedFields: ["email"],
      skippedFields: [],
      requiresConfirmation: [],
      contact: authoritativeContact,
      idempotentReplay: false,
    },
  );
  assert.equal(payload.tenantId, authoritativeContact.organizationId);
  assert.equal(payload.conversationId, "00000000-0000-4000-8000-000000000003");
  assert.equal(payload.contact, authoritativeContact);
});

test("extractPrechatIdentity reads common prechat keys", () => {
  const identity = extractPrechatIdentity({
    email: "guest@example.com",
    phone: "+44 7700 900123",
    fullName: "Jane Doe",
  });
  assert.equal(identity.email, "guest@example.com");
  assert.equal(identity.phone, "447700900123");
  assert.equal(identity.displayName, "Jane Doe");
});

test("extractIdentityFromText finds email and phone in free text", () => {
  const identity = extractIdentityFromText(
    "Please call me at +1 555 987 6543 or email me at bob@example.com",
  );
  assert.equal(identity.email, "bob@example.com");
  assert.match(identity.phone ?? "", /5559876543/);
});

test("extractLocationFromText finds city in common customer phrases", () => {
  assert.deepEqual(extractLocationFromText("My location is chennai"), { city: "Chennai" });
  assert.deepEqual(extractLocationFromText("I'm based in New York"), { city: "New York" });
});

test("mergeContactCaptureSources reads city from customer text", () => {
  const merged = mergeContactCaptureSources({
    customerText: "My location is chennai",
  });
  assert.equal(merged.city, "Chennai");
});

test("mergeContactCaptureSources extracts email from natural update phrasing", () => {
  const merged = mergeContactCaptureSources({
    customerText: "update my email to brthsivakumar@gmail.com",
  });
  assert.equal(merged.email, "brthsivakumar@gmail.com");
  assert.equal(hasEnrichableContactData(merged), true);
});

test("resolveContactInputSchema validates channel payload", () => {
  const parsed = resolveContactInputSchema.parse({
    channel: "email",
    email: "alice@co.com",
  });
  assert.equal(parsed.channel, "email");
  assert.equal(parsed.email, "alice@co.com");
});

test("resolveContactInputSchema accepts call with phone identity", () => {
  const parsed = resolveContactInputSchema.parse({
    channel: "call",
    phone: "919492317136",
  });
  assert.equal(parsed.channel, "call");
  assert.equal(parsed.phone, "919492317136");
});

test("extractContactEntitiesFromFacts reads prefixed contact facts", () => {
  const entities = extractContactEntitiesFromFacts([
    "contact.email=bhrthsivakumar@gmail.com",
    "contact.display_name=Bharathi",
    "contact.phone=919150911820",
  ]);
  assert.equal(entities.email, "bhrthsivakumar@gmail.com");
  assert.equal(entities.displayName, "Bharathi");
  assert.equal(entities.phone, "919150911820");
});

test("mergeContactCaptureSources prefers structured entities over regex", () => {
  const merged = mergeContactCaptureSources({
    customerText: "My email is wrong@example.com",
    importantFacts: ["contact.email=bhrthsivakumar@gmail.com"],
    contactEntities: {
      email: "bhrthsivakumar@gmail.com",
      phone: null,
      firstName: "Bharathi",
      lastName: null,
      displayName: null,
      company: null,
      city: null,
      country: null,
    },
  });
  assert.equal(merged.email, "bhrthsivakumar@gmail.com");
  assert.equal(merged.firstName, "Bharathi");
});

test("hasProfileEnrichmentData ignores phone-only payloads", () => {
  assert.equal(hasProfileEnrichmentData({ phone: "919150911820" }), false);
  assert.equal(hasEnrichableContactData({ phone: "919150911820" }), true);
  assert.equal(hasProfileEnrichmentData({ lastName: "S" }), true);
  assert.equal(hasProfileEnrichmentData({ firstName: "Bharathi" }), true);
});

test("mergeContactCaptureSources reads first and last name from important facts", () => {
  const merged = mergeContactCaptureSources({
    importantFacts: ["contact.first_name=Bharathi", "contact.last_name=S"],
  });
  assert.equal(merged.firstName, "Bharathi");
  assert.equal(merged.lastName, "S");
});

test("resolveExplicitNameEnrichment updates only last name when first omitted", () => {
  assert.deepEqual(
    resolveExplicitNameEnrichment({ lastName: "S" }, { firstName: "Bharathi", lastName: "Sivakumar" }),
    { firstName: "Bharathi", lastName: "S" },
  );
});

test("resolveExplicitNameEnrichment updates only first name when last omitted", () => {
  assert.deepEqual(
    resolveExplicitNameEnrichment({ firstName: "Bharathi" }, { firstName: null, lastName: "Kumar" }),
    { firstName: "Bharathi", lastName: "Kumar" },
  );
});

test("resolveNameEnrichment merges last-name-only update with existing first name", () => {
  assert.deepEqual(
    resolveNameEnrichment("Kumar", { firstName: "Bharathi", lastName: null }),
    { firstName: "Bharathi", lastName: "Kumar" },
  );
});

test("resolveNameEnrichment splits full display names", () => {
  assert.deepEqual(
    resolveNameEnrichment("Bharathi Kumar", { firstName: "Bharathi", lastName: null }),
    { firstName: "Bharathi", lastName: "Kumar" },
  );
});

test("resolveNameEnrichment preserves first name when customer repeats it alone", () => {
  assert.equal(
    resolveNameEnrichment("Bharathi", { firstName: "Bharathi", lastName: null }),
    null,
  );
});
