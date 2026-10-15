/**
 * run: npx tsx src/service/sales/proposal-visuals.test.ts
 */
import {
  buildProductScopeLabel,
  categoryNeedlesForText,
  pickDiscussedCatalogRows,
  proposalProductFamilies,
  proposalProductScope,
} from "./proposal-visuals";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

assert(
  buildProductScopeLabel([
    { name: "Proactive Contact Centre" },
    {
      name: "Intelligent CRM with Website Visitor Tracking & Campaign Management",
    },
  ]) ===
    "Proactive Contact Centre • Intelligent CRM with Website Visitor Tracking & Campaign Management",
  "joins discussed product names for cover scope",
);

const catalog = [
  { id: "1", name: "Proactive Contact Centre", category: "ccaas" },
  {
    id: "2",
    name: "Intelligent CRM with Website Visitor Tracking & Campaign Management",
    category: "crm",
  },
  { id: "3", name: "Strategic Customer Value Management", category: "cvm" },
  { id: "4", name: "Cognitive Customer Data Platform", category: "cdp" },
  { id: "5", name: "AI native Ticketing System", category: "ticketing" },
  { id: "6", name: "Unrelated Inventory SKU", category: "other" },
];
const haystack = catalog
  .slice(0, 5)
  .map((p) => p.name)
  .join("\n");
const picked = pickDiscussedCatalogRows(catalog, haystack);
assert(
  JSON.stringify(picked.map((p) => p.id).sort()) ===
    JSON.stringify(["1", "2", "3", "4", "5"]),
  "picks every catalog product named in the BRD, not one per family",
);

const lolaHay =
  "Positron needs Lola Voicebot and an AI Chatbot for patient enquiries.";
const lolaPicked = pickDiscussedCatalogRows(catalog, lolaHay);
assert(
  lolaPicked.some((p) => p.id === "1"),
  "Lola/Voicebot/Chatbot maps to the CCaaS catalog row even when names differ",
);
assert(
  !lolaPicked.some((p) => p.id === "6"),
  "does not dump unrelated inventory SKUs for a CCaaS BRD",
);
assert(
  !lolaPicked.some((p) => p.id === "2"),
  "does not pull CRM when the BRD only names Lola/chatbot",
);

const twoCcaas = [
  ...catalog,
  { id: "1b", name: "Digital Engagement Desk", category: "ccaas" },
];
const familyFill = pickDiscussedCatalogRows(twoCcaas, lolaHay);
assert(
  familyFill.length === 1 && ["1", "1b"].includes(familyFill[0].id),
  "family fallback still picks one representative row per discussed family, not every row in it",
);

const quoted = pickDiscussedCatalogRows(catalog, "deal notes about a hospital rollout", {
  productIds: ["5"],
});
assert(
  quoted.map((p) => p.id).join() === "5",
  "includes explicit / quote-line product ids even when the haystack does not name them",
);

const families = proposalProductFamilies(
  "Customer wants CCaaS for their contact centre and an intelligent CRM for pipeline tracking.",
);
assert(families.includes("ccaas"), "detects ccaas");
assert(families.includes("crm"), "detects crm");
assert(!families.includes("cdp"), "does not assume cdp");
assert(!families.includes("ticketing"), "does not assume ticketing");

const lolaFamilies = proposalProductFamilies(lolaHay);
assert(lolaFamilies.includes("ccaas"), "Voicebot/Chatbot/Lola without spaces still detect CCaaS");

assert(
  proposalProductScope(null, "Opportunity — Gugan S") === "Solution overview",
  "falls back to a generic label for raw Opportunity-style deal titles",
);
assert(
  proposalProductScope(null, "Positron — Gugan S") === "Positron — Gugan S",
  "falls back to the deal title itself when it is not a generic Opportunity/Deal label",
);
assert(
  proposalProductScope("Proactive Contact Centre", "positron — gugan s") ===
    "Proactive Contact Centre",
  "cover scope is the matched inventory product",
);

// --- Bug B: word-boundary matching, not raw substring ---------------------

const wordBoundaryCatalog = [
  { id: "car", name: "Car Fleet Manager", category: "Fleet" },
  { id: "arc", name: "Arc Contact Suite", category: "ccaas" },
];
const jacquardHay =
  "JACQUARD Textiles needs an Arc Contact Suite rollout for its support desk.";
const jacquardPicked = pickDiscussedCatalogRows(wordBoundaryCatalog, jacquardHay);
assert(
  !jacquardPicked.some((p) => p.id === "car"),
  "does not false-positive-match a short token (car) inside an unrelated word (JACQUARD)",
);
assert(
  jacquardPicked.some((p) => p.id === "arc"),
  "still matches a genuinely word-bounded product name (Arc Contact Suite)",
);

// --- Bug A: category-needle recall used to widen the DB candidate pool ----

assert(
  JSON.stringify(categoryNeedlesForText("we need Lola Voicebot for support")) ===
    JSON.stringify(["ccaas", "contact", "chat", "voice", "lola", "omnichannel", "engagement"]),
  "detects CCaaS category needles from BRD text naming the family",
);
assert(
  categoryNeedlesForText("just a generic project kickoff note").length === 0,
  "no category needles when no product family is discussed",
);

assert(
  buildProductScopeLabel([
    { name: "JACQUARD DENIM JACKET — Charcoal / Waist 28 · Leg 30" },
    { name: "JACQUARD DENIM JACKET — Charcoal / Waist 36 · Leg 34" },
    { name: "KNIT BEANIE — Silver / 13-14 Years" },
  ]) === "JACQUARD DENIM JACKET • KNIT BEANIE",
  "collapses size/colour SKU tails so the cover does not list every variant",
);

const positronHay =
  "Positron Hospital needs AI Native Contact Centre (CCaaS), AI Native Campaign Management, " +
  "and AI Native CRM for patient engagement, phone calls, websites, and marketing platforms.";
const noisyCatalog = [
  {
    id: "ccaas",
    name: "AI Native Contact Centre (CCaaS)",
    category: "ccaas",
    description: "Omnichannel contact centre.",
  },
  {
    id: "camp",
    name: "AI Native Campaign Management",
    category: "campaign",
    description: "Multi-channel campaigns.",
  },
  {
    id: "crm",
    name: "AI Native CRM",
    category: "crm",
    description: "Pipeline CRM.",
  },
  {
    id: "j1",
    name: "JACQUARD DENIM JACKET — Charcoal / Waist 28 · Leg 30",
    category: "Apparel",
    description:
      "Premium denim with customer engagement styling and marketing-ready branding. Contact us for sizing.",
  },
  {
    id: "j2",
    name: "JACQUARD DENIM JACKET — Charcoal / Waist 36 · Leg 34",
    category: "Apparel",
    description: "Launch campaign fit. Great for omnichannel retail engagement.",
  },
  {
    id: "b1",
    name: "KNIT BEANIE — Silver / 13-14 Years",
    category: "Apparel",
    description: "Kids beanie for customer engagement and marketing platforms.",
  },
];
const positronPicked = pickDiscussedCatalogRows(noisyCatalog, positronHay);
assert(
  positronPicked.every((p) => ["ccaas", "camp", "crm"].includes(p.id)),
  `cover must not dump apparel SKUs for a CCaaS/CRM BRD, got ${positronPicked.map((p) => p.id).join(",")}`,
);
assert(
  ["ccaas", "camp", "crm"].every((id) => positronPicked.some((p) => p.id === id)),
  "still picks the three Worktual products named in the Positron BRD",
);
assert(
  !/jacket|beanie/i.test(buildProductScopeLabel(positronPicked)),
  "cover headline stays on the discussed Worktual products",
);

console.log("proposal-visuals.test.ts ok");
