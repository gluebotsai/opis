import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  Bold,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
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
} from 'lucide-react';
import { useSetPageTitle } from './layout/PageTitleContext';
import PageShell from './layout/PageShell';
import CoworkerSplitWorkspace, {
  useCoworkerSplitExpandOptional,
} from './coworker/CoworkerSplitWorkspace';
import { llmOnlyReply } from './coworker/llmGuidedReply';
import {
  useReportFocusedEntity,
  useCoworkerSendUserText,
} from './coworker/CoworkerSessionContext';
import GuidedDeletePreview, {
  type PendingDelete,
} from './coworker/GuidedDeletePreview';
import { KbArticleBody } from './KnowledgeBaseView';

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
  const hasBody = Boolean(draft.body.trim());
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
                      {draft.body.trim() ? (
                        <KbArticleBody content={draft.body} compact />
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
                        <KbArticleBody content={draft.body} compact />
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
const PAGE_SIZE = 5;

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

function wrapSelection(
  value: string,
  start: number,
  end: number,
  before: string,
  after: string
): string {
  const selected = value.slice(start, end) || 'text';
  return value.slice(0, start) + before + selected + after + value.slice(end);
}

export default function MacrosView({
  embedded = false,
  startCreateIntent = false,
  startCreateSeed = null,
  onConsumeCreateIntent,
  listRefreshToken = 0,
  externalSearchQuery,
  onCoworkerMessage,
  onCoworkerChatActions,
  onAgentRoute,
}: MacrosViewProps) {
  useSetPageTitle('Macros');
  const sendUserText = useCoworkerSendUserText();
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
  const [menuId, setMenuId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);
  const [deleting, setDeleting] = useState(false);
  const recentlyDeletedRef = useRef(new Set<string>());
  const pendingOpenMacroRef = useRef<{ id?: string; title?: string } | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
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
    if (!t.trim() || !b.trim()) return false;
    setSaving(true);
    try {
      const res = await fetch('/api/macros', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: t.trim().slice(0, TITLE_MAX),
          body: b.trim().slice(0, BODY_MAX),
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
    void sendUserText?.(`delete macro ${m.title}`);
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
        const step = String(raw.step || '')
          .trim()
          .toLowerCase();
        const t = String(raw.title || '').trim();
        const b = String(raw.body || '').trim();
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
    [onCoworkerChatActions]
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
    if (pendingDelete) {
      return {
        module: 'macros',
        surface: 'list',
        draft: {
          awaiting: 'delete_confirm',
          title: pendingDelete.name || undefined,
          id: pendingDelete.id || undefined,
        },
        focusedEntity: pendingDelete.id
          ? { type: 'macro' as const, id: pendingDelete.id, name: pendingDelete.name }
          : focus,
      };
    }
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
  }, [pendingDelete, guided, title, body, openMacroId, openMacro]);

  const applyWrap = (before: string, after: string) => {
    const el = bodyRef.current;
    const start = el?.selectionStart ?? body.length;
    const end = el?.selectionEnd ?? body.length;
    const next = wrapSelection(body, start, end, before, after).slice(0, BODY_MAX);
    setBody(next);
    window.requestAnimationFrame(() => {
      el?.focus();
      const pos = start + before.length + (end - start || 4);
      el?.setSelectionRange(pos, pos);
    });
  };

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

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageMacros = sorted.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  const from = sorted.length === 0 ? 0 : (safePage - 1) * PAGE_SIZE + 1;
  const to = Math.min(safePage * PAGE_SIZE, sorted.length);

  useEffect(() => {
    setPage(1);
  }, [searchQuery, sortBy, macros.length]);

  const formPanel = (
    <div
      className={
        showForm
          ? 'flex h-full min-h-0 w-full flex-col'
          : 'mx-auto flex h-full min-h-0 w-full max-w-3xl flex-col px-5 py-5 sm:px-6'
      }
    >
      {openMacro ? (
        <>
          <MacroDetailFocus />
          <div className="mb-4 flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => setOpenMacroId(null)}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-neutral-600 hover:text-neutral-900"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Back to list
            </button>
            <button
              type="button"
              title="Delete"
              onClick={() => requestDelete(openMacro)}
              className="rounded-lg p-1.5 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-900"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
          {error && (
            <div className="mb-4 flex items-center gap-2 rounded-xl border border-neutral-300 bg-neutral-100 px-3 py-2 text-xs text-neutral-800">
              <AlertTriangle className="h-3.5 w-3.5" />
              {error}
            </div>
          )}
          <div className="space-y-3 rounded-2xl border border-neutral-200 bg-neutral-50/60 px-5 py-5">
            <div className="flex items-start gap-3">
              <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-neutral-900 text-white">
                <MessageSquareText className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1">
                <h2 className="break-words text-base font-semibold text-neutral-900">
                  {openMacro.title}
                </h2>
                {openMacro.createdByName ? (
                  <p className="mt-0.5 text-[11px] text-neutral-400">
                    Created by {openMacro.createdByName}
                  </p>
                ) : null}
              </div>
            </div>
            <div className="rounded-xl border border-neutral-200 bg-white px-4 py-3.5">
              <KbArticleBody content={openMacro.body} compact />
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
                  {body.length}/{BODY_MAX}
                </span>
              </div>
              <div className="overflow-hidden rounded-lg border border-neutral-200 focus-within:border-neutral-400 focus-within:ring-2 focus-within:ring-neutral-200/70">
        <textarea
                  ref={bodyRef}
          value={body}
                  maxLength={BODY_MAX}
                  onChange={(e) => setBody(e.target.value.slice(0, BODY_MAX))}
                  placeholder="Write the reply agents can reuse…"
                  rows={6}
                  className="h-36 w-full resize-y bg-transparent px-3 py-2.5 text-sm leading-relaxed text-neutral-900 placeholder:text-neutral-400 outline-none sm:h-40"
                />
                <div className="flex flex-wrap items-center gap-0.5 border-t border-neutral-100 bg-neutral-50 px-1 py-1">
                  {(
                    [
                      { title: 'Bold', icon: Bold, run: () => applyWrap('**', '**') },
                      { title: 'Italic', icon: Italic, run: () => applyWrap('*', '*') },
                      { title: 'Underline', icon: Underline, run: () => applyWrap('<u>', '</u>') },
                      { title: 'Bulleted list', icon: List, run: () => applyWrap('\n- ', '') },
                      {
                        title: 'Numbered list',
                        icon: ListOrdered,
                        run: () => applyWrap('\n1. ', ''),
                      },
                      { title: 'Link', icon: LinkIcon, run: () => applyWrap('[', '](url)') },
                      { title: 'Emoji', icon: Smile, run: () => applyWrap('', ' 🙂') },
                    ] as const
                  ).map((tool) => (
                    <button
                      key={tool.title}
                      type="button"
                      title={tool.title}
                      onClick={tool.run}
                      className="inline-flex h-7 w-7 items-center justify-center rounded-md text-neutral-600 hover:bg-white hover:text-neutral-900"
                    >
                      <tool.icon className="h-3.5 w-3.5" />
                    </button>
                  ))}
                </div>
              </div>
            </label>

            {(title.trim() || body.trim()) && (
              <div className="shrink-0 rounded-lg border border-dashed border-neutral-200 bg-neutral-50/80 px-3 py-2.5">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-neutral-400">
                  Preview
                </p>
                <p className="mt-1 truncate text-sm font-semibold text-neutral-900">
                  {title.trim() || 'Untitled macro'}
                </p>
                {body.trim() ? (
                  <div className="mt-1 max-h-24 overflow-y-auto text-xs leading-relaxed text-neutral-600">
                    <KbArticleBody content={body} compact />
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
                  <ul className="divide-y divide-neutral-100">
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
          disabled={saving || !title.trim() || !body.trim()}
              onClick={() => void create(title, body)}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-neutral-900 px-3.5 text-xs font-semibold text-white hover:bg-neutral-800 disabled:cursor-not-allowed disabled:bg-neutral-300 disabled:text-white"
        >
              <Save className="h-3.5 w-3.5" />
              {saving ? 'Saving…' : 'Save macro'}
        </button>
      </div>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-4">
          <header className="shrink-0 space-y-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2.5">
                <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-neutral-900 text-white">
                  <MessageSquareText className="h-4 w-4" />
                </span>
                <div className="min-w-0">
                  <h1 className="text-lg font-semibold tracking-tight text-neutral-900">
                    Macros
                  </h1>
                  <p className="text-[13px] text-neutral-500">
                    Reusable reply snippets for notes and customer messages.
                  </p>
                </div>
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
                className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-xl bg-neutral-900 px-3.5 text-xs font-semibold text-white hover:bg-neutral-800"
              >
                <Plus className="h-3.5 w-3.5" />
                New macro
              </button>
            </div>

            {!loading && macros.length === 0 ? (
              <div className="flex flex-wrap gap-1.5">
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
                      className="inline-flex h-7 items-center rounded-full border border-neutral-200 bg-white px-2.5 text-[11px] font-medium text-neutral-600 hover:border-neutral-300 hover:bg-neutral-50 hover:text-neutral-900"
                    >
                      {starter}
                </button>
                  )
                )}
              </div>
            ) : null}
          </header>

          {error && (
            <div className="flex shrink-0 items-center gap-2 rounded-xl border border-neutral-300 bg-neutral-100 px-3 py-2 text-xs text-neutral-800">
              <AlertTriangle className="h-3.5 w-3.5" />
              {error}
            </div>
          )}

          <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-sm">
            <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-neutral-100 px-4 py-3">
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <h2 className="text-sm font-semibold text-neutral-900">Your macros</h2>
                {!loading ? (
                  <span className="inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-neutral-100 px-1.5 text-[10px] font-semibold tabular-nums text-neutral-600">
                    {sorted.length}
                  </span>
                ) : null}
              </div>
              <label className="relative min-w-0 flex-1 sm:w-44 sm:flex-none">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-neutral-400" />
                <input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search…"
                  aria-label="Search macros"
                  className="h-8 w-full rounded-lg border border-neutral-200 bg-neutral-50 pl-8 pr-2.5 text-xs placeholder:text-neutral-400 focus:border-neutral-300 focus:bg-white focus:outline-none"
                />
              </label>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as 'updated' | 'title')}
                aria-label="Sort macros"
                className="h-8 rounded-lg border border-neutral-200 bg-neutral-50 px-2 text-xs text-neutral-700 focus:bg-white focus:outline-none"
              >
                <option value="updated">Recently updated</option>
                <option value="title">Title A–Z</option>
              </select>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto">
              {loading ? (
                <ul className="space-y-2 p-3">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <li
                      // eslint-disable-next-line react/no-array-index-key
                      key={i}
                      className="flex items-start gap-3 rounded-xl border border-neutral-100 bg-neutral-50/80 p-3"
                    >
                      <div className="h-9 w-9 shrink-0 animate-pulse rounded-lg bg-neutral-200" />
                      <div className="min-w-0 flex-1 space-y-2">
                        <div className="h-3.5 w-2/5 animate-pulse rounded bg-neutral-200" />
                        <div className="h-3 w-full animate-pulse rounded bg-neutral-100" />
                        <div className="h-3 w-3/4 animate-pulse rounded bg-neutral-100" />
                      </div>
              </li>
            ))}
          </ul>
              ) : sorted.length === 0 ? (
                <div className="flex h-full min-h-[14rem] flex-col items-center justify-center px-6 py-10 text-center">
                  <div className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-dashed border-neutral-300 bg-neutral-50 text-neutral-400">
                    <MessageSquareText className="h-5 w-5" />
                  </div>
                  <h3 className="mt-3 text-sm font-semibold text-neutral-900">
                    {searchQuery.trim() ? 'No matching macros' : 'No macros yet'}
                  </h3>
                  <p className="mt-1 max-w-[240px] text-xs leading-relaxed text-neutral-500">
                    {searchQuery.trim()
                      ? 'Try a different search, or clear the filter.'
                      : 'Save common replies once, then reuse them on any ticket.'}
                  </p>
                  {searchQuery.trim() ? (
                    <button
                      type="button"
                      onClick={() => setSearchQuery('')}
                      className="mt-4 text-xs font-semibold text-neutral-800 underline-offset-2 hover:underline"
                    >
                      Clear search
                    </button>
                  ) : (
                    <p className="mt-4 text-[11px] text-neutral-400">
                      Tip: ask the co-worker “write macros” or use{' '}
                      <span className="font-medium text-neutral-600">New macro</span> above.
                    </p>
                  )}
                </div>
              ) : (
                <>
                  <ul className="divide-y divide-neutral-100">
                    {pageMacros.map((m) => {
                      const when = relativeWhen(m.updatedAt || m.createdAt);
                      return (
                        <li key={m.id} className="group relative">
                          <button
                            type="button"
                            onClick={() => setOpenMacroId(m.id)}
                            className="flex w-full items-start gap-3 px-4 py-3.5 text-left transition-colors hover:bg-neutral-50"
                          >
                            <span className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-neutral-100 text-neutral-700 group-hover:bg-neutral-200/80">
                              <MessageSquareText className="h-4 w-4" />
                            </span>
                            <div className="min-w-0 flex-1 pr-8">
                              <p className="truncate text-sm font-semibold text-neutral-900">
                                {m.title}
                              </p>
                              <p className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-neutral-500">
                                {m.body}
                              </p>
                              <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-neutral-400">
                                {when ? <span>Updated {when}</span> : null}
                                {when && m.createdByName ? (
                                  <span className="text-neutral-300">·</span>
                                ) : null}
                                {m.createdByName ? <span>By {m.createdByName}</span> : null}
                              </div>
                            </div>
                          </button>

                          <div className="absolute right-2 top-3">
                            <button
                              type="button"
                              aria-label="Macro actions"
                              onClick={(e) => {
                                e.stopPropagation();
                                setMenuId(menuId === m.id ? null : m.id);
                              }}
                              className="rounded-lg p-1.5 text-neutral-400 opacity-0 transition-opacity hover:bg-neutral-100 hover:text-neutral-900 focus:opacity-100 group-hover:opacity-100"
                            >
                              <MoreVertical className="h-4 w-4" />
                            </button>
                            {menuId === m.id ? (
                              <div className="absolute right-0 top-9 z-10 min-w-[8rem] rounded-xl border border-neutral-200 bg-white py-1 shadow-md">
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setOpenMacroId(m.id);
                                    setMenuId(null);
                                  }}
                                  className="w-full px-3 py-1.5 text-left text-xs text-neutral-800 hover:bg-neutral-50"
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
                                  className="w-full px-3 py-1.5 text-left text-xs text-red-600 hover:bg-red-50"
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
                  {totalPages > 1 ? (
                    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-neutral-100 px-4 py-2.5">
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
                </>
        )}
      </div>
          </section>
        </div>
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
  return <PageShell>{formPanel}</PageShell>;
}
