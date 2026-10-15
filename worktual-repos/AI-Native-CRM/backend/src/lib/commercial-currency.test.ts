/**
 * run: npx tsx --tsconfig tsconfig.json src/lib/commercial-currency.test.ts
 */
import assert from "node:assert/strict";
import {
  chooseDealAmountCurrency,
  currencyFromCountry,
  currencyFromProductCodes,
  preferredQuoteCurrency,
} from "./commercial-currency";

assert.equal(currencyFromCountry("India"), "INR");
assert.equal(currencyFromCountry("IN"), "INR");
assert.equal(currencyFromCountry("United Kingdom"), "GBP");
assert.equal(currencyFromCountry("United States"), "USD");
assert.equal(currencyFromCountry(""), null);
assert.equal(currencyFromCountry("Japan"), null);

assert.equal(
  chooseDealAmountCurrency({ quoteCurrency: null, tenantCurrency: "INR" }),
  "INR",
);
assert.equal(
  chooseDealAmountCurrency({ quoteCurrency: "USD", tenantCurrency: "INR" }),
  "INR",
);
assert.equal(
  chooseDealAmountCurrency({ quoteCurrency: "EUR", tenantCurrency: "INR" }),
  "EUR",
);
assert.equal(
  chooseDealAmountCurrency({ quoteCurrency: "USD", tenantCurrency: "USD" }),
  "USD",
);
assert.equal(
  chooseDealAmountCurrency({ quoteCurrency: null, tenantCurrency: null }),
  null,
);

assert.equal(currencyFromProductCodes(["inr", "INR"]), "INR");
assert.equal(currencyFromProductCodes([null, ""]), null);

const picked = preferredQuoteCurrency([
  {
    dealId: "d1",
    currency: "usd",
    status: "draft",
    updatedAt: new Date("2026-09-01"),
  },
  {
    dealId: "d1",
    currency: "EUR",
    status: "accepted",
    updatedAt: new Date("2026-08-01"),
  },
]);
assert.equal(picked.get("d1"), "EUR");

console.log("commercial-currency.test.ts ok");
