import React, { useEffect, useState } from 'react';
import { AlertTriangle, RefreshCw, ScrollText } from 'lucide-react';
import { useSetPageTitle } from './layout/PageTitleContext';
import PageShell from './layout/PageShell';

type AuditEvent = {
  id: string;
  actorName: string | null;
  action: string;
  ticketNumber: string | null;
  meta: Record<string, unknown>;
  createdAt: string;
};

interface AuditLogViewProps {
  embedded?: boolean;
  listRefreshToken?: number;
  /** Chat ticket/actor search — same Express filters the UI list uses. */
  externalSearchQuery?: string;
  /** Chat date preset (yesterday | 24hours | 7days | 30days | 90days). */
  externalRange?: string;
}

function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatAction(action: string): string {
  return action.replace(/^ticket\./, '').replace(/_/g, ' ');
}

function formatDetail(meta: Record<string, unknown> | null | undefined): string {
  if (!meta || typeof meta !== 'object') return '';
  const keys = Object.keys(meta);
  if (keys.length === 0) return '';
  // Prefer a short human summary over raw JSON when possible
  const bits: string[] = [];
  for (const key of ['from', 'to', 'status', 'priority', 'assignee', 'note', 'reason']) {
    if (meta[key] != null && String(meta[key]).trim()) {
      bits.push(`${key}: ${String(meta[key])}`);
    }
  }
  if (bits.length > 0) return bits.slice(0, 3).join(' · ');
  try {
    const raw = JSON.stringify(meta);
    return raw.length > 120 ? `${raw.slice(0, 117)}…` : raw;
  } catch {
    return '';
  }
}

export default function AuditLogView({
  embedded = false,
  listRefreshToken = 0,
  externalSearchQuery,
  externalRange,
}: AuditLogViewProps) {
  useSetPageTitle('Audit log');
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionFilter, setActionFilter] = useState('All');
  const [searchQuery, setSearchQuery] = useState('');
  const [rangeFilter, setRangeFilter] = useState('');

  const load = async (q = searchQuery, rng = rangeFilter) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: '200' });
      const needle = q.trim();
      if (needle) {
        const ticket = needle.match(/#?(\d{3,})/);
        if (ticket) params.set('ticket', ticket[1]);
        else params.set('actor', needle);
      }
      if (rng.trim()) params.set('range', rng.trim());
      const res = await fetch(`/api/audit?${params.toString()}`, { credentials: 'include' });
      if (res.status === 403) {
        setError('You do not have access to the audit log.');
        setEvents([]);
        return;
      }
      if (!res.ok) throw new Error('Failed');
      const data = (await res.json()) as AuditEvent[];
      setEvents(Array.isArray(data) ? data : []);
    } catch {
      setError('Could not load audit events.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (externalSearchQuery !== undefined) setSearchQuery(externalSearchQuery);
  }, [externalSearchQuery]);

  useEffect(() => {
    if (externalRange !== undefined) setRangeFilter(externalRange || '');
  }, [externalRange]);

  useEffect(() => {
    void load(searchQuery, rangeFilter);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refetch when chat/UI filters change
  }, [searchQuery, rangeFilter]);

  useEffect(() => {
    if (!listRefreshToken) return;
    void load();
  }, [listRefreshToken]);

  const actions = Array.from(new Set(events.map((e) => e.action))).sort();
  const filtered = events.filter((e) => {
    if (actionFilter !== 'All' && e.action !== actionFilter) return false;
    const needle = searchQuery.trim().toLowerCase().replace(/^#/, '');
    if (!needle) return true;
    const detail = formatDetail(e.meta).toLowerCase();
    return (
      String(e.actorName || '').toLowerCase().includes(needle) ||
      String(e.ticketNumber || '').toLowerCase().includes(needle) ||
      formatAction(e.action).toLowerCase().includes(needle) ||
      e.action.toLowerCase().includes(needle) ||
      detail.includes(needle)
    );
  });

  const body = (
    <div className="flex h-full min-h-0 min-w-0 w-full flex-col gap-3 overflow-x-hidden">
      <div className="flex shrink-0 flex-col gap-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-neutral-900 text-white">
                <ScrollText className="h-3.5 w-3.5" strokeWidth={2.25} />
              </span>
              <h2 className="truncate text-base font-semibold text-neutral-900">
                Audit log
              </h2>
            </div>
            <p className="mt-1 text-[13px] leading-relaxed text-neutral-500">
              Immutable trail of assigns, status changes, notes, and escalations.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            aria-label="Refresh audit log"
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-neutral-200 bg-white text-neutral-700 outline-none hover:bg-neutral-50 focus:border-neutral-900 disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        <div className="flex min-w-0 items-center gap-2">
          <select
            value={actionFilter}
            onChange={(e) => setActionFilter(e.target.value)}
            aria-label="Filter by action"
            className="h-9 min-w-0 flex-1 rounded-xl border border-neutral-200 bg-white px-2.5 text-xs font-medium text-neutral-800 outline-none focus:border-neutral-900"
          >
            <option value="All">All actions</option>
            {actions.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
          <span className="shrink-0 tabular-nums text-[11px] text-neutral-400">
            {loading ? '…' : `${filtered.length}`}
          </span>
        </div>
      </div>

      {error && (
        <div className="flex shrink-0 items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[13px] text-amber-900">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain rounded-xl border border-neutral-200 bg-white [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
        {loading && events.length === 0 ? (
          <p className="px-3 py-10 text-center text-sm text-neutral-400">Loading…</p>
        ) : filtered.length === 0 ? (
          <p className="px-3 py-10 text-center text-sm text-neutral-400">
            No audit events yet.
          </p>
        ) : (
          <ul className="divide-y divide-neutral-100">
            {filtered.map((e) => {
              const detail = formatDetail(e.meta);
              return (
                <li key={e.id} className="min-w-0 px-3 py-2.5">
                  <div className="flex min-w-0 items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="rounded-md bg-neutral-100 px-1.5 py-0.5 text-[11px] font-medium capitalize text-neutral-800">
                          {formatAction(e.action)}
                        </span>
                        {e.ticketNumber ? (
                          <span className="font-mono text-[11px] tabular-nums text-neutral-600">
                            {e.ticketNumber}
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-1 truncate text-[12px] text-neutral-600">
                        <span className="font-medium text-neutral-800">
                          {e.actorName || 'System'}
                        </span>
                        {detail ? (
                          <span className="text-neutral-400"> · {detail}</span>
                        ) : null}
                      </p>
                    </div>
                    <time
                      dateTime={e.createdAt}
                      className="shrink-0 pt-0.5 text-[11px] tabular-nums text-neutral-400"
                      title={new Date(e.createdAt).toLocaleString()}
                    >
                      {formatWhen(e.createdAt)}
                    </time>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );

  return (
    <PageShell embedded={embedded} fillHeight>
      {body}
    </PageShell>
  );
}
