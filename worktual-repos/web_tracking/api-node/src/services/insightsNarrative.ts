import type { InsightsNarrative, InsightsSnapshot, InsightsResponse } from "../types/insights.js";

function priorityClass(priority: string): string {
  if (priority === "High") return "priority-high";
  if (priority === "Medium") return "priority-medium";
  return "priority-low";
}

export function fallbackNarrative(snapshot: InsightsSnapshot): InsightsNarrative {
  const anomaly = snapshot.primary_anomaly;
  const topComparison = snapshot.comparison.sort(
    (a, b) => Math.abs(b.change_pct) - Math.abs(a.change_pct),
  )[0];
  const metric = anomaly?.metric ?? topComparison?.metric ?? "visitors";
  const change = anomaly?.change_pct ?? topComparison?.change_pct ?? 0;
  const severity =
    Math.abs(change) >= 20 ? "critical" : Math.abs(change) >= 10 ? "warning" : "normal";

  const topMovers = snapshot.top_movers.slice(0, 4);
  const factorTotal = topMovers.reduce((s, m) => s + Math.abs(m.change_pct), 0) || 1;
  const contributing_factors = topMovers.map((m) => ({
    label: m.type === "page" ? `Page: ${m.name}` : `Source: ${m.name}`,
    pct: Math.round((Math.abs(m.change_pct) / factorTotal) * 100),
  }));

  if (!contributing_factors.length) {
    contributing_factors.push(
      { label: "Normal traffic variation", pct: 50 },
      { label: "Seasonal pattern", pct: 30 },
      { label: "Other factors", pct: 20 },
    );
  }

  const volumeTrend = snapshot.forecasts.volume.horizon_label;
  const bounceTrend = snapshot.forecasts.bounce.horizon_label;

  return {
    diagnostic: {
      metric,
      severity,
      headline: anomaly
        ? `${metric.replace("_", " ")} ${change >= 0 ? "increased" : "decreased"} ${Math.abs(change)}% vs prior period`
        : "Traffic patterns are stable for the selected period",
      stat: `${change >= 0 ? "+" : ""}${change} pts vs prior window`,
      observation: anomaly
        ? `The change was most visible in recent daily aggregates. ${anomaly.driver_hint}.`
        : "No significant anomalies detected compared to the prior window.",
      contributing_factors,
      supporting_evidence: snapshot.comparison.slice(0, 3).map((c) => ({
        title: c.metric.replace("_", " "),
        detail: `${c.current} now vs ${c.prior} prior (${c.change_pct >= 0 ? "+" : ""}${c.change_pct}%)`,
      })),
    },
    predictive: {
      volume_narrative:
        volumeTrend === "Not enough history"
          ? "Not enough historical data to project visitor volume yet."
          : `Visitor volume trend suggests ${volumeTrend.toLowerCase()} based on recent daily/weekly aggregates.`,
      bounce_narrative:
        bounceTrend === "Not enough history"
          ? "Bounce rate forecast requires at least 7 days of history."
          : `Bounce rate may ${change >= 0 ? "stay elevated" : "ease"} over ${bounceTrend.toLowerCase()}.`,
      risk_signals: [
        {
          level: Math.abs(change) >= 15 ? "warning" : "muted",
          title: anomaly ? `${metric} deviation detected` : "Stable traffic outlook",
          detail: anomaly
            ? `${metric} moved ${Math.abs(change)}% vs the prior window — monitor top pages and sources.`
            : "No major risk signals from recent aggregated trends.",
        },
      ],
    },
    prescriptive: {
      hint:
        "Recommendations are generated from diagnostic drivers and forecast risk. Ask the co-worker on the Dashboard to explore alternatives.",
      recommendations: [
        {
          priority: "High",
          title: topMovers[0]
            ? `Review ${topMovers[0].type === "page" ? "page" : "traffic from"} "${topMovers[0].name}"`
            : "Review top traffic sources and landing pages",
          impact: `Estimated impact on ${metric} trend`,
          reason: anomaly?.driver_hint ?? "Largest mover in the current comparison window.",
          action_label: topMovers[0]?.type === "page" ? "Review behavior" : "Review traffic sources",
          action_href: topMovers[0]?.type === "page" ? "/behavior" : "/",
        },
        {
          priority: "Medium",
          title: "Compare bounce rate on high-traffic pages",
          impact: "Estimated -5 to -10 pts bounce if landing pages improved",
          reason: "Bounce rate is a leading indicator in the current snapshot.",
          action_label: "Open Dashboard",
          action_href: "/",
        },
        {
          priority: "Low",
          title: "Expand tracking on key conversion paths",
          impact: "Better diagnostic coverage for future insights",
          reason: "More aggregated funnel data improves prescriptive recommendations.",
          action_label: "Review behavior setup",
          action_href: "/behavior",
        },
      ],
    },
  };
}

export function mergeInsightsResponse(
  snapshot: InsightsSnapshot,
  narrative: InsightsNarrative,
): InsightsResponse {
  return {
    period: snapshot.period,
    generated_at: snapshot.generated_at,
    website_id: snapshot.website_id,
    forecasts: snapshot.forecasts,
    diagnostic: narrative.diagnostic,
    predictive: narrative.predictive,
    prescriptive: narrative.prescriptive,
  };
}

export function enrichRecommendations(narrative: InsightsNarrative): InsightsNarrative {
  return narrative;
}

export { priorityClass };
