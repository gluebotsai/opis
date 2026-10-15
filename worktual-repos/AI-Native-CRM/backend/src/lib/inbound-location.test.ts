/**
 * run: npx tsx --tsconfig tsconfig.json src/lib/inbound-location.test.ts
 */
import assert from "node:assert/strict";
import {
  countryFromPhone,
  locationFromInbound,
  splitGeography,
} from "./inbound-location";

assert.equal(countryFromPhone("+91 98765 43210"), "India");
assert.equal(countryFromPhone("919876543210"), "India");
assert.equal(countryFromPhone("9876543210"), null);
assert.equal(countryFromPhone("+65 8123 4567"), "Singapore");
assert.equal(countryFromPhone("+1 4155552671"), "United States");

assert.deepEqual(splitGeography("Bengaluru, Karnataka, India"), {
  city: "Bengaluru, Karnataka",
  country: "India",
});
assert.deepEqual(splitGeography("IN"), {
  city: null,
  country: "India",
});

assert.deepEqual(
  locationFromInbound({ city: "Pune", country: "IN" }, null),
  {
    city: "Pune",
    country: "India",
    addressLine: null,
  },
);
assert.deepEqual(
  locationFromInbound({ location: "Hyderabad, India" }, null),
  {
    city: "Hyderabad",
    country: "India",
    addressLine: null,
  },
);
assert.deepEqual(
  locationFromInbound({ geo: { city: "Dubai", country: "AE" } }, null),
  {
    city: "Dubai",
    country: "United Arab Emirates",
    addressLine: null,
  },
);
assert.equal(
  locationFromInbound({}, "+91 70000 00000").country,
  "India",
);
assert.equal(locationFromInbound({}, "+91 70000 00000").city, null);

console.log("inbound-location.test.ts ok");
