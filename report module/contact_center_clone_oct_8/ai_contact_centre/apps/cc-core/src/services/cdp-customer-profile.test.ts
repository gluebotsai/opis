import assert from "node:assert/strict";
import test from "node:test";

import {
  CUSTOMER_PROFILE_SELECT,
  IDENTITY_KEY_TYPES,
  PHONE_MATCH_IDENTITY_KEYS,
  normalizeIdentityKeyValue,
  phonesMatchWithCountryCode,
} from "./cdp-customer-profile.js";

test("phones match with a country code, plus, or 00 prefix", () => {
  assert.equal(phonesMatchWithCountryCode("+91 7011123765", "7011123765"), true);
  assert.equal(phonesMatchWithCountryCode("917011123765", "7011123765"), true);
  assert.equal(phonesMatchWithCountryCode("00917011123765", "+91-70111-23765"), true);
  assert.equal(phonesMatchWithCountryCode("+1 (415) 555-2671", "4155552671"), true);
  assert.equal(phonesMatchWithCountryCode("+44 20 7946 0958", "2079460958"), true);
  assert.equal(phonesMatchWithCountryCode("7011123765", "7011123766"), false);
  assert.equal(phonesMatchWithCountryCode("99997011123765", "7011123765"), false);
});

test("normalizeIdentityKeyValue lowercases email keys", () => {
  assert.equal(
    normalizeIdentityKeyValue(IDENTITY_KEY_TYPES.EMAIL, "  SanSanthosh965@Gmail.COM "),
    "sansanthosh965@gmail.com",
  );
});

test("normalizeIdentityKeyValue strips phone formatting", () => {
  assert.equal(
    normalizeIdentityKeyValue(IDENTITY_KEY_TYPES.PHONE, "+91 73396 37136"),
    "917339637136",
  );
});

test("normalizeIdentityKeyValue preserves webchat visitor ids", () => {
  const visitor = "visitor_12647cfb-13bc-4c88-941c-63a1029a5507";
  assert.equal(
    normalizeIdentityKeyValue(IDENTITY_KEY_TYPES.WEBCHAT_VISITOR, visitor),
    visitor,
  );
});

test("phone match keys include WhatsApp phone", () => {
  assert.deepEqual([...PHONE_MATCH_IDENTITY_KEYS], [
    IDENTITY_KEY_TYPES.PHONE,
    IDENTITY_KEY_TYPES.PHONE_SECONDARY,
    IDENTITY_KEY_TYPES.WHATSAPP_PHONE,
  ]);
  assert.equal(
    normalizeIdentityKeyValue(IDENTITY_KEY_TYPES.WHATSAPP_PHONE, "+91 73396 37136"),
    "917339637136",
  );
});

test("contact profile reads the newest identity key when duplicates exist", () => {
  assert.match(CUSTOMER_PROFILE_SELECT, /key_type = 'phone'\s+ORDER BY created_at DESC/s);
  assert.match(CUSTOMER_PROFILE_SELECT, /key_type = 'email'\s+ORDER BY created_at DESC/s);
  assert.match(CUSTOMER_PROFILE_SELECT, /COALESCE\(cp\.blocked, FALSE\) AS blocked/);
});
