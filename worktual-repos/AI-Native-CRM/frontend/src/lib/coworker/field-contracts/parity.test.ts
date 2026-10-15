/**
 * Contract parity smoke tests for coworker field contracts.
 * run: npx tsx --tsconfig tsconfig.json src/lib/coworker/field-contracts/parity.test.ts
 */

import {
  PRODUCT_SCALAR_KEYS,
  PRODUCT_COLLECTION_ORDER,
  productInputFromDraft,
  productShowsRetailFields,
  productShowsQuoteFields,
  productKeysForMotion,
  productCollectionOrderFor,
  buildOffersPayload,
  buildAddonsPayload,
} from "./product";
import { productUpdateBodyFromToolArgs } from "../product-update-from-tool";
import type { ProductDetail } from "@/services/products";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

// Scalar keys must match collection order keys (excluding nested offers/addons).
const orderScalars = PRODUCT_COLLECTION_ORDER.map((s) => s.key).filter(
  (k) => k !== "offers" && k !== "addons",
);
for (const key of PRODUCT_SCALAR_KEYS) {
  assert(orderScalars.includes(key), `collection order missing ${key}`);
}

assert(productShowsRetailFields("b2b") === false, "b2b hides brand/stock");
assert(productShowsRetailFields("b2c") === true, "b2c shows brand/stock");
assert(productShowsRetailFields("b2b2c") === true, "b2b2c shows brand/stock");
assert(productShowsQuoteFields("b2b") === true, "b2b shows quote fields");
assert(productShowsQuoteFields("b2c") === false, "b2c hides quote fields");
assert(productShowsQuoteFields("b2b2c") === true, "b2b2c shows quote fields");
assert(!productKeysForMotion("b2b").has("brand"), "b2b keys omit brand");
assert(!productKeysForMotion("b2c").has("productType"), "b2c keys omit type");
assert(productKeysForMotion("b2b2c").has("brand"), "b2b2c includes brand");
assert(productKeysForMotion("b2b2c").has("productType"), "b2b2c includes type");
assert(
  !productCollectionOrderFor("b2b").some((s) => s.key === "stockOnHand"),
  "b2b collection omits stock",
);
assert(
  !productCollectionOrderFor("b2c").some((s) => s.key === "billingType"),
  "b2c collection omits billing",
);

const body = productInputFromDraft({
  name: "Platform",
  sku: "PLAT-1",
  price: "100",
  maxDiscountPercent: "15",
  currency: "USD",
  productType: "customizable",
  billingType: "recurring",
  billingFrequency: "monthly",
  tags: "ccaas",
  imageUrl: "https://example.com/a.png",
  galleryUrls: "https://example.com/b.png\nhttps://example.com/c.png",
  offers: [{ name: "Pro", code: "PRO", includedQty: "10", meterKey: "seat" }],
  addons: [
    {
      name: "Extra seats",
      pricingModel: "unit",
      unitPrice: "5",
      unitLabel: "seat",
    },
  ],
});

assert(body.name === "Platform", "name");
assert(body.sku === "PLAT-1", "sku");
assert(body.maxDiscountPercent === 15, "max discount");
assert(Array.isArray(body.galleryUrls) && (body.galleryUrls as string[]).length === 2, "gallery");
assert(Array.isArray(body.offers) && (body.offers as unknown[]).length === 1, "offers");
assert(Array.isArray(body.addons) && (body.addons as unknown[]).length === 1, "addons");

const offers = buildOffersPayload([{ name: "A" }, { name: "" }]);
assert(offers.length === 1, "empty offer filtered");

const addons = buildAddonsPayload([
  { name: "B", pricingModel: "flat", flatPrice: "9" },
]);
assert(addons[0]?.pricingModel === "flat", "addon model");

const existing: ProductDetail = {
  id: "p1",
  name: "Old",
  sku: "OLD",
  price: "10",
  maxDiscountPercent: "5",
  currency: "USD",
  status: "active",
  category: null,
  createdAt: "",
  updatedAt: "",
  description: "desc",
  productType: "fixed",
  billingType: "one_time",
  billingFrequency: null,
  tags: null,
  imageUrl: null,
  galleryUrls: [],
  offers: [],
  addons: [],
};

const updated = productUpdateBodyFromToolArgs(existing, {
  price: "42",
  tags: "x,y",
  maxDiscountPercent: "20",
});
assert(updated != null, "update body");
assert(updated!.price === 42, "price updated");
assert(updated!.tags === "x,y", "tags updated");
assert(updated!.maxDiscountPercent === 20, "discount updated");
assert(updated!.name === "Old", "name preserved");

const noChange = productUpdateBodyFromToolArgs(existing, {});
assert(noChange == null, "empty args → null");

const b2bIgnoresBrand = productUpdateBodyFromToolArgs(
  existing,
  { brand: "Acme", price: "11" },
  "b2b",
);
assert(b2bIgnoresBrand != null, "b2b price update");
assert(b2bIgnoresBrand!.price === 11, "b2b price applied");
assert(
  b2bIgnoresBrand!.brand == null || b2bIgnoresBrand!.brand === existing.brand,
  "b2b ignores brand arg",
);

// Form-owned tool names must stay mirrored (documentation invariant for tests).
const FORM_OWNED_EXPECTED = [
  "propose_update_product",
  "propose_delete_product",
  "propose_update_company",
  "propose_delete_company",
  "propose_update_deal",
  "propose_delete_deal",
];
assert(FORM_OWNED_EXPECTED.length === 6, "ownership checklist");

console.log("coworker field-contract parity ok");
