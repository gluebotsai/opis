const GST_RATE = 0.18;

const PRESENTMENT_MINIMUM_MINOR_UNITS = {
  inr: 50,
  aed: 200,
  usd: 50,
  eur: 50,
  gbp: 30,
  sgd: 50,
};

const SETTLEMENT_MINIMUM_MINOR_UNITS = {
  aed: 200,
};

const ROUGH_PRESENTMENT_TO_SETTLEMENT = {
  "inr:aed": 0.044,
  "usd:aed": 3.67,
  "gbp:aed": 4.65,
  "eur:aed": 3.98,
};

function env(name) {
  let value = process.env[name]?.trim() || "";
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }
  return value;
}

export function toStripeMinorUnits(amount, currency) {
  const code = String(currency || "inr").toLowerCase();
  const zeroDecimal = ["jpy", "krw", "vnd"].includes(code);
  const numeric = Number(amount);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return 0;
  }
  return zeroDecimal ? Math.round(numeric) : Math.round(numeric * 100);
}

function formatMoney(amount, currency) {
  const code = String(currency || "INR").toUpperCase();
  return `${code} ${Number(amount).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatMinorUnits(minorUnits, currency) {
  const code = String(currency || "inr").toLowerCase();
  const zeroDecimal = ["jpy", "krw", "vnd"].includes(code);
  const major = zeroDecimal ? minorUnits : minorUnits / 100;
  return formatMoney(major, code);
}

export function assertStripeChargeAmount(amount, currency) {
  const code = String(currency || "inr").toLowerCase();
  const minorUnits = toStripeMinorUnits(amount, currency);

  if (!minorUnits) {
    throw new Error("Quotation amount must be greater than zero to create a payment link.");
  }

  const presentmentMinimum = PRESENTMENT_MINIMUM_MINOR_UNITS[code];
  if (presentmentMinimum && minorUnits < presentmentMinimum) {
    throw new Error(
      `Invoice total ${formatMoney(amount, code)} is below Stripe's minimum charge for ${code.toUpperCase()} (${formatMinorUnits(presentmentMinimum, code)}). Update the quotation amount before approving.`,
    );
  }

  const settlementCurrency = (env("STRIPE_SETTLEMENT_CURRENCY") || env("STRIPE_ACCOUNT_CURRENCY") || "")
    .trim()
    .toLowerCase();

  if (!settlementCurrency || settlementCurrency === code) {
    return { minorUnits, currency: code, settlementCurrency: settlementCurrency || code };
  }

  const settlementMinimum = SETTLEMENT_MINIMUM_MINOR_UNITS[settlementCurrency];
  const conversionRate = ROUGH_PRESENTMENT_TO_SETTLEMENT[`${code}:${settlementCurrency}`];
  if (!settlementMinimum || !conversionRate) {
    return { minorUnits, currency: code, settlementCurrency };
  }

  const estimatedSettlementMinor = Math.round(minorUnits * conversionRate);
  if (estimatedSettlementMinor < settlementMinimum) {
    const settlementLabel = settlementCurrency.toUpperCase();
    const minimumSettlement = formatMinorUnits(settlementMinimum, settlementCurrency);
    throw new Error(
      `Invoice total ${formatMoney(amount, code)} is too low for your Stripe settlement currency (${settlementLabel}). Stripe requires at least ${minimumSettlement} after conversion. Use ${settlementLabel} on the quotation or increase the invoice total.`,
    );
  }

  return { minorUnits, currency: code, settlementCurrency };
}

export { GST_RATE };
