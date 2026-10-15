/**
 * Co-worker UI actions — competitor-style tool catalog.
 * LLM (or thin rules) choose actions; only the app mutates filters/navigation.
 */

export type CoworkerFilterModule =
  | 'customers'
  | 'tickets'
  | 'kb'
  | 'teams'
  | 'macros'
  | 'analytics'
  | 'csat'
  | 'audit'
  | 'directory';

export type CoworkerSetFilterAction = {
  type: 'set_filter';
  module: CoworkerFilterModule;
  /** Text search; "" = clear search (list-all when no facets). */
  query: string;
  /** Tickets: Open | Pending | Reopened | Resolved | Closed | Overdue (+ org customs). Customers: Active | Inactive. */
  status?: string;
  /** Tickets: low | medium | high | urgent */
  priority?: string;
  /** Tickets: Email | Webchat | Chat | WhatsApp | Instagram | Facebook | Phone | Web */
  channel?: string;
  /** Tickets created by the current authenticated user. */
  creator?: 'me';
  /** Tickets assigned to the current authenticated user, unassigned, or a named agent. */
  assignee?: 'me' | 'unassigned' | string;
  /** Tickets in this queue/team name. */
  queue?: string;
  /** Analytics / CSAT / audit date preset (UI picker parity). */
  range?: string;
};

export type CoworkerUiAction =
  | { type: 'navigate'; view: string }
  | CoworkerSetFilterAction
  | { type: 'clear_filters'; module: CoworkerFilterModule | 'all' };

export type CoworkerUiActionsResult = {
  actions: CoworkerUiAction[];
  /** Optional model hint — UI still phrases via LLM separately when needed. */
  replyHint?: string;
};

const FILTER_MODULES: CoworkerFilterModule[] = [
  'customers',
  'tickets',
  'kb',
  'teams',
  'macros',
  'analytics',
  'csat',
  'audit',
  'directory',
];

const TICKET_STATUSES = new Set([
  'Open',
  'Pending',
  'In Progress',
  'Reopened',
  'Resolved',
  'Closed',
  'Overdue',
]);
const TICKET_PRIORITIES = new Set(['low', 'medium', 'high', 'urgent']);
const TICKET_CHANNELS = new Set([
  'Email',
  'Webchat',
  'Chat',
  'WhatsApp',
  'Instagram',
  'Facebook',
  'Phone',
  'Web',
]);
const CUSTOMER_STATUSES = new Set(['Active', 'Inactive']);

function asModule(raw: unknown): CoworkerFilterModule | null {
  const m = String(raw || '')
    .trim()
    .toLowerCase();
  if (m === 'customers' || m === 'customer' || m === 'clients' || m === 'client') {
    return 'customers';
  }
  if (m === 'tickets' || m === 'ticket' || m === 'cases' || m === 'case') return 'tickets';
  if (m === 'kb' || m === 'knowledge' || m === 'articles' || m === 'article') return 'kb';
  if (m === 'teams' || m === 'team' || m === 'queues' || m === 'queue') return 'teams';
  if (m === 'macros' || m === 'macro') return 'macros';
  if (m === 'analytics' || m === 'reports' || m === 'report') return 'analytics';
  if (m === 'csat' || m === 'csat-reports' || m === 'csatreports') return 'csat';
  if (m === 'audit' || m === 'audit-log' || m === 'auditlog') return 'audit';
  if (
    m === 'directory' ||
    m === 'escalation-directory' ||
    m === 'escalation' ||
    m === 'escalations'
  ) {
    return 'directory';
  }
  return null;
}

function moduleFromView(view: string): CoworkerFilterModule | null {
  if (view === 'customers') return 'customers';
  if (view === 'kb') return 'kb';
  if (view === 'agent-queues') return 'teams';
  if (view === 'macros') return 'macros';
  if (view === 'analytics') return 'analytics';
  if (view === 'csat-reports') return 'csat';
  if (view === 'audit') return 'audit';
  if (view === 'escalation-directory') return 'directory';
  if (
    ['team-queue', 'team-inbox', 'unassigned', 'assigned', 'search', 'tickets-list'].includes(
      view
    )
  ) {
    return 'tickets';
  }
  return null;
}

function normalizeAnalyticsRange(raw: unknown): string | undefined {
  const s = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, '');
  if (['24hours', '24h', 'today', 'yesterday'].includes(s)) return '24hours';
  if (['7days', '7d', 'week', 'last7days'].includes(s)) return '7days';
  if (['30days', '30d', 'month', 'last30days'].includes(s)) return '30days';
  return undefined;
}

function normalizeCsatRange(raw: unknown): string | undefined {
  const s = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, '');
  if (['7days', '7d', 'week', 'last7days'].includes(s)) return '7days';
  if (['30days', '30d', 'month', 'last30days'].includes(s)) return '30days';
  if (['90days', '90d', 'last90days'].includes(s)) return '90days';
  return undefined;
}

function normalizeAuditRange(raw: unknown): string | undefined {
  const s = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, '');
  if (['today', 'last24h', '24hours', '24h'].includes(s)) return '24hours';
  if (s === 'yesterday') return 'yesterday';
  if (['7days', '7d', 'last7d', 'thisweek', 'lastweek'].includes(s)) return '7days';
  if (['30days', '30d', 'last30d', 'thismonth', 'lastmonth'].includes(s)) return '30days';
  if (['90days', '90d', 'last90d'].includes(s)) return '90days';
  return undefined;
}

function normalizeTicketStatus(raw: unknown): string | undefined {
  const s = String(raw || '').trim();
  if (!s) return undefined;
  const lower = s.toLowerCase();
  if (lower === 'open' || lower === 'new') return 'Open';
  if (
    lower === 'pending' ||
    lower === 'in progress' ||
    lower === 'waiting' ||
    lower === 'on hold' ||
    lower === 'hold' ||
    lower === 'on-hold'
  ) {
    return 'In Progress';
  }
  if (lower === 'resolved' || lower === 'done') return 'Resolved';
  if (lower === 'closed') return 'Closed';
  if (lower === 'reopened' || lower === 'reopen') return 'Reopened';
  if (lower === 'overdue') return 'Overdue';
  // Pass through system keys or custom catalog keys as-is
  if (TICKET_STATUSES.has(s)) return s;
  return s;
}

function normalizeTicketPriority(raw: unknown): string | undefined {
  const s = String(raw || '')
    .trim()
    .toLowerCase();
  if (!s) return undefined;
  if (s === 'p1' || s === 'critical') return 'urgent';
  if (s === 'p2') return 'high';
  if (s === 'p3') return 'medium';
  if (s === 'p4') return 'low';
  return TICKET_PRIORITIES.has(s) ? s : undefined;
}

function normalizeTicketChannel(raw: unknown): string | undefined {
  const s = String(raw || '').trim();
  if (!s) return undefined;
  for (const label of TICKET_CHANNELS) {
    if (label.toLowerCase() === s.toLowerCase()) return label;
  }
  const lower = s.toLowerCase().replace(/-/g, '_');
  if (lower === 'email') return 'Email';
  if (lower === 'webchat') return 'Webchat';
  if (lower === 'chat' || lower === 'messaging') return 'Webchat';
  if (lower === 'whatsapp') return 'WhatsApp';
  if (lower === 'instagram') return 'Instagram';
  if (lower === 'facebook') return 'Facebook';
  if (lower === 'phone' || lower === 'call' || lower === 'ivr') return 'Phone';
  if (lower === 'web' || lower === 'portal' || lower === 'web_form' || lower === 'api') {
    return 'Web';
  }
  return undefined;
}

function normalizeCustomerStatus(raw: unknown): string | undefined {
  const s = String(raw || '').trim();
  if (!s) return undefined;
  const titled = s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
  return CUSTOMER_STATUSES.has(titled) ? titled : undefined;
}

/** Normalize unknown JSON into a safe action list (never trust raw user text as query). */
export function normalizeCoworkerUiActions(raw: unknown): CoworkerUiAction[] {
  if (!Array.isArray(raw)) return [];
  const out: CoworkerUiAction[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const type = String((item as { type?: string }).type || '')
      .trim()
      .toLowerCase();
    if (type === 'navigate') {
      const view = String((item as { view?: string }).view || '').trim();
      if (view) out.push({ type: 'navigate', view });
      continue;
    }
    if (type === 'set_filter') {
      const mod = asModule((item as { module?: string }).module);
      if (!mod) continue;
      let query = String((item as { query?: string }).query ?? '').trim();
      if (query.length > 80) continue;
      if (
        /^(list|show|display|clear|all|everything)\b/i.test(query) &&
        query.split(/\s+/).length <= 3
      ) {
        query = '';
      }
      const action: CoworkerSetFilterAction = {
        type: 'set_filter',
        module: mod,
        query,
      };
      const rawStatus = (item as { status?: unknown }).status;
      const rawPriority = (item as { priority?: unknown }).priority;
      const rawChannel = (item as { channel?: unknown }).channel;
      const rawCreator = (item as { creator?: unknown }).creator;
      const rawAssignee = (item as { assignee?: unknown }).assignee;
      if (rawStatus !== undefined && rawStatus !== null && String(rawStatus).trim() !== '') {
        if (mod === 'tickets') {
          const st = normalizeTicketStatus(rawStatus);
          if (st) action.status = st;
        } else if (mod === 'customers') {
          const st = normalizeCustomerStatus(rawStatus);
          if (st) action.status = st;
        }
      }
      if (mod === 'tickets') {
        if (rawPriority !== undefined && rawPriority !== null && String(rawPriority).trim() !== '') {
          const pr = normalizeTicketPriority(rawPriority);
          if (pr) action.priority = pr;
        }
        if (rawChannel !== undefined && rawChannel !== null && String(rawChannel).trim() !== '') {
          const ch = normalizeTicketChannel(rawChannel);
          if (ch) action.channel = ch;
        }
        if (String(rawCreator || '').trim().toLowerCase() === 'me') {
          action.creator = 'me';
        }
        const assigneeVal = String(rawAssignee || '').trim();
        if (assigneeVal.toLowerCase() === 'me') {
          action.assignee = 'me';
        } else if (assigneeVal.toLowerCase() === 'unassigned') {
          action.assignee = 'unassigned';
        } else if (assigneeVal) {
          action.assignee = assigneeVal;
        }
        const queueVal = String((item as { queue?: unknown }).queue || '').trim();
        if (queueVal) action.queue = queueVal.slice(0, 80);
      }
      const rawRange = (item as { range?: unknown }).range;
      if (rawRange !== undefined && rawRange !== null && String(rawRange).trim() !== '') {
        const rng =
          mod === 'analytics'
            ? normalizeAnalyticsRange(rawRange)
            : mod === 'csat'
              ? normalizeCsatRange(rawRange)
              : mod === 'audit'
                ? normalizeAuditRange(rawRange)
                : undefined;
        if (rng) action.range = rng;
      }
      out.push(action);
      continue;
    }
    if (type === 'clear_filters') {
      const modRaw = String((item as { module?: string }).module || 'all')
        .trim()
        .toLowerCase();
      if (modRaw === 'all') {
        out.push({ type: 'clear_filters', module: 'all' });
        continue;
      }
      const mod = asModule(modRaw);
      if (mod) out.push({ type: 'clear_filters', module: mod });
    }
  }
  return out;
}

export type CoworkerNavigateOpts = { keepFilters?: boolean };

export type CoworkerActionHandlers = {
  navigate?: (view: string, opts?: CoworkerNavigateOpts) => void;
  setCustomerSearch?: (q: string) => void;
  setCustomerStatus?: (status: string | undefined) => void;
  setTicketSearch?: (q: string) => void;
  /** Pass "" to reset facet to All. */
  setTicketStatus?: (status: string | undefined) => void;
  setTicketPriority?: (priority: string | undefined) => void;
  setTicketChannel?: (channel: string | undefined) => void;
  setTicketCreator?: (creator: string | undefined) => void;
  setTicketAssignee?: (assignee: string | undefined) => void;
  setKbSearch?: (q: string) => void;
  setTeamsSearch?: (q: string) => void;
  setMacroSearch?: (q: string) => void;
  setAnalyticsRange?: (range: string | undefined) => void;
  setCsatRange?: (range: string | undefined) => void;
  setAuditSearch?: (q: string) => void;
  setAuditRange?: (range: string | undefined) => void;
  setDirectorySearch?: (q: string) => void;
  clearTicketFacetFilters?: () => void;
};

function hasFacetFields(action: CoworkerSetFilterAction): boolean {
  return (
    action.status !== undefined ||
    action.priority !== undefined ||
    action.channel !== undefined ||
    action.creator !== undefined ||
    action.assignee !== undefined ||
    Boolean(action.queue) ||
    Boolean(action.range)
  );
}

/** Apply catalog actions to UI state. Navigates run first with keepFilters when batch also mutates filters. */
export function applyCoworkerUiActions(
  actions: CoworkerUiAction[],
  handlers: CoworkerActionHandlers
): void {
  const hasFilterMutation = actions.some(
    (a) => a.type === 'set_filter' || a.type === 'clear_filters'
  );
  const navigates = actions.filter((a): a is Extract<CoworkerUiAction, { type: 'navigate' }> =>
    a.type === 'navigate'
  );
  const rest = actions.filter((a) => a.type !== 'navigate');

  // Prefer navigate that matches an active create_* in the same batch; else last navigate.
  const createViews: Record<string, string> = {
    create_ticket: 'create-ticket',
    create_team: 'agent-queues',
    create_kb: 'kb',
    create_macro: 'macros',
    create_customer: 'customers',
    create_priority: 'priorities',
    create_status: 'priorities',
  };
  const preferredViews = new Set<string>();
  for (const a of actions) {
    const t = String((a as { type?: string }).type || '');
    const view = createViews[t];
    if (view && !(a as { done?: boolean }).done) preferredViews.add(view);
  }
  let navToApply = navigates;
  if (preferredViews.size) {
    const matched = navigates.filter((n) => preferredViews.has(String(n.view || '')));
    if (matched.length) navToApply = [matched[matched.length - 1]];
    else if (navigates.length) navToApply = [navigates[navigates.length - 1]];
  } else if (navigates.length > 1) {
    navToApply = [navigates[navigates.length - 1]];
  }

  for (const action of navToApply) {
    handlers.navigate?.(action.view, { keepFilters: hasFilterMutation });
  }

  for (const action of rest) {
    if (action.type === 'clear_filters') {
      const mods: CoworkerFilterModule[] =
        action.module === 'all' ? [...FILTER_MODULES] : [action.module];
      for (const mod of mods) {
        if (mod === 'customers') {
          handlers.setCustomerSearch?.('');
          handlers.setCustomerStatus?.('');
        }
        if (mod === 'tickets') {
          handlers.setTicketSearch?.('');
          handlers.clearTicketFacetFilters?.();
          handlers.setTicketCreator?.('');
          handlers.setTicketAssignee?.('');
        }
        if (mod === 'kb') handlers.setKbSearch?.('');
        if (mod === 'teams') handlers.setTeamsSearch?.('');
        if (mod === 'macros') handlers.setMacroSearch?.('');
        if (mod === 'analytics') handlers.setAnalyticsRange?.(undefined);
        if (mod === 'csat') handlers.setCsatRange?.(undefined);
        if (mod === 'audit') {
          handlers.setAuditSearch?.('');
          handlers.setAuditRange?.(undefined);
        }
        if (mod === 'directory') handlers.setDirectorySearch?.('');
      }
      continue;
    }
    if (action.type === 'set_filter') {
      const q = action.query;
      if (action.module === 'customers') {
        handlers.setCustomerSearch?.(q);
        if (hasFacetFields(action)) {
          handlers.setCustomerStatus?.(action.status ?? '');
        } else if (!q) {
          handlers.setCustomerStatus?.('');
        }
      }
      if (action.module === 'tickets') {
        handlers.setTicketSearch?.(
          action.queue && !q ? action.queue : q
        );
        handlers.setTicketCreator?.(action.creator ?? '');
        handlers.setTicketAssignee?.(action.assignee ?? '');
        if (hasFacetFields(action)) {
          // Facet intent: set provided facets; clear omitted ones to All.
          // Set priority last so it wins if handlers share a batch edge-case.
          handlers.setTicketStatus?.(
            action.status !== undefined ? action.status : ''
          );
          handlers.setTicketChannel?.(
            action.channel !== undefined ? action.channel : ''
          );
          handlers.setTicketPriority?.(
            action.priority !== undefined ? action.priority : ''
          );
        } else if (!q) {
          handlers.clearTicketFacetFilters?.();
        }
      }
      if (action.module === 'kb') handlers.setKbSearch?.(q);
      if (action.module === 'teams') handlers.setTeamsSearch?.(q);
      if (action.module === 'macros') handlers.setMacroSearch?.(q);
      if (action.module === 'analytics') handlers.setAnalyticsRange?.(action.range);
      if (action.module === 'csat') handlers.setCsatRange?.(action.range);
      if (action.module === 'audit') {
        handlers.setAuditSearch?.(q);
        handlers.setAuditRange?.(action.range);
      }
      if (action.module === 'directory') handlers.setDirectorySearch?.(q);
    }
  }
}

/**
 * Deterministic fallback for modules that have not migrated to agent-owned
 * interpretation. Ticket create/list/search never infer actions from text here.
 */
export function inferCoworkerUiActionsFallback(
  raw: string,
  currentView: string
): CoworkerUiActionsResult {
  const text = raw.trim();
  const lower = text.toLowerCase().replace(/[!?.,]+$/g, '');
  const mod = moduleFromView(currentView);

  // Questions never mutate UI filters
  if (
    /^(how|what|what's|whats|who|whose|when|where|why|which|is|are|do|does|did|can|could)\b/.test(
      lower
    )
  ) {
    return { actions: [] };
  }

  // Ticket create/list/search interpretation is owned by the agent service.
  if (mod === 'tickets') {
    return { actions: [] };
  }

  const listAll =
    /^(list|show|display|get|see|view)\s+(all|everything)(\s+(of\s+them|please))?$/.test(
      lower
    ) ||
    /^(clear|reset|remove)\s+(the\s+)?(search|filter|filters)$/.test(lower) ||
    /^(all|everything)$/.test(lower) ||
    /^(list|show)\s+all\s+(customers?|clients?|teams?|articles?|kb)$/.test(lower) ||
    /^(show|list)\s+everyone$/.test(lower);

  if (listAll && mod) {
    return {
      actions: [{ type: 'set_filter', module: mod, query: '' }],
      replyHint: `Intent: show all ${mod}; list is on the right.`,
    };
  }

  // Explicit entity search only (named / for / about) — not the whole sentence.
  const entity =
    text.match(
      /\b(?:named|called|for|about|matching)\s+["']?([A-Za-z0-9][\w .@+-]{1,60})["']?\s*$/i
    )?.[1] ||
    text.match(
      /\b(?:find|search|show|look\s*up)\s+(?:customer|client|ticket|team|article)?s?\s+["']?([A-Za-z0-9][\w .@+-]{1,60})["']?\s*$/i
    )?.[1];

  if (entity && mod) {
    const q = entity.trim();
    if (
      q &&
      !/^(all|everything|them|me|my|the|a|an|list|show|filter|customers?|tickets?|teams?)$/i.test(
        q
      )
    ) {
      return {
        actions: [{ type: 'set_filter', module: mod, query: q }],
        replyHint: `Intent: filter ${mod} for ${q}; list is on the right.`,
      };
    }
  }

  // Active/inactive customers
  if (mod === 'customers' || /\bcustomers?\b/.test(lower)) {
    if (/\binactive\b/.test(lower)) {
      const actions: CoworkerUiAction[] = [];
      if (mod !== 'customers') actions.push({ type: 'navigate', view: 'customers' });
      actions.push({
        type: 'set_filter',
        module: 'customers',
        query: '',
        status: 'Inactive',
      });
      return {
        actions,
        replyHint: 'Intent: show inactive customers; list is on the right.',
      };
    }
    if (/\bactive\b/.test(lower) && /\bcustomers?\b/.test(lower)) {
      const actions: CoworkerUiAction[] = [];
      if (mod !== 'customers') actions.push({ type: 'navigate', view: 'customers' });
      actions.push({
        type: 'set_filter',
        module: 'customers',
        query: '',
        status: 'Active',
      });
      return {
        actions,
        replyHint: 'Intent: show active customers; list is on the right.',
      };
    }
  }

  return { actions: [] };
}

/** Ask coworker-agents for structured UI actions (via Express proxy). */
export async function fetchCoworkerUiActions(
  message: string,
  page: string
): Promise<CoworkerUiActionsResult> {
  try {
    const res = await fetch('/api/coworker/ui-actions', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, page }),
    });
    if (!res.ok) return inferCoworkerUiActionsFallback(message, page);
    const data = await res.json();
    const actions = normalizeCoworkerUiActions(data?.actions);
    if (actions.length) {
      return {
        actions,
        replyHint: data?.reply_hint ? String(data.reply_hint) : undefined,
      };
    }
  } catch {
    /* fall through */
  }
  return inferCoworkerUiActionsFallback(message, page);
}

export type AgentTurnApplyInput = {
  actions?: Record<string, unknown>[];
  toolProposals?: Array<{
    name: string;
    args?: Record<string, unknown>;
    risk?: string;
    auto?: boolean;
  }>;
  patch?: Record<string, unknown> | null;
  sessionMemoryPatch?: { slots?: Record<string, unknown> } | null;
  uiRefresh?: { lists?: string[]; href?: string; filename?: string } | null;
};

export type AgentTurnApplyResult = {
  uiActions: Record<string, unknown>[];
  patch: Record<string, unknown> | null;
  confirms: Array<{
    name: string;
    args: Record<string, unknown>;
    risk: string;
    auto: boolean;
  }>;
};

/**
 * Fold a CRM agent-turn into the existing ui_actions + draft patch contract.
 * Silent workspace tools become navigate/filter actions; confirm tools stay chips.
 */
export function applyAgentTurn(turn: AgentTurnApplyInput): AgentTurnApplyResult {
  const proposals = Array.isArray(turn.toolProposals) ? turn.toolProposals : [];
  const confirms = proposals
    .filter((p) => p && p.auto === false && String(p.name || '').trim())
    .map((p) => ({
      name: String(p.name),
      args: p.args && typeof p.args === 'object' ? p.args : {},
      risk: String(p.risk || 'high'),
      auto: false,
    }));

  const fromLegacy = Array.isArray(turn.actions) ? [...turn.actions] : [];
  const slotPatch =
    turn.sessionMemoryPatch?.slots && typeof turn.sessionMemoryPatch.slots === 'object'
      ? turn.sessionMemoryPatch.slots
      : {};
  const incomingPatch =
    turn.patch && typeof turn.patch === 'object' ? turn.patch : {};
  const incomingAwaiting = String(incomingPatch.awaiting || incomingPatch.step || '')
    .trim()
    .toLowerCase();
  const freshTeamStart =
    (incomingAwaiting === 'name' || incomingAwaiting === '') &&
    incomingPatch.name == null &&
    incomingPatch.queueName == null &&
    incomingPatch.description == null &&
    incomingPatch.members == null;
  const patch = freshTeamStart
    ? { ...incomingPatch }
    : { ...slotPatch, ...incomingPatch };
  const hasCompletedCreateAction = fromLegacy.some((a) => {
    const type = String(a?.type || '').toLowerCase();
    return (
      type === 'refresh_priorities' ||
      ((
        /^create_(kb|team|ticket|macro|customer|priority|status)$/.test(type) ||
        type === 'update_priority' ||
        type === 'update_status'
      ) &&
        Boolean(a?.done || a?.save || a?.refresh))
    );
  });
  // Success turns should not re-apply stale draft patches from session memory.
  // The backend already completed the create flow; keeping the old patch can
  // reopen guided UI state (e.g. re-asking KB category after a successful publish).
  const patchOrNull =
    hasCompletedCreateAction || !Object.keys(patch).length ? null : patch;
  if (fromLegacy.length) {
    const awaiting = String((patchOrNull || {}).awaiting || (patchOrNull || {}).step || '')
      .trim()
      .toLowerCase();
    const uiActions = fromLegacy.map((a) => {
      const type = String(a?.type || '').toLowerCase();
      if (!/^create_(kb|team|ticket|macro|customer|priority|status)$/.test(type)) {
        return a;
      }
      return {
        ...(patchOrNull || {}),
        ...a,
        type,
        step: a.step || a.awaiting || awaiting,
      };
    });
    const hasCreate = uiActions.some((a) =>
      /^(create_(kb|team|ticket|macro|customer|priority|status)|escalate|reassign)$/.test(
        String(a?.type || '')
      )
    );
    const hasDelete = uiActions.some((a) =>
      /^delete_(team|macro|priority|status|kb|customer|ticket)$/.test(
        String(a?.type || '')
      )
    );
    if (
      patchOrNull &&
      !hasCreate &&
      !hasDelete &&
      awaiting !== 'delete_confirm' &&
      (awaiting ||
        patchOrNull.name != null ||
        patchOrNull.description != null ||
        patchOrNull.members != null ||
        patchOrNull.customerName != null ||
        patchOrNull.title != null ||
        patchOrNull.displayName != null ||
        patchOrNull.label != null ||
        patchOrNull.resolutionHours != null ||
        patchOrNull.hours != null ||
        patchOrNull.email != null ||
        patchOrNull.phone != null ||
        patchOrNull.ticket_number != null ||
        patchOrNull.ready === true)
    ) {
      let type = '';
      if (
        patchOrNull.title != null ||
        patchOrNull.body != null ||
        patchOrNull.category != null ||
        patchOrNull.content != null
      ) {
        type = 'create_kb';
      } else if (patchOrNull.customerName != null || patchOrNull.issue != null) {
        type = 'create_ticket';
      } else if (
        patchOrNull.displayName != null ||
        patchOrNull.label != null ||
        patchOrNull.resolutionHours != null ||
        patchOrNull.hours != null
      ) {
        type = 'create_priority';
      } else if (patchOrNull.ticket_number != null && patchOrNull.target_role != null) {
        type = 'reassign';
      } else if (patchOrNull.ticket_number != null || patchOrNull.assignee != null) {
        type = 'escalate';
      } else if (
        patchOrNull.name != null ||
        patchOrNull.members != null ||
        patchOrNull.description != null
      ) {
        type = isAddTeamMembersUiDraft({ ...patchOrNull, awaiting })
          ? 'update_team'
          : 'create_team';
      }
      if (type) {
        uiActions.push({
          type,
          ...patchOrNull,
          step: awaiting,
          ...(type === 'update_team' ? { open: true } : {}),
        });
      }
    }
    const hasDraftFields = (a: Record<string, unknown>) =>
      Boolean(
        a.name ||
          a.queueName ||
          a.description ||
          a.members ||
          a.title ||
          a.body ||
          a.content ||
          a.category ||
          a.customerName ||
          a.displayName ||
          a.label ||
          a.resolutionHours ||
          a.hours ||
          a.awaiting ||
          a.step
      );
    const filledCreate = uiActions.some(
      (a) =>
        /^create_(kb|team|ticket|macro|customer|priority|status)$/.test(
          String(a?.type || '')
        ) && hasDraftFields(a)
    );
    const mergedActions = filledCreate
      ? uiActions.filter((a) => {
          const type = String(a?.type || '');
          if (
            !/^create_(kb|team|ticket|macro|customer|priority|status)$/.test(type)
          ) {
            return true;
          }
          return hasDraftFields(a) || Boolean(a.done || a.save || a.confirm);
        })
      : uiActions;
    return {
      uiActions: mergedActions,
      patch: patchOrNull,
      confirms,
    };
  }

  const synthesized: Record<string, unknown>[] = [];
  for (const p of proposals) {
    const name = String(p?.name || '').trim();
    const args = p?.args && typeof p.args === 'object' ? p.args : {};
    if (name === 'set_workspace' || name === 'navigate') {
      const view = String(args.view || '').trim();
      if (view) synthesized.push({ type: 'navigate', view });
      if (name === 'set_workspace' && String(args.mode || '') === 'create') {
        const createType: Record<string, string> = {
          kb: 'create_kb',
          'agent-queues': 'create_team',
          'create-ticket': 'create_ticket',
          macros: 'create_macro',
          priorities: 'create_priority',
        };
        const typ = createType[view];
        const hasDraftPatch = proposals.some((item) =>
          String(item?.name || '').startsWith('patch_')
        );
        if (typ && !hasDraftPatch) synthesized.push({ type: typ, ...args });
      }
      continue;
    }
    if (name.startsWith('patch_') && name.endsWith('_draft')) {
      const awaiting = String(
        args.awaiting || args.step || patch.awaiting || patch.step || ''
      )
        .trim()
        .toLowerCase();
      if (awaiting === 'delete_confirm') {
        const patchDelete: Record<string, string> = {
          patch_team_draft: 'delete_team',
          patch_macro_draft: 'delete_macro',
          patch_priority_draft: 'delete_priority',
          patch_status_draft: 'delete_status',
        };
        const typ = patchDelete[name];
        if (typ) {
          synthesized.push({
            type: typ,
            ...patch,
            ...args,
            step: 'confirm',
          });
        }
        continue;
      }
      const patchCreate: Record<string, string> = {
        patch_kb_draft: 'create_kb',
        patch_priority_draft: 'create_priority',
        patch_status_draft: 'create_status',
        patch_team_draft: 'create_team',
        patch_macro_draft: 'create_macro',
        patch_ticket_draft: 'create_ticket',
      };
      let typ = patchCreate[name];
      if (
        name === 'patch_team_draft' &&
        isAddTeamMembersUiDraft({ ...patch, ...args, awaiting })
      ) {
        typ = 'update_team';
      }
      if (typ) {
        synthesized.push({
          type: typ,
          ...patch,
          ...args,
          step: args.awaiting || args.step || patch.awaiting || patch.step,
          ...(typ === 'update_team' ? { open: true } : {}),
        });
      }
      continue;
    }
    if (name === 'set_filter' || name === 'clear_filters') {
      synthesized.push({ type: name, ...args });
      continue;
    }
    if (name === 'open_customer_import' || name === 'import_customers') {
      const needsFile =
        name === 'open_customer_import' ||
        Boolean(args.needsFile) ||
        !String(args.csv_text || args.csv || '').trim();
      if (needsFile) {
        synthesized.push({ type: 'navigate', view: 'customers' });
        synthesized.push({ type: 'open_customer_import', needsFile: true });
      }
      continue;
    }
    if (name === 'open_entity') {
      const kind = String(args.type || '').trim().toLowerCase();
      if (kind === 'article') {
        synthesized.push({ type: 'open_kb', id: args.id, title: args.name });
      } else if (kind === 'ticket' || kind === 'tickets') {
        synthesized.push({
          type: 'open_ticket',
          id: args.id || args.ticketNumber || args.name,
          ticketNumber: args.ticketNumber || args.id || args.name,
          name: args.name,
        });
      } else if (kind === 'macro') {
        synthesized.push({
          type: 'open_macro',
          id: args.id,
          title: args.name || args.title,
          name: args.name || args.title,
        });
      } else if (kind === 'customer') {
        synthesized.push({
          type: 'open_customer',
          id: args.id,
          name: args.name,
          email: args.email,
        });
      } else if (kind === 'team' || kind === 'queue') {
        synthesized.push({
          type: 'open_team',
          id: args.id,
          name: args.name,
          queueName: args.name,
        });
      } else if (kind === 'priority') {
        synthesized.push({
          type: 'open_priority',
          id: args.id,
          displayName: args.name || args.title,
          name: args.name || args.title,
        });
      } else if (kind === 'status') {
        synthesized.push({
          type: 'open_status',
          id: args.id,
          displayName: args.name || args.title,
          name: args.name || args.title,
        });
      }
      continue;
    }
    if (name === 'download') {
      synthesized.push({ type: 'download', href: args.href, filename: args.filename });
    }
  }
  const lists = turn.uiRefresh?.lists || [];
  const refreshMap: Record<string, string> = {
    tickets: 'refresh_tickets',
    teams: 'refresh_teams',
    kb: 'refresh_kb',
    customers: 'refresh_customers',
    macros: 'refresh_macros',
    analytics: 'refresh_analytics',
    csat: 'refresh_csat',
    audit: 'refresh_audit',
    priorities: 'refresh_priorities',
    'org-preferences': 'refresh_org_preferences',
    directory: 'refresh_directory',
  };
  for (const list of lists) {
    const refreshType = refreshMap[list];
    if (refreshType) synthesized.push({ type: refreshType });
  }
  if (turn.uiRefresh?.href) {
    synthesized.push({
      type: 'download',
      href: turn.uiRefresh.href,
      filename: turn.uiRefresh.filename,
    });
  }
  return {
    uiActions: synthesized,
    patch: patchOrNull,
    confirms,
  };
}

/** True when a guided create_* action marks successful persistence. */
export function isGuidedCreateDone(raw: Record<string, unknown>): boolean {
  return Boolean(raw.done || raw.save);
}

export type PendingEntityOpen = {
  id?: string;
  title?: string;
  name?: string;
  email?: string;
};

/** Extract id/title/name from a create done or open_* ui action. */
export function pendingOpenFromAction(
  raw: Record<string, unknown>
): PendingEntityOpen | null {
  const id = String(
    raw.id ||
      raw.macroId ||
      raw.customerId ||
      raw.queueId ||
      raw.articleId ||
      ''
  ).trim();
  const title = String(raw.title || '').trim();
  const name = String(raw.name || raw.queueName || raw.displayName || '').trim();
  const email = String(raw.email || raw.customerEmail || '').trim();
  if (id) {
    return {
      id,
      title: title || name || undefined,
      name: name || undefined,
      email: email || undefined,
    };
  }
  if (title) return { title };
  if (name) return { name, email: email || undefined };
  return null;
}

type OptimisticCreateSpec = {
  view: string;
  createType: string;
  step: string;
};

/** Add-members-to-existing-team draft cues (not create-team). */
export function isAddTeamMembersUiDraft(
  raw: Record<string, unknown> | null | undefined
): boolean {
  if (!raw || typeof raw !== 'object') return false;
  const awaiting = String(raw.awaiting || raw.step || '')
    .trim()
    .toLowerCase();
  if (
    awaiting === 'members_team' ||
    awaiting === 'members_names' ||
    awaiting === 'members_confirm' ||
    awaiting === 'add_members'
  ) {
    return true;
  }
  const workflow = String(raw.workflow || raw.workflowId || raw.mode || '')
    .trim()
    .toLowerCase();
  if (
    workflow === 'add_team_members' ||
    workflow === 'update_team' ||
    workflow === 'add_members'
  ) {
    return true;
  }
  const hasExistingId = Boolean(
    String(raw.id || raw.teamId || raw.queueId || '').trim()
  );
  if (hasExistingId && (awaiting === 'members' || awaiting === 'confirm')) {
    return true;
  }
  return false;
}

/**
 * UX-only: open the guided progress panel as soon as the user asks to create,
 * without waiting for the agent-turn HTTP round-trip. The LLM still owns
 * field collection and writes; this never decides meaning for tools/DB.
 * Never opens for analytics / list / why questions that merely mention an entity.
 */
export function optimisticCreateUiActions(
  userText: string,
  _module?: string | null
): Record<string, unknown>[] | null {
  const t = String(userText || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
  if (!t || t.length > 80) return null;

  // Metrics / why / list questions must not open create progress panels.
  if (
    /^(how|what|what's|whats|who|whose|whom|when|where|why|which|is|are|do|does|did|can|could|should)\b/.test(
      t
    ) ||
    /\b(how many|how much|why|volume|compared|really high|spike|trend|sla|csat)\b/.test(t)
  ) {
    return null;
  }

  const specs: Array<{ match: (s: string) => boolean; spec: OptimisticCreateSpec }> = [
    {
      match: (s) =>
        /\b(create|new|add)\b/.test(s) && /\b(priorit(y|ies)|status(es)?)\b/.test(s),
      spec: {
        view: 'priorities',
        createType: /\bstatus/.test(t) ? 'create_status' : 'create_priority',
        step: 'name',
      },
    },
    {
      // Require create intent — not "open tickets" (list) or bare "ticket".
      match: (s) =>
        (/\b(create|new|file)\b/.test(s) && /\b(ticket|tickets)\b/.test(s)) ||
        /\bopen\s+(a\s+|new\s+)?ticket\b/.test(s),
      spec: { view: 'create-ticket', createType: 'create_ticket', step: 'name' },
    },
    {
      match: (s) =>
        /\b(create|new|write|add)\b/.test(s) && /\b(macro|macros|snippet)\b/.test(s),
      spec: { view: 'macros', createType: 'create_macro', step: 'title' },
    },
    {
      // Create team only — never "add member(s) to team" (that is update_team).
      match: (s) => {
        const addMembers =
          /\b(add|include)\b.*\bmembers?\b/.test(s) ||
          (/\b(add|include)\b/.test(s) &&
            /\b(to|into|in)\b/.test(s) &&
            /\b(team|teams|queue|queues)\b/.test(s) &&
            !/\b(create|new)\b/.test(s));
        if (addMembers) return false;
        return (
          /\b(create|new|add)\b/.test(s) &&
          /\b(team|teams|queue|queues)\b/.test(s)
        );
      },
      spec: { view: 'agent-queues', createType: 'create_team', step: 'name' },
    },
    {
      match: (s) =>
        /\b(create|new|add|publish|write)\b/.test(s) &&
        /\b(article|kb|knowledge)\b/.test(s),
      spec: { view: 'kb', createType: 'create_kb', step: 'title' },
    },
  ];

  const hit = specs.find((row) => row.match(t));
  if (!hit) return null;

  // Already on the create surface for this module — still emit create_* so the
  // progress panel mounts immediately even when navigate is a no-op.
  const { view, createType, step } = hit.spec;
  return [
    { type: 'navigate', view },
    { type: createType, step, awaiting: step },
  ];
}
