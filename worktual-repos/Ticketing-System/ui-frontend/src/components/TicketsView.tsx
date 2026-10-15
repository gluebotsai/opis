import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { 
  Search, 
  Mail, 
  MessageSquare, 
  PhoneCall, 
  Globe, 
  User, 
  Clock, 
  ChevronDown,
  Filter,
  AlertTriangle,
  X,
  Send,
  CheckCircle2,
  UserCheck,
  Copy,
  Check,
  Tag,
  Users,
  Circle,
  ArrowLeft,
  Eye,
  RotateCcw,
} from 'lucide-react';
import { useCoworkerPageBridge, useCoworkerSplitExpandOptional } from './coworker/CoworkerSplitWorkspace';
import { useReportFocusedEntity } from './coworker/CoworkerSessionContext';
import { Ticket, Priority, TicketStatus, Channel, AuthUser } from '../types';
import { useSetPageTitle } from './layout/PageTitleContext';
import PageShell from './layout/PageShell';
import type { DataScope } from '../rbac';

interface TicketsViewProps {
  viewMode: 'assigned' | 'team-queue' | 'search' | 'team-inbox' | 'unassigned';
  tickets: Ticket[];
  onUpdateTicket: (
    id: string,
    updates: Partial<Ticket> & { escalate?: boolean }
  ) => void;
  currentUser: AuthUser;
  searchQuery: string;
  onSearchQueryChange: (query: string) => void;
  canMutate?: boolean;
  /** Server already scopes lists; client filter for admin "assigned" view. */
  dataScope?: DataScope;
  /** Applied from co-worker intents (e.g. "high priority"). */
  externalPriorityFilter?: string;
  externalStatusFilter?: string;
  externalChannelFilter?: string;
  externalCreatorFilter?: string;
  externalAssigneeFilter?: string;
  /** Keep App facet state in sync when the user changes/resets filters in the panel. */
  onFacetFiltersChange?: (facets: {
    priority?: string;
    status?: string;
    channel?: string;
    creator?: string;
    assignee?: string;
  }) => void;
  embedded?: boolean;
}

function FilterDropdown({
  id,
  label,
  value,
  options,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);

  useEffect(() => {
    if (!open) return;
    const place = () => {
      const el = btnRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const width = Math.max(r.width, 168);
      const left = Math.min(r.left, window.innerWidth - width - 8);
      const below = r.bottom + 4;
      const estimated = Math.min(options.length * 32 + 8, 224);
      const top =
        below + estimated > window.innerHeight - 8
          ? Math.max(8, r.top - estimated - 4)
          : below;
      setPos({ top, left: Math.max(8, left), width });
    };
    place();
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (btnRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      setOpen(false);
    };
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    document.addEventListener('mousedown', onDoc);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
      document.removeEventListener('mousedown', onDoc);
    };
  }, [open, options.length]);

  const selected = options.find((o) => o.value === value)?.label || label;

  return (
    <div className="relative min-w-0">
      <button
        ref={btnRef}
        id={id}
        type="button"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full min-w-0 h-9 items-center justify-between gap-1 bg-white border border-neutral-200 rounded-lg pl-2.5 pr-2 text-[11px] font-medium text-neutral-700 cursor-pointer focus:outline-none focus:border-neutral-400 focus:ring-2 focus:ring-neutral-900/8"
      >
        <span className="truncate">{selected}</span>
        <ChevronDown className="h-3.5 w-3.5 text-neutral-400 shrink-0" />
      </button>
      {open &&
        pos &&
        createPortal(
          <div
            ref={menuRef}
            role="listbox"
            aria-label={label}
            style={{
              position: 'fixed',
              top: pos.top,
              left: pos.left,
              width: pos.width,
              zIndex: 80,
            }}
            className="max-h-56 overflow-y-auto rounded-lg border border-neutral-200 bg-white shadow-lg py-1"
          >
            {options.map((o) => (
              <button
                key={o.value}
                type="button"
                role="option"
                aria-selected={o.value === value}
                onClick={() => {
                  onChange(o.value);
                  setOpen(false);
                }}
                className={`w-full px-3 py-2 text-left text-[11px] hover:bg-neutral-50 ${
                  o.value === value ? 'font-semibold text-neutral-900 bg-neutral-50' : 'text-neutral-700'
                }`}
              >
                {o.label}
              </button>
            ))}
          </div>,
          document.body
        )}
    </div>
  );
}

export default function TicketsView({ 
  viewMode, 
  tickets, 
  onUpdateTicket, 
  currentUser,
  searchQuery,
  onSearchQueryChange,
  canMutate = true,
  dataScope = 'org',
  externalPriorityFilter,
  externalStatusFilter,
  externalChannelFilter,
  externalCreatorFilter,
  externalAssigneeFilter,
  onFacetFiltersChange,
  embedded = false,
}: TicketsViewProps) {
  const pageTitle =
    viewMode === 'assigned'
      ? 'Tickets'
      : viewMode === 'search'
        ? 'Search'
        : viewMode === 'team-inbox'
          ? 'Team inbox'
          : viewMode === 'unassigned'
            ? 'Needs agent or resolver'
            : 'All tickets';
  // State for selections and filters
  const [selectedTickets, setSelectedTickets] = useState<string[]>([]);
  const [statusFilter, setStatusFilter] = useState<string>('All');
  const [priorityFilter, setPriorityFilter] = useState<string>('All');
  const [channelFilter, setChannelFilter] = useState<string>('All');
  const [sortOrder, setSortOrder] = useState<'latest' | 'oldest' | 'priority'>('latest');

  // Prefer coworker/App facet when set so the dropdown never desyncs from the list.
  const effectivePriorityFilter =
    externalPriorityFilter && externalPriorityFilter.trim() !== ''
      ? externalPriorityFilter.trim().toLowerCase()
      : priorityFilter;
  const effectiveStatusFilter =
    externalStatusFilter && externalStatusFilter.trim() !== ''
      ? externalStatusFilter
      : externalStatusFilter === ''
        ? 'All'
        : statusFilter;
  const effectiveChannelFilter =
    externalChannelFilter && externalChannelFilter.trim() !== ''
      ? externalChannelFilter
      : externalChannelFilter === ''
        ? 'All'
        : channelFilter;

  useEffect(() => {
    if (externalPriorityFilter && externalPriorityFilter.trim() !== '') {
      // Keep catalog keys lowercase (low/medium/high/urgent) — title-casing
      // broke matching against ticket.priority and emptied the list.
      setPriorityFilter(externalPriorityFilter.trim().toLowerCase());
    } else if (externalPriorityFilter === '') {
      setPriorityFilter('All');
    }
  }, [externalPriorityFilter]);

  useEffect(() => {
    if (externalStatusFilter) {
      setStatusFilter(externalStatusFilter);
    } else if (externalStatusFilter === '') {
      setStatusFilter('All');
    }
  }, [externalStatusFilter]);

  useEffect(() => {
    if (externalChannelFilter) {
      setChannelFilter(externalChannelFilter);
    } else if (externalChannelFilter === '') {
      setChannelFilter('All');
    }
  }, [externalChannelFilter]);

  // Interactive inline editing — Priority/Status use always-visible selects (no edit mode)
  const [roster, setRoster] = useState<
    Array<{ id: string; name: string; role?: string; skills: string[] }>
  >([]);
  const [priorityOptions, setPriorityOptions] = useState<
    Array<{ priority: string; displayName: string; sortOrder: number }>
  >([]);
  const [statusOptions, setStatusOptions] = useState<
    Array<{ status: string; displayName: string; sortOrder: number }>
  >([]);
  const [reassignPick, setReassignPick] = useState('');
  const [reassignEscalate, setReassignEscalate] = useState(false);

  // Full ticket detail (replaces list while open)
  const [expandedTicketId, setExpandedTicketId] = useState<string | null>(null);
  const splitExpand = useCoworkerSplitExpandOptional();
  const pageBridge = useCoworkerPageBridge();
  useReportFocusedEntity(
    expandedTicketId
      ? {
          type: 'ticket',
          id: expandedTicketId,
          name:
            tickets.find((t) => t.id === expandedTicketId)?.id ||
            expandedTicketId,
        }
      : null
  );
  useEffect(() => {
    if (!pageBridge) return;
    pageBridge.setPageHandlers({
      module: 'tickets',
      surface: expandedTicketId ? 'detail' : 'list',
      getChatContext: () => ({
        module: 'tickets',
        surface: expandedTicketId ? 'detail' : 'list',
        entityId: expandedTicketId,
      }),
    });
    return () => pageBridge.setPageHandlers(null);
  }, [pageBridge, expandedTicketId]);
  useSetPageTitle(
    expandedTicketId
      ? tickets.find((t) => t.id === expandedTicketId)?.subject || pageTitle
      : pageTitle
  );
  const [copiedTicketId, setCopiedTicketId] = useState<string | null>(null);
  const [ticketProgress, setTicketProgress] = useState<{
    currentStatus: string;
    statusLabel: string;
    onHold: boolean;
    overdue: boolean;
    steps: Array<{
      key: string;
      label: string;
      hint: string;
      state: 'done' | 'current' | 'upcoming';
    }>;
    history: Array<{
      at: string;
      relative: string;
      label: string;
      actor: string | null;
    }>;
  } | null>(null);
  const [progressLoading, setProgressLoading] = useState(false);
  const [presenceViewers, setPresenceViewers] = useState<
    Array<{ userId: string; name: string; lastSeenAt: string }>
  >([]);
  
  // Notes loaded from API
  const [ticketNotes, setTicketNotes] = useState<
    Record<
      string,
      Array<{
        id: string;
        author: string;
        text: string;
        time: string;
        visibility?: 'internal' | 'public';
      }>
    >
  >({});
  const [newNoteText, setNewNoteText] = useState<string>('');
  const [noteVisibility, setNoteVisibility] = useState<'internal' | 'public'>(
    'internal'
  );
  const [notesLoading, setNotesLoading] = useState(false);
  /** TSAA writes ai_summary async; poll once after a staff note. */
  const [aiSummaryByTicket, setAiSummaryByTicket] = useState<
    Record<string, string>
  >({});
  const [macros, setMacros] = useState<Array<{ id: string; title: string; body: string }>>(
    []
  );
  const [customer360, setCustomer360] = useState<{
    email: string;
    totalTickets: number;
    avgCsat: number | null;
    ratingsCount: number;
    tickets: Array<{
      id: string;
      subject: string;
      status: string;
      csatScore: number | null;
    }>;
  } | null>(null);
  const [customer360Loading, setCustomer360Loading] = useState(false);

  useEffect(() => {
    const loadOptions = async () => {
      try {
        const [rRes, mRes, pRes, sRes] = await Promise.all([
          fetch('/api/roster', { credentials: 'include' }),
          fetch('/api/macros', { credentials: 'include' }),
          fetch('/api/priorities', { credentials: 'include' }),
          fetch('/api/statuses', { credentials: 'include' }),
        ]);
        if (rRes.ok) {
          const members = await rRes.json();
          setRoster(Array.isArray(members) ? members : []);
        }
        if (mRes.ok) {
          const list = await mRes.json();
          setMacros(Array.isArray(list) ? list : []);
        }
        if (pRes.ok) {
          const list = await pRes.json();
          const mapped = Array.isArray(list)
            ? list.map(
                (p: {
                  priority: string;
                  displayName: string;
                  sortOrder?: number;
                }) => ({
                  priority: String(p.priority || '').trim().toLowerCase(),
                  displayName: p.displayName || p.priority,
                  sortOrder: Number(p.sortOrder ?? 100),
                })
              )
            : [];
          // Always keep system keys so coworker filters (low/medium/…) match <select> values.
          const system = [
            { priority: 'low', displayName: 'Low', sortOrder: 40 },
            { priority: 'medium', displayName: 'Medium', sortOrder: 30 },
            { priority: 'high', displayName: 'High', sortOrder: 20 },
            { priority: 'urgent', displayName: 'Urgent', sortOrder: 10 },
          ];
          const byKey = new Map<string, { priority: string; displayName: string; sortOrder: number }>();
          for (const p of [...system, ...mapped]) {
            if (!p.priority) continue;
            byKey.set(p.priority, p);
          }
          setPriorityOptions(
            Array.from(byKey.values()).sort((a, b) => a.sortOrder - b.sortOrder)
          );
        } else {
          console.error('Failed to load priorities', pRes.status);
          setPriorityOptions([
            { priority: 'urgent', displayName: 'Urgent', sortOrder: 10 },
            { priority: 'high', displayName: 'High', sortOrder: 20 },
            { priority: 'medium', displayName: 'Medium', sortOrder: 30 },
            { priority: 'low', displayName: 'Low', sortOrder: 40 },
          ]);
        }
        if (sRes.ok) {
          const list = await sRes.json();
          setStatusOptions(
            Array.isArray(list)
              ? list.map(
                  (s: {
                    status: string;
                    displayName: string;
                    sortOrder?: number;
                  }) => ({
                    status: s.status,
                    displayName: s.displayName || s.status,
                    sortOrder: Number(s.sortOrder ?? 100),
                  })
                )
              : []
          );
        } else {
          console.error('Failed to load statuses', sRes.status);
          setStatusOptions([]);
        }
      } catch (err) {
        console.error('Failed to load roster/macros/priorities/statuses', err);
      }
    };
    void loadOptions();
  }, []);

  const loadCustomer360 = async (email: string) => {
    if (!email) {
      setCustomer360(null);
      return;
    }
    setCustomer360Loading(true);
    try {
      const res = await fetch(
        `/api/customers/360?email=${encodeURIComponent(email)}`,
        { credentials: 'include' }
      );
      if (res.ok) {
        setCustomer360(await res.json());
      } else {
        setCustomer360(null);
      }
    } catch {
      setCustomer360(null);
    } finally {
      setCustomer360Loading(false);
    }
  };

  const loadProgress = async (ticketId: string) => {
    setProgressLoading(true);
    try {
      const res = await fetch(
        `/api/tickets/${encodeURIComponent(ticketId)}/progress`,
        { credentials: 'include' }
      );
      if (res.ok) {
        setTicketProgress(await res.json());
      } else {
        setTicketProgress(null);
      }
    } catch (err) {
      console.error('Failed to load ticket progress', err);
      setTicketProgress(null);
    } finally {
      setProgressLoading(false);
    }
  };

  const loadNotes = async (ticketId: string) => {
    setNotesLoading(true);
    try {
      const res = await fetch(`/api/tickets/${encodeURIComponent(ticketId)}/notes`, {
        credentials: 'include',
      });
      if (res.ok) {
        const notes = await res.json();
        setTicketNotes((prev) => ({ ...prev, [ticketId]: notes }));
      }
    } catch (err) {
      console.error('Failed to load notes', err);
    } finally {
      setNotesLoading(false);
    }
  };

  const refreshAiSummary = (ticketId: string, delayMs = 12000) => {
    window.setTimeout(() => {
      void (async () => {
        try {
          const tRes = await fetch(
            `/api/tickets/${encodeURIComponent(ticketId)}`,
            { credentials: 'include' }
          );
          if (!tRes.ok) return;
          const t = await tRes.json();
          const summary = String(t.aiSummary || t.ai_summary || '').trim();
          if (summary) {
            setAiSummaryByTicket((prev) => ({
              ...prev,
              [ticketId]: summary,
            }));
          }
        } catch {
          /* ignore poll errors */
        }
      })();
    }, delayMs);
  };

  const postNote = async (ticketId: string) => {
    if (!newNoteText.trim() || !canMutate) return;
    try {
      const res = await fetch(`/api/tickets/${encodeURIComponent(ticketId)}/notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          text: newNoteText.trim(),
          visibility: noteVisibility,
        }),
      });
      if (res.ok) {
        const note = await res.json();
        setTicketNotes((prev) => ({
          ...prev,
          [ticketId]: [...(prev[ticketId] || []), note],
        }));
        setNewNoteText('');
        // TSAA rewrites async after comment_added — poll once for Description.
        refreshAiSummary(ticketId);
      }
    } catch (err) {
      console.error('Failed to post note', err);
    }
  };

  const updateTicketAndRefreshSummary = (
    ticketId: string,
    updates: Parameters<typeof onUpdateTicket>[1]
  ) => {
    const result = onUpdateTicket(ticketId, updates) as unknown as
      | void
      | Promise<boolean | void>;
    void Promise.resolve(result).then((ok) => {
      if (ok === false) return;
      if (updates && "status" in updates && updates.status) {
        refreshAiSummary(ticketId);
      }
    });
  };

  const expandedStatus = tickets.find((x) => x.id === expandedTicketId)?.status;

  useEffect(() => {
    if (expandedTicketId) {
      void loadNotes(expandedTicketId);
      void loadProgress(expandedTicketId);
      const t = tickets.find((x) => x.id === expandedTicketId);
      if (t?.customerEmail) void loadCustomer360(t.customerEmail);
      else setCustomer360(null);
    } else {
      setCustomer360(null);
      setTicketProgress(null);
    }
  }, [expandedTicketId, expandedStatus]);

  const formatSlaCountdown = (dueAt?: string) => {
    if (!dueAt) return null;
    const due = new Date(dueAt).getTime();
    if (Number.isNaN(due)) return null;
    const diffMs = due - Date.now();
    const abs = Math.abs(diffMs);
    const mins = Math.floor(abs / 60000);
    const hours = Math.floor(mins / 60);
    const days = Math.floor(hours / 24);
    const label =
      days > 0
        ? `${days}d ${hours % 24}h`
        : hours > 0
          ? `${hours}h ${mins % 60}m`
          : `${mins}m`;
    return {
      overdue: diffMs < 0,
      label: diffMs < 0 ? `Overdue by ${label}` : `Due in ${label}`,
    };
  };

  const formatTicketWhen = (value?: string) => {
    if (!value) return { relative: '—', absolute: '' };
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) {
      return { relative: value, absolute: value };
    }
    const diffMs = Date.now() - d.getTime();
    const mins = Math.floor(Math.abs(diffMs) / 60000);
    const hours = Math.floor(mins / 60);
    const days = Math.floor(hours / 24);
    let relative: string;
    if (Math.abs(diffMs) < 60000) relative = 'Just now';
    else if (mins < 60) relative = diffMs >= 0 ? `${mins}m ago` : `in ${mins}m`;
    else if (hours < 48) relative = diffMs >= 0 ? `${hours}h ago` : `in ${hours}h`;
    else if (days < 14) relative = diffMs >= 0 ? `${days}d ago` : `in ${days}d`;
    else
      relative = d.toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      });
    const absolute = d.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
    return { relative, absolute };
  };

  // Reset other filters and auto-expand when an explicit ticket ID is searched (e.g. from notification click)
  useEffect(() => {
    if (!searchQuery) return;
    const q = searchQuery.toLowerCase();
    const looksLikeId = searchQuery.startsWith('#') || /^#?\d+$/.test(searchQuery.trim());
    if (looksLikeId || searchQuery.startsWith('WT-') || searchQuery.includes('#')) {
      setStatusFilter('All');
      setPriorityFilter('All');
      setChannelFilter('All');
      onFacetFiltersChange?.({
        priority: '',
        status: '',
        channel: '',
        creator: '',
        assignee: '',
      });
    }
    const match = tickets.find(
      (t) =>
        t.id.toLowerCase() === q ||
        t.id.toLowerCase() === `#${q.replace(/^#/, '')}` ||
        t.id.toLowerCase().replace(/^#/, '') === q.replace(/^#/, '')
    );
    if (match) {
      setExpandedTicketId(match.id);
    }
  }, [searchQuery, tickets]);

  // Toggle selection for bulk actions
  const handleToggleSelectAll = () => {
    if (selectedTickets.length === filteredTickets.length) {
      setSelectedTickets([]);
    } else {
      setSelectedTickets(filteredTickets.map(t => t.id));
    }
  };

  const handleToggleSelectOne = (id: string) => {
    if (selectedTickets.includes(id)) {
      setSelectedTickets(selectedTickets.filter(item => item !== id));
    } else {
      setSelectedTickets([...selectedTickets, id]);
    }
  };

  // Filter logic based on viewMode and active filters
  const filteredTickets = tickets.filter(ticket => {
    // 1. ViewMode specific constraint
    // Admin "Tickets" = assigned to me. Agent/resolver/customer lists are
    // already scoped by the API — don't filter them away again.
    if (
      viewMode === 'assigned' &&
      dataScope === 'org' &&
      ticket.assignee !== currentUser.name
    ) {
      return false;
    }
    // Defense: Unassigned view = missing agent and/or resolver (API scope is source of truth).
    if (viewMode === 'unassigned') {
      const agentMissing =
        !ticket.assignee ||
        ticket.assignee === 'Unassigned' ||
        !ticket.assigneeId;
      const resolverMissing =
        !ticket.resolver ||
        ticket.resolver === 'Unassigned' ||
        !ticket.resolverId;
      if (!agentMissing && !resolverMissing) {
        return false;
      }
    }
    if (
      externalCreatorFilter === 'me' &&
      ticket.createdById !== currentUser.id
    ) {
      return false;
    }
    if (
      externalAssigneeFilter === 'me' &&
      ticket.assigneeId !== currentUser.id
    ) {
      return false;
    }

    // 2. Search query check (same fields GET /api/tickets?q= uses, plus resolver/phone)
    if (searchQuery) {
      const query = searchQuery.toLowerCase().replace(/^#/, '');
      const hay = [
        ticket.id,
        ticket.subject,
        ticket.description,
        ticket.customerName,
        ticket.customerEmail,
        ticket.customerPhone,
        ticket.assignee,
        ticket.resolver,
        ticket.queue,
        ticket.category,
        ticket.skill,
      ]
        .map((v) => String(v || '').toLowerCase())
        .join('\n');
      if (!hay.includes(query) && !hay.includes(searchQuery.toLowerCase())) {
        return false;
      }
    }

    // 3. Dropdown status modifier
    if (effectiveStatusFilter !== 'All' && ticket.status !== effectiveStatusFilter) {
      return false;
    }

    // 4. Priority filter (case-insensitive — coworker actions send lowercase keys)
    if (
      effectivePriorityFilter !== 'All' &&
      ticket.priority.toLowerCase() !== effectivePriorityFilter.toLowerCase()
    ) {
      return false;
    }

    // 5. Channel filter (case-insensitive — DB/API may return mixed casing)
    if (
      effectiveChannelFilter !== 'All' &&
      ticket.channel.toLowerCase() !== effectiveChannelFilter.toLowerCase()
    ) {
      return false;
    }

    return true;
  });

  // Sort logic
  const sortedTickets = [...filteredTickets].sort((a, b) => {
    if (sortOrder === 'latest') {
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    }
    if (sortOrder === 'oldest') {
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    }
    if (sortOrder === 'priority') {
      const priorityWeight = { urgent: 4, high: 3, medium: 2, low: 1 };
      return priorityWeight[b.priority] - priorityWeight[a.priority];
    }
    return 0;
  });

  // Icon maps in pure B&W
  const renderChannelIcon = (channel: Channel) => {
    switch (channel) {
      case 'Email':
        return (
          <span title="Email">
            <Mail className="h-3.5 w-3.5 text-neutral-500" aria-hidden />
          </span>
        );
      case 'Chat':
        return (
          <span title="Chat">
            <MessageSquare className="h-3.5 w-3.5 text-neutral-500" aria-hidden />
          </span>
        );
      case 'Phone':
        return (
          <span title="Phone Call">
            <PhoneCall className="h-3.5 w-3.5 text-neutral-500" aria-hidden />
          </span>
        );
      case 'Web':
        return (
          <span title="Web Portal">
            <Globe className="h-3.5 w-3.5 text-neutral-500" aria-hidden />
          </span>
        );
    }
  };

  const priorityBadgeClass = (priority: Priority) => {
    switch (priority) {
      case 'urgent':
        return 'bg-black text-white border-black font-extrabold tracking-widest';
      case 'high':
        return 'bg-neutral-800 text-white border-neutral-900 font-bold tracking-wide';
      case 'medium':
        return 'border-neutral-300 text-neutral-800 font-medium bg-white';
      case 'low':
      default:
        return 'border-neutral-200 text-neutral-400 bg-neutral-50 font-medium';
    }
  };

  const priorityLabel = (priority: Priority) =>
    priorityOptions.find((p) => p.priority === priority)?.displayName || priority;

  const statusLabel = (status: TicketStatus) =>
    statusOptions.find((s) => s.status === status)?.displayName || status;

  const renderPriorityBadge = (priority: Priority) => (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 text-[9px] font-mono uppercase border rounded-md ${priorityBadgeClass(priority)}`}
    >
      {priorityLabel(priority)}
    </span>
  );

  // Colored premium status translator matching high-end Helpdesks
  const statusBadgeClass = (status: TicketStatus) => {
    switch (status) {
      case 'Open':
        return 'bg-rose-50 text-rose-700 border-rose-200/60';
      case 'Pending':
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
  };

  const renderStatusBadge = (status: TicketStatus) => {
    return (
      <span
        className={`inline-flex items-center px-2.5 py-0.5 text-xs font-medium rounded-full border ${statusBadgeClass(status)}${
          status === 'Resolved' ? ' line-through' : ''
        }${status === 'Overdue' ? ' font-semibold animate-pulse' : ''}`}
      >
        {statusLabel(status)}
      </span>
    );
  };

  const focusedTicket =
    expandedTicketId != null
      ? tickets.find((t) => t.id === expandedTicketId) || null
      : null;

  useEffect(() => {
    if (!focusedTicket) return;
    splitExpand?.focusContent();
    return () => {
      splitExpand?.clearContentFocus();
    };
  }, [focusedTicket?.id, splitExpand]);

  // Agent collision: heartbeat while ticket detail is open
  useEffect(() => {
    const ticketId = focusedTicket?.id;
    if (!ticketId) {
      setPresenceViewers([]);
      return;
    }
    if (currentUser.role === 'customer' || currentUser.role === 'viewer') {
      setPresenceViewers([]);
      return;
    }

    let cancelled = false;
    const path = `/api/tickets/${encodeURIComponent(ticketId)}/presence`;

    const beat = async () => {
      try {
        const res = await fetch(path, {
          method: 'POST',
          credentials: 'include',
        });
        if (!res.ok || cancelled) return;
        const body = await res.json();
        if (!cancelled) setPresenceViewers(body.viewers || []);
      } catch {
        /* ignore transient errors */
      }
    };

    void beat();
    const timer = window.setInterval(() => void beat(), 12_000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      setPresenceViewers([]);
      void fetch(path, { method: 'DELETE', credentials: 'include' }).catch(
        () => undefined
      );
    };
  }, [focusedTicket?.id, currentUser.role]);

  const presenceLabel = (() => {
    if (!presenceViewers.length) return null;
    const names = presenceViewers.map((v) => v.name).filter(Boolean);
    if (!names.length) return null;
    if (names.length === 1) return `${names[0]} is viewing this ticket`;
    if (names.length === 2) return `${names[0]} and ${names[1]} are viewing this ticket`;
    return `${names[0]} and ${names.length - 1} others are viewing this ticket`;
  })();

  const listColCount = embedded ? 5 : 9;

  const listRowCellClass = (
    isSelected: boolean,
    isExpanded: boolean,
    position: 'first' | 'middle' | 'last' = 'middle',
    extra = ''
  ) => {
    if (embedded) {
      const tone = isSelected
        ? 'bg-neutral-50'
        : isExpanded
          ? 'bg-sky-50/30'
          : 'bg-white group-hover/row:bg-neutral-50/60';
      const pad =
        position === 'first' ? 'py-4 pl-3 pr-2' : position === 'last' ? 'py-4 pr-3 pl-3' : 'py-4 px-3';
      return `align-middle border-b border-neutral-100 ${pad} ${tone} ${extra}`.trim();
    }
    const sel = isSelected
      ? 'border-neutral-400 bg-neutral-50'
      : isExpanded
        ? 'border-sky-200 bg-sky-50/30'
        : 'border-neutral-200 bg-white group-hover/row:border-neutral-300';
    if (position === 'first') {
      return `rounded-l-xl border border-r-0 py-3.5 px-4 align-middle ${sel} ${extra}`.trim();
    }
    if (position === 'last') {
      return `rounded-r-xl border border-l-0 py-3.5 px-4 align-middle ${sel} ${extra}`.trim();
    }
    return `border-y py-3.5 align-middle ${sel} ${extra}`.trim();
  };

  const renderListStatusCell = (ticket: Ticket) => {
    if (canMutate) {
      return (
        <div
          className={`relative inline-flex items-center max-w-full rounded-full border ${statusBadgeClass(ticket.status)}${
            ticket.status === 'Resolved' ? ' line-through' : ''
          }${ticket.status === 'Overdue' ? ' font-semibold' : ''}`}
        >
          <select
            value={ticket.status}
            aria-label="Status"
            title="Change status"
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => {
              onUpdateTicket(ticket.id, {
                status: e.target.value as TicketStatus,
              });
            }}
            className="appearance-none cursor-pointer bg-transparent border-0 rounded-full pl-2.5 pr-6 py-0.5 text-xs font-medium outline-none focus:ring-2 focus:ring-neutral-900/15"
          >
            {statusOptions.map((s) => (
              <option key={s.status} value={s.status}>
                {s.displayName}
              </option>
            ))}
            {!statusOptions.some((s) => s.status === ticket.status) && (
              <option value={ticket.status}>{statusLabel(ticket.status)}</option>
            )}
          </select>
          <ChevronDown
            className="pointer-events-none absolute right-1.5 h-3 w-3 opacity-70"
            aria-hidden
          />
        </div>
      );
    }
    return renderStatusBadge(ticket.status);
  };

  const renderListChannelCell = (ticket: Ticket) => {
    if (embedded) {
      return (
        <div className="inline-flex items-center justify-center gap-1.5 text-neutral-600 min-w-0">
          <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-neutral-50 text-neutral-500">
            {renderChannelIcon(ticket.channel)}
          </span>
          <span className="text-[11px] font-medium truncate">
            {ticket.channel === 'Web' ? 'Web' : ticket.channel}
          </span>
        </div>
      );
    }
    return (
      <div className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-neutral-50 text-neutral-500 mx-auto">
        {renderChannelIcon(ticket.channel)}
      </div>
    );
  };

  return (
    <PageShell
      id="tickets-view-container"
      embedded={embedded}
      fillHeight
      actions={
        focusedTicket ? undefined : (
        <div className="flex w-full min-w-0 flex-col gap-3">
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-2 min-w-0">
              <span className="text-xs font-semibold bg-neutral-50 px-2.5 py-1 border border-neutral-200 text-neutral-600 rounded-full shrink-0">
                {filteredTickets.length} tickets found
              </span>
              {(searchQuery || externalCreatorFilter === 'me' || externalAssigneeFilter === 'me' || effectiveStatusFilter !== 'All' || effectivePriorityFilter !== 'All' || effectiveChannelFilter !== 'All') && (
                <button
                  type="button"
                  onClick={() => {
                    setStatusFilter('All');
                    setPriorityFilter('All');
                    setChannelFilter('All');
                    onSearchQueryChange('');
                    onFacetFiltersChange?.({
                      priority: '',
                      status: '',
                      channel: '',
                      creator: '',
                      assignee: '',
                    });
                  }}
                  className="text-[11px] font-semibold text-neutral-600 hover:text-neutral-900 underline-offset-2 hover:underline"
                >
                  Clear all
                </button>
              )}
            </div>
            <p className="text-xs text-neutral-500 leading-relaxed break-words">
              {viewMode === 'assigned'
                ? 'Your active ticket assignments and urgent items'
                : viewMode === 'team-queue'
                  ? 'Consolidated operational dashboard for the entire team'
                  : 'Granular search filters with multi-attribute criteria'}
            </p>
          </div>
        </div>
        )
      }
    >
      <div className="flex flex-1 min-h-0 min-w-0 w-full flex-col gap-3 sm:gap-4">

      {focusedTicket ? (
        <div className="flex flex-1 min-h-0 min-w-0 flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setExpandedTicketId(null)}
              className="inline-flex items-center gap-1.5 h-9 px-3 rounded-xl border border-neutral-200 bg-white text-xs font-semibold text-neutral-800 hover:bg-neutral-50 shadow-sm"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Back to list
            </button>
            <span className="text-xs text-neutral-500 truncate">
              Viewing full ticket
            </span>
            {presenceLabel && (
              <span className="inline-flex items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-medium text-amber-900">
                <Eye className="h-3 w-3 shrink-0" />
                {presenceLabel}
              </span>
            )}
          </div>
          {(() => {
            const ticket = focusedTicket;
            return (
                <div className="flex flex-1 min-h-0 min-w-0 flex-col overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-sm">
                  {/* Top bar */}
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-neutral-100 bg-gradient-to-r from-sky-50/80 to-white px-3.5 py-2.5 sm:px-4">
                    <div className="flex flex-wrap items-center gap-2 min-w-0">
                      <button
                        type="button"
                        title="Copy ticket ID"
                        onClick={async (e) => {
                          e.stopPropagation();
                          try {
                            await navigator.clipboard.writeText(ticket.id);
                            setCopiedTicketId(ticket.id);
                            window.setTimeout(() => setCopiedTicketId(null), 1500);
                          } catch {
                            /* ignore */
                          }
                        }}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-2 py-1 font-mono text-[11px] font-semibold text-neutral-800 hover:bg-neutral-50"
                      >
                        {ticket.id}
                        {copiedTicketId === ticket.id ? (
                          <Check className="h-3 w-3 text-emerald-600" />
                        ) : (
                          <Copy className="h-3 w-3 text-neutral-400" />
                        )}
                      </button>
                      <span className="inline-flex items-center gap-1 rounded-full bg-white border border-neutral-200 px-2 py-0.5 text-[11px] text-neutral-600">
                        {renderChannelIcon(ticket.channel)}
                        {ticket.channel}
                      </span>
                      {(() => {
                        const opened = formatTicketWhen(ticket.createdAt);
                        return (
                          <span
                            className="inline-flex items-center gap-1 text-[11px] text-neutral-500"
                            title={opened.absolute}
                          >
                            <Clock className="h-3 w-3" />
                            Opened {opened.relative}
                          </span>
                        );
                      })()}
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {renderStatusBadge(ticket.status)}
                      {renderPriorityBadge(ticket.priority)}
                      <button
                        type="button"
                        title="Back to list"
                        onClick={(e) => {
                          e.stopPropagation();
                          setExpandedTicketId(null);
                        }}
                        className="ml-1 inline-flex h-8 w-8 items-center justify-center rounded-lg border border-neutral-200 bg-white text-neutral-500 hover:bg-neutral-50 hover:text-neutral-800"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,0.9fr)] flex-1 min-h-0 overflow-y-auto">
                    {/* Main */}
                    <div className="p-4 sm:p-5 space-y-4 min-w-0 border-b xl:border-b-0 xl:border-r border-neutral-100">
                      <div>
                        <h2 className="text-lg sm:text-xl font-semibold text-neutral-900 tracking-tight leading-snug">
                          {ticket.subject}
                        </h2>
                        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-neutral-500">
                          <span className="inline-flex items-center gap-1.5">
                            <User className="h-3.5 w-3.5 text-neutral-400" />
                            {ticket.assignee !== 'Unassigned' ? (
                              <>
                                Agent{' '}
                                <span className="font-semibold text-neutral-800">
                                  {ticket.assignee}
                                </span>
                              </>
                            ) : (
                              <span className="font-semibold text-amber-700">
                                Agent unassigned
                              </span>
                            )}
                          </span>
                          <span className="inline-flex items-center gap-1.5">
                            <UserCheck className="h-3.5 w-3.5 text-neutral-400" />
                            {ticket.resolver ? (
                              <>
                                Resolver{' '}
                                <span className="font-semibold text-neutral-800">
                                  {ticket.resolver}
                                </span>
                              </>
                            ) : (
                              <span className="text-neutral-400">
                                Resolver unassigned
                              </span>
                            )}
                          </span>
                          {ticket.queue ? (
                            <span className="inline-flex items-center gap-1.5">
                              <Users className="h-3.5 w-3.5 text-neutral-400" />
                              <span className="font-medium text-neutral-700">
                                {ticket.queue}
                              </span>
                            </span>
                          ) : null}
                          {ticket.category ? (
                            <span className="inline-flex items-center gap-1.5">
                              <Tag className="h-3.5 w-3.5 text-neutral-400" />
                              {ticket.category}
                            </span>
                          ) : null}
                        </div>
                      </div>

                      {/* Progress — visible to every role including customers */}
                      <section className="rounded-xl border border-sky-100 bg-gradient-to-b from-sky-50/70 to-white px-3.5 py-3.5 space-y-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <h3 className="text-[11px] font-semibold uppercase tracking-wide text-sky-800/80">
                            Ticket progress
                          </h3>
                          <div className="flex flex-wrap items-center gap-1.5">
                            {progressLoading && !ticketProgress ? (
                              <span className="text-[11px] text-neutral-400">
                                Loading…
                              </span>
                            ) : (
                              <span className="inline-flex items-center rounded-full bg-white border border-sky-200 px-2 py-0.5 text-[11px] font-semibold text-sky-800">
                                {ticketProgress?.statusLabel ||
                                  statusLabel(ticket.status)}
                              </span>
                            )}
                            {(ticketProgress?.overdue ||
                              ticket.status === 'Overdue') && (
                              <span className="inline-flex items-center rounded-full bg-rose-50 border border-rose-200 px-2 py-0.5 text-[11px] font-semibold text-rose-800">
                                Overdue
                              </span>
                            )}
                          </div>
                        </div>

                        <ol className="flex items-start justify-between gap-1 sm:gap-2">
                          {(
                            ticketProgress?.steps || [
                              {
                                key: 'Open',
                                label: 'Submitted',
                                hint: 'Request received',
                                state:
                                  ticket.status === 'Open'
                                    ? ('current' as const)
                                    : ticket.status === 'Resolved'
                                      ? ('done' as const)
                                      : ('done' as const),
                              },
                              {
                                key: 'Pending',
                                label: 'In Progress',
                                hint: 'Being worked on',
                                state:
                                  ticket.status === 'Pending' ||
                                  ticket.status === 'Overdue' ||
                                  (ticket.status !== 'Open' &&
                                    ticket.status !== 'Resolved')
                                    ? ('current' as const)
                                    : ticket.status === 'Resolved'
                                      ? ('done' as const)
                                      : ('upcoming' as const),
                              },
                              {
                                key: 'Resolved',
                                label: 'Resolved',
                                hint: 'Closed',
                                state:
                                  ticket.status === 'Resolved'
                                    ? ('done' as const)
                                    : ('upcoming' as const),
                              },
                            ]
                          ).map((step, i, arr) => {
                            const done = step.state === 'done';
                            const current = step.state === 'current';
                            return (
                              <li
                                key={step.key}
                                className="flex-1 min-w-0 flex flex-col items-center text-center"
                              >
                                <div className="flex items-center w-full mb-1.5">
                                  {i > 0 ? (
                                    <div
                                      className={`h-0.5 flex-1 rounded-full ${
                                        done || current
                                          ? 'bg-sky-400'
                                          : 'bg-neutral-200'
                                      }`}
                                    />
                                  ) : (
                                    <div className="flex-1" />
                                  )}
                                  <span
                                    className={`mx-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 text-[11px] font-bold ${
                                      done
                                        ? 'border-sky-500 bg-sky-500 text-white'
                                        : current
                                          ? 'border-sky-500 bg-white text-sky-700 ring-4 ring-sky-100'
                                          : 'border-neutral-200 bg-white text-neutral-400'
                                    }`}
                                  >
                                    {done ? (
                                      <Check className="h-3.5 w-3.5" />
                                    ) : current ? (
                                      <Circle className="h-2.5 w-2.5 fill-sky-500 text-sky-500" />
                                    ) : (
                                      i + 1
                                    )}
                                  </span>
                                  {i < arr.length - 1 ? (
                                    <div
                                      className={`h-0.5 flex-1 rounded-full ${
                                        done ? 'bg-sky-400' : 'bg-neutral-200'
                                      }`}
                                    />
                                  ) : (
                                    <div className="flex-1" />
                                  )}
                                </div>
                                <p
                                  className={`text-[11px] font-semibold leading-tight ${
                                    done || current
                                      ? 'text-neutral-900'
                                      : 'text-neutral-400'
                                  }`}
                                >
                                  {step.label}
                                </p>
                                <p className="text-[10px] text-neutral-400 mt-0.5 hidden sm:block">
                                  {step.hint}
                                </p>
                              </li>
                            );
                          })}
                        </ol>

                        {ticketProgress?.history &&
                          ticketProgress.history.length > 0 && (
                            <div className="pt-1 border-t border-sky-100/80">
                              <p className="text-[10px] font-semibold uppercase tracking-wide text-neutral-400 mb-1.5">
                                Status history
                              </p>
                              <ul className="space-y-1 max-h-28 overflow-y-auto [scrollbar-width:thin]">
                                {ticketProgress.history.map((h, idx) => (
                                  <li
                                    key={`${h.at}-${idx}`}
                                    className="flex items-start justify-between gap-2 text-[11px]"
                                  >
                                    <span className="text-neutral-700 min-w-0">
                                      {h.label}
                                      {h.actor ? (
                                        <span className="text-neutral-400">
                                          {' '}
                                          · {h.actor}
                                        </span>
                                      ) : null}
                                    </span>
                                    <span
                                      className="shrink-0 text-neutral-400 tabular-nums"
                                      title={h.at}
                                    >
                                      {h.relative}
                                    </span>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}

                        {!canMutate && (
                          <p className="text-[10px] text-neutral-500">
                            You can track progress here. Status is updated by your
                            support team.
                          </p>
                        )}
                      </section>

                      {(() => {
                        const sla = formatSlaCountdown(ticket.dueAt);
                        if (!sla) return null;
                        return (
                          <div
                            className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-medium ${
                              sla.overdue
                                ? 'border-rose-200 bg-rose-50 text-rose-800'
                                : 'border-sky-200 bg-sky-50 text-sky-800'
                            }`}
                          >
                            <Clock className="h-3.5 w-3.5 shrink-0" />
                            <span>SLA · {sla.label}</span>
                          </div>
                        );
                      })()}

                      <section>
                        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-neutral-400 mb-2">
                          Description
                        </h3>
                        <div className="rounded-xl bg-neutral-50 border border-neutral-100 px-3.5 py-3 space-y-3">
                          {(() => {
                            const rolling =
                              aiSummaryByTicket[ticket.id]?.trim() ||
                              ticket.aiSummary?.trim() ||
                              '';
                            return (
                              <>
                                {rolling ? (
                                  <p className="text-sm text-neutral-800 leading-relaxed whitespace-pre-wrap select-text">
                                    {rolling}
                                  </p>
                                ) : (
                                  <p className="text-sm text-neutral-800 leading-relaxed whitespace-pre-wrap select-text">
                                    {ticket.description?.trim()
                                      ? ticket.description
                                      : 'No description provided.'}
                                  </p>
                                )}
                                {rolling && ticket.description?.trim() ? (
                                  <div className="border-t border-neutral-200 pt-3">
                                    <p className="text-[10px] font-semibold uppercase tracking-wide text-neutral-400 mb-1">
                                      Original request
                                    </p>
                                    <p className="text-sm text-neutral-600 leading-relaxed whitespace-pre-wrap select-text">
                                      {ticket.description.trim()}
                                    </p>
                                  </div>
                                ) : null}
                              </>
                            );
                          })()}
                        </div>
                      </section>

                      <section className="space-y-3">
                        <div className="flex items-center justify-between gap-2">
                          <h3 className="text-[11px] font-semibold uppercase tracking-wide text-neutral-400">
                            Activity
                          </h3>
                          {notesLoading && (
                            <span className="text-[11px] text-neutral-400">Loading…</span>
                          )}
                        </div>

                        <div className="relative pl-4 max-h-64 overflow-y-auto overscroll-contain [scrollbar-width:thin]">
                          <div className="absolute left-[5px] top-2 bottom-2 w-px bg-neutral-200" />
                          <ul className="space-y-3">
                            {(() => {
                              const opened = formatTicketWhen(ticket.createdAt);
                              return (
                                <li className="relative flex gap-3">
                                  <span className="absolute -left-4 mt-1.5 h-2.5 w-2.5 rounded-full border-2 border-white bg-neutral-300 ring-1 ring-neutral-200" />
                                  <div className="min-w-0 rounded-lg border border-neutral-100 bg-white px-3 py-2 text-xs text-neutral-600 shadow-sm">
                                    Opened via{' '}
                                    <span className="font-semibold text-neutral-800">
                                      {ticket.channel}
                                    </span>
                                    <span
                                      className="text-neutral-400"
                                      title={opened.absolute}
                                    >
                                      {' '}
                                      · {opened.relative}
                                    </span>
                                  </div>
                                </li>
                              );
                            })()}

                            {ticket.assignee !== 'Unassigned' && (
                              <li className="relative flex gap-3">
                                <span className="absolute -left-4 mt-1.5 h-2.5 w-2.5 rounded-full border-2 border-white bg-sky-500 ring-1 ring-sky-200" />
                                <div className="min-w-0 rounded-lg border border-neutral-100 bg-white px-3 py-2 text-xs text-neutral-600 shadow-sm">
                                  Assigned to{' '}
                                  <span className="font-semibold text-neutral-800">
                                    {ticket.assignee}
                                  </span>
                                  <span className="text-neutral-400">
                                    {' '}
                                    · {ticket.status === 'Pending'
                                      ? 'In Progress'
                                      : ticket.status}
                                  </span>
                                </div>
                              </li>
                            )}

                            {(ticketNotes[ticket.id] || []).map((note) => (
                              <li key={note.id} className="relative flex gap-3">
                                <span
                                  className={`absolute -left-4 mt-1.5 h-2.5 w-2.5 rounded-full border-2 border-white ring-1 ${
                                    note.visibility === 'public'
                                      ? 'bg-sky-500 ring-sky-200'
                                      : 'bg-neutral-700 ring-neutral-300'
                                  }`}
                                />
                                <div
                                  className={`min-w-0 flex-1 rounded-lg border px-3 py-2 shadow-sm ${
                                    note.visibility === 'public'
                                      ? 'border-sky-100 bg-sky-50/60'
                                      : 'border-neutral-100 bg-white'
                                  }`}
                                >
                                  <div className="flex items-center justify-between gap-2 mb-1">
                                    <div className="flex items-center gap-2 min-w-0">
                                      <span className="h-6 w-6 rounded-full bg-neutral-900 text-white text-[10px] font-bold flex items-center justify-center uppercase shrink-0">
                                        {note.author.slice(0, 2)}
                                      </span>
                                      <span className="text-xs font-semibold text-neutral-900 truncate">
                                        {note.author}
                                      </span>
                                    </div>
                                    <div className="flex items-center gap-1.5 shrink-0">
                                      <span
                                        className={`text-[10px] font-medium px-1.5 py-0.5 rounded-md ${
                                          note.visibility === 'public'
                                            ? 'bg-sky-100 text-sky-800'
                                            : 'bg-neutral-100 text-neutral-600'
                                        }`}
                                      >
                                        {note.visibility === 'public'
                                          ? 'Public'
                                          : 'Internal'}
                                      </span>
                                      <span className="text-[10px] text-neutral-400">
                                        {note.time}
                                      </span>
                                    </div>
                                  </div>
                                  <p className="text-xs text-neutral-700 leading-relaxed whitespace-pre-wrap select-text pl-8">
                                    {note.text}
                                  </p>
                                </div>
                              </li>
                            ))}
                          </ul>
                        </div>

                        {canMutate && (
                          <div className="rounded-xl border border-neutral-200 bg-neutral-50/90 p-3 space-y-2.5">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div className="inline-flex rounded-lg border border-neutral-200 overflow-hidden text-[11px] font-semibold bg-white">
                                <button
                                  type="button"
                                  onClick={() => setNoteVisibility('internal')}
                                  className={`px-2.5 py-1.5 ${
                                    noteVisibility === 'internal'
                                      ? 'bg-neutral-900 text-white'
                                      : 'text-neutral-600 hover:bg-neutral-50'
                                  }`}
                                >
                                  Internal
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setNoteVisibility('public')}
                                  className={`px-2.5 py-1.5 ${
                                    noteVisibility === 'public'
                                      ? 'bg-sky-700 text-white'
                                      : 'text-neutral-600 hover:bg-neutral-50'
                                  }`}
                                >
                                  Public reply
                                </button>
                              </div>
                              {macros.length > 0 && (
                                <select
                                  value=""
                                  onChange={(e) => {
                                    const m = macros.find(
                                      (x) => x.id === e.target.value
                                    );
                                    if (m) setNewNoteText(m.body);
                                  }}
                                  className="h-8 rounded-lg border border-neutral-200 bg-white px-2 text-[11px] max-w-[160px]"
                                >
                                  <option value="">Insert macro…</option>
                                  {macros.map((m) => (
                                    <option key={m.id} value={m.id}>
                                      {m.title}
                                    </option>
                                  ))}
                                </select>
                              )}
                            </div>
                            <div className="flex items-end gap-2">
                              <textarea
                                rows={2}
                                placeholder={
                                  noteVisibility === 'public'
                                    ? 'Write a customer-visible reply…'
                                    : 'Add an internal note…'
                                }
                                value={newNoteText}
                                onChange={(e) => setNewNoteText(e.target.value)}
                                onKeyDown={(e) => {
                                  if (
                                    e.key === 'Enter' &&
                                    !e.shiftKey &&
                                    newNoteText.trim()
                                  ) {
                                    e.preventDefault();
                                    postNote(ticket.id);
                                  }
                                }}
                                className="flex-1 resize-none rounded-xl border border-neutral-200 bg-white px-3 py-2.5 text-xs text-neutral-900 placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-300"
                              />
                              <button
                                type="button"
                                onClick={() => postNote(ticket.id)}
                                disabled={!newNoteText.trim()}
                                className="h-10 shrink-0 inline-flex items-center gap-1.5 rounded-xl bg-sky-600 px-3.5 text-xs font-semibold text-white hover:bg-sky-700 disabled:opacity-40"
                              >
                                <Send className="h-3.5 w-3.5" />
                                Post
                              </button>
                            </div>
                            <p className="text-[10px] text-neutral-400">
                              Enter to send · Shift+Enter for new line
                            </p>
                          </div>
                        )}
                      </section>
                    </div>

                    {/* Side rail */}
                    <aside className="bg-neutral-50/50 p-4 sm:p-5 space-y-3.5">
                      <div className="rounded-xl border border-neutral-200 bg-white p-3.5">
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-400 mb-3">
                          Customer
                        </p>
                        <div className="flex items-center gap-3">
                          <div className="h-10 w-10 rounded-full bg-sky-100 text-sky-800 flex items-center justify-center text-xs font-bold shrink-0">
                            {ticket.customerName
                              .split(' ')
                              .map((n) => n[0])
                              .join('')
                              .slice(0, 2)}
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-neutral-900 truncate">
                              {ticket.customerName}
                            </p>
                            <a
                              href={`mailto:${ticket.customerEmail}`}
                              className="text-[11px] text-sky-700 hover:underline truncate block"
                              onClick={(e) => e.stopPropagation()}
                            >
                              {ticket.customerEmail}
                            </a>
                            {ticket.customerPhone ? (
                              <p className="text-[11px] text-neutral-400 truncate">
                                {ticket.customerPhone}
                              </p>
                            ) : null}
                          </div>
                        </div>
                      </div>

                      <div className="rounded-xl border border-neutral-200 bg-white p-3.5 space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-400">
                            History
                          </p>
                          {customer360 && (
                            <p className="text-[11px] font-semibold text-neutral-700">
                              CSAT{' '}
                              {customer360.avgCsat != null
                                ? `${customer360.avgCsat}/5`
                                : '—'}
                            </p>
                          )}
                        </div>
                        {customer360Loading ? (
                          <p className="text-[11px] text-neutral-400">Loading…</p>
                        ) : customer360 ? (
                          <>
                            <p className="text-[11px] text-neutral-500">
                              {customer360.totalTickets} ticket
                              {customer360.totalTickets === 1 ? '' : 's'}
                              {customer360.ratingsCount
                                ? ` · ${customer360.ratingsCount} ratings`
                                : ''}
                            </p>
                            <ul className="space-y-1.5 max-h-36 overflow-y-auto [scrollbar-width:thin]">
                              {customer360.tickets.slice(0, 8).map((pt) => (
                                <li
                                  key={pt.id}
                                  className="text-[11px] flex items-start justify-between gap-2 rounded-lg bg-neutral-50 px-2 py-1.5"
                                >
                                  <div className="min-w-0">
                                    <span className="font-mono text-neutral-400">
                                      {pt.id}
                                    </span>{' '}
                                    <span className="text-neutral-800">{pt.subject}</span>
                                  </div>
                                  <span className="shrink-0 text-neutral-500">
                                    {pt.status}
                                    {pt.csatScore != null ? ` · ${pt.csatScore}★` : ''}
                                  </span>
                                </li>
                              ))}
                            </ul>
                          </>
                        ) : (
                          <p className="text-[11px] text-neutral-400">
                            No prior tickets for this email.
                          </p>
                        )}
                      </div>

                      {canMutate && (
                        <div className="rounded-xl border border-neutral-200 bg-white p-3.5 space-y-2.5">
                          <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-400">
                            Quick actions
                          </p>
                          <div className="grid grid-cols-2 gap-1.5">
                            {ticket.status === 'Resolved' ? (
                              <button
                                type="button"
                                onClick={() =>
                                  updateTicketAndRefreshSummary(ticket.id, {
                                    status: 'Reopened',
                                  })
                                }
                                className="col-span-2 py-2 px-2 border border-amber-200 bg-amber-50 hover:bg-amber-100 text-[11px] font-semibold rounded-lg text-amber-900 inline-flex items-center justify-center gap-1.5"
                              >
                                <RotateCcw className="h-3.5 w-3.5" />
                                Reopen
                              </button>
                            ) : (
                              <>
                                <button
                                  type="button"
                                  onClick={() =>
                                    updateTicketAndRefreshSummary(ticket.id, {
                                      status: 'Pending',
                                    })
                                  }
                                  disabled={ticket.status === 'Pending'}
                                  className="py-2 px-2 border border-neutral-200 bg-white hover:bg-sky-50 hover:border-sky-200 disabled:opacity-40 text-[11px] font-semibold rounded-lg text-neutral-800"
                                >
                                  In Progress
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    updateTicketAndRefreshSummary(ticket.id, {
                                      status: 'Resolved',
                                    })
                                  }
                                  disabled={ticket.status === 'Resolved'}
                                  className="py-2 px-2 bg-emerald-600 text-white hover:bg-emerald-700 disabled:bg-neutral-100 disabled:text-neutral-400 text-[11px] font-semibold rounded-lg inline-flex items-center justify-center gap-1.5"
                                >
                                  <CheckCircle2 className="h-3.5 w-3.5" />
                                  Resolve
                                </button>
                              </>
                            )}
                          </div>
                          {ticket.assignee !== currentUser.name && (
                            <button
                              type="button"
                              onClick={() =>
                                onUpdateTicket(ticket.id, {
                                  assignee: currentUser.name,
                                })
                              }
                              className="w-full py-2 bg-white hover:bg-neutral-50 text-neutral-800 border border-neutral-200 text-xs font-semibold rounded-lg inline-flex items-center justify-center gap-1.5"
                            >
                              <UserCheck className="h-3.5 w-3.5" />
                              Assign to me
                            </button>
                          )}
                        </div>
                      )}

                      {ticket.status === 'Resolved' && (
                        <div className="rounded-xl border border-neutral-200 bg-white p-3.5 space-y-2">
                          <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-400">
                            Satisfaction
                          </p>
                          {ticket.csatScore ? (
                            <div className="space-y-1">
                              <p className="text-sm font-semibold text-neutral-800">
                                {ticket.csatScore}/5
                              </p>
                              {ticket.csatComment ? (
                                <p className="text-xs text-neutral-600 leading-relaxed">
                                  {ticket.csatComment}
                                </p>
                              ) : null}
                            </div>
                          ) : (
                            <p className="text-xs text-neutral-400">
                              Waiting for customer rating in the support portal
                            </p>
                          )}
                        </div>
                      )}

                      {canMutate && roster.length > 0 && (
                        <div className="rounded-xl border border-neutral-200 bg-white p-3.5 space-y-2">
                          <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-400">
                            Reassign agent / set resolver
                          </p>
                          <select
                            value={
                              expandedTicketId === ticket.id ? reassignPick : ''
                            }
                            onChange={(e) => setReassignPick(e.target.value)}
                            className="w-full h-9 rounded-lg border border-neutral-200 bg-white px-2 text-xs"
                          >
                            <option value="">Select teammate…</option>
                            {roster
                              .filter((m) => m.name !== ticket.assignee)
                              .map((m) => (
                                <option key={m.id} value={m.name}>
                                  {m.name}
                                  {m.role ? ` (${m.role})` : ''}
                                  {m.skills?.length
                                    ? ` — ${m.skills.slice(0, 3).join(', ')}`
                                    : ''}
                                </option>
                              ))}
                          </select>
                          <label className="flex items-center gap-2 text-[11px] text-neutral-600">
                            <input
                              type="checkbox"
                              checked={reassignEscalate}
                              onChange={(e) =>
                                setReassignEscalate(e.target.checked)
                              }
                              className="rounded border-neutral-300"
                            />
                            Set as resolver (keep agent)
                          </label>
                          <button
                            type="button"
                            disabled={!reassignPick}
                            onClick={() => {
                              if (!reassignPick) return;
                              if (reassignEscalate) {
                                onUpdateTicket(ticket.id, {
                                  resolver: reassignPick,
                                  escalate: true,
                                });
                              } else {
                                onUpdateTicket(ticket.id, {
                                  assignee: reassignPick,
                                });
                              }
                              setReassignPick('');
                              setReassignEscalate(false);
                            }}
                            className="w-full py-2.5 bg-neutral-900 hover:bg-black disabled:opacity-40 text-white text-xs font-semibold rounded-lg"
                          >
                            {reassignEscalate ? 'Escalate to' : 'Reassign to'}{' '}
                            {reassignPick || '…'}
                          </button>
                        </div>
                      )}

                      <p className="text-[10px] text-neutral-400 leading-relaxed px-0.5">
                        Use Quick actions and Reassign here, or go back to the list to edit cells inline.
                      </p>
                    </aside>
                  </div>
                </div>
            );
          })()}
        </div>
      ) : (
      <>

      {/* Search + filters toolbar */}
      <div className="@container shrink-0 min-w-0 rounded-xl border border-neutral-200 bg-neutral-50/70 p-2.5 font-sans">
        <div className="flex items-center justify-between gap-2 mb-2">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold text-neutral-500 uppercase tracking-wide">
            <Filter className="h-3.5 w-3.5 text-neutral-400" />
            <span>Filters</span>
          </div>
          {(externalCreatorFilter === 'me' || externalAssigneeFilter === 'me' || effectiveStatusFilter !== 'All' || effectivePriorityFilter !== 'All' || effectiveChannelFilter !== 'All' || searchQuery !== '') && (
            <button
              id="clear-all-filters-btn"
              type="button"
              onClick={() => {
                setStatusFilter('All');
                setPriorityFilter('All');
                setChannelFilter('All');
                onSearchQueryChange('');
                onFacetFiltersChange?.({
                  priority: '',
                  status: '',
                  channel: '',
                  creator: '',
                  assignee: '',
                });
              }}
              className="text-[11px] font-semibold text-neutral-500 hover:text-neutral-900"
            >
              Reset
            </button>
          )}
        </div>

        {viewMode !== 'search' && (
          <div className="relative mb-2">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-neutral-400 pointer-events-none" />
            <input
              type="text"
              placeholder="Search tickets..."
              value={searchQuery}
              onChange={(e) => onSearchQueryChange(e.target.value)}
              className="w-full h-9 bg-white border border-neutral-200 py-2 pl-9 pr-8 text-xs placeholder-neutral-400 focus:outline-none focus:border-neutral-400 rounded-lg text-black"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => onSearchQueryChange('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 h-5 w-5 flex items-center justify-center text-neutral-400 hover:text-black cursor-pointer rounded"
                title="Clear search"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
        )}

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
          <FilterDropdown
            id="filter-status-select"
            label="Status"
            value={effectiveStatusFilter}
            options={[
              { value: 'All', label: 'All Statuses' },
              ...statusOptions.map((s) => ({ value: s.status, label: s.displayName })),
            ]}
            onChange={(v) => {
              setStatusFilter(v);
              onFacetFiltersChange?.({ status: v === 'All' ? '' : v });
            }}
          />
          <FilterDropdown
            id="filter-priority-select"
            label="Priority"
            value={
              effectivePriorityFilter === 'All'
                ? 'All'
                : priorityOptions.find(
                    (p) =>
                      p.priority.toLowerCase() ===
                      effectivePriorityFilter.toLowerCase()
                  )?.priority || effectivePriorityFilter
            }
            options={[
              { value: 'All', label: 'All Priorities' },
              ...priorityOptions.map((p) => ({ value: p.priority, label: p.displayName })),
              ...(effectivePriorityFilter !== 'All' &&
              !priorityOptions.some(
                (p) =>
                  p.priority.toLowerCase() ===
                  effectivePriorityFilter.toLowerCase()
              )
                ? [{ value: effectivePriorityFilter, label: effectivePriorityFilter }]
                : []),
            ]}
            onChange={(v) => {
              setPriorityFilter(v);
              onFacetFiltersChange?.({
                priority: v === 'All' ? '' : v,
              });
            }}
          />
          <FilterDropdown
            id="filter-channel-select"
            label="Channel"
            value={effectiveChannelFilter}
            options={[
              { value: 'All', label: 'All Channels' },
              { value: 'Email', label: 'Email' },
              { value: 'Chat', label: 'Chat' },
              { value: 'Phone', label: 'Phone' },
              { value: 'Web', label: 'Web Portal' },
            ]}
            onChange={(v) => {
              setChannelFilter(v);
              onFacetFiltersChange?.({ channel: v === 'All' ? '' : v });
            }}
          />
          <FilterDropdown
            id="sort-order-select"
            label="Sort order"
            value={sortOrder}
            options={[
              { value: 'latest', label: 'Latest' },
              { value: 'oldest', label: 'Oldest' },
              { value: 'priority', label: 'Highest Priority' },
            ]}
            onChange={(v) => setSortOrder(v as 'latest' | 'oldest' | 'priority')}
          />
        </div>
      </div>

      {/* View 4 Custom Granular Search Box if viewMode === 'search' */}
      {viewMode === 'search' && (
        <div className="border border-neutral-200 p-5 bg-white space-y-4">
          <div className="relative font-mono">
            <Search className="absolute left-3 top-3 h-4 w-4 text-neutral-400" />
            <input
              id="advanced-search-input"
              type="text"
              placeholder="Search by keyword, Ticket ID, subject, customer name, email..."
              value={searchQuery}
              onChange={(e) => onSearchQueryChange(e.target.value)}
              className="w-full bg-white border border-neutral-200 py-2.5 pl-10 pr-4 text-xs placeholder-neutral-400 focus:outline-none focus:border-black rounded-none text-black"
            />
          </div>
        </div>
      )}

      {/* Bulk Action Strip if items are selected */}
      {selectedTickets.length > 0 && (
        <div className="shrink-0 bg-black text-white border border-black p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 font-mono text-xs">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <span className="font-bold">{selectedTickets.length} tickets selected</span>
            <div className="h-4 w-px bg-neutral-800" />
            <button
              onClick={() => {
                selectedTickets.forEach((id) =>
                  updateTicketAndRefreshSummary(id, { status: 'Resolved' })
                );
                setSelectedTickets([]);
              }}
              className="text-white hover:underline cursor-pointer uppercase text-[11px] font-semibold tracking-wider"
            >
              Mark Resolved
            </button>
            <div className="h-4 w-px bg-neutral-800" />
            <button
              onClick={() => {
                selectedTickets.forEach(id => onUpdateTicket(id, { priority: 'urgent' }));
                setSelectedTickets([]);
              }}
              className="text-white hover:underline cursor-pointer uppercase text-[11px] font-semibold tracking-wider"
            >
              Escalate to Urgent
            </button>
          </div>
          <button 
            onClick={() => setSelectedTickets([])}
            className="text-neutral-400 hover:text-white cursor-pointer uppercase text-[10px] tracking-widest"
          >
            Deselect All
          </button>
        </div>
      )}

      {/* Ticket list — cards on phone/tablet, table on lg+ */}
      <div className="flex flex-1 min-h-0 min-w-0 w-full flex-col overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-sm">
        <div className={`min-h-0 flex-1 overflow-auto overscroll-contain ${embedded ? 'px-1' : 'p-2 sm:p-3'}`}>
        {/* Mobile / tablet cards */}
        <div className="lg:hidden space-y-2 p-1">
          {sortedTickets.length > 0 ? (
            sortedTickets.map((ticket) => {
              const isSelected = selectedTickets.includes(ticket.id);
              return (
                <div
                  key={ticket.id}
                  className={`rounded-xl border p-3 transition-colors ${
                    isSelected
                      ? 'border-neutral-900 bg-neutral-50'
                      : 'border-neutral-200 bg-white'
                  }`}
                >
                  <div className="flex items-start gap-2.5">
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => handleToggleSelectOne(ticket.id)}
                      className="mt-1 rounded-md border-neutral-300 focus:ring-0 focus:ring-offset-0 cursor-pointer h-4 w-4 shrink-0"
                      aria-label={`Select ${ticket.id}`}
                    />
                    <button
                      type="button"
                      className="min-w-0 flex-1 text-left"
                      onClick={() => setExpandedTicketId(ticket.id)}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-[11px] text-neutral-500">{ticket.id}</span>
                        <span className="text-[10px] font-mono text-neutral-400 shrink-0">
                          {ticket.updatedAt}
                        </span>
                      </div>
                      <p className="mt-0.5 text-sm font-semibold text-neutral-900 line-clamp-2">
                        {ticket.subject}
                      </p>
                      <p className="mt-1 text-[11px] text-neutral-500 line-clamp-1">
                        {ticket.createdByName || ticket.customerName}
                        {ticket.customerEmail ? ` · ${ticket.customerEmail}` : ''}
                      </p>
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        {renderStatusBadge(ticket.status)}
                        {renderPriorityBadge(ticket.priority)}
                        {ticket.assignee !== 'Unassigned' ? (
                          <span className="inline-flex items-center gap-1 text-[11px] text-neutral-600">
                            <User className="h-3 w-3 text-neutral-400" />
                            {ticket.assignee}
                          </span>
                        ) : null}
                        {ticket.queue ? (
                          <span className="text-[11px] text-neutral-500 truncate max-w-[10rem]">
                            {ticket.queue}
                          </span>
                        ) : null}
                      </div>
                    </button>
                  </div>
                </div>
              );
            })
          ) : (
            <div className="py-12 px-4 text-center text-neutral-500">
              <AlertTriangle className="h-5 w-5 text-neutral-700 mx-auto mb-2" />
              <p className="text-sm font-medium text-neutral-700">
                No tickets match the selected filters
                {searchQuery ? (
                  <>
                    {' '}
                    for <span className="font-semibold">“{searchQuery}”</span>
                  </>
                ) : null}
                .
              </p>
            </div>
          )}
        </div>

        <table
          id="tickets-table"
          className={`hidden lg:table w-full text-left font-sans text-xs ${
            embedded
              ? 'border-collapse'
              : 'border-separate border-spacing-y-2'
          }`}
        >
          <thead className={embedded ? 'sticky top-0 z-10 bg-neutral-50/95 backdrop-blur-sm' : ''}>
            <tr className="font-sans text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
              <th className={`${embedded ? 'py-3 px-3 w-10' : 'rounded-l-xl bg-white py-3 px-4 w-10'}`}>
                <input
                  type="checkbox"
                  checked={sortedTickets.length > 0 && selectedTickets.length === sortedTickets.length}
                  onChange={handleToggleSelectAll}
                  className="rounded-md border-neutral-300 focus:ring-0 focus:ring-offset-0 cursor-pointer h-4 w-4"
                />
              </th>
              <th className={`${embedded ? 'py-3 px-3 w-20' : 'bg-white py-3 px-3 w-20'}`}>ID</th>
              <th className={`${embedded ? 'py-3 px-3' : 'bg-white py-3 px-3 min-w-[200px]'}`}>Subject</th>
              <th className={`${embedded ? 'py-3 px-3' : 'bg-white py-3 px-3'} w-16 text-center`}>Channel</th>
              <th className={`${embedded ? 'py-3 px-3' : 'bg-white py-3 px-3'} w-36`}>Team</th>
              <th className={`${embedded ? 'py-3 px-3' : 'bg-white py-3 px-3'} w-40`}>Assignee</th>
              <th className={`${embedded ? 'py-3 px-3' : 'bg-white py-3 px-3'} w-28`}>Priority</th>
              <th className={`${embedded ? 'py-3 px-3' : 'bg-white py-3 px-3'} w-32`}>Status</th>
              {!embedded && (
                <th className="rounded-r-xl bg-white py-3 px-4 w-28 text-right">Updated</th>
              )}
            </tr>
          </thead>
          
          <tbody>
            {sortedTickets.length > 0 ? (
              sortedTickets.map((ticket) => {
                const isSelected = selectedTickets.includes(ticket.id);
                const isExpanded = expandedTicketId === ticket.id;

                return (
                  <React.Fragment key={ticket.id}>
                    <tr className="group/row transition-colors">
                      <td className={listRowCellClass(isSelected, isExpanded, 'first')}>
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => handleToggleSelectOne(ticket.id)}
                          className="rounded-md border-neutral-300 focus:ring-0 focus:ring-offset-0 cursor-pointer h-4 w-4"
                        />
                      </td>

                      <td
                        className={listRowCellClass(
                          isSelected,
                          isExpanded,
                          'middle',
                          'px-3 font-mono text-neutral-500 cursor-pointer'
                        )}
                        onClick={() => setExpandedTicketId(ticket.id)}
                        title="Open ticket"
                      >
                        {ticket.id}
                      </td>

                      <td
                        className={listRowCellClass(
                          isSelected,
                          isExpanded,
                          'middle',
                          'px-3 pr-4 cursor-pointer'
                        )}
                        onClick={() => setExpandedTicketId(ticket.id)}
                      >
                        <div className="font-semibold text-sm text-neutral-900 select-none flex items-center gap-1.5 min-w-0">
                          <span className="truncate">{ticket.subject}</span>
                          <ChevronDown className="h-3 w-3 text-neutral-400 opacity-0 group-hover/row:opacity-100 transition-opacity shrink-0" />
                        </div>
                        <div className="text-neutral-400 text-[11px] mt-1 leading-snug line-clamp-2 select-none">
                          {ticket.createdByName || ticket.customerName}
                          {ticket.customerEmail
                            ? ` · ${ticket.customerEmail}`
                            : ''}
                        </div>
                      </td>

                      <td
                        className={listRowCellClass(
                          isSelected,
                          isExpanded,
                          'middle',
                          'px-3 text-center'
                        )}
                      >
                        {renderListChannelCell(ticket)}
                      </td>

                      <td
                        className={listRowCellClass(
                          isSelected,
                          isExpanded,
                          'middle',
                          'px-3 text-neutral-700'
                        )}
                      >
                        <div className="py-1 truncate max-w-[140px]" title={ticket.queue || 'No queue'}>
                          <span className={!ticket.queue ? 'text-neutral-400 italic' : ''}>
                            {ticket.queue || '—'}
                          </span>
                        </div>
                      </td>

                      <td
                        className={listRowCellClass(
                          isSelected,
                          isExpanded,
                          'middle',
                          'px-3 text-neutral-700'
                        )}
                      >
                        <div className="flex items-center space-x-1.5 py-1">
                          <User className="h-3.5 w-3.5 text-neutral-400" />
                          <span className={ticket.assignee === 'Unassigned' ? 'text-neutral-400 italic' : ''}>
                            {ticket.assignee}
                          </span>
                        </div>
                      </td>

                      <td className={listRowCellClass(isSelected, isExpanded, 'middle', 'px-3')}>
                        {canMutate ? (
                          <div
                            className={`relative inline-flex items-center max-w-full rounded-md border ${priorityBadgeClass(ticket.priority)}`}
                          >
                            <select
                              value={ticket.priority}
                              aria-label="Priority"
                              title="Change priority"
                              onClick={(e) => e.stopPropagation()}
                              onChange={(e) => {
                                onUpdateTicket(ticket.id, {
                                  priority: e.target.value as Priority,
                                });
                              }}
                              className="appearance-none cursor-pointer bg-transparent border-0 rounded-md pl-2.5 pr-6 py-0.5 text-[9px] font-mono uppercase outline-none focus:ring-2 focus:ring-neutral-900/15"
                            >
                              {priorityOptions.map((p) => (
                                <option key={p.priority} value={p.priority}>
                                  {p.displayName}
                                </option>
                              ))}
                              {!priorityOptions.some((p) => p.priority === ticket.priority) && (
                                <option value={ticket.priority}>{ticket.priority}</option>
                              )}
                            </select>
                            <ChevronDown
                              className="pointer-events-none absolute right-1.5 h-3 w-3 opacity-70"
                              aria-hidden
                            />
                          </div>
                        ) : (
                          renderPriorityBadge(ticket.priority)
                        )}
                      </td>

                      <td
                        className={listRowCellClass(
                          isSelected,
                          isExpanded,
                          embedded ? 'last' : 'middle',
                          'px-3'
                        )}
                      >
                        {renderListStatusCell(ticket)}
                      </td>

                      {!embedded && (
                        <td
                          className={listRowCellClass(
                            isSelected,
                            isExpanded,
                            'last',
                            'text-right font-mono text-neutral-400 text-[10px]'
                          )}
                        >
                          {ticket.updatedAt}
                        </td>
                      )}
                    </tr>

                  </React.Fragment>
                );
              })
            ) : (
              <tr>
                <td
                  colSpan={listColCount}
                  className="border-b border-neutral-200 py-16 px-4 text-center text-neutral-500 align-top"
                >
                  <div className="flex flex-col items-center justify-center gap-2 max-w-sm mx-auto">
                    <AlertTriangle className="h-5 w-5 text-neutral-700 shrink-0" />
                    <p className="text-sm font-medium text-neutral-700 break-words">
                      No tickets match the selected filters
                      {searchQuery ? (
                        <>
                          {' '}
                          for <span className="font-semibold">“{searchQuery}”</span>
                        </>
                      ) : null}
                      .
                    </p>
                    {(searchQuery ||
                      externalCreatorFilter === 'me' ||
                      externalAssigneeFilter === 'me' ||
                      effectiveStatusFilter !== 'All' ||
                      effectivePriorityFilter !== 'All' ||
                      effectiveChannelFilter !== 'All') && (
                      <button
                        type="button"
                        onClick={() => {
                          setStatusFilter('All');
                          setPriorityFilter('All');
                          setChannelFilter('All');
                          onSearchQueryChange('');
                          onFacetFiltersChange?.({
                            priority: '',
                            status: '',
                            channel: '',
                            creator: '',
                            assignee: '',
                          });
                        }}
                        className="mt-1 h-8 px-3 rounded-lg border border-neutral-200 bg-white text-xs font-semibold text-neutral-700 hover:bg-neutral-50"
                      >
                        Clear search & filters
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
        </div>
      </div>

      {!embedded && (
        <div className="shrink-0 text-[11px] text-neutral-400 px-1 py-1 min-w-0">
          <span className="leading-relaxed break-words">
            Open a ticket to see full progress, notes, SLA, and customer history. Priority and Status
            are dropdowns — click once to change.
          </span>
        </div>
      )}

      </>
      )}

      </div>
    </PageShell>
  );
}