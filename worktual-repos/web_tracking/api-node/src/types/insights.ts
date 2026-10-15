export interface RollupPoint {
  label: string;
  date_key: string;
  visitors: number;
  sessions: number;
  pageviews: number;
  bounce_rate: number;
}

export interface ComparisonMetric {
  metric: string;
  current: number;
  prior: number;
  change_pct: number;
}

export interface TopMover {
  type: "page" | "source";
  name: string;
  current: number;
  prior: number;
  change_pct: number;
}

export interface ForecastSeries {
  grain: "daily" | "weekly" | "monthly";
  labels: string[];
  actual: (number | null)[];
  forecast: (number | null)[];
  horizon_label: string;
}

export interface InsightsSnapshot {
  period: string;
  website_id: number;
  generated_at: string;
  comparison: ComparisonMetric[];
  primary_anomaly: {
    metric: string;
    change_pct: number;
    driver_hint: string;
  } | null;
  daily_rollups: RollupPoint[];
  weekly_rollups: RollupPoint[];
  monthly_rollups: RollupPoint[];
  top_movers: TopMover[];
  forecasts: {
    volume: ForecastSeries;
    bounce: ForecastSeries;
  };
}

export interface DiagnosticInsight {
  metric: string;
  severity: "normal" | "warning" | "critical";
  headline: string;
  stat: string;
  observation: string;
  contributing_factors: { label: string; pct: number }[];
  supporting_evidence: { title: string; detail: string }[];
}

export interface RiskSignal {
  level: "warning" | "muted";
  title: string;
  detail: string;
}

export interface Recommendation {
  priority: "High" | "Medium" | "Low";
  title: string;
  impact: string;
  reason: string;
  action_label: string;
  action_href: string;
}

export interface InsightsNarrative {
  diagnostic: DiagnosticInsight;
  predictive: {
    volume_narrative: string;
    bounce_narrative: string;
    risk_signals: RiskSignal[];
  };
  prescriptive: {
    hint: string;
    recommendations: Recommendation[];
  };
}

export interface InsightsResponse extends InsightsNarrative {
  period: string;
  generated_at: string;
  website_id: number;
  forecasts: InsightsSnapshot["forecasts"];
}
