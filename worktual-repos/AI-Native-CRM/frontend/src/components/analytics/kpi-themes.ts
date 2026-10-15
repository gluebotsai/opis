import {
  Activity,
  ArrowUpRight,
  CheckCircle2,
  DollarSign,
  Gauge,
  Target,
  TrendingUp,
  Users,
  type LucideIcon,
} from "lucide-react";

export type KpiTheme = {
  icon: LucideIcon;
  iconClassName: string;
  tileClassName: string;
};

export const DEFAULT_KPI_THEME: KpiTheme = {
  icon: Activity,
  iconClassName: "bg-blue-50 text-blue-600",
  tileClassName: "border-blue-100 bg-blue-50/40",
};

export const KPI_THEMES: Array<{ match: RegExp; theme: KpiTheme }> = [
  {
    match: /win\s*rate|closed\s*won/,
    theme: {
      icon: CheckCircle2,
      iconClassName: "bg-emerald-50 text-emerald-600",
      tileClassName: "border-emerald-100 bg-emerald-50/50",
    },
  },
  {
    match: /pipeline|open\s*deal/,
    theme: {
      icon: TrendingUp,
      iconClassName: "bg-violet-50 text-violet-600",
      tileClassName: "border-violet-100 bg-violet-50/50",
    },
  },
  {
    match: /revenue|won\s*revenue|amount|\$/,
    theme: {
      icon: DollarSign,
      iconClassName: "bg-amber-50 text-amber-600",
      tileClassName: "border-amber-100 bg-amber-50/50",
    },
  },
  {
    match: /lead/,
    theme: {
      icon: Users,
      iconClassName: "bg-cyan-50 text-cyan-600",
      tileClassName: "border-cyan-100 bg-cyan-50/50",
    },
  },
  {
    match: /contact/,
    theme: {
      icon: Users,
      iconClassName: "bg-sky-50 text-sky-600",
      tileClassName: "border-sky-100 bg-sky-50/50",
    },
  },
  {
    match: /deal/,
    theme: {
      icon: Target,
      iconClassName: "bg-indigo-50 text-indigo-600",
      tileClassName: "border-indigo-100 bg-indigo-50/50",
    },
  },
  {
    match: /quote|proposal|invoice/,
    theme: {
      icon: Gauge,
      iconClassName: "bg-orange-50 text-orange-600",
      tileClassName: "border-orange-100 bg-orange-50/50",
    },
  },
  {
    match: /transfer|lost/,
    theme: {
      icon: ArrowUpRight,
      iconClassName: "bg-rose-50 text-rose-600",
      tileClassName: "border-rose-100 bg-rose-50/50",
    },
  },
];

export function kpiThemeForLabel(label: string): KpiTheme {
  const normalized = label.trim().toLowerCase();
  for (const entry of KPI_THEMES) {
    if (entry.match.test(normalized)) return entry.theme;
  }
  return DEFAULT_KPI_THEME;
}

export const PLOT_COLORS = [
  "#3b82f6",
  "#06b6d4",
  "#a855f7",
  "#f59e0b",
  "#10b981",
  "#f43f5e",
] as const;
