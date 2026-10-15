/**
 * Resolve online vs offline payment path for an invoice.
 */
import { billingKindBlocksCustomerSend, isZeroAmountTotal } from "@/config/finance-defaults";
import type {
  EffectiveFinanceDefaults,
  OrgFinanceSettingsPublic,
  PaymentRoutingRules,
} from "@/dao/finance/org-finance-settings";

export type PaymentProvider = "stripe" | "razorpay";

export type PaymentPathResult =
  | {
      mode: "blocked";
      reason: string;
    }
  | {
      mode: "offline";
      reason?: string;
    }
  | {
      mode: "online";
      provider: PaymentProvider;
      allowedProviders: PaymentProvider[];
      reason?: string;
    };

function normalizeCurrency(currency: string | null | undefined): string {
  return (currency ?? "USD").trim().toUpperCase() || "USD";
}

function amountNumber(total: unknown): number {
  const n =
    typeof total === "number"
      ? total
      : typeof total === "string"
        ? Number(total)
        : typeof total === "object" && total != null && "toString" in total
          ? Number(String(total))
          : NaN;
  return Number.isFinite(n) ? n : 0;
}

function ruleForCurrency(
  rules: PaymentRoutingRules["rules"],
  currency: string,
) {
  if (!rules?.length) return null;
  const exact = rules.find(
    (r) => r.currency.trim().toUpperCase() === currency,
  );
  if (exact) return exact;
  return rules.find((r) => r.currency.trim() === "*") ?? null;
}

function configuredProviders(
  settings: Pick<
    OrgFinanceSettingsPublic,
    "stripeConfigured" | "razorpayConfigured"
  >,
): PaymentProvider[] {
  const out: PaymentProvider[] = [];
  if (settings.stripeConfigured) out.push("stripe");
  if (settings.razorpayConfigured) out.push("razorpay");
  return out;
}

export function resolvePaymentPath(input: {
  total: unknown;
  currency: string | null | undefined;
  billingKind?: string | null;
  defaults: EffectiveFinanceDefaults;
  gatewayConfigured: Pick<
    OrgFinanceSettingsPublic,
    "stripeConfigured" | "razorpayConfigured"
  >;
  preferredProvider?: PaymentProvider | null;
}): PaymentPathResult {
  if (billingKindBlocksCustomerSend(input.billingKind)) {
    return {
      mode: "blocked",
      reason: "This billing kind cannot be sent to the customer.",
    };
  }

  if (isZeroAmountTotal(input.total)) {
    return { mode: "offline", reason: "Zero-amount invoices use offline auto-paid." };
  }

  if (!input.defaults.onlinePaymentsEnabled) {
    return { mode: "offline", reason: "Online payments are disabled for this organization." };
  }

  const currency = normalizeCurrency(input.currency);
  const amount = amountNumber(input.total);
  const rules = input.defaults.paymentRoutingRules;
  const rule = ruleForCurrency(rules?.rules, currency);

  if (
    rule?.offlineOnlyAbove != null &&
    Number.isFinite(rule.offlineOnlyAbove) &&
    amount >= rule.offlineOnlyAbove
  ) {
    return {
      mode: "offline",
      reason: `Amount exceeds online limit for ${currency}.`,
    };
  }

  const configured = configuredProviders(input.gatewayConfigured);
  if (configured.length === 0) {
    return {
      mode: "offline",
      reason: "No payment gateway is configured — use offline bank transfer.",
    };
  }

  let allowed = configured;
  if (rule?.allowedProviders?.length) {
    allowed = configured.filter((p) => rule.allowedProviders!.includes(p));
  }
  if (allowed.length === 0) {
    return {
      mode: "offline",
      reason: "No allowed gateway is configured for this currency.",
    };
  }

  const defaultProvider =
    input.preferredProvider &&
    allowed.includes(input.preferredProvider)
      ? input.preferredProvider
      : rules?.defaultProvider && allowed.includes(rules.defaultProvider)
        ? rules.defaultProvider
        : allowed[0]!;

  return {
    mode: "online",
    provider: defaultProvider,
    allowedProviders: allowed,
  };
}

export function providerConfigured(
  provider: PaymentProvider,
  settings: Pick<
    OrgFinanceSettingsPublic,
    "stripeConfigured" | "razorpayConfigured"
  >,
): boolean {
  return provider === "stripe"
    ? settings.stripeConfigured
    : settings.razorpayConfigured;
}

export function providerLabel(provider: PaymentProvider): string {
  return provider === "stripe" ? "Stripe" : "Razorpay";
}
