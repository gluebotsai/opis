/** Indian grouping for INR (`12,00,000`). Other currencies keep their usual grouping. */
export function formatLakhMoney(amount: number, currency: string): string {
  const code = currency.trim().toUpperCase() || "USD";
  const rounded = Math.round(amount);
  const abs = Math.abs(rounded);
  const grouped =
    code === "INR"
      ? new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(abs)
      : new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(abs);
  const sign = rounded < 0 ? "-" : "";
  return `${sign}${currencyMark(code)}${grouped}`;
}

function currencyMark(currency: string): string {
  try {
    const part = new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      currencyDisplay: "narrowSymbol",
    })
      .formatToParts(0)
      .find((piece) => piece.type === "currency");
    return part?.value ?? `${currency} `;
  } catch {
    return `${currency} `;
  }
}

export function formatQuarterChange(
  changePct: number | null,
  previous?: number,
  current?: number,
): string {
  if (changePct == null) return "No prior quarter";
  if (
    previous != null &&
    current != null &&
    current > 0 &&
    previous > 0 &&
    previous < current * 0.1
  ) {
    return "";
  }
  const sign = changePct > 0 ? "+" : "";
  return `${sign}${changePct}% vs last quarter`;
}
