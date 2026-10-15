import React, { useState, useEffect } from 'react';
import {
  RefreshCw,
  Clock,
  AlertCircle,
  Flame,
  User,
  Activity,
  CheckCircle2,
  TrendingUp,
  FileText,
  UserRoundCog,
  Users,
  LineChart,
  Calendar,
} from 'lucide-react';
import { DashboardMetrics, ActivityLog } from '../types';
import { useSetPageTitle } from './layout/PageTitleContext';
import CoworkerSplitWorkspace from './coworker/CoworkerSplitWorkspace';
import { canAccessModule, type AppRole } from '../rbac';

interface DashboardViewProps {
  onNavigate: (view: string, opts?: { ticketSearch?: string }) => void;
  metrics: DashboardMetrics;
  onRefresh: () => void;
  onCoworkerMessage?: (text: string) => string | null | Promise<string | null>;
  onCoworkerChatActions?: (
    actions: Record<string, unknown>[],
    meta: { reply: string; agent: string; userText: string }
  ) => void | Promise<void>;
  onAgentRoute?: (agent: string) => void;
  showTriageStats?: boolean;
  role?: string;
  displayTimezone?: string;
}

/** API range keys */
type ChartRange = '24hours' | '7days' | '30days' | 'custom';
/** Header pill presets matching Contact Center Reports */
type RangePreset = 'today' | '7d' | '30d' | 'custom';

function presetToApiRange(preset: RangePreset): ChartRange {
  if (preset === 'today') return '24hours';
  if (preset === '7d') return '7days';
  if (preset === '30d') return '30days';
  return 'custom';
}

function formatRangeLabel(from: Date, to: Date) {
  const fmt = (d: Date) =>
    d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  return `${fmt(from)} – ${fmt(to)}`;
}

function daysBetweenInclusive(fromIso: string, toIso: string) {
  const from = new Date(`${fromIso}T00:00:00`);
  const to = new Date(`${toIso}T23:59:59`);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to < from) {
    return 0;
  }
  return Math.max(1, Math.ceil((to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000)));
}

interface ChartPayload {
  range: string;
  labels: string[];
  series: {
    new: number[];
    onHold: number[];
    resolved: number[];
    backlog: number[];
    filed: number[];
    open?: number[];
    dueToday?: number[];
    overdue?: number[];
  };
  maxValue: number;
  totals: {
    new: number;
    onHold: number;
    resolved: number;
    backlog: number;
    filed: number;
    open?: number;
    dueToday?: number;
    overdue?: number;
    avgTicketsPerDay?: number;
    avgResolveHours?: number | null;
  };
  channels?: Array<{ name: string; count: number; pct: number }>;
  statusOutcomes?: Array<{ name: string; count: number; pct: number }>;
}

const emptyChart: ChartPayload = {
  range: '7days',
  labels: [],
  series: {
    new: [],
    onHold: [],
    resolved: [],
    backlog: [],
    filed: [],
    open: [],
    dueToday: [],
    overdue: [],
  },
  maxValue: 1,
  totals: { new: 0, onHold: 0, resolved: 0, backlog: 0, filed: 0, open: 0 },
  channels: [],
  statusOutcomes: [],
};

const CHANNEL_DONUT: Record<string, string> = {
  Email: '#0ea5e9',
  Chat: '#14b8a6',
  Phone: '#f59e0b',
  'Web Portal': '#64748b',
  Web: '#64748b',
};

const STATUS_BAR: Record<string, string> = {
  Open: 'bg-sky-500',
  Pending: 'bg-amber-500',
  'On Hold': 'bg-neutral-400',
  Overdue: 'bg-rose-500',
  Resolved: 'bg-emerald-500',
  Closed: 'bg-emerald-600',
};

const PRIORITY_META: {
  key: 'low' | 'medium' | 'high' | 'urgent';
  label: string;
  color: string;
  track: string;
}[] = [
  { key: 'low', label: 'Low', color: '#14b8a6', track: 'bg-teal-500' },
  { key: 'medium', label: 'Medium', color: '#0ea5e9', track: 'bg-sky-500' },
  { key: 'high', label: 'High', color: '#f59e0b', track: 'bg-amber-500' },
  { key: 'urgent', label: 'Critical', color: '#e11d48', track: 'bg-rose-500' },
];

const QUEUE_BAR = ['bg-sky-500', 'bg-teal-500', 'bg-amber-500', 'bg-rose-400'];

function ticketIdFromActivity(text: string): string | null {
  const m = text.match(/#\s*([A-Za-z0-9][\w-]*)/);
  return m?.[1] ? `#${m[1]}` : null;
}

function niceMax(value: number) {
  const v = Math.max(0, value);
  if (v <= 4) return 4;
  const exp = Math.pow(10, Math.floor(Math.log10(v)));
  const n = Math.ceil(v / exp);
  const step = n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return step * exp;
}

function catmullRomPath(coords: { x: number; y: number }[]) {
  if (!coords.length) return '';
  if (coords.length === 1) return `M ${coords[0].x} ${coords[0].y}`;
  let d = `M ${coords[0].x} ${coords[0].y}`;
  for (let i = 0; i < coords.length - 1; i++) {
    const p0 = coords[i - 1] || coords[i];
    const p1 = coords[i];
    const p2 = coords[i + 1];
    const p3 = coords[i + 2] || p2;
    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p2.x} ${p2.y}`;
  }
  return d;
}

/** Pass-through DB chart series only — never invent a trend from KPI or tickets. */
function shapeSparkPoints(points: number[]): number[] {
  return (points || [])
    .map((p) => Math.max(0, Number(p) || 0))
    .slice(-7);
}

function Sparkline({
  points,
  stroke = '#0ea5e9',
  w = 96,
  h = 40,
}: {
  points: number[];
  stroke?: string;
  w?: number;
  h?: number;
}) {
  const values = shapeSparkPoints(points);
  if (!values.length) return null;
  const uid = React.useId().replace(/:/g, '');
  // Zoom Y so small day-to-day diffs stay visible (not flattened to a diagonal).
  const rawMax = Math.max(...values, 0.01);
  const rawMin = Math.min(...values);
  const span = Math.max(rawMax - rawMin, rawMax * 0.2, 1);
  const plotMax = rawMin + span * 1.15;
  const plotMin = Math.max(0, rawMin - span * 0.1);
  const padX = 3;
  const padY = 5;
  const innerW = w - padX * 2;
  const innerH = h - padY * 2;
  const step = values.length <= 1 ? 0 : innerW / (values.length - 1);
  const coords = values.map((p, i) => ({
    x: padX + i * step,
    y:
      padY +
      innerH -
      ((Math.min(Math.max(p, plotMin), plotMax) - plotMin) / (plotMax - plotMin || 1)) *
        innerH,
  }));
  const linePath = catmullRomPath(coords);
  const last = coords[coords.length - 1];
  const first = coords[0];
  const areaPath = `${linePath} L ${last.x} ${h - padY} L ${first.x} ${h - padY} Z`;
  const fillId = `spark-fill-${uid}`;
  const glowId = `spark-glow-${uid}`;

  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      className="w-[96px] h-10 shrink-0 overflow-visible"
      aria-hidden
    >
      <defs>
        <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity="0.35" />
          <stop offset="55%" stopColor={stroke} stopOpacity="0.12" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
        <filter id={glowId} x="-20%" y="-40%" width="140%" height="180%">
          <feGaussianBlur stdDeviation="1.2" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <path d={areaPath} fill={`url(#${fillId})`} />
      <path
        d={linePath}
        fill="none"
        stroke={stroke}
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        filter={`url(#${glowId})`}
      />
      <circle cx={last.x} cy={last.y} r="4" fill={stroke} fillOpacity="0.18" />
      <circle cx={last.x} cy={last.y} r="2.5" fill="#fff" stroke={stroke} strokeWidth="1.75" />
    </svg>
  );
}

function MetricTile({
  label,
  value,
  hint,
  icon,
  iconWrap,
  footer,
  footerTone = 'neutral',
  spark,
  bodyTone,
  onClick,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  icon: React.ReactNode;
  iconWrap: string;
  footer?: string;
  footerTone?: 'sky' | 'amber' | 'rose' | 'emerald' | 'neutral';
  spark?: React.ReactNode;
  bodyTone?: 'sky' | 'amber' | 'rose' | 'emerald';
  onClick?: () => void;
}) {
  const footBg =
    footerTone === 'sky'
      ? 'bg-sky-50 text-sky-700'
      : footerTone === 'amber'
        ? 'bg-amber-50 text-amber-800'
        : footerTone === 'rose'
          ? 'bg-rose-50 text-rose-700'
          : footerTone === 'emerald'
            ? 'bg-emerald-50 text-emerald-700'
            : 'bg-neutral-50 text-neutral-500';
  const bodyBg =
    bodyTone === 'sky'
      ? 'bg-sky-50/70'
      : bodyTone === 'amber'
        ? 'bg-amber-50/60'
        : bodyTone === 'rose'
          ? 'bg-rose-50/60'
          : bodyTone === 'emerald'
            ? 'bg-emerald-50/50'
            : 'bg-white';
  const body = (
    <div className="rounded-xl border border-neutral-200 bg-white shadow-sm overflow-hidden flex flex-col min-h-[108px] h-full">
      <div className={`px-3 pt-3 pb-2 flex flex-col gap-1.5 flex-1 ${bodyBg}`}>
        <div className="flex items-start justify-between gap-2">
          <span className="text-[10px] font-semibold tracking-wide uppercase text-neutral-400">
            {label}
          </span>
          <span className={`shrink-0 rounded-full p-1.5 ${iconWrap} [&_svg]:h-3.5 [&_svg]:w-3.5`}>
            {icon}
          </span>
        </div>
        <div className="flex items-end justify-between gap-2 mt-auto">
          <div className="min-w-0">
            <div className="text-2xl font-semibold tabular-nums text-neutral-900 leading-none">
              {value}
            </div>
            {hint ? (
              <p className="text-[11px] text-neutral-500 mt-1 leading-snug truncate">{hint}</p>
            ) : null}
          </div>
          {spark ? <div className="shrink-0 pb-0.5">{spark}</div> : null}
        </div>
      </div>
      {footer ? (
        <div className={`px-3 py-1.5 text-[10px] font-medium ${footBg}`}>{footer}</div>
      ) : null}
    </div>
  );
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className="text-left w-full h-full">
        {body}
      </button>
    );
  }
  return body;
}

function TriageTile({
  label,
  value,
  hint,
  icon,
  iconWrap,
  onClick,
}: {
  label: string;
  value: number;
  hint: string;
  icon: React.ReactNode;
  iconWrap: string;
  onClick?: () => void;
}) {
  const inner = (
    <div className="rounded-xl border border-neutral-200 bg-white p-3 shadow-sm h-full flex flex-col gap-2">
      <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${iconWrap} [&_svg]:h-4 [&_svg]:w-4`}>
        {icon}
      </div>
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-wide text-neutral-400">{label}</p>
        <p className="text-2xl font-semibold tabular-nums text-neutral-900 leading-none mt-1">{value}</p>
        <p className="text-[11px] text-neutral-500 mt-1">{hint}</p>
      </div>
    </div>
  );
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className="text-left w-full h-full">
        {inner}
      </button>
    );
  }
  return inner;
}

function changeFooter(raw?: string, empty = 'No change') {
  const t = (raw || '').trim();
  if (!t || t === '—') return { text: `— ${empty}`, up: null as boolean | null };
  const up = t.includes('+') || t.includes('↑');
  const down = t.includes('-') || t.includes('↓');
  return { text: t.startsWith('↑') || t.startsWith('↓') ? t : t, up: up ? true : down ? false : null };
}

/**
 * Reports — ticketing metrics snapshot (co-worker left + metrics right).
 * Deep dive lives on Analytics via View Analytics.
 */
export default function DashboardView({
  metrics,
  onRefresh,
  onNavigate,
  onCoworkerMessage,
  onCoworkerChatActions,
  onAgentRoute,
  showTriageStats = false,
  role = 'agent',
  displayTimezone = 'UTC',
}: DashboardViewProps) {
  useSetPageTitle('Reports');
  const showAnalyticsLink =
    !!role && canAccessModule(role as AppRole, 'analytics');
  const [activities, setActivities] = useState<ActivityLog[]>([]);
  const [rangePreset, setRangePreset] = useState<RangePreset>('30d');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [customOpen, setCustomOpen] = useState(false);
  const [chart, setChart] = useState<ChartPayload>(emptyChart);
  const [chartLoading, setChartLoading] = useState(true);
  const [triage, setTriage] = useState<{
    createdByMe: number;
    reassignedOut: number;
    openOnMyTeams: number;
  } | null>(null);
  const [unassignedCount, setUnassignedCount] = useState(0);

  const openCount = Number(metrics.openTickets) || 0;
  const overdueCount = Number(metrics.overdue) || 0;
  const dueToday = Number(metrics.dueToday) || 0;

  const openSpark = chart.series.open?.length ? chart.series.open.slice(-7) : [];
  const overdueSpark = chart.series.overdue?.length ? chart.series.overdue.slice(-7) : [];
  const dueTodaySpark = chart.series.dueToday?.length ? chart.series.dueToday.slice(-7) : [];

  const priorityCounts = metrics.priorityCounts || {
    low: 0,
    medium: 0,
    high: 0,
    urgent: 0,
  };
  const priorityTotal = PRIORITY_META.reduce((s, m) => s + (priorityCounts[m.key] || 0), 0) || 0;

  const topQueues = Array.isArray(metrics.topQueues) ? metrics.topQueues : [];
  const queueMax = Math.max(...topQueues.map((q) => q.count), 1);

  const suggestionChips =
    role === 'admin'
      ? ['my tickets', 'open tickets', 'create ticket', 'teams', 'analytics']
      : role === 'agent'
        ? ['my tickets', 'team inbox', 'unassigned', 'create ticket', 'teams']
        : ['my tickets', 'open tickets', 'knowledge base', 'settings'];

  const chartRange = presetToApiRange(rangePreset);
  const customDays =
    rangePreset === 'custom' && customFrom && customTo
      ? daysBetweenInclusive(customFrom, customTo)
      : 0;
  const customHours = customDays > 0 ? customDays * 24 : 0;

  const rangeWindow = (() => {
    const to = new Date();
    const from = new Date(to);
    if (rangePreset === 'today') {
      from.setHours(0, 0, 0, 0);
    } else if (rangePreset === '7d') {
      from.setDate(from.getDate() - 6);
      from.setHours(0, 0, 0, 0);
    } else if (rangePreset === '30d') {
      from.setDate(from.getDate() - 29);
      from.setHours(0, 0, 0, 0);
    } else if (customFrom && customTo) {
      return {
        from: new Date(`${customFrom}T00:00:00`),
        to: new Date(`${customTo}T23:59:59`),
      };
    } else {
      from.setDate(from.getDate() - 29);
      from.setHours(0, 0, 0, 0);
    }
    return { from, to };
  })();
  const rangeSubtitle = formatRangeLabel(rangeWindow.from, rangeWindow.to);

  const fetchActivities = async () => {
    try {
      const res = await fetch('/api/activities', { credentials: 'include' });
      if (!res.ok) throw new Error('Activities request failed');
      const data = await res.json();
      setActivities(Array.isArray(data) ? data.slice(0, 8) : []);
    } catch (err) {
      console.error('Failed to fetch activities', err);
      setActivities([]);
    }
  };

  const fetchChart = async () => {
    setChartLoading(true);
    try {
      const params = new URLSearchParams();
      if (rangePreset === 'custom' && customHours > 0) {
        params.set('range', 'custom');
        params.set('hours', String(customHours));
      } else {
        params.set('range', chartRange === 'custom' ? '30days' : chartRange);
      }
      const res = await fetch(`/api/dashboard/chart?${params}`, {
        credentials: 'include',
      });
      if (res.ok) setChart(await res.json());
      else setChart(emptyChart);
    } catch (err) {
      console.error('Failed to load chart', err);
      setChart(emptyChart);
    } finally {
      setChartLoading(false);
    }
  };

  useEffect(() => {
    fetchActivities();
  }, []);

  useEffect(() => {
    if (rangePreset === 'custom' && customHours <= 0) return;
    fetchChart();
  }, [rangePreset, customHours]);

  useEffect(() => {
    if (!showTriageStats) {
      setTriage(null);
      return;
    }
    (async () => {
      try {
        const res = await fetch('/api/agent/triage-stats', { credentials: 'include' });
        if (res.ok) setTriage(await res.json());
        else setTriage(null);
      } catch {
        setTriage(null);
      }
    })();
  }, [showTriageStats]);

  useEffect(() => {
    // Prefer DB metrics.unassigned; keep local in sync when metrics refresh.
    setUnassignedCount(Number(metrics.unassigned) || 0);
  }, [metrics.unassigned]);

  const applyCustomRange = () => {
    if (customDays <= 0 || customDays > 90) return;
    setRangePreset('custom');
    setCustomOpen(false);
  };

  const selectPreset = (preset: RangePreset) => {
    if (preset === 'custom') {
      setCustomOpen((o) => !o);
      if (!customFrom || !customTo) {
        const to = new Date();
        const from = new Date();
        from.setDate(to.getDate() - 29);
        setCustomTo(to.toISOString().slice(0, 10));
        setCustomFrom(from.toISOString().slice(0, 10));
      }
      return;
    }
    setCustomOpen(false);
    setRangePreset(preset);
  };

  const chartWidth = 360;
  const chartHeight = 110;
  const createdPoints = chart.series.filed?.length
    ? chart.series.filed
    : chart.series.new || [];
  const resolvedPoints = chart.series.resolved?.length ? chart.series.resolved : [];
  const filedTotal = Number(
    chart.totals.filed != null
      ? chart.totals.filed
      : createdPoints.reduce((a, b) => a + (Number(b) || 0), 0)
  );
  const resolvedTotal = Number(
    chart.totals.resolved != null
      ? chart.totals.resolved
      : resolvedPoints.reduce((a, b) => a + (Number(b) || 0), 0)
  );
  const avgTicketsPerDay =
    typeof chart.totals.avgTicketsPerDay === 'number'
      ? chart.totals.avgTicketsPerDay
      : (() => {
          const days =
            rangePreset === 'today'
              ? 1
              : rangePreset === '7d'
                ? 7
                : rangePreset === 'custom' && customDays > 0
                  ? customDays
                  : 30;
          return Math.round((filedTotal / days) * 10) / 10;
        })();
  const avgResolveHours =
    chart.totals.avgResolveHours != null && Number.isFinite(chart.totals.avgResolveHours)
      ? chart.totals.avgResolveHours
      : null;
  const channels = Array.isArray(chart.channels) ? chart.channels : [];
  const statusOutcomes = Array.isArray(chart.statusOutcomes) ? chart.statusOutcomes : [];
  const channelTotal = channels.reduce((s, c) => s + c.count, 0);
  const statusMax = Math.max(...statusOutcomes.map((s) => s.count), 1);
  const resolutionRate =
    filedTotal > 0 ? Math.round((resolvedTotal / filedTotal) * 100) : 0;
  const stillOpenFromCreate = statusOutcomes
    .filter((s) => !['Resolved', 'Closed'].includes(s.name))
    .reduce((sum, s) => sum + s.count, 0);
  const createdYMax = niceMax(Math.max(...createdPoints, 1));
  const resolvedYMax = niceMax(Math.max(...resolvedPoints, 1));
  const hasCreatedData = createdPoints.some((p) => Number(p) > 0);
  const hasResolvedData = resolvedPoints.some((p) => Number(p) > 0);

  const coordsFor = (points: number[], yMax: number) => {
    if (points.length <= 1) {
      const y = chartHeight - (Math.min(points[0] || 0, yMax) / yMax) * chartHeight;
      return `0,${y} ${chartWidth},${y}`;
    }
    const step = chartWidth / (points.length - 1);
    return points
      .map((p, index) => {
        const x = index * step;
        const y = chartHeight - (Math.min(Number(p) || 0, yMax) / yMax) * chartHeight;
        return `${x},${y}`;
      })
      .join(' ');
  };

  const pointAt = (points: number[], index: number, yMax: number) => {
    const step = points.length <= 1 ? 0 : chartWidth / (points.length - 1);
    return {
      x: index * step,
      y: chartHeight - (Math.min(Number(points[index]) || 0, yMax) / yMax) * chartHeight,
    };
  };

  const axisLabels = (() => {
    if (!chart.labels.length) return [];
    const step = Math.max(1, Math.ceil(chart.labels.length / 4));
    return chart.labels
      .map((l, i) => ({ l, i }))
      .filter(({ i }) => i % step === 0 || i === chart.labels.length - 1);
  })();

  const rangeLabel =
    rangePreset === 'today'
      ? 'Today'
      : rangePreset === '7d'
        ? '7D'
        : rangePreset === '30d'
          ? '30D'
          : 'Custom';

  const refreshAll = () => {
    onRefresh();
    fetchActivities();
    void fetchChart();
  };

  const openChange = changeFooter(metrics.openChange, 'vs prior period');
  const overdueChange = changeFooter(metrics.overdueChange);
  const dueChange = changeFooter(metrics.dueTodayChange, 'vs yesterday');

  const pressurePct = Math.min(
    100,
    openCount ? (unassignedCount / Math.max(openCount, 1)) * 100 : 0
  );
  const pressureLevel: 'healthy' | 'watch' | 'critical' =
    pressurePct >= 60 ? 'critical' : pressurePct >= 30 ? 'watch' : 'healthy';
  const pressureTone =
    pressureLevel === 'critical'
      ? 'Needs attention'
      : pressureLevel === 'watch'
        ? 'Watch closely'
        : 'Healthy queue';
  const pressureBanner =
    pressureLevel === 'critical'
      ? 'bg-indigo-50 border-indigo-100 text-indigo-900'
      : pressureLevel === 'watch'
        ? 'bg-sky-50 border-sky-100 text-sky-900'
        : 'bg-cyan-50 border-cyan-100 text-cyan-900';
  const pressureDot =
    pressureLevel === 'critical'
      ? 'bg-indigo-500'
      : pressureLevel === 'watch'
        ? 'bg-sky-500'
        : 'bg-cyan-500';
  const thumbPct = Math.max(4, Math.min(96, pressurePct || 4));

  // Donut geometry
  const donutR = 36;
  const donutC = 2 * Math.PI * donutR;
  let donutOffset = 0;
  let channelDonutOffset = 0;

  const activityIcon = (text: string) => {
    const lower = text.toLowerCase();
    if (lower.includes('reassign') || lower.includes('escalat')) {
      return { wrap: 'bg-teal-50 text-teal-600', Icon: UserRoundCog };
    }
    if (lower.includes('hold')) {
      return { wrap: 'bg-amber-50 text-amber-600', Icon: Clock };
    }
    if (lower.includes('creat') || lower.includes('filed')) {
      return { wrap: 'bg-sky-50 text-sky-600', Icon: FileText };
    }
    return { wrap: 'bg-neutral-100 text-neutral-500', Icon: Activity };
  };

  return (
    <CoworkerSplitWorkspace
      pageLabel="Reports"
      contentTitle="Reports"
      contentSubtitle={rangeSubtitle}
      placeholder="Ask your Worktual co-worker..."
      suggestionChips={suggestionChips}
      onUserMessage={onCoworkerMessage}
      onChatActions={onCoworkerChatActions}
      onAgentRoute={onAgentRoute}
      module="general"
      surface="list"
      allowFullPageExpand
      contentHeaderActions={
        <div className="flex items-center gap-1.5 flex-wrap justify-end">
          {showAnalyticsLink ? (
            <button
              type="button"
              title="View Analytics"
              onClick={() => onNavigate('analytics')}
              className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg border border-neutral-950 bg-neutral-950 text-[11px] font-semibold text-white hover:bg-neutral-800"
            >
              <LineChart className="h-3.5 w-3.5" />
              View Analytics
            </button>
          ) : null}

          <div className="relative flex items-center rounded-lg border border-neutral-300 bg-white p-0.5">
            {(
              [
                { id: 'today', label: 'Today' },
                { id: '7d', label: '7D' },
                { id: '30d', label: '30D' },
              ] as const
            ).map((opt) => {
              const active = rangePreset === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => selectPreset(opt.id)}
                  className={`h-7 px-2.5 rounded-md text-[11px] font-semibold transition-colors ${
                    active
                      ? 'bg-neutral-950 text-white'
                      : 'text-neutral-600 hover:text-neutral-900'
                  }`}
                >
                  {opt.label}
                </button>
              );
            })}
            <button
              type="button"
              onClick={() => selectPreset('custom')}
              className={`inline-flex items-center gap-1 h-7 px-2.5 rounded-md text-[11px] font-semibold transition-colors ${
                rangePreset === 'custom'
                  ? 'bg-neutral-950 text-white'
                  : 'text-neutral-600 hover:text-neutral-900'
              }`}
            >
              <Calendar className="h-3 w-3" />
              Custom
            </button>
            {customOpen ? (
              <div className="absolute right-0 top-[calc(100%+6px)] z-30 w-64 rounded-xl border border-neutral-200 bg-white p-3 shadow-lg space-y-2">
                <label className="block text-[10px] font-medium text-neutral-500 uppercase tracking-wide">
                  From
                  <input
                    type="date"
                    value={customFrom}
                    onChange={(e) => setCustomFrom(e.target.value)}
                    className="mt-1 w-full h-8 rounded-lg border border-neutral-200 px-2 text-[11px] text-neutral-800"
                  />
                </label>
                <label className="block text-[10px] font-medium text-neutral-500 uppercase tracking-wide">
                  To
                  <input
                    type="date"
                    value={customTo}
                    onChange={(e) => setCustomTo(e.target.value)}
                    className="mt-1 w-full h-8 rounded-lg border border-neutral-200 px-2 text-[11px] text-neutral-800"
                  />
                </label>
                <button
                  type="button"
                  disabled={customDays <= 0 || customDays > 90}
                  onClick={applyCustomRange}
                  className="w-full h-8 rounded-lg bg-neutral-950 text-white text-[11px] font-semibold hover:bg-neutral-800 disabled:opacity-40"
                >
                  Apply{customDays > 0 ? ` · ${customDays}d` : ''}
                </button>
              </div>
            ) : null}
          </div>

          <button
            type="button"
            title="Refresh"
            onClick={refreshAll}
            className="inline-flex items-center justify-center h-8 w-8 rounded-lg border border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${chartLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      }
    >
      <div className="p-4 sm:p-5 space-y-4 pb-8">
        {showTriageStats && triage && (
          <div className="grid grid-cols-3 gap-2.5">
            <TriageTile
              label="Created by me"
              value={triage.createdByMe}
              hint="Tickets you filed"
              icon={<FileText className="text-sky-600" />}
              iconWrap="bg-sky-50"
            />
            <TriageTile
              label="Reassigned out"
              value={triage.reassignedOut}
              hint="Handed to others"
              icon={<UserRoundCog className="text-teal-600" />}
              iconWrap="bg-teal-50"
            />
            <TriageTile
              label="Open on my teams"
              value={triage.openOnMyTeams}
              hint="Team inbox"
              icon={<Users className="text-emerald-600" />}
              iconWrap="bg-emerald-50"
              onClick={() => onNavigate('team-inbox')}
            />
          </div>
        )}

        <div className="grid grid-cols-3 gap-2.5">
          <MetricTile
            label="Pending tickets"
            value={openCount}
            hint="Active in queues"
            icon={<Flame className="text-sky-600" />}
            iconWrap="bg-sky-100"
            bodyTone="sky"
            spark={
              chartLoading ? undefined : (
                <Sparkline points={openSpark} stroke="#0ea5e9" />
              )
            }
            footer={openChange.text}
            footerTone="sky"
            onClick={() => onNavigate(role === 'agent' ? 'assigned' : 'tickets-list')}
          />
          <MetricTile
            label="Overdue"
            value={overdueCount}
            hint="Past due"
            icon={<AlertCircle className="text-rose-600" />}
            iconWrap="bg-rose-100"
            bodyTone="rose"
            spark={
              chartLoading ? undefined : (
                <Sparkline points={overdueSpark} stroke="#e11d48" />
              )
            }
            footer={overdueChange.text}
            footerTone="rose"
          />
          <MetricTile
            label="Due today"
            value={dueToday}
            hint="Due within today"
            icon={<CheckCircle2 className="text-emerald-600" />}
            iconWrap="bg-emerald-100"
            bodyTone="emerald"
            spark={
              chartLoading ? undefined : (
                <Sparkline points={dueTodaySpark} stroke="#10b981" />
              )
            }
            footer={dueChange.text}
            footerTone="emerald"
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          <div className="rounded-xl border border-neutral-200 bg-white p-3.5 shadow-sm">
            <div className="flex items-center justify-between gap-2 mb-2">
              <div>
                <h3 className="text-xs font-semibold text-neutral-900">Priority breakdown</h3>
                <p className="text-[10px] text-neutral-500 mt-0.5">
                  Open work by urgency — who to tackle first
                </p>
              </div>
              <span className="text-[10px] text-neutral-400 tabular-nums">{openCount} open</span>
            </div>
            <div className="flex items-center gap-3">
              <div className="relative w-[88px] h-[88px] shrink-0">
                <svg viewBox="0 0 96 96" className="w-full h-full -rotate-90">
                  <circle
                    cx="48"
                    cy="48"
                    r={donutR}
                    fill="none"
                    stroke="#f4f4f5"
                    strokeWidth="12"
                  />
                  {PRIORITY_META.map((m) => {
                    const count = priorityCounts[m.key];
                    const len = priorityTotal > 0 ? (count / priorityTotal) * donutC : 0;
                    const dash = `${len} ${donutC - len}`;
                    const el = (
                      <circle
                        key={m.key}
                        cx="48"
                        cy="48"
                        r={donutR}
                        fill="none"
                        stroke={m.color}
                        strokeWidth="12"
                        strokeDasharray={dash}
                        strokeDashoffset={-donutOffset}
                        strokeLinecap="butt"
                      />
                    );
                    donutOffset += len;
                    return el;
                  })}
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center rotate-0">
                  <span className="text-lg font-semibold tabular-nums text-neutral-900 leading-none">
                    {openCount}
                  </span>
                  <span className="text-[9px] text-neutral-400 mt-0.5">total</span>
                </div>
              </div>
              <ul className="flex-1 space-y-1.5 min-w-0">
                {PRIORITY_META.map((m) => {
                  const count = priorityCounts[m.key];
                  const pct = priorityTotal > 0 ? Math.round((count / priorityTotal) * 100) : 0;
                  return (
                    <li key={m.key} className="flex items-center gap-2 text-[11px]">
                      <span
                        className="h-2 w-2 rounded-full shrink-0"
                        style={{ background: m.color }}
                      />
                      <span className="text-neutral-600 truncate flex-1">{m.label}</span>
                      <span className="tabular-nums text-neutral-900 font-medium">{count}</span>
                      <span className="tabular-nums text-neutral-400 w-8 text-right">{pct}%</span>
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>

          <div className="rounded-xl border border-neutral-200 bg-white p-3.5 shadow-sm">
            <div className="flex items-center justify-between gap-2 mb-2">
              <div>
                <h3 className="text-xs font-semibold text-neutral-900">Channel breakdown</h3>
                <p className="text-[10px] text-neutral-500 mt-0.5">
                  Where tickets were created · {rangeLabel}
                </p>
              </div>
              <span className="text-[10px] text-neutral-400 tabular-nums">
                {channelTotal} created
              </span>
            </div>
            {channels.length === 0 ? (
              <p className="py-8 text-center text-xs text-neutral-400">
                No tickets created in this range
              </p>
            ) : (
              <div className="flex items-center gap-3">
                <div className="relative w-[88px] h-[88px] shrink-0">
                  <svg viewBox="0 0 96 96" className="w-full h-full -rotate-90">
                    <circle
                      cx="48"
                      cy="48"
                      r={donutR}
                      fill="none"
                      stroke="#f4f4f5"
                      strokeWidth="12"
                    />
                    {channels.map((ch) => {
                      const len =
                        channelTotal > 0 ? (ch.count / channelTotal) * donutC : 0;
                      const dash = `${len} ${donutC - len}`;
                      const color = CHANNEL_DONUT[ch.name] || '#94a3b8';
                      const el = (
                        <circle
                          key={ch.name}
                          cx="48"
                          cy="48"
                          r={donutR}
                          fill="none"
                          stroke={color}
                          strokeWidth="12"
                          strokeDasharray={dash}
                          strokeDashoffset={-channelDonutOffset}
                          strokeLinecap="butt"
                        />
                      );
                      channelDonutOffset += len;
                      return el;
                    })}
                  </svg>
                  <div className="absolute inset-0 flex flex-col items-center justify-center rotate-0">
                    <span className="text-lg font-semibold tabular-nums text-neutral-900 leading-none">
                      {channelTotal}
                    </span>
                    <span className="text-[9px] text-neutral-400 mt-0.5">created</span>
                  </div>
                </div>
                <ul className="flex-1 space-y-1.5 min-w-0">
                  {channels.map((ch) => (
                    <li key={ch.name} className="flex items-center gap-2 text-[11px]">
                      <span
                        className="h-2 w-2 rounded-full shrink-0"
                        style={{ background: CHANNEL_DONUT[ch.name] || '#94a3b8' }}
                      />
                      <span className="text-neutral-600 truncate flex-1">{ch.name}</span>
                      <span className="tabular-nums text-neutral-900 font-medium">{ch.count}</span>
                      <span className="tabular-nums text-neutral-400 w-8 text-right">{ch.pct}%</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>

        <div className="rounded-xl border border-neutral-200 bg-white p-3.5 shadow-sm space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <User className="h-3.5 w-3.5 text-neutral-400 shrink-0" />
              <h3 className="text-xs font-semibold text-neutral-900 truncate">
                Queue pressure
                {displayTimezone ? (
                  <span className="ml-1 font-normal text-neutral-400">({displayTimezone})</span>
                ) : null}
              </h3>
            </div>
            <button
              type="button"
              onClick={() =>
                onNavigate(
                  role === 'agent' || role === 'admin' ? 'unassigned' : 'tickets-list'
                )
              }
              className="text-[11px] font-semibold text-sky-600 hover:text-sky-800 shrink-0"
            >
              {role === 'agent' || role === 'admin' ? 'View unassigned' : 'View tickets'} →
            </button>
          </div>

          <div className="flex items-end justify-between gap-4">
            <div className="min-w-0 flex-1 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-medium text-neutral-500">Missing agent/resolver</span>
                <span className="text-[11px] font-semibold tabular-nums text-neutral-700">
                  {Math.round(pressurePct)}%
                </span>
              </div>

              <div
                className="relative pt-1 pb-1"
                role="meter"
                aria-label="Queue pressure from tickets missing agent or resolver"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(pressurePct)}
                aria-valuetext={`${unassignedCount} unassigned, ${Math.round(pressurePct)} percent`}
              >
                <div className="relative h-3.5 rounded-full bg-sky-50 shadow-inner overflow-hidden">
                  <div
                    className="absolute inset-0 rounded-full"
                    style={{
                      background:
                        'linear-gradient(90deg, #22d3ee 0%, #38bdf8 28%, #0ea5e9 50%, #6366f1 78%, #4f46e5 100%)',
                    }}
                  />
                  <div className="absolute inset-y-1 left-[30%] w-px bg-white/70" />
                  <div className="absolute inset-y-1 left-[60%] w-px bg-white/70" />
                  <div
                    className="absolute inset-y-0 left-0 bg-white/25 pointer-events-none"
                    style={{ width: `${thumbPct}%` }}
                  />
                </div>

                <div
                  className="absolute top-1/2 z-10 -translate-x-1/2 -translate-y-1/2"
                  style={{ left: `${thumbPct}%` }}
                >
                  <div className="flex h-7 min-w-7 items-center justify-center rounded-full bg-white px-1.5 shadow-md ring-2 ring-sky-700">
                    <span className="text-[10px] font-bold tabular-nums text-neutral-900 leading-none">
                      {unassignedCount}
                    </span>
                  </div>
                </div>
              </div>

              <div className="flex justify-between text-[10px] font-medium text-neutral-500 tabular-nums px-0.5">
                <span>0</span>
                <span className="text-cyan-600">Healthy</span>
                <span className="text-sky-600">Watch</span>
                <span className="text-indigo-600">Critical</span>
                <span>100</span>
              </div>
            </div>

            <div className="text-right shrink-0 min-w-[72px]">
              <p className="text-2xl font-semibold tabular-nums text-neutral-900 leading-none">
                {unassignedCount}
              </p>
              <p className="text-[11px] text-neutral-500 mt-1">Need assign</p>
            </div>
          </div>

          <div
            className={`rounded-lg border px-3 py-2 text-[11px] flex items-start gap-2 ${pressureBanner}`}
          >
            <span className={`mt-1 h-1.5 w-1.5 rounded-full shrink-0 ${pressureDot}`} />
            <p className="leading-snug">
              <span className="font-semibold tabular-nums">{openCount}</span> open ·{' '}
              <span className="font-semibold tabular-nums">{unassignedCount}</span> missing agent/resolver ·{' '}
              {pressureTone}
            </p>
          </div>
        </div>

        <div className="rounded-xl border border-neutral-200 bg-white p-3.5 shadow-sm space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <TrendingUp className="h-3.5 w-3.5 text-sky-500" />
                <h3 className="text-xs font-semibold text-neutral-900">Volume & outcomes</h3>
              </div>
              <p className="text-[11px] text-neutral-500 mt-0.5">
                {rangeSubtitle} · {rangeLabel}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <div className="rounded-lg border border-neutral-100 bg-neutral-50/80 px-2.5 py-2">
              <p className="text-[10px] uppercase tracking-wide text-neutral-400 font-medium">
                Avg / day
              </p>
              <p className="text-xl font-semibold tabular-nums text-neutral-900 leading-tight mt-0.5">
                {chartLoading ? '—' : avgTicketsPerDay}
              </p>
              <p className="text-[10px] text-neutral-500">tickets created · {rangeLabel}</p>
            </div>
            <div className="rounded-lg border border-neutral-100 bg-neutral-50/80 px-2.5 py-2">
              <p className="text-[10px] uppercase tracking-wide text-neutral-400 font-medium">
                Created
              </p>
              <p className="text-xl font-semibold tabular-nums text-sky-700 leading-tight mt-0.5">
                {chartLoading ? '—' : filedTotal}
              </p>
              <p className="text-[10px] text-neutral-500">in range</p>
            </div>
            <div className="rounded-lg border border-neutral-100 bg-neutral-50/80 px-2.5 py-2">
              <p className="text-[10px] uppercase tracking-wide text-neutral-400 font-medium">
                Resolved
              </p>
              <p className="text-xl font-semibold tabular-nums text-emerald-700 leading-tight mt-0.5">
                {chartLoading ? '—' : resolvedTotal}
              </p>
              <p className="text-[10px] text-neutral-500">in range</p>
            </div>
            <div className="rounded-lg border border-neutral-100 bg-neutral-50/80 px-2.5 py-2">
              <p className="text-[10px] uppercase tracking-wide text-neutral-400 font-medium">
                Avg resolve
              </p>
              <p className="text-xl font-semibold tabular-nums text-neutral-900 leading-tight mt-0.5">
                {chartLoading || avgResolveHours == null ? '—' : `${avgResolveHours}h`}
              </p>
              <p className="text-[10px] text-neutral-500">created → resolved</p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <div className="rounded-lg border border-neutral-100 p-2.5 space-y-2">
              <div className="flex items-end justify-between gap-2">
                <div>
                  <h4 className="text-[11px] font-semibold text-neutral-900">Tickets created</h4>
                  <p className="text-[10px] text-neutral-500">Volume over time</p>
                </div>
                <span className="text-sm font-semibold tabular-nums text-sky-600">{filedTotal}</span>
              </div>
              <div className="relative w-full h-[100px]">
                {!hasCreatedData && !chartLoading ? (
                  <div className="absolute inset-0 flex items-center justify-center text-[11px] text-neutral-400">
                    No tickets created in this range
                  </div>
                ) : (
                  <svg
                    viewBox={`0 0 ${chartWidth} ${chartHeight}`}
                    className="w-full h-full overflow-visible"
                    preserveAspectRatio="none"
                  >
                    <defs>
                      <linearGradient id="dashCreatedFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.3" />
                        <stop offset="100%" stopColor="#38bdf8" stopOpacity="0" />
                      </linearGradient>
                    </defs>
                    <path
                      d={`M 0,${chartHeight} L ${coordsFor(createdPoints, createdYMax)} L ${chartWidth},${chartHeight} Z`}
                      fill="url(#dashCreatedFill)"
                    />
                    <polyline
                      fill="none"
                      stroke="#0ea5e9"
                      strokeWidth="2.5"
                      points={coordsFor(createdPoints, createdYMax)}
                    />
                    {createdPoints.map((p, i) => {
                      if (!Number(p)) return null;
                      const { x, y } = pointAt(createdPoints, i, createdYMax);
                      return (
                        <circle
                          key={`c-${i}`}
                          cx={x}
                          cy={y}
                          r={3}
                          className="fill-sky-500 stroke-white"
                          strokeWidth="1.5"
                        />
                      );
                    })}
                  </svg>
                )}
              </div>
              <div className="flex justify-between text-[10px] text-neutral-400 tabular-nums">
                {axisLabels.map(({ l, i }) => (
                  <span key={`c-ax-${l}-${i}`}>{l}</span>
                ))}
              </div>
            </div>

            <div className="rounded-lg border border-neutral-100 p-2.5 space-y-2">
              <div className="flex items-end justify-between gap-2">
                <div>
                  <h4 className="text-[11px] font-semibold text-neutral-900">Tickets resolved</h4>
                  <p className="text-[10px] text-neutral-500">Closures over time</p>
                </div>
                <span className="text-sm font-semibold tabular-nums text-emerald-600">
                  {resolvedTotal}
                </span>
              </div>
              <div className="relative w-full h-[100px]">
                {!hasResolvedData && !chartLoading ? (
                  <div className="absolute inset-0 flex items-center justify-center text-[11px] text-neutral-400">
                    No resolutions in this range
                  </div>
                ) : (
                  <svg
                    viewBox={`0 0 ${chartWidth} ${chartHeight}`}
                    className="w-full h-full overflow-visible"
                    preserveAspectRatio="none"
                  >
                    <defs>
                      <linearGradient id="dashResolvedFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#34d399" stopOpacity="0.3" />
                        <stop offset="100%" stopColor="#34d399" stopOpacity="0" />
                      </linearGradient>
                    </defs>
                    <path
                      d={`M 0,${chartHeight} L ${coordsFor(resolvedPoints, resolvedYMax)} L ${chartWidth},${chartHeight} Z`}
                      fill="url(#dashResolvedFill)"
                    />
                    <polyline
                      fill="none"
                      stroke="#059669"
                      strokeWidth="2.5"
                      points={coordsFor(resolvedPoints, resolvedYMax)}
                    />
                    {resolvedPoints.map((p, i) => {
                      if (!Number(p)) return null;
                      const { x, y } = pointAt(resolvedPoints, i, resolvedYMax);
                      return (
                        <circle
                          key={`r-${i}`}
                          cx={x}
                          cy={y}
                          r={3}
                          className="fill-emerald-600 stroke-white"
                          strokeWidth="1.5"
                        />
                      );
                    })}
                  </svg>
                )}
              </div>
              <div className="flex justify-between text-[10px] text-neutral-400 tabular-nums">
                {axisLabels.map(({ l, i }) => (
                  <span key={`r-ax-${l}-${i}`}>{l}</span>
                ))}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <div className="rounded-lg border border-neutral-100 p-2.5 space-y-2.5">
              <div>
                <h4 className="text-[11px] font-semibold text-neutral-900">Resolution rate</h4>
                <p className="text-[10px] text-neutral-500 mt-0.5">
                  Resolved vs created in range
                </p>
              </div>
              <div className="flex items-end gap-2">
                <span className="text-3xl font-semibold tabular-nums text-neutral-900 leading-none">
                  {chartLoading ? '—' : `${resolutionRate}%`}
                </span>
                <span className="text-[10px] text-neutral-500 pb-0.5">
                  {resolvedTotal} of {filedTotal}
                </span>
              </div>
              <div className="h-2 rounded-full bg-neutral-100 overflow-hidden flex">
                <div
                  className="h-full bg-emerald-500"
                  style={{
                    width: `${filedTotal > 0 ? Math.min(100, resolutionRate) : 0}%`,
                  }}
                />
              </div>
              <div className="grid grid-cols-2 gap-2 text-[11px]">
                <div className="rounded-md bg-sky-50 px-2 py-1.5">
                  <p className="text-[10px] text-sky-700/80">Created</p>
                  <p className="font-semibold tabular-nums text-sky-800">{filedTotal}</p>
                </div>
                <div className="rounded-md bg-amber-50 px-2 py-1.5">
                  <p className="text-[10px] text-amber-800/80">Still open</p>
                  <p className="font-semibold tabular-nums text-amber-900">
                    {stillOpenFromCreate}
                  </p>
                </div>
              </div>
            </div>

            <div className="rounded-lg border border-neutral-100 p-2.5 space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <h4 className="text-[11px] font-semibold text-neutral-900">Status outcomes</h4>
                <span className="text-[10px] text-neutral-400 tabular-nums">{rangeLabel}</span>
              </div>
              {statusOutcomes.length === 0 ? (
                <p className="py-4 text-center text-[11px] text-neutral-400">No status data</p>
              ) : (
                <div className="space-y-1.5">
                  {statusOutcomes.map((s) => (
                    <div key={s.name} className="space-y-0.5">
                      <div className="flex items-center justify-between gap-2 text-[10px]">
                        <span className="text-neutral-600 truncate">{s.name}</span>
                        <span className="tabular-nums text-neutral-800 font-medium shrink-0">
                          {s.count}
                          <span className="text-neutral-400 font-normal"> · {s.pct}%</span>
                        </span>
                      </div>
                      <div className="h-1.5 rounded-full bg-neutral-100 overflow-hidden">
                        <div
                          className={`h-full rounded-full ${
                            STATUS_BAR[s.name] || 'bg-neutral-400'
                          }`}
                          style={{ width: `${(s.count / statusMax) * 100}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          <div className="rounded-xl border border-neutral-200 bg-white p-3.5 shadow-sm flex flex-col min-h-[200px] max-h-[320px]">
            <div className="flex items-center justify-between gap-2 mb-2 shrink-0">
              <div className="flex items-center gap-2">
                <Activity className="h-3.5 w-3.5 text-neutral-400" />
                <h3 className="text-xs font-semibold text-neutral-900">Recent activity</h3>
              </div>
              <button
                type="button"
                onClick={() => onNavigate(role === 'agent' ? 'assigned' : 'tickets-list')}
                className="text-[11px] font-semibold text-sky-600 hover:text-sky-800"
              >
                View all
              </button>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto overflow-x-auto overscroll-contain -mx-1 px-1 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
              {activities.length > 0 ? (
                <div className="space-y-0 divide-y divide-neutral-100 min-w-0">
                  {activities.slice(0, 12).map((act) => {
                    const { wrap, Icon } = activityIcon(act.text);
                    const [title, ...rest] = act.text.split(/ — |: /);
                    const detail = rest.join(': ').trim();
                    const ticketId = ticketIdFromActivity(act.text);
                    return (
                      <button
                        key={act.id}
                        type="button"
                        disabled={!ticketId}
                        title={ticketId ? `Open ${ticketId}` : act.text}
                        onClick={() => {
                          if (!ticketId) return;
                          onNavigate(
                            role === 'agent' ? 'assigned' : 'tickets-list',
                            { ticketSearch: ticketId }
                          );
                        }}
                        className={`w-full py-2.5 flex items-start gap-2.5 text-left rounded-lg px-1 -mx-0.5 transition-colors ${
                          ticketId
                            ? 'hover:bg-sky-50/80 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/60'
                            : 'cursor-default'
                        }`}
                      >
                        <span
                          className={`mt-0.5 shrink-0 rounded-lg p-1.5 ${wrap} [&_svg]:h-3.5 [&_svg]:w-3.5`}
                        >
                          <Icon />
                        </span>
                        <div className="min-w-0 flex-1 overflow-x-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
                          <p className="text-xs font-medium text-neutral-900 leading-snug whitespace-nowrap">
                            {title}
                          </p>
                          {detail ? (
                            <p className="text-[11px] text-neutral-500 whitespace-nowrap mt-0.5">
                              {detail}
                            </p>
                          ) : null}
                        </div>
                        <span className="text-[10px] text-neutral-400 font-mono shrink-0 pt-0.5">
                          {act.time}
                        </span>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <p className="py-8 text-center text-xs text-neutral-400">No recent activity</p>
              )}
            </div>
          </div>

          <div className="rounded-xl border border-neutral-200 bg-white p-3.5 shadow-sm flex flex-col min-h-[200px]">
            <div className="flex items-center justify-between gap-2 mb-3">
              <h3 className="text-xs font-semibold text-neutral-900">Top queues</h3>
              <button
                type="button"
                onClick={() => onNavigate('agent-queues')}
                className="text-[11px] font-semibold text-sky-600 hover:text-sky-800"
              >
                View all
              </button>
            </div>
            <div className="flex-1 space-y-3">
              {topQueues.length > 0 ? (
                topQueues.map((q, i) => (
                  <div key={q.name} className="space-y-1">
                    <div className="flex items-center justify-between gap-2 text-[11px]">
                      <span className="text-neutral-700 truncate font-medium">{q.name}</span>
                      <span className="tabular-nums text-neutral-900 font-semibold">{q.count}</span>
                    </div>
                    <div className="h-2 rounded-full bg-neutral-100 overflow-hidden">
                      <div
                        className={`h-full rounded-full ${QUEUE_BAR[i % QUEUE_BAR.length]} transition-all`}
                        style={{ width: `${(q.count / queueMax) * 100}%` }}
                      />
                    </div>
                  </div>
                ))
              ) : (
                <p className="py-8 text-center text-xs text-neutral-400">No open queue load</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </CoworkerSplitWorkspace>
  );
}
