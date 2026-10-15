import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Search, AlertTriangle, CheckCircle2, ArrowLeft, ChevronLeft, ChevronRight, Mail, MessageSquare, PhoneCall, Globe } from 'lucide-react';
import { Channel, Customer, Priority, TicketStatus } from '../types';
import { useSetPageTitle } from './layout/PageTitleContext';
import PageShell from './layout/PageShell';
import { useReportFocusedEntity } from './coworker/CoworkerSessionContext';
import { useCoworkerPageBridge } from './coworker/CoworkerSplitWorkspace';
import {
  pendingOpenFromAction,
  type PendingEntityOpen,
} from './coworker/coworkerActions';
import MenuSelect from './ui/menu-select';
const DIRECTORY_PAGE = 25;

type DirectorySort = 'name' | 'name_desc' | 'latest';

function asDirectoryCount(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function parseDirectoryPage(data: unknown): {
  rows: Customer[];
  hasMore: boolean;
  totalRows: number;
  offset: number;
  limit: number;
} {
  if (Array.isArray(data)) {
    const rows = data as Customer[];
    return {
      rows,
      hasMore: false,
      totalRows: rows.length,
      offset: 0,
      limit: DIRECTORY_PAGE,
    };
  }
  if (data && typeof data === 'object') {
    const rec = data as {
      data?: unknown;
      hasMore?: unknown;
      totalRows?: unknown;
      offset?: unknown;
      limit?: unknown;
    };
    const rows = Array.isArray(rec.data) ? (rec.data as Customer[]) : [];
    const offset = asDirectoryCount(rec.offset) ?? 0;
    const limit = asDirectoryCount(rec.limit) || DIRECTORY_PAGE;
    const totalRows = asDirectoryCount(rec.totalRows) ?? rows.length;
    return {
      rows,
      hasMore: Boolean(rec.hasMore) || offset + rows.length < totalRows,
      totalRows,
      offset,
      limit,
    };
  }
  return { rows: [], hasMore: false, totalRows: 0, offset: 0, limit: DIRECTORY_PAGE };
}

const CUSTOMER_GUIDED_STEPS = [
  { id: 'name', title: 'Customer name', prompt: 'their full name' },
  { id: 'email', title: 'Email address', prompt: 'their email address' },
  { id: 'phone', title: 'Phone number', prompt: 'their phone number' },
  { id: 'confirm', title: 'Ready to add', prompt: 'tell me to add them, or change a field' },
] as const;

type CustomerGuidedStepId = (typeof CUSTOMER_GUIDED_STEPS)[number]['id'];

function normalizeCustomerStep(raw: string | undefined | null): CustomerGuidedStepId {
  const step = String(raw || 'name').trim().toLowerCase();
  if (step === 'contact') return 'email';
  if (step === 'email' || step === 'phone' || step === 'confirm') return step;
  return 'name';
}

function customerStepIndex(id: string | undefined | null): number {
  const mapped = normalizeCustomerStep(id);
  const idx = CUSTOMER_GUIDED_STEPS.findIndex((s) => s.id === mapped);
  return idx >= 0 ? idx : 0;
}

const AVATAR_TONES = [
  'bg-sky-100 text-sky-700',
  'bg-teal-100 text-teal-700',
  'bg-violet-100 text-violet-700',
  'bg-amber-100 text-amber-800',
  'bg-rose-100 text-rose-700',
  'bg-emerald-100 text-emerald-700',
] as const;

function customerInitials(name: string): string {
  const parts = String(name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0][0].toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

function customerAvatarTone(name: string): string {
  const key = String(name || '');
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) hash = (hash + key.charCodeAt(i)) % AVATAR_TONES.length;
  return AVATAR_TONES[hash];
}

const TICKET_PRIORITY_CARD_THEME: Record<
  string,
  { wash: string; pill: string; hoverBorder: string }
> = {
  urgent: {
    wash: 'from-rose-50/70 via-rose-50/25 to-white',
    pill: 'bg-rose-50/70 text-rose-600 border-rose-100/80',
    hoverBorder: 'hover:border-rose-200/70',
  },
  high: {
    wash: 'from-amber-50/70 via-amber-50/25 to-white',
    pill: 'bg-amber-50/70 text-amber-700 border-amber-100/80',
    hoverBorder: 'hover:border-amber-200/70',
  },
  medium: {
    wash: 'from-sky-50/70 via-sky-50/25 to-white',
    pill: 'bg-sky-50/70 text-sky-700 border-sky-100/80',
    hoverBorder: 'hover:border-sky-200/70',
  },
  low: {
    wash: 'from-teal-50/70 via-teal-50/25 to-white',
    pill: 'bg-teal-50/70 text-teal-700 border-teal-100/80',
    hoverBorder: 'hover:border-teal-200/70',
  },
};

function ticketPriorityTheme(priority: Priority) {
  const key = String(priority || 'medium').trim().toLowerCase();
  return TICKET_PRIORITY_CARD_THEME[key] ?? TICKET_PRIORITY_CARD_THEME.medium;
}

function ticketCardInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

function ticketStatusBadgeClass(status: TicketStatus) {
  switch (status) {
    case 'Open':
      return 'bg-rose-50 text-rose-700 border-rose-200/60';
    case 'Pending':
    case 'In Progress':
      return 'bg-blue-50 text-blue-700 border-blue-200/60';
    case 'Reopened':
      return 'bg-amber-50 text-amber-800 border-amber-200/60';
    case 'Resolved':
      return 'bg-emerald-50 text-emerald-700 border-emerald-200/60';
    case 'Overdue':
      return 'bg-red-100 text-red-800 border-red-300';
    default:
      return 'bg-neutral-50 text-neutral-600 border-neutral-200';
  }
}

function ticketChannelIcon(channel: Channel) {
  switch (channel) {
    case 'Email':
      return <Mail className="h-3.5 w-3.5 text-neutral-500" aria-hidden />;
    case 'Chat':
    case 'Webchat':
    case 'WhatsApp':
    case 'Instagram':
    case 'Facebook':
      return <MessageSquare className="h-3.5 w-3.5 text-neutral-500" aria-hidden />;
    case 'Phone':
      return <PhoneCall className="h-3.5 w-3.5 text-neutral-500" aria-hidden />;
    default:
      return <Globe className="h-3.5 w-3.5 text-neutral-500" aria-hidden />;
  }
}

function normalizeChannel(raw: string | undefined): Channel {
  const value = String(raw || 'Web').trim();
  return value || 'Web';
}

function relativeTicketWhen(value?: string) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  const diffMs = Date.now() - d.getTime();
  const mins = Math.floor(Math.abs(diffMs) / 60000);
  const hours = Math.floor(mins / 60);
  const days = Math.floor(hours / 24);
  if (Math.abs(diffMs) < 60000) return 'Just now';
  if (mins < 60) return diffMs >= 0 ? `${mins}m ago` : `in ${mins}m`;
  if (hours < 48) return diffMs >= 0 ? `${hours}h ago` : `in ${hours}h`;
  if (days < 14) return diffMs >= 0 ? `${days}d ago` : `in ${days}d`;
  return d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function GuidedCustomerPreview({
  draft,
  stepIndex,
  saving = false,
  complete = false,
  onCancel,
  onUseForm,
  onConfirmCreate,
}: {
  draft: { name: string; email: string; phone: string };
  stepIndex: number;
  saving?: boolean;
  complete?: boolean;
  onCancel: () => void;
  onUseForm?: () => void;
  onConfirmCreate?: () => void;
}) {
  const total = CUSTOMER_GUIDED_STEPS.length;
  const hasName = Boolean(draft.name.trim());
  const hasEmail = Boolean(draft.email.trim());
  const hasPhone = Boolean(draft.phone.trim());
  const filed = complete;
  let displayStep = stepIndex;
  if (filed) {
    displayStep = total;
  } else if (displayStep > 0 && !hasName) displayStep = 0;
  else if (displayStep > 1 && !hasEmail) displayStep = 1;
  else if (displayStep > 2 && !hasPhone) displayStep = 2;
  const pct = Math.min(100, Math.round((displayStep / total) * 100));
  const current = CUSTOMER_GUIDED_STEPS[Math.min(displayStep, total - 1)];
  const completed = (
    filed ? CUSTOMER_GUIDED_STEPS : CUSTOMER_GUIDED_STEPS.slice(0, displayStep)
  ).filter((s) => {
    if (filed) return true;
    if (s.id === 'name') return hasName;
    if (s.id === 'email') return hasEmail;
    if (s.id === 'phone') return hasPhone;
    return true;
  });
  const pending = filed ? [] : CUSTOMER_GUIDED_STEPS.slice(displayStep + 1);
  const label = draft.name.trim() || 'New customer';
  const canSave = hasName && hasEmail && hasPhone;

  return (
    <div className="h-full min-h-0 flex flex-col border-[0.6px] border-[#bfbfbf] bg-white rounded-2xl shadow-none overflow-hidden">
      <div className="px-4 py-4 border-b border-neutral-100 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] font-medium uppercase tracking-wide text-neutral-400">
              Creating with co-worker
            </p>
            <h3 className="text-base font-semibold text-neutral-900 truncate">{label}</h3>
            {draft.email ? (
              <p className="text-xs text-neutral-500 mt-0.5 truncate">{draft.email}</p>
            ) : null}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {onUseForm && (
              <button
                type="button"
                onClick={onUseForm}
                className="text-xs font-semibold text-neutral-700 hover:text-black underline-offset-2 hover:underline"
              >
                Use form
              </button>
            )}
            <button
              type="button"
              onClick={onCancel}
              className="text-xs font-medium text-neutral-500 hover:text-neutral-900"
            >
              Cancel
            </button>
          </div>
        </div>
        <div>
          <div className="flex items-center justify-between text-[11px] text-neutral-500 mb-1.5">
            <span>
              {filed
                ? `Step ${total} of ${total}`
                : `Step ${Math.min(displayStep + 1, total)} of ${total}`}
            </span>
            <span className="tabular-nums">{pct}%</span>
          </div>
          <div className="h-2 rounded-full bg-neutral-100 overflow-hidden">
            <div className="h-full bg-black transition-all duration-300" style={{ width: `${pct}%` }} />
          </div>
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4 space-y-5">
        <section className="space-y-2">
          <p className="text-[10px] font-medium uppercase tracking-wide text-neutral-400">
            {filed ? 'Added' : 'Up next'}
          </p>
          {!filed && (
          <div className="rounded-xl border border-neutral-200 bg-neutral-50/80 p-4">
            <p className="text-sm font-semibold text-neutral-900">{current.title}</p>
            <p className="text-xs text-neutral-500 mt-1 leading-relaxed">
              Next in chat: {current.prompt}
            </p>
            {current.id === 'confirm' && (
              <div className="mt-3 space-y-3">
                <dl className="text-xs space-y-1.5 text-neutral-600">
                  <div className="flex gap-2">
                    <dt className="w-20 shrink-0 text-neutral-400">Name</dt>
                    <dd className="font-medium text-neutral-900">{draft.name || '—'}</dd>
                  </div>
                  <div className="flex gap-2">
                    <dt className="w-20 shrink-0 text-neutral-400">Email</dt>
                    <dd className="font-medium text-neutral-900">{draft.email || '—'}</dd>
                  </div>
                  <div className="flex gap-2">
                    <dt className="w-20 shrink-0 text-neutral-400">Phone</dt>
                    <dd className="font-medium text-neutral-900">{draft.phone || '—'}</dd>
                  </div>
                </dl>
                {onConfirmCreate && (
                  <button
                    type="button"
                    disabled={saving || !canSave}
                    onClick={onConfirmCreate}
                    className="h-9 px-3 rounded-xl bg-black text-white text-xs font-semibold hover:bg-neutral-800 disabled:opacity-50"
                  >
                    {saving ? 'Saving…' : 'Save customer'}
                  </button>
                )}
              </div>
            )}
          </div>
          )}
          {!filed && pending.length > 0 && (
            <ul className="space-y-1.5 pt-1">
              {pending.map((s) => (
                <li
                  key={s.id}
                  className="text-xs text-neutral-400 px-3 py-2 rounded-lg border border-dashed border-neutral-200"
                >
                  {s.title}
                </li>
              ))}
            </ul>
          )}
        </section>
        {completed.length > 0 && (
          <section className="space-y-2">
            <p className="text-[10px] font-medium uppercase tracking-wide text-neutral-400">
              Completed
            </p>
            <ul className="space-y-2">
              {completed.map((s) => (
                <li
                  key={s.id}
                  className="flex items-start gap-2 rounded-lg border border-neutral-100 bg-white px-3 py-2"
                >
                  <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-neutral-900" />
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-neutral-800">{s.title}</p>
                    <p className="text-[11px] text-neutral-500 truncate">
                      {s.id === 'name'
                        ? draft.name
                        : s.id === 'email'
                          ? draft.email
                          : s.id === 'phone'
                            ? draft.phone
                            : ''}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}

type Customer360Ticket = {
  id: string;
  subject: string;
  status: string;
  priority?: string;
  assignee?: string;
  queue?: string | null;
  customerName?: string;
  createdByName?: string;
  channel?: string;
  createdAt?: string;
  updatedAt?: string;
};

export default function CustomersView({
  externalSearchQuery,
  externalStatusFilter,
  embedded = false,
  canMutate = false,
  startCreateIntent = false,
  startCreateSeed = null,
  onConsumeCreateIntent,
  listRefreshToken = 0,
  moduleResetKey = 0,
  onOpenTicket,
  focusedCustomer = null,
  onFocusedCustomerChange,
}: {
  canMutate?: boolean;
  externalSearchQuery?: string;
  /** Active | Inactive — from co-worker filter actions. */
  externalStatusFilter?: string;
  embedded?: boolean;
  startCreateIntent?: boolean;
  startCreateSeed?: {
    step?: string;
    name?: string;
    email?: string;
    phone?: string;
  } | null;
  onConsumeCreateIntent?: () => void;
  listRefreshToken?: number;
  moduleResetKey?: number;
  onOpenTicket?: (ticketNumber: string, customer?: Customer) => void;
  focusedCustomer?: Customer | null;
  onFocusedCustomerChange?: (customer: Customer | null) => void;
}) {
  useSetPageTitle('Customers');
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const fetchGenRef = useRef(0);
  const [listOffset, setListOffset] = useState(0);
  const [listHasMore, setListHasMore] = useState(false);
  const [listTotal, setListTotal] = useState<number | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>('All');
  const [sortOrder, setSortOrder] = useState<DirectorySort>('name');
  const [showAdd, setShowAdd] = useState(false);
  const [guided, setGuided] = useState(false);
  const [guidedStepIndex, setGuidedStepIndex] = useState(0);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [formMsg, setFormMsg] = useState('');
  const [form, setForm] = useState({
    name: '',
    email: '',
    phone: '',
    accountName: '',
    externalId: '',
  });
  const [businessType, setBusinessType] = useState<'b2b' | 'b2c'>('b2c');
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(
    focusedCustomer?.id || null
  );
  const selectedCustomer =
    customers.find((c) => c.id === selectedCustomerId) ||
    (focusedCustomer?.id === selectedCustomerId ? focusedCustomer : null);

  const selectCustomer = useCallback(
    (customer: Customer | null) => {
      setSelectedCustomerId(customer?.id || null);
      onFocusedCustomerChange?.(customer);
    },
    [onFocusedCustomerChange]
  );
  const [customerTickets, setCustomerTickets] = useState<Customer360Ticket[]>([]);
  const [customerTicketsLoading, setCustomerTicketsLoading] = useState(false);
  const [customerTicketsTotal, setCustomerTicketsTotal] = useState<number | null>(null);
  const pendingOpenCustomerRef = useRef<PendingEntityOpen | null>(null);
  const pageBridge = useCoworkerPageBridge();

  const resolveOpenCustomer = useCallback(
    (rows: Customer[], pending: PendingEntityOpen | null) => {
      if (!pending) return;
      const byId = pending.id ? rows.find((c) => c.id === pending.id) : undefined;
      const needle = String(pending.title || pending.name || '')
        .trim()
        .toLowerCase();
      const byName = needle
        ? rows.find((c) => String(c.name || '').trim().toLowerCase() === needle)
        : undefined;
      const byEmail = pending.email
        ? rows.find(
            (c) =>
              String(c.email || '').trim().toLowerCase() ===
              pending.email!.trim().toLowerCase()
          )
        : undefined;
      const hit = byId || byName || byEmail;
      if (hit) selectCustomer(hit);
      else if (needle) setSearchQuery(String(pending.title || pending.name || ''));
    },
    [selectCustomer]
  );
  useReportFocusedEntity(
    selectedCustomer
      ? { type: 'customer', id: selectedCustomer.id, name: selectedCustomer.name }
      : null
  );

  useEffect(() => {
    if (!focusedCustomer) return;
    setSelectedCustomerId(focusedCustomer.id);
  }, [focusedCustomer]);

  useEffect(() => {
    if (externalSearchQuery !== undefined) setSearchQuery(externalSearchQuery);
  }, [externalSearchQuery]);

  useEffect(() => {
    const id = selectedCustomer?.id || '';
    const email = String(selectedCustomer?.email || '').trim();
    const phone = String(selectedCustomer?.phone || '').trim();
    if (!id) {
      setCustomerTickets([]);
      setCustomerTicketsTotal(null);
      setCustomerTicketsLoading(false);
      return;
    }
    if (!email && !phone && !id) {
      setCustomerTickets([]);
      setCustomerTicketsTotal(0);
      setCustomerTicketsLoading(false);
      return;
    }
    let cancelled = false;
    setCustomerTicketsLoading(true);
    const qs = new URLSearchParams();
    if (email) qs.set('email', email);
    if (phone) qs.set('phone', phone);
    qs.set('customerId', id);
    void fetch(`/api/customers/360?${qs.toString()}`, { credentials: 'include' })
      .then(async (res) => {
        if (!res.ok) throw new Error('Failed to load customer tickets');
        return res.json();
      })
      .then((data) => {
        if (cancelled) return;
        const rows = Array.isArray(data?.tickets) ? data.tickets : [];
        setCustomerTickets(
          rows.map((row: Customer360Ticket) => ({
            id: String(row.id || ''),
            subject: String(row.subject || ''),
            status: String(row.status || ''),
            priority: row.priority ? String(row.priority) : undefined,
            assignee: row.assignee ? String(row.assignee) : undefined,
            queue: row.queue ? String(row.queue) : null,
            customerName: row.customerName ? String(row.customerName) : undefined,
            createdByName: row.createdByName ? String(row.createdByName) : undefined,
            channel: row.channel ? String(row.channel) : undefined,
            createdAt: row.createdAt ? String(row.createdAt) : undefined,
            updatedAt: row.updatedAt ? String(row.updatedAt) : undefined,
          }))
        );
        setCustomerTicketsTotal(
          typeof data?.totalTickets === 'number' ? data.totalTickets : rows.length
        );
      })
      .catch(() => {
        if (cancelled) return;
        setCustomerTickets([]);
        setCustomerTicketsTotal(null);
      })
      .finally(() => {
        if (!cancelled) setCustomerTicketsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedCustomer?.id, selectedCustomer?.email, selectedCustomer?.phone]);

  useEffect(() => {
    if (!startCreateIntent) return;
    onConsumeCreateIntent?.();
    setShowAdd(false);
    setGuided(false);
  }, [startCreateIntent, onConsumeCreateIntent]);

  const fetchCustomers = useCallback(async (q?: string, offset = 0) => {
    const gen = ++fetchGenRef.current;
    if (offset > 0) setLoadingMore(true);
    try {
      const query = (q ?? searchQuery).trim();
      const params = new URLSearchParams();
      params.set('paged', '1');
      params.set('limit', String(DIRECTORY_PAGE));
      params.set('offset', String(Math.max(0, offset)));
      if (query) params.set('q', query);
      if (statusFilter === 'Active' || statusFilter === 'Inactive') {
        params.set('status', statusFilter);
      }
      if (sortOrder === 'name' || sortOrder === 'name_desc' || sortOrder === 'latest') {
        params.set('sort', sortOrder);
      }
      const res = await fetch(`/api/customers?${params.toString()}`, {
        credentials: 'include',
      });
      const data = await res.json();
      if (gen !== fetchGenRef.current) return [];
      if (!res.ok) {
        setCustomers([]);
        setListHasMore(false);
        setListTotal(null);
        setListOffset(0);
        return [];
      }
      const page = parseDirectoryPage(data);
      setCustomers(page.rows);
      setListHasMore(page.hasMore);
      setListTotal(page.totalRows);
      setListOffset(page.offset);
      const pending = pendingOpenCustomerRef.current;
      if (pending) {
        pendingOpenCustomerRef.current = null;
        resolveOpenCustomer(page.rows, pending);
      }
      return page.rows;
    } catch (err) {
      console.error('Failed to load customers directory', err);
      return [];
    } finally {
      if (gen === fetchGenRef.current) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  }, [resolveOpenCustomer, searchQuery, statusFilter, sortOrder]);

  const applyCustomerChatActions = useCallback(
    (actions: Record<string, unknown>[]) => {
      for (const raw of actions) {
        const type = String(raw.type || '').trim().toLowerCase();
        if (type === 'open_customer') {
          const pending = pendingOpenFromAction(raw);
          if (pending) {
            pendingOpenCustomerRef.current = pending;
            void fetchCustomers();
          }
          setGuided(false);
          setShowAdd(false);
          continue;
        }
        if (type === 'create_customer') {
          setGuided(false);
          setShowAdd(false);
          continue;
        }
      }
    },
    [fetchCustomers]
  );

  useEffect(() => {
    if (!pageBridge) return;
    pageBridge.setPageHandlers({
      module: 'customers',
      surface: selectedCustomerId ? 'detail' : 'list',
      getChatContext: () => ({
        module: 'customers',
        surface: selectedCustomerId ? 'detail' : 'list',
        entityId: selectedCustomerId,
        focusedEntity: selectedCustomer
          ? {
              type: 'customer' as const,
              id: selectedCustomer.id,
              name: selectedCustomer.name,
              email: selectedCustomer.email,
            }
          : undefined,
        draft: null,
      }),
      onChatActions: async (actions) => {
        applyCustomerChatActions(actions);
      },
      onDraftPatch: (patch) => {
        if (patch.done || patch.refresh) {
          setGuided(false);
          setShowAdd(false);
          const cid = String(patch.id || patch.customerId || '').trim();
          if (cid) setSelectedCustomerId(cid);
        }
      },
    });
    return () => pageBridge.setPageHandlers(null);
  }, [pageBridge, showAdd, guided, guidedStepIndex, selectedCustomerId, selectedCustomer, form, canMutate, applyCustomerChatActions]);

  useEffect(() => {
    if (!listRefreshToken) return;
    void fetchCustomers();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refresh token from chat create
  }, [listRefreshToken]);

  const handledModuleResetKey = useRef(0);
  useEffect(() => {
    if (moduleResetKey <= handledModuleResetKey.current) return;
    handledModuleResetKey.current = moduleResetKey;
    selectCustomer(null);
    setShowAdd(false);
    setGuided(false);
    setGuidedStepIndex(0);
    setFormError('');
    setFormMsg('');
  }, [moduleResetKey, selectCustomer]);

  useEffect(() => {
    if (externalStatusFilter) {
      setStatusFilter(externalStatusFilter);
    } else if (externalStatusFilter === '') {
      setStatusFilter('All');
    }
  }, [externalStatusFilter]);

  useEffect(() => {
    const t = window.setTimeout(() => {
      void fetchCustomers(searchQuery, 0);
    }, searchQuery.trim() ? 250 : 0);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refetch when the search box, status chip, or sort changes
  }, [searchQuery, statusFilter, sortOrder]);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/org-branding', { credentials: 'include' });
        if (!res.ok) return;
        const data = await res.json();
        if (data.businessType === 'b2b') setBusinessType('b2b');
      } catch {
        /* ignore */
      }
    })();
  }, []);

  const saveCustomer = async () => {
    setSaving(true);
    setFormError('');
    setFormMsg('');
    try {
      const res = await fetch('/api/customers', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name,
          email: form.email,
          phone: form.phone,
          accountName: form.accountName,
          externalId: form.externalId,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setFormError(data.error || 'Could not add customer.');
        if (res.status === 409) {
          const existing = data.customer && typeof data.customer === 'object' ? data.customer : null;
          const lookup =
            data.conflict === 'phone'
              ? form.phone.trim() || existing?.phone || form.email.trim()
              : form.email.trim() || existing?.email || form.phone.trim();
          if (existing?.id) {
            setCustomers([existing]);
          }
          if (lookup) {
            setSearchQuery(lookup);
            if (!existing?.id) await fetchCustomers(lookup);
          }
        }
        return;
      }
      setFormMsg('Customer added.');
      setForm({ name: '', email: '', phone: '', accountName: '', externalId: '' });
      setShowAdd(false);
      setGuided(false);
      await fetchCustomers();
    } catch {
      setFormError('Could not add customer.');
    } finally {
      setSaving(false);
    }
  };

  const submitAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    await saveCustomer();
  };

  const fileToBase64 = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = String(reader.result || "");
        const comma = result.indexOf(",");
        resolve(comma >= 0 ? result.slice(comma + 1) : result);
      };
      reader.onerror = () => reject(reader.error || new Error("read failed"));
      reader.readAsDataURL(file);
    });

  const importOneFile = async (file: File) => {
    const name = String(file.name || "").toLowerCase();
    const isExcel = name.endsWith(".xlsx") || name.endsWith(".xls");
    const body: Record<string, string> = { filename: file.name };
    if (isExcel) {
      body.contentBase64 = await fileToBase64(file);
    } else {
      body.csv = await file.text();
    }
    const res = await fetch('/api/customers/import', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || `Import failed for ${file.name}`);
    }
    return {
      created: Number(data.created || 0),
      errors: Array.isArray(data.errors) ? data.errors.length : 0,
      fileName: file.name,
    };
  };

  const importFiles = async (files: FileList | File[]) => {
    setFormError('');
    setFormMsg('');
    const list = Array.from(files || []).filter(Boolean);
    if (!list.length) return;
    let createdTotal = 0;
    let errorTotal = 0;
    const fileErrors: string[] = [];
    for (const file of list) {
      try {
        const r = await importOneFile(file);
        createdTotal += r.created;
        errorTotal += r.errors;
      } catch (err) {
        fileErrors.push(err instanceof Error ? err.message : `Failed: ${file.name}`);
      }
    }
    if (fileErrors.length && !createdTotal) {
      setFormError(fileErrors.join(' '));
      return;
    }
    const parts = [
      `Imported ${createdTotal} customer(s) from ${list.length} file(s)`,
    ];
    if (errorTotal) parts.push(`${errorTotal} row(s) skipped`);
    if (fileErrors.length) parts.push(`${fileErrors.length} file(s) failed`);
    setFormMsg(`${parts.join('; ')}.`);
    if (fileErrors.length) setFormError(fileErrors.join(' '));
    await fetchCustomers();
  };

  const filteredCustomers = customers.filter((c) => {
    const matchesStatus = statusFilter === 'All' || c.status === statusFilter;
    const q = searchQuery.trim().toLowerCase();
    const qDigits = searchQuery.replace(/\D/g, '');
    const phoneDigits = String(c.phone || '').replace(/\D/g, '');
    const matchesSearch =
      q === '' ||
      String(c.name || '').toLowerCase().includes(q) ||
      String(c.email || '').toLowerCase().includes(q) ||
      String(c.phone || '').toLowerCase().includes(q) ||
      (qDigits.length >= 7 && phoneDigits.includes(qDigits));
    return matchesStatus && matchesSearch;
  });

  const displayedCustomers = [...filteredCustomers].sort((a, b) => {
    if (sortOrder === 'latest') {
      const byDate = String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
      if (byDate) return byDate;
      return String(b.id || '').localeCompare(String(a.id || ''));
    }
    const byName = String(a.name || '')
      .trim()
      .localeCompare(String(b.name || '').trim(), undefined, { sensitivity: 'base' });
    const dir = sortOrder === 'name_desc' ? -1 : 1;
    if (byName) return byName * dir;
    return String(a.id || '').localeCompare(String(b.id || '')) * dir;
  });

  return (
    <PageShell
      id="customers-view-container"
      embedded={embedded}
      fillHeight
      actions={
        <p className="text-sm text-neutral-500">
          Search CDP customers and leads. Ticketing cannot add or edit people.
        </p>
      }
    >
      <div className="flex min-h-0 min-w-0 w-full flex-1 flex-col gap-3 overflow-hidden">
        {(formError || formMsg) && (
          <p className={`shrink-0 text-xs rounded-xl px-3 py-2 border ${formError ? 'text-amber-800 bg-amber-50 border-amber-200' : 'text-emerald-700 bg-emerald-50 border-emerald-200'}`}>
            {formError || formMsg}
          </p>
        )}
        {guided && canMutate ? (
          <GuidedCustomerPreview
            draft={{ name: form.name, email: form.email, phone: form.phone }}
            stepIndex={guidedStepIndex}
            saving={saving}
            onCancel={() => {
              setGuided(false);
              setGuidedStepIndex(0);
            }}
            onUseForm={() => {
              setGuided(false);
              setShowAdd(true);
            }}
            onConfirmCreate={() => {
              void saveCustomer();
            }}
          />
        ) : selectedCustomer && !showAdd ? (
          <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto">
            <div className="flex items-center justify-between gap-3 pb-3">
              <button
                type="button"
                onClick={() => selectCustomer(null)}
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-neutral-600 hover:text-neutral-900"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                Back to directory
              </button>
            </div>
            <div className="space-y-4 pt-5">
              <div>
                <p className="text-[10px] font-medium uppercase tracking-wide text-neutral-400">
                  Customer
                </p>
                <h3 className="text-lg font-semibold text-neutral-900">{selectedCustomer.name}</h3>
              </div>
              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                <div className="rounded-xl border border-neutral-200 px-3 py-2.5">
                  <dt className="text-neutral-400">Email</dt>
                  <dd className="font-medium text-neutral-900 mt-0.5">{selectedCustomer.email || '—'}</dd>
                </div>
                <div className="rounded-xl border border-neutral-200 px-3 py-2.5">
                  <dt className="text-neutral-400">Phone</dt>
                  <dd className="font-medium text-neutral-900 mt-0.5">{selectedCustomer.phone || '—'}</dd>
                </div>
                <div className="rounded-xl border border-neutral-200 px-3 py-2.5">
                  <dt className="text-neutral-400">Status</dt>
                  <dd className="font-medium text-neutral-900 mt-0.5">{selectedCustomer.status}</dd>
                </div>
                <div className="rounded-xl border border-neutral-200 px-3 py-2.5">
                  <dt className="text-neutral-400">Filed tickets</dt>
                  <dd className="font-medium text-neutral-900 mt-0.5">
                    {customerTicketsTotal ?? selectedCustomer.totalTickets}
                  </dd>
                </div>
              </dl>
              <div className="space-y-2">
                <p className="text-[10px] font-medium uppercase tracking-wide text-neutral-400">
                  Tickets
                </p>
                {customerTicketsLoading ? (
                  <p className="text-xs text-neutral-400">Loading tickets…</p>
                ) : customerTickets.length === 0 ? (
                  <p className="text-xs text-neutral-500">No tickets yet</p>
                ) : (
                  <ul className="grid auto-rows-[228px] grid-cols-1 items-stretch gap-4 sm:grid-cols-2">
                    {customerTickets.map((ticket) => {
                      const ticketRef = ticket.id.startsWith('#')
                        ? ticket.id
                        : `#${ticket.id}`;
                      const channel = normalizeChannel(ticket.channel);
                      const requester =
                        ticket.createdByName ||
                        ticket.customerName ||
                        selectedCustomer.name ||
                        '';
                      const assignee =
                        ticket.assignee &&
                        ticket.assignee !== 'Unassigned' &&
                        ticket.assignee !== requester
                          ? ticket.assignee
                          : '';
                      const meta = [
                        requester,
                        channel === 'Web' ? 'Web' : channel,
                        ticket.queue,
                        assignee,
                      ]
                        .map((part) => String(part || '').trim())
                        .filter(Boolean)
                        .join(' · ');
                      const priority = ticket.priority || 'medium';
                      const theme = ticketPriorityTheme(priority);
                      const status = ticket.status || 'Open';
                      return (
                        <li key={ticket.id} className="min-w-0 h-full">
                          <button
                            type="button"
                            onClick={() => onOpenTicket?.(ticketRef, selectedCustomer || undefined)}
                            aria-label={`Open ticket ${ticketRef}: ${ticket.subject || 'ticket'}`}
                            className={`group flex h-full w-full min-h-[228px] flex-col overflow-hidden rounded-2xl border-[0.6px] border-[#bfbfbf] bg-white text-left shadow-none transition-all duration-150 hover:border-neutral-400 hover:shadow-[0_2px_12px_rgba(0,0,0,0.04)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/10 cursor-pointer ${theme.hoverBorder}`}
                          >
                            <div
                              className={`relative h-[72px] shrink-0 overflow-hidden bg-gradient-to-br ${theme.wash}`}
                            >
                              <div className="absolute inset-x-4 top-3 flex items-center justify-between gap-2">
                                <span className="font-mono text-[11px] font-semibold tabular-nums text-neutral-600">
                                  {ticketRef}
                                </span>
                                <span
                                  className={`inline-flex max-w-[55%] shrink-0 truncate rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${theme.pill}`}
                                >
                                  {priority}
                                </span>
                              </div>
                              <div className="absolute inset-x-4 bottom-2.5 flex items-center gap-1.5 text-[11px] text-neutral-500">
                                {ticketChannelIcon(channel)}
                                <span className="truncate">
                                  {channel === 'Web' ? 'Web' : channel}
                                </span>
                              </div>
                            </div>
                            <div className="flex min-h-0 flex-1 flex-col px-4 pb-4 pt-3">
                              <h4 className="line-clamp-2 min-h-[2.75rem] text-[15px] font-bold leading-snug text-neutral-950 group-hover:text-neutral-800">
                                {ticket.subject || '—'}
                              </h4>
                              <p
                                className="mt-1.5 line-clamp-2 min-h-[2.25rem] text-[12px] leading-relaxed text-neutral-500"
                                title={meta}
                              >
                                {meta || '—'}
                              </p>
                              <div className="mt-auto flex items-center justify-between gap-2 border-t border-neutral-100 pt-3">
                                <div className="flex min-w-0 items-center gap-2">
                                  <span
                                    className={`inline-flex shrink-0 items-center rounded-md border px-2 py-0.5 text-[10px] font-medium ${ticketStatusBadgeClass(status)}`}
                                  >
                                    {status}
                                  </span>
                                  {assignee ? (
                                    <span className="inline-flex min-w-0 items-center gap-1.5 text-[11px] text-neutral-500">
                                      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-[9px] font-bold text-neutral-700">
                                        {ticketCardInitials(assignee)}
                                      </span>
                                      <span className="truncate">{assignee}</span>
                                    </span>
                                  ) : null}
                                </div>
                                <span className="shrink-0 tabular-nums text-[11px] text-neutral-400">
                                  {relativeTicketWhen(ticket.updatedAt || ticket.createdAt)}
                                </span>
                              </div>
                            </div>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </div>
          </div>
        ) : (
          <>
        {showAdd && canMutate && (
          <form onSubmit={submitAdd} className="shrink-0 border-[0.6px] border-[#bfbfbf] bg-white p-4 rounded-2xl shadow-none grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
            <label className="space-y-1">
              <span className="text-[10px] font-bold uppercase text-neutral-500">Name *</span>
              <input required value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} className="w-full h-9 rounded-lg border border-neutral-200 px-3" />
            </label>
            <label className="space-y-1">
              <span className="text-[10px] font-bold uppercase text-neutral-500">Email</span>
              <input type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} className="w-full h-9 rounded-lg border border-neutral-200 px-3" />
            </label>
            <label className="space-y-1">
              <span className="text-[10px] font-bold uppercase text-neutral-500">Phone</span>
              <input value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} className="w-full h-9 rounded-lg border border-neutral-200 px-3" />
            </label>
            {businessType === 'b2b' && (
              <label className="space-y-1">
                <span className="text-[10px] font-bold uppercase text-neutral-500">Account / company</span>
                <input value={form.accountName} onChange={(e) => setForm((f) => ({ ...f, accountName: e.target.value }))} className="w-full h-9 rounded-lg border border-neutral-200 px-3" />
              </label>
            )}
            <div className="md:col-span-2 flex justify-end gap-2">
              <button type="button" onClick={() => setShowAdd(false)} className="h-9 px-3 rounded-lg border border-neutral-200">Cancel</button>
              <button type="submit" disabled={saving} className="h-9 px-4 rounded-lg bg-neutral-950 text-white font-semibold disabled:opacity-40">
                {saving ? 'Saving…' : 'Save customer'}
              </button>
            </div>
            <p className="md:col-span-2 text-[11px] text-neutral-400">
              Import CSV, TSV, or Excel (.xlsx). Columns: name, email, phone, external_id, account.
              Email or phone required. Portal emails are sent only for OTP or password reset, not when adding a customer.
            </p>
          </form>
        )}
        <div className="flex min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden bg-white shadow-none">
          <p className="shrink-0 border-b border-[#e5e5e5] bg-neutral-50/70 px-3 py-2 text-xs text-neutral-700">
            Tickets can only be filed for CDP customers or leads already in this directory.
            {listTotal != null ? (
              <span className="ml-1 tabular-nums text-neutral-500">
                {listTotal.toLocaleString()} in this org
              </span>
            ) : null}
          </p>
          <div className="flex shrink-0 flex-col justify-between gap-3 border-b border-[#e5e5e5] bg-neutral-50/70 p-2.5 font-sans text-xs md:flex-row md:items-center">
          <div className="flex flex-wrap items-center gap-2">
            <span className="shrink-0 text-neutral-400">Account Status:</span>
            {['All', 'Active', 'Inactive'].map((st) => (
              <button
                key={st}
                type="button"
                onClick={() => setStatusFilter(st)}
                className={`px-3.5 py-1.5 border text-xs font-medium rounded-full transition-all cursor-pointer ${
                  statusFilter === st
                    ? 'bg-neutral-950 text-white border-neutral-950 font-semibold'
                    : 'bg-white border-neutral-200 text-neutral-500 hover:border-neutral-400'
                }`}
              >
                {st}
              </button>
            ))}
            <MenuSelect
              id="directory-sort-select"
              label="Sort directory"
              value={sortOrder}
              compact
              className="shrink-0"
              minMenuWidth={140}
              triggerClassName="inline-flex h-[30px] items-center gap-1 rounded-full border border-neutral-200 bg-white px-3 text-xs font-medium text-neutral-500 shadow-none outline-none hover:border-neutral-400"
              options={[
                { value: 'name', label: 'Name A–Z' },
                { value: 'name_desc', label: 'Name Z–A' },
                { value: 'latest', label: 'Newest' },
              ]}
              onChange={(v) => setSortOrder(v as DirectorySort)}
            />
          </div>

          <div className="relative w-full md:w-64">
            <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-neutral-400" />
            <input
              type="text"
              placeholder="Search database clients..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-[38px] w-full rounded-lg border-[0.6px] border-[#bfbfbf] bg-white py-2 pl-9 pr-3 text-sm text-black shadow-none placeholder-neutral-400 focus:border-neutral-400 focus:outline-none"
            />
          </div>
          </div>

          <div
            id="customers-list-scroll"
            className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain [scrollbar-gutter:stable]"
          >
          {loading ? (
            <div className="p-12 text-center text-neutral-400 font-mono">
              Reading directory indexes...
            </div>
          ) : displayedCustomers.length > 0 ? (
            <ul id="customers-list" className="divide-y divide-[#e5e5e5]">
              {displayedCustomers.map((customer) => {
                const ticketLabel = `${customer.totalTickets} filed ${
                  customer.totalTickets === 1 ? 'ticket' : 'tickets'
                }`;
                const meta = [
                  customer.accountName,
                  customer.phone,
                  ticketLabel,
                  customer.status,
                ]
                  .map((part) => String(part || '').trim())
                  .filter(Boolean)
                  .join('  ·  ');
                return (
                  <li key={customer.id} className="min-w-0">
                    <button
                      type="button"
                      onClick={() => selectCustomer(customer)}
                      className="flex w-full min-w-0 items-start gap-3 px-4 py-3.5 text-left transition-colors hover:bg-neutral-50"
                    >
                      <span
                        className={`inline-flex size-[38px] shrink-0 items-center justify-center rounded-full text-xs font-semibold ${customerAvatarTone(
                          customer.name
                        )}`}
                        aria-hidden
                      >
                        {customerInitials(customer.name)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-start justify-between gap-3">
                          <span className="min-w-0 truncate text-sm font-semibold text-neutral-900">
                            {customer.name}
                          </span>
                          <span className="shrink-0 font-mono text-[11px] tabular-nums text-neutral-400">
                            {customer.createdAt}
                          </span>
                        </span>
                        <span className="mt-0.5 block truncate text-sm text-neutral-500">
                          {customer.email || '—'}
                        </span>
                        {meta ? (
                          <span className="mt-0.5 block truncate text-sm text-neutral-500" title={meta}>
                            {meta}
                          </span>
                        ) : null}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="flex flex-col items-center justify-center gap-2 px-4 py-12 text-center text-neutral-400">
              <AlertTriangle className="h-5 w-5" />
              <span className="text-sm">No client entries found matching specifications.</span>
            </div>
          )}
          </div>
          {listTotal != null && listTotal > 0 ? (
            <div className="flex shrink-0 flex-col gap-3 border-t-[0.6px] border-[#bfbfbf] bg-white px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="text-sm font-semibold tabular-nums text-[#171717]">
                  {Math.min(listOffset + 1, listTotal).toLocaleString()}
                  –
                  {(listOffset + customers.length).toLocaleString()}
                  <span className="font-normal text-neutral-500"> of </span>
                  {listTotal.toLocaleString()}
                </p>
                <p className="mt-0.5 text-xs text-neutral-500">
                  {listTotal.toLocaleString()}{' '}
                  {listTotal === 1 ? 'customer' : 'customers'} in this org
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={loadingMore || listOffset <= 0}
                  onClick={() =>
                    void fetchCustomers(searchQuery, Math.max(0, listOffset - DIRECTORY_PAGE))
                  }
                  className="inline-flex h-[38px] w-[38px] items-center justify-center rounded-xl border-[0.6px] border-[#bfbfbf] bg-white text-[#171717] hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-40"
                  aria-label="Previous page"
                >
                  <ChevronLeft className="h-[18px] w-[18px]" strokeWidth={2.25} />
                </button>
                <p className="min-w-[7.5rem] text-center text-xs tabular-nums text-neutral-500">
                  Page{' '}
                  <span className="font-semibold text-[#171717]">
                    {Math.floor(listOffset / DIRECTORY_PAGE) + 1}
                  </span>
                  {' '}of {Math.max(1, Math.ceil(listTotal / DIRECTORY_PAGE))}
                </p>
                <button
                  type="button"
                  disabled={loadingMore || !listHasMore}
                  onClick={() => void fetchCustomers(searchQuery, listOffset + DIRECTORY_PAGE)}
                  className="inline-flex h-[38px] w-[38px] items-center justify-center rounded-xl border-[0.6px] border-[#bfbfbf] bg-white text-[#171717] hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-40"
                  aria-label="Next page"
                >
                  <ChevronRight className="h-[18px] w-[18px]" strokeWidth={2.25} />
                </button>
              </div>
            </div>
          ) : null}
        </div>
          </>
        )}
      </div>
    </PageShell>
  );
}
