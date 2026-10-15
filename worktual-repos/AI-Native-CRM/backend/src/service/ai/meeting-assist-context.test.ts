/**
 * Smoke tests for Assist context pack formatting (no DB).
 * Run: npx tsx src/service/ai/meeting-assist-context.test.ts
 */
import {
  formatAssistContextPackText,
  type AssistContextPack,
} from "./meeting-assist-context";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

function run() {
  const empty: Omit<AssistContextPack, "packText"> = {
    contactId: "c1",
    organizationId: "1000",
  };
  assert(formatAssistContextPackText(empty) === "", "empty pack omits fields");

  const full: Omit<AssistContextPack, "packText"> = {
    contactId: "c1",
    organizationId: "1000",
    contact: {
      name: "Ada Lovelace",
      title: "CTO",
      lifecycle: "opportunity",
      leadStatus: "qualified",
      bant: {
        budget: true,
        authority: true,
        need: false,
        timeline: true,
      },
      notes: "Interested in analytics",
    },
    company: {
      name: "Analytical Engines",
      industry: "Software",
      domain: "analytical.example",
    },
    score: {
      total: 72,
      band: "hot",
      nextBestAction: "Send proposal",
    },
    primaryDeal: {
      title: "Enterprise seat expansion",
      stage: "Proposal",
      amount: "42000",
    },
    recentActivity: [
      { type: "email", subject: "Pricing follow-up" },
      { type: "call", subject: "Discovery" },
    ],
    leadSummary: "Warm lead evaluating CRM for mid-market sales team.",
    products: [
      { name: "CRM Pro", price: "99", currency: "USD" },
      { name: "Assist Add-on", price: null, currency: "USD" },
    ],
  };

  const text = formatAssistContextPackText(full);
  assert(text.includes("Ada Lovelace"), "includes contact name");
  assert(text.includes("BANT: Budget, Authority, Timeline"), "includes BANT");
  assert(text.includes("Analytical Engines"), "includes company");
  assert(text.includes("score 72"), "includes score");
  assert(text.includes("Enterprise seat expansion"), "includes deal");
  assert(text.includes("email: Pricing follow-up"), "includes activity");
  assert(text.includes("Lead summary:"), "includes summary");
  assert(!text.includes("Product catalog:"), "products stay out of CRM pack text");
  assert(text.length <= 2000, "stays within pack budget");

  const withProductsOnly = formatAssistContextPackText({
    ...full,
    products: full.products,
  });
  assert(
    withProductsOnly === text,
    "products field does not change CRM pack text",
  );

  const longSummary = "y".repeat(2500);
  const clipped = formatAssistContextPackText({
    contactId: "c1",
    organizationId: "1000",
    contact: { name: "Bob", notes: "short" },
    leadSummary: longSummary,
  });
  assert(clipped.includes("Bob"), "still has name");
  assert(clipped.length <= 2000, "long summary truncated by pack budget");
  assert(clipped.endsWith("…"), "marks truncation");

  console.log("meeting-assist-context.test.ts: ok");
}

run();
