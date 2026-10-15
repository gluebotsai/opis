import React, { useState, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { 
  Search, 
  Mail, 
  MessageSquare, 
  PhoneCall, 
  Globe, 
  User, 
  Users,
  Clock, 
  Filter,
  ChevronLeft,
  ChevronRight,
  AlertTriangle,
  X,
  ArrowUp,
  CheckCircle2,
  UserCheck,
  Copy,
  Check,
  ArrowLeft,
  Eye,
  RotateCcw,
  Paperclip,
  Upload,
  Download,
  Trash2,
  Star,
  Activity,
  ClipboardList,
  FileText,
  ShoppingBag,
  ChevronDown,
  Pin,
  Pencil,
  Maximize2,
} from 'lucide-react';
import { useCoworkerPageBridge, useCoworkerSplitExpandOptional } from './coworker/CoworkerSplitWorkspace';
import { useReportFocusedEntity } from './coworker/CoworkerSessionContext';
import { Ticket, Priority, TicketStatus, Channel, AuthUser, Customer, TICKET_CHANNEL_FILTERS } from '../types';
import { useSetPageTitle } from './layout/PageTitleContext';
import PageShell from './layout/PageShell';
import MenuSelect from './ui/menu-select';
import SegmentTabs from './ui/segment-tabs';
import type { DataScope } from '../rbac';
import { canSetTicketStatusPriority } from '../rbac';
import { searchQueryLooksLikeTicketId } from '../navigation';

const NOTE_EDIT_WINDOW_MS = 15 * 60 * 1000;

type StaffConversationNote = {
  id: string;
  author: string;
  authorId?: string;
  text: string;
  time: string;
  at?: string;
  editedAt?: string | null;
  editedTime?: string | null;
  visibility?: 'internal' | 'public' | 'draft';
  lane?: 'out' | 'in' | 'internal' | 'draft';
  subject?: string;
  role?: 'user' | 'bot' | 'agent';
  fromEmail?: string;
  toEmail?: string;
  pinned?: boolean;
};

function noteCreatedAtMs(note: StaffConversationNote): number {
  if (note.at) {
    const t = Date.parse(note.at);
    if (Number.isFinite(t)) return t;
  }
  return Number.NaN;
}

function staffNoteEditableBy(
  note: StaffConversationNote,
  userId: string,
  canMutate: boolean
): boolean {
  if (!canMutate) return false;
  if (String(note.authorId || '') !== String(userId || '')) return false;
  const created = noteCreatedAtMs(note);
  if (!Number.isFinite(created)) return false;
  return Date.now() - created <= NOTE_EDIT_WINDOW_MS;
}

function staffNoteDeletableBy(
  note: StaffConversationNote,
  userId: string,
  role: string,
  canMutate: boolean
): boolean {
  if (!canMutate) return false;
  if (String(role || '').toLowerCase() === 'admin') return true;
  if (String(note.authorId || '') !== String(userId || '')) return false;
  const created = noteCreatedAtMs(note);
  if (!Number.isFinite(created)) return false;
  return Date.now() - created <= NOTE_EDIT_WINDOW_MS;
}

type NoteMentionUser = {
  id: string;
  name: string;
  email?: string;
  role?: string;
};

function mentionQueryAt(
  text: string,
  caret: number
): { start: number; query: string } | null {
  const before = text.slice(0, caret);
  const match = before.match(/(^|[\s])@([^\s@]*)$/);
  if (!match) return null;
  const query = match[2] ?? '';
  return { start: before.length - query.length - 1, query };
}

function noteMentionRole(role?: string): string {
  const key = String(role || '').trim().toLowerCase();
  if (key === 'admin') return 'Admin';
  if (key === 'resolver') return 'Resolver';
  if (key === 'agent') return 'Agent';
  return role ? role : 'Staff';
}

function staffNoteAuthorRole(
  note: StaffConversationNote,
  staff: NoteMentionUser[],
  viewer: { id: string; name: string; role: string }
): string | null {
  if (String(note.authorId || '') === String(viewer.id || '')) {
    return noteMentionRole(viewer.role);
  }
  const byId = staff.find((row) => String(row.id) === String(note.authorId || ''));
  if (byId?.role) return noteMentionRole(byId.role);
  const author = String(note.author || '').trim().toLowerCase();
  if (!author) return null;
  const byName = staff.find((row) => row.name.trim().toLowerCase() === author);
  if (byName?.role) return noteMentionRole(byName.role);
  if (author === String(viewer.name || '').trim().toLowerCase()) {
    return noteMentionRole(viewer.role);
  }
  return null;
}

function noteTextWithMentions(text: string, names: string[]): React.ReactNode {
  const sorted = [
    ...new Set(names.map((n) => n.trim()).filter(Boolean)),
  ].sort((a, b) => b.length - a.length);
  if (!sorted.length) return text;
  const nodes: React.ReactNode[] = [];
  let i = 0;
  let k = 0;
  while (i < text.length) {
    if (text[i] === '@') {
      const hit = sorted.find((name) => {
        if (!text.startsWith(name, i + 1)) return false;
        const after = i + 1 + name.length;
        return after >= text.length || /[\s.,!?;:)]/.test(text[after]);
      });
      if (hit) {
        nodes.push(
          <span key={`mention-${k++}`} className="font-semibold text-[#171717]">
            @{hit}
          </span>
        );
        i += hit.length + 1;
        continue;
      }
    }
    const next = text.indexOf('@', i + 1);
    if (next === -1) {
      nodes.push(text.slice(i));
      break;
    }
    nodes.push(text.slice(i, next));
    i = next;
  }
  return nodes;
}

function NoteMentionMenu({
  hits,
  activeIndex,
  onPick,
}: {
  hits: NoteMentionUser[];
  activeIndex: number;
  onPick: (name: string) => void;
}) {
  return (
    <div className="absolute inset-x-0 bottom-full z-20 mb-1.5 max-h-56 overflow-y-auto rounded-xl border-[0.6px] border-[#bfbfbf] bg-white py-1 shadow-[0_8px_24px_rgba(0,0,0,0.08)]">
      {hits.length === 0 ? (
        <div className="px-3 py-2.5 text-sm text-[#737373]">
          No teammates to mention.
        </div>
      ) : (
        hits.map((member, idx) => (
          <button
            key={member.id}
            type="button"
            onMouseDown={(e) => {
              e.preventDefault();
              onPick(member.name);
            }}
            className={`flex w-full items-center gap-2.5 px-3 py-2 text-left ${
              idx === activeIndex ? 'bg-[#f5f5f5]' : 'hover:bg-[#fafafa]'
            }`}
          >
            <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-[11px] font-semibold text-[#171717]">
              {initialsFromName(member.name)}
            </span>
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-[#171717]">
                {member.name}
              </div>
              <div className="truncate text-[11px] text-[#737373]">
                {noteMentionRole(member.role)}
                {member.email ? ` · ${member.email}` : ''}
              </div>
            </div>
          </button>
        ))
      )}
    </div>
  );
}

function stripQuotedMail(raw: string) {
  let text = raw.replace(/\r\n/g, '\n').trim();
  text = text.replace(/^Email reply from [^\n]+:\s*/i, '').trim();
  const lines = text.split('\n');
  let cut = lines.length;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const window = lines.slice(i, i + 4).join(' ').replace(/\s+/g, ' ').trim();
    if (
      /^On .{3,300}wrote:/i.test(line) ||
      /^On .{3,300}wrote:/i.test(window) ||
      /^-----Original Message-----$/i.test(line) ||
      (i > 0 && /^>/.test(line))
    ) {
      cut = i;
      break;
    }
  }
  return lines
    .slice(0, cut)
    .filter((line) => !/^>/.test(line.trim()))
    .join('\n')
    .trim();
}

/** Canned customer status/ack emails — not portal or staff replies. */
function isAutomatedCustomerAckNote(note: StaffConversationNote): boolean {
  if (note.lane === 'draft' || note.lane === 'internal') return false;
  if (String(note.author || '').trim().toLowerCase() !== 'support') return false;
  const subject = String(note.subject || '').trim();
  const text = String(note.text || '').replace(/\r\n/g, '\n').trim();
  const first = text.split('\n')[0]?.trim() || '';
  const headline = subject || first;
  if (
    /^\[[^\]]+\]\s+(We received your request|Your request was resolved|Your ticket is closed|Your ticket is open|Your ticket was reopened|We are working on your ticket|Your ticket is now\b)/i.test(
      headline
    )
  ) {
    return true;
  }
  return (
    /We received your support request/i.test(text) &&
    /Your ticket number is/i.test(text) &&
    /do not reply to this email/i.test(text)
  );
}

function looksLikeEmailThreadNote(note: StaffConversationNote): boolean {
  const text = String(note.text || '');
  return (
    /^Email reply from /i.test(text) ||
    Boolean(String(note.subject || '').trim()) ||
    /^On .{3,240}wrote:/im.test(text.replace(/\n/g, ' ')) ||
    /^-----Original Message-----/m.test(text)
  );
}

function toStaffConversationNotes(notes: StaffConversationNote[]): StaffConversationNote[] {
  return notes
    .map((note) => {
      const quoted =
        /^Email reply from /i.test(note.text) ||
        /^>/m.test(note.text) ||
        /wrote:/i.test(note.text);
      if (!quoted && note.lane !== 'in') return note;
      const stripped = stripQuotedMail(note.text);
      return { ...note, text: stripped || note.text };
    })
    .filter((note) => note.text.trim() && !isAutomatedCustomerAckNote(note))
    .slice()
    .reverse();
}

function isStaffOnlyNote(note: StaffConversationNote): boolean {
  return (
    note.visibility === 'internal' ||
    note.visibility === 'draft' ||
    note.lane === 'internal' ||
    note.lane === 'draft'
  );
}

function isEmailConversationNote(
  note: StaffConversationNote,
  _customerName: string
): boolean {
  if (isStaffOnlyNote(note)) return false;
  if (isAutomatedCustomerAckNote(note)) return false;
  return looksLikeEmailThreadNote(note);
}

function isPortalConversationNote(
  note: StaffConversationNote,
  customerName: string
): boolean {
  if (isStaffOnlyNote(note)) return false;
  if (isAutomatedCustomerAckNote(note)) return false;
  if (isEmailConversationNote(note, customerName)) return false;
  const author = String(note.author || '').trim().toLowerCase();
  const customer = customerName.trim().toLowerCase();
  if (author === 'support') return true;
  if (customer && (author === customer || author.startsWith(customer))) return true;
  if (note.visibility === 'public' || note.lane === 'out') return true;
  return false;
}

function noteIsReceived(
  note: StaffConversationNote,
  customerName: string
): boolean {
  if (note.lane === 'in') return true;
  if (note.lane === 'out') return false;
  if (/^Email reply from /i.test(note.text || '')) return true;
  const customer = customerName.trim().toLowerCase();
  const author = String(note.author || '').trim().toLowerCase();
  return Boolean(customer && author.startsWith(customer));
}

function staffTicketNotes(notes: StaffConversationNote[]): StaffConversationNote[] {
  return notes.filter(
    (note) => note.visibility === 'internal' || note.lane === 'internal'
  );
}

function unreadStaffNoteCount(
  notes: StaffConversationNote[],
  lastReadAt: string | null | undefined,
  apiUnread: number,
  viewerName?: string
): number {
  const staff = staffTicketNotes(notes);
  const viewer = String(viewerName || '').trim().toLowerCase();
  if (lastReadAt) {
    const seen = new Date(lastReadAt).getTime();
    if (Number.isFinite(seen)) {
      return staff.filter((note) => {
        const at = new Date(String(note.at || '')).getTime();
        if (!Number.isFinite(at) || at <= seen) return false;
        const author = String(note.author || '').trim().toLowerCase();
        if (viewer && author && author === viewer) return false;
        return true;
      }).length;
    }
  }
  return Math.max(0, Number(apiUnread) || 0);
}

function toTicketStaffNotes(notes: StaffConversationNote[]): StaffConversationNote[] {
  return staffTicketNotes(notes)
    .slice()
    .sort((a, b) => {
      const ap = a.pinned ? 1 : 0;
      const bp = b.pinned ? 1 : 0;
      if (ap !== bp) return bp - ap;
      const at = new Date(String(a.at || '')).getTime();
      const bt = new Date(String(b.at || '')).getTime();
      const aOk = Number.isFinite(at);
      const bOk = Number.isFinite(bt);
      if (aOk && bOk && at !== bt) return bt - at;
      return 0;
    });
}

function initialsFromName(name: string): string {
  const parts = String(name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return 'E';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] || ''}${parts[parts.length - 1][0] || ''}`.toUpperCase();
}

function formatConversationTimestamp(note: StaffConversationNote): string {
  const iso = String(note.at || '').trim();
  if (iso) {
    const d = new Date(iso);
    if (!Number.isNaN(d.getTime())) {
      const weekday = d.toLocaleDateString('en-US', { weekday: 'short' });
      const month = d.getMonth() + 1;
      const day = d.getDate();
      const year = d.getFullYear();
      const clock = d.toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
      });
      return `${weekday} ${month}/${day}/${year} ${clock}`;
    }
  }
  const display = String(note.time || '').trim();
  if (/^\w{3}\s+\d{1,2}\/\d{1,2}\/\d{4}/.test(display)) return display;
  return display || '—';
}

function PortalConversationThread({
  notes,
  customerName,
}: {
  notes: StaffConversationNote[];
  customerName: string;
}) {
  return (
    <ul className="flex flex-col gap-3 pb-2">
      {notes.map((note) => {
        const received = noteIsReceived(note, customerName);
        const ts = formatConversationTimestamp(note);
        return (
          <li
            key={note.id}
            className={`flex ${received ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[min(92%,28rem)] ${
                received ? 'items-end' : 'items-start'
              } flex flex-col`}
            >
              <p
                className={`mb-1 px-1 text-[11px] font-semibold text-[#737373] ${
                  received ? 'text-right' : 'text-left'
                }`}
              >
                {received
                  ? note.author || customerName || 'Customer'
                  : note.author || 'Support'}
              </p>
              <div
                className={`min-w-0 select-text text-[14px] leading-relaxed shadow-none ${
                  received
                    ? 'inline-block w-fit max-w-full rounded-2xl rounded-tr-sm bg-[#111111] px-3.5 py-2.5 text-white'
                    : 'max-w-[90%] bg-transparent p-0 text-neutral-800'
                }`}
              >
                <p className="whitespace-pre-wrap">{note.text}</p>
              </div>
              <p
                className={`mt-1 px-1 tabular-nums text-[10px] text-[#a3a3a3] ${
                  received ? 'text-right' : 'text-left'
                }`}
              >
                {ts}
              </p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function emailThreadSubjectKey(raw: string): string {
  let text = String(raw || '').replace(/\s+/g, ' ').trim();
  while (/^(re|fw|fwd)\s*:\s*/i.test(text)) {
    text = text.replace(/^(re|fw|fwd)\s*:\s*/i, '').trim();
  }
  return text.toLowerCase();
}

function groupEmailNotesBySubject(notes: StaffConversationNote[]): Array<{
  key: string;
  label: string;
  notes: StaffConversationNote[];
}> {
  const order: string[] = [];
  const groups = new Map<string, { label: string; notes: StaffConversationNote[] }>();
  for (const note of notes) {
    const raw = String(note.subject || '').replace(/\s+/g, ' ').trim();
    const key = emailThreadSubjectKey(raw) || 'no-subject';
    const label = raw.replace(/^(re|fw|fwd)\s*:\s*/gi, '').trim() || 'No subject';
    const existing = groups.get(key);
    if (!existing) {
      order.push(key);
      groups.set(key, { label, notes: [note] });
    } else {
      existing.notes.push(note);
    }
  }
  return order.map((key) => {
    const group = groups.get(key)!;
    return { key, label: group.label, notes: group.notes };
  });
}

function TicketCsatMark({ score }: { score: number }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="inline-flex items-center gap-0.5" aria-hidden>
        {[1, 2, 3, 4, 5].map((n) => (
          <Star
            key={n}
            className={`h-[18px] w-[18px] stroke-[2.25] ${
              n <= score ? 'fill-amber-400 text-amber-400' : 'text-[#bfbfbf]'
            }`}
          />
        ))}
      </span>
      <span className="text-sm font-medium text-neutral-700">CSAT {score}/5</span>
    </div>
  );
}

function ticketFileLabel(url: string): string {
  const name = decodeURIComponent(url.split('/').pop() || '').trim();
  const stripped = name.replace(/^\d{10,}-/, '');
  return stripped || name || 'Attachment';
}

function ticketFileExt(url: string): string {
  const name = url.split('/').pop() || '';
  const dot = name.lastIndexOf('.');
  return dot < 0 ? '' : name.slice(dot + 1).toLowerCase();
}

function ticketFileKind(
  url: string
): 'image' | 'pdf' | 'text' | 'docx' | 'file' {
  const ext = ticketFileExt(url);
  if (
    ext === 'png' ||
    ext === 'jpg' ||
    ext === 'jpeg' ||
    ext === 'gif' ||
    ext === 'webp' ||
    ext === 'bmp'
  ) {
    return 'image';
  }
  if (ext === 'pdf') return 'pdf';
  if (ext === 'txt' || ext === 'csv' || ext === 'md') return 'text';
  if (ext === 'docx') return 'docx';
  return 'file';
}

function TicketDocxPreview({ url, label }: { url: string; label: string }) {
  const [html, setHtml] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setHtml(null);
    setFailed(false);
    void (async () => {
      try {
        const res = await fetch(url, { credentials: 'include' });
        if (!res.ok) throw new Error('Could not load file');
        const arrayBuffer = await res.arrayBuffer();
        const mammoth = await import('mammoth');
        const result = await mammoth.convertToHtml({ arrayBuffer });
        if (!cancelled) setHtml(result.value || '<p></p>');
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [url]);

  if (failed) {
    return (
      <span className="flex h-full min-h-[10rem] flex-col items-center justify-center gap-2 text-neutral-500">
        <Paperclip className="h-[18px] w-[18px] stroke-[2.25]" />
        <span className="text-[11px] font-semibold uppercase tracking-wide text-neutral-600">
          docx
        </span>
      </span>
    );
  }
  if (!html) {
    return (
      <span className="flex h-full min-h-[10rem] items-center justify-center text-xs text-neutral-400">
        Loading preview…
      </span>
    );
  }

  const srcDoc = `<!doctype html><html><head><meta charset="utf-8"><style>
    body{margin:12px;font:14px/1.45 Inter,ui-sans-serif,system-ui,sans-serif;color:#171717;background:#fafafa}
    img,table{max-width:100%}
    table{border-collapse:collapse}
    td,th{border:0.6px solid #bfbfbf;padding:4px 6px}
    p{margin:0 0 8px}
  </style></head><body>${html}</body></html>`;

  return (
    <iframe
      title={label}
      sandbox=""
      srcDoc={srcDoc}
      className="pointer-events-none h-full min-h-[10rem] w-full border-0 bg-neutral-50"
    />
  );
}

interface TicketsViewProps {
  viewMode: 'assigned' | 'team-queue' | 'search' | 'team-inbox' | 'unassigned';
  tickets: Ticket[];
  onUpdateTicket: (
    id: string,
    updates: Partial<Ticket> & { escalate?: boolean; replaceAttachments?: boolean }
  ) => void | Promise<boolean | void>;
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
  /** Bumped when sidebar re-clicks Tickets — return to list. */
  moduleResetKey?: number;
  onExpandedTicketIdChange?: (id: string | null) => void;
  /** Return true when Back already left ticket detail (e.g. directory customer). */
  onBackFromTicket?: () => boolean;
  backFromTicketLabel?: string;
  embedded?: boolean;
  /** From notification deep-link (customer email / portal reply). */
  openDetailTab?: 'details' | 'conversations';
  listOffset?: number;
  listTotal?: number;
  listHasMore?: boolean;
  listPageSize?: number;
  listLoading?: boolean;
  onListPageChange?: (offset: number) => void;
  sortOrder?: 'latest' | 'oldest' | 'priority';
  onSortOrderChange?: (sort: 'latest' | 'oldest' | 'priority') => void;
}

function ticketSeq(ticket: Ticket): number {
  const m = String(ticket.id || '').match(/(\d{1,20})/);
  return m ? Number(m[1]) : 0;
}

function parseFacetValues(raw: string | undefined, local: string[]): string[] {
  if (raw === undefined) return local;
  if (!raw.trim()) return [];
  return raw
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part && part.toLowerCase() !== 'all');
}

function serializeFacetValues(values: string[]): string {
  return values.filter((v) => v && v !== 'All').join(',');
}

function OrderFieldRow({
  label,
  value,
  stacked,
}: {
  label: string;
  value?: React.ReactNode;
  stacked?: boolean;
}) {
  if (value == null) return null;
  const text =
    typeof value === 'string' || typeof value === 'number'
      ? String(value).trim()
      : value;
  if (typeof text === 'string' && !text) return null;
  if (stacked) {
    return (
      <div className="text-[14px] leading-5 text-[#171717]">
        <p>
          <span className="font-medium text-[#111111]">{label}</span> :{' '}
        </p>
        <p className="mt-0.5 whitespace-normal break-words">{text}</p>
      </div>
    );
  }
  return (
    <p className="break-words text-[14px] leading-5 text-[#171717]">
      <span className="font-medium text-[#111111]">{label}</span> : {text}
    </p>
  );
}

function OrderDetailCard({
  order,
  index,
  fallbackAddress,
}: {
  order: {
    orderId: string;
    orderNumber: string;
    status: string;
    paymentStatus: string;
    fulfillmentStatus: string;
    totalAmount: string;
    currency: string;
    createdAt?: string;
    trackingId?: string;
    courier?: string;
    deliveryStatus?: string;
    expectedDelivery?: string;
    address?: string;
    orderUrl?: string;
    items: Array<{
      productId: string;
      quantity: number;
      name?: string;
      sku?: string;
      unitPrice?: string;
      currency?: string;
    }>;
  };
  index: number;
  fallbackAddress?: string;
}) {
  const number = String(order.orderNumber || order.orderId || '').trim();
  const money = [order.totalAmount, order.currency]
    .map((p) => String(p || '').trim())
    .filter(Boolean)
    .join(' ');
  const items = (order.items || []).filter(
    (item) =>
      String(item.name || item.sku || item.productId || '').trim() ||
      Number(item.quantity || 0) > 0 ||
      String(item.unitPrice || '').trim()
  );
  const orderUrl = String(order.orderUrl || '').trim();
  return (
    <div className="space-y-1.5">
      <p className="min-w-0 break-all text-sm font-semibold text-neutral-900">
        {number ? `Order ${index + 1} · ${number}` : `Order ${index + 1}`}
      </p>
      <OrderFieldRow label="Status" value={order.status} />
      <OrderFieldRow label="Payment" value={order.paymentStatus} />
      <OrderFieldRow
        label="Fulfillment"
        value={
          String(order.fulfillmentStatus || '')
            .trim()
            .toLowerCase() !== String(order.status || '').trim().toLowerCase()
            ? order.fulfillmentStatus
            : ''
        }
      />
      <OrderFieldRow label="Total" value={money} />
      <OrderFieldRow
        stacked
        label="Address"
        value={
          String(order.address || '').trim() || String(fallbackAddress || '').trim()
        }
      />
      <OrderFieldRow label="Order date" value={formatOrderWhen(order.createdAt)} />
      <OrderFieldRow
        label="Delivery date"
        value={formatOrderWhen(order.expectedDelivery)}
      />
      <OrderFieldRow label="Tracking" value={order.trackingId} />
      <OrderFieldRow label="Courier" value={order.courier} />
      <OrderFieldRow label="Delivery" value={order.deliveryStatus} />
      {orderUrl ? (
        <OrderFieldRow
          label="Link"
          value={
            <a
              href={orderUrl}
              target="_blank"
              rel="noreferrer"
              className="text-sky-700 hover:underline"
              onClick={(e) => e.stopPropagation()}
            >
              View order
            </a>
          }
        />
      ) : null}
      {items.length > 0 ? (
        <div className="mt-1">
          <p className="mb-1.5 text-[14px] leading-5 text-[#171717]">Items</p>
          <ul className="space-y-2">
            {items.map((item, idx) => {
              const itemName = String(item.name || '').trim();
              const qty = Number(item.quantity || 0);
              const money = [
                String(item.unitPrice || '').trim(),
                String(item.currency || order.currency || '').trim(),
              ]
                .filter(Boolean)
                .join(' ');
              return (
                <li
                  key={`${order.orderId}-${item.productId || item.sku || itemName}-${idx}`}
                  className="text-[14px] leading-5 text-[#171717]"
                >
                  <p className="break-words">{itemName || '—'}</p>
                  {qty > 0 || money ? (
                    <p>
                      {[
                        qty > 0 ? `× ${qty}` : '',
                        money ? `Price : ${money}` : '',
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function formatOrderWhen(value?: string) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return raw.slice(0, 10);
  return d.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

function TicketDescriptionBody({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);
  const pRef = useRef<HTMLParagraphElement>(null);

  useLayoutEffect(() => {
    setExpanded(false);
  }, [text]);

  useLayoutEffect(() => {
    const el = pRef.current;
    if (!el || expanded) return;
    const measure = () => {
      setOverflows(el.scrollHeight > el.clientHeight + 1);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [text, expanded]);

  return (
    <>
      <p
        ref={pRef}
        className={`text-sm text-neutral-800 leading-relaxed whitespace-pre-wrap select-text ${
          expanded ? '' : 'line-clamp-3'
        }`}
      >
        {text}
      </p>
      {overflows ? (
              <button
                type="button"
          onClick={() => setExpanded((open) => !open)}
          className="mt-2 text-sm font-semibold text-neutral-900 hover:underline"
        >
          {expanded ? 'Show Less' : 'Show More'}
              </button>
      ) : null}
    </>
  );
}

function FilterDropdown({
  id,
  label,
  value,
  values,
  options,
  onChange,
  onChangeValues,
  multiple,
}: {
  id: string;
  label: string;
  value?: string;
  values?: string[];
  options: Array<{ value: string; label: string }>;
  onChange?: (value: string) => void;
  onChangeValues?: (values: string[]) => void;
  multiple?: boolean;
}) {
  return (
    <MenuSelect
      id={id}
      label={label}
      value={value}
      values={values}
      options={options}
      onChange={onChange}
      onChangeValues={onChangeValues}
      multiple={multiple}
    />
  );
}

type CatalogOption = { value: string; label: string };

function catalogSelectValue(raw: string, options: CatalogOption[]): string {
  const text = String(raw || '').trim();
  if (!text) return options[0]?.value ?? '';
  const hit = options.find(
    (o) => o.value.toLowerCase() === text.toLowerCase()
  );
  return hit?.value ?? text;
}

function isClosedTicketStatus(status: string): boolean {
  return String(status || '').trim().toLowerCase() === 'closed';
}

function isResolvedTicketStatus(status: string): boolean {
  return String(status || '').trim().toLowerCase() === 'resolved';
}

function TicketFieldSelect({
  value,
  options,
  ariaLabel,
  labelClassName,
  onChange,
}: {
  value: string;
  options: CatalogOption[];
  ariaLabel: string;
  labelClassName: string;
  onChange: (next: string) => void;
}) {
  const selected = catalogSelectValue(value, options);
  const hasOption = options.some(
    (o) => o.value.toLowerCase() === selected.toLowerCase()
  );
  const menuOptions = [
    ...options,
    ...(!hasOption && selected ? [{ value: selected, label: selected }] : []),
  ];
  return (
    <MenuSelect
      label={ariaLabel}
        value={selected}
      options={menuOptions}
      onChange={onChange}
      stopPropagation
      minMenuWidth={168}
      triggerClassName={`inline-flex h-[38px] w-auto max-w-[12rem] shrink-0 cursor-pointer items-center justify-between gap-1 border px-3.5 text-sm font-medium shadow-none outline-none ${labelClassName}`}
    />
  );
}

const TICKET_PRIORITY_CARD_THEME: Record<
  Priority,
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

function priorityCardTheme(priority: Priority) {
  return TICKET_PRIORITY_CARD_THEME[priority] ?? TICKET_PRIORITY_CARD_THEME.medium;
}

function ticketCardInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

type TicketGridCardProps = {
  ticket: Ticket;
  meta: string;
  requester: string;
  priorityText: string;
  statusText: string;
  onOpen: () => void;
  renderChannelIcon: (channel: Channel) => React.ReactNode;
  statusBadgeClass: (status: TicketStatus) => string;
};

function TicketGridCard({
  ticket,
  meta,
  requester,
  priorityText,
  statusText,
  onOpen,
  renderChannelIcon,
  statusBadgeClass,
}: TicketGridCardProps) {
  const theme = priorityCardTheme(ticket.priority);
  const assignee =
    ticket.assignee &&
    ticket.assignee !== 'Unassigned' &&
    ticket.assignee !== requester
      ? ticket.assignee
      : '';

  return (
    <li className="@container min-w-0 h-full">
      <button
        type="button"
        onClick={onOpen}
        aria-label={`Open ticket ${ticket.id}: ${ticket.subject}`}
        className={`group flex h-full w-full min-h-[228px] min-w-0 flex-col overflow-hidden rounded-2xl border-[0.6px] border-[#bfbfbf] bg-white text-left shadow-none transition-all duration-150 hover:border-neutral-400 hover:shadow-[0_2px_12px_rgba(0,0,0,0.04)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/10 cursor-pointer ${theme.hoverBorder}`}
      >
        <div
          className={`relative h-[72px] shrink-0 overflow-hidden bg-gradient-to-br ${theme.wash}`}
        >
          <div className="absolute inset-x-4 top-3 flex items-center justify-between gap-2">
            <span className="font-mono text-[14px] font-semibold tabular-nums text-neutral-600">
              {ticket.id}
            </span>
            <span
              className={`inline-flex max-w-[55%] shrink-0 truncate rounded-full border px-2 py-0.5 text-[14px] font-bold uppercase tracking-wide ${theme.pill}`}
            >
              {priorityText}
            </span>
          </div>
          <div className="absolute inset-x-4 bottom-2.5 flex items-center gap-1.5 text-[14px] text-neutral-500">
            {renderChannelIcon(ticket.channel)}
            <span className="truncate">{ticket.channel === 'Web' ? 'Web' : ticket.channel}</span>
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col px-4 pb-4 pt-3">
          <h4 className="line-clamp-2 min-h-[2.75rem] text-[14px] font-bold leading-snug text-neutral-950 group-hover:text-neutral-800">
            {ticket.subject}
          </h4>
          <p
            className="mt-1.5 line-clamp-2 min-h-[2.25rem] text-[14px] leading-relaxed text-neutral-500"
            title={meta}
          >
            {meta || '—'}
          </p>

          <div className="mt-auto min-w-0 border-t border-neutral-100 pt-3">
            <div className="flex min-w-0 items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2">
                <span
                  className={`inline-flex shrink-0 whitespace-nowrap rounded-md border px-2 py-0.5 text-[14px] font-medium ${statusBadgeClass(ticket.status)}`}
                >
                  {statusText}
                </span>
                {assignee ? (
                  <span className="hidden min-w-0 items-center gap-1.5 text-[14px] text-neutral-500 @[16rem]:inline-flex">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-[11px] font-bold text-neutral-700">
                      {ticketCardInitials(assignee)}
                    </span>
                    <span className="min-w-0 truncate">{assignee}</span>
                  </span>
                ) : null}
              </div>
              <span className="shrink-0 whitespace-nowrap tabular-nums text-[14px] text-neutral-400">
                {ticket.updatedAt}
              </span>
            </div>
            {assignee ? (
              <span className="mt-2 flex min-w-0 items-center gap-1.5 text-[14px] text-neutral-500 @[16rem]:hidden">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-[11px] font-bold text-neutral-700">
                  {ticketCardInitials(assignee)}
                </span>
                <span className="min-w-0 truncate">{assignee}</span>
              </span>
            ) : null}
          </div>
        </div>
      </button>
    </li>
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
  moduleResetKey = 0,
  embedded = false,
  openDetailTab,
  listOffset = 0,
  listTotal,
  listHasMore = false,
  listPageSize = 200,
  listLoading = false,
  onListPageChange,
  sortOrder: sortOrderProp,
  onSortOrderChange,
  onBackFromTicket,
  backFromTicketLabel,
  onExpandedTicketIdChange,
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
  const canEditStatusPriority =
    Boolean(canMutate) &&
    String(currentUser.role || '').toLowerCase() !== 'resolver' &&
    canSetTicketStatusPriority(currentUser.role);
  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  const [priorityFilter, setPriorityFilter] = useState<string[]>([]);
  const [channelFilter, setChannelFilter] = useState<string[]>([]);
  const [localSortOrder, setLocalSortOrder] = useState<'latest' | 'oldest' | 'priority'>('latest');
  const sortOrder = sortOrderProp ?? localSortOrder;
  const setSortOrder = (next: 'latest' | 'oldest' | 'priority') => {
    setLocalSortOrder(next);
    onSortOrderChange?.(next);
  };

  // Prefer coworker/App facet when set so the dropdown never desyncs from the list.
  const effectiveStatusFilters = parseFacetValues(externalStatusFilter, statusFilter);
  const effectivePriorityFilters = parseFacetValues(
    externalPriorityFilter === undefined
      ? undefined
      : externalPriorityFilter.trim() === ''
        ? ''
        : externalPriorityFilter
            .split(',')
            .map((part) => part.trim().toLowerCase())
            .filter(Boolean)
            .join(','),
    priorityFilter
  );
  const effectiveChannelFilters = parseFacetValues(externalChannelFilter, channelFilter);

  useEffect(() => {
    if (externalPriorityFilter && externalPriorityFilter.trim() !== '') {
      // Keep catalog keys lowercase (low/medium/high/urgent) — title-casing
      // broke matching against ticket.priority and emptied the list.
      setPriorityFilter(
        externalPriorityFilter
          .split(',')
          .map((part) => part.trim().toLowerCase())
          .filter(Boolean)
      );
    } else if (externalPriorityFilter === '') {
      setPriorityFilter([]);
    }
  }, [externalPriorityFilter]);

  useEffect(() => {
    if (externalStatusFilter) {
      setStatusFilter(parseFacetValues(externalStatusFilter, []));
    } else if (externalStatusFilter === '') {
      setStatusFilter([]);
    }
  }, [externalStatusFilter]);

  useEffect(() => {
    if (externalChannelFilter) {
      setChannelFilter(parseFacetValues(externalChannelFilter, []));
    } else if (externalChannelFilter === '') {
      setChannelFilter([]);
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
    Array<{
      status: string;
      displayName: string;
      sortOrder: number;
      isTerminal?: boolean;
    }>
  >([]);
  const [reassignPick, setReassignPick] = useState('');
  const [reassignSlot, setReassignSlot] = useState<'assignee' | 'resolver'>(
    'assignee'
  );
  const [reassignRequestOpen, setReassignRequestOpen] = useState(false);
  const [reassignReason, setReassignReason] = useState('');
  const [reassignRequestBusy, setReassignRequestBusy] = useState(false);
  const [reassignRequestError, setReassignRequestError] = useState('');

  // Full ticket detail (replaces list while open)
  const [expandedTicketId, setExpandedTicketId] = useState<string | null>(null);
  const [detailTab, setDetailTab] = useState<
    'details' | 'conversations' | 'notes' | 'activities' | 'attachments'
  >('details');
  const [conversationChannel, setConversationChannel] = useState<
    'portal' | 'email'
  >('email');
  const [conversationExpanded, setConversationExpanded] = useState(false);
  const attachInputRef = useRef<HTMLInputElement>(null);
  const [attachBusy, setAttachBusy] = useState(false);
  const [attachError, setAttachError] = useState('');
  const [attachDragOver, setAttachDragOver] = useState(false);
  const [notesListScrolling, setNotesListScrolling] = useState(false);
  const [orderDetailsOpen, setOrderDetailsOpen] = useState(true);
  const [orderDetailsIndex, setOrderDetailsIndex] = useState(0);
  const [orderDetailsDir, setOrderDetailsDir] = useState<1 | -1>(1);
  const [orderDetailsMotion, setOrderDetailsMotion] = useState(false);
  const notesListScrollTimerRef = useRef<number | null>(null);
  const appliedSearchOpenRef = useRef('');
  const historyReturnStack = useRef<string[]>([]);
  const [ticketCache, setTicketCache] = useState<Record<string, Ticket>>({});
  const ticketCacheRef = useRef<Record<string, Ticket>>({});
  const hydrateGenById = useRef<Record<string, number>>({});
  const localEditsRef = useRef<Record<string, Partial<Ticket>>>({});
  const customer360Gen = useRef(0);
  const notesListRef = useRef<HTMLDivElement>(null);
  const listScrollRef = useRef<HTMLDivElement>(null);
  const detailHeaderRef = useRef<HTMLDivElement>(null);
  const splitExpand = useCoworkerSplitExpandOptional();
  const contentFullPage = splitExpand?.contentFullPage ?? false;
  const pageBridge = useCoworkerPageBridge();

  const rememberTicket = (row: Ticket) => {
    setTicketCache((prev) => {
      const current = prev[row.id] || ticketCacheRef.current[row.id];
      const next = current ? { ...current, ...row } : { ...row };
      if (!String(row.description || '').trim() && String(current?.description || '').trim()) {
        next.description = current!.description;
      }
      if (!String(row.aiSummary || '').trim() && String(current?.aiSummary || '').trim()) {
        next.aiSummary = current!.aiSummary;
      }
      if (
        !String(row.csatComment || '').trim() &&
        String(current?.csatComment || '').trim()
      ) {
        next.csatComment = current!.csatComment;
      }
      if (
        (row.csatScore == null || Number.isNaN(Number(row.csatScore))) &&
        current?.csatScore != null
      ) {
        next.csatScore = current.csatScore;
      }
      const edits = localEditsRef.current[row.id];
      if (edits) Object.assign(next, edits);
      const merged = { ...prev, [row.id]: next };
      ticketCacheRef.current = merged;
      return merged;
    });
  };

  const patchRememberedTicket = (id: string, updates: Partial<Ticket>) => {
    hydrateGenById.current[id] = (hydrateGenById.current[id] || 0) + 1;
    const fieldUpdates: Partial<Ticket> = {};
    if (updates.status != null) fieldUpdates.status = updates.status;
    if (updates.priority != null) fieldUpdates.priority = updates.priority;
    if (updates.assignee != null) fieldUpdates.assignee = updates.assignee;
    if (updates.resolver != null) fieldUpdates.resolver = updates.resolver;
    if (Object.keys(fieldUpdates).length) {
      localEditsRef.current[id] = {
        ...(localEditsRef.current[id] || {}),
        ...fieldUpdates,
      };
    }
    setTicketCache((prev) => {
      const current =
        prev[id] || ticketCacheRef.current[id] || tickets.find((row) => row.id === id);
      if (!current) return prev;
      const next = { ...current, ...updates };
      const merged = { ...prev, [id]: next };
      ticketCacheRef.current = merged;
      return merged;
    });
  };

  const hydrateTicket = async (id: string): Promise<Ticket | null> => {
    const gen = (hydrateGenById.current[id] || 0) + 1;
    hydrateGenById.current[id] = gen;
    try {
      const res = await fetch(`/api/tickets/${encodeURIComponent(id)}`, {
        credentials: 'include',
      });
      if (!res.ok) return null;
      const row = (await res.json()) as Ticket;
      if (!row?.id) return null;
      if (hydrateGenById.current[id] !== gen) return ticketCacheRef.current[id] || row;
      rememberTicket(row);
      return row;
    } catch {
      return null;
    }
  };

  const openTicket = (id: string, opts?: { fromHistory?: boolean }) => {
    if (!opts?.fromHistory) historyReturnStack.current = [];
    const fromList = tickets.find((row) => row.id === id);
    if (fromList) rememberTicket(fromList);
    setExpandedTicketId(id);
    setDetailTab('details');
    setConversationChannel('email');
    setAttachError('');
    setAttachDragOver(false);
    setOrderDetailsIndex(0);
    setOrderDetailsMotion(false);
    void hydrateTicket(id);
    window.requestAnimationFrame(() => {
      detailHeaderRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };

  const ensureTicket = async (id: string): Promise<Ticket | null> => {
    const fromList = tickets.find((t) => t.id === id);
    if (fromList) rememberTicket(fromList);
    const hydrated = await hydrateTicket(id);
    if (hydrated) return hydrated;
    if (fromList) return fromList;
    return ticketCache[id] || null;
  };

  const openHistoryTicket = async (id: string) => {
    const next = String(id || '').trim();
    if (!next || next === expandedTicketId) return;
    if (expandedTicketId) historyReturnStack.current.push(expandedTicketId);
    const row = await ensureTicket(next);
    if (!row) {
      historyReturnStack.current.pop();
      return;
    }
    openTicket(row.id, { fromHistory: true });
  };

  const handledModuleResetKey = useRef(0);
  const prevViewMode = useRef(viewMode);
  useEffect(() => {
    if (moduleResetKey <= handledModuleResetKey.current) return;
    handledModuleResetKey.current = moduleResetKey;
    setExpandedTicketId(null);
    historyReturnStack.current = [];
    splitExpand?.clearContentFocus?.();
    window.requestAnimationFrame(() => {
      listScrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }, [moduleResetKey, splitExpand?.clearContentFocus]);
  useEffect(() => {
    if (prevViewMode.current === viewMode) return;
    prevViewMode.current = viewMode;
    setExpandedTicketId(null);
    historyReturnStack.current = [];
    setDetailTab('details');
    setConversationChannel('email');
    splitExpand?.clearContentFocus?.();
  }, [viewMode, splitExpand?.clearContentFocus]);
  useEffect(() => {
    listScrollRef.current?.scrollTo({ top: 0 });
  }, [listOffset]);
  const coworkerFocusedEntity = expandedTicketId
    ? (() => {
        const row =
          tickets.find((t) => t.id === expandedTicketId) ||
          ticketCache[expandedTicketId];
        return {
          type: 'ticket' as const,
          id: expandedTicketId,
          name: row?.subject || row?.id || expandedTicketId,
          status: row?.status,
          subject: row?.subject,
          ticketNumber: row?.id || expandedTicketId,
          customerName: row?.customerName,
          customerEmail: row?.customerEmail,
          assignee: row?.assignee,
          resolver: row?.resolver,
          priority: row?.priority,
          description: row?.description,
        };
      })()
    : null;
  useReportFocusedEntity(coworkerFocusedEntity);
  useEffect(() => {
    if (!pageBridge) return;
    pageBridge.setPageHandlers({
      module: 'tickets',
      surface: expandedTicketId ? 'detail' : 'list',
      getChatContext: () => ({
        module: 'tickets',
        surface: expandedTicketId ? 'detail' : 'list',
        entityId: expandedTicketId,
        focusedEntity: coworkerFocusedEntity,
      }),
    });
    return () => pageBridge.setPageHandlers(null);
  }, [
    pageBridge,
    expandedTicketId,
    coworkerFocusedEntity?.id,
    coworkerFocusedEntity?.status,
    coworkerFocusedEntity?.name,
  ]);
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
  type TicketNoteRow = StaffConversationNote;
  const [ticketNotes, setTicketNotes] = useState<
    Record<string, TicketNoteRow[]>
  >({});
  const [newNoteText, setNewNoteText] = useState<string>('');
  const [postingNote, setPostingNote] = useState(false);
  const [noteSentFor, setNoteSentFor] = useState<string | null>(null);
  const [notePostError, setNotePostError] = useState<string | null>(null);
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editNoteText, setEditNoteText] = useState('');
  const [savingNoteEdit, setSavingNoteEdit] = useState(false);
  const [noteEditError, setNoteEditError] = useState<string | null>(null);
  const [noteStaff, setNoteStaff] = useState<NoteMentionUser[]>([]);
  const [noteMentionFilter, setNoteMentionFilter] = useState<string | null>(null);
  const [noteMentionStart, setNoteMentionStart] = useState(0);
  const [noteMentionIndex, setNoteMentionIndex] = useState(0);
  const [noteMentionTarget, setNoteMentionTarget] = useState<'new' | 'edit'>('new');
  const newNoteComposerRef = useRef<HTMLTextAreaElement>(null);
  const editNoteComposerRef = useRef<HTMLTextAreaElement>(null);
  const [notesLoading, setNotesLoading] = useState(false);
  const [ticketNoteUnread, setTicketNoteUnread] = useState<
    Record<string, number>
  >({});
  const [ticketNoteLastRead, setTicketNoteLastRead] = useState<
    Record<string, string | null>
  >({});
  const [ticketAttachmentUnread, setTicketAttachmentUnread] = useState<
    Record<string, number>
  >({});
  const detailTabRef = useRef(detailTab);
  const expandedTicketIdRef = useRef(expandedTicketId);
  const notesLoadSeq = useRef(0);
  const [emailConversation, setEmailConversation] = useState<
    Record<string, StaffConversationNote[]>
  >({});
  const [emailConversationLoading, setEmailConversationLoading] =
    useState(false);
  const [emailConversationError, setEmailConversationError] = useState<
    string | null
  >(null);
  /** TSAA writes ai_summary async; poll once after a staff note. */
  const [aiSummaryByTicket, setAiSummaryByTicket] = useState<
    Record<string, string>
  >({});
  const [customer360, setCustomer360] = useState<{
    email: string;
    totalTickets: number;
    avgCsat: number | null;
    ratingsCount: number;
    customer?: Customer | null;
    totalOrders?: number;
    orders?: Array<{
      orderId: string;
      orderNumber: string;
      status: string;
      paymentStatus: string;
      fulfillmentStatus: string;
      totalAmount: string;
      currency: string;
      createdAt?: string;
      trackingId?: string;
      courier?: string;
      deliveryStatus?: string;
      expectedDelivery?: string;
      address?: string;
      orderUrl?: string;
      items: Array<{
        productId: string;
        quantity: number;
        name?: string;
        sku?: string;
        unitPrice?: string;
        currency?: string;
      }>;
    }>;
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
        const [rRes, pRes, sRes] = await Promise.all([
          fetch('/api/roster', { credentials: 'include' }),
          fetch('/api/priorities', { credentials: 'include' }),
          fetch('/api/statuses', { credentials: 'include' }),
        ]);
        if (rRes.ok) {
          const members = await rRes.json();
          setRoster(Array.isArray(members) ? members : []);
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
                    isTerminal?: boolean;
                  }) => ({
                    status: s.status,
                    displayName: s.displayName || s.status,
                    sortOrder: Number(s.sortOrder ?? 100),
                    isTerminal: Boolean(s.isTerminal),
                  })
                )
              : []
          );
        } else {
          console.error('Failed to load statuses', sRes.status);
          setStatusOptions([]);
        }
      } catch (err) {
        console.error('Failed to load roster/priorities/statuses', err);
      }
    };
    void loadOptions();
  }, []);

  const loadCustomer360 = async (input: {
    email?: string;
    phone?: string;
    customerId?: string;
  }) => {
    const email = String(input.email || '').trim();
    const phone = String(input.phone || '').trim();
    const customerId = String(input.customerId || '').trim();
    const gen = ++customer360Gen.current;
    if (!email && !phone && !customerId) {
      setCustomer360(null);
      return;
    }
    setCustomer360(null);
    setCustomer360Loading(true);
    try {
      const params = new URLSearchParams();
      if (customerId) params.set('customerId', customerId);
      if (email) params.set('email', email);
      const res = await fetch(`/api/customers/360?${params.toString()}`, {
        credentials: 'include',
      });
      if (gen !== customer360Gen.current) return;
      if (res.ok) {
        setCustomer360(await res.json());
      } else {
        setCustomer360(null);
      }
    } catch {
      if (gen !== customer360Gen.current) return;
      setCustomer360(null);
    } finally {
      if (gen === customer360Gen.current) setCustomer360Loading(false);
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

  const loadEmailConversation = async (
    ticketId: string,
    opts?: { silent?: boolean }
  ) => {
    if (!opts?.silent) setEmailConversationLoading(true);
    setEmailConversationError(null);
    try {
      const res = await fetch(
        `/api/tickets/${encodeURIComponent(ticketId)}/email-conversation`,
        { credentials: 'include' }
      );
      if (!res.ok) {
        setEmailConversationError('Could not load email conversation.');
        return;
      }
      const body = (await res.json()) as {
        configured?: boolean;
        messages?: Array<{
          id: string;
          author: string;
          text: string;
          time?: string;
          at?: string;
          subject?: string;
          lane?: 'in' | 'out';
          role?: 'user' | 'bot' | 'agent';
          fromEmail?: string;
          toEmail?: string;
        }>;
      };
      if (body.configured === false) {
        setEmailConversationError(null);
      }
      const messages = (body.messages || []).map((row) => ({
        id: row.id,
        author: row.author,
        text: row.text,
        time: row.time,
        at: row.at,
        subject: row.subject,
        lane: row.lane,
        role: row.role,
        fromEmail: row.fromEmail,
        toEmail: row.toEmail,
        visibility: 'public' as const,
      }));
      setEmailConversation((prev) => ({ ...prev, [ticketId]: messages }));
    } catch (err) {
      console.error('Failed to load email conversation', err);
      setEmailConversationError('Could not load email conversation.');
    } finally {
      if (!opts?.silent) setEmailConversationLoading(false);
    }
  };

  const loadNotes = async (ticketId: string, opts?: { silent?: boolean }) => {
    if (!opts?.silent) setNotesLoading(true);
    const seq = ++notesLoadSeq.current;
    try {
      const res = await fetch(
        `/api/tickets/${encodeURIComponent(ticketId)}/notes?withUnread=1`,
        { credentials: 'include' }
      );
      const payload = res.ok ? await res.json() : [];
      if (seq !== notesLoadSeq.current) return;
      const notes: TicketNoteRow[] = Array.isArray(payload)
        ? payload
        : Array.isArray(payload?.notes)
          ? payload.notes
          : [];
      if (res.ok) {
        const apiUnread = Number(
          Array.isArray(payload)
            ? res.headers.get('X-Ticket-Notes-Unread') || 0
            : payload?.unreadCount || 0
        );
        const apiLastRead = Array.isArray(payload)
          ? undefined
          : (payload?.lastReadAt as string | null | undefined);
        setTicketNoteLastRead((prev) => {
          const lastReadAt = prev[ticketId] || apiLastRead || null;
          const unread = unreadStaffNoteCount(
            notes,
            lastReadAt,
            apiUnread,
            currentUser.name
          );
          setTicketNoteUnread((u) =>
            u[ticketId] === unread ? u : { ...u, [ticketId]: unread }
          );
          if (prev[ticketId] === lastReadAt) return prev;
          return { ...prev, [ticketId]: lastReadAt };
        });
      }
      setTicketNotes((prev) => {
        const prevNotes = prev[ticketId] || [];
        const next = notes.map((note) => {
          const local = prevNotes.find((row) => row.id === note.id);
          return {
            ...note,
            pinned:
              typeof note.pinned === 'boolean'
                ? note.pinned
                : Boolean(local?.pinned),
          };
        });
        if (
          prevNotes.length === next.length &&
          prevNotes.every(
            (row, i) =>
              row.id === next[i]?.id &&
              row.text === next[i]?.text &&
              row.time === next[i]?.time &&
              String(row.editedAt || '') === String(next[i]?.editedAt || '') &&
              Boolean(row.pinned) === Boolean(next[i]?.pinned)
          )
        ) {
          return prev;
        }
        return { ...prev, [ticketId]: next };
      });
    } catch (err) {
      console.error('Failed to load notes', err);
    } finally {
      if (!opts?.silent) setNotesLoading(false);
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
          if (t?.id) rememberTicket(t as Ticket);
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

  const markNotesRead = async (ticketId: string) => {
    if (String(currentUser.role || '').toLowerCase() === 'customer') return;
    try {
      const res = await fetch(
        `/api/tickets/${encodeURIComponent(ticketId)}/notes/read`,
        { method: 'POST', credentials: 'include' }
      );
      if (!res.ok) return;
      const now = new Date().toISOString();
      setTicketNoteLastRead((prev) => ({ ...prev, [ticketId]: now }));
      setTicketNoteUnread((prev) =>
        prev[ticketId] === 0 ? prev : { ...prev, [ticketId]: 0 }
      );
    } catch {
      /* keep last unread count */
    }
  };

  const loadAttachmentUnread = async (ticketId: string) => {
    if (String(currentUser.role || '').toLowerCase() === 'customer') return;
    try {
      const res = await fetch(
        `/api/tickets/${encodeURIComponent(ticketId)}/attachments/unread`,
        { credentials: 'include' }
      );
      if (!res.ok) return;
      const body = (await res.json()) as { unreadCount?: number };
      const unread = Math.max(0, Number(body.unreadCount) || 0);
      setTicketAttachmentUnread((prev) =>
        prev[ticketId] === unread ? prev : { ...prev, [ticketId]: unread }
      );
    } catch {
      /* keep last count */
    }
  };

  const markAttachmentsRead = async (ticketId: string) => {
    if (String(currentUser.role || '').toLowerCase() === 'customer') return;
    try {
      const res = await fetch(
        `/api/tickets/${encodeURIComponent(ticketId)}/attachments/read`,
        { method: 'POST', credentials: 'include' }
      );
      if (!res.ok) return;
      setTicketAttachmentUnread((prev) =>
        prev[ticketId] === 0 ? prev : { ...prev, [ticketId]: 0 }
      );
    } catch {
      /* keep last unread count */
    }
  };

  const toggleNotePin = async (
    ticketId: string,
    noteId: string,
    pinned: boolean
  ) => {
    if (!canMutate) return;
    notesLoadSeq.current += 1;
    setTicketNotes((prev) => ({
      ...prev,
      [ticketId]: (prev[ticketId] || []).map((note) =>
        note.id === noteId ? { ...note, pinned } : note
      ),
    }));
    try {
      const res = await fetch(
        `/api/tickets/${encodeURIComponent(ticketId)}/notes/${encodeURIComponent(noteId)}/pin`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ pinned }),
        }
      );
      if (!res.ok) {
        void loadNotes(ticketId, { silent: true });
        return;
      }
      const saved = (await res.json().catch(() => null)) as
        | { id?: string; pinned?: boolean }
        | null;
      if (saved?.id) {
        setTicketNotes((prev) => ({
          ...prev,
          [ticketId]: (prev[ticketId] || []).map((note) =>
            note.id === saved.id
              ? { ...note, pinned: Boolean(saved.pinned) }
              : note
          ),
        }));
      }
    } catch {
      void loadNotes(ticketId, { silent: true });
    }
  };

  const deleteNote = async (ticketId: string, noteId: string) => {
    if (!canMutate) return;
    if (!window.confirm('Delete this note? It will be removed from the ticket and recorded in the audit log.')) {
      return;
    }
    notesLoadSeq.current += 1;
    setTicketNotes((prev) => ({
      ...prev,
      [ticketId]: (prev[ticketId] || []).filter((note) => note.id !== noteId),
    }));
    if (editingNoteId === noteId) {
      setEditingNoteId(null);
      setEditNoteText('');
      setNoteEditError(null);
    }
    try {
      const res = await fetch(
        `/api/tickets/${encodeURIComponent(ticketId)}/notes/${encodeURIComponent(noteId)}`,
        {
          method: 'DELETE',
          credentials: 'include',
        }
      );
      if (!res.ok) {
        void loadNotes(ticketId, { silent: true });
      }
    } catch {
      void loadNotes(ticketId, { silent: true });
    }
  };

  const mentionableStaff = useMemo(
    () =>
      noteStaff.filter(
        (row) =>
          String(row.id) !== String(currentUser.id) && Boolean(row.name.trim())
      ),
    [noteStaff, currentUser.id]
  );
  const noteMentionHits = useMemo(() => {
    if (noteMentionFilter == null) return [];
    const q = noteMentionFilter.toLowerCase();
    return mentionableStaff.filter((row) => {
      const hay = `${row.name} ${row.email || ''} ${row.role || ''}`.toLowerCase();
      return !q || hay.includes(q);
    });
  }, [noteMentionFilter, mentionableStaff]);
  const mentionNames = useMemo(
    () =>
      [...mentionableStaff.map((row) => row.name), currentUser.name].filter(
        Boolean
      ),
    [mentionableStaff, currentUser.name]
  );

  const refreshNoteMention = (
    value: string,
    caret: number,
    target: 'new' | 'edit'
  ) => {
    const found = mentionQueryAt(value, caret);
    setNoteMentionTarget(target);
    if (!found) {
      setNoteMentionFilter(null);
      return;
    }
    setNoteMentionStart(found.start);
    setNoteMentionFilter(found.query);
    setNoteMentionIndex(0);
  };

  const applyNoteMention = (name: string) => {
    const target = noteMentionTarget;
    const el =
      target === 'edit' ? editNoteComposerRef.current : newNoteComposerRef.current;
    const value = target === 'edit' ? editNoteText : newNoteText;
    const caret = el?.selectionStart ?? value.length;
    const found = mentionQueryAt(value, caret);
    const start = found?.start ?? noteMentionStart;
    const next = `${value.slice(0, start)}@${name} ${value.slice(caret)}`;
    if (target === 'edit') setEditNoteText(next);
    else setNewNoteText(next);
    setNoteMentionFilter(null);
    requestAnimationFrame(() => {
      const node =
        target === 'edit'
          ? editNoteComposerRef.current
          : newNoteComposerRef.current;
      if (!node) return;
      const pos = start + name.length + 2;
      node.focus();
      node.setSelectionRange(pos, pos);
    });
  };

  const saveNoteEdit = async (ticketId: string, noteId: string) => {
    const text = editNoteText.trim();
    if (!text || !canMutate || savingNoteEdit) return;
    setSavingNoteEdit(true);
    setNoteEditError(null);
    try {
      const res = await fetch(
        `/api/tickets/${encodeURIComponent(ticketId)}/notes/${encodeURIComponent(noteId)}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ text }),
        }
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as
          | { error?: string }
          | null;
        setNoteEditError(
          String(body?.error || 'Could not save the edited note.')
        );
        return;
      }
      const saved = (await res.json().catch(() => null)) as
        | StaffConversationNote
        | null;
      if (saved?.id) {
        setTicketNotes((prev) => ({
          ...prev,
          [ticketId]: (prev[ticketId] || []).map((note) =>
            note.id === saved.id
              ? {
                  ...note,
                  ...saved,
                  pinned:
                    typeof saved.pinned === 'boolean'
                      ? saved.pinned
                      : note.pinned,
                }
              : note
          ),
        }));
      }
      setEditingNoteId(null);
      setEditNoteText('');
    } catch {
      setNoteEditError('Could not save the edited note.');
    } finally {
      setSavingNoteEdit(false);
    }
  };

  const postNote = async (ticketId: string) => {
    const text = newNoteText.trim();
    if (!text || !canMutate || postingNote) return;
    setPostingNote(true);
    setNotePostError(null);
    setNoteSentFor(null);
    try {
      const res = await fetch(`/api/tickets/${encodeURIComponent(ticketId)}/notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          text,
          visibility: 'internal',
        }),
      });
      if (res.ok) {
        const note = await res.json();
        setTicketNotes((prev) => ({
          ...prev,
          [ticketId]: [...(prev[ticketId] || []), note],
        }));
        const now = new Date().toISOString();
        setTicketNoteLastRead((prev) => ({ ...prev, [ticketId]: now }));
        setTicketNoteUnread((u) =>
          u[ticketId] === 0 ? u : { ...u, [ticketId]: 0 }
        );
        setNewNoteText('');
        setNoteMentionFilter(null);
        setNoteSentFor(ticketId);
        window.setTimeout(() => {
          setNoteSentFor((prev) => (prev === ticketId ? null : prev));
        }, 3000);
        refreshAiSummary(ticketId);
      } else {
        const body = (await res.json().catch(() => null)) as
          | { error?: string }
          | null;
        setNotePostError(
          String(body?.error || 'Could not post your message. Try again.')
        );
      }
    } catch (err) {
      console.error('Failed to post note', err);
      setNotePostError('Could not post your message. Try again.');
    } finally {
      setPostingNote(false);
    }
  };

  const persistTicketFiles = async (
    ticketNumber: string,
    urls: string[],
    replace: boolean
  ) => {
    setAttachBusy(true);
    setAttachError('');
    try {
      patchRememberedTicket(ticketNumber, { attachments: urls });
      const result = onUpdateTicket(ticketNumber, {
        attachments: urls,
        replaceAttachments: replace,
      });
      const ok = await Promise.resolve(result);
      if (ok === false) {
        setAttachError('Could not save those files on this ticket.');
        return false;
      }
      await markAttachmentsRead(ticketNumber);
      return true;
    } catch {
      setAttachError('Could not save those files on this ticket.');
      return false;
    } finally {
      setAttachBusy(false);
    }
  };

  const uploadTicketFiles = async (
    ticketNumber: string,
    fileList: FileList | File[] | null
  ) => {
    const files = Array.from(fileList || []).slice(0, 10);
    if (!files.length) return;
    setAttachBusy(true);
    setAttachError('');
    const form = new FormData();
    files.forEach((file) => form.append('files', file));
    try {
      const res = await fetch('/api/uploads', {
        method: 'POST',
        credentials: 'include',
        body: form,
      });
      const data = (await res.json().catch(() => ({}))) as {
        urls?: string[];
        error?: string;
      };
      if (!res.ok) {
        setAttachError(data.error || 'Could not upload those files.');
        return;
      }
      const urls = (data.urls || []).filter(
        (url) => typeof url === 'string' && url.startsWith('/uploads/')
      );
      if (!urls.length) {
        setAttachError('Could not upload those files.');
        return;
      }
      await persistTicketFiles(ticketNumber, urls, false);
    } catch {
      setAttachError('Could not upload those files.');
    } finally {
      setAttachBusy(false);
    }
  };

  const updateTicketAndRefreshSummary = (
    ticketId: string,
    updates: Parameters<typeof onUpdateTicket>[1]
  ) => {
    patchRememberedTicket(ticketId, updates);
    const result = onUpdateTicket(ticketId, updates) as unknown as
      | void
      | Promise<boolean | void>;
    void Promise.resolve(result).then((ok) => {
      if (ok === false) {
        delete localEditsRef.current[ticketId];
        return;
      }
      delete localEditsRef.current[ticketId];
      if (updates && "status" in updates && updates.status) {
        refreshAiSummary(ticketId);
      }
    });
  };

  const expandedStatus = tickets.find((x) => x.id === expandedTicketId)?.status;
  const conversationNotes = expandedTicketId
    ? toStaffConversationNotes(ticketNotes[expandedTicketId] || []).filter((note) => {
        const customerName = String(
          tickets.find((x) => x.id === expandedTicketId)?.customerName || ''
        );
        return (
          isPortalConversationNote(note, customerName) ||
          isEmailConversationNote(note, customerName)
        );
      })
    : [];
  const lastConversationNoteId = conversationNotes[0]?.id || '';

  useEffect(() => {
    if (detailTab !== 'conversations') return;
    const el = notesListRef.current;
    if (!el) return;
    const pinLatest = () => {
      el.scrollTop = 0;
    };
    pinLatest();
    const frame = window.requestAnimationFrame(pinLatest);
    return () => window.cancelAnimationFrame(frame);
  }, [
    detailTab,
    expandedTicketId,
    conversationNotes.length,
    lastConversationNoteId,
  ]);

  useEffect(() => {
    if (expandedTicketId) {
      void loadNotes(expandedTicketId);
      void loadAttachmentUnread(expandedTicketId);
    }
  }, [expandedTicketId, detailTab]);

  useEffect(() => {
    if (!expandedTicketId) return;
    const ticketId = expandedTicketId;
    const id = window.setInterval(() => {
      void loadNotes(ticketId, { silent: true });
      void loadAttachmentUnread(ticketId);
    }, 4000);
    return () => window.clearInterval(id);
  }, [expandedTicketId]);

  useEffect(() => {
    const prevTab = detailTabRef.current;
    const prevTicket = expandedTicketIdRef.current;
    if (prevTab === 'notes' && prevTicket && detailTab !== 'notes') {
      void markNotesRead(prevTicket);
    }
    if (prevTab === 'attachments' && prevTicket && detailTab !== 'attachments') {
      void markAttachmentsRead(prevTicket);
    }
    if (prevTicket && prevTicket !== expandedTicketId) {
      if (prevTab === 'notes') void markNotesRead(prevTicket);
      if (prevTab === 'attachments') void markAttachmentsRead(prevTicket);
      setEditingNoteId(null);
      setEditNoteText('');
      setNoteEditError(null);
      setNoteMentionFilter(null);
    }
    detailTabRef.current = detailTab;
    expandedTicketIdRef.current = expandedTicketId;
  }, [detailTab, expandedTicketId]);

  useEffect(() => {
    if (detailTab === 'conversations') setConversationChannel('email');
  }, [detailTab]);

  useEffect(() => {
    setConversationExpanded(false);
  }, [expandedTicketId]);

  useEffect(() => {
    if (!conversationExpanded) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setConversationExpanded(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [conversationExpanded]);

  useEffect(() => {
    if (!canMutate) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch('/api/agents', { credentials: 'include' });
        if (!res.ok) return;
        const rows = (await res.json()) as NoteMentionUser[];
        if (cancelled || !Array.isArray(rows)) return;
        setNoteStaff(
          rows
            .map((row) => ({
              id: String(row.id || ''),
              name: String(row.name || '').trim(),
              email: String(row.email || ''),
              role: String(row.role || ''),
            }))
            .filter((row) => row.id && row.name)
        );
      } catch {
        /* keep last roster */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [canMutate, currentUser.organizationId]);

  useEffect(() => {
    if (!expandedTicketId || detailTab !== 'conversations') return;
    void loadEmailConversation(expandedTicketId);
  }, [expandedTicketId, detailTab]);

  useEffect(() => {
    if (expandedTicketId) {
      void loadProgress(expandedTicketId);
      const t = tickets.find((x) => x.id === expandedTicketId);
      if (t?.customerId || t?.customerEmail) {
        void loadCustomer360({
          customerId: t.customerId || undefined,
          email: t.customerEmail,
        });
    } else {
        customer360Gen.current += 1;
        setCustomer360(null);
      }
    } else {
      customer360Gen.current += 1;
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
    if (!searchQuery) {
      appliedSearchOpenRef.current = '';
      return;
    }
    const q = searchQuery.toLowerCase();
    const looksLikeId = searchQuery.startsWith('#') || /^#?\d+$/.test(searchQuery.trim());
    if (looksLikeId || searchQuery.startsWith('WT-') || searchQuery.includes('#')) {
      setStatusFilter([]);
      setPriorityFilter([]);
      setChannelFilter([]);
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
    if (!match) return;
    setExpandedTicketId(match.id);
    const intentKey = `${match.id}::${searchQuery}::${openDetailTab ?? ''}`;
    if (appliedSearchOpenRef.current === intentKey) return;
    appliedSearchOpenRef.current = intentKey;
    if (openDetailTab === 'conversations' || openDetailTab === 'details') {
      setDetailTab(openDetailTab);
    }
  }, [searchQuery, tickets, openDetailTab]);

  // Filter logic based on viewMode and active filters
  const filteredTickets = tickets.filter(ticket => {
    // 1. ViewMode specific constraint
    // Admin "Tickets" = assigned to me. Agent/resolver/customer lists are
    // already scoped by the API — don't filter them away again.
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

    // 3. Dropdown status modifier (OR within the selected statuses)
    if (
      effectiveStatusFilters.length > 0 &&
      !effectiveStatusFilters.some(
        (status) => ticket.status.toLowerCase() === status.toLowerCase()
      )
    ) {
      return false;
    }

    // 4. Priority filter (case-insensitive — coworker actions send lowercase keys)
    if (
      effectivePriorityFilters.length > 0 &&
      !effectivePriorityFilters.some(
        (priority) => ticket.priority.toLowerCase() === priority.toLowerCase()
      )
    ) {
      return false;
    }

    // 5. Channel filter (case-insensitive — DB/API may return mixed casing)
    if (
      effectiveChannelFilters.length > 0 &&
      !effectiveChannelFilters.some(
        (channel) => ticket.channel.toLowerCase() === channel.toLowerCase()
      )
    ) {
      return false;
    }

    return true;
  });

  // Sort logic
  const sortedTickets = [...filteredTickets].sort((a, b) => {
    if (sortOrder === 'latest') {
      return ticketSeq(b) - ticketSeq(a);
    }
    if (sortOrder === 'oldest') {
      return ticketSeq(a) - ticketSeq(b);
    }
    if (sortOrder === 'priority') {
      const priorityWeight: Record<string, number> = { urgent: 4, high: 3, medium: 2, low: 1 };
      return (priorityWeight[b.priority] || 0) - (priorityWeight[a.priority] || 0);
    }
    return 0;
  });
  const ticketCountLabel =
    listLoading && tickets.length === 0
      ? 0
      : listTotal != null && listTotal >= 0
        ? listTotal
        : sortedTickets.length;

  // Icon maps in pure B&W
  const renderChannelIcon = (channel: Channel) => {
    const key = String(channel || '').trim();
    if (key === 'Email') {
      return (
        <span title="Email">
          <Mail className="h-3.5 w-3.5 text-neutral-500" aria-hidden />
        </span>
      );
    }
    if (key === 'Phone') {
      return (
        <span title="Phone Call">
          <PhoneCall className="h-3.5 w-3.5 text-neutral-500" aria-hidden />
        </span>
      );
    }
    if (key === 'Web') {
      return (
        <span title="Web Portal">
          <Globe className="h-3.5 w-3.5 text-neutral-500" aria-hidden />
        </span>
      );
    }
    return (
      <span title={key || 'Channel'}>
        <MessageSquare className="h-3.5 w-3.5 text-neutral-500" aria-hidden />
      </span>
    );
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
    priorityOptions.find(
      (p) => p.priority.toLowerCase() === String(priority || '').trim().toLowerCase()
    )?.displayName || priority;

  const statusLabel = (status: TicketStatus) =>
    statusOptions.find(
      (s) => s.status.toLowerCase() === String(status || '').trim().toLowerCase()
    )?.displayName || status;

  const renderPriorityBadge = (priority: Priority) => (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 text-xs font-medium uppercase tracking-wide border rounded-md ${priorityBadgeClass(priority)}`}
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
      case 'In Progress':
        return 'bg-blue-50 text-blue-700 border-blue-200/60';
      case 'Reopened':
        return 'bg-amber-50 text-amber-800 border-amber-200/60';
      case 'Resolved':
        return 'bg-emerald-50 text-emerald-700 border-emerald-200/60';
      case 'Closed':
        return 'bg-neutral-800 text-white border-neutral-800';
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
          status === 'Overdue' ? ' font-semibold animate-pulse' : ''
        }`}
      >
        {statusLabel(status)}
      </span>
    );
  };

  const headerStatusBadge = (status: TicketStatus) => (
    <span
      className={`inline-flex h-[38px] max-w-[12rem] shrink-0 items-center rounded-full border px-3.5 text-sm font-medium shadow-none ${statusBadgeClass(status)}${
        status === 'Overdue' ? ' font-semibold' : ''
      }`}
    >
      {statusLabel(status)}
    </span>
  );

  const headerPriorityBadge = (priority: Priority) => (
    <span
      className={`inline-flex h-[38px] max-w-[12rem] shrink-0 items-center rounded-md border px-3.5 text-sm font-medium shadow-none ${priorityBadgeClass(priority)} tracking-normal`}
    >
      {priorityLabel(priority)}
    </span>
  );

  const focusedTicket =
    expandedTicketId != null
      ? ticketCache[expandedTicketId] ||
        ticketCacheRef.current[expandedTicketId] ||
        tickets.find((t) => t.id === expandedTicketId) ||
        null
      : null;

  useEffect(() => {
    onExpandedTicketIdChange?.(expandedTicketId);
  }, [expandedTicketId, onExpandedTicketIdChange]);

  useEffect(() => {
    if (!expandedTicketId) return;
    const row = tickets.find((t) => t.id === expandedTicketId);
    if (row) rememberTicket(row);
  }, [tickets, expandedTicketId]);

  const contentFullPageRef = useRef(false);
  contentFullPageRef.current = splitExpand?.contentFullPage ?? false;

  // Widen content while a ticket is open. Do not clear the split in an
  // effect cleanup — remount / id refresh after chat reassign was resetting
  // to 45/55 and expanding the chat column. Restore default only when closed.
  useEffect(() => {
    if (!splitExpand) return;
    if (expandedTicketId) {
      if (!splitExpand.contentFullPage) {
    splitExpand.focusContent();
      }
      return;
    }
      if (!contentFullPageRef.current) {
        splitExpand.clearContentFocus();
      }
  }, [
    expandedTicketId,
    splitExpand?.contentFullPage,
    splitExpand?.focusContent,
    splitExpand?.clearContentFocus,
  ]);

  useEffect(() => {
    setOrderDetailsIndex(0);
    setOrderDetailsMotion(false);
  }, [expandedTicketId, customer360?.email, (customer360?.orders || []).length]);

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

  return (
    <PageShell
      id="tickets-view-container"
      embedded={embedded}
      fillHeight
    >
      <div className="flex min-h-0 min-w-0 w-full flex-1 flex-col gap-3 overflow-hidden sm:gap-4">

      {focusedTicket ? (
        (() => {
          const ticket = focusedTicket;
          const ticketClosed = isClosedTicketStatus(ticket.status);
          return (
        <div className="flex flex-1 min-h-0 min-w-0 flex-col gap-3">
                <div className="flex flex-1 min-h-0 min-w-0 flex-col overflow-hidden rounded-2xl bg-white shadow-none">
          <div
            ref={detailHeaderRef}
                    className="flex shrink-0 flex-col gap-3.5 border-b border-neutral-100 bg-gradient-to-r from-sky-50/80 to-white px-3.5 py-4 sm:px-5 sm:py-5"
          >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex min-w-0 flex-wrap items-center gap-2">
            <button
              type="button"
                          title={backFromTicketLabel || 'Back to list'}
              onClick={() => {
                            const prev = historyReturnStack.current.pop();
                            if (prev) {
                              void (async () => {
                                const row = await ensureTicket(prev);
                                if (row) openTicket(row.id, { fromHistory: true });
                              })();
                              return;
                            }
                            if (onBackFromTicket?.()) return;
                setExpandedTicketId(null);
                            if (searchQueryLooksLikeTicketId(searchQuery)) {
                              onSearchQueryChange('');
                            }
                window.requestAnimationFrame(() => {
                              listScrollRef.current?.scrollTo({
                                top: 0,
                                behavior: 'smooth',
                              });
                });
              }}
                          className="inline-flex size-[38px] shrink-0 items-center justify-center rounded-lg text-neutral-700 hover:bg-white/80 shadow-none"
            >
                          <ArrowLeft className="h-[18px] w-[18px] stroke-[2.25]" />
            </button>
                      <button
                        type="button"
                        title="Copy ticket ID"
                          onClick={async () => {
                          try {
                            await navigator.clipboard.writeText(ticket.id);
                            setCopiedTicketId(ticket.id);
                            window.setTimeout(() => setCopiedTicketId(null), 1500);
                          } catch {
                            /* ignore */
                          }
                        }}
                          className="inline-flex h-[38px] items-center gap-2 text-lg font-semibold text-neutral-900"
                      >
                          Ticket {ticket.id}
                        {copiedTicketId === ticket.id ? (
                            <Check className="h-[18px] w-[18px] stroke-[2.25] text-emerald-600" />
                        ) : (
                            <Copy className="h-[18px] w-[18px] stroke-[2.25] text-neutral-400" />
                        )}
                      </button>
                        <span className="inline-flex h-[38px] items-center gap-1.5 rounded-full border-[0.6px] border-[#bfbfbf] bg-white px-3 text-sm text-neutral-700">
                        {renderChannelIcon(ticket.channel)}
                        {ticket.channel}
                      </span>
                      {(() => {
                        const opened = formatTicketWhen(ticket.createdAt);
                        return (
                          <span
                              className="inline-flex h-[38px] items-center gap-1.5 text-sm text-neutral-500"
                            title={opened.absolute}
                          >
                              <Clock className="h-[18px] w-[18px] stroke-[2.25] text-neutral-400" />
                            Opened {opened.relative}
                          </span>
                        );
                      })()}
                    </div>
                      <div className="flex flex-wrap items-center justify-end gap-1.5 shrink-0">
                      {canEditStatusPriority ? (
                        <TicketFieldSelect
                          value={ticket.status}
                          ariaLabel="Change status"
                          labelClassName={`rounded-full border ${statusBadgeClass(ticket.status)}${
                              ticket.status === 'Overdue' ? ' font-semibold' : ''
                            }`}
                          options={statusOptions.map((s) => ({
                            value: s.status,
                            label: s.displayName,
                          }))}
                          onChange={(next) =>
                            updateTicketAndRefreshSummary(ticket.id, {
                              status: next as TicketStatus,
                            })
                          }
                        />
                      ) : (
                        headerStatusBadge(ticket.status)
                      )}
                      {canEditStatusPriority ? (
                        <TicketFieldSelect
                          value={ticket.priority}
                          ariaLabel="Change priority"
                          labelClassName={`rounded-md border ${priorityBadgeClass(ticket.priority)}`}
                          options={priorityOptions.map((p) => ({
                            value: p.priority,
                            label: p.displayName,
                          }))}
                          onChange={(next) =>
                            updateTicketAndRefreshSummary(ticket.id, {
                              priority: next as Priority,
                            })
                          }
                        />
                      ) : (
                        headerPriorityBadge(ticket.priority)
                      )}
                    </div>
                  </div>
                    <div className="flex flex-col gap-2 pl-[calc(38px+0.5rem)]">
                    <h2 className="text-lg font-semibold leading-snug text-neutral-900">
                          {ticket.subject}
                        </h2>
                    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm text-neutral-500">
                          <span className="inline-flex items-center gap-1.5">
                        <User className="h-[18px] w-[18px] stroke-[2.25] text-neutral-400" />
                        {ticket.assignee && ticket.assignee !== 'Unassigned' ? (
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
                        <UserCheck className="h-[18px] w-[18px] stroke-[2.25] text-neutral-400" />
                        {ticket.resolver?.trim() ? (
                              <>
                                Resolver{' '}
                                <span className="font-semibold text-neutral-800">
                                  {ticket.resolver}
                                </span>
                              </>
                            ) : (
                          <span className="text-neutral-400">Resolver unassigned</span>
                            )}
                          </span>
                            <span className="inline-flex items-center gap-1.5">
                        <Users className="h-[18px] w-[18px] stroke-[2.25] text-neutral-400" />
                        {ticket.queue?.trim() ? (
                          <>
                            Team{' '}
                            <span className="font-semibold text-neutral-800">
                                {ticket.queue}
                              </span>
                          </>
                        ) : (
                          <span className="text-neutral-400">Team unassigned</span>
                        )}
                            </span>
                    </div>
                    {presenceLabel ? (
                      <p className="inline-flex items-center gap-1.5 text-sm text-amber-800">
                        <Eye className="h-[18px] w-[18px] stroke-[2.25]" />
                        {presenceLabel}
                      </p>
                          ) : null}
                    </div>
                  </div>

                  <div
                    className={`grid min-w-0 grid-cols-1 flex-1 min-h-0 overflow-hidden max-lg:overflow-y-auto ${
                      contentFullPage
                        ? 'lg:grid-cols-[minmax(0,1fr)_minmax(240px,300px)]'
                        : 'xl:grid-cols-[minmax(0,1.6fr)_minmax(0,0.9fr)]'
                    }`}
                  >
                    {/* Main */}
                    <div
                      className={`flex min-h-0 min-w-0 flex-col gap-3 p-4 sm:p-5 border-neutral-100 ${
                        contentFullPage
                          ? 'border-b lg:border-b-0 lg:border-r'
                          : 'border-b xl:border-b-0 xl:border-r'
                      }`}
                    >
                      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2">
                        <SegmentTabs
                          ariaLabel="Ticket detail views"
                          className="w-full min-w-0"
                          variant="underline"
                          value={detailTab}
                          onChange={setDetailTab}
                          options={[
                            {
                              id: 'details',
                              label: 'Ticket Details',
                              icon: <ClipboardList />,
                            },
                            {
                              id: 'conversations',
                              label: 'Conversations',
                              icon: <MessageSquare />,
                            },
                            {
                              id: 'notes',
                              label: 'Notes',
                              icon: <FileText />,
                              ...(ticketNoteUnread[ticket.id] > 0
                                ? { count: ticketNoteUnread[ticket.id] }
                                : {}),
                            },
                            {
                              id: 'activities',
                              label: 'Activities',
                              icon: <Activity />,
                            },
                            {
                              id: 'attachments',
                              label: 'Attachments',
                              icon: <Paperclip />,
                              ...(ticketAttachmentUnread[ticket.id] > 0
                                ? { count: ticketAttachmentUnread[ticket.id] }
                                : {}),
                            },
                          ]}
                        />
                        {notesLoading &&
                        (detailTab === 'conversations' ||
                          detailTab === 'notes') ? (
                          <span className="text-[11px] text-neutral-500">
                            Loading…
                            </span>
                          ) : null}
                      </div>

                      {detailTab === 'details' ? (
                      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overflow-x-hidden [scrollbar-width:thin]">
                      {/* Progress — visible to every role including customers */}
                      <section className="rounded-xl border border-sky-100 bg-gradient-to-b from-sky-50/70 to-white px-3.5 py-3.5 space-y-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <h3 className="text-sm font-semibold text-neutral-800">
                            Ticket progress
                          </h3>
                          <div className="flex flex-wrap items-center gap-1.5">
                            {progressLoading && !ticketProgress ? (
                              <span className="text-sm text-neutral-500">
                                Loading…
                              </span>
                            ) : (
                              (() => {
                                const rawStatus =
                                  ticketProgress?.statusLabel ||
                                  statusLabel(ticket.status);
                                const isOverdue = Boolean(
                                  ticketProgress?.overdue ||
                                    ticket.status === 'Overdue'
                                );
                                if (isOverdue) {
                                  return (
                                    <span className="inline-flex items-center rounded-full bg-rose-50 border border-rose-200 px-2.5 py-1 text-[11px] font-medium text-rose-800">
                                Overdue
                              </span>
                                  );
                                }
                                return (
                                  <span className="inline-flex items-center rounded-full bg-white border border-sky-200 px-2.5 py-1 text-[11px] font-medium text-sky-800">
                                    {rawStatus}
                                  </span>
                                );
                              })()
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
                                  ticket.status === 'In Progress' ||
                                  ticket.status === 'Overdue' ||
                                  (ticket.status !== 'Open' &&
                                    ticket.status !== 'Resolved' &&
                                    ticket.status !== 'Closed')
                                    ? ('current' as const)
                                    : ticket.status === 'Resolved' ||
                                        ticket.status === 'Closed'
                                      ? ('done' as const)
                                      : ('upcoming' as const),
                              },
                              {
                                key: 'Resolved',
                                label: 'Resolved',
                                hint: 'Staff finished',
                                state:
                                  ticket.status === 'Resolved' ||
                                  ticket.status === 'Closed'
                                    ? ('done' as const)
                                    : ('upcoming' as const),
                              },
                              {
                                key: 'Closed',
                                label: 'Closed',
                                hint: 'Customer confirmed',
                                state:
                                  ticket.status === 'Closed'
                                    ? ('done' as const)
                                    : ('upcoming' as const),
                              },
                            ]
                          ).map((step, i, arr) => {
                            const done = step.state === 'done';
                            const current = step.state === 'current';
                            const next = arr[i + 1];
                            const lineAfter =
                              Boolean(next) &&
                              (next.state === 'done' || next.state === 'current');
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
                                    className={`mx-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 text-xs font-bold ${
                                      done || current
                                        ? 'border-sky-500 bg-sky-500 text-white'
                                        : 'border-neutral-200 bg-white text-neutral-400'
                                    }`}
                                  >
                                    {done || current ? (
                                      <Check className="h-3.5 w-3.5" />
                                    ) : (
                                      i + 1
                                    )}
                                  </span>
                                  {i < arr.length - 1 ? (
                                    <div
                                      className={`h-0.5 flex-1 rounded-full ${
                                        lineAfter ? 'bg-sky-400' : 'bg-neutral-200'
                                      }`}
                                    />
                                  ) : (
                                    <div className="flex-1" />
                                  )}
                                </div>
                                <p
                                  className={`text-sm font-semibold leading-tight ${
                                    done || current
                                      ? 'text-neutral-900'
                                      : 'text-neutral-400'
                                  }`}
                                >
                                  {step.label}
                                </p>
                                <p className="text-[11px] text-neutral-400 mt-0.5 hidden sm:block">
                                  {step.hint}
                                </p>
                              </li>
                            );
                          })}
                        </ol>

                        {!canMutate && (
                          <p className="text-sm text-neutral-500">
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
                            className={`flex shrink-0 items-center gap-2 rounded-xl border px-3 py-2.5 text-sm font-medium ${
                              sla.overdue
                                ? 'border-rose-200 bg-rose-50 text-rose-800'
                                : 'border-sky-200 bg-sky-50 text-sky-800'
                            }`}
                          >
                            <Clock className="h-[18px] w-[18px] stroke-[2.25] shrink-0" />
                            <span>SLA · {sla.label}</span>
                          </div>
                        );
                      })()}

                      <section>
                        <h3 className="text-sm font-semibold text-neutral-800 mb-2">
                          Description
                        </h3>
                        <div className="rounded-xl bg-neutral-50 border border-neutral-100 px-3.5 py-3">
                          <TicketDescriptionBody
                            text={
                              aiSummaryByTicket[ticket.id]?.trim() ||
                              ticket.aiSummary?.trim() ||
                              ticket.description?.trim() ||
                              'No description provided.'
                            }
                          />
                        </div>
                      </section>

                      {ticket.csatScore != null || ticket.csatComment?.trim() ? (
                        <section>
                          <h3 className="text-sm font-semibold text-neutral-800 mb-2">
                            Customer comment
                          </h3>
                          <div className="rounded-xl border border-neutral-100 bg-neutral-50 px-3.5 py-3">
                            {ticket.csatScore != null ? (
                              <TicketCsatMark score={ticket.csatScore} />
                            ) : null}
                            {ticket.csatComment?.trim() ? (
                            <p className={`text-sm text-neutral-800 leading-relaxed whitespace-pre-wrap select-text ${
                              ticket.csatScore != null ? 'mt-2' : ''
                            }`}>
                              {ticket.csatComment.trim()}
                            </p>
                            ) : null}
                        </div>
                        </section>
                      ) : null}

                      <section>
                        <h3 className="text-sm font-semibold text-neutral-800 mb-2">
                          History
                        </h3>
                        <div className="rounded-xl border border-neutral-100 bg-neutral-50 px-3.5 py-3 space-y-2">
                        {customer360Loading ? (
                          <p className="text-sm text-neutral-500">Loading…</p>
                        ) : customer360 ? (
                          <>
                            <p className="text-sm text-neutral-500">
                              {customer360.totalTickets} ticket
                              {customer360.totalTickets === 1 ? '' : 's'}
                              {customer360.ratingsCount
                                ? ` · ${customer360.ratingsCount} ratings`
                                : ''}
                            </p>
                            <ul className="space-y-1.5">
                              {customer360.tickets.map((pt) => {
                                const current = pt.id === ticket.id;
                                return (
                                <li key={pt.id}>
                                  <button
                                    type="button"
                                    disabled={current}
                                    onClick={() => void openHistoryTicket(pt.id)}
                                    className={`flex w-full items-start justify-between gap-2 rounded-lg px-2.5 py-2 text-left ${
                                      current
                                        ? 'bg-neutral-100'
                                        : 'bg-white hover:bg-neutral-50'
                                    }`}
                                    title={
                                      current
                                        ? 'This ticket'
                                        : `Open ${pt.id}`
                                    }
                                  >
                                  <div className="min-w-0 text-sm">
                                    <span className="font-mono text-[11px] text-neutral-400">
                                      {pt.id}
                                    </span>{' '}
                                    <span className="text-neutral-900">{pt.subject}</span>
                                  </div>
                                  <span className="shrink-0 text-[11px] text-neutral-400">
                                    {pt.status}
                                    {pt.csatScore != null ? ` · ${pt.csatScore}★` : ''}
                                  </span>
                                  </button>
                              </li>
                                );
                              })}
                            </ul>
                          </>
                        ) : (
                          <p className="text-sm text-neutral-500">
                            No prior tickets for this email.
                          </p>
                        )}
                        </div>
                      </section>
                      </div>
                      ) : detailTab === 'conversations' ? (
                          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                            {(() => {
                              const customerName = String(
                                ticket.customerName || ''
                              ).trim();
                              const cleaned = toStaffConversationNotes(
                                ticketNotes[ticket.id] || []
                              );
                              const portalNotes = cleaned.filter((note) =>
                                isPortalConversationNote(note, customerName)
                              );
                              const emailNotes = [
                                ...(emailConversation[ticket.id] || []),
                              ].reverse();
                              const channel = conversationChannel;
                              const notes =
                                channel === 'portal' ? portalNotes : emailNotes;
                              const conversationPaneBody = (
                                <>
                              {(channel === 'portal' ? notesLoading : emailConversationLoading) ? (
                                <p className="mb-2 text-[11px] text-neutral-400">
                                  Loading…
                                </p>
                              ) : null}
                              {channel === 'email' && emailConversationError ? (
                                <p className="mb-2 text-xs text-rose-600">
                                  {emailConversationError}
                                </p>
                              ) : null}
                              {notes.length === 0 ? (
                                <div className="rounded-xl border-[0.6px] border-[#bfbfbf] bg-neutral-50 px-3.5 py-6 text-center">
                                  <p className="text-sm text-neutral-600">
                                    {channel === 'portal'
                                      ? 'No portal chat for this ticket'
                                      : 'No email for this ticket'}
                                  </p>
                                  <p className="mt-1 text-[11px] text-neutral-400">
                                    {channel === 'portal'
                                      ? 'Messages from the support portal chat show here.'
                                      : 'Email bot, customer, and agent replies for this customer show here.'}
                                  </p>
                                </div>
                              ) : channel === 'portal' ? (
                                <PortalConversationThread
                                  notes={notes}
                                  customerName={customerName}
                                />
                              ) : (
                                <div className="space-y-6 pb-2">
                                  {groupEmailNotesBySubject(notes).map((thread) => (
                                    <section key={thread.key} className="relative space-y-3">
                                      <p
                                        className="sticky top-0 z-10 min-w-0 truncate rounded-lg border-b border-[#e5e5e5]/90 bg-white/95 px-3 py-2 text-sm leading-5 shadow-[0_1px_0_rgba(0,0,0,0.04)] ring-1 ring-inset ring-[#bfbfbf]/80 backdrop-blur-sm supports-[backdrop-filter]:bg-white/90"
                                        title={thread.label}
                                      >
                                        <span className="font-semibold text-[#111111]">
                                          Subject:
                                        </span>{' '}
                                        <span className="text-[#171717]">{thread.label}</span>
                                      </p>
                                      <ul className="space-y-3">
                                        {thread.notes.map((note) => {
                                          const received = noteIsReceived(
                                            note,
                                            customerName
                                          );
                                          const isBot = note.role === 'bot';
                                          const isAgent = note.role === 'agent';
                                          const emailRole = isBot
                                            ? 'Bot'
                                            : isAgent
                                              ? 'Agent'
                                              : 'Customer';
                                          const cardSurface = received
                                            ? 'border-[0.6px] border-[#bfbfbf] border-l-[3px] border-l-sky-500 bg-sky-50/35'
                                            : isBot
                                              ? 'border-[0.6px] border-amber-200/90 border-l-[3px] border-l-amber-500 bg-amber-50/45'
                                              : 'border-[0.6px] border-[#bfbfbf] border-l-[3px] border-l-[#171717] bg-white';
                                          const roleBadge = received
                                            ? 'bg-sky-100 text-sky-900'
                                            : isBot
                                              ? 'bg-amber-100 text-amber-950'
                                              : 'bg-neutral-200/90 text-neutral-800';
                                          return (
                                            <li
                                              key={note.id}
                                              className={`rounded-xl px-4 py-3.5 shadow-none ${cardSurface}`}
                                            >
                                              <div className="mb-2.5 flex items-start justify-between gap-3 border-b border-[#e5e5e5]/80 pb-2.5">
                                                <div className="flex min-w-0 items-start gap-2.5">
                                                  <span
                                                    className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${
                                                      received
                                                        ? 'bg-sky-100 text-sky-900'
                                                        : isBot
                                                          ? 'bg-amber-100 text-amber-950'
                                                          : 'bg-[#111111] text-white'
                                                    }`}
                                                  >
                                                    {initialsFromName(note.author)}
                                                  </span>
                                                  <div className="min-w-0">
                                                    <p className="truncate text-[14px] font-semibold text-[#171717]">
                                                      {note.author}
                                                    </p>
                                                    <p className="truncate text-[12px] text-neutral-500">
                                                      {emailRole} · email
                                                    </p>
                                                  </div>
                                                </div>
                                                <div className="flex shrink-0 flex-col items-end gap-1">
                                                  <span
                                                    className={`rounded-md px-1.5 py-px text-[11px] font-medium ${roleBadge}`}
                                                  >
                                                    {received ? 'Received' : 'Sent'}
                                                  </span>
                                                  <span className="tabular-nums text-[11px] text-[#a3a3a3]">
                                                    {formatConversationTimestamp(note)}
                                                  </span>
                                                </div>
                                              </div>
                                              <p className="whitespace-pre-wrap text-[14px] leading-6 text-[#171717] select-text">
                                                {note.text}
                                              </p>
                                            </li>
                                          );
                                        })}
                                      </ul>
                                    </section>
                                  ))}
                                </div>
                              )}
                                </>
                              );
                              return (
                                <>
                            <div className="mb-3 flex shrink-0 items-center justify-between gap-2">
                              <SegmentTabs
                                ariaLabel="Conversation channel"
                                alwaysShowIcons
                                value={conversationChannel}
                                onChange={setConversationChannel}
                                options={[
                                  {
                                    id: 'email',
                                    label: 'Email',
                                    icon: <Mail />,
                                    count: emailNotes.length,
                                  },
                                  {
                                    id: 'portal',
                                    label: 'Portal',
                                    icon: <MessageSquare />,
                                    count: portalNotes.length,
                                  },
                                ]}
                              />
                              <button
                                type="button"
                                onClick={() => setConversationExpanded(true)}
                                className="inline-flex size-[32px] shrink-0 items-center justify-center rounded-lg border-[0.6px] border-[#bfbfbf] bg-white text-neutral-600 shadow-none hover:bg-neutral-50"
                                title="Expand conversation"
                                aria-label="Expand conversation"
                              >
                                <Maximize2 className="size-[16px] stroke-[2.25]" />
                              </button>
                            </div>
                            <div
                              ref={notesListRef}
                              onScroll={(e) => {
                                const el = e.currentTarget;
                                if (el.scrollHeight <= el.clientHeight) return;
                                setNotesListScrolling(true);
                                if (notesListScrollTimerRef.current != null) {
                                  window.clearTimeout(notesListScrollTimerRef.current);
                                }
                                notesListScrollTimerRef.current = window.setTimeout(
                                  () => setNotesListScrolling(false),
                                  650
                                );
                              }}
                              className={`min-h-0 flex-1 overflow-y-auto overflow-x-hidden [scrollbar-width:thin] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent ${
                                notesListScrolling
                                  ? '[scrollbar-color:#d4d4d4_transparent] [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-neutral-300'
                                  : '[scrollbar-color:transparent_transparent] [&::-webkit-scrollbar-thumb]:bg-transparent'
                              }`}
                            >
                              {conversationPaneBody}
                            </div>
                            {conversationExpanded ? (
                              <div
                                className="fixed inset-0 z-[120] grid place-items-center bg-black/40 px-4 backdrop-blur-[2px]"
                                role="dialog"
                                aria-modal="true"
                                aria-labelledby="ticket-conversation-expanded-title"
                                onClick={() => setConversationExpanded(false)}
                              >
                                <div
                                  className="flex w-full max-w-3xl max-h-[min(85svh,720px)] flex-col overflow-hidden rounded-3xl border border-neutral-200 bg-white p-6 shadow-xl sm:p-8"
                                  onClick={(event) => event.stopPropagation()}
                                >
                                  <div className="mb-4 flex shrink-0 items-start justify-between gap-3">
                                    <p className="text-[10px] font-semibold uppercase tracking-wider text-neutral-400">
                                      Conversation
                                    </p>
                                    <button
                                      type="button"
                                      onClick={() => setConversationExpanded(false)}
                                      className="text-xs font-semibold text-neutral-500 hover:text-neutral-900"
                                    >
                                      Close
                                    </button>
                                  </div>
                                  <div className="mb-4 shrink-0 space-y-2">
                                    <span
                                      className="inline-flex rounded-full border border-neutral-200 bg-neutral-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-neutral-600"
                                    >
                                      {channel === 'portal' ? 'Portal' : 'Email'}
                                    </span>
                                    <h2
                                      id="ticket-conversation-expanded-title"
                                      className="text-lg font-semibold tracking-tight text-[#111111] sm:text-xl"
                                    >
                                      {ticket.id}
                                      {ticket.subject ? ` · ${ticket.subject}` : ''}
                                    </h2>
                                  </div>
                                  <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden pr-1 [scrollbar-width:thin]">
                                    {conversationPaneBody}
                                  </div>
                                </div>
                              </div>
                            ) : null}
                                </>
                              );
                            })()}
                          </div>
                      ) : detailTab === 'notes' ? (
                          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                            <div className="min-h-0 flex-1 space-y-2 overflow-y-auto [scrollbar-width:thin]">
                              {(() => {
                                const staffNotes = toTicketStaffNotes(
                                  ticketNotes[ticket.id] || []
                                );
                                if (staffNotes.length === 0) {
                                  return (
                                    <div className="rounded-xl border-[0.6px] border-[#bfbfbf] bg-neutral-50 px-3.5 py-6 text-center">
                                      <p className="text-sm text-neutral-600">
                                        No ticket notes yet
                                      </p>
                                      <p className="mt-1 text-[11px] text-neutral-400">
                                        Notes about this ticket are visible to anyone who opens it.
                                      </p>
                                    </div>
                                  );
                                }
                                return (
                                  <ul className="space-y-2">
                                    {staffNotes.map((note) => {
                                      const canEditNote = staffNoteEditableBy(
                                        note,
                                        currentUser.id,
                                        canMutate
                                      );
                                      const canDeleteNote = staffNoteDeletableBy(
                                        note,
                                        currentUser.id,
                                        currentUser.role,
                                        canMutate
                                      );
                                      const isEditing = editingNoteId === note.id;
                                      const displayTime = note.editedAt
                                        ? note.editedTime || note.time
                                        : note.time;
                                      const authorRole = staffNoteAuthorRole(
                                        note,
                                        noteStaff,
                                        currentUser
                                      );
                                      return (
                                      <li
                                        key={note.id}
                                        className="rounded-xl border-[0.6px] border-[#bfbfbf] bg-neutral-50 px-3 py-2.5"
                                      >
                                        <div className="mb-1 flex items-center justify-between gap-2">
                                          <span className="min-w-0 truncate text-[14px] font-semibold text-[#171717]">
                                            {note.author}
                                            {authorRole ? (
                                              <span className="font-normal text-[12px] text-neutral-500">
                                                {' '}
                                                · {authorRole}
                                              </span>
                                            ) : null}
                                          </span>
                                          <div className="flex shrink-0 items-center gap-1.5">
                                            {canEditNote && !isEditing ? (
                                              <button
                                                type="button"
                                                title="Edit note"
                                                onClick={() => {
                                                  setEditingNoteId(note.id);
                                                  setEditNoteText(note.text);
                                                  setNoteEditError(null);
                                                }}
                                                className="inline-flex size-[18px] items-center justify-center rounded-md text-neutral-400 hover:text-[#171717]"
                                              >
                                                <Pencil className="h-[18px] w-[18px] stroke-[2.25]" />
                                              </button>
                                            ) : null}
                                            {canDeleteNote && !isEditing ? (
                                              <button
                                                type="button"
                                                title="Delete note"
                                                onClick={() =>
                                                  void deleteNote(ticket.id, note.id)
                                                }
                                                className="inline-flex size-[18px] items-center justify-center rounded-md text-neutral-400 hover:text-[#171717]"
                                              >
                                                <Trash2 className="h-[18px] w-[18px] stroke-[2.25]" />
                                              </button>
                                            ) : null}
                                            {canMutate ? (
                                              <button
                                                type="button"
                                                title={
                                                  note.pinned
                                                    ? 'Unpin note'
                                                    : 'Pin note'
                                                }
                                                onClick={() =>
                                                  void toggleNotePin(
                                                    ticket.id,
                                                    note.id,
                                                    !note.pinned
                                                  )
                                                }
                                                className={`inline-flex size-[18px] items-center justify-center rounded-md ${
                                                  note.pinned
                                                    ? 'text-[#171717]'
                                                    : 'text-neutral-400 hover:text-[#171717]'
                                                }`}
                                              >
                                                <Pin
                                                  className={`h-[18px] w-[18px] stroke-[2.25] ${
                                                    note.pinned
                                                      ? 'fill-[#171717]'
                                                      : ''
                                                  }`}
                                                />
                                              </button>
                                            ) : note.pinned ? (
                                              <Pin className="h-[18px] w-[18px] fill-[#171717] stroke-[2.25] text-[#171717]" />
                                            ) : null}
                                          </div>
                                        </div>
                                        {isEditing ? (
                                          <div className="space-y-2">
                                            <div className="relative">
                                              {noteMentionFilter != null &&
                                              noteMentionTarget === 'edit' ? (
                                                <NoteMentionMenu
                                                  hits={noteMentionHits}
                                                  activeIndex={noteMentionIndex}
                                                  onPick={applyNoteMention}
                                                />
                                              ) : null}
                                            <textarea
                                              ref={editNoteComposerRef}
                                              rows={3}
                                              value={editNoteText}
                                              onChange={(e) => {
                                                setEditNoteText(e.target.value);
                                                refreshNoteMention(
                                                  e.target.value,
                                                  e.target.selectionStart ?? e.target.value.length,
                                                  'edit'
                                                );
                                                if (noteEditError) setNoteEditError(null);
                                              }}
                                              onClick={(e) =>
                                                refreshNoteMention(
                                                  e.currentTarget.value,
                                                  e.currentTarget.selectionStart ?? 0,
                                                  'edit'
                                                )
                                              }
                                              onKeyDown={(e) => {
                                                if (noteMentionFilter != null && noteMentionHits.length) {
                                                  if (e.key === 'ArrowDown') {
                                                    e.preventDefault();
                                                    setNoteMentionIndex(
                                                      (i) => (i + 1) % noteMentionHits.length
                                                    );
                                                    return;
                                                  }
                                                  if (e.key === 'ArrowUp') {
                                                    e.preventDefault();
                                                    setNoteMentionIndex(
                                                      (i) =>
                                                        (i - 1 + noteMentionHits.length) %
                                                        noteMentionHits.length
                                                    );
                                                    return;
                                                  }
                                                  if (e.key === 'Enter' || e.key === 'Tab') {
                                                    e.preventDefault();
                                                    applyNoteMention(
                                                      noteMentionHits[noteMentionIndex]?.name ||
                                                        noteMentionHits[0].name
                                                    );
                                                    return;
                                                  }
                                                  if (e.key === 'Escape') {
                                                    e.preventDefault();
                                                    setNoteMentionFilter(null);
                                                    return;
                                                  }
                                                }
                                                if (
                                                  e.key === 'Enter' &&
                                                  !e.shiftKey &&
                                                  editNoteText.trim() &&
                                                  !savingNoteEdit
                                                ) {
                                                  e.preventDefault();
                                                  void saveNoteEdit(ticket.id, note.id);
                                                }
                                              }}
                                              className="w-full resize-none rounded-lg border-[0.6px] border-[#bfbfbf] bg-white px-2.5 py-2 text-[14px] leading-5 text-[#171717] outline-none focus:border-neutral-400"
                                            />
                                            </div>
                                            {noteEditError ? (
                                              <p className="text-[12px] font-medium text-rose-600">
                                                {noteEditError}
                                              </p>
                                            ) : null}
                                            <div className="flex items-center gap-2">
                                              <button
                                                type="button"
                                                disabled={!editNoteText.trim() || savingNoteEdit}
                                                onClick={() =>
                                                  void saveNoteEdit(ticket.id, note.id)
                                                }
                                                className="h-[38px] rounded-lg bg-[#171717] px-3 text-[13px] font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
                                              >
                                                {savingNoteEdit ? 'Saving…' : 'Save'}
                                              </button>
                                              <button
                                                type="button"
                                                disabled={savingNoteEdit}
                                                onClick={() => {
                                                  setEditingNoteId(null);
                                                  setEditNoteText('');
                                                  setNoteEditError(null);
                                                }}
                                                className="h-[38px] rounded-lg px-3 text-[13px] font-medium text-neutral-600 hover:text-[#171717]"
                                              >
                                                Cancel
                                              </button>
                                            </div>
                                          </div>
                                        ) : (
                                          <div className="flex items-start justify-between gap-3">
                                            <p className="min-w-0 flex-1 whitespace-pre-wrap text-[14px] leading-5 text-[#171717] select-text">
                                              {noteTextWithMentions(note.text, mentionNames)}
                                            </p>
                                            <span className="shrink-0 pt-0.5 tabular-nums text-[11px] leading-4 text-[#a3a3a3]">
                                              {note.editedAt
                                                ? `Edited · ${displayTime}`
                                                : displayTime}
                                            </span>
                                          </div>
                                        )}
                                      </li>
                                      );
                                    })}
                                  </ul>
                                );
                              })()}
                            </div>
                            <div className="mt-[30px] shrink-0 space-y-2">
                              {noteSentFor === ticket.id ? (
                                  <p className="text-sm font-medium text-emerald-600">
                                    Ticket note saved
                                  </p>
                                ) : notePostError ? (
                                  <p className="text-sm font-medium text-rose-600">
                                    {notePostError}
                                  </p>
                                ) : null}
                              {canMutate ? (
                                <form
                                  onSubmit={(e) => {
                                    e.preventDefault();
                                    if (newNoteText.trim() && !postingNote) {
                                      postNote(ticket.id);
                                    }
                                  }}
                                  className="relative grid h-[46px] grid-cols-[minmax(0,1fr)_38px] items-center gap-1 overflow-visible rounded-full border-[0.6px] border-[#bfbfbf] bg-[#fafafa] px-1.5 focus-within:border-neutral-400 focus-within:bg-white"
                                >
                                  {noteMentionFilter != null &&
                                  noteMentionTarget === 'new' ? (
                                    <NoteMentionMenu
                                      hits={noteMentionHits}
                                      activeIndex={noteMentionIndex}
                                      onPick={applyNoteMention}
                                    />
                                  ) : null}
                              <textarea
                                    ref={newNoteComposerRef}
                                    rows={1}
                                placeholder="Add a ticket note…"
                                value={newNoteText}
                                onChange={(e) => {
                                  setNewNoteText(e.target.value);
                                  refreshNoteMention(
                                    e.target.value,
                                    e.target.selectionStart ?? e.target.value.length,
                                    'new'
                                  );
                                  if (notePostError) setNotePostError(null);
                                  if (noteSentFor) setNoteSentFor(null);
                                }}
                                onClick={(e) =>
                                  refreshNoteMention(
                                    e.currentTarget.value,
                                    e.currentTarget.selectionStart ?? 0,
                                    'new'
                                  )
                                }
                                onKeyDown={(e) => {
                                  if (noteMentionFilter != null && noteMentionHits.length) {
                                    if (e.key === 'ArrowDown') {
                                      e.preventDefault();
                                      setNoteMentionIndex(
                                        (i) => (i + 1) % noteMentionHits.length
                                      );
                                      return;
                                    }
                                    if (e.key === 'ArrowUp') {
                                      e.preventDefault();
                                      setNoteMentionIndex(
                                        (i) =>
                                          (i - 1 + noteMentionHits.length) %
                                          noteMentionHits.length
                                      );
                                      return;
                                    }
                                    if (e.key === 'Enter' || e.key === 'Tab') {
                                      e.preventDefault();
                                      applyNoteMention(
                                        noteMentionHits[noteMentionIndex]?.name ||
                                          noteMentionHits[0].name
                                      );
                                      return;
                                    }
                                    if (e.key === 'Escape') {
                                      e.preventDefault();
                                      setNoteMentionFilter(null);
                                      return;
                                    }
                                  }
                                  if (
                                    e.key === 'Enter' &&
                                    !e.shiftKey &&
                                    newNoteText.trim() &&
                                    !postingNote
                                  ) {
                                    e.preventDefault();
                                    postNote(ticket.id);
                                  }
                                }}
                                    className="col-start-1 row-start-1 min-h-5 w-full resize-none overflow-hidden border-0 bg-transparent py-1.5 pl-2 text-sm leading-5 text-[#171717] shadow-none outline-none placeholder:text-[#a3a3a3] focus:!border-transparent focus:!shadow-none"
                              />
                              <button
                                    type="submit"
                                    title="Save ticket note"
                                disabled={!newNoteText.trim() || postingNote}
                                    className="col-start-2 row-start-1 inline-flex size-[38px] shrink-0 items-center justify-center rounded-full bg-[#171717] text-white shadow-[0_2px_8px_rgba(0,0,0,0.18)] hover:bg-neutral-800 disabled:opacity-50 disabled:shadow-none"
                              >
                                    <ArrowUp className="size-[18px] stroke-[2.25] text-white" />
                              </button>
                                </form>
                              ) : null}
                            </div>
                          </div>
                      ) : detailTab === 'activities' ? (
                          <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden [scrollbar-width:thin]">
                          <div className="relative pl-4">
                            <div className="absolute left-[5px] top-2 bottom-2 w-px bg-neutral-200" />
                            <ul className="space-y-3">
                              {(() => {
                                const opened = formatTicketWhen(ticket.createdAt);
                                return (
                                  <li className="relative">
                                    <span className="absolute -left-4 mt-1.5 h-2.5 w-2.5 rounded-full border-2 border-white bg-neutral-300 ring-1 ring-neutral-200" />
                                    <div className="min-w-0 rounded-lg border-[0.6px] border-[#bfbfbf] bg-neutral-50 px-3 py-2">
                                      <p className="text-sm text-neutral-800">
                                        Opened via{' '}
                                        <span className="font-semibold">
                                          {ticket.channel}
                                        </span>
                                      </p>
                                      <p
                                        className="text-[11px] text-neutral-400 mt-0.5"
                                        title={opened.absolute}
                                      >
                                        {opened.relative}
                                      </p>
                                    </div>
                                  </li>
                                );
                              })()}

                              {ticket.assignee !== 'Unassigned' && (
                                <li className="relative">
                                  <span className="absolute -left-4 mt-1.5 h-2.5 w-2.5 rounded-full border-2 border-white bg-[#111111] ring-1 ring-neutral-300" />
                                  <div className="min-w-0 rounded-lg border-[0.6px] border-[#bfbfbf] bg-neutral-50 px-3 py-2">
                                    <p className="text-sm text-neutral-800">
                                      Assigned to{' '}
                                      <span className="font-semibold">
                                        {ticket.assignee}
                                      </span>
                                    </p>
                                    <p className="text-[11px] text-neutral-400 mt-0.5">
                                      {ticket.status === 'Pending' ||
                                      ticket.status === 'In Progress'
                                        ? 'In Progress'
                                        : ticket.status}
                                    </p>
                          </div>
                                </li>
                              )}

                              {(ticketProgress?.history || []).map((h, idx) => (
                                <li
                                  key={`${h.at}-${idx}`}
                                  className="relative"
                                >
                                  <span className="absolute -left-4 mt-1.5 h-2.5 w-2.5 rounded-full border-2 border-white bg-sky-500 ring-1 ring-sky-200" />
                                  <div className="min-w-0 rounded-lg border-[0.6px] border-[#bfbfbf] bg-neutral-50 px-3 py-2">
                                    <p className="text-sm text-neutral-800">
                                      {h.label}
                                      {h.actor ? (
                                        <span className="text-neutral-500">
                                          {' '}
                                          · {h.actor}
                                        </span>
                                      ) : null}
                                    </p>
                                    <p
                                      className="text-[11px] text-neutral-400 mt-0.5 tabular-nums"
                                      title={h.at}
                                    >
                                      {h.relative}
                                    </p>
                          </div>
                                </li>
                              ))}
                            </ul>
                          </div>
                          </div>
                      ) : (
                          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden">
                            {canMutate ? (
                              <div
                                className={`rounded-xl border-[0.6px] border-dashed px-4 py-4 ${
                                  attachDragOver
                                    ? 'border-[#171717] bg-neutral-50'
                                    : 'border-[#bfbfbf] bg-white'
                                }`}
                                onDragEnter={(e) => {
                                  e.preventDefault();
                                  setAttachDragOver(true);
                                }}
                                onDragOver={(e) => {
                                  e.preventDefault();
                                  setAttachDragOver(true);
                                }}
                                onDragLeave={(e) => {
                                  e.preventDefault();
                                  if (e.currentTarget.contains(e.relatedTarget as Node)) {
                                    return;
                                  }
                                  setAttachDragOver(false);
                                }}
                                onDrop={(e) => {
                                  e.preventDefault();
                                  setAttachDragOver(false);
                                  void uploadTicketFiles(ticket.id, e.dataTransfer.files);
                                }}
                              >
                                <input
                                  id="ticket-attach-input"
                                  ref={attachInputRef}
                                  type="file"
                                  multiple
                                  className="sr-only"
                                  accept="image/*,.pdf,.doc,.docx,.txt,.csv,.xlsx,.zip"
                                  onChange={(e) => {
                                    void uploadTicketFiles(ticket.id, e.target.files);
                                    e.target.value = '';
                                  }}
                                />
                                <div className="flex flex-col items-center gap-3 text-center sm:flex-row sm:text-left">
                                  <span className="inline-flex size-[38px] shrink-0 items-center justify-center rounded-xl bg-neutral-100 text-[#171717]">
                                    <Upload className="h-[18px] w-[18px] stroke-[2.25]" />
                                  </span>
                                  <div className="min-w-0 flex-1">
                                    <p className="text-sm font-semibold text-[#171717]">
                                      Add files to this ticket
                                    </p>
                                    <p className="mt-0.5 text-xs text-neutral-500">
                                      Drop files here or choose up to 10. Images, PDF, and office files. 15 MB each.
                                    </p>
                                  </div>
                                  <label
                                    htmlFor="ticket-attach-input"
                                    className={`inline-flex h-[38px] shrink-0 cursor-pointer items-center justify-center rounded-xl border-[0.6px] border-[#bfbfbf] bg-[#111111] px-4 text-sm font-semibold text-white hover:bg-neutral-800 ${
                                      attachBusy ? 'pointer-events-none opacity-50' : ''
                                    }`}
                                  >
                                    {attachBusy ? 'Saving…' : 'Add files'}
                                  </label>
                                </div>
                              </div>
                            ) : null}
                            {attachError ? (
                              <p className="text-xs text-rose-600">{attachError}</p>
                            ) : null}
                            <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden [scrollbar-width:thin]">
                            {(ticket.attachments || []).length === 0 ? (
                              <div className="rounded-xl border-[0.6px] border-[#bfbfbf] bg-neutral-50 px-3.5 py-8 text-center">
                                <Paperclip className="mx-auto h-[18px] w-[18px] stroke-[2.25] text-neutral-400" />
                                <p className="mt-2 text-sm text-neutral-600">
                                  No attachments yet
                                </p>
                                {canMutate ? (
                                  <p className="mt-1 text-xs text-neutral-500">
                                    Files you add here stay on this ticket for the team.
                                  </p>
                                ) : null}
                              </div>
                            ) : (
                              <ul
                                className={`grid grid-cols-1 gap-3 sm:grid-cols-2 @3xl:grid-cols-3 @6xl:grid-cols-4 ${
                                  contentFullPage ? '@3xl:gap-4' : ''
                                }`}
                              >
                                {(ticket.attachments || []).map((url) => (
                                  <li
                                    key={url}
                                    className="flex min-w-0 flex-col overflow-hidden rounded-xl border-[0.6px] border-[#bfbfbf] bg-white shadow-none"
                                  >
                                    {(() => {
                                      const kind = ticketFileKind(url);
                                      const frame =
                                        'relative block w-full min-h-[10rem] overflow-hidden bg-neutral-50 aspect-[16/10] @3xl:min-h-[12rem] @6xl:min-h-[14rem]';
                                      if (kind === 'image') {
                                        return (
                                      <a href={url} target="_blank" rel="noreferrer" className={frame}>
                                        <img
                                          src={url}
                                          alt=""
                                          className="h-full w-full bg-neutral-50 object-contain"
                                        />
                                      </a>
                                        );
                                      }
                                      if (kind === 'pdf' || kind === 'text') {
                                        return (
                                          <a
                                            href={url}
                                            target="_blank"
                                            rel="noreferrer"
                                            className={frame}
                                          >
                                            <iframe
                                              src={
                                                kind === 'pdf'
                                                  ? `${url}#toolbar=0&navpanes=0&scrollbar=0`
                                                  : url
                                              }
                                              title={ticketFileLabel(url)}
                                              className="pointer-events-none h-full w-full border-0"
                                            />
                                          </a>
                                        );
                                      }
                                      if (kind === 'docx') {
                                        return (
                                          <a
                                            href={url}
                                            target="_blank"
                                            rel="noreferrer"
                                            className={frame}
                                          >
                                            <TicketDocxPreview
                                              url={url}
                                              label={ticketFileLabel(url)}
                                            />
                                          </a>
                                        );
                                      }
                                      const ext = ticketFileExt(url);
                                      return (
                                      <a
                                        href={url}
                                        target="_blank"
                                        rel="noreferrer"
                                        className={`${frame} flex flex-col items-center justify-center gap-2 text-neutral-500`}
                                      >
                                        <Paperclip className="h-[18px] w-[18px] stroke-[2.25]" />
                                          {ext ? (
                                            <span className="text-[11px] font-semibold uppercase tracking-wide text-neutral-600">
                                              {ext}
                                            </span>
                                          ) : null}
                                      </a>
                                      );
                                    })()}
                                    <div className="flex items-center gap-2 border-t-[0.6px] border-[#bfbfbf] px-3 py-2.5">
                                      <p
                                        className="min-w-0 flex-1 truncate text-sm text-[#171717]"
                                        title={ticketFileLabel(url)}
                                      >
                                        {ticketFileLabel(url)}
                                      </p>
                                      <a
                                        href={url}
                                        download={ticketFileLabel(url)}
                                        className="inline-flex size-[38px] items-center justify-center rounded-xl border-[0.6px] border-[#bfbfbf] text-[#171717] hover:bg-neutral-50"
                                        aria-label={`Download ${ticketFileLabel(url)}`}
                                      >
                                        <Download className="h-[18px] w-[18px] stroke-[2.25]" />
                                      </a>
                                      {canMutate ? (
                                        <button
                                          type="button"
                                          disabled={attachBusy}
                                          onClick={() =>
                                            void persistTicketFiles(
                                              ticket.id,
                                              (ticket.attachments || []).filter(
                                                (item) => item !== url
                                              ),
                                              true
                                            )
                                          }
                                          className="inline-flex size-[38px] items-center justify-center rounded-xl border-[0.6px] border-[#bfbfbf] text-[#171717] hover:bg-neutral-50 disabled:opacity-50"
                                          aria-label={`Remove ${ticketFileLabel(url)}`}
                                        >
                                          <Trash2 className="h-[18px] w-[18px] stroke-[2.25]" />
                                        </button>
                            ) : null}
                          </div>
                                  </li>
                                ))}
                              </ul>
                            )}
                        </div>
                      </div>
                          )}
                        </div>

                    {/* Side rail */}
                    <aside className="min-h-0 min-w-0 space-y-3.5 overflow-y-auto bg-neutral-50/50 p-4 sm:p-5 [scrollbar-width:thin]">
                      <div className="rounded-xl border-[0.6px] border-[#bfbfbf] bg-white p-4 shadow-none">
                        {(() => {
                          const profile = customer360?.customer;
                          const ticketEmail = String(ticket.customerEmail || '')
                            .trim()
                            .toLowerCase();
                          const profileEmail = String(profile?.email || '')
                            .trim()
                            .toLowerCase();
                          const sameCustomer =
                            Boolean(ticketEmail) &&
                            Boolean(profileEmail) &&
                            ticketEmail === profileEmail;
                          const name = String(
                            ticket.customerName || (sameCustomer ? profile?.name : '') || ''
                          ).trim();
                          const email = String(
                            ticket.customerEmail || (sameCustomer ? profile?.email : '') || ''
                          ).trim();
                          const phone = String(
                            ticket.customerPhone || (sameCustomer ? profile?.phone : '') || ''
                          ).trim();
                          const created = String(
                            sameCustomer ? profile?.createdAt || '' : ''
                          )
                            .trim()
                            .slice(0, 10);
                          const initials = name
                            ? name
                                .split(' ')
                                .map((n) => n[0])
                                .join('')
                                .slice(0, 2)
                            : '—';
                          const rows: Array<{
                            label: string;
                            value: React.ReactNode;
                          }> = [
                            {
                              label: 'Email',
                              value: email ? (
                                <a
                                  href={`mailto:${email}`}
                                  className="break-all text-[#171717] hover:underline"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  {email}
                                </a>
                              ) : (
                                '—'
                              ),
                            },
                            { label: 'Phone', value: phone || '—' },
                            { label: 'Created at', value: created || '—' },
                          ];
                          return (
                            <>
                              <p className="inline-flex items-center gap-2 text-[14px] font-semibold text-[#171717]">
                                <User className="h-[18px] w-[18px] stroke-[2.25] text-neutral-500" />
                                Customer
                              </p>
                              <div className="mt-4 flex items-center gap-3">
                                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-sky-100 text-sm font-bold text-sky-800">
                                  {initials}
                                </div>
                                <p className="min-w-0 break-words text-[14px] font-semibold text-[#171717]">
                                  {name || '—'}
                                </p>
                              </div>
                              <ul className="mt-4">
                                {rows.map((row) => (
                                  <li
                                    key={row.label}
                                    className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-3 py-1.5 text-[14px] leading-5 text-[#171717]"
                                  >
                                    <span className="whitespace-nowrap text-neutral-500">
                                      {row.label}
                                    </span>
                                    <span className="min-w-0 text-left break-words">{row.value}</span>
                                </li>
                              ))}
                            </ul>
                          </>
                          );
                        })()}
                      </div>

                      {(customer360?.orders || []).length > 0 ? (
                        <div className="rounded-xl border-[0.6px] border-[#bfbfbf] bg-white shadow-none">
                          <button
                            type="button"
                            aria-expanded={orderDetailsOpen}
                            onClick={() => setOrderDetailsOpen((open) => !open)}
                            className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left"
                          >
                            <span className="inline-flex items-center gap-2 text-[14px] font-semibold text-[#171717]">
                              <ShoppingBag className="h-[18px] w-[18px] stroke-[2.25] text-neutral-500" />
                              Order Details
                            </span>
                            <ChevronDown
                              className={`h-[18px] w-[18px] shrink-0 stroke-[2.25] text-neutral-500 transition-transform ${
                                orderDetailsOpen ? 'rotate-180' : ''
                              }`}
                            />
                          </button>
                          {orderDetailsOpen ? (
                          <div className="space-y-4 border-t border-[#e5e5e5] px-4 pb-4 pt-3">
                            {(() => {
                              const orders = customer360?.orders || [];
                              const total = Number.isFinite(Number(customer360?.totalOrders))
                                ? Number(customer360?.totalOrders)
                                : orders.length;
                              const index = Math.min(
                                Math.max(0, orderDetailsIndex),
                                Math.max(0, orders.length - 1)
                              );
                              const order = orders[index];
                              if (!order) return null;
                              const showPager = orders.length > 1;
                              const goPrev = () => {
                                setOrderDetailsDir(-1);
                                setOrderDetailsMotion(true);
                                setOrderDetailsIndex(
                                  (i) => (i - 1 + orders.length) % orders.length
                                );
                              };
                              const goNext = () => {
                                setOrderDetailsDir(1);
                                setOrderDetailsMotion(true);
                                setOrderDetailsIndex((i) => (i + 1) % orders.length);
                              };
                              return (
                                <>
                                  <OrderFieldRow
                                    label="Total orders"
                                    value={String(total)}
                                  />
                                  {(() => {
                                    const productIds = [
                                      ...((ticket.references || [])
                                        .filter((r) => r.type === 'product')
                                        .map((r) => r.id)),
                                      ...(ticket.productId ? [ticket.productId] : []),
                                    ].filter(Boolean);
                                    const unique = [...new Set(productIds)];
                                    if (!unique.length) return null;
                                    const labels = unique.map(
                                      (pid) =>
                                        (order.items || []).find(
                                          (item) =>
                                            item.productId === pid ||
                                            item.sku === pid
                                        )?.name || pid
                                    );
                                    return (
                                      <OrderFieldRow
                                        label={
                                          unique.length > 1
                                            ? 'Ticket products'
                                            : 'Ticket product'
                                        }
                                        value={labels.join(', ')}
                                      />
                                    );
                                  })()}
                                  <div className="overflow-hidden">
                                    <div
                                      key={`${order.orderId || order.orderNumber || index}`}
                                      className={
                                        !orderDetailsMotion
                                          ? undefined
                                          : orderDetailsDir === 1
                                            ? 'order-card-enter-next'
                                            : 'order-card-enter-prev'
                                      }
                                    >
                                      <OrderDetailCard
                                        order={order}
                                        index={index}
                                        fallbackAddress={
                                          customer360?.customer?.defaultAddress
                                        }
                                      />
                                    </div>
                                  </div>
                                  {showPager ? (
                                    <div className="flex items-center justify-between gap-2 pt-1">
                                      <button
                                        type="button"
                                        title="Previous order"
                                        aria-label="Previous order"
                                        onClick={goPrev}
                                        className="inline-flex size-[38px] items-center justify-center rounded-lg text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900"
                                      >
                                        <ChevronLeft className="size-[18px] stroke-[2.25]" />
                                      </button>
                                      <p className="text-[12px] font-medium text-neutral-500">
                                        Order {index + 1} of {orders.length}
                                      </p>
                                      <button
                                        type="button"
                                        title="Next order"
                                        aria-label="Next order"
                                        onClick={goNext}
                                        className="inline-flex size-[38px] items-center justify-center rounded-lg text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900"
                                      >
                                        <ChevronRight className="size-[18px] stroke-[2.25]" />
                                      </button>
                      </div>
                                  ) : null}
                                </>
                              );
                            })()}
                          </div>
                          ) : null}
                        </div>
                      ) : null}

                      {canMutate && ticketClosed ? (
                        <div className="@container min-w-0 rounded-xl border-[0.6px] border-[#bfbfbf] bg-white p-3.5 space-y-2.5 shadow-none">
                          <p className="text-sm font-semibold text-neutral-800">
                            Quick actions
                          </p>
                          <div className="grid min-w-0 grid-cols-1 gap-1.5 @[15rem]:grid-cols-2">
                            <button
                              type="button"
                              onClick={() =>
                                updateTicketAndRefreshSummary(ticket.id, {
                                  status: 'Reopened',
                                })
                              }
                              className="col-span-full h-[38px] w-full min-w-0 px-3 border-[0.6px] border-amber-200 bg-amber-50 hover:bg-amber-100 text-sm font-semibold rounded-lg text-amber-900 inline-flex items-center justify-center gap-1.5 shadow-none"
                            >
                              <RotateCcw className="h-[18px] w-[18px] shrink-0 stroke-[2.25]" />
                              Reopen
                            </button>
                          </div>
                        </div>
                      ) : null}

                      {canMutate && !ticketClosed && (
                        <div className="@container min-w-0 rounded-xl border-[0.6px] border-[#bfbfbf] bg-white p-3.5 space-y-2.5 shadow-none">
                          <p className="text-sm font-semibold text-neutral-800">
                            Quick actions
                          </p>
                          <div className="grid min-w-0 grid-cols-1 gap-1.5 @[15rem]:grid-cols-2">
                            {isResolvedTicketStatus(ticket.status) ? null : (
                              <button
                                type="button"
                                onClick={() =>
                                  updateTicketAndRefreshSummary(ticket.id, {
                                    status: 'Resolved',
                                  })
                                }
                                className="col-span-full h-[38px] w-full min-w-0 px-3 bg-black text-white hover:bg-neutral-800 text-sm font-semibold rounded-lg inline-flex items-center justify-center gap-1.5 shadow-none"
                              >
                                <CheckCircle2 className="h-[18px] w-[18px] shrink-0 stroke-[2.25]" />
                                Resolve
                              </button>
                            )}
                          </div>
                          {currentUser.role !== 'resolver' &&
                            ticket.assignee !== currentUser.name && (
                            <button
                              type="button"
                              onClick={() => {
                                patchRememberedTicket(ticket.id, {
                                  assignee: currentUser.name,
                                });
                                onUpdateTicket(ticket.id, {
                                  assignee: currentUser.name,
                                });
                              }}
                              className="w-full h-[38px] bg-white hover:bg-neutral-50 text-neutral-800 border-[0.6px] border-[#bfbfbf] text-sm font-semibold rounded-lg inline-flex items-center justify-center gap-1.5 shadow-none"
                            >
                              <UserCheck className="h-[18px] w-[18px] stroke-[2.25]" />
                              Assign to me
                            </button>
                          )}
                        </div>
                      )}

                      {canMutate && roster.length > 0 && !ticketClosed && (
                        <div className="@container min-w-0 rounded-xl border-[0.6px] border-[#bfbfbf] bg-white p-3.5 space-y-2.5">
                          <p className="text-sm font-semibold text-neutral-800">
                            {currentUser.role === 'resolver'
                              ? 'Request reassignment'
                              : 'Reassign'}
                          </p>
                          {currentUser.role === 'admin' ? (
                            <>
                              <SegmentTabs
                                stretch
                                stackWhenNarrow
                                ariaLabel="Reassign role"
                                value={reassignSlot}
                                options={[
                                  { id: 'assignee', label: 'Change agent' },
                                  { id: 'resolver', label: 'Set resolver' },
                                ]}
                                onChange={(id) => {
                                  setReassignSlot(id);
                                  setReassignPick('');
                                }}
                              />
                              <p className="min-w-0 text-xs leading-relaxed break-words text-neutral-500">
                                {reassignSlot === 'assignee' ? (
                                  <>
                                    Agent now:{' '}
                                    <span className="font-medium text-neutral-700">
                                      {ticket.assignee &&
                                      ticket.assignee !== 'Unassigned'
                                        ? ticket.assignee
                                        : 'Unassigned'}
                                    </span>
                                    . Pick another agent or admin to own the ticket.
                                  </>
                                ) : (
                                  <>
                                    Resolver now:{' '}
                                    <span className="font-medium text-neutral-700">
                                      {ticket.resolver &&
                                      ticket.resolver !== 'Unassigned'
                                        ? ticket.resolver
                                        : 'None'}
                                    </span>
                                    . Pick a resolver; the agent stays the same.
                                  </>
                                )}
                              </p>
                            </>
                          ) : null}
                          <MenuSelect
                            label={
                              currentUser.role === 'admin'
                                ? reassignSlot === 'assignee'
                                  ? 'New agent'
                                  : 'New resolver'
                                : currentUser.role === 'resolver'
                                  ? 'Suggested resolver'
                                  : 'New resolver'
                            }
                            value={
                              expandedTicketId === ticket.id ? reassignPick : ''
                            }
                            placeholder="Select teammate…"
                            minMenuWidth={280}
                            options={[
                              { value: '', label: 'Select teammate…' },
                              ...roster
                                .filter((m) => {
                                  const role = String(m.role || '').toLowerCase();
                                  if (currentUser.role === 'admin') {
                                    if (reassignSlot === 'assignee') {
                                      if (role !== 'agent' && role !== 'admin') {
                                        return false;
                                      }
                                      return m.name !== ticket.assignee;
                                    }
                                    if (role !== 'resolver') return false;
                                    if (
                                      ticket.resolver &&
                                      ticket.resolver !== 'Unassigned' &&
                                      m.name === ticket.resolver
                                    ) {
                                      return false;
                                    }
                                    return true;
                                  }
                                  if (m.name === ticket.assignee) return false;
                                  if (currentUser.role !== 'resolver') return true;
                                  if (
                                    currentUser.id &&
                                    m.id &&
                                    m.id === currentUser.id
                                  ) {
                                    return false;
                                  }
                                  return (
                                    m.name.trim().toLowerCase() !==
                                    currentUser.name.trim().toLowerCase()
                                  );
                                })
                                .map((m) => ({
                                  value: m.name,
                                  label: m.name,
                                  detail: [
                                    m.role || null,
                                    m.skills?.length
                                      ? m.skills.slice(0, 3).join(', ')
                                      : null,
                                  ]
                                    .filter(Boolean)
                                    .join(' · '),
                                })),
                            ]}
                            onChange={setReassignPick}
                          />
                          {currentUser.role === 'resolver' ? (
                            <>
                              <button
                                type="button"
                                disabled={!reassignPick}
                                onClick={() => {
                                  setReassignRequestError('');
                                  setReassignReason('');
                                  setReassignRequestOpen(true);
                                }}
                                className="w-full h-[38px] bg-black hover:bg-neutral-800 disabled:opacity-40 text-white text-sm font-semibold rounded-lg shadow-none"
                              >
                                Request reassignment
                              </button>
                              {reassignRequestOpen ? (
                                <div className="space-y-2 rounded-lg border-[0.6px] border-[#bfbfbf] bg-neutral-50 p-3">
                                  <label className="block text-sm font-medium text-neutral-800">
                                    Reason
                                    <textarea
                                      value={reassignReason}
                                      onChange={(e) =>
                                        setReassignReason(e.target.value)
                                      }
                                      rows={3}
                                      className="mt-1 w-full rounded-lg border-[0.6px] border-[#bfbfbf] bg-white px-3 py-2 text-sm"
                                      placeholder="Why should this ticket move?"
                                    />
                                  </label>
                                  {reassignRequestError ? (
                                    <p className="text-xs text-red-600">
                                      {reassignRequestError}
                                    </p>
                                  ) : null}
                                  <div className="flex gap-2">
                                    <button
                                      type="button"
                                      disabled={
                                        reassignRequestBusy ||
                                        reassignReason.trim().length < 3
                                      }
                                      onClick={async () => {
                                        if (!reassignPick) return;
                                        setReassignRequestBusy(true);
                                        setReassignRequestError('');
                                        try {
                                          const res = await fetch(
                                            `/api/tickets/${encodeURIComponent(ticket.id)}/reassignment-requests`,
                                            {
                                              method: 'POST',
                                              credentials: 'include',
                                              headers: {
                                                'Content-Type': 'application/json',
                                              },
                                              body: JSON.stringify({
                                                resolver: reassignPick,
                                                reason: reassignReason.trim(),
                                              }),
                                            }
                                          );
                                          const body = await res.json().catch(() => ({}));
                                          if (!res.ok) {
                                            throw new Error(
                                              String(body.error || 'Request failed')
                                            );
                                          }
                                          setReassignRequestOpen(false);
                                          setReassignPick('');
                                          setReassignReason('');
                                        } catch (err) {
                                          setReassignRequestError(
                                            err instanceof Error
                                              ? err.message
                                              : 'Request failed'
                                          );
                                        } finally {
                                          setReassignRequestBusy(false);
                                        }
                                      }}
                                      className="h-[38px] flex-1 rounded-lg bg-black text-sm font-semibold text-white disabled:opacity-40"
                                    >
                                      Submit request
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => setReassignRequestOpen(false)}
                                      className="h-[38px] rounded-lg border-[0.6px] border-[#bfbfbf] px-3 text-sm"
                                    >
                                      Cancel
                                    </button>
                                  </div>
                                </div>
                              ) : null}
                            </>
                          ) : (
                            <button
                              type="button"
                              disabled={!reassignPick}
                              onClick={() => {
                                if (!reassignPick) return;
                                const asResolver =
                                  currentUser.role === 'agent' ||
                                  (currentUser.role === 'admin' &&
                                    reassignSlot === 'resolver');
                                if (asResolver) {
                                  patchRememberedTicket(ticket.id, {
                                    resolver: reassignPick,
                                  });
                                  onUpdateTicket(ticket.id, {
                                    resolver: reassignPick,
                                    escalate: true,
                                  });
                                } else {
                                  patchRememberedTicket(ticket.id, {
                                    assignee: reassignPick,
                                  });
                                  onUpdateTicket(ticket.id, {
                                    assignee: reassignPick,
                                  });
                                }
                                setReassignPick('');
                              }}
                              className="w-full h-[38px] bg-black hover:bg-neutral-800 disabled:opacity-40 text-white text-sm font-semibold rounded-lg shadow-none"
                            >
                              {currentUser.role === 'admin'
                                ? reassignSlot === 'assignee'
                                  ? `Assign to ${reassignPick || '…'}`
                                  : `Set resolver to ${reassignPick || '…'}`
                                : `Set resolver to ${reassignPick || '…'}`}
                            </button>
                          )}
                        </div>
                      )}
                    </aside>
                  </div>
                </div>
        </div>
          );
        })()
      ) : (
      <>

      <div className="flex min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden bg-white shadow-none">
      {/* Search + filters toolbar — stays put while the ticket list scrolls */}
      <div className="@container shrink-0 min-w-0 border-b border-[#e5e5e5] bg-neutral-50/70 p-2.5 font-sans">
        <div className="flex items-center justify-between gap-2 mb-2">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <div className="flex items-center gap-1.5 text-[14px] font-semibold text-neutral-500 uppercase tracking-wide shrink-0">
              <Filter className="h-[18px] w-[18px] stroke-[2.25] text-neutral-400" />
              <span>Filters</span>
            </div>
            <span className="text-[14px] font-semibold bg-white px-2.5 py-1 border-[0.6px] border-[#bfbfbf] text-neutral-600 rounded-full shrink-0 normal-case tracking-normal">
              {ticketCountLabel.toLocaleString()} tickets found
            </span>
          </div>
          {(externalCreatorFilter === 'me' || externalAssigneeFilter === 'me' || effectiveStatusFilters.length > 0 || effectivePriorityFilters.length > 0 || effectiveChannelFilters.length > 0 || searchQuery !== '') && (
            <button
              id="clear-all-filters-btn"
              type="button"
              onClick={() => {
                setStatusFilter([]);
                setPriorityFilter([]);
                setChannelFilter([]);
                onSearchQueryChange('');
                onFacetFiltersChange?.({
                  priority: '',
                  status: '',
                  channel: '',
                  creator: '',
                  assignee: '',
                });
              }}
              className="text-[14px] font-semibold text-neutral-500 hover:text-neutral-900"
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
              className="w-full h-[38px] bg-white border-[0.6px] border-[#bfbfbf] py-2 pl-9 pr-8 text-[14px] placeholder-neutral-400 focus:outline-none focus:border-neutral-400 rounded-lg text-black shadow-none"
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

        <div className="grid min-w-0 grid-cols-1 gap-1.5 @[280px]:grid-cols-2 @[640px]:grid-cols-4">
          <FilterDropdown
            id="filter-status-select"
            label="Status"
            multiple
            values={effectiveStatusFilters}
            options={[
              { value: 'All', label: 'All Statuses' },
              ...statusOptions.map((s) => ({ value: s.status, label: s.displayName })),
            ]}
            onChangeValues={(next) => {
              setStatusFilter(next);
              onFacetFiltersChange?.({ status: serializeFacetValues(next) });
            }}
          />
          <FilterDropdown
            id="filter-priority-select"
            label="Priority"
            multiple
            values={effectivePriorityFilters}
            options={[
              { value: 'All', label: 'All Priorities' },
              ...priorityOptions.map((p) => ({ value: p.priority, label: p.displayName })),
              ...effectivePriorityFilters
                .filter(
                  (priority) =>
              !priorityOptions.some(
                      (p) => p.priority.toLowerCase() === priority.toLowerCase()
              )
                )
                .map((priority) => ({ value: priority, label: priority })),
            ]}
            onChangeValues={(next) => {
              setPriorityFilter(next);
              onFacetFiltersChange?.({
                priority: serializeFacetValues(next),
              });
            }}
          />
          <FilterDropdown
            id="filter-channel-select"
            label="Channel"
            multiple
            values={effectiveChannelFilters}
            options={[
              { value: 'All', label: 'All Channels' },
              ...TICKET_CHANNEL_FILTERS,
            ]}
            onChangeValues={(next) => {
              setChannelFilter(next);
              onFacetFiltersChange?.({ channel: serializeFacetValues(next) });
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
        <div className="shrink-0 border-b border-[#e5e5e5] bg-white p-5 space-y-4">
          <div className="relative font-mono">
            <Search className="absolute left-3 top-3 h-4 w-4 text-neutral-400" />
            <input
              id="advanced-search-input"
              type="text"
              placeholder="Search by keyword, Ticket ID, subject, customer name, email..."
              value={searchQuery}
              onChange={(e) => onSearchQueryChange(e.target.value)}
              className="w-full bg-white border border-neutral-200 py-2.5 pl-10 pr-4 text-[14px] placeholder-neutral-400 focus:outline-none focus:border-black rounded-none text-black"
            />
          </div>
        </div>
      )}

        <div
          ref={listScrollRef}
          id="tickets-table"
          className={`min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain [scrollbar-gutter:stable] ${embedded ? '' : 'px-1'}`}
        >
        {sortedTickets.length > 0 ? (
          <ul
            id="tickets-list"
            className={
              contentFullPage
                ? 'grid grid-cols-1 items-stretch gap-4 p-4 min-[480px]:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4'
                : 'divide-y divide-[#e5e5e5]'
            }
          >
            {sortedTickets.map((ticket) => {
              const requester = String(ticket.customerName || '').trim();
              const channel = ticket.channel === 'Web' ? 'Web' : ticket.channel;
              const assignee =
                ticket.assignee &&
                ticket.assignee !== 'Unassigned' &&
                ticket.assignee !== requester
                  ? ticket.assignee
                  : '';
              const meta = [requester, channel, ticket.queue, assignee]
                .filter(Boolean)
                .join(' · ');

              if (contentFullPage) {
                return (
                  <TicketGridCard
                    key={ticket.id}
                    ticket={ticket}
                    meta={meta}
                    requester={requester}
                    priorityText={priorityLabel(ticket.priority)}
                    statusText={statusLabel(ticket.status)}
                    onOpen={() => openTicket(ticket.id)}
                    renderChannelIcon={renderChannelIcon}
                    statusBadgeClass={statusBadgeClass}
                  />
                );
              }

              return (
                <li key={ticket.id} className="min-w-0">
                  <button
                    type="button"
                    onClick={() => openTicket(ticket.id)}
                    className="grid w-full min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 px-4 py-3.5 text-left hover:bg-neutral-50"
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="min-w-14 shrink-0 font-mono text-[14px] font-semibold tabular-nums text-neutral-900">
                        {ticket.id}
                      </span>
                      <span className="min-w-0 truncate text-[14px] font-semibold text-neutral-900">
                        {ticket.subject}
                      </span>
                    </div>
                    <span className="shrink-0 self-center font-mono text-[14px] tabular-nums text-neutral-400">
                      {ticket.updatedAt}
                    </span>
                    <p
                      className="col-start-1 min-w-0 truncate pl-16 text-[14px] text-neutral-500"
                      title={meta}
                    >
                      {meta || '—'}
                    </p>
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="flex flex-col items-center justify-center gap-2 px-4 py-16 text-center">
            <AlertTriangle className="h-5 w-5 shrink-0 text-neutral-700" />
            <p className="max-w-sm break-words text-[14px] font-medium text-neutral-700">
              {listLoading ? (
                'Loading tickets…'
              ) : (
                <>
                  No tickets match the selected filters
                  {searchQuery ? (
                    <>
                      {' '}
                      for <span className="font-semibold">“{searchQuery}”</span>
                    </>
                  ) : null}
                  .
                </>
              )}
            </p>
            {(searchQuery ||
              externalCreatorFilter === 'me' ||
              externalAssigneeFilter === 'me' ||
              effectiveStatusFilters.length > 0 ||
              effectivePriorityFilters.length > 0 ||
              effectiveChannelFilters.length > 0) && (
              <button
                type="button"
                onClick={() => {
                  setStatusFilter([]);
                  setPriorityFilter([]);
                  setChannelFilter([]);
                  onSearchQueryChange('');
                  onFacetFiltersChange?.({
                    priority: '',
                    status: '',
                    channel: '',
                    creator: '',
                    assignee: '',
                  });
                }}
                className="mt-1 h-[38px] rounded-lg border-[0.6px] border-[#bfbfbf] bg-white px-3 text-[14px] font-semibold text-neutral-700 shadow-none hover:bg-neutral-50"
              >
                Clear search & filters
              </button>
            )}
          </div>
        )}

        </div>
        {listTotal != null && listTotal > 0 ? (
          <div className="flex shrink-0 flex-col gap-3 border-t-[0.6px] border-[#bfbfbf] bg-white px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="text-sm font-semibold tabular-nums text-[#171717]">
                {Math.min(listOffset + 1, listTotal).toLocaleString()}
                –
                {(listOffset + tickets.length).toLocaleString()}
                <span className="font-normal text-neutral-500"> of </span>
                {listTotal.toLocaleString()}
              </p>
              <p className="mt-0.5 text-xs text-neutral-500">
                {listTotal.toLocaleString()}{' '}
                {listTotal === 1 ? 'ticket' : 'tickets'} in this view
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={listLoading || listOffset <= 0}
                onClick={() => {
                  if (listLoading || listOffset <= 0) return;
                  onListPageChange?.(Math.max(0, listOffset - listPageSize));
                }}
                className="inline-flex h-[38px] w-[38px] items-center justify-center rounded-xl border-[0.6px] border-[#bfbfbf] bg-white text-[#171717] hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-40"
                aria-label="Previous page"
              >
                <ChevronLeft className="h-[18px] w-[18px]" strokeWidth={2.25} />
              </button>
              <p className="min-w-[7.5rem] text-center text-xs tabular-nums text-neutral-500">
                Page{' '}
                <span className="font-semibold text-[#171717]">
                  {Math.floor(listOffset / listPageSize) + 1}
                </span>
                {' '}of {Math.max(1, Math.ceil(listTotal / listPageSize))}
              </p>
              <button
                type="button"
                disabled={
                  listLoading ||
                  !(listHasMore || listOffset + tickets.length < listTotal)
                }
                onClick={() => {
                  const nextOffset = listOffset + listPageSize;
                  if (listLoading || nextOffset >= listTotal) return;
                  onListPageChange?.(nextOffset);
                }}
                className="inline-flex h-[38px] w-[38px] items-center justify-center rounded-xl border-[0.6px] border-[#bfbfbf] bg-white text-[#171717] hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-40"
                aria-label="Next page"
              >
                <ChevronRight className="h-[18px] w-[18px]" strokeWidth={2.25} />
              </button>
            </div>
          </div>
        ) : null}
      </div>

      {!embedded && (
        <div className="shrink-0 text-[14px] text-neutral-400 px-1 py-1 min-w-0">
          <span className="leading-relaxed break-words">
            Open a ticket to see full progress, notes, SLA, and customer history.
          </span>
        </div>
      )}

      </>
      )}

      </div>
    </PageShell>
  );
}