import React, { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { ArrowUp, Maximize2, Minimize2, Plus, RotateCcw, X } from 'lucide-react';
import CopilotMark from '../layout/CopilotMark';
import {
  askCoworkerAgentTurn,
  mergeCoworkerSessionMemory,
  type CoworkerChatContext,
  type CoworkerSessionMemory,
} from '../../config/coworker';
import { useCoworkerSessionOptional, type CoworkerMessage } from './CoworkerSessionContext';
import { llmGuidedReply } from './llmGuidedReply';
import { applyAgentTurn, optimisticCreateUiActions } from './coworkerActions';
import {
  clearSessionGreetingCache,
  compactStackedAssistantIntros,
  decideModuleGreeting,
  isTransientAssistantFailure,
  LLM_UNAVAILABLE_CHAT,
  sharedSessionGreeting,
  shouldRetryGreeting,
  UNIVERSAL_COWORKER_GREETING_INTENT,
} from './moduleGreetingPolicy';

export type { CoworkerMessage };

/** User-facing Confirm chip text — never show raw propose_* tool ids. */
export function confirmToolChipLabel(toolName: string): string {
  const key = String(toolName || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_');
  const labels: Record<string, string> = {
    propose_create_team: 'Create team',
    create_queue: 'Create team',
    propose_create_ticket: 'Create ticket',
    create_ticket: 'Create ticket',
    propose_create_customer: 'Create customer',
    create_customer: 'Create customer',
    propose_create_kb: 'Create KB article',
    create_kb_article: 'Create KB article',
    draft_kb_article: 'Save KB draft',
    propose_create_macro: 'Create macro',
    create_macro: 'Create macro',
    propose_create_priority: 'Create priority',
    create_priority: 'Create priority',
    propose_create_status: 'Create status',
    create_status: 'Create status',
    propose_delete_priority: 'Delete priority',
    delete_priority: 'Delete priority',
    propose_delete_status: 'Delete status',
    delete_status: 'Delete status',
    propose_delete_team: 'Delete team',
    delete_queue: 'Delete team',
    propose_delete_macro: 'Delete macro',
    delete_macro: 'Delete macro',
  };
  if (labels[key]) return labels[key];
  const stripped = key.replace(/^propose_/, '').replace(/_/g, ' ').trim();
  return stripped || 'action';
}

const COMPOSER_MIN_PX = 20;
const COMPOSER_MAX_PX = 192;

function attachmentFileName(url: string): string {
  return url.split('/').filter(Boolean).pop() || url;
}

function attachmentLooksLikeImage(url: string, name: string): boolean {
  const src = `${url} ${name}`.toLowerCase();
  if (url.startsWith('blob:')) return true;
  return (
    src.includes('.png') ||
    src.includes('.jpg') ||
    src.includes('.jpeg') ||
    src.includes('.gif') ||
    src.includes('.webp')
  );
}

function ChatBubbleAttachments({
  attachments,
  dark,
}: {
  attachments: NonNullable<CoworkerMessage['attachments']>;
  dark?: boolean;
}) {
  if (!attachments.length) return null;
  return (
    <div className={attachments.length === 1 ? 'mb-2' : 'mb-2 grid grid-cols-2 gap-1.5'}>
      {attachments.map((file, idx) => {
        const src = file.preview || file.url;
        const image = Boolean(src) && attachmentLooksLikeImage(src, file.name);
        return (
          <div
            key={`${file.url || file.name}-${idx}`}
            className={`overflow-hidden rounded-xl ${
              dark ? 'bg-white/10' : 'border border-neutral-200 bg-neutral-50'
            }`}
          >
            {image ? (
              <img src={src} alt="" className="max-h-48 w-full object-cover" />
            ) : (
              <div
                className={`px-2.5 py-2 text-[11px] leading-snug ${
                  dark ? 'text-white/90' : 'text-neutral-700'
                }`}
              >
                {file.name}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function syncComposerHeight(el: HTMLTextAreaElement | null): number {
  if (!el) return COMPOSER_MIN_PX;
  el.style.overflowY = 'hidden';
  el.style.height = '0px';
  const next = Math.min(Math.max(el.scrollHeight, COMPOSER_MIN_PX), COMPOSER_MAX_PX);
  el.style.height = `${next}px`;
  if (el.scrollHeight > COMPOSER_MAX_PX) el.style.overflowY = 'auto';
  return next;
}

type CoworkerChatPanelProps = {
  pageLabel: string;
  expanded?: boolean;
  onToggleExpand?: () => void;
  className?: string;
  greetingOverride?: string;
  placeholder?: string;
  suggestionChips?: string[];
  /** Offline fallback when LangGraph agents are unreachable. */
  onUserMessage?: (text: string) => string | null | Promise<string | null>;
  /** Apply structured actions returned by LangGraph /chat (filters, create, etc.). */
  onChatActions?: (
    actions: Record<string, unknown>[],
    meta: { reply: string; agent: string; userText: string }
  ) => void | Promise<void>;
  /**
   * Offline / chrome only. Live field answers go to LangGraph.
   * When true, onUserMessage runs first — return null to fall through.
   */
  handlersFirst?: boolean;
  /** Attach the active LangGraph draft snapshot (awaiting + filled fields). */
  getChatContext?: () => CoworkerChatContext | null;
  onRestart?: () => void;
  /** Unused for live chat — UI routes only via onChatActions. Kept for callers. */
  onAgentRoute?: (agent: string, userText?: string) => void;
  module?: string;
  surface?: string;
  onDraftPatch?: (patch: Record<string, unknown>) => void;
  onToolConfirm?: (
    tool: { name: string; args: Record<string, unknown> }
  ) => boolean | Promise<boolean>;
  /** When set, the composer + button attaches files to the live ticket (not CSV import). */
  onAttachTicketFiles?: (files: FileList) => void | Promise<void>;
  ticketAttachmentUrls?: string[];
  onRemoveTicketAttachment?: (url: string) => void;
};

function greetingIntent(override?: string) {
  return override?.trim() || UNIVERSAL_COWORKER_GREETING_INTENT;
}

function renderInline(text: string, keyPrefix: string): React.ReactNode[] {
  const linkParts = text.split(/(\[[^\]]+\]\([^)]+\))/g);
  return linkParts.flatMap((segment, segIdx) => {
    const linkMatch = segment.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (linkMatch) {
      const label = linkMatch[1];
      const href = linkMatch[2].trim();
      if (href.startsWith('/api/')) {
        return [
          <span key={`${keyPrefix}-lnk-${segIdx}`} className="font-medium text-neutral-900">
            {label}
          </span>,
        ];
      }
      return [
        <a
          key={`${keyPrefix}-lnk-${segIdx}`}
          href={href}
          className="font-medium text-neutral-900 underline decoration-neutral-300 underline-offset-2"
          target="_blank"
          rel="noreferrer"
        >
          {label}
        </a>,
      ];
    }
    const parts = segment.split('**');
    return parts.map((part, i) =>
      i % 2 === 1 ? (
        <strong key={`${keyPrefix}-b-${segIdx}-${i}`} className="font-semibold text-neutral-900">
          {part}
        </strong>
      ) : (
        <React.Fragment key={`${keyPrefix}-t-${segIdx}-${i}`}>{part}</React.Fragment>
      ),
    );
  });
}

function isMarkdownTableRow(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.startsWith('|') && trimmed.endsWith('|') && trimmed.length > 2;
}

function parseMarkdownTableCells(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim());
}

function isMarkdownTableSeparator(line: string): boolean {
  if (!isMarkdownTableRow(line)) return false;
  return parseMarkdownTableCells(line).every((cell) => /^:?-{3,}:?$/.test(cell));
}

function renderMarkdownTable(tableLines: string[], key: string): React.ReactNode {
  const rows = tableLines.map(parseMarkdownTableCells);
  if (!rows.length) return null;
  let header = rows[0];
  let body = rows.slice(1);
  if (body.length && isMarkdownTableSeparator(tableLines[1])) {
    body = rows.slice(2);
  }
  if (!header.length) return null;

  return (
    <div
      key={key}
      className="my-2 max-w-full overflow-x-auto rounded-xl border border-[#bfbfbf]/60 bg-white"
    >
      <table className="min-w-full border-collapse text-left text-[12px] leading-snug">
        <thead>
          <tr className="border-b border-[#e5e5e5] bg-neutral-50 text-[11px] font-medium uppercase tracking-[0.08em] text-neutral-500">
            {header.map((cell, i) => (
              <th key={`h-${i}`} className="whitespace-nowrap px-2.5 py-2 pr-3 font-medium">
                {renderInline(cell, `${key}-h-${i}`)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body.map((row, rowIdx) => (
            <tr key={`r-${rowIdx}`} className="border-b border-[#e5e5e5] last:border-0">
              {header.map((_, colIdx) => (
                <td
                  key={`c-${rowIdx}-${colIdx}`}
                  className="max-w-[160px] truncate px-2.5 py-2 pr-3 text-neutral-800"
                  title={row[colIdx] || ''}
                >
                  {renderInline(row[colIdx] || '—', `${key}-c-${rowIdx}-${colIdx}`)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Turn model markdown (incl. inline "* a * b" lists) into readable blocks. */
function renderRichText(text: string) {
  let normalized = String(text ?? '')
    .replace(/\r\n/g, '\n')
    .trim();
  // Collapse inline bullet runs: "...: * item * item" → real newlines
  if (!normalized.includes('\n') && / \* /.test(normalized)) {
    normalized = normalized.replace(/ \* (?=\*\*|[\w#*])/g, '\n* ');
  }
  if (!normalized.includes('\n') && / - (?=[A-Z*\d])/.test(normalized)) {
    normalized = normalized.replace(/ - (?=[A-Z*\d])/g, '\n- ');
  }

  const lines = normalized.split('\n');
  const blocks: React.ReactNode[] = [];
  let listItems: string[] = [];
  let tableLines: string[] = [];
  let blockKey = 0;

  const flushList = () => {
    if (!listItems.length) return;
    const items = listItems;
    listItems = [];
    blocks.push(
      <ul key={`ul-${blockKey++}`} className="my-1.5 list-disc space-y-1 pl-5 marker:text-neutral-400">
        {items.map((item, i) => (
          <li key={`li-${i}`} className="pl-0.5">
            {renderInline(item, `li-${blockKey}-${i}`)}
          </li>
        ))}
      </ul>,
    );
  };

  const flushTable = () => {
    if (!tableLines.length) return;
    const rows = tableLines;
    tableLines = [];
    const table = renderMarkdownTable(rows, `tbl-${blockKey++}`);
    if (table) blocks.push(table);
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (isMarkdownTableRow(line)) {
      flushList();
      tableLines.push(line);
      continue;
    }
    flushTable();
    const bullet = line.match(/^\s*([*\-]|\d+\.)\s+(.*)$/);
    if (bullet) {
      listItems.push(bullet[2]);
      continue;
    }
    flushList();
    if (!line.trim()) {
      blocks.push(<div key={`sp-${blockKey++}`} className="h-1.5" />);
      continue;
    }
    blocks.push(
      <p key={`p-${blockKey++}`} className="m-0">
        {renderInline(line.trim(), `p-${blockKey}`)}
      </p>,
    );
  }
  flushTable();
  flushList();

  return <div className="space-y-0.5">{blocks}</div>;
}

function containsAssistantHtml(text: string): boolean {
  return /<(p|ul|ol|li|strong|em|br|table|thead|tbody|tr|th|td|h2|h3|span)\b/i.test(
    text,
  );
}

/** Allow only safe table/prose tags from grounded list replies. */
export function sanitizeAssistantHtml(raw: string): string {
  if (typeof DOMParser === 'undefined') return raw;
  const doc = new DOMParser().parseFromString(raw, 'text/html');
  const allowed = new Set([
    'TABLE',
    'THEAD',
    'TBODY',
    'TR',
    'TH',
    'TD',
    'P',
    'UL',
    'OL',
    'LI',
    'STRONG',
    'EM',
    'BR',
    'SPAN',
    'H2',
    'H3',
  ]);
  const walk = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) {
      return node.textContent || '';
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return '';
    const el = node as HTMLElement;
    const tag = el.tagName.toUpperCase();
    if (!allowed.has(tag)) {
      return Array.from(el.childNodes).map(walk).join('');
    }
    const attrs =
      tag === 'TABLE' && el.className
        ? ` class="${el.className.replace(/"/g, '')}"`
        : '';
    const inner = Array.from(el.childNodes).map(walk).join('');
    if (tag === 'BR') return '<br />';
    return `<${tag.toLowerCase()}${attrs}>${inner}</${tag.toLowerCase()}>`;
  };
  return Array.from(doc.body.childNodes).map(walk).join('');
}

export function renderAssistantMessage(text: string) {
  const body = String(text ?? '').trim();
  if (!body) return null;
  if (containsAssistantHtml(body)) {
    return (
      <div className="coworker-html min-w-0 max-w-full space-y-2 select-text">
        <div
          className="min-w-0 max-w-full overflow-x-auto"
          dangerouslySetInnerHTML={{ __html: sanitizeAssistantHtml(body) }}
        />
      </div>
    );
  }
  return <div className="min-w-0 max-w-full select-text">{renderRichText(body)}</div>;
}

function selectedTableTsv(table: Element, selection: Selection): string {
  const rows: string[] = [];
  table.querySelectorAll('tr').forEach((tr) => {
    const cells = Array.from(tr.querySelectorAll('th,td')).filter((cell) =>
      selection.containsNode(cell, true)
    );
    if (!cells.length) return;
    rows.push(
      cells
        .map((cell) => (cell.textContent || '').replace(/\s+/g, ' ').trim())
        .join('\t')
    );
  });
  return rows.join('\n');
}

/** Clipboard text for chat tables/prose so cells do not paste as one jammed word. */
export function coworkerSelectionCopyText(selection: Selection | null): string | null {
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;
  const node = selection.getRangeAt(0).commonAncestorContainer;
  const el = node instanceof Element ? node : node.parentElement;
  const root =
    el?.closest('.coworker-html') ||
    el?.closest('[data-coworker-copy]') ||
    el?.closest('table');
  if (!root) return null;

  if (root.tagName === 'TABLE') {
    const tsv = selectedTableTsv(root, selection);
    return tsv || null;
  }

  const parts: string[] = [];
  let copiedTable = false;
  root.querySelectorAll('p, em, li, h2, h3, table').forEach((block) => {
    if (!selection.containsNode(block, true)) return;
    if (block.tagName === 'TABLE') {
      const tsv = selectedTableTsv(block, selection);
      if (tsv) {
        copiedTable = true;
        parts.push(tsv);
      }
      return;
    }
    const line = (block.textContent || '').replace(/\s+/g, ' ').trim();
    if (line) parts.push(line);
  });
  if (copiedTable && parts.length) return parts.join('\n\n');
  const raw = selection.toString().replace(/\u00a0/g, ' ');
  if (raw.trim()) return raw;
  if (parts.length) return parts.join('\n\n');
  return null;
}

export function handleCoworkerCopy(event: React.ClipboardEvent) {
  const text = coworkerSelectionCopyText(window.getSelection());
  if (!text) return;
  event.preventDefault();
  event.clipboardData.setData('text/plain', text);
}

export default function CoworkerChatPanel({
  pageLabel,
  expanded = false,
  onToggleExpand,
  className = '',
  greetingOverride,
  placeholder,
  suggestionChips = [],
  onUserMessage,
  onChatActions,
  handlersFirst = false,
  getChatContext,
  onRestart,
  module,
  surface,
  onDraftPatch,
  onToolConfirm,
  onAttachTicketFiles,
  ticketAttachmentUrls = [],
  onRemoveTicketAttachment,
}: CoworkerChatPanelProps) {
  const ticketFilesOnPlus = Boolean(onAttachTicketFiles) || module === 'tickets';
  const [localTicketFileUrls, setLocalTicketFileUrls] = useState<string[]>([]);
  const [ticketFilePreviews, setTicketFilePreviews] = useState<
    Array<{ key: string; name: string; src: string }>
  >([]);
  const session = useCoworkerSessionOptional();

  // Fallback local state only when no session provider (should be rare)
  const [localMessages, setLocalMessages] = useState<CoworkerMessage[]>([]);
  const messages = session?.messages ?? localMessages;
  const setMessages = session?.setMessages ?? setLocalMessages;

  const [draft, setDraft] = useState('');
  const [composerExpanded, setComposerExpanded] = useState(false);
  const [composerScrolling, setComposerScrolling] = useState(false);
  const [localBusy, setLocalBusy] = useState(false);
  const [localThinkingLabel, setLocalThinkingLabel] = useState('Thinking…');
  const busy = session ? session.turnBusy : localBusy;
  const thinkingLabel = session ? session.thinkingLabel : localThinkingLabel;
  const setBusy = session ? session.setTurnBusy : setLocalBusy;
  const setThinkingLabel = session
    ? session.setThinkingLabel
    : setLocalThinkingLabel;
  const [greetingBusy, setGreetingBusy] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const importFileRef = useRef<HTMLInputElement>(null);
  const ticketFileRef = useRef<HTMLInputElement>(null);
  const ticketFileInputId = useId();
  const composerScrollTimerRef = useRef<number | null>(null);
  /** Local fallback when panel renders outside session provider. */
  const localGreetedPagesRef = useRef<string[]>([]);
  const busyRef = useRef(false);
  const isTurnBusy = () =>
    session ? session.isTurnBusy() : busyRef.current;
  const markBusy = (next: boolean) => {
    busyRef.current = next;
    setBusy(next);
  };
  const sessionMemoryRef = useRef<CoworkerSessionMemory>({});
  const queuedSendRef = useRef<string | null>(null);
  const sendTextRef = useRef<(text: string) => Promise<void>>(async () => {});
  /** Bumped on refresh so in-flight turns/greetings cannot paint into the new session. */
  const sessionEpochRef = useRef(0);

  const fileToBase64 = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = String(reader.result || '');
        const comma = result.indexOf(',');
        resolve(comma >= 0 ? result.slice(comma + 1) : result);
      };
      reader.onerror = () => reject(reader.error || new Error('read failed'));
      reader.readAsDataURL(file);
    });

  const maybeOpenCustomerImport = (actions: Record<string, unknown>[]) => {
    const wants = actions.some((a) => {
      const t = String(a?.type || '').toLowerCase();
      return t === 'open_customer_import';
    });
    if (!wants) return;
    window.setTimeout(() => importFileRef.current?.click(), 0);
  };

  const uploadCustomerImportFiles = async (files: FileList | File[]) => {
    const list = Array.from(files || []).filter(Boolean);
    if (!list.length) return;
    const results: Array<{
      fileName: string;
      created: number;
      errors: unknown[];
      error?: string;
    }> = [];
    for (const file of list) {
      try {
        const name = String(file.name || '').toLowerCase();
        const isExcel = name.endsWith('.xlsx') || name.endsWith('.xls');
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
          results.push({
            fileName: file.name,
            created: 0,
            errors: [],
            error: String(data.error || 'Import failed'),
          });
          continue;
        }
        results.push({
          fileName: file.name,
          created: Number(data.created || 0),
          errors: Array.isArray(data.errors) ? data.errors : [],
        });
      } catch {
        results.push({
          fileName: file.name,
          created: 0,
          errors: [],
          error: 'Import failed',
        });
      }
    }
    const createdTotal = results.reduce((n, r) => n + r.created, 0);
    const errorRows = results.reduce(
      (n, r) => n + (Array.isArray(r.errors) ? r.errors.length : 0),
      0
    );
    const fileErrors = results.filter((r) => r.error).map((r) => `${r.fileName}: ${r.error}`);
    // Structured follow-up for the LLM to phrase — no static assistant seed.
    const summaryPayload = {
      kind: 'customer_import_result',
      created: createdTotal,
      rowErrors: errorRows,
      files: results.map((r) => ({
        fileName: r.fileName,
        created: r.created,
        errors: r.errors,
        error: r.error || null,
      })),
      fileFailures: fileErrors,
    };
    await sendTextRef.current(
      `Customer/contact import finished. Structured result (summarize for me; do not invent rows): ${JSON.stringify(summaryPayload)}`
    );
    try {
      await onChatActions?.(
        [{ type: 'refresh_customers' }, { type: 'navigate', view: 'customers' }],
        {
          reply: '',
          agent: 'customers',
          userText: 'import customers',
        }
      );
    } catch {
      /* ignore */
    }
  };

  const greetedPages = session?.greetedPages ?? localGreetedPagesRef.current;
  const markGreetedPage = (page: string | null) => {
    if (session) {
      session.markGreetedPage(page);
      return;
    }
    const t = (page || '').trim();
    if (!t) {
      localGreetedPagesRef.current = [];
      return;
    }
    if (!localGreetedPagesRef.current.includes(t)) {
      localGreetedPagesRef.current = [...localGreetedPagesRef.current, t];
    }
  };

  const loadDynamicGreeting = async (sessionIdOverride?: string) => {
    const intent = greetingIntent(greetingOverride);
    const extras = getChatContext?.() || {};
    const turn = await askCoworkerAgentTurn('hello', pageLabel, {
      sessionId: sessionIdOverride || session?.sessionId,
      kind: 'greeting',
      module: extras.module || module,
      surface: extras.surface || surface,
      focusedEntity: extras.focusedEntity || session?.focusedEntity || undefined,
    });
    const fromTurn = String(turn?.assistantText || '').trim();
    if (fromTurn && !isTransientAssistantFailure(fromTurn)) {
      return fromTurn;
    }
    return llmGuidedReply(
      {
        module: 'greeting',
        kind: 'greeting',
        pageLabel,
        context: {
          pageLabel,
          intentHint: intent.slice(0, 160),
          scope: 'universal',
        },
      },
      intent
    );
  };

  const focusInput = () => {
    // Defer until after route/layout paint so focus isn't stolen by the new panel
    window.requestAnimationFrame(() => {
      window.setTimeout(() => {
        const el = inputRef.current;
        if (!el) return;
        el.focus({ preventScroll: true });
        const len = el.value.length;
        try {
          el.setSelectionRange(len, len);
        } catch {
          /* ignore unsupported selection */
        }
      }, 0);
    });
  };

  // One universal initial greeting for the session — same text covers all modules; no new intro on switch.
  useEffect(() => {
    session?.notePageChange(pageLabel);
    focusInput();

    // Optimistic create navigate remounts this panel mid-turn — do not start
    // a greeting fetch or clear the live thinking chip.
    if (session?.isTurnBusy()) {
      setGreetingBusy(false);
      return;
    }

    const sessionKey = String(session?.sessionId || 'local').trim() || 'local';
    const retryFailedHello = shouldRetryGreeting(messages);
    const decision = decideModuleGreeting({
      pageLabel,
      greetedPages,
      messageCount: retryFailedHello ? 0 : messages.length,
    });

    if (!retryFailedHello && (decision === 'skip' || decision === 'skip_and_mark')) {
      if (decision === 'skip_and_mark') markGreetedPage('__initial__');
      setMessages((prev) => {
        const next = compactStackedAssistantIntros(prev);
        return next.length === prev.length ? prev : next;
      });
      setGreetingBusy(false);
      return;
    }
    if (retryFailedHello && messages.length > 0) {
      clearSessionGreetingCache(sessionKey);
      setMessages([]);
    }

    let cancelled = false;
    const epoch = sessionEpochRef.current;
    setGreetingBusy(true);
    void (async () => {
      try {
        // One agent-turn per session even if Strict Mode / remount re-runs this effect.
        const dynamic = await sharedSessionGreeting(sessionKey, () =>
          loadDynamicGreeting(sessionKey === 'local' ? undefined : sessionKey)
        );
        if (cancelled || epoch !== sessionEpochRef.current) return;
        if (!dynamic) {
          setMessages((prev) => {
            if (prev.length > 0) return prev;
            return [
              {
                id: `greet-err-${Date.now()}`,
                role: 'assistant',
                text: LLM_UNAVAILABLE_CHAT,
              },
            ];
          });
          return;
        }
        markGreetedPage('__initial__');
        setMessages((prev) => {
          if (prev.length > 0) return prev;
          return [{ id: `greet-${Date.now()}`, role: 'assistant', text: dynamic }];
        });
      } finally {
        if (!cancelled && epoch === sessionEpochRef.current) setGreetingBusy(false);
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageLabel]);

  useEffect(() => {
    focusInput();
  }, []);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, busy, greetingBusy]);

  useLayoutEffect(() => {
    const height = syncComposerHeight(inputRef.current);
    setComposerExpanded(height > 40);
  }, [draft]);

  useEffect(
    () => () => {
      if (composerScrollTimerRef.current != null) {
        window.clearTimeout(composerScrollTimerRef.current);
      }
    },
    []
  );

  useEffect(() => {
    if (!busy && !greetingBusy) focusInput();
  }, [busy, greetingBusy]);

  const restart = () => {
    sessionEpochRef.current += 1;
    const epoch = sessionEpochRef.current;
    markBusy(false);
    queuedSendRef.current = null;
    setGreetingBusy(false);
    setDraft('');
    sessionMemoryRef.current = {};
    const previousKey = String(session?.sessionId || 'local').trim() || 'local';
    clearSessionGreetingCache(previousKey);
    let sid: string | undefined;
    if (session) {
      sid = session.restartSession('', null);
    } else {
      localGreetedPagesRef.current = [];
      setLocalMessages([]);
    }
    onRestart?.();
    focusInput();
    const nextKey = String(sid || 'local').trim() || 'local';
    void (async () => {
      const greeting = await sharedSessionGreeting(nextKey, () => loadDynamicGreeting(sid));
      if (epoch !== sessionEpochRef.current) return;
      if (!greeting?.trim()) return;
      setMessages((prev) => {
        if (prev.length > 0) return prev;
        return [{ id: `greet-${Date.now()}`, role: 'assistant', text: greeting }];
      });
      markGreetedPage('__initial__');
    })();
  };

  const confirmPendingTool = async (
    messageId: string,
    chip: { name: string; args: Record<string, unknown>; risk?: string; auto?: boolean }
  ) => {
    if (isTurnBusy()) return;
    const epoch = sessionEpochRef.current;
    markBusy(true);
    setMessages((prev) =>
      prev.map((m) => (m.id === messageId ? { ...m, confirms: undefined } : m))
    );
    try {
      const owned = onToolConfirm
        ? await onToolConfirm({ name: chip.name, args: chip.args || {} })
        : false;
      if (epoch !== sessionEpochRef.current) return;
      if (owned) return;
      const extras = getChatContext?.() || {};
      const historyForApi = messages
        .filter((m) => m.role === 'user' || m.role === 'assistant')
        .slice(-80)
        .map((m) => ({ role: m.role, text: m.text }));
      const live = await askCoworkerAgentTurn('confirm', pageLabel, {
        sessionId: session?.sessionId,
        history: historyForApi,
        draft: extras.draft || undefined,
        focusedEntity: extras.focusedEntity || session?.focusedEntity || undefined,
        module: extras.module || module,
        surface: extras.surface || surface,
        sessionMemory: extras.sessionMemory || sessionMemoryRef.current,
        entityId: extras.entityId,
        confirmTool: {
          name: chip.name,
          args: chip.args || {},
          auto: false,
          risk: chip.risk || 'high',
        },
      });
      if (epoch !== sessionEpochRef.current) return;
      if (live?.sessionMemoryPatch) {
        sessionMemoryRef.current = mergeCoworkerSessionMemory(
          sessionMemoryRef.current,
          live.sessionMemoryPatch
        );
      }
      const applied = applyAgentTurn({
        actions: live?.actions,
        toolProposals: live?.toolProposals,
        patch: live?.patch,
        sessionMemoryPatch: live?.sessionMemoryPatch,
        uiRefresh: live?.uiRefresh,
      });
      if (applied.patch) {
        try {
          onDraftPatch?.(applied.patch);
        } catch {
          /* ignore */
        }
      }
      const paintedReply = String(live?.assistantText || live?.reply || '').trim();
      if (applied.uiActions.length) {
        try {
          await onChatActions?.(applied.uiActions, {
            reply: paintedReply,
            agent: live?.agent || '',
            userText: 'confirm',
          });
        } catch {
          /* ignore */
        }
        maybeOpenCustomerImport(applied.uiActions);
      }
      if (paintedReply) {
        setMessages((prev) => [
          ...prev,
          {
            id: `a-${Date.now()}`,
            role: 'assistant',
            text: paintedReply,
            confirms: applied.confirms.length ? applied.confirms : undefined,
          },
        ]);
      }
    } finally {
      if (epoch === sessionEpochRef.current) {
        markBusy(false);
        focusInput();
      }
    }
  };

  const sendText = async (textRaw: string) => {
    const text = textRaw.trim();
    const outgoingAttachments = (() => {
      const out: NonNullable<CoworkerMessage['attachments']> = [];
      const seen = new Set<string>();
      for (const file of ticketFilePreviews) {
        const key = file.src || file.name;
        if (!key || seen.has(key)) continue;
        seen.add(key);
        out.push({
          url: file.src || '',
          name: file.name,
          preview: file.src || undefined,
        });
      }
      for (const url of [...ticketAttachmentUrls, ...localTicketFileUrls]) {
        if (!url.startsWith('/uploads/')) continue;
        const name = attachmentFileName(url);
        const existing = out.find((item) => item.name === name);
        if (existing) {
          existing.url = url;
          continue;
        }
        if (seen.has(url)) continue;
        seen.add(url);
        out.push({ url, name });
      }
      return out;
    })();
    const attachNames = outgoingAttachments
      .map((item) => String(item.name || item.url.split('/').pop() || '').trim())
      .filter(Boolean);
    const displayText = text || (attachNames.length ? `Attached ${attachNames.join(', ')}` : '');
    if (!displayText) return;
    if (isTurnBusy()) {
      queuedSendRef.current = displayText;
      return;
    }
    const epoch = sessionEpochRef.current;
    markBusy(true);
    setThinkingLabel('Thinking…');
    setGreetingBusy(false);
    const userMsg: CoworkerMessage = {
      id: `u-${Date.now()}`,
      role: 'user',
      text: displayText,
      attachments: outgoingAttachments.length ? outgoingAttachments : undefined,
    };
    setMessages((prev) => [...prev, userMsg]);
    setDraft('');
    setTicketFilePreviews([]);

    // Open the create progress panel immediately — do not wait for agent-turn.
    // Skip when already collecting fields (draft.awaiting) so answers aren't treated as create-start.
    try {
      const ctxNow = getChatContext?.() || {};
      const awaiting = String(
        (ctxNow.draft as { awaiting?: string } | null | undefined)?.awaiting || ''
      ).trim();
      if (!awaiting) {
        const optimistic = optimisticCreateUiActions(
          text,
          module || ctxNow.module || undefined
        );
        if (optimistic?.length) {
          void onChatActions?.(optimistic, {
            reply: '',
            agent: 'optimistic',
            userText: text,
          });
        }
      }
    } catch {
      /* optimistic shell must not block chat */
    }

    // History before this user turn (for the model) + include the new user message
    const historyForApi = [...messages, userMsg]
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .filter((m) => !m.text.startsWith('Continuing this conversation'))
      .slice(-80)
      .map((m) => ({ role: m.role, text: m.text }));

    let reply: string | null = null;
    let agentsReached = false;
    try {
      // Guided wizards: local handler owns the turn when it returns a reply.
      // If it returns null, fall through to LangGraph (same as non-guided pages)
      // so confirm/save actions still refresh the right-hand list.
      if (handlersFirst) {
        try {
          reply = (await onUserMessage?.(displayText)) ?? null;
        } catch {
          reply = null;
        }
      }
      if (epoch !== sessionEpochRef.current) return;

      if (!reply) {
        // Primary path: CRM agent-turn (LangGraph internally).
        const extras = getChatContext?.() || {};
        const pendingFiles = [
          ...((extras.draft as { attachments?: string[] } | undefined)?.attachments || []),
          ...ticketAttachmentUrls,
          ...localTicketFileUrls,
        ].filter(
          (url, idx, all) =>
            typeof url === 'string' &&
            url.startsWith('/uploads/') &&
            all.indexOf(url) === idx
        );
        const extrasDraft =
          extras.draft && typeof extras.draft === 'object' ? extras.draft : {};
        const live = await askCoworkerAgentTurn(displayText, pageLabel, {
          sessionId: session?.sessionId,
          history: historyForApi,
          draft:
            pendingFiles.length || Object.keys(extrasDraft).length
              ? { ...extrasDraft, ...(pendingFiles.length ? { attachments: pendingFiles } : {}) }
              : undefined,
          focusedEntity: extras.focusedEntity || session?.focusedEntity || undefined,
          module: extras.module || module,
          surface: extras.surface || surface,
          sessionMemory: extras.sessionMemory || sessionMemoryRef.current,
          entityId: extras.entityId,
          onProgress: (ev) => {
            if (epoch !== sessionEpochRef.current) return;
            const kind = String(ev.kind || '').trim().toLowerCase();
            if (kind && kind !== 'status') return;
            const label = String(ev.label || '').trim();
            if (label) setThinkingLabel(label);
          },
        });
        if (epoch !== sessionEpochRef.current) return;
        if (live) {
          agentsReached = true;
          if (live.sessionMemoryPatch) {
            sessionMemoryRef.current = mergeCoworkerSessionMemory(
              sessionMemoryRef.current,
              live.sessionMemoryPatch
            );
          }
          const applied = applyAgentTurn({
            actions: live.actions,
            toolProposals: live.toolProposals,
            patch: live.patch,
            sessionMemoryPatch: live.sessionMemoryPatch,
            uiRefresh: live.uiRefresh,
          });
          if (applied.patch) {
            try {
              const slots =
                live.sessionMemoryPatch?.slots &&
                typeof live.sessionMemoryPatch.slots === 'object'
                  ? live.sessionMemoryPatch.slots
                  : {};
              onDraftPatch?.({ ...slots, ...applied.patch });
            } catch {
              /* draft apply must not hide the reply */
            }
          }
          // Apply workspace/create UI before painting the bubble so the progress
          // panel updates as soon as the turn returns (not after the reply paints).
          const paintedReply = String(live.assistantText || live.reply || '').trim();
          if (applied.uiActions.length) {
            try {
              await onChatActions?.(applied.uiActions, {
                reply: paintedReply,
                agent: live.agent,
                userText: text,
              });
            } catch {
              /* UI apply failures should not hide the model reply */
            }
            maybeOpenCustomerImport(applied.uiActions);
          }
          if (paintedReply || applied.confirms.length) {
            setMessages((prev) => [
              ...prev,
              {
                id: `a-${Date.now()}`,
                role: 'assistant',
                text: paintedReply || 'Confirm the proposed action to continue.',
                confirms: applied.confirms.length ? applied.confirms : undefined,
              },
            ]);
          } else if (
            live.source === 'error' ||
            live.serviceError
          ) {
            const se =
              live.serviceError && typeof live.serviceError === 'object'
                ? live.serviceError
                : null;
            const fromService = String(se?.message || '').trim();
            const fromData = String(
              (live.data as { message?: string } | undefined)?.message || ''
            ).trim();
            const rawErr = fromService || fromData;
            // Never paint internal tool-loop / budget diagnostics in the transcript.
            const errText =
              rawErr &&
              !/repeated tool-call cycle|tool loop exceeded|tool loop deadline/i.test(
                rawErr
              )
                ? rawErr
                : 'I could not finish that write just now — please try once more, or say what to change.';
            if (se?.code) {
              console.warn('[coworker/agent-turn]', se.code, rawErr || errText);
            }
            setMessages((prev) => [
              ...prev,
              {
                id: `a-${Date.now()}`,
                role: 'assistant',
                text: errText,
              },
            ]);
          } else {
            setMessages((prev) => [
              ...prev,
              {
                id: `a-${Date.now()}`,
                role: 'assistant',
                text: 'Service temporarily unavailable — please try again in a moment.',
              },
            ]);
          }
        }
      }

      if (epoch !== sessionEpochRef.current) return;

      // Offline / agents-down: structured service error only (no seed/LLM fallback bubble).
      if (!agentsReached && !reply) {
        try {
          reply = (await onUserMessage?.(displayText)) ?? null;
        } catch {
          reply = null;
        }
      }
      if (epoch !== sessionEpochRef.current) return;
      if (!agentsReached && reply) {
        const paintedReply = String(reply).trim();
        if (paintedReply) {
          setMessages((prev) => [
            ...prev,
            { id: `a-${Date.now()}`, role: 'assistant', text: paintedReply },
          ]);
        } else {
          setMessages((prev) => [
            ...prev,
            {
              id: `a-${Date.now()}`,
              role: 'assistant',
              text: 'Service temporarily unavailable — please try again in a moment.',
            },
          ]);
        }
      } else if (!agentsReached) {
        setMessages((prev) => [
          ...prev,
          {
            id: `a-${Date.now()}`,
            role: 'assistant',
            text: 'Service temporarily unavailable — please try again in a moment.',
          },
        ]);
      }
    } finally {
      if (epoch === sessionEpochRef.current) {
        markBusy(false);
        setGreetingBusy(false);
      }
    }
  };
  sendTextRef.current = sendText;

  useEffect(() => {
    const register = session?.registerSendUserText;
    if (!register) return;
    register((text) => sendTextRef.current(text));
    return () => register(null);
  }, [session?.registerSendUserText]);

  useEffect(() => {
    if (busy || greetingBusy) return;
    const queued = queuedSendRef.current;
    if (!queued) return;
    queuedSendRef.current = null;
    void sendTextRef.current(queued);
  }, [busy, greetingBusy]);

  const showChips =
    suggestionChips.length > 0 &&
    messages.length <= 2 &&
    !busy &&
    !greetingBusy;

  return (
    <div
      className={`rounded-2xl border-[0.6px] border-[#bfbfbf] bg-white shadow-none flex h-full min-h-0 flex-col overflow-hidden ${className}`}
    >
      <div className="flex items-center justify-between gap-2 border-b-[0.6px] border-[#bfbfbf] px-4 py-3 shrink-0">
        <div className="flex items-center gap-2.5 min-w-0">
          <CopilotMark className="h-7 w-7 shrink-0" />
          <div className="min-w-0">
            <h2 className="truncate text-lg font-semibold text-neutral-900">Worktual</h2>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <button
            type="button"
            title="Restart conversation (new session)"
            onClick={restart}
            className="inline-flex size-[38px] items-center justify-center rounded-lg text-neutral-500 shadow-none hover:bg-neutral-100 hover:text-neutral-900"
          >
            <RotateCcw className="size-[18px] stroke-[2.25]" />
          </button>
          {onToggleExpand && (
            <button
              type="button"
              title={expanded ? 'Minimize chat · widen board' : 'Maximize chat · shrink board'}
              onClick={onToggleExpand}
              className="hidden size-[38px] items-center justify-center rounded-lg text-neutral-500 shadow-none hover:bg-neutral-100 hover:text-neutral-900 lg:inline-flex"
            >
              {expanded ? (
                <Minimize2 className="size-[18px] stroke-[2.25]" />
              ) : (
                <Maximize2 className="size-[18px] stroke-[2.25]" />
              )}
            </button>
          )}
        </div>
      </div>

      <div
        ref={listRef}
        onCopy={handleCoworkerCopy}
        className="flex-1 min-h-0 min-w-0 overflow-y-auto overflow-x-auto px-4 pr-5 py-4 space-y-[30px] select-text cursor-text"
      >
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              data-coworker-copy
              className={`min-w-0 select-text text-[14px] leading-relaxed shadow-none ${
                msg.role === 'user'
                  ? 'ml-[40px] inline-block w-fit max-w-[calc(100%-95px)] rounded-2xl rounded-tr-sm bg-[#111111] px-3.5 py-2.5 text-white [&_*]:!text-white'
                  : 'max-w-[90%] bg-transparent p-0 text-neutral-800'
              }`}
            >
              {msg.role === 'user' && msg.attachments?.length ? (
                <ChatBubbleAttachments attachments={msg.attachments} dark />
              ) : null}
              {msg.text ? renderAssistantMessage(msg.text) : null}
              {msg.role === 'assistant' && msg.confirms && msg.confirms.length > 0 && (
                <div className="mt-2.5 flex flex-wrap gap-2">
                  {msg.confirms.map((chip) => (
                    <button
                      key={`${msg.id}-${chip.name}`}
                      type="button"
                      disabled={busy}
                      onClick={() => void confirmPendingTool(msg.id, chip)}
                      className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-neutral-300 bg-white text-neutral-800 hover:border-neutral-500 hover:bg-neutral-100 disabled:opacity-50 transition-colors"
                    >
                      {chip.risk === 'high' ? 'Confirm' : 'Continue'}:{' '}
                      {confirmToolChipLabel(chip.name)}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}

        {(busy || greetingBusy) && (
          <div className="flex justify-start" aria-live="polite" aria-label={thinkingLabel}>
            <div className="inline-flex max-w-[90%] items-center gap-2.5 bg-transparent p-0 shadow-none">
              <span className="flex items-center gap-1" aria-hidden>
                <span className="h-1.5 w-1.5 rounded-full bg-neutral-400 animate-[coworkerThink_1.05s_ease-in-out_infinite]" />
                <span className="h-1.5 w-1.5 rounded-full bg-neutral-400 animate-[coworkerThink_1.05s_ease-in-out_0.15s_infinite]" />
                <span className="h-1.5 w-1.5 rounded-full bg-neutral-400 animate-[coworkerThink_1.05s_ease-in-out_0.3s_infinite]" />
              </span>
              <span className="text-xs font-medium text-neutral-500 tracking-wide">
                {busy ? thinkingLabel : 'Thinking…'}
              </span>
            </div>
          </div>
        )}

        {showChips && (
          <div className="flex flex-wrap gap-2 pt-1">
            {suggestionChips.map((chip) => (
              <button
                key={chip}
                type="button"
                onClick={() => sendText(chip)}
                className="text-xs font-medium px-3 py-1.5 rounded-full border border-neutral-200 bg-white text-neutral-700 hover:border-neutral-400 hover:bg-neutral-50 transition-colors"
              >
                {chip}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="shrink-0 p-3 pt-1">
        {ticketFilesOnPlus &&
        (ticketAttachmentUrls.length > 0 ||
          localTicketFileUrls.length > 0 ||
          ticketFilePreviews.length > 0) ? (
          <ul className="flex flex-wrap gap-2 px-1 pb-2">
            {ticketFilePreviews.map((file) => (
              <li
                key={file.key}
                className="flex max-w-[220px] items-center gap-2 rounded-xl border-[0.6px] border-[#bfbfbf] bg-white px-2 py-1.5"
              >
                {file.src ? (
                  <img
                    src={file.src}
                    alt=""
                    className="size-10 shrink-0 rounded-md object-cover"
                  />
                ) : (
                  <span className="grid size-10 shrink-0 place-items-center rounded-md bg-neutral-100 text-[10px] font-semibold text-neutral-500">
                    File
                  </span>
                )}
                <span className="min-w-0 flex-1 truncate text-[11px] text-neutral-800">
                  {file.name}
                </span>
              </li>
            ))}
            {[...ticketAttachmentUrls, ...localTicketFileUrls]
              .filter((url, idx, all) => all.indexOf(url) === idx)
              .filter((url) => {
                const name = url.split('/').filter(Boolean).pop() || url;
                return !ticketFilePreviews.some((p) => p.name === name);
              })
              .map((url) => {
              const name = url.split('/').filter(Boolean).pop() || url;
              const image =
                url.startsWith('/uploads/') &&
                (url.toLowerCase().includes('.png') ||
                  url.toLowerCase().includes('.jpg') ||
                  url.toLowerCase().includes('.jpeg') ||
                  url.toLowerCase().includes('.gif') ||
                  url.toLowerCase().includes('.webp'));
              return (
                <li
                  key={url}
                  className="flex max-w-[220px] items-center gap-2 rounded-xl border-[0.6px] border-[#bfbfbf] bg-white px-2 py-1.5"
                >
                  {image ? (
                    <img
                      src={url}
                      alt=""
                      className="size-10 shrink-0 rounded-md object-cover"
                    />
                  ) : (
                    <span className="grid size-10 shrink-0 place-items-center rounded-md bg-neutral-100 text-[10px] font-semibold text-neutral-500">
                      File
                    </span>
                  )}
                  <span className="min-w-0 flex-1 truncate text-[11px] text-neutral-800">
                    {name}
                  </span>
                  {onRemoveTicketAttachment || localTicketFileUrls.includes(url) ? (
                    <button
                      type="button"
                      aria-label={`Remove ${name}`}
                      onClick={() => {
                        if (localTicketFileUrls.includes(url)) {
                          setLocalTicketFileUrls((prev) => prev.filter((item) => item !== url));
                        }
                        onRemoveTicketAttachment?.(url);
                      }}
                      className="inline-flex size-4 shrink-0 items-center justify-center rounded-full text-neutral-400 hover:text-neutral-900"
                    >
                      <X className="size-3 stroke-[2.25]" />
                    </button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : null}
        <input
          ref={importFileRef}
          type="file"
          multiple
          accept=".csv,.tsv,.xls,.xlsx,text/csv,text/tab-separated-values"
          className="sr-only"
          tabIndex={-1}
          onChange={(e) => {
            const files = e.target.files;
            if (files?.length) void uploadCustomerImportFiles(files);
            e.target.value = '';
          }}
        />
        <input
          ref={ticketFileRef}
          id={ticketFileInputId}
          type="file"
          multiple
          className="sr-only"
          tabIndex={-1}
          onChange={(e) => {
            const files = e.target.files;
            if (!files?.length) {
              e.target.value = '';
              return;
            }
            const nextPreviews = Array.from(files).map((file) => ({
              key: `${file.name}-${file.size}-${file.lastModified}`,
              name: file.name,
              src: file.type.startsWith('image/') ? URL.createObjectURL(file) : '',
            }));
            setTicketFilePreviews((prev) => [...prev, ...nextPreviews]);
            if (onAttachTicketFiles) {
              void onAttachTicketFiles(files);
              e.target.value = '';
              return;
            }
            const form = new FormData();
            Array.from(files).forEach((f) => form.append('files', f));
            void fetch('/api/uploads', {
              method: 'POST',
              credentials: 'include',
              body: form,
            })
              .then(async (res) => {
                if (!res.ok) return;
                const data = (await res.json()) as { urls?: string[] };
                const urls = (data.urls || []).filter(
                  (u) => typeof u === 'string' && u.startsWith('/uploads/')
                );
                if (urls.length) setLocalTicketFileUrls((prev) => [...prev, ...urls]);
              })
              .catch(() => undefined);
            e.target.value = '';
          }}
        />
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void sendText(draft);
          }}
          className={`grid grid-cols-[38px_minmax(0,1fr)_38px] gap-1 border-[0.6px] border-[#bfbfbf] bg-[#fafafa] focus-within:border-neutral-400 focus-within:bg-white ${
            composerExpanded
              ? 'max-h-[250px] items-end overflow-hidden rounded-2xl px-3 pb-1.5 pt-2.5'
              : 'h-[46px] items-center overflow-hidden rounded-full px-1.5'
          }`}
        >
          <label
            htmlFor={ticketFilesOnPlus ? ticketFileInputId : undefined}
            aria-label={ticketFilesOnPlus ? 'Attach' : 'Import customers'}
            onClick={(e) => {
              if (ticketFilesOnPlus) return;
              e.preventDefault();
              importFileRef.current?.click();
            }}
            className={`col-start-1 row-start-1 inline-flex size-[38px] shrink-0 cursor-pointer items-center justify-center rounded-lg text-[#737373] hover:bg-white ${
              busy || greetingBusy
                ? 'pointer-events-none opacity-50'
                : ''
            }`}
          >
            <Plus className="size-[18px] stroke-[2.25]" />
          </label>
          <textarea
            ref={inputRef}
            rows={1}
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              setComposerExpanded(syncComposerHeight(e.target) > 40);
            }}
            onScroll={(e) => {
              if (e.currentTarget.scrollHeight <= e.currentTarget.clientHeight) return;
              setComposerScrolling(true);
              if (composerScrollTimerRef.current != null) {
                window.clearTimeout(composerScrollTimerRef.current);
              }
              composerScrollTimerRef.current = window.setTimeout(
                () => setComposerScrolling(false),
                650
              );
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void sendText(draft);
              }
            }}
            placeholder={placeholder || 'Ask your Worktual co-worker...'}
            className={`col-start-2 row-start-1 min-h-5 max-h-[192px] w-full resize-none overflow-hidden border-0 bg-transparent py-1.5 text-sm leading-5 text-[#171717] shadow-none outline-none placeholder:text-[#a3a3a3] focus:!border-transparent focus:!shadow-none select-text [scrollbar-width:thin] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent ${
              composerScrolling
                ? '[scrollbar-color:#d4d4d4_transparent] [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-neutral-300'
                : '[scrollbar-color:transparent_transparent] [&::-webkit-scrollbar-thumb]:bg-transparent'
            }`}
          />
          <button
            type="submit"
            disabled={
              (!draft.trim() &&
                !ticketFilePreviews.length &&
                !ticketAttachmentUrls.length &&
                !localTicketFileUrls.length) ||
              busy
            }
            title="Send"
            className="col-start-3 row-start-1 inline-flex size-[38px] shrink-0 items-center justify-center rounded-full bg-[#171717] text-white shadow-[0_2px_8px_rgba(0,0,0,0.18)] hover:bg-neutral-800 disabled:opacity-50 disabled:shadow-none"
          >
            <ArrowUp className="size-[18px] stroke-[2.25] text-white" />
          </button>
        </form>
      </div>
    </div>
  );
}
