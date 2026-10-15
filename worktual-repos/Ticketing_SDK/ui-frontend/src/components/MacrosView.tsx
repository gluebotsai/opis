import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  Bold,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Filter,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
  MessageSquareText,
  MoreVertical,
  Plus,
  Save,
  Search,
  Smile,
  Trash2,
  Underline,
  X,
} from 'lucide-react';
import { useSetPageTitle } from './layout/PageTitleContext';
import PageShell from './layout/PageShell';
import MenuSelect from './ui/menu-select';
import CoworkerSplitWorkspace, {
  useCoworkerSplitExpandOptional,
} from './coworker/CoworkerSplitWorkspace';
import { llmOnlyReply } from './coworker/llmGuidedReply';
import { mergeGuidedDraft, normalizeGuidedAwaiting } from './coworker/guidedDraftMerge';
import { useReportFocusedEntity } from './coworker/CoworkerSessionContext';
import GuidedDeletePreview, {
  type PendingDelete,
} from './coworker/GuidedDeletePreview';

/** Widens the content column while a macro detail is open (must render under split). */
function MacroDetailFocus() {
  const split = useCoworkerSplitExpandOptional();
  useEffect(() => {
    split?.focusContent();
    return () => split?.clearContentFocus();
  }, [split]);
  return null;
}

type Macro = {
  id: string;
  title: string;
  body: string;
  createdByName: string | null;
  createdAt?: string;
  updatedAt?: string;
};

type GuidedStep = 'title' | 'body' | 'confirm' | null;

const MACRO_GUIDED_STEPS: Array<{
  id: Exclude<GuidedStep, null>;
  title: string;
  prompt: string;
}> = [
  { id: 'title', title: 'Title', prompt: 'what to name this shortcut' },
  { id: 'body', title: 'Body', prompt: 'the reply snippet' },
  { id: 'confirm', title: 'Confirm', prompt: 'confirm to save, or cancel' },
];

function macroStepIndex(id: string): number {
  const idx = MACRO_GUIDED_STEPS.findIndex((s) => s.id === id);
  return idx >= 0 ? idx : 0;
}

function GuidedMacroPreview({
  draft,
  stepIndex,
  saving = false,
  onCancel,
  onUseForm,
  onConfirmCreate,
}: {
  draft: { title: string; body: string };
  stepIndex: number;
  saving?: boolean;
  onCancel: () => void;
  onUseForm?: () => void;
  onConfirmCreate?: () => void;
}) {
  const total = MACRO_GUIDED_STEPS.length;
  const hasTitle = Boolean(draft.title.trim());
  const hasBody = Boolean(htmlToPlainText(draft.body));
  let displayStep = stepIndex;
  if (displayStep > 0 && !hasTitle) displayStep = 0;
  else if (displayStep > 1 && !hasBody) displayStep = 1;
  const pct = Math.round((displayStep / total) * 100);
  const current = MACRO_GUIDED_STEPS[Math.min(displayStep, total - 1)];
  const completed = MACRO_GUIDED_STEPS.slice(0, displayStep).filter((s) => {
    if (s.id === 'title') return hasTitle;
    if (s.id === 'body') return hasBody;
    return true;
  });
  const pending = MACRO_GUIDED_STEPS.slice(displayStep + 1);
  const label = draft.title.trim() || 'New macro';
  const canSave = hasTitle && hasBody;

  return (
    <div className="h-full min-h-0 flex flex-col">
      <div className="px-4 py-4 border-b border-neutral-100 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] font-medium uppercase tracking-wide text-neutral-400">
              Creating with co-worker
            </p>
            <h3 className="text-base font-semibold text-neutral-900 truncate">{label}</h3>
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
              Step {Math.min(displayStep + 1, total)} of {total}
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
          <p className="text-[10px] font-medium uppercase tracking-wide text-neutral-400">Up next</p>
          <div className="rounded-xl border border-neutral-200 bg-neutral-50/80 p-4">
            <p className="text-sm font-semibold text-neutral-900">{current.title}</p>
            <p className="text-xs text-neutral-500 mt-1 leading-relaxed">
              Next in chat: {current.prompt}
            </p>
            {current.id === 'confirm' && (
              <div className="mt-3 space-y-3">
                <dl className="text-xs space-y-2 text-neutral-600">
                  <div className="flex gap-2">
                    <dt className="w-16 shrink-0 text-neutral-400">Title</dt>
                    <dd className="font-medium text-neutral-900">{draft.title || '—'}</dd>
                  </div>
                  <div className="space-y-1.5">
                    <dt className="text-neutral-400">Body</dt>
                    <dd className="rounded-lg border border-neutral-200 bg-white px-2.5 py-2 max-h-56 overflow-y-auto">
                      {htmlToPlainText(draft.body) ? (
                        <MacroFormattedBody content={draft.body} />
                      ) : (
                        <span className="text-neutral-400">—</span>
                      )}
                    </dd>
                  </div>
                </dl>
                {onConfirmCreate && (
                  <button
                    type="button"
                    disabled={saving || !canSave}
                    onClick={onConfirmCreate}
                    className="h-9 px-3 rounded-xl bg-black text-white text-xs font-semibold hover:bg-neutral-800 disabled:opacity-50"
                  >
                    {saving ? 'Saving…' : 'Save macro'}
                  </button>
                )}
              </div>
            )}
          </div>
          {pending.length > 0 && (
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
                    {s.id === 'title' ? (
                      <p className="text-[11px] text-neutral-500 truncate">{draft.title}</p>
                    ) : s.id === 'body' ? (
                      <div className="mt-1 max-h-28 overflow-y-auto rounded-md border border-neutral-100 bg-neutral-50/80 px-2 py-1.5">
                        <MacroFormattedBody content={draft.body} />
                      </div>
                    ) : null}
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

interface MacrosViewProps {
  embedded?: boolean;
  /** Chat said create/write macro — start guided flow. */
  startCreateIntent?: boolean;
  startCreateSeed?: {
    step?: string;
    title?: string;
    body?: string;
  } | null;
  onConsumeCreateIntent?: () => void;
  /** Incremented by App after chat persists a macro — reload the list. */
  listRefreshToken?: number;
  moduleResetKey?: number;
  /** Chat set_filter query — same `?q=` the UI search box uses. */
  externalSearchQuery?: string;
  onCoworkerMessage?: (text: string) => string | null | Promise<string | null>;
  onCoworkerChatActions?: (
    actions: Record<string, unknown>[],
    meta: { reply: string; agent: string; userText: string }
  ) => void | Promise<void>;
  onAgentRoute?: (agent: string) => void;
}

const TITLE_MAX = 100;
const BODY_MAX = 4000;
const FALLBACK_ROW_H = 74;
const PAGER_H = 44;

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

const MACRO_HTML_TAGS = new Set([
  'B',
  'STRONG',
  'I',
  'EM',
  'U',
  'UL',
  'OL',
  'LI',
  'A',
  'BR',
  'P',
  'DIV',
  'SPAN',
]);

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function htmlToPlainText(html: string): string {
  if (typeof document === 'undefined') {
    return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  }
  const node = document.createElement('div');
  node.innerHTML = html;
  return String(node.textContent || '').replace(/\s+/g, ' ').trim();
}

function looksLikeHtml(value: string): boolean {
  return /<\/?(?:b|strong|i|em|u|ul|ol|li|a|p|div|br)\b/i.test(value);
}

function sanitizeMacroHtml(html: string): string {
  if (typeof document === 'undefined') return html;
  const parsed = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html');
  const root = parsed.body.firstElementChild;
  if (!root) return '';

  const walk = (node: Node) => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === Node.ELEMENT_NODE) {
        const el = child as HTMLElement;
        if (!MACRO_HTML_TAGS.has(el.tagName)) {
          const parent = el.parentNode;
          while (el.firstChild) parent?.insertBefore(el.firstChild, el);
          parent?.removeChild(el);
          continue;
        }
        const href = el.tagName === 'A' ? String(el.getAttribute('href') || '').trim() : '';
        for (const attr of Array.from(el.attributes)) el.removeAttribute(attr.name);
        if (el.tagName === 'A' && /^(https?:\/\/|mailto:)/i.test(href)) {
          el.setAttribute('href', href);
          el.setAttribute('target', '_blank');
          el.setAttribute('rel', 'noopener noreferrer');
        }
        walk(el);
      } else if (child.nodeType !== Node.TEXT_NODE) {
        child.parentNode?.removeChild(child);
      }
    }
  };
  walk(root);
  return root.innerHTML;
}

function markdownOrPlainToHtml(value: string): string {
  const raw = String(value || '');
  if (!raw.trim()) return '';
  if (looksLikeHtml(raw)) return sanitizeMacroHtml(raw);
  let html = escapeHtml(raw);
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/(^|[^*])\*(?!\*)(.+?)\*(?!\*)/g, '$1<em>$2</em>');
  html = html.replace(/&lt;u&gt;(.+?)&lt;\/u&gt;/gi, '<u>$1</u>');
  html = html.replace(/\n/g, '<br>');
  return html;
}

const MACRO_BODY_CLASS =
  'text-[14px] leading-6 text-[#171717] [&_strong]:font-semibold [&_b]:font-semibold [&_em]:italic [&_i]:italic [&_u]:underline [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_a]:underline [&_a]:text-[#171717] [&_p]:my-0';

function MacroFormattedBody({
  content,
  className = '',
}: {
  content: string;
  className?: string;
}) {
  const html = markdownOrPlainToHtml(content);
  if (!htmlToPlainText(html)) {
    return <p className={`text-sm text-neutral-400 ${className}`}>No content yet.</p>;
  }
  return (
    <div
      className={`${MACRO_BODY_CLASS} ${className}`}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

export default function MacrosView({
  embedded = false,
  startCreateIntent = false,
  startCreateSeed = null,
  onConsumeCreateIntent,
  listRefreshToken = 0,
  moduleResetKey = 0,
  externalSearchQuery,
  onCoworkerMessage,
  onCoworkerChatActions,
  onAgentRoute,
}: MacrosViewProps) {
  useSetPageTitle('Macros');
  const [macros, setMacros] = useState<Macro[]>([]);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [guided, setGuided] = useState<GuidedStep>(null);
  const [showForm, setShowForm] = useState(false);
  const [openMacroId, setOpenMacroId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<'updated' | 'title'>('updated');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(() =>
    Math.max(
      6,
      Math.floor(((typeof window !== 'undefined' ? window.innerHeight : 800) - 280) / FALLBACK_ROW_H)
    )
  );
  const listBoxRef = useRef<HTMLDivElement>(null);
  const [menuId, setMenuId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);
  const [deleting, setDeleting] = useState(false);
  const recentlyDeletedRef = useRef(new Set<string>());
  const pendingOpenMacroRef = useRef<{ id?: string; title?: string } | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const openMacro = macros.find((m) => m.id === openMacroId) || null;
  useReportFocusedEntity(
    openMacro
      ? { type: 'macro', id: openMacro.id, name: openMacro.title }
      : null
  );

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/macros', { credentials: 'include' });
      if (!res.ok) throw new Error('Failed');
      const rows = (await res.json()) as Macro[];
      setMacros(rows);
      const pending = pendingOpenMacroRef.current;
      if (pending) {
        pendingOpenMacroRef.current = null;
        const byId = pending.id
          ? rows.find((m) => m.id === pending.id)
          : undefined;
        const byTitle = pending.title
          ? rows.find(
              (m) =>
                String(m.title || '').trim().toLowerCase() === pending.title
            )
          : undefined;
        const hit = byId || byTitle;
        if (hit?.id) setOpenMacroId(hit.id);
      }
    } catch {
      setError('Could not load macros.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (externalSearchQuery !== undefined) setSearchQuery(externalSearchQuery);
  }, [externalSearchQuery]);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- initial catalog load
  }, []);

  useEffect(() => {
    if (!listRefreshToken) return;
    void load();
  }, [listRefreshToken]);

  const handledModuleResetKey = useRef(0);
  useEffect(() => {
    if (moduleResetKey <= handledModuleResetKey.current) return;
    handledModuleResetKey.current = moduleResetKey;
    setOpenMacroId(null);
    setShowForm(false);
    setGuided(null);
    setPendingDelete(null);
    setTitle('');
    setBody('');
  }, [moduleResetKey]);

  const startGuided = useCallback((seed?: { step?: string; title?: string; body?: string } | null) => {
    const stepRaw = String(seed?.step || 'title').trim().toLowerCase();
    const step: Exclude<GuidedStep, null> =
      stepRaw === 'body' || stepRaw === 'confirm' ? stepRaw : 'title';
    const seedTitle = String(seed?.title || '').trim();
    const seedBody = String(seed?.body || '').trim();
    const isBareStart = step === 'title' && !seedTitle && !seedBody;
    if (isBareStart) {
      setTitle('');
      setBody('');
    } else {
      if (seedTitle) setTitle(seedTitle.slice(0, TITLE_MAX));
      if (seedBody) setBody(seedBody.slice(0, BODY_MAX));
    }
    setOpenMacroId(null);
    setShowForm(false);
    setGuided(step);
  }, []);

  const cancelGuided = useCallback(() => {
    setGuided(null);
    setShowForm(false);
    setTitle('');
    setBody('');
    setPendingDelete(null);
  }, []);

  useEffect(() => {
    if (!startCreateIntent) return;
    onConsumeCreateIntent?.();
    startGuided(startCreateSeed);
  }, [startCreateIntent, startCreateSeed, onConsumeCreateIntent, startGuided]);

  const create = async (t: string, b: string): Promise<boolean> => {
    if (!t.trim() || !htmlToPlainText(b)) return false;
    setSaving(true);
    try {
      const res = await fetch('/api/macros', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: t.trim().slice(0, TITLE_MAX),
          body: sanitizeMacroHtml(b),
        }),
      });
      if (!res.ok) throw new Error('Failed');
      const created = (await res.json()) as Macro;
      setTitle('');
      setBody('');
      setGuided(null);
      setShowForm(false);
      setOpenMacroId(null);
      setError(null);
      if (created?.id) {
        setMacros((prev) => {
          const rest = prev.filter((m) => m.id !== created.id);
          return [created, ...rest];
        });
      }
      await load();
      return true;
    } catch {
      setError('Could not save macro.');
      return false;
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    setDeleting(true);
    try {
      await fetch(`/api/macros/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      setMacros((prev) => prev.filter((m) => m.id !== id));
      if (openMacroId === id) setOpenMacroId(null);
      setMenuId(null);
      recentlyDeletedRef.current.add(id);
      setPendingDelete(null);
    } catch {
      setError('Could not delete macro.');
    } finally {
      setDeleting(false);
    }
  };

  const requestDelete = (m: { id: string; title: string }) => {
    setGuided(null);
    setShowForm(false);
    setOpenMacroId(null);
    setMenuId(null);
    setPendingDelete({ kind: 'macro', id: m.id, name: m.title });
  };

  const phrase = (
    kind: string,
    fallback: string,
    context?: Record<string, string | number | boolean | null | undefined>,
    userText = ''
  ) =>
    llmOnlyReply(
      {
        module: 'macro',
        kind,
        userText,
        pageLabel: 'Macros',
        context,
      },
      fallback,
      { message: userText, page: 'Macros', allowAgentsFallback: false }
    );

  const handleChatActions = useCallback(
    async (
      actions: Record<string, unknown>[],
      meta: { reply: string; agent: string; userText: string }
    ) => {
      await onCoworkerChatActions?.(actions, meta);

      let shouldReload = false;
      for (const raw of actions) {
        const type = String(raw.type || '').toLowerCase();
        if (type === 'delete_macro') {
          const done = Boolean(raw.done || raw.refresh);
          const title = String(raw.title || raw.name || '').trim();
          const id = String(raw.id || '').trim();
          if (done) {
            setPendingDelete(null);
            setGuided(null);
            shouldReload = true;
          } else if (id || title) {
            const gone =
              (id && recentlyDeletedRef.current.has(id)) ||
              (title && recentlyDeletedRef.current.has(title.toLowerCase()));
            if (!gone) {
              setGuided(null);
              setShowForm(false);
              setOpenMacroId(null);
              setPendingDelete({
                kind: 'macro',
                id,
                name: title || 'this macro',
              });
            }
          }
          continue;
        }
        if (type === 'open_macro') {
          const mid = String(raw.id || raw.macroId || '').trim();
          const matchTitle = String(raw.title || raw.name || '')
            .trim()
            .toLowerCase();
          setGuided(null);
          setShowForm(false);
          if (mid) {
            setOpenMacroId(mid);
            pendingOpenMacroRef.current = { id: mid };
          } else if (matchTitle) {
            pendingOpenMacroRef.current = { title: matchTitle };
          }
          shouldReload = true;
          continue;
        }
        if (type !== 'create_macro') continue;
        const done = Boolean(raw.done || raw.save);
        const save = Boolean(raw.save || raw.confirm);
        const merged = mergeGuidedDraft('macro', { title, body }, raw);
        const step = normalizeGuidedAwaiting(
          'macro',
          String(raw.step || raw.awaiting || merged.awaiting || '')
        );
        const t = String(merged.fields.title || raw.title || '').trim();
        const b = String(merged.fields.body || raw.body || '').trim();
        if (t) setTitle(t.slice(0, TITLE_MAX));
        if (b) setBody(b.slice(0, BODY_MAX));
        if (done || save) {
          setGuided(null);
          setShowForm(false);
          shouldReload = true;
          const mid = String(raw.id || raw.macroId || '').trim();
          const matchTitle = String(raw.title || raw.name || '').trim().toLowerCase();
          pendingOpenMacroRef.current = mid
            ? { id: mid }
            : matchTitle
              ? { title: matchTitle }
              : null;
          continue;
        }
        const isBareStart = (!step || step === 'title') && !t && !b;
        if (isBareStart) {
          setTitle('');
          setBody('');
        }
        setOpenMacroId(null);
        setShowForm(false);
        if (step === 'body') setGuided('body');
        else if (step === 'confirm') setGuided('confirm');
        else if (!step || step === 'title') setGuided('title');
      }
      if (shouldReload) await load();
    },
    [onCoworkerChatActions, title, body]
  );

  const handleChatMessage = useCallback(
    async (raw: string): Promise<string | null> => {
      const text = raw.trim();
      if (onCoworkerMessage) return onCoworkerMessage(text);
      return phrase(
        'unavailable',
        'Chat is temporarily unavailable. Use the macro form on the right, or try again shortly.',
        { chatUnavailable: true },
        text
      );
    },
    [onCoworkerMessage, phrase]
  );

  const getChatContext = useCallback(() => {
    const focus = openMacro
      ? { type: 'macro' as const, id: openMacro.id, name: openMacro.title }
      : undefined;
    if (!guided) {
      return {
        module: 'macros',
        surface: openMacroId ? 'detail' : 'list',
        draft: openMacro
          ? {
              title: openMacro.title || undefined,
              body: openMacro.body || undefined,
              id: openMacro.id,
            }
          : null,
        focusedEntity: focus,
      };
    }
    return {
      module: 'macros',
      surface: 'create',
      draft: {
        awaiting: guided,
        title: title || undefined,
        body: body || undefined,
      },
      focusedEntity: focus,
    };
  }, [guided, title, body, openMacroId, openMacro]);

  const readEditorHtml = () => sanitizeMacroHtml(bodyRef.current?.innerHTML || '');

  const applyFormat = (command: string, value?: string) => {
    const el = bodyRef.current;
    el?.focus();
    document.execCommand(command, false, value);
    const next = readEditorHtml();
    if (htmlToPlainText(next).length > BODY_MAX) return;
    setBody(next);
  };

  const applyLink = () => {
    const raw = window.prompt('Link URL', 'https://');
    if (!raw) return;
    const href = raw.trim();
    if (!/^(https?:\/\/|mailto:)/i.test(href)) return;
    applyFormat('createLink', href);
  };

  useLayoutEffect(() => {
    const el = bodyRef.current;
    if (!el || !showForm) return;
    if (document.activeElement === el) return;
    const next = markdownOrPlainToHtml(body);
    if (el.innerHTML !== next) el.innerHTML = next;
  }, [body, showForm]);

  const sorted = useMemo(() => {
    const needle = searchQuery.trim().toLowerCase();
    const copy = macros.filter((m) => {
      if (!needle) return true;
      return (
        m.title.toLowerCase().includes(needle) ||
        m.body.toLowerCase().includes(needle) ||
        String(m.createdByName || '').toLowerCase().includes(needle)
      );
    });
    if (sortBy === 'title') {
      copy.sort((a, b) => a.title.localeCompare(b.title));
    } else {
      copy.sort((a, b) => {
        const ta = new Date(a.updatedAt || a.createdAt || 0).getTime();
        const tb = new Date(b.updatedAt || b.createdAt || 0).getTime();
        return tb - ta;
      });
    }
    return copy;
  }, [macros, sortBy, searchQuery]);

  const recentMacros = useMemo(() => {
    return [...macros]
      .sort((a, b) => {
        const ta = new Date(a.updatedAt || a.createdAt || 0).getTime();
        const tb = new Date(b.updatedAt || b.createdAt || 0).getTime();
        return tb - ta;
      })
      .slice(0, 5);
  }, [macros]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / Math.max(1, pageSize)));
  const safePage = Math.min(page, totalPages);
  const pageMacros = sorted.slice((safePage - 1) * pageSize, safePage * pageSize);
  const from = sorted.length === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const to = Math.min(safePage * pageSize, sorted.length);

  useEffect(() => {
    setPage(1);
  }, [searchQuery, sortBy, macros.length]);

  useLayoutEffect(() => {
    const box = listBoxRef.current;
    if (!box || loading) return;
    const measure = () => {
      const first = box.querySelector('#macros-list > li');
      const rowH =
        first instanceof HTMLElement && first.offsetHeight > 0
          ? first.offsetHeight
          : FALLBACK_ROW_H;
      const boxH = box.clientHeight;
      if (boxH <= 0 || rowH <= 0) return;
      const allFit = sorted.length * rowH <= boxH + 1;
      const next = allFit
        ? Math.max(sorted.length, 1)
        : Math.max(1, Math.floor((boxH - PAGER_H) / rowH));
      setPageSize((prev) => (prev === next ? prev : next));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(box);
    return () => ro.disconnect();
  }, [loading, sorted.length]);

  const formPanel = (
    <div
      className={
        showForm
          ? 'flex h-full min-h-0 w-full flex-col'
          : openMacro
            ? 'flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden p-3 sm:p-4'
            : 'flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden'
      }
    >
      {openMacro ? (
        <>
          <MacroDetailFocus />
          <div className="mb-3 flex shrink-0 items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => setOpenMacroId(null)}
              className="inline-flex h-[38px] items-center gap-1.5 rounded-lg border-[0.6px] border-[#bfbfbf] bg-white px-3 text-sm font-semibold text-neutral-800 shadow-none hover:bg-neutral-50"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Back to list
            </button>
            <button
              type="button"
              title="Delete"
              onClick={() => requestDelete(openMacro)}
              className="inline-flex size-[38px] items-center justify-center rounded-lg border-[0.6px] border-[#bfbfbf] bg-white text-neutral-500 shadow-none hover:bg-neutral-50 hover:text-neutral-900"
            >
              <Trash2 className="h-[18px] w-[18px]" strokeWidth={2.25} />
            </button>
          </div>
          {error && (
            <div className="mb-3 flex shrink-0 items-center gap-2 rounded-xl border border-neutral-300 bg-neutral-100 px-3 py-2 text-xs text-neutral-800">
              <AlertTriangle className="h-3.5 w-3.5" />
              {error}
            </div>
          )}
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border-[0.6px] border-[#bfbfbf] bg-white shadow-none">
            <div className="shrink-0 border-b border-[#e5e5e5] px-4 py-3.5">
              <h2 className="break-words text-base font-semibold text-neutral-900">
                {openMacro.title}
              </h2>
              {openMacro.createdByName ? (
                <p className="mt-0.5 text-sm text-neutral-500">
                  Created by {openMacro.createdByName}
                </p>
              ) : null}
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
              <MacroFormattedBody content={openMacro.body} />
            </div>
          </div>
        </>
      ) : showForm ? (
        <div className="flex min-h-0 flex-1 flex-col bg-white">
      {error && (
            <div className="mx-4 mt-3 flex shrink-0 items-center gap-2 rounded-xl border border-neutral-300 bg-neutral-100 px-3 py-2 text-xs text-neutral-800 sm:mx-5">
          <AlertTriangle className="h-3.5 w-3.5" />
          {error}
        </div>
      )}

          <div className="flex shrink-0 items-center gap-2.5 border-b border-neutral-100 px-4 py-2.5 sm:px-5">
            <button
              type="button"
              onClick={() => {
                setTitle('');
                setBody('');
                setGuided(null);
                setShowForm(false);
                setError(null);
              }}
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-neutral-200 text-neutral-600 hover:bg-neutral-50 hover:text-neutral-900"
              aria-label="Back to macros"
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-neutral-900">
                {guided ? `Create macro · ${guided}` : 'New macro'}
              </p>
              <p className="truncate text-[11px] text-neutral-500">
                Title + body required
              </p>
            </div>
          </div>

          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-3 sm:px-5">
            <label className="block shrink-0">
              <div className="mb-1 flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-neutral-800">Title</span>
                <span className="text-[10px] tabular-nums text-neutral-400">
                  {title.length}/{TITLE_MAX}
                </span>
              </div>
        <input
                ref={titleRef}
          value={title}
                maxLength={TITLE_MAX}
                onChange={(e) => setTitle(e.target.value.slice(0, TITLE_MAX))}
                placeholder="e.g. Password reset steps"
                className="h-10 w-full rounded-lg border border-neutral-200 bg-neutral-50 px-3 text-sm text-neutral-900 placeholder:text-neutral-400 transition-colors focus:border-neutral-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-neutral-200/70"
              />
            </label>

            <label className="block shrink-0">
              <div className="mb-1 flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-neutral-800">Reply body</span>
                <span className="text-[10px] tabular-nums text-neutral-400">
                  {htmlToPlainText(body).length}/{BODY_MAX}
                </span>
              </div>
              <div className="overflow-hidden rounded-lg border border-neutral-200 focus-within:border-neutral-400 focus-within:ring-2 focus-within:ring-neutral-200/70">
                <div
                  ref={bodyRef}
                  role="textbox"
                  aria-label="Reply body"
                  aria-multiline="true"
                  contentEditable
                  data-placeholder="Write the reply agents can reuse…"
                  onInput={() => {
                    const next = readEditorHtml();
                    if (htmlToPlainText(next).length > BODY_MAX) {
                      const el = bodyRef.current;
                      if (el) el.innerHTML = markdownOrPlainToHtml(body);
                      return;
                    }
                    setBody(next);
                  }}
                  className={`min-h-36 w-full resize-y bg-transparent px-3 py-2.5 outline-none sm:min-h-40 empty:before:pointer-events-none empty:before:text-neutral-400 empty:before:content-[attr(data-placeholder)] ${MACRO_BODY_CLASS}`}
                />
                <div className="flex flex-wrap items-center gap-0.5 border-t border-neutral-100 bg-neutral-50 px-1 py-1">
                  {(
                    [
                      { title: 'Bold', icon: Bold, run: () => applyFormat('bold') },
                      { title: 'Italic', icon: Italic, run: () => applyFormat('italic') },
                      { title: 'Underline', icon: Underline, run: () => applyFormat('underline') },
                      { title: 'Bulleted list', icon: List, run: () => applyFormat('insertUnorderedList') },
                      {
                        title: 'Numbered list',
                        icon: ListOrdered,
                        run: () => applyFormat('insertOrderedList'),
                      },
                      { title: 'Link', icon: LinkIcon, run: applyLink },
                      { title: 'Emoji', icon: Smile, run: () => applyFormat('insertText', ' 🙂') },
                    ] as const
                  ).map((tool) => (
                    <button
                      key={tool.title}
                      type="button"
                      title={tool.title}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={tool.run}
                      className="inline-flex h-7 w-7 items-center justify-center rounded-md text-neutral-600 hover:bg-white hover:text-neutral-900"
                    >
                      <tool.icon className="h-3.5 w-3.5" />
                    </button>
                  ))}
                </div>
              </div>
            </label>

            {(title.trim() || htmlToPlainText(body)) && (
              <div className="shrink-0 rounded-lg border border-dashed border-neutral-200 bg-neutral-50/80 px-3 py-2.5">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-neutral-400">
                  Preview
                </p>
                <p className="mt-1 truncate text-sm font-semibold text-neutral-900">
                  {title.trim() || 'Untitled macro'}
                </p>
                {htmlToPlainText(body) ? (
                  <div className="mt-1 max-h-24 overflow-y-auto text-xs leading-relaxed text-neutral-600">
                    <MacroFormattedBody content={body} />
                  </div>
                ) : (
                  <p className="mt-1 text-xs text-neutral-400">Reply body will appear here.</p>
                )}
              </div>
            )}

            <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-neutral-200 bg-neutral-50/40">
              <div className="flex shrink-0 items-center justify-between gap-2 border-b border-neutral-100 px-3 py-2">
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-neutral-800">Recently created</p>
                  <p className="text-[10px] text-neutral-400">
                    From your org macros · click to view
                  </p>
                </div>
                {recentMacros.length > 0 ? (
                  <span className="inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-white px-1.5 text-[10px] font-semibold tabular-nums text-neutral-600 ring-1 ring-neutral-200">
                    {Math.min(recentMacros.length, 5)}
                  </span>
                ) : null}
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto">
                {loading ? (
                  <ul className="space-y-2 p-2.5">
                    {Array.from({ length: 3 }).map((_, i) => (
                      <li
                        // eslint-disable-next-line react/no-array-index-key
                        key={i}
                        className="h-12 animate-pulse rounded-lg bg-neutral-100"
                      />
                    ))}
                  </ul>
                ) : recentMacros.length === 0 ? (
                  <div className="flex h-full min-h-[6rem] flex-col items-center justify-center px-4 py-6 text-center">
                    <MessageSquareText className="h-5 w-5 text-neutral-300" />
                    <p className="mt-2 text-xs font-medium text-neutral-600">No macros yet</p>
                    <p className="mt-0.5 text-[11px] text-neutral-400">
                      Save this one and it will show up here.
                    </p>
                  </div>
                ) : (
                  <ul className="divide-y divide-[#e5e5e5]">
                    {recentMacros.map((m) => {
                      const when = relativeWhen(m.updatedAt || m.createdAt);
                      return (
                        <li key={m.id}>
                          <button
                            type="button"
                            onClick={() => {
                              setShowForm(false);
                              setGuided(null);
                              setTitle('');
                              setBody('');
                              setOpenMacroId(m.id);
                            }}
                            className="flex w-full items-start gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-white"
                          >
                            <span className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-white text-neutral-600 ring-1 ring-neutral-200">
                              <MessageSquareText className="h-3.5 w-3.5" />
                            </span>
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-xs font-semibold text-neutral-900">
                                {m.title}
                              </p>
                              <p className="mt-0.5 line-clamp-1 text-[11px] text-neutral-500">
                                {m.body}
                              </p>
                              {when ? (
                                <p className="mt-1 text-[10px] text-neutral-400">
                                  Updated {when}
                                </p>
                              ) : null}
                            </div>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </section>
          </div>

          <div className="mt-auto flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-neutral-100 bg-neutral-50/80 px-4 py-2.5 sm:px-5">
            <button
              type="button"
              onClick={() => {
                setTitle('');
                setBody('');
                setGuided(null);
                setShowForm(false);
                setError(null);
              }}
              className="inline-flex h-9 items-center rounded-lg border border-neutral-200 bg-white px-3 text-xs font-semibold text-neutral-700 hover:bg-neutral-50"
            >
              Cancel
            </button>
        <button
          type="button"
          disabled={saving || !title.trim() || !htmlToPlainText(body)}
              onClick={() => void create(title, body)}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-neutral-900 px-3.5 text-xs font-semibold text-white hover:bg-neutral-800 disabled:cursor-not-allowed disabled:bg-neutral-300 disabled:text-white"
        >
              <Save className="h-3.5 w-3.5" />
              {saving ? 'Saving…' : 'Save macro'}
        </button>
      </div>
        </div>
      ) : (
        <PageShell embedded fillHeight>
          {error && (
            <div className="mb-3 flex shrink-0 items-center gap-2 rounded-xl border border-neutral-300 bg-neutral-100 px-3 py-2 text-xs text-neutral-800">
              <AlertTriangle className="h-3.5 w-3.5" />
              {error}
            </div>
          )}

          <section className="flex min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden bg-white shadow-none">
            <div className="shrink-0 min-w-0 border-b border-[#e5e5e5] bg-neutral-50/70 p-2.5 font-sans">
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
                  <Filter className="h-3.5 w-3.5 text-neutral-400" />
                  <span>Filters</span>
                  {!loading ? (
                    <span className="normal-case tracking-normal tabular-nums text-neutral-400">
                      {sorted.length}
                    </span>
                  ) : null}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setOpenMacroId(null);
                    setGuided(null);
                    setError(null);
                    setShowForm(true);
                    window.requestAnimationFrame(() => titleRef.current?.focus());
                  }}
                  className="inline-flex h-[38px] shrink-0 items-center gap-1.5 rounded-lg bg-[#111111] px-3 text-sm font-semibold text-white shadow-none hover:bg-neutral-800"
                >
                  <Plus className="h-[18px] w-[18px]" strokeWidth={2.25} />
                  New macro
                </button>
              </div>

              <div className="relative mb-2">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-neutral-400" />
                <input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search macros..."
                  aria-label="Search macros"
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
                label="Sort macros"
                value={sortBy}
                options={[
                  { value: 'updated', label: 'Recently updated' },
                  { value: 'title', label: 'Title A–Z' },
                ]}
                onChange={(v) => setSortBy(v as 'updated' | 'title')}
              />
            </div>

            <div
              ref={listBoxRef}
              className="flex min-h-0 flex-1 flex-col overflow-hidden"
            >
            <div
              id="macros-list-scroll"
              className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain [scrollbar-gutter:stable]"
            >
              {loading ? (
                <p className="px-4 py-16 text-center text-sm text-neutral-400">Loading…</p>
              ) : sorted.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-2 px-4 py-16 text-center">
                  <AlertTriangle className="h-5 w-5 shrink-0 text-neutral-700" />
                  <p className="max-w-sm text-sm font-medium text-neutral-700">
                    {searchQuery.trim() ? 'No matching macros' : 'No macros yet'}
                  </p>
                  {!searchQuery.trim() ? (
                    <div className="mt-2 flex flex-wrap justify-center gap-1.5">
                      {['Password reset steps', 'Apology for delay', 'Escalation handoff'].map(
                        (starter) => (
                          <button
                            key={starter}
                            type="button"
                            onClick={() => {
                              setTitle(starter);
                              setBody('');
                              setGuided(null);
                              setError(null);
                              setShowForm(true);
                              window.requestAnimationFrame(() => bodyRef.current?.focus());
                            }}
                            className="inline-flex h-[38px] items-center rounded-lg border-[0.6px] border-[#bfbfbf] bg-white px-3 text-sm font-medium text-neutral-700 shadow-none hover:bg-neutral-50"
                          >
                            {starter}
                          </button>
                        )
                      )}
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setSearchQuery('')}
                      className="text-sm font-semibold text-neutral-800 underline-offset-2 hover:underline"
                    >
                      Clear search
                    </button>
                  )}
                </div>
              ) : (
                  <ul id="macros-list" className="divide-y divide-[#e5e5e5]">
                    {pageMacros.map((m) => {
                      const when = relativeWhen(m.updatedAt || m.createdAt);
                      const preview = htmlToPlainText(m.body);
                      const meta = [preview, m.createdByName ? `By ${m.createdByName}` : '']
                        .filter(Boolean)
                        .join('  ·  ');
                      return (
                        <li key={m.id} className="group relative min-w-0">
                          <button
                            type="button"
                            onClick={() => setOpenMacroId(m.id)}
                            className="grid w-full min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1.5 px-4 py-3.5 pr-12 text-left transition-colors hover:bg-neutral-50"
                          >
                            <span className="min-w-0 truncate text-sm font-semibold text-neutral-900">
                              {m.title}
                            </span>
                            <span className="shrink-0 font-mono text-[11px] tabular-nums text-neutral-400">
                              {when || '—'}
                            </span>
                            <p
                              className="col-start-1 col-span-2 min-w-0 truncate text-sm text-neutral-500"
                              title={meta}
                            >
                              {meta || '—'}
                            </p>
                          </button>

                          <div className="absolute right-2 top-3">
                            <button
                              type="button"
                              aria-label="Macro actions"
                              onClick={(e) => {
                                e.stopPropagation();
                                setMenuId(menuId === m.id ? null : m.id);
                              }}
                              className="inline-flex size-[38px] items-center justify-center rounded-lg text-neutral-400 opacity-0 transition-opacity hover:bg-neutral-100 hover:text-neutral-900 focus:opacity-100 group-hover:opacity-100"
                            >
                              <MoreVertical className="h-[18px] w-[18px]" strokeWidth={2.25} />
                            </button>
                            {menuId === m.id ? (
                              <div className="absolute right-0 top-10 z-10 min-w-[8rem] rounded-lg border-[0.6px] border-[#bfbfbf] bg-white py-1 shadow-none">
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setOpenMacroId(m.id);
                                    setMenuId(null);
                                  }}
                                  className="w-full px-3 py-2 text-left text-sm text-neutral-800 hover:bg-neutral-50"
                                >
                                  View
                                </button>
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    requestDelete(m);
                                    setMenuId(null);
                                  }}
                                  className="w-full px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50"
                                >
                                  Delete
                                </button>
                              </div>
                            ) : null}
                          </div>
              </li>
                      );
                    })}
          </ul>
        )}
      </div>
              {!loading && sorted.length > 0 && totalPages > 1 ? (
                <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-[#e5e5e5] px-4 py-2.5">
                  <p className="text-[11px] text-neutral-500">
                    {from}–{to} of {sorted.length}
                  </p>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      disabled={safePage <= 1}
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                      className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-neutral-200 text-neutral-700 disabled:opacity-40"
                      aria-label="Previous page"
                    >
                      <ChevronLeft className="h-3.5 w-3.5" />
                    </button>
                    {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => i + 1).map(
                      (n) => {
                        const active = n === safePage;
                        return (
                          <button
                            key={n}
                            type="button"
                            onClick={() => setPage(n)}
                            aria-current={active ? 'page' : undefined}
                            className={`inline-flex h-7 min-w-[1.75rem] items-center justify-center rounded-lg px-1.5 text-[11px] font-semibold ${
                              active
                                ? 'bg-neutral-900 text-white'
                                : 'border border-neutral-200 text-neutral-700 hover:bg-neutral-50'
                            }`}
                          >
                            {n}
                          </button>
                        );
                      }
                    )}
                    <button
                      type="button"
                      disabled={safePage >= totalPages}
                      onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                      className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-neutral-200 text-neutral-700 disabled:opacity-40"
                      aria-label="Next page"
                    >
                      <ChevronRight className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          </section>
        </PageShell>
      )}
    </div>
  );

  if (onCoworkerMessage || onCoworkerChatActions) {
    const guidedActive = Boolean(guided) && !showForm && !openMacro;
    const deleteActive = Boolean(pendingDelete);
    return (
      <CoworkerSplitWorkspace
        pageLabel="Macros"
        contentTitle={
          deleteActive || guidedActive
            ? 'Next steps'
            : showForm
              ? 'New macro'
              : openMacroId
                ? 'Macro'
                : 'Macros'
        }
        onUserMessage={handleChatMessage}
        onChatActions={handleChatActions}
        onAgentRoute={onAgentRoute}
        onChatRestart={cancelGuided}
        getChatContext={getChatContext}
        module="macros"
        surface={guided || showForm ? 'create' : openMacroId ? 'detail' : 'list'}
        onDraftPatch={(patch) => {
          const awaiting = String(patch.awaiting || patch.step || '')
            .trim()
            .toLowerCase();
          const type =
            awaiting === 'delete_confirm' ? 'delete_macro' : 'create_macro';
          void handleChatActions(
            [{ type, ...patch, step: awaiting === 'delete_confirm' ? 'confirm' : patch.step }],
            { reply: '', agent: 'macros', userText: '' }
          );
        }}
        suggestionChips={
          deleteActive
            ? ['confirm', 'cancel']
            : guidedActive
            ? guided === 'confirm'
              ? ['confirm', 'cancel']
              : ['cancel']
            : ['write macros', 'list macros', 'my tickets']
        }
        placeholder="Create a macro or ask about snippets…"
        contentHeaderActions={
          guidedActive && !deleteActive ? (
            <button
              type="button"
              onClick={() => setShowForm(true)}
              className="inline-flex items-center h-8 px-2.5 rounded-lg border border-neutral-200 bg-white text-xs font-semibold text-neutral-800 hover:bg-neutral-50"
            >
              Use form
            </button>
          ) : null
        }
      >
        {deleteActive && pendingDelete ? (
          <GuidedDeletePreview
            pending={pendingDelete}
            deleting={deleting}
            onCancel={() => setPendingDelete(null)}
            onConfirm={() => {
              void remove(pendingDelete.id);
            }}
          />
        ) : guidedActive ? (
          <GuidedMacroPreview
            draft={{ title, body }}
            stepIndex={macroStepIndex(guided || 'title')}
            saving={saving}
            onCancel={cancelGuided}
            onUseForm={() => setShowForm(true)}
            onConfirmCreate={() => {
              void create(title, body);
            }}
          />
        ) : (
          formPanel
        )}
      </CoworkerSplitWorkspace>
    );
  }

  if (embedded) return formPanel;
  return <PageShell fillHeight>{formPanel}</PageShell>;
}
