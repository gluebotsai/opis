import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
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
  UserCheck,
  Users,
  Ticket,
  LineChart,
  Calendar,
  Smile,
} from 'lucide-react';
import { DashboardMetrics, ActivityLog } from '../types';
import { useSetPageTitle } from './layout/PageTitleContext';
import CoworkerSplitWorkspace from './coworker/CoworkerSplitWorkspace';
import { canAccessModule, type AppRole } from '../rbac';
import SegmentTabs from './ui/segment-tabs';

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
  csatListRefreshToken?: number;
  externalCsatRange?: string;
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

function presetToCsatRange(
  preset: RangePreset,
  customDays: number,
  external?: string
): '7days' | '30days' | '90days' {
  const ext = String(external || '').trim();
  if (ext === '7days' || ext === '30days' || ext === '90days') return ext;
  if (preset === '30d') return '30days';
  if (preset === 'custom' && customDays > 7) return '30days';
  return '7days';
}

type CsatPersonRow = {
  name: string;
  ratings: number;
  avgScore: number | null;
};

type CsatRoleSummary = {
  ratings: number;
  avgScore: number | null;
};

type CsatReportPayload = {
  ratings: number;
  avgScore: number | null;
  ratedResolved: number;
  lowScores: number;
  positive: number;
  neutral: number;
  negative: number;
  byAssignee: CsatPersonRow[];
  byResolver: CsatPersonRow[];
  l1: CsatRoleSummary;
  l2: CsatRoleSummary;
};

const emptyCsatReport: CsatReportPayload = {
  ratings: 0,
  avgScore: null,
  ratedResolved: 0,
  lowScores: 0,
  positive: 0,
  neutral: 0,
  negative: 0,
  byAssignee: [],
  byResolver: [],
  l1: { ratings: 0, avgScore: null },
  l2: { ratings: 0, avgScore: null },
};

function formatCsatAvg(score: number | null | undefined): string {
  if (score == null || !Number.isFinite(score)) return '—';
  return `${score.toFixed(1)}/5`;
}

function formatCsatCount(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return String(n);
}

function csatScoreTone(score: number | null | undefined): string {
  if (score == null || !Number.isFinite(score)) return 'text-neutral-400';
  if (score >= 4) return 'text-emerald-700';
  if (score <= 2) return 'text-rose-700';
  return 'text-amber-800';
}

function catmullRomPath(coords: { x: number; y: number }[]) {
  if (!coords.length) return '';
  if (coords.length === 1) return `M ${coords[0].x} ${coords[0].y}`;
  let d = `M ${coords[0].x} ${coords[0].y}`;
  for (let i = 0; i < coords.length - 1; i += 1) {
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

function nearestChartIndex(
  clientX: number,
  svg: SVGSVGElement,
  coords: Array<{ x: number }>,
  chartWidth: number
): number {
  const rect = svg.getBoundingClientRect();
  if (rect.width <= 0 || !coords.length) return 0;
  const x = ((clientX - rect.left) / rect.width) * chartWidth;
  let best = 0;
  let dist = Number.POSITIVE_INFINITY;
  coords.forEach((pt, i) => {
    const d = Math.abs(pt.x - x);
    if (d < dist) {
      dist = d;
      best = i;
    }
  });
  return best;
}

function seriesHalfDelta(points: number[]): number | null {
  if (points.length < 4) return null;
  const mid = Math.floor(points.length / 2);
  const first = points.slice(0, mid).reduce((sum, n) => sum + (Number(n) || 0), 0);
  const second = points.slice(mid).reduce((sum, n) => sum + (Number(n) || 0), 0);
  if (first <= 0) return null;
  return Math.round(((second - first) / first) * 1000) / 10;
}

function VolumeTrendChart({
  title,
  subtitle,
  total,
  points,
  yMax,
  labels,
  pointLabels,
  valueNoun,
  emptyLabel,
  loading,
  stroke,
  fillId,
  fillColor,
  valueClass,
}: {
  title: string;
  subtitle: string;
  total: number;
  points: number[];
  yMax: number;
  labels: Array<{ l: string; i: number }>;
  pointLabels: string[];
  valueNoun: string;
  emptyLabel: string;
  loading: boolean;
  stroke: string;
  fillId: string;
  fillColor: string;
  valueClass: string;
}) {
  const width = 360;
  const height = 110;
  const [hover, setHover] = useState<number | null>(null);
  const hasData = points.some((p) => Number(p) > 0);
  const coords = (() => {
    if (!points.length) return [{ x: 0, y: height }];
    if (points.length === 1) {
      const y = height - (Math.min(Number(points[0]) || 0, yMax) / yMax) * height;
      return [
        { x: 0, y },
        { x: width, y },
      ];
    }
    const step = width / (points.length - 1);
    return points.map((p, index) => ({
      x: index * step,
      y: height - (Math.min(Number(p) || 0, yMax) / yMax) * height,
    }));
  })();
  const line = catmullRomPath(coords);
  const area = line ? `${line} L ${width},${height} L 0,${height} Z` : '';
  const delta = seriesHalfDelta(points);
  const dataIndex =
    hover == null
      ? null
      : points.length <= 1
        ? 0
        : Math.min(hover, points.length - 1);
  const hoverPt = hover != null ? coords[hover] : null;
  const tipShift =
    hoverPt && (hoverPt.x / width) * 100 < 18
      ? 'translate-x-0'
      : hoverPt && (hoverPt.x / width) * 100 > 82
        ? '-translate-x-full'
        : '-translate-x-1/2';

  return (
    <div className="space-y-2 rounded-xl border-[0.6px] border-[#bfbfbf] bg-white p-4 shadow-none">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h4 className="text-sm font-bold capitalize text-neutral-900">{title}</h4>
          <p className="mt-0.5 text-sm text-neutral-500">{subtitle}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className={`text-xl font-bold tabular-nums leading-none ${valueClass}`}>
            {loading ? '—' : total}
          </span>
          {delta != null ? (
            <span
              className={`inline-flex h-[22px] items-center rounded-full px-2 text-[11px] font-semibold tabular-nums ${
                delta >= 0 ? 'bg-sky-100 text-sky-700' : 'bg-neutral-100 text-neutral-600'
              }`}
            >
              {delta > 0 ? '+' : ''}
              {delta.toFixed(2)}
            </span>
          ) : null}
        </div>
      </div>
      <div className="relative h-[140px] w-full">
        {!hasData && !loading ? (
          <div className="absolute inset-0 flex items-center justify-center text-[11px] text-neutral-400">
            {emptyLabel}
          </div>
        ) : (
          <>
            <svg
              viewBox={`0 0 ${width} ${height}`}
              className="h-full w-full overflow-visible"
              preserveAspectRatio="none"
              onMouseMove={(e) =>
                setHover(nearestChartIndex(e.clientX, e.currentTarget, coords, width))
              }
              onMouseLeave={() => setHover(null)}
            >
              <defs>
                <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={fillColor} stopOpacity="0.9" />
                  <stop offset="100%" stopColor={fillColor} stopOpacity="0" />
                </linearGradient>
              </defs>
              <line
                x1="0"
                y1={height * 0.33}
                x2={width}
                y2={height * 0.33}
                stroke="#858f96"
                strokeWidth="1"
                strokeDasharray="4 4"
                opacity="0.35"
              />
              <line
                x1="0"
                y1={height * 0.66}
                x2={width}
                y2={height * 0.66}
                stroke="#858f96"
                strokeWidth="1"
                strokeDasharray="4 4"
                opacity="0.35"
              />
              <line
                x1="0"
                y1={height}
                x2={width}
                y2={height}
                stroke="#909090"
                strokeWidth="0.6"
              />
              <path d={area} fill={`url(#${fillId})`} />
              <path
                d={line}
                fill="none"
                stroke={stroke}
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              {coords.map((pt, i) => {
                if (!Number(points[Math.min(i, points.length - 1)])) return null;
                return (
                  <circle
                    key={`${fillId}-pt-${i}`}
                    cx={pt.x}
                    cy={pt.y}
                    r={3.5}
                    fill="#ffffff"
                    stroke={stroke}
                    strokeWidth="1.75"
                  />
                );
              })}
              {hoverPt ? (
                <>
                  <line
                    x1={hoverPt.x}
                    y1={0}
                    x2={hoverPt.x}
                    y2={height}
                    stroke="#171717"
                    strokeOpacity="0.28"
                    strokeWidth="1"
                    vectorEffect="non-scaling-stroke"
                  />
                  <circle
                    cx={hoverPt.x}
                    cy={hoverPt.y}
                    r={5}
                    fill="#ffffff"
                    stroke={stroke}
                    strokeWidth="2"
                    vectorEffect="non-scaling-stroke"
                  />
                </>
              ) : null}
              <rect
                x="0"
                y="0"
                width={width}
                height={height}
                fill="transparent"
                className="cursor-crosshair"
              />
            </svg>
            {hoverPt && dataIndex != null ? (
              <div
                className={`pointer-events-none absolute z-10 -translate-y-full ${tipShift} rounded-lg bg-[#171717] px-2 py-1 text-[12px] leading-snug text-white shadow-none`}
                style={{
                  left: `${(hoverPt.x / width) * 100}%`,
                  top: `${(hoverPt.y / height) * 100}%`,
                  marginTop: -10,
                }}
              >
                {pointLabels[dataIndex] ? (
                  <p className="font-semibold">{pointLabels[dataIndex]}</p>
                ) : null}
                <p className="tabular-nums">
                  {points[dataIndex] ?? 0} {valueNoun}
                </p>
              </div>
            ) : null}
          </>
        )}
      </div>
      <div className="flex justify-between gap-1 text-[12px] text-[#212121]">
        {labels.map(({ l, i }) => (
          <span key={`${fillId}-ax-${l}-${i}`} className="truncate">
            {l}
          </span>
        ))}
      </div>
    </div>
  );
}

function parseCsatPersonRows(raw: unknown): CsatPersonRow[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((row) => {
    if (!row || typeof row !== 'object') return [];
    const r = row as Record<string, unknown>;
    const name = String(r.name || '').trim();
    if (!name) return [];
    const ratings = Number(r.ratings);
    return [
      {
        name,
        ratings: Number.isFinite(ratings) ? ratings : 0,
        avgScore:
          r.avgScore == null || !Number.isFinite(Number(r.avgScore))
            ? null
            : Number(r.avgScore),
      },
    ];
  });
}

function parseCsatRole(raw: unknown, fallbackRows: CsatPersonRow[]): CsatRoleSummary {
  if (raw && typeof raw === 'object') {
    const r = raw as Record<string, unknown>;
    const ratings = Number(r.ratings);
    if (Number.isFinite(ratings)) {
      return {
        ratings,
        avgScore:
          r.avgScore == null || !Number.isFinite(Number(r.avgScore))
            ? null
            : Number(r.avgScore),
      };
    }
  }
  const ratings = fallbackRows.reduce((sum, row) => sum + row.ratings, 0);
  const weighted = fallbackRows.reduce(
    (sum, row) => sum + (row.avgScore == null ? 0 : row.avgScore * row.ratings),
    0
  );
  return {
    ratings,
    avgScore: ratings > 0 ? Number((weighted / ratings).toFixed(2)) : null,
  };
}

function parseCsatReport(raw: unknown): CsatReportPayload {
  const data = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const byAssignee = parseCsatPersonRows(data.byAgent ?? data.byAssignee);
  const byResolver = parseCsatPersonRows(data.byResolver);
  const num = (key: string) => {
    const n = Number(data[key]);
    return Number.isFinite(n) ? n : 0;
  };
  return {
    ratings: num('ratings'),
    avgScore:
      data.avgScore == null || !Number.isFinite(Number(data.avgScore))
        ? null
        : Number(data.avgScore),
    ratedResolved: num('ratedResolved'),
    lowScores: num('lowScores'),
    positive: num('positive'),
    neutral: num('neutral'),
    negative: num('negative') || num('lowScores'),
    byAssignee,
    byResolver,
    l1: parseCsatRole(data.l1, byAssignee.filter((row) => row.name !== 'Unassigned')),
    l2: parseCsatRole(data.l2, byResolver),
  };
}

function csatShare(count: number, total: number): string {
  if (total <= 0) return '—';
  return `${Math.round((count / total) * 100)}%`;
}

function CsatRoleColumn({
  title,
  hint,
  summary,
  rows,
  emptyLabel,
}: {
  title: string;
  hint: string;
  summary: CsatRoleSummary;
  rows: CsatPersonRow[];
  emptyLabel: string;
}) {
  return (
    <div className="min-w-0 rounded-xl border-[0.6px] border-[#bfbfbf] bg-neutral-50/80 p-3.5 shadow-none">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h4 className="text-sm font-bold text-neutral-900">{title}</h4>
          <p className="mt-0.5 text-sm text-neutral-500">{hint}</p>
        </div>
        <div className="shrink-0 text-right">
          <p className={`text-[22px] font-bold tabular-nums leading-none ${csatScoreTone(summary.avgScore)}`}>
            {formatCsatAvg(summary.avgScore)}
          </p>
          <p className="mt-1 text-sm tabular-nums text-neutral-500">
            {summary.ratings === 0
              ? 'No ratings'
              : `${summary.ratings} rating${summary.ratings === 1 ? '' : 's'}`}
          </p>
        </div>
      </div>
      {rows.length === 0 ? (
        <p className="mt-3 border-t border-[#e5e5e5] pt-3 text-sm text-neutral-400">{emptyLabel}</p>
      ) : (
        <ul className="mt-3 max-h-56 space-y-0 overflow-y-auto border-t border-[#e5e5e5] [scrollbar-width:thin]">
          {rows.map((row) => (
            <li
              key={row.name}
              className="grid grid-cols-[minmax(0,1fr)_5.75rem_3.25rem] items-center gap-2 border-b border-[#e5e5e5] py-2 last:border-b-0"
            >
              <span className="truncate text-sm font-medium text-neutral-800">{row.name}</span>
              <span className="text-right text-sm tabular-nums text-neutral-500">
                {row.ratings} {row.ratings === 1 ? 'review' : 'reviews'}
              </span>
              <span
                className={`text-right text-sm font-semibold tabular-nums ${csatScoreTone(row.avgScore)}`}
              >
                {row.avgScore == null || !Number.isFinite(row.avgScore)
                  ? '—'
                  : row.avgScore.toFixed(1)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function isoDateInZone(d: Date, timeZone: string) {
  const tz = timeZone && timeZone.trim() ? timeZone : 'UTC';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d);
  const y = parts.find((p) => p.type === 'year')?.value;
  const m = parts.find((p) => p.type === 'month')?.value;
  const day = parts.find((p) => p.type === 'day')?.value;
  return `${y}-${m}-${day}`;
}

function addDaysYmd(ymd: string, days: number) {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

function formatYmdLabel(ymd: string) {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
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
  kpis?: {
    openTickets: number;
    overdue: number;
    dueToday: number;
    unassigned: number;
    openChange?: string;
    overdueChange?: string;
    dueTodayChange?: string;
    priorityCounts: { low: number; medium: number; high: number; urgent: number };
    topQueues: Array<{ name: string; count: number }>;
  };
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
  Email: '#f59e0b',
  Chat: '#3b82f6',
  Webchat: '#2563eb',
  WhatsApp: '#22c55e',
  Instagram: '#ec4899',
  Facebook: '#3b82f6',
  Phone: '#8b5cf6',
  'Web Portal': '#3b82f6',
  Web: '#3b82f6',
};

const STATUS_BAR: Record<string, string> = {
  Open: 'bg-sky-500',
  Pending: 'bg-amber-500',
  'In Progress': 'bg-amber-500',
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

function MetricTile({
  label,
  value,
  hint,
  icon,
  iconWrap,
  footer,
  footerTone = 'neutral',
  onClick,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  icon: React.ReactNode;
  iconWrap: string;
  footer?: string;
  footerTone?: 'sky' | 'amber' | 'rose' | 'emerald' | 'neutral';
  onClick?: () => void;
}) {
  const footTone =
    footerTone === 'sky'
      ? 'text-sky-700'
      : footerTone === 'amber'
        ? 'text-amber-800'
        : footerTone === 'rose'
          ? 'text-rose-700'
          : footerTone === 'emerald'
            ? 'text-emerald-700'
            : 'text-neutral-500';
  const body = (
    <div className="rounded-xl border-[0.6px] border-[#bfbfbf] bg-white shadow-none overflow-hidden flex flex-col min-h-[108px] h-full">
      <div className="px-4 pt-3 pb-2 flex flex-col gap-1.5 flex-1 bg-white">
        <div className="flex items-start justify-between gap-2">
          <span className="text-sm font-semibold text-neutral-800">
            {label}
          </span>
          <span className={`inline-flex size-[38px] shrink-0 items-center justify-center rounded-xl ${iconWrap} [&_svg]:size-[18px]`}>
            {icon}
          </span>
        </div>
        <div className="mt-auto min-w-0">
          <div className="text-[22px] font-bold tabular-nums text-neutral-900 leading-none">
            {value}
          </div>
          {hint ? (
            <p className="text-sm text-neutral-500 mt-1 leading-snug truncate">{hint}</p>
          ) : null}
        </div>
      </div>
      {footer ? (
        <div className={`px-3 py-1.5 text-[11px] font-medium ${footTone}`}>{footer}</div>
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
    <div className="flex h-full min-h-[108px] flex-col gap-1.5 rounded-xl border-[0.6px] border-[#bfbfbf] bg-white px-4 pt-3 pb-3 shadow-none">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-semibold text-neutral-800">{label}</p>
        <span className={`inline-flex size-[38px] shrink-0 items-center justify-center rounded-xl ${iconWrap} [&_svg]:size-[18px]`}>
          {icon}
        </span>
      </div>
      <div className="mt-auto min-w-0">
        <p className="text-[22px] font-bold tabular-nums leading-none text-neutral-900">{value}</p>
        <p className="mt-1 truncate text-sm leading-snug text-neutral-500">{hint}</p>
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
  csatListRefreshToken = 0,
  externalCsatRange,
}: DashboardViewProps) {
  useSetPageTitle('Reports');
  const showAnalyticsLink =
    !!role && canAccessModule(role as AppRole, 'analytics');
  const [activities, setActivities] = useState<ActivityLog[]>([]);
  const [rangePreset, setRangePreset] = useState<RangePreset>('30d');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [customOpen, setCustomOpen] = useState(false);
  const customBtnRef = useRef<HTMLButtonElement>(null);
  const customPanelRef = useRef<HTMLDivElement>(null);
  const [customPanelPos, setCustomPanelPos] = useState<{ top: number; left: number } | null>(
    null
  );
  const [chart, setChart] = useState<ChartPayload>(emptyChart);
  const [chartLoading, setChartLoading] = useState(true);
  const [triage, setTriage] = useState<{
    createdByMe: number;
    assignedToMe: number;
    orgTickets: number;
    reassignedOut: number;
    openOnMyTeams: number;
  } | null>(null);
  const [unassignedCount, setUnassignedCount] = useState(0);
  const [rangeRefresh, setRangeRefresh] = useState(0);
  const [csatReport, setCsatReport] = useState<CsatReportPayload | null>(null);
  const [csatLoadError, setCsatLoadError] = useState(false);
  const [hoveredPriority, setHoveredPriority] = useState<
    (typeof PRIORITY_META)[number]['key'] | null
  >(null);
  const [hoveredChannel, setHoveredChannel] = useState<string | null>(null);
  const showCsatWidget =
    !!role && canAccessModule(role as AppRole, 'csat-reports');

  const rangeKpis = chart.kpis;
  const openCount = Number(rangeKpis?.openTickets ?? metrics.openTickets) || 0;
  const overdueCount = Number(rangeKpis?.overdue ?? metrics.overdue) || 0;
  const dueToday = Number(rangeKpis?.dueToday ?? metrics.dueToday) || 0;

  const priorityCounts = rangeKpis?.priorityCounts || metrics.priorityCounts || {
    low: 0,
    medium: 0,
    high: 0,
    urgent: 0,
  };
  const priorityTotal = PRIORITY_META.reduce((s, m) => s + (priorityCounts[m.key] || 0), 0) || 0;
  const hoveredPriorityMeta = PRIORITY_META.find((item) => item.key === hoveredPriority);
  const hoveredPriorityCount = hoveredPriority ? priorityCounts[hoveredPriority] : null;

  const topQueues = Array.isArray(rangeKpis?.topQueues)
    ? rangeKpis.topQueues
    : Array.isArray(metrics.topQueues)
      ? metrics.topQueues
      : [];
  const queueMax = Math.max(...topQueues.map((q) => q.count), 1);

  const suggestionChips =
    role === 'admin'
      ? ['my tickets', 'open tickets', 'create ticket', 'teams', 'analytics']
      : role === 'agent'
        ? ['my tickets', 'team inbox', 'unassigned', 'create ticket', 'teams']
        : ['my tickets', 'open tickets', 'knowledge base', 'settings'];

  const chartRange = presetToApiRange(rangePreset);
  const pickerDays = daysBetweenInclusive(customFrom, customTo);
  const customDays =
    rangePreset === 'custom' && customFrom && customTo ? pickerDays : 0;
  const customHours = customDays > 0 ? customDays * 24 : 0;

  const reportTz = displayTimezone && displayTimezone.trim() ? displayTimezone : 'UTC';
  const rangeWindow = (() => {
    const today = isoDateInZone(new Date(), reportTz);
    if (rangePreset === 'today') {
      return { from: today, to: today };
    }
    if (rangePreset === '7d') {
      return { from: addDaysYmd(today, -6), to: today };
    }
    if (rangePreset === 'custom' && customFrom && customTo) {
      return { from: customFrom, to: customTo };
    }
    return { from: addDaysYmd(today, -29), to: today };
  })();
  const rangeSubtitle = `${formatYmdLabel(rangeWindow.from)} – ${formatYmdLabel(rangeWindow.to)}`;

  const rangeFromIso = rangeWindow.from;
  const rangeToIso = rangeWindow.to;

  const rangeQuery = () => {
    const params = new URLSearchParams();
    if (rangePreset === 'custom' && customHours > 0) {
      params.set('range', 'custom');
      params.set('hours', String(customHours));
    } else {
      params.set('range', chartRange === 'custom' ? '30days' : chartRange);
    }
    params.set('from', rangeFromIso);
    params.set('to', rangeToIso);
    params.set('tz', reportTz);
    return params;
  };

  const fetchActivities = async () => {
    try {
      const res = await fetch(`/api/activities?${rangeQuery()}`, { credentials: 'include' });
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
      const res = await fetch(`/api/dashboard/chart?${rangeQuery()}`, {
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
    if (rangePreset === 'custom' && customHours <= 0) return;
    fetchActivities();
  }, [rangePreset, customHours, rangeFromIso, rangeToIso, rangeRefresh]);

  useEffect(() => {
    if (rangePreset === 'custom' && customHours <= 0) return;
    fetchChart();
  }, [rangePreset, customHours, rangeFromIso, rangeToIso, rangeRefresh]);

  useEffect(() => {
    if (!showCsatWidget) {
      setCsatReport(null);
      setCsatLoadError(false);
      return;
    }
    if (rangePreset === 'custom' && customHours <= 0) return;
    const range = presetToCsatRange(rangePreset, customDays, externalCsatRange);
    const params = rangeQuery();
    params.set('range', range);
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/csat-reports?${params}`, {
          credentials: 'include',
        });
        if (!res.ok) throw new Error('CSAT request failed');
        const data = parseCsatReport(await res.json());
        if (cancelled) return;
        setCsatLoadError(false);
        setCsatReport(data);
      } catch {
        if (!cancelled) {
          setCsatLoadError(true);
          setCsatReport(emptyCsatReport);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    showCsatWidget,
    rangePreset,
    customDays,
    customHours,
    rangeFromIso,
    rangeToIso,
    externalCsatRange,
    csatListRefreshToken,
    rangeRefresh,
  ]);

  useEffect(() => {
    if (!showTriageStats) {
      setTriage(null);
      return;
    }
    if (rangePreset === 'custom' && customHours <= 0) return;
    (async () => {
      try {
        const res = await fetch(`/api/agent/triage-stats?${rangeQuery()}`, {
          credentials: 'include',
        });
        if (res.ok) setTriage(await res.json());
        else setTriage(null);
      } catch {
        setTriage(null);
      }
    })();
  }, [showTriageStats, rangePreset, customHours, rangeFromIso, rangeToIso, rangeRefresh]);

  useEffect(() => {
    setUnassignedCount(
      Number(rangeKpis?.unassigned ?? metrics.unassigned) || 0
    );
  }, [rangeKpis?.unassigned, metrics.unassigned]);

  const applyCustomRange = () => {
    if (pickerDays <= 0 || pickerDays > 90) return;
    setRangePreset('custom');
    setCustomOpen(false);
  };

  useEffect(() => {
    if (!customOpen) {
      setCustomPanelPos(null);
      return;
    }
    const place = () => {
      const el = customBtnRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const width = 256;
      const left = Math.min(Math.max(8, r.right - width), window.innerWidth - width - 8);
      setCustomPanelPos({ top: r.bottom + 6, left });
    };
    place();
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (customBtnRef.current?.contains(t) || customPanelRef.current?.contains(t)) return;
      setCustomOpen(false);
    };
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    document.addEventListener('mousedown', onDoc);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
      document.removeEventListener('mousedown', onDoc);
    };
  }, [customOpen]);

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
  const hoveredChannelData = channels.find((channel) => channel.name === hoveredChannel);
  const statusMax = Math.max(...statusOutcomes.map((s) => s.count), 1);
  const resolutionRate =
    filedTotal > 0 ? Math.round((resolvedTotal / filedTotal) * 100) : 0;
  const stillOpenFromCreate = statusOutcomes
    .filter((s) => !['Resolved', 'Closed'].includes(s.name))
    .reduce((sum, s) => sum + s.count, 0);
  const createdYMax = niceMax(Math.max(...createdPoints, 1));
  const resolvedYMax = niceMax(Math.max(...resolvedPoints, 1));

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
    setRangeRefresh((n) => n + 1);
  };

  const openChange = changeFooter(
    rangeKpis?.openChange ?? metrics.openChange,
    'vs prior period'
  );
  const overdueChange = changeFooter(rangeKpis?.overdueChange ?? metrics.overdueChange);
  const dueChange = changeFooter(
    rangeKpis?.dueTodayChange ?? metrics.dueTodayChange,
    'vs prior period'
  );

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
  const donutSize = 156;
  const donutStroke = 22;
  const donutR = (donutSize - donutStroke) / 2;
  const donutC = 2 * Math.PI * donutR;
  const donutCx = donutSize / 2;
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
              className="inline-flex h-[38px] shrink-0 items-center gap-1.5 rounded-lg border-[0.6px] border-[#111111] bg-[#111111] px-3 text-sm font-semibold text-white hover:bg-neutral-800 shadow-none"
            >
              <LineChart className="size-[18px] stroke-[2.25]" />
              <span className="hidden @[360px]/content:inline">View Analytics</span>
            </button>
          ) : null}

          <div className="relative flex flex-wrap items-center gap-1.5">
            <SegmentTabs
              ariaLabel="Report range"
              value={(rangePreset === 'custom' ? '' : rangePreset) as 'today' | '7d' | '30d'}
              options={[
                { id: 'today', label: 'Today' },
                { id: '7d', label: '7D' },
                { id: '30d', label: '30D' },
              ]}
              onChange={(id) => selectPreset(id)}
            />
            <button
              ref={customBtnRef}
              type="button"
              onClick={() => selectPreset('custom')}
              className={`inline-flex h-[38px] items-center gap-1.5 rounded-lg border-[0.6px] px-3 text-sm font-medium shadow-none ${
                rangePreset === 'custom' || customOpen
                  ? 'border-[#171717] bg-[#171717] text-white'
                  : 'border-[#bfbfbf] bg-white text-neutral-600 hover:text-neutral-900'
              }`}
            >
              <Calendar className="size-[18px] stroke-[2.25]" />
              Custom
            </button>
            {customOpen && customPanelPos
              ? createPortal(
                  <div
                    ref={customPanelRef}
                    style={{
                      position: 'fixed',
                      top: customPanelPos.top,
                      left: customPanelPos.left,
                      width: 256,
                      zIndex: 80,
                    }}
                    className="space-y-2 rounded-xl border-[0.6px] border-[#bfbfbf] bg-white p-3 shadow-none"
                  >
                    <label className="block text-sm font-medium text-neutral-500">
                      From
                      <input
                        type="date"
                        value={customFrom}
                        onChange={(e) => setCustomFrom(e.target.value)}
                        className="mt-1 h-[38px] w-full rounded-lg border-[0.6px] border-[#bfbfbf] bg-neutral-50 px-2 text-sm text-neutral-800"
                      />
                    </label>
                    <label className="block text-sm font-medium text-neutral-500">
                      To
                      <input
                        type="date"
                        value={customTo}
                        onChange={(e) => setCustomTo(e.target.value)}
                        className="mt-1 h-[38px] w-full rounded-lg border-[0.6px] border-[#bfbfbf] bg-neutral-50 px-2 text-sm text-neutral-800"
                      />
                    </label>
                    <button
                      type="button"
                      disabled={pickerDays <= 0 || pickerDays > 90}
                      onClick={applyCustomRange}
                      className="h-[38px] w-full rounded-lg bg-black text-sm font-semibold text-white hover:bg-neutral-800 disabled:opacity-40"
                    >
                      Apply{pickerDays > 0 ? ` · ${pickerDays}d` : ''}
                    </button>
                  </div>,
                  document.body
                )
              : null}
          </div>

          <button
            type="button"
            title="Refresh"
            onClick={refreshAll}
            className="inline-flex size-[38px] items-center justify-center rounded-lg border-[0.6px] border-[#bfbfbf] bg-white text-neutral-700 hover:bg-neutral-50 shadow-none"
          >
            <RefreshCw className={`size-[18px] stroke-[2.25] ${chartLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      }
    >
      <div className="p-4 sm:p-5 space-y-4 pb-8">
        {showTriageStats && triage && (
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
            <TriageTile
              label="My tickets"
              value={Number(triage.assignedToMe) || 0}
              hint={
                role === 'resolver'
                  ? 'Tickets on you as resolver'
                  : role === 'admin'
                    ? 'Tickets on you as agent or resolver'
                    : 'Tickets assigned to you'
              }
              icon={<UserCheck className="text-indigo-600" />}
              iconWrap="bg-indigo-100"
              onClick={() => onNavigate('assigned')}
            />
            <TriageTile
              label="Created by me"
              value={Number(triage.createdByMe) || 0}
              hint="Tickets you filed"
              icon={<FileText className="text-sky-600" />}
              iconWrap="bg-sky-50"
            />
            <TriageTile
              label="Total tickets"
              value={Number(triage.orgTickets) || 0}
              hint="Created in this org"
              icon={<Ticket className="text-blue-600" />}
              iconWrap="bg-blue-100"
              onClick={() => onNavigate('tickets-list')}
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
            <TriageTile
              label="Unassigned"
              value={unassignedCount}
              hint="No agent or resolver"
              icon={<User className="text-amber-600" />}
              iconWrap="bg-amber-100"
              onClick={() =>
                onNavigate(
                  role === 'agent' || role === 'admin' ? 'unassigned' : 'tickets-list'
                )
              }
            />
          </div>
        )}

        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
          <MetricTile
            label="Pending tickets"
            value={openCount}
            hint="Active in queues"
            icon={<Flame className="text-sky-600" />}
            iconWrap="bg-sky-100"
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
            footer={overdueChange.text}
            footerTone="rose"
          />
          <MetricTile
            label="Due today"
            value={dueToday}
            hint="Due within today"
            icon={<CheckCircle2 className="text-emerald-600" />}
            iconWrap="bg-emerald-100"
            footer={dueChange.text}
            footerTone="emerald"
          />
        </div>

        {showCsatWidget ? (
          <section className="rounded-xl border-[0.6px] border-[#bfbfbf] bg-white p-4 shadow-none">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2.5">
                  <span className="inline-flex size-[38px] shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-600 [&_svg]:size-[18px]">
                    <Smile strokeWidth={2.25} />
                  </span>
                  <div className="min-w-0">
                    <h3 className="text-sm font-bold text-neutral-900">Customer satisfaction</h3>
                    <p className="mt-0.5 text-sm text-neutral-500">
                      Ratings on tickets attended by L1 agents and L2 resolvers
                    </p>
                  </div>
                </div>
              </div>
              <div className="shrink-0 text-right">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-400">
                  Overall CSAT
                </p>
                <p
                  className={`mt-1 text-[22px] font-bold tabular-nums leading-none ${csatScoreTone(
                    csatReport?.avgScore
                  )}`}
                >
                  {formatCsatAvg(csatReport?.avgScore)}
                </p>
                <p className="mt-1 text-sm text-neutral-500">
                  {csatReport == null
                    ? 'Loading…'
                    : csatLoadError
                      ? 'Ratings unavailable'
                      : csatReport.ratings === 0
                        ? 'No ratings in this range'
                        : `${csatReport.ratings} rating${csatReport.ratings === 1 ? '' : 's'}`}
                </p>
              </div>
            </div>

            <div className="mt-4 grid min-w-0 grid-cols-1 gap-2 @[280px]:grid-cols-2 @[640px]:grid-cols-4">
              {(
                [
                  {
                    label: 'Positive (4–5)',
                    value:
                      csatReport && csatReport.ratings > 0
                        ? csatShare(csatReport.positive, csatReport.ratings)
                        : '—',
                    hint:
                      csatReport && csatReport.ratings > 0
                        ? `${csatReport.positive} review${csatReport.positive === 1 ? '' : 's'}`
                        : 'No ratings yet',
                    tone: 'text-emerald-700',
                  },
                  {
                    label: 'Neutral (3)',
                    value:
                      csatReport && csatReport.ratings > 0
                        ? csatShare(csatReport.neutral, csatReport.ratings)
                        : '—',
                    hint:
                      csatReport && csatReport.ratings > 0
                        ? `${csatReport.neutral} review${csatReport.neutral === 1 ? '' : 's'}`
                        : 'No ratings yet',
                    tone: 'text-amber-800',
                  },
                  {
                    label: 'Negative (1–2)',
                    value:
                      csatReport && csatReport.ratings > 0
                        ? csatShare(csatReport.negative, csatReport.ratings)
                        : '—',
                    hint:
                      csatReport && csatReport.ratings > 0
                        ? `${csatReport.negative} review${csatReport.negative === 1 ? '' : 's'}`
                        : 'No ratings yet',
                    tone: 'text-rose-700',
                  },
                  {
                    label: 'Rated resolved',
                    value: formatCsatCount(csatReport?.ratedResolved),
                    hint:
                      csatReport && csatReport.ratings > 0
                        ? `of ${csatReport.ratings} rating${csatReport.ratings === 1 ? '' : 's'}`
                        : 'No ratings yet',
                    tone: 'text-sky-700',
                  },
                ] as const
              ).map((tile) => (
                <div
                  key={tile.label}
                  className="min-w-0 rounded-xl border-[0.6px] border-[#bfbfbf] bg-neutral-50/80 px-3 py-2.5 shadow-none"
                >
                  <p className="truncate text-[11px] font-semibold uppercase tracking-wide text-neutral-400">
                    {tile.label}
                  </p>
                  <p className={`mt-1 text-[22px] font-bold tabular-nums leading-none ${tile.tone}`}>
                    {tile.value}
                  </p>
                  <p className="mt-1 truncate text-sm text-neutral-500">{tile.hint}</p>
                </div>
              ))}
            </div>

            <div className="mt-4 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              <CsatRoleColumn
                title="L1 · Agent"
                hint="Tickets attended by assignee"
                summary={csatReport?.l1 ?? emptyCsatReport.l1}
                rows={csatReport?.byAssignee ?? []}
                emptyLabel="No L1 ratings in this range"
              />
              <CsatRoleColumn
                title="L2 · Resolver"
                hint="Tickets attended by resolver"
                summary={csatReport?.l2 ?? emptyCsatReport.l2}
                rows={csatReport?.byResolver ?? []}
                emptyLabel="No L2 ratings in this range"
              />
            </div>
          </section>
        ) : null}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          <div className="rounded-xl border-[0.6px] border-[#bfbfbf] bg-white p-3.5 shadow-none">
            <div className="flex items-center justify-between gap-2 mb-2">
              <div>
                <h3 className="text-sm font-bold capitalize text-neutral-900">Priority breakdown</h3>
                <p className="mt-0.5 text-sm text-neutral-500">
                  Open work created in this range — who to tackle first
                </p>
              </div>
              <span className="text-sm tabular-nums text-neutral-400">{openCount} open</span>
            </div>
            <div className="flex items-center gap-3">
              <div
                className="relative size-[156px] shrink-0"
                onMouseLeave={() => setHoveredPriority(null)}
              >
                <svg
                  viewBox={`0 0 ${donutSize} ${donutSize}`}
                  className="h-full w-full -rotate-90 overflow-visible"
                >
                  <circle
                    cx={donutCx}
                    cy={donutCx}
                    r={donutR}
                    fill="none"
                    stroke="#f5f5f5"
                    strokeWidth={donutStroke}
                  />
                  {PRIORITY_META.map((m) => {
                    const count = priorityCounts[m.key];
                    const len = priorityTotal > 0 ? (count / priorityTotal) * donutC : 0;
                    const dash = `${len} ${donutC - len}`;
                    const el = (
                      <circle
                        key={m.key}
                        cx={donutCx}
                        cy={donutCx}
                        r={donutR}
                        fill="none"
                        stroke={m.color}
                        strokeWidth={hoveredPriority === m.key ? donutStroke + 4 : donutStroke}
                        strokeDasharray={dash}
                        strokeDashoffset={-donutOffset}
                        strokeLinecap="butt"
                        opacity={
                          hoveredPriority == null || hoveredPriority === m.key ? 1 : 0.28
                        }
                        onMouseEnter={() => count > 0 && setHoveredPriority(m.key)}
                        className={count > 0 ? 'cursor-pointer transition-all duration-200' : ''}
                        style={{ transformOrigin: 'center' }}
                      >
                        <title>
                          {m.label}: {count} ({priorityTotal > 0 ? Math.round((count / priorityTotal) * 100) : 0}%)
                        </title>
                      </circle>
                    );
                    donutOffset += len;
                    return el;
                  })}
                </svg>
                <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center rotate-0">
                  <span className="text-[22px] font-bold tabular-nums leading-none text-neutral-900">
                    {hoveredPriorityCount ?? openCount}
                  </span>
                  <span className="mt-0.5 text-sm text-neutral-500">
                    {hoveredPriorityMeta?.label ?? 'total'}
                  </span>
                </div>
                {hoveredPriorityMeta && hoveredPriorityCount != null ? (
                  <div className="pointer-events-none absolute left-1/2 top-2 z-10 -translate-x-1/2 rounded-lg bg-[#171717] px-2 py-1 text-[12px] leading-snug text-white shadow-none">
                    <p className="font-semibold">{hoveredPriorityMeta.label}</p>
                    <p className="tabular-nums">
                      {hoveredPriorityCount} (
                      {priorityTotal > 0
                        ? Math.round((hoveredPriorityCount / priorityTotal) * 100)
                        : 0}
                      %)
                    </p>
                  </div>
                ) : null}
              </div>
              <ul className="min-w-0 flex-1 space-y-2">
                {PRIORITY_META.map((m) => {
                  const count = priorityCounts[m.key];
                  const pct = priorityTotal > 0 ? Math.round((count / priorityTotal) * 100) : 0;
                  return (
                    <li key={m.key} className="flex items-center gap-2 text-sm">
                      <span
                        className="size-2.5 shrink-0 rounded-full"
                        style={{ background: m.color }}
                      />
                      <span className="flex-1 truncate text-neutral-900">{m.label}</span>
                      <span className="font-semibold tabular-nums text-neutral-900">
                        {count} ({pct}%)
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>

          <div className="rounded-xl border-[0.6px] border-[#bfbfbf] bg-white p-3.5 shadow-none">
            <div className="flex items-center justify-between gap-2 mb-2">
              <div>
                <h3 className="text-sm font-bold capitalize text-neutral-900">Channel breakdown</h3>
                <p className="mt-0.5 text-sm text-neutral-500">
                  Where tickets were created · {rangeLabel}
                </p>
              </div>
              <span className="text-sm tabular-nums text-neutral-400">
                {channelTotal} created
              </span>
            </div>
            {channels.length === 0 ? (
              <p className="py-8 text-center text-sm text-neutral-400">
                No tickets created in this range
              </p>
            ) : (
              <div className="flex items-center gap-4">
                <div
                  className="relative size-[156px] shrink-0"
                  onMouseLeave={() => setHoveredChannel(null)}
                >
                  <svg
                    viewBox={`0 0 ${donutSize} ${donutSize}`}
                    className="h-full w-full -rotate-90 overflow-visible"
                  >
                    <circle
                      cx={donutCx}
                      cy={donutCx}
                      r={donutR}
                      fill="none"
                      stroke="#f5f5f5"
                      strokeWidth={donutStroke}
                    />
                    {channels.map((ch) => {
                      const len =
                        channelTotal > 0 ? (ch.count / channelTotal) * donutC : 0;
                      const dash = `${len} ${donutC - len}`;
                      const color = CHANNEL_DONUT[ch.name] || '#3b82f6';
                      const el = (
                        <circle
                          key={ch.name}
                          cx={donutCx}
                          cy={donutCx}
                          r={donutR}
                          fill="none"
                          stroke={color}
                          strokeWidth={hoveredChannel === ch.name ? donutStroke + 4 : donutStroke}
                          strokeDasharray={dash}
                          strokeDashoffset={-channelDonutOffset}
                          strokeLinecap="butt"
                          opacity={
                            hoveredChannel == null || hoveredChannel === ch.name ? 1 : 0.28
                          }
                          onMouseEnter={() => ch.count > 0 && setHoveredChannel(ch.name)}
                          className={ch.count > 0 ? 'cursor-pointer transition-all duration-200' : ''}
                          style={{ transformOrigin: 'center' }}
                        >
                          <title>
                            {ch.name}: {ch.count} ({ch.pct}%)
                          </title>
                        </circle>
                      );
                      channelDonutOffset += len;
                      return el;
                    })}
                  </svg>
                  <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center rotate-0">
                    <span className="text-[22px] font-bold tabular-nums leading-none text-neutral-900">
                      {hoveredChannelData?.count ?? channelTotal}
                    </span>
                    <span className="mt-0.5 max-w-[104px] truncate text-sm text-neutral-500">
                      {hoveredChannelData?.name ?? 'created'}
                    </span>
                  </div>
                  {hoveredChannelData ? (
                    <div className="pointer-events-none absolute left-1/2 top-2 z-10 -translate-x-1/2 rounded-lg bg-[#171717] px-2 py-1 text-[12px] leading-snug text-white shadow-none">
                      <p className="font-semibold">{hoveredChannelData.name}</p>
                      <p className="tabular-nums">
                        {hoveredChannelData.count} ({hoveredChannelData.pct}%)
                      </p>
                    </div>
                  ) : null}
                </div>
                <ul className="min-w-0 flex-1 space-y-2">
                  {channels.map((ch) => (
                    <li key={ch.name} className="flex items-center gap-2 text-sm">
                      <span
                        className="size-2.5 shrink-0 rounded-full"
                        style={{ background: CHANNEL_DONUT[ch.name] || '#3b82f6' }}
                      />
                      <span className="flex-1 truncate text-neutral-900">{ch.name}</span>
                      <span className="font-semibold tabular-nums text-neutral-900">
                        {ch.count} ({ch.pct}%)
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>

        <div className="rounded-xl border-[0.6px] border-[#bfbfbf] bg-white p-3.5 shadow-none space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <User className="h-3.5 w-3.5 text-neutral-400 shrink-0" />
              <h3 className="text-sm font-bold capitalize text-neutral-900 truncate">
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

        <div className="rounded-xl border-[0.6px] border-[#bfbfbf] bg-white p-3.5 shadow-none space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <TrendingUp className="h-3.5 w-3.5 text-sky-500" />
                <h3 className="text-sm font-bold capitalize text-neutral-900">Volume & outcomes</h3>
              </div>
              <p className="text-[11px] text-neutral-500 mt-0.5">
                {rangeSubtitle} · {rangeLabel}
              </p>
            </div>
          </div>

          <div className="grid min-w-0 grid-cols-1 gap-2 @[280px]:grid-cols-2 @[640px]:grid-cols-4">
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
            <VolumeTrendChart
              title="Tickets created"
              subtitle="Volume over time"
              total={filedTotal}
              points={createdPoints}
              yMax={createdYMax}
              labels={axisLabels}
              pointLabels={chart.labels}
              valueNoun="tickets"
              emptyLabel="No tickets created in this range"
              loading={chartLoading}
              stroke="#3b82f6"
              fillId="dashCreatedFill"
              fillColor="#bfdbfe"
              valueClass="text-sky-600"
            />
            <VolumeTrendChart
              title="Tickets resolved"
              subtitle="Closures over time"
              total={resolvedTotal}
              points={resolvedPoints}
              yMax={resolvedYMax}
              labels={axisLabels}
              pointLabels={chart.labels}
              valueNoun="tickets"
              emptyLabel="No resolutions in this range"
              loading={chartLoading}
              stroke="#059669"
              fillId="dashResolvedFill"
              fillColor="#bbf7d0"
              valueClass="text-emerald-600"
            />
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
                  <p className="text-[10px] text-sky-700/80">Filed in range</p>
                  <p className="font-semibold tabular-nums text-sky-800">{filedTotal}</p>
                </div>
                <div className="rounded-md bg-amber-50 px-2 py-1.5">
                  <p className="text-[10px] text-amber-800/80">Open from this range</p>
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
          <div className="rounded-xl border-[0.6px] border-[#bfbfbf] bg-white p-3.5 shadow-none flex flex-col min-h-[200px] max-h-[320px]">
            <div className="flex items-center justify-between gap-2 mb-2 shrink-0">
              <div className="flex items-center gap-2">
                <Activity className="h-3.5 w-3.5 text-neutral-400" />
                <h3 className="text-sm font-bold capitalize text-neutral-900">Recent activity</h3>
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
                <div className="space-y-0 divide-y divide-[#e5e5e5] min-w-0">
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

          <div className="rounded-xl border-[0.6px] border-[#bfbfbf] bg-white p-3.5 shadow-none flex flex-col min-h-[200px]">
            <div className="flex items-center justify-between gap-2 mb-3">
              <h3 className="text-sm font-bold capitalize text-neutral-900">Top queues</h3>
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
