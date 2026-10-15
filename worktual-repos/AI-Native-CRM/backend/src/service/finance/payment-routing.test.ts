/**
 * run: npx tsx --tsconfig tsconfig.json src/service/finance/payment-routing.test.ts
 */
import { resolvePaymentPath } from "@/service/finance/payment-routing";
import { systemFinanceDefaults } from "@/dao/finance/org-finance-settings";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

const defaults = systemFinanceDefaults();
const gateways = { stripeConfigured: true, razorpayConfigured: true };

assert(
  resolvePaymentPath({
    total: 100,
    currency: "USD",
    defaults,
    gatewayConfigured: gateways,
  }).mode === "online",
  "USD 100 is online",
);

assert(
  resolvePaymentPath({
    total: 3_000_000,
    currency: "INR",
    defaults: {
      ...defaults,
      paymentRoutingRules: {
        defaultProvider: "stripe",
        rules: [{ currency: "INR", offlineOnlyAbove: 2_500_000 }],
      },
    },
    gatewayConfigured: gateways,
  }).mode === "offline",
  "INR above threshold is offline",
);

assert(
  resolvePaymentPath({
    total: 100,
    currency: "USD",
    defaults: { ...defaults, onlinePaymentsEnabled: false },
    gatewayConfigured: gateways,
  }).mode === "offline",
  "disabled online falls back offline",
);

assert(
  resolvePaymentPath({
    total: 100,
    currency: "USD",
    billingKind: "adjustment",
    defaults,
    gatewayConfigured: gateways,
  }).mode === "blocked",
  "adjustment blocked",
);

const both = resolvePaymentPath({
  total: 500,
  currency: "EUR",
  defaults,
  gatewayConfigured: gateways,
  preferredProvider: "razorpay",
});
assert(
  both.mode === "online" && both.mode === "online" && both.provider === "razorpay",
  "preferred provider respected",
);

console.log("payment-routing ok");
