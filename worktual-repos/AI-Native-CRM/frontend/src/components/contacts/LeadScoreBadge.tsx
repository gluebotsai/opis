type Props = {
  status?: string | null;
  score?: number | null;
  /** Hide the "Lead Score" caption when the parent already labels the gauge. */
  showLabel?: boolean;
  size?: "md" | "lg";
};

function scoreColor(score: number): string {
  if (score >= 70) return "#0e8f50"; // good — green
  if (score >= 40) return "#d4a017"; // medium — yellow
  return "#c73e32"; // low — red
}

/**
 * Circular lead-score gauge (donut). Red / yellow / green by score band.
 */
export function LeadScoreBadge({
  status = null,
  score = null,
  showLabel = true,
  size = "md",
}: Props) {
  if (status === "failed" && score == null) {
    return (
      <div role="status" aria-label="Lead score unavailable">
        {showLabel ? (
          <p className="text-base font-semibold text-text-primary">Lead Score</p>
        ) : null}
        <p className="mt-2 text-xs text-text-caption">
          Unavailable — check AI service and retry from Agents or refresh later.
        </p>
      </div>
    );
  }

  const recalculating =
    status === "pending" || status === "scoring" || status === "queued";
  const shown = score == null ? null : score;
  if (shown == null && status !== "failed") return null;

  const diameter = size === "lg" ? 88 : 56;
  const stroke = size === "lg" ? 7 : 6;
  const radius = (diameter - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const pct = shown == null ? 0 : Math.max(0, Math.min(100, shown)) / 100;
  const dash = circumference * pct;
  const gap = circumference - dash;
  const color = shown == null ? "#e2e2e6" : scoreColor(shown);

  return (
    <div
      role="status"
      title={
        shown == null
          ? "Lead score updating"
          : recalculating
            ? `Lead score ${shown}/100 (updating…)`
            : `Lead score ${shown}/100`
      }
      aria-label={recalculating ? "Lead score updating" : undefined}
    >
      {showLabel ? (
        <p className="text-base font-semibold text-text-primary">Lead Score</p>
      ) : null}

      <div
        className={`relative ${showLabel ? "mt-2" : ""} ${
          size === "lg" ? "size-[88px]" : "size-[56px]"
        } ${recalculating ? "opacity-80" : ""}`}
      >
        <svg
          className="-rotate-90"
          width={diameter}
          height={diameter}
          viewBox={`0 0 ${diameter} ${diameter}`}
          aria-hidden
        >
          <circle
            cx={diameter / 2}
            cy={diameter / 2}
            r={radius}
            fill="none"
            stroke="#e2e2e6"
            strokeWidth={stroke}
          />
          <circle
            cx={diameter / 2}
            cy={diameter / 2}
            r={radius}
            fill="none"
            stroke={color}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${dash} ${gap}`}
          />
        </svg>
        <span className="absolute inset-0 flex flex-col items-center justify-center leading-none text-text-primary">
          <span className={`font-bold tabular-nums ${size === "lg" ? "text-xl" : "text-sm"}`}>
            {shown ?? ""}
          </span>
          {size === "lg" ? (
            <span className="mt-0.5 text-[10px] font-medium text-text-caption">/100</span>
          ) : null}
        </span>
      </div>
    </div>
  );
}
