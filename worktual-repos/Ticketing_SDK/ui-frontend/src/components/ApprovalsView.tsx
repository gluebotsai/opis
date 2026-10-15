import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  BarChart3,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  FileText,
  GitBranch,
  Lightbulb,
  RefreshCw,
  Send,
  Shield,
  ShieldAlert,
  Users,
  X,
  Zap,
} from 'lucide-react';
import { useSetPageTitle } from './layout/PageTitleContext';
import PageShell from './layout/PageShell';
import MenuSelect from './ui/menu-select';

type ApprovalRow = {
  id: string;
  agent_id?: string;
  agentId?: string;
  ticket_number?: string | null;
  ticketNumber?: string | null;
  summary: string;
  tool_name?: string | null;
  tool_args?: Record<string, unknown> | string | null;
  payload?: Record<string, unknown> | string | null;
  status?: string;
  created_at?: string;
  createdAt?: string;
};

type RecRow = {
  id: string;
  agent_id?: string;
  ticket_number?: string | null;
  summary: string;
  created_at?: string;
};

interface ApprovalsViewProps {
  embedded?: boolean;
  listRefreshToken?: number;
}

const PAGE_SIZE = 4;
const DRAFT_MAX = 8000;

const AGENT_FULL_NAMES: Record<string, string> = {
  tcaa: 'Ticket Creation & Capture Agent',
  icpa: 'Classification & Prioritization Agent',
  itra: 'Intelligent Routing Agent',
  dssa: 'Deflection & Self-Service Agent',
  tsaa: 'Ticket Summary Assistant',
  sema: 'SLA & Escalation Agent',
  rkaa: 'Resolution Knowledge Agent',
  crda: 'Customer Response Drafting Agent',
  ara: 'Autonomous Resolution Agent',
  wloa: 'Workload Optimization Agent',
  tiaa: 'Insights & Analytics Agent',
  stda: 'Similar Ticket Detection Agent',
  pna: 'Personalized Notifications Agent',
  rcaa: 'Root Cause & Learning Agent',
  rqa: 'Resolution Quality Agent',
};

function agentFullName(agentId: string | undefined | null): string {
  const key = (agentId || '').trim().toLowerCase();
  if (!key) return '';
  return AGENT_FULL_NAMES[key] || agentId!.trim();
}

function asRecord(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  if (typeof raw === 'string' && raw.trim()) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      /* ignore */
    }
  }
  return {};
}

function isCrdaApproval(row: ApprovalRow): boolean {
  const agent = String(row.agent_id || row.agentId || '')
    .trim()
    .toLowerCase();
  return agent === 'crda';
}

function isRqaApproval(row: ApprovalRow): boolean {
  const agent = String(row.agent_id || row.agentId || '')
    .trim()
    .toLowerCase();
  return agent === 'rqa';
}

function isDraftNoteApproval(row: ApprovalRow): boolean {
  return isCrdaApproval(row) || isRqaApproval(row);
}

function draftFromApproval(row: ApprovalRow): string {
  const args = asRecord(row.tool_args);
  const payload = asRecord(row.payload);
  const fromArgs = String(args.text || args.body || '').trim();
  if (fromArgs) return fromArgs;
  return String(payload.draft || '').trim();
}

function splitSummary(summary: string): { title: string; body: string } {
  const text = (summary || '').trim();
  if (!text) return { title: 'Recommendation', body: '' };
  const nl = text.indexOf('\n');
  if (nl > 0 && nl < 120) {
    return { title: text.slice(0, nl).trim(), body: text.slice(nl + 1).trim() };
  }
  const dot = text.indexOf('. ');
  if (dot > 20 && dot < 100) {
    return { title: text.slice(0, dot + 1).trim(), body: text.slice(dot + 2).trim() };
  }
  if (text.length <= 90) return { title: text, body: '' };
  return { title: `${text.slice(0, 86).trim()}…`, body: text };
}

function relativeWhen(iso: string | undefined): string | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  const mins = Math.max(0, Math.round((Date.now() - t) / 60000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

function AgentIcon({ agent }: { agent: string }) {
  const a = agent.toLowerCase();
  const cls = 'h-4 w-4';
  if (a === 'wloa') return <Users className={cls} />;
  if (a === 'tiaa') return <BarChart3 className={cls} />;
  if (a === 'stda' || a === 'rkaa') return <GitBranch className={cls} />;
  if (a === 'dssa' || a === 'tsaa') return <Lightbulb className={cls} />;
  if (a === 'sema') return <Clock className={cls} />;
  if (a === 'rqa' || a === 'crda') return <FileText className={cls} />;
  return <FileText className={cls} />;
}

export default function ApprovalsView({
  embedded = false,
  listRefreshToken = 0,
}: ApprovalsViewProps) {
  useSetPageTitle('Approvals');
  const [items, setItems] = useState<ApprovalRow[]>([]);
  const [recs, setRecs] = useState<RecRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [agentFilter, setAgentFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState<string | null>(null);
  const [draftReviewId, setDraftReviewId] = useState<string | null>(null);
  const [draftText, setDraftText] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [aRes, rRes] = await Promise.all([
        fetch('/api/proactive/approvals', { credentials: 'include' }),
        fetch('/api/proactive/recommendations', { credentials: 'include' }),
      ]);
      if (!aRes.ok) {
        setError(aRes.status === 403 ? 'Admin only' : 'Failed to load approvals');
        setItems([]);
        return;
      }
      const aBody = await aRes.json();
      // PNA delivers to the nav bell; never show Confirm/Reject for inbox pings.
      const rawItems: ApprovalRow[] = Array.isArray(aBody.items) ? aBody.items : [];
      setItems(
        rawItems.filter((row) => {
          const agent = String(row.agent_id || row.agentId || '')
            .trim()
            .toLowerCase();
          const tool = String(row.tool_name || '').trim();
          return agent !== 'pna' && tool !== 'send_staff_notification';
        })
      );
      if (rRes.ok) {
        const rBody = await rRes.json();
        const rawRecs: RecRow[] = Array.isArray(rBody.items) ? rBody.items : [];
        setRecs(
          rawRecs.filter((r) => {
            const agent = String(r.agent_id || '').trim().toLowerCase();
            return agent !== 'tsaa' && agent !== 'rcaa';
          })
        );
      }
    } catch {
      setError('Failed to load approvals');
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, listRefreshToken]);

  const decide = async (
    id: string,
    accept: boolean,
    opts?: { editedText?: string }
  ) => {
    setBusyId(id);
    setError(null);
    try {
      const r = await fetch(`/api/proactive/approvals/${encodeURIComponent(id)}/decide`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accept,
          edited_text: opts?.editedText,
        }),
      });
      const body = (await r.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        detail?: string;
      };
      if (!r.ok || body.ok === false) {
        setError(
          body.detail ||
            body.error ||
            (accept ? 'Confirm failed — ticket was not updated.' : 'Reject failed.')
        );
        return;
      }
      setDraftReviewId(null);
      setDraftText('');
      await load();
    } catch {
      setError(accept ? 'Confirm failed — ticket was not updated.' : 'Reject failed.');
    } finally {
      setBusyId(null);
    }
  };

  const openCrdaDraft = (row: ApprovalRow) => {
    setDraftReviewId(row.id);
    setDraftText(draftFromApproval(row));
    setError(null);
  };

  const draftRow = useMemo(
    () => items.find((r) => r.id === draftReviewId) || null,
    [items, draftReviewId]
  );

  const agents = useMemo(() => {
    const set = new Set<string>();
    for (const r of recs) {
      const a = (r.agent_id || '').trim().toUpperCase();
      if (a) set.add(a);
    }
    return [...set].sort();
  }, [recs]);

  const filteredRecs = useMemo(() => {
    if (agentFilter === 'all') return recs;
    return recs.filter((r) => (r.agent_id || '').toUpperCase() === agentFilter);
  }, [recs, agentFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredRecs.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageRecs = filteredRecs.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  const from = filteredRecs.length === 0 ? 0 : (safePage - 1) * PAGE_SIZE + 1;
  const to = Math.min(safePage * PAGE_SIZE, filteredRecs.length);

  useEffect(() => {
    setPage(1);
  }, [agentFilter, recs.length]);

  const ticketed = recs.filter((r) => r.ticket_number && r.ticket_number !== '—').length;

  const content = draftRow ? (
    <div className="max-w-3xl mx-auto w-full px-6 sm:px-10 py-6 pb-10 flex flex-col min-h-[70vh]">
      <div className="flex shrink-0 items-center gap-2.5 border-b border-[#e5e5e5] pb-4">
        <button
          type="button"
          onClick={() => {
            setDraftReviewId(null);
            setDraftText('');
            setError(null);
          }}
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-neutral-200 text-neutral-600 hover:bg-neutral-50 hover:text-neutral-900"
          aria-label="Back to approvals"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-neutral-900">
            {isRqaApproval(draftRow)
              ? 'Review closing note'
              : 'Review customer reply'}
          </p>
          <p className="truncate text-[11px] text-neutral-500">
            {agentFullName(draftRow.agent_id || draftRow.agentId)} ·{' '}
            {draftRow.ticket_number || draftRow.ticketNumber || 'ticket'} ·{' '}
            {isRqaApproval(draftRow) ? 'edit then Confirm' : 'edit then send'}
          </p>
        </div>
      </div>

      {error ? (
        <div className="mt-4 flex items-center gap-2 text-sm text-neutral-800 bg-neutral-100 border border-neutral-300 rounded-xl px-3 py-2">
          <ShieldAlert className="h-4 w-4 shrink-0" />
          {error}
        </div>
      ) : null}

      <label className="mt-5 block flex-1 min-h-0">
        <div className="mb-1.5 flex items-center justify-between gap-2">
          <span className="text-xs font-semibold text-neutral-800">
            {isRqaApproval(draftRow) ? 'Internal closing note' : 'Draft message'}
          </span>
          <span className="text-[10px] tabular-nums text-neutral-400">
            {draftText.length}/{DRAFT_MAX}
          </span>
        </div>
        <div className="overflow-hidden rounded-xl border border-neutral-200 focus-within:border-neutral-400 focus-within:ring-2 focus-within:ring-neutral-200/70 bg-white">
          <textarea
            value={draftText}
            maxLength={DRAFT_MAX}
            onChange={(e) => setDraftText(e.target.value.slice(0, DRAFT_MAX))}
            rows={14}
            placeholder={
              isRqaApproval(draftRow)
                ? 'Internal resolution note…'
                : 'Customer-facing reply…'
            }
            className="min-h-[16rem] w-full resize-y bg-transparent px-3.5 py-3 text-sm leading-relaxed text-neutral-900 placeholder:text-neutral-400 outline-none"
          />
        </div>
        <p className="mt-2 text-[11px] text-neutral-500">
          {isRqaApproval(draftRow)
            ? 'Confirm posts this as an internal note. The ticket stays Resolved. Reject discards the draft.'
            : 'Sending posts this as a public reply on the ticket. Reject discards the draft.'}
        </p>
      </label>

      <div className="mt-5 flex flex-wrap items-center justify-end gap-2 border-t border-[#e5e5e5] pt-4">
        <button
          type="button"
          disabled={busyId === draftRow.id}
          onClick={() => void decide(draftRow.id, false)}
          className="inline-flex items-center gap-1.5 rounded-xl border border-neutral-300 px-4 py-2.5 text-sm font-semibold text-neutral-800 disabled:opacity-50"
        >
          <X className="h-4 w-4" />
          Reject
        </button>
        <button
          type="button"
          disabled={busyId === draftRow.id || !draftText.trim()}
          onClick={() =>
            void decide(draftRow.id, true, { editedText: draftText.trim() })
          }
          className="inline-flex items-center gap-1.5 rounded-xl bg-neutral-900 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
        >
          <Send className="h-4 w-4" />
          {busyId === draftRow.id
            ? isRqaApproval(draftRow)
              ? 'Confirming…'
              : 'Sending…'
            : isRqaApproval(draftRow)
              ? 'Confirm note'
              : 'Send reply'}
        </button>
      </div>
    </div>
  ) : (
    <div className="@container mx-auto w-full min-w-0 max-w-5xl space-y-6 px-4 py-6 pb-10 @[560px]:px-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0 flex-1">
          <span className="mt-0.5 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-neutral-900 text-white">
            <Shield className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <h1 className="text-xl font-semibold text-neutral-900 tracking-tight">Approvals</h1>
            <p className="text-sm text-neutral-500 mt-1">
              High-risk proactive agent actions wait here. Confirm runs the same tools as chat.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-xl bg-neutral-900 px-4 text-sm font-medium text-white hover:bg-neutral-800"
        >
          <RefreshCw className="h-4 w-4" />
          Refresh
        </button>
      </div>

      {error ? (
        <div className="flex items-center gap-2 text-sm text-neutral-800 bg-neutral-100 border border-neutral-300 rounded-xl px-3 py-2">
          <ShieldAlert className="h-4 w-4 shrink-0" />
          {error}
        </div>
      ) : null}

      <div className="grid min-w-0 grid-cols-1 items-stretch gap-3 @[22rem]:grid-cols-2 @[56rem]:grid-cols-4">
        {[
          { label: 'Pending approvals', value: String(items.length), icon: FileText },
          { label: 'Open recommendations', value: String(recs.length), icon: Zap },
          { label: 'Agents', value: String(agents.length), icon: Users },
          { label: 'With ticket', value: String(ticketed), icon: Shield },
        ].map((m) => (
          <div
            key={m.label}
            className="flex h-full min-w-0 items-start gap-2.5 rounded-2xl border-[0.6px] border-[#bfbfbf] bg-white px-3.5 py-3.5 shadow-none"
          >
            <span className="inline-flex size-[38px] shrink-0 items-center justify-center rounded-xl bg-neutral-100 text-neutral-900">
              <m.icon className="size-[18px] stroke-[2.25]" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-xl font-semibold tabular-nums leading-none text-neutral-900">
                {loading ? '—' : m.value}
              </p>
              <p className="mt-2 text-[11px] leading-4 text-neutral-500">
                {m.label}
              </p>
            </div>
          </div>
        ))}
      </div>

      {items.length > 0 ? (
        <ul className="space-y-3">
          {items.map((row) => {
            const agent = (row.agent_id || row.agentId || 'agent').toUpperCase();
            const ticket = row.ticket_number || row.ticketNumber || '—';
            const draftable = isDraftNoteApproval(row);
            const preview = draftable ? draftFromApproval(row) : '';
            return (
              <li
                key={row.id}
                className={`flex overflow-hidden rounded-2xl border border-neutral-200 bg-white ${
                  draftable ? 'cursor-pointer hover:border-neutral-300' : ''
                }`}
                onClick={draftable ? () => openCrdaDraft(row) : undefined}
                onKeyDown={
                  draftable
                    ? (e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          openCrdaDraft(row);
                        }
                      }
                    : undefined
                }
                role={draftable ? 'button' : undefined}
                tabIndex={draftable ? 0 : undefined}
              >
                <div className="w-12 shrink-0 bg-neutral-100 flex items-center justify-center text-neutral-800">
                  <AgentIcon agent={agent} />
                </div>
                <div className="flex flex-1 flex-wrap items-start justify-between gap-3 p-4">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-neutral-900">
                      {row.summary || 'Action proposal'}
                    </p>
                    {preview ? (
                      <p className="mt-1.5 text-xs text-neutral-500 leading-relaxed line-clamp-2 whitespace-pre-wrap">
                        {preview}
                      </p>
                    ) : null}
                    <p className="text-xs text-neutral-500 mt-1.5">
                      <span className="inline-flex rounded-md border border-neutral-200 px-1.5 py-0.5 font-medium">
                        {agentFullName(agent)}
                      </span>
                      <span className="ml-2">{ticket}</span>
                    </p>
                  </div>
                  <div
                    className="flex gap-2 shrink-0"
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => e.stopPropagation()}
                  >
                    {draftable ? (
                      <button
                        type="button"
                        onClick={() => openCrdaDraft(row)}
                        className="inline-flex items-center gap-1 rounded-xl bg-neutral-900 px-3 py-2 text-xs font-semibold text-white"
                      >
                        Review draft
                        <ChevronRight className="h-3.5 w-3.5" />
                      </button>
                    ) : (
                      <>
                        <button
                          type="button"
                          disabled={busyId === row.id}
                          onClick={() => void decide(row.id, true)}
                          className="inline-flex items-center gap-1 rounded-xl bg-neutral-900 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
                        >
                          <Check className="h-3.5 w-3.5" />
                          Confirm
                        </button>
                        <button
                          type="button"
                          disabled={busyId === row.id}
                          onClick={() => void decide(row.id, false)}
                          className="inline-flex items-center gap-1 rounded-xl border border-neutral-300 px-3 py-2 text-xs font-semibold text-neutral-800 disabled:opacity-50"
                        >
                          <X className="h-3.5 w-3.5" />
                          Reject
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-neutral-900">Recommendations</h2>
          <p className="text-xs text-neutral-500 mt-0.5">
            Advisory output from proactive agents. No ticket writes until you confirm an approval.
          </p>
        </div>
        {agents.length > 0 ? (
          <MenuSelect
            label="Filter recommendations"
            value={agentFilter}
            className="w-[14rem] max-w-full"
            options={[
              { value: 'all', label: 'All recommendations' },
              ...agents.map((a) => ({
                value: a,
                label: agentFullName(a),
              })),
            ]}
            onChange={setAgentFilter}
          />
        ) : null}
      </div>

      {loading && recs.length === 0 ? (
        <p className="text-sm text-neutral-400">Loading…</p>
      ) : filteredRecs.length === 0 ? (
        <p className="text-sm text-neutral-500">No recommendations yet.</p>
      ) : (
        <>
          <ul className="space-y-3">
            {pageRecs.map((row, i) => {
              const agent = (row.agent_id || '').toUpperCase();
              const { title, body } = splitSummary(row.summary);
              const when = relativeWhen(row.created_at);
              const n = (safePage - 1) * PAGE_SIZE + i + 1;
              const open = openId === row.id;
              return (
                <li
                  key={row.id}
                  className="flex overflow-hidden rounded-2xl border border-neutral-200 bg-white"
                >
                  <div className="w-12 shrink-0 bg-neutral-100 flex items-start justify-center pt-4 text-neutral-800">
                    <AgentIcon agent={agent} />
                  </div>
                  <div className="flex-1 min-w-0 p-4 sm:p-5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-3 min-w-0">
                        <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-neutral-900 text-[11px] font-semibold text-white">
                          {n}
                        </span>
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-neutral-900">{title}</p>
                          {body ? (
                            <p
                              className={`text-xs text-neutral-500 mt-1.5 leading-relaxed ${
                                open ? 'whitespace-pre-wrap' : 'line-clamp-2'
                              }`}
                            >
                              {open ? row.summary : body}
                            </p>
                          ) : null}
                          <div className="flex flex-wrap items-center gap-2 mt-3">
                            {agent ? (
                              <span className="inline-flex rounded-md border border-neutral-200 bg-neutral-50 px-1.5 py-0.5 text-[10px] font-semibold text-neutral-700">
                                {agentFullName(agent)}
                              </span>
                            ) : null}
                            {when ? (
                              <span className="text-[10px] text-neutral-400">Suggested {when}</span>
                            ) : null}
                            {row.ticket_number ? (
                              <span className="text-[10px] text-neutral-400">{row.ticket_number}</span>
                            ) : null}
                          </div>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => setOpenId(open ? null : row.id)}
                        className="shrink-0 text-xs font-semibold text-neutral-800 inline-flex items-center gap-1 hover:underline"
                      >
                        {open ? 'Hide' : 'View details'}
                        <ChevronRight className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
            <p className="text-xs text-neutral-500">
              Showing {from} to {to} of {filteredRecs.length} recommendations
            </p>
            <div className="flex items-center gap-1">
              <button
                type="button"
                disabled={safePage <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="h-8 w-8 inline-flex items-center justify-center rounded-lg border border-neutral-300 text-neutral-700 disabled:opacity-40"
                aria-label="Previous page"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span className="h-8 min-w-8 px-2 inline-flex items-center justify-center rounded-lg bg-neutral-900 text-white text-xs font-semibold">
                {safePage}
              </span>
              <button
                type="button"
                disabled={safePage >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                className="h-8 w-8 inline-flex items-center justify-center rounded-lg border border-neutral-300 text-neutral-700 disabled:opacity-40"
                aria-label="Next page"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );

  if (embedded) return content;
  return <PageShell>{content}</PageShell>;
}
