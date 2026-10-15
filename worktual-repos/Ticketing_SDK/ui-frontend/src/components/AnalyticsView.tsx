import React, { useMemo, useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  TrendingUp,
  Clock,
  CheckCircle,
  Smile,
  RefreshCw,
  Download,
  Activity,
  LineChart,
  Lightbulb,
  Calendar,
  ArrowRight,
} from 'lucide-react';
import type { AnalyticsAgentRow, AnalyticsInsights, AnalyticsPayload } from '../types';
import { useSetPageTitle } from './layout/PageTitleContext';
import PageShell from './layout/PageShell';
import AnalyticsKpiCard from './ui/analytics-kpi-card';
import SegmentTabs from './ui/segment-tabs';

const CHART_PIE_SERIES = ['#3b82f6', '#f59e0b', '#8b5cf6', '#ec4899', '#1877f2'];
const CHART_CARD =
  'rounded-xl border-[0.6px] border-[#bfbfbf] bg-white p-4 shadow-none space-y-3';

function ChartHeading({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div>
      <h3 className="text-sm font-bold capitalize text-neutral-900">{title}</h3>
      {subtitle ? <p className="mt-0.5 text-sm text-neutral-500">{subtitle}</p> : null}
    </div>
  );
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

function ChartHoverTip({
  xPct,
  yPct,
  title,
  value,
}: {
  xPct: number;
  yPct: number;
  title: string;
  value: string;
}) {
  const shift =
    xPct < 18 ? 'translate-x-0' : xPct > 82 ? '-translate-x-full' : '-translate-x-1/2';
  return (
    <div
      className={`pointer-events-none absolute z-10 -translate-y-full ${shift} rounded-lg bg-[#171717] px-2 py-1 text-[12px] leading-snug text-white shadow-none`}
      style={{ left: `${xPct}%`, top: `${yPct}%`, marginTop: -10 }}
    >
      {title ? <p className="font-semibold">{title}</p> : null}
      <p className="tabular-nums">{value}</p>
    </div>
  );
}

function ChannelDonut({
  channels,
}: {
  channels: Array<{ name: string; percentage: string; count: string }>;
}) {
  const size = 156;
  const stroke = 22;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const cx = size / 2;
  const [hovered, setHovered] = useState<number | null>(null);
  let offset = 0;
  const active = hovered != null ? channels[hovered] : null;
  const activePct = active
    ? String(active.percentage).includes('%')
      ? active.percentage
      : `${active.percentage}%`
    : '';
  return (
    <div className="flex min-w-[347px] flex-col items-center gap-4 sm:flex-row">
      <div className="relative size-[156px] shrink-0" onMouseLeave={() => setHovered(null)}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="h-full w-full -rotate-90 overflow-visible">
          <circle cx={cx} cy={cx} r={r} fill="none" stroke="#f5f5f5" strokeWidth={stroke} />
          {channels.map((chan, idx) => {
            const pct = Number(String(chan.percentage).replace('%', '').trim());
            const len = ((Number.isFinite(pct) ? pct : 0) / 100) * c;
            const dash = `${len} ${c - len}`;
            const el = (
              <circle
                key={`${chan.name}-${idx}`}
                cx={cx}
                cy={cx}
                r={r}
                fill="none"
                stroke={CHART_PIE_SERIES[idx % CHART_PIE_SERIES.length]}
                strokeWidth={hovered === idx ? stroke + 4 : stroke}
                strokeDasharray={dash}
                strokeDashoffset={-offset}
                opacity={hovered == null || hovered === idx ? 1 : 0.28}
                className="cursor-pointer transition-all duration-200"
                onMouseEnter={() => setHovered(idx)}
              />
            );
            offset += len;
            return el;
          })}
        </svg>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-[22px] font-bold tabular-nums leading-none text-neutral-900">
            {active?.count ?? channels.reduce((sum, chan) => sum + (Number(chan.count) || 0), 0)}
          </span>
          <span className="mt-0.5 max-w-[104px] truncate text-sm text-neutral-500">
            {active?.name ?? 'total'}
          </span>
        </div>
        {active ? (
          <div className="pointer-events-none absolute left-1/2 top-2 z-10 -translate-x-1/2 rounded-lg bg-[#171717] px-2 py-1 text-[12px] leading-snug text-white shadow-none">
            <p className="font-semibold">{active.name}</p>
            <p className="tabular-nums">
              {active.count} ({activePct})
            </p>
          </div>
        ) : null}
      </div>
      <ul className="min-w-0 w-full flex-1 space-y-2">
        {channels.map((chan, idx) => {
          const pct = String(chan.percentage).includes('%')
            ? chan.percentage
            : `${chan.percentage}%`;
          return (
            <li
              key={`${chan.name}-${idx}`}
              className={`flex items-center gap-2 text-sm ${
                hovered == null || hovered === idx ? 'opacity-100' : 'opacity-40'
              }`}
              onMouseEnter={() => setHovered(idx)}
              onMouseLeave={() => setHovered(null)}
            >
              <span
                className="size-2.5 shrink-0 rounded-full"
                style={{ background: CHART_PIE_SERIES[idx % CHART_PIE_SERIES.length] }}
              />
              <span className="flex-1 truncate text-neutral-900">{chan.name}</span>
              <span className="shrink-0 font-semibold tabular-nums text-neutral-900">
                {chan.count} ({pct})
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function AnalyticsVolumeChart({
  points,
  labels,
  yMax,
}: {
  points: number[];
  labels: string[];
  yMax: number;
}) {
  const chartWidth = 500;
  const chartHeight = 160;
  const [hover, setHover] = useState<number | null>(null);
  const volumeCoords = (() => {
    if (!points.length) return [{ x: 0, y: chartHeight }];
    if (points.length === 1) {
      const y = chartHeight - (Math.min(points[0], yMax) / yMax) * chartHeight;
      return [
        { x: 0, y },
        { x: chartWidth, y },
      ];
    }
    const step = chartWidth / (points.length - 1);
    return points.map((p, index) => ({
      x: index * step,
      y: chartHeight - (Math.min(p, yMax) / yMax) * chartHeight,
    }));
  })();
  const volumeLine = catmullRomPath(volumeCoords);
  const volumeArea = volumeLine
    ? `${volumeLine} L ${chartWidth},${chartHeight} L 0,${chartHeight} Z`
    : '';
  const dataIndex =
    hover == null
      ? null
      : points.length <= 1
        ? 0
        : Math.min(hover, points.length - 1);
  const hoverPt = hover != null ? volumeCoords[hover] : null;

  return (
    <>
      <div className="relative h-[200px] w-full pl-8">
        <div className="absolute left-0 top-0 flex h-full w-7 select-none flex-col justify-between text-right text-[12px] text-[#212121]">
          <span>{yMax}</span>
          <span>{Math.round(yMax / 2)}</span>
          <span>0</span>
        </div>
        <div className="relative h-full w-full">
        <svg
          viewBox={`0 0 ${chartWidth} ${chartHeight}`}
          className="h-full w-full overflow-visible"
          preserveAspectRatio="none"
          onMouseMove={(e) =>
            setHover(nearestChartIndex(e.clientX, e.currentTarget, volumeCoords, chartWidth))
          }
          onMouseLeave={() => setHover(null)}
        >
          <defs>
            <linearGradient id="analyticsVolumeFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#bfdbfe" stopOpacity="0.9" />
              <stop offset="100%" stopColor="#bfdbfe" stopOpacity="0" />
            </linearGradient>
          </defs>
          <line
            x1="0"
            y1={chartHeight * 0.5}
            x2={chartWidth}
            y2={chartHeight * 0.5}
            stroke="#858f96"
            strokeWidth="1"
            strokeDasharray="4 4"
          />
          <line
            x1="0"
            y1={chartHeight}
            x2={chartWidth}
            y2={chartHeight}
            stroke="#909090"
            strokeWidth="0.6"
          />
          <path d={volumeArea} fill="url(#analyticsVolumeFill)" />
          <path
            d={volumeLine}
            fill="none"
            stroke="#3b82f6"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          {hoverPt ? (
            <>
              <line
                x1={hoverPt.x}
                y1={0}
                x2={hoverPt.x}
                y2={chartHeight}
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
                stroke="#3b82f6"
                strokeWidth="2"
                vectorEffect="non-scaling-stroke"
              />
            </>
          ) : null}
          <rect
            x="0"
            y="0"
            width={chartWidth}
            height={chartHeight}
            fill="transparent"
            className="cursor-crosshair"
          />
        </svg>
        {hoverPt && dataIndex != null ? (
          <ChartHoverTip
            xPct={(hoverPt.x / chartWidth) * 100}
            yPct={(hoverPt.y / chartHeight) * 100}
            title={labels[dataIndex] || ''}
            value={`${points[dataIndex] ?? 0} tickets`}
          />
        ) : null}
        </div>
      </div>
      <div className="flex justify-between gap-1 border-t border-neutral-200 pt-2 text-[12px] text-[#212121]">
        {labels.map((lbl, idx) => (
          <span key={`${lbl}-${idx}`} className="truncate">
            {lbl}
          </span>
        ))}
      </div>
    </>
  );
}

type RangePreset = 'today' | '7d' | '30d' | 'custom';
type ApiRange = '24hours' | '7days' | '30days' | 'custom';
type AgentSort = 'overdue' | 'assigned';

function presetToApiRange(preset: RangePreset): ApiRange {
  if (preset === 'today') return '24hours';
  if (preset === '7d') return '7days';
  if (preset === '30d') return '30days';
  return 'custom';
}

function isoLocalDate(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function daysBetweenInclusive(fromIso: string, toIso: string) {
  const from = new Date(`${fromIso}T00:00:00`);
  const to = new Date(`${toIso}T23:59:59`);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to < from) {
    return 0;
  }
  return Math.max(1, Math.ceil((to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000)));
}

const emptyInsights: AnalyticsInsights = {
  diagnostic: {
    status: 'stable',
    headline: 'No major anomaly in this range',
    summary: 'Open, overdue, and SLA signals look stable versus the selected range.',
    deltaLabel: 'Volume flat vs earlier days',
    factors: [],
    evidence: [],
  },
  predictive: {
    volumeForecast: [],
    avgDailyCreated: 0,
    resolvedSample: [],
    riskSignals: [],
  },
  prescriptive: {
    banner:
      'Recommendations use live ticket and SLA signals. Ask the co-worker to explore alternatives.',
    actions: [],
  },
};

const emptyAnalytics: AnalyticsPayload = {
  totalTickets: '0',
  totalTicketsChange: '—',
  totalTicketsUp: true,
  resolvedTickets: '0',
  resolvedTicketsChange: '—',
  resolvedTicketsUp: true,
  firstResponse: '—',
  firstResponseChange: '—',
  firstResponseUp: false,
  resolutionTime: '—',
  resolutionTimeChange: '—',
  resolutionTimeUp: false,
  csat: '—',
  csatChange: '—',
  csatUp: true,
  csatRatings: 0,
  weeklyPoints: [0],
  weeklyLabels: ['—'],
  channels: [],
  totalChannelsText: 'No channel data yet',
  agentPerformance: [],
  slaReport: {
    breached: 0,
    openOverdue: 0,
    breachRate: '0%',
    recent: [],
  },
  insights: emptyInsights,
};

export default function AnalyticsView({
  embedded = false,
  listRefreshToken = 0,
  externalRange,
  onNavigate,
}: {
  embedded?: boolean;
  listRefreshToken?: number;
  /** Chat date preset — same picker the UI uses (24hours | 7days | 30days). */
  externalRange?: string;
  onNavigate?: (view: string, opts?: { ticketSearch?: string }) => void;
}) {
  useSetPageTitle('Analytics');
  const [rangePreset, setRangePreset] = useState<RangePreset>('7d');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [customOpen, setCustomOpen] = useState(false);
  const [customHours, setCustomHours] = useState(0);
  const customBtnRef = useRef<HTMLButtonElement>(null);
  const customPanelRef = useRef<HTMLDivElement>(null);
  const [customPanelPos, setCustomPanelPos] = useState<{ top: number; left: number } | null>(
    null
  );
  const [agentSort, setAgentSort] = useState<AgentSort>('overdue');
  const [current, setCurrent] = useState<AnalyticsPayload>(emptyAnalytics);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);

  const apiRange = presetToApiRange(rangePreset);
  const customDays = daysBetweenInclusive(customFrom, customTo);

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
      from.setDate(from.getDate() - 6);
      from.setHours(0, 0, 0, 0);
    }
    return { from, to };
  })();

  const buildQuery = () => {
    const params = new URLSearchParams();
    if (rangePreset === 'custom' && customHours > 0) {
      params.set('range', 'custom');
      params.set('hours', String(customHours));
    } else {
      params.set('range', apiRange === 'custom' ? '7days' : apiRange);
    }
    params.set('from', isoLocalDate(rangeWindow.from));
    params.set('to', isoLocalDate(rangeWindow.to));
    return params.toString();
  };

  const loadAnalytics = async () => {
    if (rangePreset === 'custom' && customHours <= 0) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/analytics?${buildQuery()}`, { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setCurrent({
          ...emptyAnalytics,
          ...data,
          agentPerformance: data.agentPerformance || [],
          slaReport: data.slaReport || emptyAnalytics.slaReport,
          csatRatings: data.csatRatings ?? 0,
          insights: data.insights
            ? {
                ...emptyInsights,
                ...data.insights,
                diagnostic: {
                  ...emptyInsights.diagnostic,
                  ...(data.insights.diagnostic || {}),
                  factors: data.insights.diagnostic?.factors || [],
                  evidence: data.insights.diagnostic?.evidence || [],
                },
                predictive: {
                  ...emptyInsights.predictive,
                  ...(data.insights.predictive || {}),
                  volumeForecast: data.insights.predictive?.volumeForecast || [],
                  resolvedSample: data.insights.predictive?.resolvedSample || [],
                  riskSignals: data.insights.predictive?.riskSignals || [],
                },
                prescriptive: {
                  ...emptyInsights.prescriptive,
                  ...(data.insights.prescriptive || {}),
                  actions: data.insights.prescriptive?.actions || [],
                },
              }
            : emptyInsights,
        });
      }
    } catch (err) {
      console.error('Failed to load analytics', err);
    } finally {
      setLoading(false);
    }
  };

  const handleExport = async () => {
    if (rangePreset === 'custom' && customHours <= 0) return;
    setExporting(true);
    try {
      const res = await fetch(`/api/analytics/export?${buildQuery()}`, {
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Export failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `worktual-analytics-${apiRange}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Failed to export analytics', err);
    } finally {
      setExporting(false);
    }
  };

  const selectPreset = (preset: RangePreset) => {
    if (preset === 'custom') {
      setCustomOpen((o) => !o);
      if (!customFrom || !customTo) {
        const to = new Date();
        const from = new Date();
        from.setDate(to.getDate() - 6);
        setCustomFrom(from.toISOString().slice(0, 10));
        setCustomTo(to.toISOString().slice(0, 10));
      }
      return;
    }
    setCustomOpen(false);
    setCustomHours(0);
    setRangePreset(preset);
  };

  const applyCustomRange = () => {
    if (customDays <= 0 || customDays > 90) return;
    setCustomHours(customDays * 24);
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

  const openTicketSearch = (search: string) => {
    const q = String(search || '').trim();
    if (!q || !onNavigate) return;
    onNavigate('tickets-list', { ticketSearch: q });
  };

  const openModule = (view: string) => {
    if (!onNavigate || !view) return;
    onNavigate(view);
  };

  useEffect(() => {
    const r = String(externalRange || '').trim();
    if (r === '24hours') setRangePreset('today');
    else if (r === '7days') setRangePreset('7d');
    else if (r === '30days') setRangePreset('30d');
  }, [externalRange]);

  useEffect(() => {
    void loadAnalytics();
  }, [rangePreset, customHours, isoLocalDate(rangeWindow.from), isoLocalDate(rangeWindow.to)]);

  useEffect(() => {
    if (!listRefreshToken) return;
    void loadAnalytics();
  }, [listRefreshToken]);

  const sortedAgents = useMemo(() => {
    const rows = [...(current.agentPerformance || [])];
    if (agentSort === 'overdue') {
      rows.sort((a, b) => b.overdue - a.overdue || b.assigned - a.assigned);
    } else {
      rows.sort((a, b) => b.assigned - a.assigned || b.overdue - a.overdue);
    }
    return rows;
  }, [current.agentPerformance, agentSort]);

  const hasVolumeData = (current.weeklyPoints || []).some((p) => Number(p) > 0);
  const csatChangeLabel =
    current.csatRatings > 0
      ? `${current.csatChange} · n=${current.csatRatings}`
      : 'No CSAT ratings in this range';

  const volumePoints = (current.weeklyPoints || []).map((p) => Math.max(0, Number(p) || 0));
  const rawMax = Math.max(0, ...volumePoints);
  const yMax = rawMax <= 0 ? 4 : Math.max(4, Math.ceil(rawMax * 1.15));

  const rangeHint =
    rangePreset === 'today'
      ? 'Today'
      : rangePreset === '7d'
        ? '7D'
        : rangePreset === '30d'
          ? '30D'
          : customDays > 0
            ? `${customDays}d`
            : 'Custom';

  return (
    <PageShell
      id="analytics-view-container"
      embedded={embedded}
      actions={
        <div className="flex w-full flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-neutral-500 leading-snug">
            Live KPIs from tickets · click rows to open work · {rangeHint}
            {rangePreset === 'custom' && customFrom && customTo
              ? ` · ${customFrom} – ${customTo}`
              : ''}
          </p>
          <div className="relative flex shrink-0 flex-wrap items-center justify-end gap-1.5">
            <SegmentTabs
              ariaLabel="Analytics range"
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
                      disabled={customDays <= 0 || customDays > 90}
                      onClick={applyCustomRange}
                      className="h-[38px] w-full rounded-lg bg-black text-sm font-semibold text-white hover:bg-neutral-800 disabled:opacity-40"
                    >
                      Apply{customDays > 0 ? ` · ${customDays}d` : ''}
                    </button>
                  </div>,
                  document.body
                )
              : null}
            <button
              type="button"
              onClick={() => void handleExport()}
              disabled={exporting || (rangePreset === 'custom' && customHours <= 0)}
              className="inline-flex h-[38px] items-center gap-1.5 rounded-lg border-[0.6px] border-[#bfbfbf] bg-white px-3 text-sm font-medium text-neutral-700 shadow-none hover:bg-neutral-50 disabled:opacity-50"
              title="Export CSV"
            >
              <Download className={`size-[18px] stroke-[2.25] ${exporting ? 'animate-pulse' : ''}`} />
              <span className="hidden sm:inline">Export</span>
            </button>
            <button
              type="button"
              onClick={() => void loadAnalytics()}
              className="inline-flex size-[38px] items-center justify-center rounded-lg border-[0.6px] border-[#bfbfbf] bg-white text-neutral-700 shadow-none hover:bg-neutral-50"
              title="Refresh"
            >
              <RefreshCw className={`size-[18px] stroke-[2.25] ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="grid min-w-0 grid-cols-1 gap-3 @[420px]:grid-cols-2 @[720px]:grid-cols-3">
          <AnalyticsKpiCard
            label="Total tickets"
            value={current.totalTickets}
            change={current.totalTicketsChange}
            up={current.totalTicketsUp}
            tint="volume"
            icon={<TrendingUp strokeWidth={2.25} />}
          />
          <AnalyticsKpiCard
            label="Resolved"
            value={current.resolvedTickets}
            change={current.resolvedTicketsChange}
            up={current.resolvedTicketsUp}
            tint="success"
            icon={<CheckCircle strokeWidth={2.25} />}
          />
          <AnalyticsKpiCard
            label="First response"
            value={current.firstResponse}
            change={current.firstResponseChange}
            up={current.firstResponseUp}
            tint="time"
            icon={<Clock strokeWidth={2.25} />}
          />
          <AnalyticsKpiCard
            label="Resolution time"
            value={current.resolutionTime}
            change={current.resolutionTimeChange}
            up={current.resolutionTimeUp}
            tint="handle"
            icon={<Clock strokeWidth={2.25} />}
          />
          <AnalyticsKpiCard
            label="CSAT score"
            value={current.csat}
            change={csatChangeLabel}
            up={current.csatRatings > 0 ? current.csatUp : undefined}
            tint="sla"
            icon={<Smile strokeWidth={2.25} />}
          />
        </div>

        <div className={CHART_CARD}>
          <ChartHeading
            title="Tickets over time"
            subtitle={`Volume from ticket created_at · ${rangeHint}`}
          />
          {!hasVolumeData && !loading ? (
            <p className="py-6 text-center text-sm text-neutral-400">
              No tickets created in this range
            </p>
          ) : (
            <AnalyticsVolumeChart
              points={volumePoints}
              labels={current.weeklyLabels}
              yMax={yMax}
            />
          )}
        </div>

        <div className={CHART_CARD}>
          <ChartHeading
            title="Tickets by channel"
            subtitle={`Distribution of filing channels · ${rangeHint}`}
          />
          {current.channels.length === 0 ? (
            <p className="py-2 text-sm text-neutral-400">
              No channel data — no tickets created in this range
            </p>
          ) : (
            <ChannelDonut channels={current.channels} />
          )}
          <p className="border-t border-neutral-200 pt-2 text-sm text-neutral-500">
            {current.totalChannelsText}
          </p>
        </div>

        <div className={CHART_CARD}>
          <div className="flex items-start justify-between gap-2">
            <ChartHeading
              title="Agent performance"
              subtitle={`Click an agent to open their tickets · sorted by ${agentSort}`}
            />
            <SegmentTabs
              ariaLabel="Agent sort"
              value={agentSort}
              options={[
                { id: 'overdue', label: 'Overdue' },
                { id: 'assigned', label: 'Volume' },
              ]}
              onChange={setAgentSort}
            />
          </div>
          {sortedAgents.length === 0 ? (
            <p className="py-2 text-sm text-neutral-400">
              No assigned tickets in this range — agents appear after tickets are assigned
            </p>
          ) : (
            <>
            <div className="space-y-2 md:hidden">
              {sortedAgents.map((agent: AnalyticsAgentRow) => (
                <button
                  key={agent.name}
                  type="button"
                  className={`w-full rounded-xl border-[0.6px] border-[#bfbfbf] bg-white px-3 py-2.5 text-left shadow-none ${
                    onNavigate ? 'hover:bg-neutral-50' : ''
                  }`}
                  onClick={() => openTicketSearch(agent.name)}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-semibold text-neutral-900">{agent.name}</span>
                    <span className="shrink-0 text-sm text-neutral-500">CSAT {agent.avgCsat}</span>
                  </div>
                  <div className="mt-2 grid grid-cols-4 gap-1 text-center">
                    <div>
                      <p className="text-[11px] uppercase tracking-[0.12em] text-neutral-400">Assigned</p>
                      <p className="text-sm font-semibold tabular-nums text-neutral-800">{agent.assigned}</p>
                    </div>
                    <div>
                      <p className="text-[11px] uppercase tracking-[0.12em] text-neutral-400">Resolved</p>
                      <p className="text-sm font-semibold tabular-nums text-neutral-800">{agent.resolved}</p>
                    </div>
                    <div>
                      <p className="text-[11px] uppercase tracking-[0.12em] text-neutral-400">Overdue</p>
                      <p className={`text-sm font-semibold tabular-nums ${agent.overdue > 0 ? 'text-rose-600' : 'text-neutral-800'}`}>
                        {agent.overdue}
                      </p>
                    </div>
                    <div>
                      <p className="text-[11px] uppercase tracking-[0.12em] text-neutral-400">Avg</p>
                      <p className="text-sm font-semibold tabular-nums text-neutral-800">{agent.avgResolveHours}</p>
                    </div>
                  </div>
                </button>
              ))}
            </div>
            <div className="-mx-1 hidden overflow-x-auto md:block">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-[#e5e5e5] bg-neutral-50 text-[11px] font-medium uppercase tracking-[0.12em] text-neutral-400">
                    <th className="py-2 pr-2">Agent</th>
                    <th className="px-1 py-2 tabular-nums">Assigned</th>
                    <th className="px-1 py-2 tabular-nums">Resolved</th>
                    <th className="px-1 py-2 tabular-nums">Overdue</th>
                    <th className="px-1 py-2">Avg resolve</th>
                    <th className="py-2 pl-1">CSAT</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedAgents.map((agent: AnalyticsAgentRow) => (
                    <tr
                      key={agent.name}
                      className={`border-b border-[#e5e5e5] last:border-0 ${
                        onNavigate ? 'cursor-pointer hover:bg-neutral-50/80' : ''
                      }`}
                      onClick={() => openTicketSearch(agent.name)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          openTicketSearch(agent.name);
                        }
                      }}
                      tabIndex={onNavigate ? 0 : undefined}
                      title={onNavigate ? `Open tickets for ${agent.name}` : undefined}
                    >
                      <td className="max-w-[120px] truncate py-2 pr-2 font-medium text-neutral-900">
                        {agent.name}
                      </td>
                      <td className="py-2 px-1 tabular-nums text-neutral-700">{agent.assigned}</td>
                      <td className="py-2 px-1 tabular-nums text-neutral-700">{agent.resolved}</td>
                      <td
                        className={`py-2 px-1 tabular-nums ${
                          agent.overdue > 0 ? 'text-rose-600 font-semibold' : 'text-neutral-700'
                        }`}
                      >
                        {agent.overdue}
                      </td>
                      <td className="py-2 px-1 text-neutral-700">{agent.avgResolveHours}</td>
                      <td className="py-2 pl-1 text-neutral-700">
                        {agent.avgCsat}
                        {agent.ratings > 0 ? (
                          <span className="text-neutral-400"> · n={agent.ratings}</span>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            </>
          )}
        </div>

        <div className={CHART_CARD}>
          <div className="flex items-start justify-between gap-2">
            <ChartHeading
              title="SLA breach report"
              subtitle={`Breach rate ${current.slaReport.breachRate} · ${current.slaReport.openOverdue} open overdue · click a row to open the ticket`}
            />
            <span className="text-[22px] font-bold tabular-nums text-neutral-900">
              {current.slaReport.breached}
            </span>
          </div>
          {current.slaReport.recent.length === 0 ? (
            <p className="py-2 text-sm text-neutral-400">No overdue tickets right now.</p>
          ) : (
            <ul className="space-y-2">
              {current.slaReport.recent.map((row) => (
                <li key={row.id}>
                  <button
                    type="button"
                    disabled={!onNavigate}
                    onClick={() =>
                      openTicketSearch(row.id.startsWith('#') ? row.id : `#${row.id}`)
                    }
                    className="flex w-full items-start justify-between gap-2 rounded-lg border-[0.6px] border-[#bfbfbf] bg-neutral-50 px-2.5 py-2 text-left shadow-none hover:bg-neutral-100 disabled:hover:bg-neutral-50"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-neutral-900">
                        {row.id} · {row.subject}
                      </p>
                      <p className="mt-0.5 truncate text-sm text-neutral-500">
                        {row.customerName || '—'} · {row.assignee}
                      </p>
                    </div>
                    <span className="shrink-0 text-sm font-medium text-rose-600">{row.dueAt}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {(() => {
          const insights = current.insights || emptyInsights;
          const diag = insights.diagnostic;
          const pred = insights.predictive;
          const presc = insights.prescriptive;
          const maxForecast = Math.max(
            1,
            ...pred.volumeForecast.map((d) => d.created),
            pred.avgDailyCreated
          );
          return (
            <div className="space-y-3 pt-1">
              <div className="flex items-end justify-between gap-2">
                <div>
                  <h2 className="text-sm font-semibold text-neutral-900">Insight layers</h2>
                  <p className="mt-0.5 text-sm text-neutral-500">
                    Diagnostic · Predictive · Prescriptive from ticket and SLA data
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 xl:grid-cols-3 gap-3">
                <div className={CHART_CARD}>
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h3 className="flex items-center gap-1.5 text-sm font-bold capitalize text-neutral-900">
                        <Activity className="size-[18px] stroke-[2.25] text-blue-600" />
                        Diagnostic
                      </h3>
                      <p className="mt-0.5 text-sm text-neutral-500">{diag.deltaLabel}</p>
                    </div>
                    <span
                      className={`text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded ${
                        diag.status === 'needs_attention'
                          ? 'bg-amber-50 text-amber-700'
                          : 'bg-emerald-50 text-emerald-700'
                      }`}
                    >
                      {diag.status === 'needs_attention' ? 'Attention' : 'Stable'}
                    </span>
                  </div>
                  <p className="text-sm font-semibold text-neutral-900 leading-snug">{diag.headline}</p>
                  <p className="text-sm leading-relaxed text-neutral-500">{diag.summary}</p>
                  {diag.factors.length > 0 ? (
                    <div className="space-y-2">
                      <p className="text-[10px] font-medium uppercase tracking-wide text-neutral-400">
                        Drivers
                      </p>
                      {diag.factors.map((f) => (
                        <div key={f.label} className="space-y-1">
                          <div className="flex justify-between gap-2 text-[11px]">
                            <span className="text-neutral-700 truncate">{f.label}</span>
                            <span className="tabular-nums text-neutral-900 font-medium">
                              {f.sharePct}%
                            </span>
                          </div>
                          <div className="h-1.5 rounded-full bg-neutral-100 overflow-hidden">
                            <div
                              className="h-full rounded-full bg-sky-500"
                              style={{ width: `${Math.min(100, Math.max(0, f.sharePct))}%` }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-neutral-400">No weighted drivers in this range.</p>
                  )}
                  {diag.evidence.length > 0 ? (
                    <ul className="space-y-1.5 border-t border-neutral-100 pt-2">
                      {diag.evidence.map((e) => (
                        <li key={e.title} className="text-[11px]">
                          <span className="font-medium text-neutral-800">{e.title}: </span>
                          <span className="text-neutral-500">{e.detail}</span>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>

                <div className={CHART_CARD}>
                  <div>
                    <h3 className="flex items-center gap-1.5 text-sm font-bold capitalize text-neutral-900">
                      <LineChart className="size-[18px] stroke-[2.25] text-violet-600" />
                      Predictive
                    </h3>
                    <p className="mt-0.5 text-sm text-neutral-500">
                      Avg ~{pred.avgDailyCreated}/day created · next 3 days
                    </p>
                  </div>
                  {pred.volumeForecast.length === 0 ? (
                    <p className="text-xs text-neutral-400 py-2">Not enough daily volume to forecast.</p>
                  ) : (
                    <div className="flex items-end gap-2 h-24">
                      {pred.volumeForecast.map((d) => (
                        <div
                          key={d.label}
                          className="group relative flex-1 flex flex-col items-center gap-1 min-w-0"
                        >
                          <span className="text-[10px] tabular-nums text-neutral-700 font-medium">
                            {d.created}
                          </span>
                          <div className="flex h-14 w-full items-end overflow-hidden rounded-t bg-blue-100">
                            <div
                              className="w-full rounded-t bg-[#3b82f6]"
                              style={{
                                height: `${Math.max(8, Math.round((d.created / maxForecast) * 100))}%`,
                              }}
                            />
                          </div>
                          <span className="text-[10px] text-neutral-400">{d.label}</span>
                          <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden -translate-x-1/2 whitespace-nowrap rounded-lg bg-[#171717] px-2 py-1 text-[12px] text-white group-hover:block">
                            <p className="font-semibold">{d.label}</p>
                            <p className="tabular-nums">{d.created} tickets</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  {pred.riskSignals.length === 0 ? (
                    <p className="text-xs text-neutral-400">
                      No elevated risk signals from current backlog.
                    </p>
                  ) : (
                    <ul className="space-y-2">
                      {pred.riskSignals.map((r) => (
                        <li
                          key={r.title}
                          className="rounded-lg border border-neutral-100 bg-neutral-50/80 px-2.5 py-2"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-[11px] font-semibold text-neutral-900">{r.title}</p>
                            <span
                              className={`text-[9px] uppercase font-semibold ${
                                r.level === 'high'
                                  ? 'text-rose-600'
                                  : r.level === 'medium'
                                    ? 'text-amber-600'
                                    : 'text-sky-600'
                              }`}
                            >
                              {r.level}
                            </span>
                          </div>
                          <p className="text-[10px] text-neutral-500 mt-0.5 leading-relaxed">
                            {r.detail}
                          </p>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <div className={CHART_CARD}>
                  <div>
                    <h3 className="flex items-center gap-1.5 text-sm font-bold capitalize text-neutral-900">
                      <Lightbulb className="size-[18px] stroke-[2.25] text-amber-600" />
                      Prescriptive
                    </h3>
                    <p className="mt-0.5 text-sm text-neutral-500">{presc.banner}</p>
                  </div>
                  {presc.actions.length === 0 ? (
                    <p className="text-xs text-neutral-400 py-2">No recommended actions right now.</p>
                  ) : (
                    <ol className="space-y-2">
                      {presc.actions.map((a, idx) => (
                        <li
                          key={`${a.title}-${idx}`}
                          className="rounded-lg border border-neutral-100 bg-neutral-50/80 px-2.5 py-2 space-y-1.5"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <p className="text-[11px] font-semibold text-neutral-900 leading-snug">
                              {idx + 1}. {a.title}
                            </p>
                            <span
                              className={`text-[9px] uppercase font-semibold shrink-0 ${
                                a.priority === 'high'
                                  ? 'text-rose-600'
                                  : a.priority === 'medium'
                                    ? 'text-amber-600'
                                    : 'text-neutral-500'
                              }`}
                            >
                              {a.priority}
                            </span>
                          </div>
                          <p className="text-[10px] text-emerald-700 font-medium">{a.impact}</p>
                          <p className="text-[10px] text-neutral-500 leading-relaxed">{a.detail}</p>
                          {a.navigate && onNavigate ? (
                            <button
                              type="button"
                              onClick={() => openModule(a.navigate)}
                              className="inline-flex h-[38px] items-center gap-1 rounded-lg bg-black px-3 text-sm font-semibold text-white hover:bg-neutral-800"
                            >
                              Open
                              <ArrowRight className="size-[18px] stroke-[2.25]" />
                            </button>
                          ) : null}
                        </li>
                      ))}
                    </ol>
                  )}
                </div>
              </div>
            </div>
          );
        })()}
      </div>
    </PageShell>
  );
}
