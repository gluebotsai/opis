import React, { useMemo, useState, useEffect } from 'react';
import {
  TrendingUp,
  Clock,
  CheckCircle,
  Smile,
  ArrowUpRight,
  ArrowDownRight,
  Globe,
  MessageSquare,
  Mail,
  Phone,
  RefreshCw,
  Download,
  AlertTriangle,
  Users,
  Activity,
  LineChart,
  Lightbulb,
  Calendar,
  ArrowRight,
} from 'lucide-react';
import type { AnalyticsAgentRow, AnalyticsInsights, AnalyticsPayload } from '../types';
import { useSetPageTitle } from './layout/PageTitleContext';
import PageShell from './layout/PageShell';

type RangePreset = 'today' | '7d' | '30d' | 'custom';
type ApiRange = '24hours' | '7days' | '30days' | 'custom';
type AgentSort = 'overdue' | 'assigned';

function presetToApiRange(preset: RangePreset): ApiRange {
  if (preset === 'today') return '24hours';
  if (preset === '7d') return '7days';
  if (preset === '30d') return '30days';
  return 'custom';
}

function daysBetweenInclusive(fromIso: string, toIso: string) {
  const from = new Date(`${fromIso}T00:00:00`);
  const to = new Date(`${toIso}T23:59:59`);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to < from) {
    return 0;
  }
  return Math.max(1, Math.ceil((to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000)));
}

const channelIcons: Record<string, typeof Mail> = {
  Email: Mail,
  Chat: MessageSquare,
  Phone: Phone,
  'Web Portal': Globe,
  Web: Globe,
};

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

function KpiCard({
  label,
  value,
  change,
  up,
  icon,
  accent = false,
}: {
  label: string;
  value: string;
  change: string;
  up?: boolean;
  icon: React.ReactNode;
  accent?: boolean;
}) {
  const trendPositive = up === true;
  const trendClass = accent
    ? 'text-emerald-300'
    : trendPositive
      ? 'text-emerald-600'
      : up === false
        ? 'text-rose-600'
        : 'text-neutral-500';

  return (
    <div
      className={`rounded-xl border px-3 py-3 shadow-sm flex flex-col gap-2 min-h-[96px] ${
        accent
          ? 'border-neutral-900 bg-neutral-950 text-white'
          : 'border-neutral-200 bg-white text-neutral-900'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <span
          className={`text-[10px] font-medium tracking-wide uppercase leading-tight ${
            accent ? 'text-neutral-400' : 'text-neutral-400'
          }`}
        >
          {label}
        </span>
        <span
          className={`shrink-0 rounded-lg p-1.5 ${
            accent ? 'bg-neutral-800 text-neutral-200' : 'bg-neutral-50 text-neutral-600'
          }`}
        >
          {icon}
        </span>
      </div>
      <div className={`text-xl font-semibold tabular-nums leading-none ${accent ? 'text-white' : ''}`}>
        {value}
      </div>
      <div className={`mt-auto flex items-center gap-1 text-[11px] font-medium ${trendClass}`}>
        {up === true ? (
          <ArrowUpRight className="h-3.5 w-3.5 stroke-[2.5] shrink-0" />
        ) : up === false ? (
          <ArrowDownRight className="h-3.5 w-3.5 stroke-[2.5] shrink-0" />
        ) : null}
        <span className="leading-snug break-words">{change}</span>
      </div>
    </div>
  );
}

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
  const [agentSort, setAgentSort] = useState<AgentSort>('overdue');
  const [current, setCurrent] = useState<AnalyticsPayload>(emptyAnalytics);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);

  const apiRange = presetToApiRange(rangePreset);
  const customDays = daysBetweenInclusive(customFrom, customTo);

  const buildQuery = () => {
    const params = new URLSearchParams();
    if (rangePreset === 'custom' && customHours > 0) {
      params.set('range', 'custom');
      params.set('hours', String(customHours));
    } else {
      params.set('range', apiRange === 'custom' ? '7days' : apiRange);
    }
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
  }, [rangePreset, customHours]);

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

  const chartWidth = 500;
  const chartHeight = 100;
  const yMax = 100;

  const getCoordinates = (points: number[]) => {
    if (!points.length) return `0,${chartHeight}`;
    if (points.length === 1) {
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
          <p className="text-xs sm:text-sm text-neutral-500 leading-snug">
            Live KPIs from tickets · click rows to open work · {rangeHint}
          </p>
          <div className="flex items-center gap-2 text-xs relative shrink-0 flex-wrap justify-end">
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
              onClick={() => void handleExport()}
              disabled={exporting || (rangePreset === 'custom' && customHours <= 0)}
              className="h-8 px-2.5 border border-neutral-200 rounded-lg hover:bg-neutral-50 bg-white flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-neutral-700 disabled:opacity-50"
              title="Export CSV"
            >
              <Download className={`h-3.5 w-3.5 ${exporting ? 'animate-pulse' : ''}`} />
              <span className="hidden sm:inline">Export</span>
            </button>
            <button
              type="button"
              onClick={() => void loadAnalytics()}
              className="p-2 border border-neutral-200 rounded-lg hover:bg-neutral-50 bg-white"
              title="Refresh"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-3">
          <KpiCard
            label="Total tickets"
            value={current.totalTickets}
            change={current.totalTicketsChange}
            up={current.totalTicketsUp}
            icon={<TrendingUp className="h-3.5 w-3.5" />}
          />
          <KpiCard
            label="Resolved"
            value={current.resolvedTickets}
            change={current.resolvedTicketsChange}
            up={current.resolvedTicketsUp}
            icon={<CheckCircle className="h-3.5 w-3.5" />}
          />
          <KpiCard
            label="First response"
            value={current.firstResponse}
            change={current.firstResponseChange}
            up={current.firstResponseUp}
            icon={<Clock className="h-3.5 w-3.5" />}
          />
          <KpiCard
            label="Resolution time"
            value={current.resolutionTime}
            change={current.resolutionTimeChange}
            up={current.resolutionTimeUp}
            icon={<Clock className="h-3.5 w-3.5" />}
          />
          <div className="col-span-2">
            <KpiCard
              label="CSAT score"
              value={current.csat}
              change={csatChangeLabel}
              up={current.csatRatings > 0 ? current.csatUp : undefined}
              icon={<Smile className="h-3.5 w-3.5" />}
              accent
            />
          </div>
        </div>

        <div className="rounded-xl border border-neutral-200 bg-white p-3.5 shadow-sm space-y-3">
          <div>
            <h3 className="text-xs font-semibold text-neutral-900">Tickets over time</h3>
            <p className="text-[11px] text-neutral-500 mt-0.5">
              Volume from ticket created_at · {rangeHint}
            </p>
          </div>
          {!hasVolumeData && !loading ? (
            <p className="text-xs text-neutral-400 py-6 text-center">
              No tickets created in this range
            </p>
          ) : (
            <>
              <div className="relative w-full h-[120px] pl-6">
                <div className="absolute left-0 top-0 h-full flex flex-col justify-between text-[9px] font-mono text-neutral-400 w-5 text-right select-none">
                  <span>{yMax}</span>
                  <span>{Math.round(yMax / 2)}</span>
                  <span>0</span>
                </div>
                <svg
                  viewBox={`0 0 ${chartWidth} ${chartHeight}`}
                  className="w-full h-full overflow-visible"
                  preserveAspectRatio="none"
                >
                  <defs>
                    <linearGradient id="analyticsVolumeFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#0ea5e9" stopOpacity="0.2" />
                      <stop offset="100%" stopColor="#0ea5e9" stopOpacity="0" />
                    </linearGradient>
                  </defs>
                  <line
                    x1="0"
                    y1={chartHeight * 0.5}
                    x2={chartWidth}
                    y2={chartHeight * 0.5}
                    className="stroke-neutral-100"
                    strokeWidth="1"
                  />
                  <line
                    x1="0"
                    y1={chartHeight}
                    x2={chartWidth}
                    y2={chartHeight}
                    className="stroke-neutral-200"
                    strokeWidth="1"
                  />
                  <path
                    d={`M 0,${chartHeight} L ${getCoordinates(current.weeklyPoints)} L ${chartWidth},${chartHeight} Z`}
                    fill="url(#analyticsVolumeFill)"
                  />
                  <polyline
                    fill="none"
                    stroke="#0ea5e9"
                    strokeWidth="2.5"
                    points={getCoordinates(current.weeklyPoints)}
                  />
                </svg>
              </div>
              <div className="flex justify-between gap-1 text-[10px] font-medium text-neutral-400 border-t border-neutral-100 pt-2">
                {current.weeklyLabels.map((lbl, idx) => (
                  <span key={`${lbl}-${idx}`} className="truncate">
                    {lbl}
                  </span>
                ))}
              </div>
            </>
          )}
        </div>

        <div className="rounded-xl border border-neutral-200 bg-white p-3.5 shadow-sm space-y-3">
          <div>
            <h3 className="text-xs font-semibold text-neutral-900">Tickets by channel</h3>
            <p className="text-[11px] text-neutral-500 mt-0.5">
              Distribution of filing channels · {rangeHint}
            </p>
          </div>
          <div className="space-y-3.5">
            {current.channels.length === 0 ? (
              <p className="text-xs text-neutral-400 py-2">
                No channel data — no tickets created in this range
              </p>
            ) : (
              current.channels.map((chan, idx) => {
                const Icon = channelIcons[chan.name] || Globe;
                return (
                  <div key={`${chan.name}-${idx}`} className="space-y-1.5">
                    <div className="flex items-center justify-between gap-2 text-xs font-medium">
                      <span className="flex items-center gap-2 text-neutral-800 min-w-0">
                        <Icon className="h-3.5 w-3.5 text-neutral-500 shrink-0" />
                        <span className="truncate">{chan.name}</span>
                      </span>
                      <span className="font-semibold tabular-nums text-neutral-900 shrink-0">
                        {chan.percentage} ({chan.count})
                      </span>
                    </div>
                    <div className="h-2 w-full bg-neutral-100 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${chan.colorClass}`}
                        style={{ width: chan.percentage }}
                      />
                    </div>
                  </div>
                );
              })
            )}
          </div>
          <p className="text-[11px] text-neutral-400 border-t border-neutral-100 pt-2">
            {current.totalChannelsText}
          </p>
        </div>

        <div className="rounded-xl border border-neutral-200 bg-white p-3.5 shadow-sm space-y-3">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h3 className="text-xs font-semibold text-neutral-900 flex items-center gap-1.5">
                <Users className="h-3.5 w-3.5 text-neutral-500" />
                Agent performance
              </h3>
              <p className="text-[11px] text-neutral-500 mt-0.5">
                Click an agent to open their tickets · sorted by {agentSort}
              </p>
            </div>
            <div className="flex items-center rounded-lg border border-neutral-200 p-0.5 shrink-0">
              {(
                [
                  { id: 'overdue', label: 'Overdue' },
                  { id: 'assigned', label: 'Volume' },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setAgentSort(opt.id)}
                  className={`h-6 px-2 rounded-md text-[10px] font-semibold ${
                    agentSort === opt.id
                      ? 'bg-neutral-900 text-white'
                      : 'text-neutral-500 hover:text-neutral-800'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
          {sortedAgents.length === 0 ? (
            <p className="text-xs text-neutral-400 py-2">
              No assigned tickets in this range — agents appear after tickets are assigned
            </p>
          ) : (
            <>
            <div className="md:hidden space-y-2">
              {sortedAgents.map((agent: AnalyticsAgentRow) => (
                <button
                  key={agent.name}
                  type="button"
                  className={`w-full text-left rounded-xl border border-neutral-200 bg-white px-3 py-2.5 ${
                    onNavigate ? 'hover:bg-neutral-50' : ''
                  }`}
                  onClick={() => openTicketSearch(agent.name)}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-sky-800 truncate">{agent.name}</span>
                    <span className="text-[10px] text-neutral-500 shrink-0">CSAT {agent.avgCsat}</span>
                  </div>
                  <div className="mt-2 grid grid-cols-4 gap-1 text-center">
                    <div>
                      <p className="text-[10px] text-neutral-400">Assigned</p>
                      <p className="text-xs font-semibold tabular-nums text-neutral-800">{agent.assigned}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-neutral-400">Resolved</p>
                      <p className="text-xs font-semibold tabular-nums text-neutral-800">{agent.resolved}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-neutral-400">Overdue</p>
                      <p className={`text-xs font-semibold tabular-nums ${agent.overdue > 0 ? 'text-rose-600' : 'text-neutral-800'}`}>
                        {agent.overdue}
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] text-neutral-400">Avg</p>
                      <p className="text-xs font-semibold tabular-nums text-neutral-800">{agent.avgResolveHours}</p>
                    </div>
                  </div>
                </button>
              ))}
            </div>
            <div className="hidden md:block overflow-x-auto -mx-1">
              <table className="w-full text-left text-[11px]">
                <thead>
                  <tr className="text-neutral-400 border-b border-neutral-100">
                    <th className="font-medium py-2 pr-2">Agent</th>
                    <th className="font-medium py-2 px-1 tabular-nums">Assigned</th>
                    <th className="font-medium py-2 px-1 tabular-nums">Resolved</th>
                    <th className="font-medium py-2 px-1 tabular-nums">Overdue</th>
                    <th className="font-medium py-2 px-1">Avg resolve</th>
                    <th className="font-medium py-2 pl-1">CSAT</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedAgents.map((agent: AnalyticsAgentRow) => (
                    <tr
                      key={agent.name}
                      className={`border-b border-neutral-50 last:border-0 ${
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
                      <td className="py-2 pr-2 font-medium text-sky-800 truncate max-w-[120px]">
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

        <div className="rounded-xl border border-neutral-200 bg-white p-3.5 shadow-sm space-y-3">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h3 className="text-xs font-semibold text-neutral-900 flex items-center gap-1.5">
                <AlertTriangle className="h-3.5 w-3.5 text-amber-600" />
                SLA breach report
              </h3>
              <p className="text-[11px] text-neutral-500 mt-0.5">
                Breach rate {current.slaReport.breachRate} · {current.slaReport.openOverdue} open
                overdue · click a row to open the ticket
              </p>
            </div>
            <span className="text-lg font-semibold tabular-nums text-neutral-900">
              {current.slaReport.breached}
            </span>
          </div>
          {current.slaReport.recent.length === 0 ? (
            <p className="text-xs text-neutral-400 py-2">No overdue tickets right now.</p>
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
                    className="w-full flex items-start justify-between gap-2 rounded-lg border border-neutral-100 bg-neutral-50/80 px-2.5 py-2 text-left hover:border-sky-200 hover:bg-sky-50/50 disabled:hover:bg-neutral-50/80 disabled:hover:border-neutral-100 transition-colors"
                  >
                    <div className="min-w-0">
                      <p className="text-[11px] font-semibold text-neutral-900 truncate">
                        {row.id} · {row.subject}
                      </p>
                      <p className="text-[10px] text-neutral-500 mt-0.5 truncate">
                        {row.customerName || '—'} · {row.assignee}
                      </p>
                    </div>
                    <span className="text-[10px] text-rose-600 font-medium shrink-0">{row.dueAt}</span>
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
                  <p className="text-[11px] text-neutral-500 mt-0.5">
                    Diagnostic · Predictive · Prescriptive from ticket and SLA data
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 xl:grid-cols-3 gap-3">
                <div className="rounded-xl border border-neutral-200 bg-white p-3.5 shadow-sm space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h3 className="text-xs font-semibold text-neutral-900 flex items-center gap-1.5">
                        <Activity className="h-3.5 w-3.5 text-sky-600" />
                        Diagnostic
                      </h3>
                      <p className="text-[11px] text-neutral-500 mt-0.5">{diag.deltaLabel}</p>
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
                  <p className="text-[11px] text-neutral-600 leading-relaxed">{diag.summary}</p>
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

                <div className="rounded-xl border border-neutral-200 bg-white p-3.5 shadow-sm space-y-3">
                  <div>
                    <h3 className="text-xs font-semibold text-neutral-900 flex items-center gap-1.5">
                      <LineChart className="h-3.5 w-3.5 text-teal-600" />
                      Predictive
                    </h3>
                    <p className="text-[11px] text-neutral-500 mt-0.5">
                      Avg ~{pred.avgDailyCreated}/day created · next 3 days
                    </p>
                  </div>
                  {pred.volumeForecast.length === 0 ? (
                    <p className="text-xs text-neutral-400 py-2">Not enough daily volume to forecast.</p>
                  ) : (
                    <div className="flex items-end gap-2 h-24">
                      {pred.volumeForecast.map((d) => (
                        <div key={d.label} className="flex-1 flex flex-col items-center gap-1 min-w-0">
                          <span className="text-[10px] tabular-nums text-neutral-700 font-medium">
                            {d.created}
                          </span>
                          <div className="w-full rounded-t bg-teal-100 overflow-hidden flex items-end h-14">
                            <div
                              className="w-full bg-teal-600 rounded-t"
                              style={{
                                height: `${Math.max(8, Math.round((d.created / maxForecast) * 100))}%`,
                              }}
                            />
                          </div>
                          <span className="text-[10px] text-neutral-400">{d.label}</span>
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

                <div className="rounded-xl border border-neutral-200 bg-white p-3.5 shadow-sm space-y-3">
                  <div>
                    <h3 className="text-xs font-semibold text-neutral-900 flex items-center gap-1.5">
                      <Lightbulb className="h-3.5 w-3.5 text-amber-600" />
                      Prescriptive
                    </h3>
                    <p className="text-[11px] text-neutral-500 mt-0.5">{presc.banner}</p>
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
                              className="inline-flex items-center gap-1 h-7 px-2 rounded-md bg-neutral-900 text-white text-[10px] font-semibold hover:bg-neutral-800"
                            >
                              Open
                              <ArrowRight className="h-3 w-3" />
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
