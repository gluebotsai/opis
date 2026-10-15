import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Clock3,
  Inbox,
  RefreshCw,
} from 'lucide-react';
import type { AuthUser, Ticket, TicketStatus } from '../types';
import { useSetPageTitle } from './layout/PageTitleContext';
import PageShell from './layout/PageShell';
import { useCoworkerSplitExpandOptional } from './coworker/CoworkerSplitWorkspace';

const COLUMNS = ['Open', 'Pending', 'Reopened', 'Overdue', 'Resolved'] as const;
type BoardColumn = (typeof COLUMNS)[number];

const COLUMN_META: Record<
  BoardColumn,
  { accent: string; header: string; dot: string; label: string; hint: string }
> = {
  Open: {
    accent: 'border-t-sky-500',
    header: 'bg-sky-50/80',
    dot: 'bg-sky-500',
    label: 'To do',
    hint: 'Assigned to you · not started',
  },
  Pending: {
    accent: 'border-t-teal-500',
    header: 'bg-teal-50/80',
    dot: 'bg-teal-500',
    label: 'In progress',
    hint: 'Actively working',
  },
  Reopened: {
    accent: 'border-t-amber-500',
    header: 'bg-amber-50/80',
    dot: 'bg-amber-500',
    label: 'Reopened',
    hint: 'Was resolved · work restarted',
  },
  Overdue: {
    accent: 'border-t-rose-500',
    header: 'bg-rose-50/80',
    dot: 'bg-rose-500',
    label: 'Overdue',
    hint: 'Past SLA',
  },
  Resolved: {
    accent: 'border-t-emerald-500',
    header: 'bg-emerald-50/80',
    dot: 'bg-emerald-500',
    label: 'Resolved',
    hint: 'Done',
  },
};

/** Board folds custom statuses into In progress. */
function boardColumnFor(status: TicketStatus): BoardColumn {
  if ((COLUMNS as readonly string[]).includes(status)) {
    return status as BoardColumn;
  }
  // Custom org statuses → In progress column
  return 'Pending';
}

const PRIORITY_STYLE: Record<string, string> = {
  urgent: 'bg-rose-100 text-rose-700',
  high: 'bg-orange-100 text-orange-800',
  medium: 'bg-sky-100 text-sky-800',
  low: 'bg-neutral-100 text-neutral-600',
};

interface WorkBoardViewProps {
  currentUser: AuthUser;
  onUpdateTicket: (
    id: string,
    updates: Partial<Ticket>
  ) => void | Promise<boolean | void>;
  onOpenTicket?: (ticketId: string) => void;
  embedded?: boolean;
  displayTimezone?: string;
}

function formatDueLabel(dueAt: string, timeZone?: string) {
  const due = new Date(dueAt);
  if (Number.isNaN(due.getTime())) return null;
  const diffMs = due.getTime() - Date.now();
  const overdue = diffMs < 0;
  const abs = Math.abs(diffMs);
  const mins = Math.floor(abs / 60000);
  const hours = Math.floor(mins / 60);
  const days = Math.floor(hours / 24);
  const relative =
    days > 0
      ? `${days}d`
      : hours > 0
        ? `${hours}h`
        : `${Math.max(1, mins)}m`;
  const absolute = due.toLocaleString(undefined, {
    timeZone: timeZone || undefined,
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
  return {
    overdue,
    relative: overdue ? `${relative} overdue` : `Due in ${relative}`,
    absolute,
  };
}

export default function WorkBoardView({
  currentUser,
  onUpdateTicket,
  onOpenTicket,
  embedded = false,
  displayTimezone = 'UTC',
}: WorkBoardViewProps) {
  useSetPageTitle('Work board');
  const splitExpand = useCoworkerSplitExpandOptional();
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [movingId, setMovingId] = useState<string | null>(null);

  // Board needs width — prefer content-majority split while this view is open.
  useEffect(() => {
    splitExpand?.focusContent();
    return () => splitExpand?.clearContentFocus();
  }, [splitExpand]);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/tickets?scope=assignee', {
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Failed to load board');
      const data = (await res.json()) as Ticket[];
      setTickets(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error(err);
      setError('Could not load your work board.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [currentUser.id]);

  const counts = useMemo(() => {
    const map = Object.fromEntries(COLUMNS.map((c) => [c, 0])) as Record<
      (typeof COLUMNS)[number],
      number
    >;
    for (const t of tickets) {
      const col = boardColumnFor(t.status);
      if (map[col] !== undefined) map[col] += 1;
    }
    return map;
  }, [tickets]);

  const byStatus = (status: BoardColumn) =>
    tickets.filter((t) => boardColumnFor(t.status) === status);

  const moveTicket = async (ticket: Ticket, next: BoardColumn) => {
    if (next === ticket.status) return;
    setMovingId(ticket.id);
    setError(null);
    try {
      const ok = await onUpdateTicket(ticket.id, { status: next });
      if (ok !== false) {
        setTickets((prev) =>
          prev.map((x) => (x.id === ticket.id ? { ...x, status: next } : x))
        );
      } else {
        setError('Could not update ticket status. Try again.');
      }
    } finally {
      setMovingId(null);
    }
  };

  const body = (
    <div className="flex flex-1 min-h-0 flex-col gap-3 overflow-y-auto xl:overflow-hidden px-3 sm:px-5 pt-1">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between rounded-xl border border-neutral-200/80 bg-neutral-50/70 px-3.5 py-3 shrink-0">
        <div className="min-w-0 flex items-start gap-3">
          <div className="mt-0.5 hidden sm:flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white border border-neutral-200 text-neutral-600 shadow-sm">
            <Inbox className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium text-neutral-800">
              Your assigned queue
            </p>
            <p className="mt-0.5 text-xs text-neutral-500">
              Only tickets assigned to you. Columns are by status (to do →
              resolved), not by who owns them.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 sm:gap-3 shrink-0">
          <div className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-2.5 py-1.5 text-[11px] font-medium text-neutral-600 shadow-sm">
            <span className="tabular-nums text-neutral-900 font-semibold">
              {tickets.length}
            </span>
            <span className="text-neutral-400">total</span>
            <span className="text-neutral-300" aria-hidden>
              ·
            </span>
            <span className="tabular-nums text-neutral-900 font-semibold">
              {counts.Open + counts.Pending + counts.Overdue}
            </span>
            <span className="text-neutral-400">active</span>
          </div>
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-3 text-xs font-semibold text-neutral-700 shadow-sm hover:bg-neutral-50 disabled:opacity-60"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`}
            />
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 shrink-0">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          {error}
        </div>
      )}

      {loading && tickets.length === 0 ? (
        <div className="flex flex-1 min-h-0 flex-col gap-3 overflow-y-auto pb-3 sm:pb-5 md:flex-row md:overflow-x-auto md:overflow-y-hidden">
          {COLUMNS.map((col) => (
            <div
              key={col}
              className="min-h-[140px] w-full rounded-2xl border border-neutral-200/80 bg-neutral-50/60 animate-pulse md:min-h-[220px] md:h-full md:min-w-[220px] md:w-[240px] md:flex-1"
            />
          ))}
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col pb-3 sm:pb-5">
          <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden md:overflow-x-auto md:overflow-y-hidden">
            <div className="flex h-auto min-h-0 flex-col gap-3 md:h-full md:min-w-full md:flex-row">
              {COLUMNS.map((col) => {
                const items = byStatus(col);
                const meta = COLUMN_META[col];
                return (
                  <section
                    key={col}
                    className={`flex min-h-0 w-full flex-col rounded-2xl border border-neutral-200/90 bg-white shadow-[0_1px_0_rgba(15,23,42,0.04)] border-t-[3px] md:h-full md:w-[min(100%,260px)] md:min-w-[220px] md:flex-1 ${meta.accent}`}
                  >
                  <header
                    className={`px-3.5 py-2.5 rounded-t-[13px] ${meta.header} flex items-center justify-between gap-2 shrink-0`}
                    title={meta.hint}
                  >
                    <div className="flex flex-col min-w-0">
                      <div className="flex items-center gap-2 min-w-0">
                        <span
                          className={`h-1.5 w-1.5 rounded-full shrink-0 ${meta.dot}`}
                        />
                        <h3 className="text-[13px] font-semibold text-neutral-900 truncate">
                          {meta.label}
                        </h3>
                      </div>
                      <p className="mt-0.5 pl-3.5 text-[10px] text-neutral-500 truncate">
                        {meta.hint}
                      </p>
                    </div>
                    <span className="text-[11px] font-semibold tabular-nums text-neutral-600 bg-white/90 border border-neutral-200/80 rounded-md px-1.5 py-0.5 shrink-0">
                      {items.length}
                    </span>
                  </header>

                  <div className="max-h-[min(40vh,22rem)] md:max-h-none flex-1 min-h-0 overflow-y-auto p-2.5 space-y-2.5">
                    {items.length === 0 ? (
                      <div className="min-h-[8rem] md:min-h-[12rem] md:h-full flex flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-neutral-200 bg-neutral-50/50 px-3 text-center">
                        <Inbox className="h-3.5 w-3.5 text-neutral-300" />
                        <p className="text-[11px] text-neutral-400">
                          Nothing here
                        </p>
                      </div>
                    ) : (
                      items.map((t) => {
                        const due = t.dueAt
                          ? formatDueLabel(t.dueAt, displayTimezone)
                          : null;
                        const prioKey = String(t.priority || 'medium').toLowerCase();
                        const prioClass =
                          PRIORITY_STYLE[prioKey] || PRIORITY_STYLE.medium;
                        const nextOptions = COLUMNS.filter(
                          (c) => c !== col && !(col !== 'Open' && c === 'Open')
                        );

                        return (
                          <article
                            key={t.id}
                            className="group rounded-xl border border-neutral-200 bg-white p-3 shadow-sm hover:border-neutral-300 hover:shadow-md transition-all"
                          >
                            <button
                              type="button"
                              onClick={() => onOpenTicket?.(t.id)}
                              className="w-full text-left"
                            >
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-[11px] font-mono font-medium text-neutral-500">
                                  {t.id}
                                </span>
                                <span
                                  className={`text-[10px] font-semibold uppercase tracking-wide rounded-md px-1.5 py-0.5 ${prioClass}`}
                                >
                                  {t.priority}
                                </span>
                              </div>
                              <p className="mt-2 text-[13px] font-semibold leading-snug text-neutral-900 line-clamp-2 group-hover:text-neutral-950">
                                {t.subject}
                              </p>
                              <p className="mt-1.5 text-[11px] text-neutral-500 truncate">
                                {t.customerName}
                              </p>
                              {due && (
                                <p
                                  className={`mt-2 inline-flex items-center gap-1 text-[11px] font-medium ${
                                    due.overdue
                                      ? 'text-rose-600'
                                      : 'text-neutral-500'
                                  }`}
                                  title={due.absolute}
                                >
                                  <Clock3 className="h-3 w-3 shrink-0" />
                                  {due.relative}
                                </p>
                              )}
                            </button>

                            {col !== 'Resolved' && nextOptions.length > 0 && (
                              <div className="mt-3 pt-2.5 border-t border-neutral-100">
                                <label className="sr-only" htmlFor={`move-${t.id}`}>
                                  Move ticket
                                </label>
                                <div className="relative">
                                  <ArrowRight className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 h-3 w-3 text-neutral-400" />
                                  <select
                                    id={`move-${t.id}`}
                                    disabled={movingId === t.id}
                                    defaultValue=""
                                    onClick={(e) => e.stopPropagation()}
                                    onChange={async (e) => {
                                      e.stopPropagation();
                                      const next = e.target.value as BoardColumn;
                                      e.target.value = '';
                                      if (!next) return;
                                      await moveTicket(t, next);
                                    }}
                                    className="w-full appearance-none rounded-lg border border-neutral-200 bg-neutral-50 pl-7 pr-7 py-1.5 text-[11px] font-medium text-neutral-700 hover:bg-white focus:outline-none focus:ring-2 focus:ring-neutral-900/10 disabled:opacity-60"
                                  >
                                    <option value="" disabled>
                                      Move to…
                                    </option>
                                    {nextOptions.map((next) => (
                                      <option key={next} value={next}>
                                        {COLUMN_META[next].label}
                                      </option>
                                    ))}
                                  </select>
                                </div>
                              </div>
                            )}
                          </article>
                        );
                      })
                    )}
                  </div>
                </section>
              );
            })}
            </div>
          </div>
        </div>
      )}
    </div>
  );

  if (embedded) return <div className="flex h-full min-h-0 flex-col">{body}</div>;

  return <PageShell fillHeight>{body}</PageShell>;
}
