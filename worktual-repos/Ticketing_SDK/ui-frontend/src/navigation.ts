/** Shell navigation options (sidebar, header, chat actions). */
export type NavigateOpts = {
  /** Return to the module list/root when already on that module. */
  reset?: boolean;
  /** Keep or set ticket search (notifications / deep links). */
  ticketSearch?: string;
  /** Open this ticket-detail tab after search expand (customer email / portal reply). */
  ticketDetailTab?: 'details' | 'conversations';
  /** On ticket reset, preserve list facet filters. */
  keepFilters?: boolean;
  /** Ticket Back returns here (directory customer), not the filtered ticket list. */
  ticketReturnTo?: { view: string; customerId?: string };
  dmUserId?: string;
};

const TICKET_MODULE_VIEWS = new Set([
  'assigned',
  'team-queue',
  'team-inbox',
  'unassigned',
  'search',
]);

/** Stable bucket for moduleResetKey — one key per sidebar module with sub-pages. */
export function moduleResetBucket(view: string): string | null {
  if (TICKET_MODULE_VIEWS.has(view)) return 'tickets';
  if (view === 'customers') return 'customers';
  if (view === 'kb') return 'kb';
  if (view === 'agent-queues' || view === 'escalation-directory') return 'teams';
  if (view === 'macros') return 'macros';
  if (view === 'priorities') return 'priorities';
  if (view === 'create-ticket') return 'create-ticket';
  if (view === 'internal-chat') return 'internal-chat';
  return null;
}

/** Customer email / portal reply bells — open Conversations, not Details. */
export function notificationOpensConversations(n: {
  title?: string;
  message?: string;
}): boolean {
  const title = String(n.title || '').toLowerCase();
  const message = String(n.message || '').toLowerCase();
  if (title.startsWith('new email on') || title.startsWith('new portal message on')) {
    return true;
  }
  return (
    message.includes('replied via email') ||
    message.includes('replied via the support portal')
  );
}

export function searchQueryLooksLikeTicketId(raw: string): boolean {
  const q = String(raw || '').trim();
  if (!q) return false;
  return (
    q.startsWith('#') ||
    /^#?\d+$/.test(q) ||
    q.startsWith('WT-') ||
    q.includes('#')
  );
}

export function ticketNumbersEqual(a: unknown, b: unknown): boolean {
  const left = String(a || '')
    .replace(/^#/, '')
    .trim()
    .toLowerCase();
  const right = String(b || '')
    .replace(/^#/, '')
    .trim()
    .toLowerCase();
  return Boolean(left && right && left === right);
}
