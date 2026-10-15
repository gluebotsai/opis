export type DashboardTheme = "default" | "cognitive";

/** Cognitive CDP-inspired palette — dashboard page only. */
export const COGNITIVE_DASHBOARD = {
  pageBg: "#f8f9fb",
  cardBg: "#ffffff",
  cardBorder: "rgba(226, 232, 240, 0.9)",
  cardShadow: "0 8px 32px rgba(15, 23, 42, 0.06)",
  accent: "#7c3aed",
  accentSoft: "#8b5cf6",
  accentBlue: "#6366f1",
  line: "#8b5cf6",
  muted: "#64748b",
  title: "#0f172a",
  barColors: ["#8b5cf6", "#6366f1", "#06b6d4", "#14b8a6", "#f59e0b", "#ec4899"] as const,
  channelColors: {
    voice: "#6366f1",
    chat: "#06b6d4",
    email: "#f59e0b",
    whatsapp: "#8b5cf6",
  } as const,
} as const;

export const cognitiveDashboardCardClassName =
  "rounded-2xl border-[0.6px] border-[#bfbfbf] bg-white px-4 py-4 shadow-[0_8px_32px_rgba(15,23,42,0.06)]";

export const cognitiveKpiCardClassName =
  "rounded-2xl border-[0.6px] border-[#bfbfbf] bg-white px-4 py-4 shadow-[0_8px_32px_rgba(15,23,42,0.06)]";

export const cognitiveKpiLabelClassName =
  "text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400";

export const cognitiveKpiValueClassName =
  "mt-1 text-2xl font-bold tracking-tight text-slate-900 tabular-nums";

export const cognitiveKpiCaptionClassName = "mt-1.5 text-[11px] leading-snug text-slate-500";

export const cognitiveChartTitleClassName = "text-sm font-semibold text-slate-900";

export const cognitiveChartSubtitleClassName = "mt-0.5 text-[11px] text-slate-500";

export const cognitiveShellClassName =
  "rounded-2xl border border-slate-200/80 bg-white shadow-[0_8px_32px_rgba(15,23,42,0.06)]";

export const cognitivePageSurfaceClassName = "bg-[#f8f9fb]";

export const cognitiveWorkspaceClassName = "max-w-none gap-4";

export const cognitiveCopilotScrollClassName = "bg-[#f8f9fb]";

export const cognitiveCopilotChromeClassName = "border-slate-200/50 bg-[#f8f9fb]";

export const cognitiveCopilotShellClassName =
  "rounded-2xl border border-slate-200/80 bg-[#f8f9fb] shadow-[0_8px_32px_rgba(15,23,42,0.06)]";

export const cognitiveReportsHeaderClassName =
  "border-b border-slate-200/50 bg-[#f8f9fb] px-4 py-3.5";

export const cognitiveSegmentActiveClassName = "border-violet-600 bg-violet-600";

export const cognitiveSegmentContainerClassName =
  "rounded-xl border border-slate-200/80 bg-white p-0.5 shadow-sm";
