/** Email A/B helpers — one template card, two variants, percent split + winner. */

export type AbLetter = "a" | "b";
export type AbVariant = AbLetter | "holdout" | "winner";

export type EmailAbPlan = {
  enabled: boolean;
  pctA: number;
  pctB: number;
  pctHoldout: number;
  winner: AbLetter | null;
  auto: boolean;
  decideAfterMinutes: number;
};

const EMAIL_KEYS = [
  "subject",
  "preheader",
  "pattern_id",
  "theme_id",
  "theme",
  "sections",
  "greeting",
  "paragraphs",
  "cta_label",
  "cta_url",
  "signoff",
  "footer",
  "header_image",
  "image_url",
  "image",
] as const;

export function readEmailAbPlan(launchPlan: unknown): EmailAbPlan {
  const p =
    launchPlan && typeof launchPlan === "object"
      ? (launchPlan as Record<string, unknown>)
      : {};
  const enabled = Boolean(p.ab_enabled);
  const pctA = clampPct(p.ab_pct_a ?? p.ab_percent_a, 20);
  const pctB = clampPct(p.ab_pct_b ?? p.ab_percent_b, 20);
  let pctH = clampPct(p.ab_pct_holdout ?? p.ab_percent_holdout, 60);
  if (pctA + pctB + pctH !== 100) {
    const rest = Math.max(0, 100 - pctA - pctB);
    pctH = rest;
  }
  const winnerRaw = String(p.ab_winner || "").toLowerCase();
  const winner: AbLetter | null =
    winnerRaw === "a" || winnerRaw === "b" ? winnerRaw : null;
  const decide = Number(p.ab_decide_after_minutes);
  return {
    enabled,
    pctA,
    pctB,
    pctHoldout: pctH,
    winner,
    auto: p.ab_auto !== false,
    decideAfterMinutes:
      Number.isFinite(decide) && decide >= 0 ? decide : 15,
  };
}

function clampPct(raw: unknown, fallback: number): number {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(100, Math.round(n)));
}

export function splitAbCounts(
  total: number,
  plan: EmailAbPlan,
): { a: number; b: number; holdout: number } {
  if (!plan.enabled || total <= 0) {
    return { a: total, b: 0, holdout: 0 };
  }
  if (total === 1) return { a: 1, b: 0, holdout: 0 };
  let a = Math.round((total * plan.pctA) / 100);
  let b = Math.round((total * plan.pctB) / 100);
  if (plan.pctA > 0) a = Math.max(1, a);
  if (plan.pctB > 0) b = Math.max(1, b);
  if (a + b > total) {
    if (a >= b && a > 1) a -= 1;
    else if (b > 1) b -= 1;
    else b = Math.max(0, total - a);
  }
  const holdout = Math.max(0, total - a - b);
  return { a, b, holdout };
}

export function hasEmailAbFields(fields: Record<string, unknown> | null | undefined): boolean {
  if (!fields) return false;
  if (fields.ab_test === true) return true;
  return isEmailVariantBlob(fields.variant_a) || isEmailVariantBlob(fields.variant_b);
}

function isEmailVariantBlob(raw: unknown): boolean {
  return Boolean(raw && typeof raw === "object" && !Array.isArray(raw));
}

export function topLevelEmailFields(
  fields: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of EMAIL_KEYS) {
    if (key in fields) out[key] = fields[key];
  }
  return out;
}

export function emailFieldsForVariant(
  fields: Record<string, unknown> | null | undefined,
  variant: AbLetter,
): Record<string, unknown> {
  const f = fields && typeof fields === "object" ? fields : {};
  const nested = f[variant === "a" ? "variant_a" : "variant_b"];
  if (nested && typeof nested === "object" && !Array.isArray(nested)) {
    return nested as Record<string, unknown>;
  }
  return topLevelEmailFields(f);
}

export type AbVariantStats = {
  variant: AbLetter;
  sent: number;
  failed: number;
  held: number;
  opens: number;
  clicks: number;
  openRate: number | null;
  clickRate: number | null;
};

export function pickAbWinner(
  a: AbVariantStats,
  b: AbVariantStats,
): AbLetter {
  const aOpen = a.openRate ?? -1;
  const bOpen = b.openRate ?? -1;
  if (aOpen !== bOpen) return aOpen > bOpen ? "a" : "b";
  const aClick = a.clickRate ?? -1;
  const bClick = b.clickRate ?? -1;
  if (aClick !== bClick) return aClick > bClick ? "a" : "b";
  if (a.opens !== b.opens) return a.opens > b.opens ? "a" : "b";
  if (a.clicks !== b.clicks) return a.clicks > b.clicks ? "a" : "b";
  return "a";
}

export function rate(n: number, d: number): number | null {
  if (d <= 0) return null;
  return n / d;
}
