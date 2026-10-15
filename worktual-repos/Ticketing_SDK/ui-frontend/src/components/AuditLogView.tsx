import React, { useEffect, useState } from 'react';
import { AlertTriangle, Filter, RefreshCw, Search, X } from 'lucide-react';
import { useSetPageTitle } from './layout/PageTitleContext';
import PageShell from './layout/PageShell';
import MenuSelect from './ui/menu-select';

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

const ACTION_LABELS: Record<string, string> = {
  'ticket.created': 'Created',
  'ticket.updated': 'Updated',
  'ticket.assigned': 'Assigned',
  'ticket.resolver_set': 'Resolver set',
  'ticket.status_changed': 'Status changed',
  'ticket.escalated': 'Escalated',
  'ticket.note_added': 'Note added',
  'ticket.note_edited': 'Note edited',
  'ticket.note_deleted': 'Note deleted',
  'ticket.rated': 'Rated',
};

const FIELD_LABELS: Record<string, string> = {
  subject: 'Subject',
  description: 'Description',
  priority: 'Priority',
  queue: 'Team',
  assignee: 'Agent',
  resolver: 'Resolver',
  status: 'Status',
  category: 'Category',
};

function formatAction(action: string): string {
  if (ACTION_LABELS[action]) return ACTION_LABELS[action];
  const raw = action.replace(/^ticket\./, '').replace(/_/g, ' ').trim();
  return raw
    ? raw.replace(/\b\w/g, (ch) => ch.toUpperCase())
    : 'Updated';
}

function humanizeMetaValue(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  if (Array.isArray(value)) {
    return value.map((item) => humanizeMetaValue(item)).filter(Boolean).join(', ');
  }
  return String(value).trim();
}

function isBlankName(value: string): boolean {
  const s = value.trim();
  return !s || s === '—' || s === '-' || s.toLowerCase() === 'unassigned' || s.toLowerCase() === 'none';
}

function formatNoteVisibility(value: unknown): string {
  const key = String(value || '').trim().toLowerCase();
  if (key === 'internal') return 'Internal note';
  if (key === 'public') return 'Customer-visible note';
  if (!key) return 'Note';
  return `${key.charAt(0).toUpperCase()}${key.slice(1)} note`;
}

function fieldLabel(key: string): string {
  return FIELD_LABELS[key] || key.replace(/_/g, ' ');
}

function prettyValue(value: unknown, field?: string): string {
  const raw = humanizeMetaValue(value);
  if (!raw) return '';
  if (field === 'priority' || field === 'status') {
    return raw.charAt(0).toUpperCase() + raw.slice(1);
  }
  return raw;
}

function actorLabel(name: string | null | undefined, via?: unknown): string {
  const n = String(name || '').trim();
  if (n) return n;
  if (String(via || '').trim().toLowerCase() === 'customer') return 'Customer';
  return 'Someone';
}

function ticketPhrase(ticketNumber: string | null | undefined): string {
  const raw = String(ticketNumber || '').trim();
  if (!raw) return 'the ticket';
  const id = raw.startsWith('#') ? raw : `#${raw}`;
  return `ticket ${id}`;
}

function joinClauses(parts: string[]): string {
  const clean = parts.map((p) => p.trim()).filter(Boolean);
  if (clean.length === 0) return '';
  if (clean.length === 1) return clean[0];
  if (clean.length === 2) return `${clean[0]} and ${clean[1]}`;
  return `${clean.slice(0, -1).join(', ')}, and ${clean[clean.length - 1]}`;
}

function changeClause(field: string, fromRaw: unknown, toRaw: unknown): string {
  const label = fieldLabel(field).toLowerCase();
  const from = prettyValue(fromRaw, field);
  const to = prettyValue(toRaw, field);
  if (field === 'description') return 'the description';
  if (from && to && from !== to) return `the ${label} from ${from} to ${to}`;
  if (to) return `the ${label} to ${to}`;
  if (from) return `the ${label}`;
  return `the ${label}`;
}

function clausesFromFields(fields: Record<string, unknown>): string[] {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(fields)) {
    if (value == null || value === '') continue;
    if (typeof value === 'boolean') {
      if (value) parts.push(`the ${fieldLabel(key).toLowerCase()}`);
      continue;
    }
    if (typeof value === 'object' && !Array.isArray(value)) {
      const row = value as Record<string, unknown>;
      parts.push(changeClause(key, row.from, row.to ?? row.value));
      continue;
    }
    parts.push(changeClause(key, null, value));
  }
  return parts;
}

function clausesFromChanges(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const parts: string[] = [];
  for (const item of raw) {
    if (typeof item === 'string') {
      const text = item.trim();
      if (!text) continue;
      const arrow = text.match(/(?:^|:\s*)([A-Za-z_]+)\s*→\s*(.+)$/);
      if (arrow) {
        parts.push(changeClause(arrow[1], null, arrow[2].trim()));
        continue;
      }
      parts.push(text);
      continue;
    }
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const field = String(row.field || row.key || '').trim();
    if (!field) continue;
    parts.push(changeClause(field, row.from, row.to));
  }
  return parts;
}

const LOOSE_META_SKIP = new Set([
  'changes',
  'fields',
  'via',
  'harness',
  'idempotencyKey',
  'idempotency_key',
  'source',
  'event',
  'ruleIds',
  'auto',
  'assigneeId',
  'resolverId',
  'ticketId',
  'score',
  'csatScore',
  'csat',
  'preview',
  'visibility',
]);

function clausesFromLooseMeta(meta: Record<string, unknown>): string[] {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(meta)) {
    if (LOOSE_META_SKIP.has(key)) continue;
    if (!FIELD_LABELS[key] && key !== 'assignee' && key !== 'resolver') continue;
    if (value == null || value === '') continue;
    if (typeof value === 'boolean') {
      if (value) parts.push(`the ${fieldLabel(key).toLowerCase()}`);
      continue;
    }
    if (typeof value === 'object' && !Array.isArray(value)) {
      const row = value as Record<string, unknown>;
      parts.push(changeClause(key, row.from, row.to ?? row.value));
      continue;
    }
    parts.push(changeClause(key, null, value));
  }
  return parts;
}

function updateClauses(meta: Record<string, unknown>): string[] {
  const fromChanges = clausesFromChanges(meta.changes);
  const fromFields =
    meta.fields && typeof meta.fields === 'object' && !Array.isArray(meta.fields)
      ? clausesFromFields(meta.fields as Record<string, unknown>)
      : [];
  const fromLoose = clausesFromLooseMeta(meta);
  return [...fromChanges, ...fromFields, ...fromLoose];
}

function formatAuditSentence(event: AuditEvent): string {
  const meta = event.meta && typeof event.meta === 'object' ? event.meta : {};
  const who = actorLabel(event.actorName, meta.via);
  const ticket = ticketPhrase(event.ticketNumber);
  const action = event.action;
  const toStatus = prettyValue(meta.to, 'status').toLowerCase();
  const toName = humanizeMetaValue(meta.to);
  const fromName = humanizeMetaValue(meta.from);

  if (action === 'ticket.created') {
    const subject = humanizeMetaValue(meta.subject);
    return subject
      ? `${who} created ${ticket} with subject “${subject}”.`
      : `${who} created ${ticket}.`;
  }

  if (action === 'ticket.rated') {
    const score = Number(meta.score ?? meta.csatScore ?? meta.csat);
    if (Number.isFinite(score) && score > 0) {
      return `${who} closed the ticket with a ${score}-star rating.`;
    }
    return `${who} rated ${ticket}.`;
  }

  if (action === 'ticket.status_changed') {
    if (toStatus === 'reopened') {
      return `${who} reopened ${ticket}.`;
    }
    if (toStatus === 'closed') {
      const score = Number(meta.score ?? meta.csatScore);
      if (Number.isFinite(score) && score > 0) {
        return `${who} closed the ticket with a ${score}-star rating.`;
      }
      return `${who} closed ${ticket}.`;
    }
    if (toStatus === 'resolved') {
      return `${who} marked ${ticket} as Resolved.`;
    }
    if (toName && fromName && !isBlankName(fromName)) {
      return `${who} changed the status of ${ticket} from ${prettyValue(meta.from, 'status')} to ${prettyValue(meta.to, 'status')}.`;
    }
    if (toName) {
      return `${who} set the status of ${ticket} to ${prettyValue(meta.to, 'status')}.`;
    }
    return `${who} updated the status of ${ticket}.`;
  }

  if (action === 'ticket.assigned') {
    if (toName && fromName && !isBlankName(fromName)) {
      return `${who} assigned ${ticket} from ${fromName} to ${toName}.`;
    }
    if (toName) return `${who} assigned ${ticket} to ${toName}.`;
    return `${who} updated the assignee on ${ticket}.`;
  }

  if (action === 'ticket.resolver_set') {
    if (toName && fromName && !isBlankName(fromName)) {
      return `${who} changed the resolver on ${ticket} from ${fromName} to ${toName}.`;
    }
    if (toName) return `${who} set the resolver on ${ticket} to ${toName}.`;
    return `${who} updated the resolver on ${ticket}.`;
  }

  if (action === 'ticket.escalated') {
    if (toName) return `${who} escalated ${ticket} to ${toName}.`;
    return `${who} escalated ${ticket}.`;
  }

  if (action === 'ticket.note_added') {
    const preview = humanizeMetaValue(meta.preview);
    const kind = formatNoteVisibility(meta.visibility).toLowerCase();
    return preview
      ? `${who} added ${kind === 'note' ? 'a note' : `a ${kind}`} on ${ticket}: “${preview}”.`
      : `${who} added a note on ${ticket}.`;
  }

  if (action === 'ticket.note_edited') {
    const preview = humanizeMetaValue(meta.preview || meta.to);
    return preview
      ? `${who} edited a note on ${ticket}: “${preview}”.`
      : `${who} edited a note on ${ticket}.`;
  }

  if (action === 'ticket.note_deleted') {
    const preview = humanizeMetaValue(meta.preview);
    return preview
      ? `${who} deleted a note on ${ticket}: “${preview}”.`
      : `${who} deleted a note on ${ticket}.`;
  }

  if (action === 'ticket.updated') {
    const joined = joinClauses(updateClauses(meta));
    return joined
      ? `${who} updated ${joined}.`
      : `${who} updated ${ticket}.`;
  }

  if (meta.from != null || meta.to != null) {
    if (toName && fromName && !isBlankName(fromName)) {
      return `${who} changed ${ticket} from ${fromName} to ${toName}.`;
    }
    if (toName) return `${who} set ${ticket} to ${toName}.`;
  }

  return `${who} updated ${ticket}.`;
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
    if (e.action === 'ticket.updated') {
      const meta = e.meta && typeof e.meta === 'object' ? e.meta : {};
      if (updateClauses(meta).length === 0) return false;
    }
    if (actionFilter !== 'All' && e.action !== actionFilter) return false;
    const needle = searchQuery.trim().toLowerCase().replace(/^#/, '');
    if (!needle) return true;
    const detail = formatAuditSentence(e).toLowerCase();
    return (
      String(e.actorName || '').toLowerCase().includes(needle) ||
      String(e.ticketNumber || '').toLowerCase().includes(needle) ||
      formatAction(e.action).toLowerCase().includes(needle) ||
      e.action.toLowerCase().includes(needle) ||
      detail.includes(needle)
    );
  });

  const body = (
    <div className="flex h-full min-h-0 min-w-0 w-full flex-col overflow-hidden">
      {error && (
        <div className="mb-3 flex shrink-0 items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[13px] text-amber-900">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="flex min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden bg-white shadow-none">
        <div className="shrink-0 min-w-0 border-b border-[#e5e5e5] bg-neutral-50/70 p-2.5 font-sans">
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
              <Filter className="h-3.5 w-3.5 text-neutral-400" />
              <span>Filters</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="tabular-nums text-[11px] text-neutral-400">
                {loading ? '…' : `${filtered.length}`}
              </span>
              <button
                type="button"
                onClick={() => void load()}
                disabled={loading}
                aria-label="Refresh audit log"
                className="inline-flex size-[38px] shrink-0 items-center justify-center rounded-lg border-[0.6px] border-[#bfbfbf] bg-white text-neutral-700 shadow-none outline-none hover:bg-neutral-50 focus:border-neutral-400 disabled:opacity-50"
              >
                <RefreshCw className={`h-[18px] w-[18px] ${loading ? 'animate-spin' : ''}`} strokeWidth={2.25} />
              </button>
            </div>
          </div>

          <div className="relative mb-2">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-neutral-400" />
            <input
              type="text"
              placeholder="Search ticket or actor..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-[38px] w-full rounded-lg border-[0.6px] border-[#bfbfbf] bg-white py-2 pl-9 pr-8 text-sm text-black shadow-none placeholder-neutral-400 focus:border-neutral-400 focus:outline-none"
            />
            {searchQuery ? (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-2 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded text-neutral-400 hover:text-black"
                title="Clear search"
              >
                <X className="h-3 w-3" />
              </button>
            ) : null}
          </div>

          <MenuSelect
            label="Filter by action"
            value={actionFilter}
            options={[
              { value: 'All', label: 'All actions' },
              ...actions.map((a) => ({ value: a, label: formatAction(a) })),
            ]}
            onChange={setActionFilter}
          />
        </div>

        <div
          id="audit-list-scroll"
          className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain [scrollbar-gutter:stable]"
        >
          {loading && events.length === 0 ? (
            <p className="px-4 py-16 text-center text-sm text-neutral-400">Loading…</p>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 px-4 py-16 text-center">
              <AlertTriangle className="h-5 w-5 shrink-0 text-neutral-700" />
              <p className="max-w-sm text-sm font-medium text-neutral-700">
                No audit events yet.
              </p>
            </div>
          ) : (
            <ul id="audit-list" className="divide-y divide-[#e5e5e5]">
              {filtered.map((e) => {
                const meta = formatAuditSentence(e);
                return (
                  <li key={e.id} className="min-w-0">
                    <div className="grid w-full min-w-0 grid-cols-[minmax(0,1fr)_auto] items-start gap-x-4 gap-y-1.5 px-4 py-3.5">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="w-14 shrink-0 font-mono text-[14px] font-semibold tabular-nums text-neutral-600">
                          {e.ticketNumber || '—'}
                        </span>
                        <span className="min-w-0 text-[14px] font-semibold leading-5 text-[#171717]">
                          {formatAction(e.action)}
                        </span>
                      </div>
                      <time
                        dateTime={e.createdAt}
                        className="shrink-0 self-center font-mono text-[14px] tabular-nums text-neutral-600"
                        title={new Date(e.createdAt).toLocaleString()}
                      >
                        {formatWhen(e.createdAt)}
                      </time>
                      <p
                        className="col-start-1 min-w-0 whitespace-pre-wrap break-words pl-16 text-[14px] leading-5 text-[#525252]"
                        title={meta}
                      >
                        {meta || '—'}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );

  return (
    <PageShell embedded={embedded} fillHeight>
      {body}
    </PageShell>
  );
}
