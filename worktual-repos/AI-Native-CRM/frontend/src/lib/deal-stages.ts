export const DEAL_STAGES = [
  "qualification",
  "discover",
  "propose",
  "negotiate",
  "closed_won",
  "closed_lost",
] as const;

export type DealStageValue = (typeof DEAL_STAGES)[number];

const DEAL_STAGE_ALIASES: Record<string, DealStageValue> = {
  qualify: "qualification",
  qualified: "qualification",
  qualification: "qualification",
  discover: "discover",
  discovery: "discover",
  propose: "propose",
  proposal: "propose",
  negotiate: "negotiate",
  negotiation: "negotiate",
  won: "closed_won",
  closed_won: "closed_won",
  lost: "closed_lost",
  closed_lost: "closed_lost",
};

/** Map a chat/tool label onto a stored pipeline stage. "proposal" → Propose. */
export function normalizeDealStage(
  raw: string | null | undefined,
): DealStageValue | null {
  if (!raw?.trim()) return null;
  const key = raw.trim().toLowerCase().replace(/[\s-]+/g, "_");
  const resolved = DEAL_STAGE_ALIASES[key];
  if (resolved) return resolved;
  return (DEAL_STAGES as readonly string[]).includes(key)
    ? (key as DealStageValue)
    : null;
}

export const DEAL_STAGE_LABELS: Record<string, string> = {
  qualification: "Qualify",
  discover: "Discover",
  propose: "Propose",
  negotiate: "Negotiate",
  closed_won: "Closed won",
  closed_lost: "Closed lost",
};

export const DEAL_STAGE_OPTIONS = DEAL_STAGES.map((value) => ({
  value,
  label: DEAL_STAGE_LABELS[value],
}));

export const DEAL_STAGE_SHORT_LABELS: Record<string, string> = {
  qualification: "Qualify",
  discover: "Discover",
  propose: "Propose",
  negotiate: "Negotiate",
  closed_won: "Won",
  closed_lost: "Lost",
};

export function stageHeaderClass(stage: string): {
  header: string;
  title: string;
  meta: string;
  badge: string;
} {
  // Light grey → 75% grey (#404040) across pipeline stages.
  switch (stage) {
    case "qualification":
      return {
        header: "bg-[#ececef]",
        title: "text-text-primary",
        meta: "text-text-secondary",
        badge: "bg-black/10 text-text-secondary",
      };
    case "discover":
      return {
        header: "bg-[#cfcfd4]",
        title: "text-text-primary",
        meta: "text-text-secondary",
        badge: "bg-black/10 text-text-secondary",
      };
    case "propose":
      return {
        header: "bg-[#a8a8b0]",
        title: "text-text-primary",
        meta: "text-neutral-700",
        badge: "bg-black/10 text-text-primary",
      };
    case "negotiate":
      return {
        header: "bg-[#73737c]",
        title: "text-white",
        meta: "text-neutral-200",
        badge: "bg-white/20 text-white",
      };
    case "closed_won":
      return {
        header: "bg-[#404040]",
        title: "text-white",
        meta: "text-neutral-300",
        badge: "bg-white/20 text-white",
      };
    case "closed_lost":
      return {
        header: "bg-[#5a5a5a]",
        title: "text-white",
        meta: "text-neutral-300",
        badge: "bg-white/20 text-white",
      };
    default:
      return {
        header: "bg-[#ececef]",
        title: "text-text-primary",
        meta: "text-text-secondary",
        badge: "bg-black/10 text-text-secondary",
      };
  }
}

export function stageAccentClass(stage: string): string {
  switch (stage) {
    case "closed_won":
      return "bg-[#0e8f50]";
    case "closed_lost":
      return "bg-[#c73e32]";
    case "negotiate":
      return "bg-[#1869d3]";
    case "propose":
    case "discover":
      return "bg-brand";
    case "qualification":
      return "bg-violet-700";
    default:
      return "bg-neutral-400";
  }
}

/** Medium fills for pipeline funnel bars — distinct per stage, not pastel-flat. */
export function stageFunnelBarClass(stage: string): string {
  switch (stage) {
    case "closed_won":
      return "bg-emerald-400";
    case "closed_lost":
      return "bg-rose-400";
    case "negotiate":
      return "bg-sky-400";
    case "propose":
      return "bg-purple-500";
    case "discover":
      return "bg-indigo-400";
    case "qualification":
      return "bg-violet-400";
    default:
      return "bg-neutral-300";
  }
}

/** Slightly deeper dot for stage labels (pairs with funnel bar). */
export function stageFunnelDotClass(stage: string): string {
  switch (stage) {
    case "closed_won":
      return "bg-emerald-600";
    case "closed_lost":
      return "bg-rose-600";
    case "negotiate":
      return "bg-sky-600";
    case "propose":
      return "bg-purple-700";
    case "discover":
      return "bg-indigo-600";
    case "qualification":
      return "bg-violet-600";
    default:
      return "bg-neutral-500";
  }
}

export function stageBadgeClass(stage: string): string {
  switch (stage) {
    case "closed_won":
      return "bg-[#e8f8ef] text-text-success";
    case "closed_lost":
      return "bg-[#fdecea] text-text-danger";
    case "negotiate":
      return "bg-[#e8f1fc] text-text-info";
    case "propose":
    case "discover":
      return "bg-violet-0 text-brand";
    default:
      return "bg-neutral-100 text-text-secondary";
  }
}

export function isTerminalStage(stage: string): boolean {
  return stage === "closed_won" || stage === "closed_lost";
}

/** Next stage in the pipeline for the one-click "advance" action; null once terminal. */
export function nextDealStage(stage: string): string | null {
  if (stage === "negotiate") return "closed_won";
  if (stage === "closed_won" || stage === "closed_lost") return null;
  const idx = DEAL_STAGES.indexOf(stage as (typeof DEAL_STAGES)[number]);
  if (idx < 0 || idx >= DEAL_STAGES.length - 1) return null;
  return DEAL_STAGES[idx + 1];
}

/** Pipeline Forecast Auditor category — display only, never editable here. */
export const FORECAST_CATEGORY_LABELS: Record<string, string> = {
  commit: "Commit",
  best_case: "Best case",
  pipeline: "Pipeline",
  omitted: "Omitted",
};

export function forecastCategoryBadgeClass(category: string): string {
  switch (category) {
    case "commit":
      return "bg-[#e8f8ef] text-text-success";
    case "best_case":
      return "bg-[#e8f1fc] text-text-info";
    case "omitted":
      return "bg-neutral-100 text-text-secondary";
    default:
      return "bg-subtle text-text-caption";
  }
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

export function formatMoney(
  amount: string | null,
  currency?: string | null,
): string {
  if (!amount) return "—";
  const n = Number(amount);
  if (!Number.isFinite(n)) return "—";
  const code = currency?.trim().toUpperCase() || "";
  const mark = code ? currencyMark(code) : "";
  if (n >= 1_000_000) return `${mark}${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${mark}${Math.round(n / 1_000)}k`;
  return code ? `${mark}${n.toLocaleString()}` : n.toLocaleString();
}

export function formatMoneyFull(
  amount: string | null,
  currency?: string | null,
): string {
  if (!amount) return "—";
  const n = Number(amount);
  if (!Number.isFinite(n)) return "—";
  const code = currency?.trim().toUpperCase() || "";
  if (!code) return n.toLocaleString();
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: code,
    }).format(n);
  } catch {
    return `${code} ${n.toLocaleString()}`;
  }
}
