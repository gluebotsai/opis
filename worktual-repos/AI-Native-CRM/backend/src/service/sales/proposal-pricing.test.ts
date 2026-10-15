/**
 * run: npx tsx src/service/sales/proposal-pricing.test.ts
 */
import { composePricing, overlayCatalogPricingOnSections } from "./proposal-pricing";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

const catalog = [
  { id: "p1", name: "Voicebot", sku: "vb", price: "100", currency: "USD" },
  { id: "p2", name: "Chatbot", sku: "cb", price: null, currency: "USD" },
];

const ok = composePricing({
  lines: [{ name: "Voicebot", quantity: 3, productId: "p1" }],
  catalog,
});
assert(ok.total === 300, "list price * qty");
assert(ok.tokens["{{price.line.1}}"]?.includes("300"), "token amount");
assert(!ok.sendBlocked, "priced lines can send");

const perAgent = composePricing({
  lines: [{ name: "Agents", quantity: 5, productId: "p3" }],
  catalog: [
    {
      id: "p3",
      name: "Agents",
      sku: "ag",
      price: "1000",
      currency: "USD",
      unitOfMeasure: "per_agent",
    },
  ],
});
assert(perAgent.lines[0]?.rateDisplay.includes("/agent"), "unit rate /agent");
assert(perAgent.tokens["{{price.line.1.rate}}"]?.includes("/agent"), "rate token");
assert(perAgent.lines[0]?.display.includes("5,000") || perAgent.lines[0]?.display.includes("5000"), "line total");

const missing = composePricing({
  lines: [{ name: "Chatbot", quantity: 2, productId: "p2" }],
  catalog,
});
assert(missing.sendBlocked, "missing price blocks send");
assert(missing.lines[0]?.display === "To be confirmed", "TBC cell");
assert(missing.issues.some((i) => i.code === "missing_price"), "gap listed");

const qty = composePricing({
  lines: [{ name: "Voicebot", quantity: 0, productId: "p1" }],
  catalog,
});
assert(qty.issues.some((i) => i.code === "missing_qty"), "qty gap");

const unmatched = composePricing({
  lines: [{ name: "Unknown SKU", quantity: 1 }],
  catalog,
});
assert(unmatched.issues.some((i) => i.code === "unmatched_product"), "unmatched");

const tiers = composePricing({
  lines: [{ name: "Voicebot", quantity: 50, productId: "p1", addonId: "a1" }],
  catalog,
  addons: [
    {
      id: "a1",
      productId: "p1",
      name: "Seats",
      pricingModel: "tiered",
      tiers: [{ minQty: 1, maxQty: 10, unitPrice: 5 }],
    },
  ],
});
assert(tiers.issues.some((i) => i.code === "qty_outside_tiers"), "no extrapolate");

const priced = overlayCatalogPricingOnSections(
  [
    {
      key: "commercials",
      body: "",
      tableSpec: { columns: ["Product", "Quantity", "Rate", "Amount"] },
      tableRows: [] as Array<{ cells: string[] }>,
    },
  ],
  perAgent,
);
assert(
  String(priced[0]?.tableRows?.[0]?.cells?.[2] || "").includes("/agent"),
  "commercials rate cell",
);
assert(String(priced[0]?.body || "").includes("Catalog rates:"), "rates caption");

console.log("proposal-pricing tests ok");
