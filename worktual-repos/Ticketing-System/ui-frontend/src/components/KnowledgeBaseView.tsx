import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  Search,
  BookOpen,
  Eye,
  Plus,
  X,
  Sparkles,
  FolderOpen,
  Star,
  List,
  Filter,
  Bookmark,
  MoreVertical,
  ChevronLeft,
  ChevronRight,
  CreditCard,
  Wrench,
  Users,
  Layers,
  Lightbulb,
  Upload,
  Download,
  RefreshCw,
  ArrowUpRight,
  Play,
  Paperclip,
  File,
  Trash2,
  UploadCloud,
  CheckCircle2,
} from 'lucide-react';
import { KBArticle } from '../types';
import { useSetPageTitle } from './layout/PageTitleContext';
import PageShell from './layout/PageShell';
import CoworkerSplitWorkspace, {
  useCoworkerSplitExpandOptional,
} from './coworker/CoworkerSplitWorkspace';
import { useReportFocusedEntity } from './coworker/CoworkerSessionContext';
import { llmOnlyReply } from './coworker/llmGuidedReply';

function fileLabel(url: string) {
  const base = String(url || '').split('/').pop() || url;
  return base.replace(/^\d+-/, '');
}

const KB_FILE_ACCEPT =
  '.txt,.md,.csv,.pdf,.doc,.docx,.rtf,.xls,.xlsx,.ppt,.pptx,.png,.jpg,.jpeg,.gif,.webp,.svg,.zip';

const DEFAULT_KB_CATEGORIES = [
  'General',
  'Billing',
  'Troubleshooting',
  'Accounts',
] as const;
const PAGE_SIZE = 5;

function normalizeCategoryLabel(raw: string | undefined | null): string {
  const s = String(raw || '').trim();
  return s || 'General';
}

function displayTitle(title: string | undefined) {
  const s = String(title || '').trim();
  return s || 'Untitled article';
}

function displayExcerpt(content: string | undefined, max = 110) {
  const s = normalizeKbPlainText(content)
    .replace(/\s+/g, ' ')
    .trim();
  if (!s) return 'No summary yet.';
  if (s.length <= max) return s;
  return `${s.slice(0, max).trim()}…`;
}

/** Soft-normalize plain KB text so mashed steps/sentences become readable. */
function normalizeKbPlainText(raw: string | undefined | null): string {
  let s = String(raw || '')
    .replace(/\r\n/g, '\n')
    .replace(/\u00a0/g, ' ')
    .trim();
  if (!s) return '';

  // Protect common abbreviations so "e.g." is never turned into "e. g." / split.
  const abs: string[] = [];
  s = s.replace(
    /\b(e\.g|i\.e|etc|vs|Mr|Mrs|Ms|Dr|Prof|Jr|Sr|U\.S|u\.s)\./gi,
    (m) => {
      const token = `\u0000AB${abs.length}\u0000`;
      abs.push(m);
      return token;
    }
  );

  // "inactivity.Log" → "inactivity. Log" (not abbreviation-protected dots)
  s = s.replace(/([.!?])([A-Za-z])/g, '$1 $2');
  // "FixesIncorrect Credentials:" → break before Title Case label
  s = s.replace(/([a-z0-9)&])([A-Z][A-Za-z0-9 /&'+-]{1,55}:)/g, '$1\n$2');
  // "locks. Browser Cache:" → start label on its own line
  s = s.replace(/([.!?])\s+(?=[A-Z][A-Za-z0-9 /&'+-]{1,55}:)/g, '$1\n');
  // "re-authenticate.2. Bypass" → break before next numbered step
  s = s.replace(/([.!?])\s*(\d{1,2})\.\s+/g, '$1\n$2. ');
  // Ensure "2. Title" starts on its own line when mid-string (capital after)
  s = s.replace(/(?<![.\n\d])\s+(\d{1,2})\.\s+(?=[A-Z])/g, '\n$1. ');
  s = s.replace(/^\s*(\d{1,2})\.\s+/gm, '$1. ');

  for (let i = 0; i < abs.length; i += 1) {
    s = s.replace(`\u0000AB${i}\u0000`, abs[i]);
  }

  s = s
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
  return s.replace(/\n{3,}/g, '\n\n').trim();
}

type KbStepBlock = { n: string; title: string; lines: string[] };

const KB_ABBREV_END =
  /\b(e\.g|i\.e|etc|vs|mr|mrs|ms|dr|prof|jr|sr|u\.s)\.$/i;

function splitSentences(chunk: string): string[] {
  const text = String(chunk || '').trim();
  if (!text) return [];
  const parts: string[] = [];
  let buf = '';
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    buf += ch;
    if (!/[.!?]/.test(ch)) continue;
    const next = text[i + 1];
    // Don't split inside abbreviations or decimals (e.g. / 3.14)
    if (KB_ABBREV_END.test(buf.trim()) || /\d\.$/.test(buf)) continue;
    if (next && /[A-Za-z0-9)]/.test(next)) continue;
    // Split only when punctuation is followed by space / end
    if (next === undefined || /\s/.test(next)) {
      const trimmed = buf.trim();
      if (trimmed) parts.push(trimmed);
      buf = '';
      while (i + 1 < text.length && /\s/.test(text[i + 1])) i += 1;
    }
  }
  const tail = buf.trim();
  if (tail) parts.push(tail);
  return parts.length ? parts : [text];
}

function parseKbSteps(text: string): KbStepBlock[] | null {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const joined = lines.join('\n');
  if (!/(^|\n)\d{1,2}\.\s+\S/.test(joined)) return null;

  const chunks = joined
    .split(/(?=^\d{1,2}\.\s+)/m)
    .map((c) => c.trim())
    .filter(Boolean);
  if (chunks.length < 2 && !/^\d{1,2}\.\s+/.test(chunks[0] || '')) {
    return null;
  }

  const steps: KbStepBlock[] = [];
  for (const chunk of chunks) {
    const m = chunk.match(/^(\d{1,2})\.\s+([\s\S]+)$/);
    if (!m) continue;
    const n = m[1];
    const rest = m[2].trim();
    const restLines = rest.split('\n').map((l) => l.trim()).filter(Boolean);

    // Prefer "Title: body" as heading + remaining prose (no bogus bullets).
    const head = restLines[0] || rest;
    const colon = head.match(/^([^:]{2,60}):\s+(.+)$/);
    let title: string;
    let bodyParts: string[];
    if (colon) {
      title = colon[1].trim();
      bodyParts = [colon[2].trim(), ...restLines.slice(1)].filter(Boolean);
    } else if (head.length <= 90 && !/[.!?]/.test(head.slice(0, -1))) {
      title = head.replace(/[.!?]+$/, '').trim();
      bodyParts = restLines.slice(1);
    } else {
      const sentences = splitSentences(head);
      if (sentences.length > 1 && sentences[0].length <= 90) {
        title = sentences[0].replace(/[.!?]+$/, '').trim();
        bodyParts = [...sentences.slice(1), ...restLines.slice(1)];
      } else {
        title = head.replace(/[.!?]+$/, '').trim();
        bodyParts = restLines.slice(1);
      }
    }

    const linesOut: string[] = [];
    for (const part of bodyParts) {
      // Keep a single prose block as one line; only bullet real multi-line notes.
      const trimmed = part.trim();
      if (!trimmed) continue;
      if (/^([•\-*]|\d+[.)])\s+/.test(trimmed)) {
        linesOut.push(trimmed.replace(/^([•\-*]|\d+[.)])\s+/, ''));
        continue;
      }
      linesOut.push(trimmed);
    }
    steps.push({
      n,
      title: title || `Step ${n}`,
      lines: linesOut,
    });
  }
  return steps.length ? steps : null;
}

/** "Incorrect Credentials: … Browser Cache: …" → point list (same idea as KB steps). */
function parseLabelPoints(
  text: string
): { intro: string; points: Array<{ title: string; body: string }> } | null {
  const s = String(text || '').trim();
  if (!s) return null;
  const re = /(^|\n)([^:\n]{2,60}):\s+/g;
  const matches = [...s.matchAll(re)];
  if (matches.length < 2) return null;

  const points: Array<{ title: string; body: string }> = [];
  for (let i = 0; i < matches.length; i += 1) {
    const m = matches[i];
    const title = String(m[2] || '').trim();
    const start = (m.index ?? 0) + m[0].length;
    const end = i + 1 < matches.length ? (matches[i + 1].index ?? s.length) : s.length;
    const body = s.slice(start, end).trim();
    if (!title || !body) continue;
    points.push({ title, body });
  }
  if (points.length < 2) return null;
  const firstIdx = matches[0].index ?? 0;
  const intro = s.slice(0, firstIdx).trim();
  return { intro, points };
}

export function KbArticleBody({
  content,
  compact = false,
}: {
  content: string;
  /** Tighter spacing for guided previews (macros / KB confirm). */
  compact?: boolean;
}): React.ReactElement {
  const normalized = normalizeKbPlainText(content);
  if (!normalized) {
    return (
      <p
        className={`${compact ? 'mt-0' : 'mt-6'} text-sm leading-relaxed text-neutral-500`}
      >
        No content yet.
      </p>
    );
  }

  const wrap = compact ? 'mt-0 space-y-3' : 'mt-6 space-y-6';
  const steps = parseKbSteps(normalized);
  if (steps) {
    return (
      <ol className={`list-none text-sm leading-relaxed text-neutral-800 ${wrap}`}>
        {steps.map((step) => (
          <li key={step.n} className="min-w-0">
            <div className="flex min-w-0 items-start gap-3">
              <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-neutral-950 text-[11px] font-bold tabular-nums text-white">
                {step.n}
              </span>
              <div className="min-w-0 flex-1 space-y-1.5">
                <h3 className="text-[15px] font-semibold leading-snug text-neutral-950">
                  {step.title}
                </h3>
                {step.lines.map((line, i) => (
                  <p
                    key={`${step.n}-${i}`}
                    className="text-[13px] leading-relaxed text-neutral-700 whitespace-pre-wrap break-words"
                  >
                    {line}
                  </p>
                ))}
              </div>
            </div>
          </li>
        ))}
      </ol>
    );
  }

  const labeled = parseLabelPoints(normalized);
  if (labeled) {
    return (
      <div className={`text-sm leading-relaxed text-neutral-800 ${compact ? 'mt-0 space-y-2.5' : 'mt-6 space-y-3'}`}>
        {labeled.intro ? (
          <p className="text-[13px] font-medium text-neutral-900 whitespace-pre-wrap break-words">
            {labeled.intro}
          </p>
        ) : null}
        <ul className="list-none space-y-3">
          {labeled.points.map((p, idx) => (
            <li key={`${p.title}-${idx}`} className="flex min-w-0 items-start gap-2.5">
              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-neutral-900" />
              <div className="min-w-0 flex-1 space-y-0.5">
                <p className="text-[13px] font-semibold leading-snug text-neutral-950">{p.title}</p>
                <p className="text-[12px] leading-relaxed text-neutral-700 whitespace-pre-wrap break-words">
                  {p.body}
                </p>
              </div>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  const paragraphs = normalized.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  return (
    <div
      className={`${compact ? 'mt-0' : 'mt-6'} space-y-3 text-sm leading-relaxed text-neutral-800`}
    >
      {paragraphs.map((para, i) => {
        const lines = para.split('\n').map((l) => l.trim()).filter(Boolean);
        const looksLikeList =
          lines.length > 1 && lines.every((l) => /^([•\-*]|\d+[.)])\s+/.test(l));
        if (looksLikeList) {
          return (
            <ul key={i} className="list-disc space-y-1.5 pl-5 text-neutral-700">
              {lines.map((line, j) => (
                <li key={`${i}-${j}`} className="break-words">
                  {line.replace(/^([•\-*]|\d+[.)])\s+/, '')}
                </li>
              ))}
            </ul>
          );
        }
        return (
          <p key={i} className="whitespace-pre-wrap break-words">
            {para}
          </p>
        );
      })}
    </div>
  );
}

function initials(name: string) {
  const parts = String(name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}

type KbGuidedStepId = 'title' | 'category' | 'body' | 'confirm';

const KB_GUIDED_STEPS: Array<{ id: KbGuidedStepId; title: string; prompt: string }> = [
  { id: 'title', title: 'Title', prompt: 'what to name this article' },
  { id: 'category', title: 'Category', prompt: 'a category for this article' },
  { id: 'body', title: 'Body', prompt: 'the article content' },
  { id: 'confirm', title: 'Confirm', prompt: 'confirm to publish, or cancel' },
];

function kbStepIndex(id: string): number {
  const mapped = id === 'content' ? 'body' : id;
  const idx = KB_GUIDED_STEPS.findIndex((s) => s.id === mapped);
  return idx >= 0 ? idx : 0;
}

const PLACEHOLDER_KB_TITLES = new Set([
  'new article',
  'article',
  'untitled',
  'untitled article',
  'kb article',
  'knowledge base article',
  'new kb',
  'new kb article',
  'create article',
]);

function isPlaceholderKbTitle(title: string | undefined): boolean {
  const t = String(title || '')
    .trim()
    .replace(/[!?.]+$/, '')
    .toLowerCase();
  return !t || PLACEHOLDER_KB_TITLES.has(t);
}

function GuidedKbPreview({
  draft,
  stepIndex,
  publishing = false,
  onCancel,
  onUseForm,
  onConfirmCreate,
}: {
  draft: { title: string; category: string; body: string };
  stepIndex: number;
  publishing?: boolean;
  onCancel: () => void;
  onUseForm?: () => void;
  onConfirmCreate?: () => void;
}) {
  const total = KB_GUIDED_STEPS.length;
  const hasTitle = Boolean(draft.title.trim()) && !isPlaceholderKbTitle(draft.title);
  const hasCategory = Boolean(draft.category.trim());
  const hasBody = draft.body.trim().length >= 10;
  let displayStep = stepIndex;
  if (displayStep > 0 && !hasTitle) displayStep = 0;
  else if (displayStep > 1 && !hasCategory) displayStep = 1;
  else if (displayStep > 2 && !hasBody) displayStep = 2;
  const pct = Math.round((displayStep / total) * 100);
  const current = KB_GUIDED_STEPS[Math.min(displayStep, total - 1)];
  const completed = KB_GUIDED_STEPS.slice(0, displayStep).filter((s) => {
    if (s.id === 'title') return hasTitle;
    if (s.id === 'category') return hasCategory;
    if (s.id === 'body') return hasBody;
    return true;
  });
  const pending = KB_GUIDED_STEPS.slice(displayStep + 1);
  const label = hasTitle ? draft.title.trim() : 'New article';
  const canPublish = hasTitle && hasCategory && hasBody;

  return (
    <div className="h-full min-h-0 flex flex-col">
      <div className="px-4 py-4 border-b border-neutral-100 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] font-medium uppercase tracking-wide text-neutral-400">
              Creating with co-worker
            </p>
            <h3 className="text-base font-semibold text-neutral-900 truncate">{label}</h3>
            {draft.category ? (
              <p className="text-xs text-neutral-500 mt-0.5 truncate">{draft.category}</p>
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
                <dl className="text-xs space-y-1.5 text-neutral-600">
                  <div className="flex gap-2">
                    <dt className="w-20 shrink-0 text-neutral-400">Title</dt>
                    <dd className="font-medium text-neutral-900">{draft.title || '—'}</dd>
                  </div>
                  <div className="flex gap-2">
                    <dt className="w-20 shrink-0 text-neutral-400">Category</dt>
                    <dd className="font-medium text-neutral-900">{draft.category || '—'}</dd>
                  </div>
                  <div className="space-y-1.5">
                    <dt className="text-neutral-400">Body</dt>
                    <dd className="rounded-lg border border-neutral-200 bg-white px-2.5 py-2 max-h-48 overflow-y-auto">
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
                    disabled={publishing || !canPublish}
                    onClick={onConfirmCreate}
                    className="h-9 px-3 rounded-xl bg-black text-white text-xs font-semibold hover:bg-neutral-800 disabled:opacity-50"
                  >
                    {publishing ? 'Publishing…' : 'Publish article'}
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
                    ) : s.id === 'category' ? (
                      <p className="text-[11px] text-neutral-500 truncate">{draft.category}</p>
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

function categoryStyle(category: string) {
  switch (category) {
    case 'Troubleshooting':
      return {
        pill: 'bg-neutral-100 text-neutral-700 border-neutral-200',
        iconBg: 'bg-neutral-100 text-neutral-700',
        art: 'from-neutral-100 via-neutral-50 to-white',
        blob: 'bg-neutral-300/40',
        Icon: Wrench,
      };
    case 'Billing':
      return {
        pill: 'bg-neutral-100 text-neutral-700 border-neutral-200',
        iconBg: 'bg-neutral-100 text-neutral-700',
        art: 'from-neutral-100 via-neutral-50 to-white',
        blob: 'bg-neutral-300/40',
        Icon: CreditCard,
      };
    case 'Accounts':
      return {
        pill: 'bg-neutral-100 text-neutral-700 border-neutral-200',
        iconBg: 'bg-neutral-100 text-neutral-700',
        art: 'from-neutral-100 via-neutral-50 to-white',
        blob: 'bg-neutral-300/40',
        Icon: Users,
      };
    default:
      return {
        pill: 'bg-neutral-100 text-neutral-700 border-neutral-200',
        iconBg: 'bg-neutral-100 text-neutral-700',
        art: 'from-neutral-100 via-neutral-50 to-white',
        blob: 'bg-neutral-300/35',
        Icon: Layers,
      };
  }
}

export default function KnowledgeBaseView({
  canMutate = true,
  externalSearchQuery,
  embedded = false,
  currentUserName,
  startCreateIntent = false,
  startCreateSeed = null,
  onConsumeCreateIntent,
  listRefreshToken = 0,
  onCoworkerMessage,
  onCoworkerChatActions,
  onAgentRoute,
}: {
  canMutate?: boolean;
  externalSearchQuery?: string;
  embedded?: boolean;
  currentUserName?: string;
  startCreateIntent?: boolean;
  startCreateSeed?: {
    step?: string;
    title?: string;
    category?: string;
    body?: string;
  } | null;
  onConsumeCreateIntent?: () => void;
  listRefreshToken?: number;
  onCoworkerMessage?: (text: string) => string | null | Promise<string | null>;
  onCoworkerChatActions?: (
    actions: Record<string, unknown>[],
    meta: { reply: string; agent: string; userText: string }
  ) => void | Promise<void>;
  onAgentRoute?: (agent: string, userText?: string) => void;
}) {
  useSetPageTitle('Knowledge Base');
  const split = useCoworkerSplitExpandOptional();
  const [articles, setArticles] = useState<KBArticle[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState('All');
  const [page, setPage] = useState(1);
  const [sortBy, setSortBy] = useState<'latest' | 'views'>('latest');
  /** Featured shelf shows top 3 until View all expands to every article. */
  const [showAllGuides, setShowAllGuides] = useState(false);
  const articlesListRef = useRef<HTMLElement | null>(null);
  const featuredSectionRef = useRef<HTMLElement | null>(null);
  const kbScrollRef = useRef<HTMLDivElement | null>(null);

  const scrollToEl = useCallback((el: HTMLElement | null) => {
    if (!el) return;
    const scroller = kbScrollRef.current;
    window.setTimeout(() => {
      if (scroller) {
        const scrollerRect = scroller.getBoundingClientRect();
        const elRect = el.getBoundingClientRect();
        const nextTop =
          scroller.scrollTop + (elRect.top - scrollerRect.top) - 12;
        scroller.scrollTo({ top: Math.max(0, nextTop), behavior: 'smooth' });
        return;
      }
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 50);
  }, []);

  const viewAllArticles = useCallback(
    (opts?: { sort?: 'latest' | 'views'; focus?: 'featured' | 'list' }) => {
      setActiveTab('All');
      setSearchQuery('');
      setPage(1);
      if (opts?.sort) setSortBy(opts.sort);
      if (opts?.focus === 'list') {
        setShowAllGuides(false);
        scrollToEl(articlesListRef.current);
        return;
      }
      const next = !showAllGuides;
      setShowAllGuides(next);
      window.setTimeout(() => {
        scrollToEl(next ? featuredSectionRef.current : articlesListRef.current);
      }, 0);
    },
    [scrollToEl, showAllGuides]
  );

  const [showCreateForm, setShowCreateForm] = useState(false);
  const [guidedKb, setGuidedKb] = useState(false);
  const [guidedStepIndex, setGuidedStepIndex] = useState(0);
  const [publishing, setPublishing] = useState(false);
  const [guidedCategory, setGuidedCategory] = useState('');
  const [newTitle, setNewTitle] = useState('');
  const [newContent, setNewContent] = useState('');
  const [newCategory, setNewCategory] = useState('General');
  const [extraCategories, setExtraCategories] = useState<string[]>([]);
  const [showManageCategories, setShowManageCategories] = useState(false);
  const [manageCategoryInput, setManageCategoryInput] = useState('');
  const [categorySelectMode, setCategorySelectMode] = useState<'list' | 'custom'>(
    'list'
  );
  const [customCategoryInput, setCustomCategoryInput] = useState('');
  const [showImportForm, setShowImportForm] = useState(false);
  const [importJson, setImportJson] = useState('');
  const [importBusy, setImportBusy] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [sidebarHint, setSidebarHint] = useState<string | null>(null);
  const [newAuthor, setNewAuthor] = useState(currentUserName || '');
  const [createError, setCreateError] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [selectedArticleId, setSelectedArticleId] = useState<string | null>(null);
  const pendingOpenArticleRef = useRef<{ id?: string; title?: string } | null>(null);
  const selectedArticle = articles.find((a) => a.id === selectedArticleId) || null;
  useReportFocusedEntity(
    selectedArticle
      ? { type: 'article', id: selectedArticle.id, name: selectedArticle.title }
      : null
  );

  useEffect(() => {
    split?.focusContent();
  }, [split]);

  useEffect(() => {
    if (currentUserName) setNewAuthor(currentUserName);
  }, [currentUserName]);

  useEffect(() => {
    if (externalSearchQuery !== undefined) setSearchQuery(externalSearchQuery);
  }, [externalSearchQuery]);

  const fetchArticles = async () => {
    try {
      const res = await fetch('/api/kb', { credentials: 'include' });
      const data = await res.json();
      const rows = Array.isArray(data) ? data : [];
      setArticles(rows);
      const pending = pendingOpenArticleRef.current;
      if (pending) {
        pendingOpenArticleRef.current = null;
        const byId = pending.id ? rows.find((a) => a.id === pending.id) : undefined;
        const byTitle = pending.title
          ? rows.find(
              (a) =>
                String(a.title || '').trim().toLowerCase() ===
                pending.title!.trim().toLowerCase()
            )
          : undefined;
        const hit = byId || byTitle;
        if (hit?.id) setSelectedArticleId(hit.id);
        else if (pending.title) setSearchQuery(pending.title);
      }
    } catch (err) {
      console.error('Failed to fetch KB articles', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchArticles();
  }, []);

  useEffect(() => {
    if (!listRefreshToken) return;
    void fetchArticles();
  }, [listRefreshToken]);

  const uploadFiles = async (fileList: FileList | null) => {
    if (!fileList?.length) return;
    setUploading(true);
    setCreateError(null);
    const form = new FormData();
    Array.from(fileList).forEach((f) => form.append('files', f));
    try {
      const res = await fetch('/api/uploads', {
        method: 'POST',
        credentials: 'include',
        body: form,
      });
      if (!res.ok) {
        setCreateError('Could not upload one or more files.');
        return;
      }
      const data = await res.json();
      const urls = Array.isArray(data?.urls) ? data.urls.map(String) : [];
      setAttachments((prev) => [...prev, ...urls]);
    } catch {
      setCreateError('Could not upload files.');
    } finally {
      setUploading(false);
    }
  };

  const handleCreateArticle = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setCreateError(null);
    const title = newTitle.trim();
    const content = newContent.trim();
    if (title.length < 2) {
      setCreateError('Title needs at least 2 characters.');
      return;
    }
    if (content.length < 10) {
      setCreateError('Body needs at least 10 characters.');
      return;
    }

    setPublishing(true);
    try {
      const res = await fetch('/api/kb', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          title,
          content,
          category: rememberCategory(guidedCategory || newCategory),
          author: newAuthor.trim() || currentUserName || 'Staff',
          attachments,
        }),
      });
      if (res.ok) {
        setNewTitle('');
        setNewContent('');
        setNewCategory('General');
        setGuidedCategory('');
        setCategorySelectMode('list');
        setCustomCategoryInput('');
        setNewAuthor(currentUserName || '');
        setAttachments([]);
        setShowCreateForm(false);
        setGuidedKb(false);
        setGuidedStepIndex(0);
        void fetchArticles();
      } else {
        const body = await res.json().catch(() => null);
        setCreateError(body?.error || 'Could not publish article.');
      }
    } catch (err) {
      console.error('Failed to create article', err);
      setCreateError('Could not publish article.');
    } finally {
      setPublishing(false);
    }
  };

  const availableCategories = useMemo(() => {
    const names = new Set<string>([
      ...DEFAULT_KB_CATEGORIES,
      ...extraCategories.map(normalizeCategoryLabel),
    ]);
    for (const a of articles) {
      names.add(normalizeCategoryLabel(a.category));
    }
    return Array.from(names).sort((a, b) => a.localeCompare(b));
  }, [articles, extraCategories]);

  const filterTabs = useMemo(
    () => ['All', ...availableCategories],
    [availableCategories]
  );

  const rememberCategory = useCallback((raw: string) => {
    const name = normalizeCategoryLabel(raw);
    setExtraCategories((prev) => {
      if (
        prev.some((c) => c.toLowerCase() === name.toLowerCase()) ||
        (DEFAULT_KB_CATEGORIES as readonly string[]).some(
          (c) => c.toLowerCase() === name.toLowerCase()
        )
      ) {
        return prev;
      }
      return [...prev, name];
    });
    return name;
  }, []);

  const stats = useMemo(() => {
    const published = articles.filter((a) => a.status !== 'Draft').length;
    const drafts = articles.filter((a) => a.status === 'Draft').length;
    const views = articles.reduce((n, a) => n + (a.views || 0), 0);
    return {
      total: articles.length,
      published,
      drafts,
      views,
    };
  }, [articles]);

  const categoryCounts = useMemo(() => {
    const map: Record<string, number> = {};
    for (const name of availableCategories) {
      map[name] = 0;
    }
    for (const a of articles) {
      const key = normalizeCategoryLabel(a.category);
      map[key] = (map[key] || 0) + 1;
    }
    return map;
  }, [articles, availableCategories]);

  const filteredArticles = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const tab = normalizeCategoryLabel(activeTab === 'All' ? '' : activeTab);
    let list = articles.filter((art) => {
      const artCat = normalizeCategoryLabel(art.category);
      const matchesTab =
        activeTab === 'All' || artCat.toLowerCase() === tab.toLowerCase();
      const matchesSearch =
        !q ||
        art.title.toLowerCase().includes(q) ||
        art.content.toLowerCase().includes(q) ||
        art.author.toLowerCase().includes(q) ||
        artCat.toLowerCase().includes(q);
      return matchesTab && matchesSearch;
    });
    if (sortBy === 'views') {
      list = [...list].sort((a, b) => (b.views || 0) - (a.views || 0));
    }
    return list;
  }, [articles, activeTab, searchQuery, sortBy]);

  useEffect(() => {
    setPage(1);
  }, [activeTab, searchQuery, sortBy]);

  const featuredArticles = useMemo(() => {
    const ranked = [...articles].sort((a, b) => (b.views || 0) - (a.views || 0));
    return showAllGuides ? ranked : ranked.slice(0, 3);
  }, [articles, showAllGuides]);

  const popularArticles = useMemo(() => {
    return [...articles]
      .sort((a, b) => (b.views || 0) - (a.views || 0))
      .slice(0, 4);
  }, [articles]);

  const totalPages = Math.max(1, Math.ceil(filteredArticles.length / PAGE_SIZE));
  const pageSafe = Math.min(page, totalPages);
  const pageSlice = filteredArticles.slice(
    (pageSafe - 1) * PAGE_SIZE,
    pageSafe * PAGE_SIZE
  );
  const showingFrom =
    filteredArticles.length === 0 ? 0 : (pageSafe - 1) * PAGE_SIZE + 1;
  const showingTo = Math.min(pageSafe * PAGE_SIZE, filteredArticles.length);

  const openCreate = () => {
    setCreateError(null);
    setAttachments([]);
    setGuidedKb(false);
    setShowCreateForm(true);
  };

  const cancelGuidedKb = () => {
    setGuidedKb(false);
    setGuidedStepIndex(0);
    setGuidedCategory('');
    setShowCreateForm(false);
  };

  useEffect(() => {
    if (!startCreateIntent) return;
    onConsumeCreateIntent?.();
    if (canMutate) {
      const step = String(startCreateSeed?.step || 'title').trim().toLowerCase();
      setCreateError(null);
      setShowCreateForm(false);
      setGuidedKb(true);
      setGuidedStepIndex(kbStepIndex(step || 'title'));
      setNewTitle(String(startCreateSeed?.title || ''));
      setGuidedCategory(String(startCreateSeed?.category || ''));
      setNewContent(String(startCreateSeed?.body || ''));
      const cat = normalizeCategoryLabel(startCreateSeed?.category || '');
      if (startCreateSeed?.category) {
        setNewCategory(rememberCategory(cat));
      }
    }
  }, [startCreateIntent, startCreateSeed, onConsumeCreateIntent, canMutate, rememberCategory]);

  const downloadKbExport = useCallback(
    (
      format: string,
      filename: string,
      rows: Array<Record<string, unknown>>
    ) => {
      const fmt = format === 'csv' ? 'csv' : 'json';
      let body = '';
      let mime = 'application/json;charset=utf-8';
      if (fmt === 'csv') {
        const header = ['id', 'title', 'category', 'status', 'author', 'views', 'content'];
        const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
        body = [
          header.join(','),
          ...rows.map((r) =>
            header.map((h) => esc(r[h])).join(',')
          ),
        ].join('\n');
        mime = 'text/csv;charset=utf-8';
      } else {
        body = JSON.stringify(rows, null, 2);
      }
      const blob = new Blob([body], { type: mime });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename || `worktual-kb.${fmt}`;
      a.click();
      URL.revokeObjectURL(url);
    },
    []
  );

  const runLocalImport = useCallback(async () => {
    setImportError(null);
    let parsed: unknown;
    try {
      parsed = JSON.parse(importJson);
    } catch {
      setImportError('Paste a valid JSON array of articles.');
      return;
    }
    if (!Array.isArray(parsed) || !parsed.length) {
      setImportError('JSON must be a non-empty array.');
      return;
    }
    setImportBusy(true);
    let created = 0;
    try {
      for (const item of parsed.slice(0, 50)) {
        if (!item || typeof item !== 'object') continue;
        const row = item as Record<string, unknown>;
        const title = String(row.title || '').trim();
        const content = String(row.content || row.body || '').trim();
        const category = rememberCategory(
          String(row.category || 'General').trim() || 'General'
        );
        if (!title || !content) continue;
        const res = await fetch('/api/kb', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            title,
            content,
            category,
            status: row.status || undefined,
            author: newAuthor.trim() || currentUserName || 'Staff',
          }),
        });
        if (res.ok) created += 1;
      }
      setShowImportForm(false);
      setImportJson('');
      void fetchArticles();
      if (!created) setImportError('No articles were imported.');
    } catch {
      setImportError('Import failed.');
    } finally {
      setImportBusy(false);
    }
  }, [importJson, rememberCategory, newAuthor, currentUserName]);

  const handleChatActions = useCallback(
    async (
      actions: Record<string, unknown>[],
      meta: { reply: string; agent: string; userText: string }
    ) => {
      await onCoworkerChatActions?.(actions, meta);
      let reload = false;
      for (const raw of actions) {
        const type = String(raw.type || '').toLowerCase();
        if (type === 'add_kb_category') {
          const rawCat = String(raw.category || raw.name || '').trim();
          const promptOnly = Boolean(raw.prompt) && !rawCat;
          if (rawCat) {
            setActiveTab(rememberCategory(rawCat));
            // Category tab filter only — never treat the name as article search.
            setSearchQuery('');
          }
          setShowManageCategories(true);
          if (!promptOnly) {
            setGuidedKb(false);
            setShowCreateForm(false);
          }
          continue;
        }
        if (type === 'export_kb') {
          const fmt = String(raw.format || 'json').toLowerCase();
          const filename = String(raw.filename || `worktual-kb.${fmt}`);
          const fromAction = Array.isArray(raw.articles)
            ? (raw.articles as Array<Record<string, unknown>>)
            : null;
          const rows =
            fromAction && fromAction.length
              ? fromAction
              : articles.map((a) => ({
                  id: a.id,
                  title: a.title,
                  content: a.content,
                  category: a.category,
                  status: a.status,
                  author: a.author,
                  views: a.views || 0,
                }));
          downloadKbExport(fmt, filename, rows);
          continue;
        }
        if (type === 'refresh_kb') {
          reload = true;
          continue;
        }
        if (type === 'import_kb') {
          setShowImportForm(true);
          setShowCreateForm(false);
          setGuidedKb(false);
          continue;
        }
        if (type === 'open_kb') {
          const keepingCreate = actions.some((a) => {
            const t = String(a.type || '').toLowerCase();
            return t === 'create_kb' && !a.done && !a.save;
          });
          const titleOpen = String(raw.title || raw.query || '').trim();
          const aid = String(raw.id || '').trim();
          if (!keepingCreate) {
            pendingOpenArticleRef.current = aid
              ? { id: aid, title: titleOpen || undefined }
              : titleOpen
                ? { title: titleOpen }
                : null;
            setActiveTab('All');
            setGuidedKb(false);
            setShowCreateForm(false);
            reload = true;
          }
          continue;
        }
        if (type === 'set_filter' && String(raw.module || '').toLowerCase() === 'kb') {
          const q = String(raw.query || raw.title || '').trim();
          setSearchQuery(q);
          const cat = String(raw.category || '').trim();
          if (cat) {
            setActiveTab(rememberCategory(cat));
          } else if (!guidedKb) {
            setActiveTab('All');
          }
          continue;
        }
        if (type !== 'create_kb') continue;
        // Only explicit done/save ends guided create — never `refresh` alone.
        const done = Boolean(raw.done || raw.save);
        const title = String(raw.title || '').trim();
        const category = String(raw.category || '').trim();
        const body = String(raw.body || raw.content || '').trim();
        const step = String(raw.step || raw.awaiting || '')
          .trim()
          .toLowerCase();
        const titleUsable = Boolean(title) && !isPlaceholderKbTitle(title);
        const isStart =
          !done &&
          (!step || step === 'title') &&
          !titleUsable &&
          !body &&
          !category;
        if (isStart || (!titleUsable && step === 'title')) {
          setNewTitle('');
          setGuidedCategory('');
          setNewContent('');
          setNewCategory('General');
        }
        if (titleUsable) setNewTitle(title);
        else if (title && !titleUsable) setNewTitle('');
        if (titleUsable && category) {
          const remembered = rememberCategory(category);
          setGuidedCategory(remembered);
          setNewCategory(remembered);
        }
        if (titleUsable && body) setNewContent(body);
        if (done) {
          setGuidedKb(false);
          setGuidedStepIndex(0);
          setShowCreateForm(false);
          const aid = String(raw.id || '').trim();
          const titleDone = String(raw.title || '').trim();
          pendingOpenArticleRef.current = aid
            ? { id: aid, title: titleDone || undefined }
            : titleDone
              ? { title: titleDone }
              : null;
          reload = true;
          continue;
        }
        setShowCreateForm(false);
        setGuidedKb(true);
        setGuidedStepIndex(
          kbStepIndex(!titleUsable ? 'title' : step || 'title')
        );
      }
      if (reload) void fetchArticles();
    },
    [
      onCoworkerChatActions,
      rememberCategory,
      articles,
      downloadKbExport,
      guidedKb,
    ]
  );

  const handleChatMessage = useCallback(
    async (raw: string): Promise<string | null> => {
      const text = raw.trim();
      if (onCoworkerMessage) return onCoworkerMessage(text);
      return llmOnlyReply(
        {
          module: 'kb',
          kind: 'unavailable',
          userText: text,
          pageLabel: 'Knowledge Base',
          context: { chatUnavailable: true },
        },
        'Chat is temporarily unavailable. Use New Article on the right, or try again shortly.',
        { message: text, page: 'Knowledge Base', allowAgentsFallback: false }
      );
    },
    [onCoworkerMessage]
  );

  const getChatContext = useCallback(() => {
    if (selectedArticle) {
      return {
        module: 'kb',
        surface: 'detail',
        draft: null,
        entityId: selectedArticle.id,
        focusedEntity: {
          type: 'article' as const,
          id: selectedArticle.id,
          name: selectedArticle.title,
        },
      };
    }
    if (!guidedKb) {
      if (showCreateForm) {
        return {
          module: 'kb',
          surface: 'create',
          draft: {
            awaiting: isPlaceholderKbTitle(newTitle) ? 'title' : 'body',
            title: isPlaceholderKbTitle(newTitle) ? undefined : newTitle || undefined,
            category: (guidedCategory || newCategory || '').trim() || undefined,
            body: newContent || undefined,
          },
        };
      }
      return {
        module: 'kb',
        surface: 'list',
        draft: null,
      };
    }
    const step = KB_GUIDED_STEPS[guidedStepIndex] || KB_GUIDED_STEPS[0];
    return {
      module: 'kb',
      surface: 'create',
      draft: {
        awaiting: isPlaceholderKbTitle(newTitle) ? 'title' : step.id,
        title: isPlaceholderKbTitle(newTitle) ? undefined : newTitle || undefined,
        category: guidedCategory.trim() || undefined,
        body: newContent || undefined,
      },
    };
  }, [
    guidedKb,
    guidedStepIndex,
    newTitle,
    guidedCategory,
    newCategory,
    newContent,
    showCreateForm,
    selectedArticle,
  ]);

  const listPanel = selectedArticle ? (
    <PageShell id="kb-view-container" embedded={embedded} fillHeight>
      <div className="@container flex h-full min-h-0 min-w-0 flex-col gap-4 overflow-y-auto overflow-x-hidden pb-1">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setSelectedArticleId(null)}
            className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-neutral-200 bg-white px-3 text-xs font-semibold text-neutral-800 hover:bg-neutral-50"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
            Back to articles
          </button>
        </div>
        <article className="flex min-h-0 min-w-0 flex-1 flex-col rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm sm:p-6">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`inline-flex rounded-full border px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                featuredTheme(selectedArticle.category).pill
              }`}
            >
              {selectedArticle.category}
            </span>
            <span className="inline-flex items-center gap-1 text-[11px] text-neutral-500">
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  selectedArticle.status === 'Draft'
                    ? 'bg-amber-500'
                    : 'bg-emerald-500'
                }`}
              />
              {selectedArticle.status === 'Draft' ? 'Draft' : 'Published'}
            </span>
            <span className="text-[11px] tabular-nums text-neutral-400">
              {selectedArticle.updatedAt || '—'}
            </span>
          </div>
          <h2 className="mt-3 break-words text-xl font-bold tracking-tight text-neutral-950 sm:text-2xl">
            {displayTitle(selectedArticle.title)}
          </h2>
          <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-neutral-500">
            <span className="inline-flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-neutral-100 text-[10px] font-bold text-neutral-800">
                {initials(selectedArticle.author)}
              </span>
              <span className="font-medium text-neutral-700">
                {selectedArticle.author || 'Unknown'}
              </span>
            </span>
            <span className="inline-flex items-center gap-1 tabular-nums">
              <Eye className="h-3.5 w-3.5" />
              {(selectedArticle.views || 0).toLocaleString()} views
            </span>
          </div>
          <KbArticleBody content={String(selectedArticle.content || '')} />
          {(selectedArticle.attachments?.length || 0) > 0 && (
            <div className="mt-6 border-t border-neutral-100 pt-4">
              <h3 className="mb-2 text-[11px] font-bold uppercase tracking-wider text-neutral-500">
                Attachments
              </h3>
              <ul className="space-y-1.5">
                {selectedArticle.attachments!.map((url, i) => (
                  <li key={`${url}-${i}`}>
                    <a
                      href={url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1.5 text-xs font-medium text-neutral-800 hover:underline"
                    >
                      <Paperclip className="h-3.5 w-3.5 text-neutral-400" />
                      {fileLabel(url)}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </article>
      </div>
    </PageShell>
  ) : (
    <PageShell id="kb-view-container" embedded={embedded} fillHeight>
      <div
        ref={kbScrollRef}
        className="@container flex h-full min-h-0 min-w-0 flex-col gap-4 overflow-y-auto overflow-x-hidden pb-1"
      >
        {/* Header */}
        <div className="flex flex-col gap-3 @[480px]:flex-row @[480px]:items-start @[480px]:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-neutral-950 text-white shadow-sm shadow-neutral-200">
              <BookOpen className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <h2 className="text-lg font-bold tracking-tight text-neutral-950 @[520px]:text-xl">
                Articles
              </h2>
              <p className="mt-0.5 text-xs leading-relaxed text-neutral-500 @[520px]:text-sm">
                Internal guides, refund workflows, and troubleshooting runs
              </p>
            </div>
          </div>
          {canMutate && (
            <button
              id="kb-new-article-btn"
              type="button"
              onClick={openCreate}
              className="inline-flex h-10 w-full shrink-0 items-center justify-center gap-2 rounded-xl bg-neutral-950 px-4 text-xs font-semibold text-white shadow-sm shadow-neutral-200 transition-colors hover:bg-neutral-800 @[480px]:w-auto"
            >
              <Plus className="h-4 w-4" />
              New Article
            </button>
          )}
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 gap-2.5 @[640px]:grid-cols-4">
          <StatCard
            label="Total Articles"
            value={stats.total}
            icon={<BookOpen className="h-4 w-4" />}
            tone="neutral"
          />
          <StatCard
            label="Published"
            value={stats.published}
            icon={<Bookmark className="h-4 w-4" />}
            tone="emerald"
          />
          <StatCard
            label="Drafts"
            value={stats.drafts}
            icon={<FolderOpen className="h-4 w-4" />}
            tone="amber"
          />
          <StatCard
            label="Total Views"
            value={stats.views}
            icon={<Eye className="h-4 w-4" />}
            tone="sky"
          />
        </div>

        {/* Filters */}
        <div className="flex flex-col gap-3 rounded-2xl border border-neutral-200 bg-neutral-50/80 p-3 @[560px]:flex-row @[560px]:items-center @[560px]:justify-between">
          <div className="flex flex-wrap items-center gap-1.5">
            {filterTabs.map((tab) => {
              const active = activeTab === tab;
              return (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setActiveTab(tab)}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer ${
                    active
                      ? 'border-neutral-950 bg-neutral-950 text-white shadow-sm shadow-neutral-200'
                      : 'border-transparent bg-white text-neutral-600 hover:border-neutral-200 hover:text-neutral-900'
                  }`}
                >
                  {tab === 'All' ? 'All Articles' : tab}
                </button>
              );
            })}
          </div>
          <div className="flex w-full min-w-0 items-center gap-2 @[560px]:w-auto">
            <div className="relative min-w-0 flex-1 @[560px]:w-52">
              <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-neutral-400" />
              <input
                type="search"
                placeholder="Search guides, keywords…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full rounded-xl border border-neutral-200 bg-white py-2 pl-9 pr-3 text-xs text-neutral-900 placeholder:text-neutral-400 focus:border-neutral-400 focus:outline-none"
              />
            </div>
            <button
              type="button"
              className="relative inline-flex h-9 shrink-0 items-center gap-1.5 rounded-xl border border-neutral-200 bg-white px-3 text-xs font-medium text-neutral-600 hover:border-neutral-300"
              title="Active category filter"
            >
              <Filter className="h-3.5 w-3.5" />
              <span className="hidden @[400px]:inline">Filters</span>
              {activeTab !== 'All' && (
                <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-neutral-950 px-1 text-[10px] font-bold text-white">
                  1
                </span>
              )}
            </button>
          </div>
        </div>

        {/* Create */}
        {showCreateForm && (
          <div className="space-y-4 rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between border-b border-neutral-100 pb-3">
              <h3 className="inline-flex items-center gap-2 text-sm font-semibold text-neutral-950">
                <Sparkles className="h-4 w-4 text-neutral-900" />
                Draft new guide
              </h3>
              <button
                type="button"
                onClick={() => setShowCreateForm(false)}
                className="rounded-lg p-1 text-neutral-400 hover:bg-neutral-50 hover:text-neutral-900"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={handleCreateArticle} className="space-y-4 text-xs">
              {createError && (
                <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-rose-700">
                  {createError}
                </p>
              )}
              <div className="grid grid-cols-1 gap-3 @[520px]:grid-cols-2">
                <div className="@[520px]:col-span-2">
                  <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-neutral-500">
                    Title
                  </label>
                  <input
                    type="text"
                    required
                    minLength={3}
                    value={newTitle}
                    onChange={(e) => setNewTitle(e.target.value)}
                    placeholder="Clear, searchable title"
                    className="w-full rounded-xl border border-neutral-200 px-3 py-2.5 text-sm focus:border-neutral-400 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-neutral-500">
                    Category
                  </label>
                  {categorySelectMode === 'list' ? (
                    <select
                      value={
                        availableCategories.includes(newCategory)
                          ? newCategory
                          : '__custom__'
                      }
                      onChange={(e) => {
                        const v = e.target.value;
                        if (v === '__custom__') {
                          setCategorySelectMode('custom');
                          setCustomCategoryInput('');
                          return;
                        }
                        setNewCategory(v);
                        setGuidedCategory(v);
                      }}
                      className="w-full cursor-pointer rounded-xl border border-neutral-200 px-3 py-2.5 text-sm"
                    >
                      {availableCategories.map((name) => (
                        <option key={name} value={name}>
                          {name}
                        </option>
                      ))}
                      <option value="__custom__">+ Add new category…</option>
                    </select>
                  ) : (
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={customCategoryInput}
                        onChange={(e) => setCustomCategoryInput(e.target.value)}
                        placeholder="New category name"
                        className="min-w-0 flex-1 rounded-xl border border-neutral-200 px-3 py-2.5 text-sm focus:border-neutral-400 focus:outline-none"
                        autoFocus
                      />
                      <button
                        type="button"
                        onClick={() => {
                          const name = rememberCategory(customCategoryInput);
                          setNewCategory(name);
                          setGuidedCategory(name);
                          setCustomCategoryInput('');
                          setCategorySelectMode('list');
                        }}
                        className="shrink-0 rounded-xl bg-neutral-950 px-3 text-xs font-semibold text-white hover:bg-neutral-800"
                      >
                        Add
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setCategorySelectMode('list');
                          setCustomCategoryInput('');
                        }}
                        className="shrink-0 rounded-xl border border-neutral-200 px-2 text-neutral-500 hover:bg-neutral-50"
                        aria-label="Cancel new category"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  )}
                </div>
                <div>
                  <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-neutral-500">
                    Author
                  </label>
                  <input
                    type="text"
                    required
                    value={newAuthor}
                    onChange={(e) => setNewAuthor(e.target.value)}
                    className="w-full rounded-xl border border-neutral-200 px-3 py-2.5 text-sm focus:outline-none"
                  />
                </div>
                <div className="@[520px]:col-span-2">
                  <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-neutral-500">
                    Body
                  </label>
                  <textarea
                    required
                    minLength={10}
                    rows={5}
                    value={newContent}
                    onChange={(e) => setNewContent(e.target.value)}
                    placeholder="Steps, notes, and resolution details…"
                    className="w-full rounded-xl border border-neutral-200 p-3 text-sm leading-relaxed focus:outline-none"
                  />
                </div>
                <div className="@[520px]:col-span-2 space-y-2">
                  <label className="mb-0.5 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-neutral-500">
                    <Paperclip className="h-3 w-3" />
                    Attachments
                  </label>
                  <p className="text-[11px] text-neutral-400">
                    Add docs, text, images, or spreadsheets (max 15MB each).
                  </p>
                  <label
                    onDragEnter={(e) => {
                      e.preventDefault();
                      setDragActive(true);
                    }}
                    onDragLeave={(e) => {
                      e.preventDefault();
                      setDragActive(false);
                    }}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={async (e) => {
                      e.preventDefault();
                      setDragActive(false);
                      await uploadFiles(e.dataTransfer.files);
                    }}
                    className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed px-4 py-5 transition-colors ${
                      dragActive
                        ? 'border-neutral-900 bg-neutral-50'
                        : 'border-neutral-200 hover:border-neutral-400 hover:bg-neutral-50/60'
                    }`}
                  >
                    <UploadCloud className="h-5 w-5 text-neutral-400" />
                    <span className="text-xs text-neutral-500">
                      {uploading
                        ? 'Uploading…'
                        : 'Drop files here or click to browse'}
                    </span>
                    <span className="text-[10px] text-neutral-400">
                      TXT, MD, PDF, DOC, DOCX, images, XLS, CSV…
                    </span>
                    <input
                      type="file"
                      multiple
                      accept={KB_FILE_ACCEPT}
                      className="hidden"
                      disabled={uploading}
                      onChange={async (e) => {
                        await uploadFiles(e.target.files);
                        e.target.value = '';
                      }}
                    />
                  </label>
                  {attachments.length > 0 && (
                    <ul className="space-y-1.5">
                      {attachments.map((url, i) => (
                        <li
                          key={`${url}-${i}`}
                          className="flex items-center justify-between gap-2 rounded-lg border border-neutral-100 bg-neutral-50/80 px-2.5 py-1.5 text-xs"
                        >
                          <a
                            href={url}
                            target="_blank"
                            rel="noreferrer"
                            className="flex min-w-0 items-center gap-1.5 text-neutral-700 hover:text-neutral-950"
                          >
                            <File className="h-3.5 w-3.5 shrink-0 text-neutral-400" />
                            <span className="truncate">{fileLabel(url)}</span>
                          </a>
                          <button
                            type="button"
                            onClick={() =>
                              setAttachments((prev) =>
                                prev.filter((_, idx) => idx !== i)
                              )
                            }
                            className="shrink-0 text-neutral-400 hover:text-rose-600"
                            aria-label="Remove file"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowCreateForm(false)}
                  className="rounded-xl border border-neutral-200 bg-white px-4 py-2 text-xs font-semibold text-neutral-700 hover:bg-neutral-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-xl bg-neutral-950 px-4 py-2 text-xs font-semibold text-white hover:bg-neutral-800"
                >
                  Publish Article
                </button>
              </div>
            </form>
          </div>
        )}

        {showImportForm && (
          <div className="space-y-3 rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between border-b border-neutral-100 pb-3">
              <h3 className="inline-flex items-center gap-2 text-sm font-semibold text-neutral-950">
                <Upload className="h-4 w-4 text-neutral-900" />
                Import articles
              </h3>
              <button
                type="button"
                onClick={() => {
                  setShowImportForm(false);
                  setImportError(null);
                }}
                className="rounded-lg p-1 text-neutral-400 hover:bg-neutral-50 hover:text-neutral-900"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <p className="text-xs text-neutral-500">
              Paste a JSON array of articles, or ask the co-worker in chat to import
              the same payload. Each item needs{' '}
              <code className="rounded bg-neutral-100 px-1">title</code>,{' '}
              <code className="rounded bg-neutral-100 px-1">content</code>, and{' '}
              <code className="rounded bg-neutral-100 px-1">category</code>.
            </p>
            {importError && (
              <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                {importError}
              </p>
            )}
            <textarea
              rows={8}
              value={importJson}
              onChange={(e) => setImportJson(e.target.value)}
              placeholder='[{"title":"Reset MFA","content":"Steps…","category":"Accounts"}]'
              className="w-full rounded-xl border border-neutral-200 p-3 font-mono text-xs leading-relaxed focus:outline-none"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowImportForm(false)}
                className="rounded-xl border border-neutral-200 bg-white px-4 py-2 text-xs font-semibold text-neutral-700"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={importBusy || !canMutate}
                onClick={() => void runLocalImport()}
                className="rounded-xl bg-neutral-950 px-4 py-2 text-xs font-semibold text-white hover:bg-neutral-800 disabled:opacity-50"
              >
                {importBusy ? 'Importing…' : 'Import'}
              </button>
            </div>
          </div>
        )}

        {/* Main + sidebar — stack until panel is wide enough */}
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 @[720px]:grid-cols-[minmax(0,1fr)_220px]">
          <div className="relative z-10 flex min-h-0 min-w-0 flex-col gap-4">
            {/* Featured */}
            <section
              ref={featuredSectionRef}
              className="relative z-10 min-w-0"
            >
              <div className="mb-3 flex items-end justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="inline-flex items-center gap-1.5 text-sm font-semibold text-neutral-900">
                    <Star className="h-3.5 w-3.5 text-amber-500 fill-amber-500" />
                    {showAllGuides ? 'All Guides' : 'Featured Guides'}
                  </h3>
                  <p className="mt-0.5 text-[11px] text-neutral-500">
                    {showAllGuides
                      ? `${articles.length} guide${articles.length === 1 ? '' : 's'} in your knowledge base`
                      : 'Top guides your team opens most'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    viewAllArticles({ sort: 'views' });
                  }}
                  className="relative z-20 shrink-0 cursor-pointer rounded-lg px-2.5 py-1.5 text-[11px] font-semibold text-neutral-900 hover:bg-neutral-100 hover:text-neutral-950"
                >
                  {showAllGuides ? 'Show featured' : 'View all →'}
                </button>
              </div>

              {loading ? (
                <div className="grid grid-cols-1 gap-3 @[520px]:grid-cols-2 @[720px]:grid-cols-3">
                  {[0, 1, 2].map((i) => (
                    <div
                      key={i}
                      className="h-52 animate-pulse rounded-2xl border border-neutral-200 bg-neutral-50"
                    />
                  ))}
                </div>
              ) : featuredArticles.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-neutral-200 bg-neutral-50/60 px-4 py-10 text-center text-xs text-neutral-500">
                  No featured guides yet. Publish an article to populate this shelf.
                </div>
              ) : (
                <div
                  className={
                    showAllGuides || featuredArticles.length >= 3
                      ? 'grid grid-cols-1 gap-3 @[520px]:grid-cols-2 @[720px]:grid-cols-3'
                      : featuredArticles.length === 1
                        ? 'grid grid-cols-1'
                        : 'grid grid-cols-1 gap-3 @[520px]:grid-cols-2'
                  }
                >
                  {featuredArticles.map((art) => (
                    <div key={art.id} className="min-w-0 h-full">
                      <FeaturedCard
                        article={art}
                        layout={
                          !showAllGuides && featuredArticles.length === 1
                            ? 'spotlight'
                            : 'tile'
                        }
                        onOpen={() => setSelectedArticleId(art.id)}
                      />
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* Table / card list */}
            <section
              ref={articlesListRef}
              className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-sm"
            >
              <div className="flex flex-col gap-2 border-b border-neutral-100 px-3 py-3 @[480px]:flex-row @[480px]:items-center @[480px]:justify-between @[480px]:px-4">
                <div className="min-w-0">
                  <h3 className="inline-flex items-center gap-1.5 text-sm font-semibold text-neutral-900">
                    <List className="h-3.5 w-3.5 text-neutral-500" />
                    All Database Articles
                  </h3>
                  <p className="mt-0.5 text-[11px] text-neutral-500">
                    Searchable directory of published and draft guides
                  </p>
                </div>
                <label className="inline-flex items-center gap-1.5 text-[11px] text-neutral-500">
                  Sort by:
                  <select
                    value={sortBy}
                    onChange={(e) =>
                      setSortBy(e.target.value as 'latest' | 'views')
                    }
                    className="cursor-pointer rounded-lg border border-neutral-200 bg-white px-2 py-1 text-[11px] font-semibold text-neutral-800"
                  >
                    <option value="latest">Latest</option>
                    <option value="views">Most viewed</option>
                  </select>
                </label>
              </div>

              {loading ? (
                <div className="p-10 text-center text-xs text-neutral-400">
                  Loading articles…
                </div>
              ) : pageSlice.length === 0 ? (
                <div className="flex flex-col items-center gap-2 px-4 py-12 text-neutral-400">
                  <FolderOpen className="h-6 w-6" />
                  <span className="text-xs">No articles match this view.</span>
                </div>
              ) : (
                <>
                  {/* Narrow panel: stacked cards */}
                  <ul className="divide-y divide-neutral-100 @[640px]:hidden">
                    {pageSlice.map((art) => {
                      const style = categoryStyle(art.category);
                      const Icon = style.Icon;
                      const draft = art.status === 'Draft';
                      return (
                        <li
                          key={art.id}
                          className="px-3 py-3.5 cursor-pointer hover:bg-neutral-50/70"
                          onClick={() => setSelectedArticleId(art.id)}
                        >
                          <div className="flex min-w-0 items-start gap-2.5">
                            <span
                              className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${style.iconBg}`}
                            >
                              <Icon className="h-3.5 w-3.5" />
                            </span>
                            <div className="min-w-0 flex-1 space-y-1.5">
                              <div className="flex flex-wrap items-center gap-1.5">
                                <span
                                  className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold ${style.pill}`}
                                >
                                  {art.category}
                                </span>
                                <span className="inline-flex items-center gap-1 text-[10px] text-neutral-500">
                                  <span
                                    className={`h-1.5 w-1.5 rounded-full ${
                                      draft ? 'bg-amber-500' : 'bg-emerald-500'
                                    }`}
                                  />
                                  {draft ? 'Draft' : 'Published'}
                                </span>
                                <span className="text-[10px] tabular-nums text-neutral-400">
                                  {art.updatedAt || '—'}
                                </span>
                              </div>
                              <p className="text-sm font-semibold leading-snug text-neutral-900 break-words">
                                {displayTitle(art.title)}
                              </p>
                              <p className="text-[11px] text-neutral-400 line-clamp-2">
                                {displayExcerpt(art.content, 100)}
                              </p>
                              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-neutral-500">
                                <span className="inline-flex min-w-0 items-center gap-1.5">
                                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-[9px] font-bold text-neutral-800">
                                    {initials(art.author)}
                                  </span>
                                  <span className="truncate">
                                    {art.author || '—'}
                                  </span>
                                </span>
                                <span className="inline-flex items-center gap-1 tabular-nums">
                                  <Eye className="h-3 w-3" />
                                  {(art.views || 0).toLocaleString()}
                                </span>
                                {(art.attachments?.length || 0) > 0 && (
                                  <span className="inline-flex items-center gap-0.5">
                                    <Paperclip className="h-3 w-3" />
                                    {art.attachments!.length}
                                  </span>
                                )}
                              </div>
                              {(art.attachments?.length || 0) > 0 && (
                                <div className="flex flex-wrap gap-1 pt-0.5">
                                  {art.attachments!.slice(0, 3).map((url) => (
                                    <a
                                      key={url}
                                      href={url}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="inline-flex max-w-full items-center gap-1 truncate rounded-md border border-neutral-200 bg-white px-1.5 py-0.5 text-[10px] text-neutral-600"
                                    >
                                      <File className="h-2.5 w-2.5 shrink-0" />
                                      <span className="truncate">
                                        {fileLabel(url)}
                                      </span>
                                    </a>
                                  ))}
                                </div>
                              )}
                            </div>
                          </div>
                        </li>
                      );
                    })}
                  </ul>

                  {/* Wide panel: table */}
                  <div className="hidden min-w-0 flex-1 overflow-x-auto @[640px]:block">
                    <table className="w-full min-w-[560px] border-collapse text-left text-xs">
                      <thead>
                        <tr className="border-b border-neutral-100 bg-neutral-50/80 text-[10px] font-bold uppercase tracking-wider text-neutral-500">
                          <th className="px-3 py-3">Article</th>
                          <th className="px-2 py-3 w-28">Category</th>
                          <th className="px-2 py-3 w-36">Author</th>
                          <th className="px-2 py-3 w-16 text-center">Views</th>
                          <th className="px-2 py-3 w-28">Status</th>
                          <th className="px-2 py-3 w-24">Updated</th>
                          <th className="px-1 py-3 w-8" />
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-neutral-100">
                        {pageSlice.map((art) => {
                          const style = categoryStyle(art.category);
                          const Icon = style.Icon;
                          const draft = art.status === 'Draft';
                          return (
                            <tr
                              key={art.id}
                              className="hover:bg-neutral-50/40 transition-colors cursor-pointer"
                              onClick={() => setSelectedArticleId(art.id)}
                            >
                              <td className="px-3 py-3.5">
                                <div className="flex min-w-0 items-start gap-2">
                                  <span
                                    className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${style.iconBg}`}
                                  >
                                    <Icon className="h-3.5 w-3.5" />
                                  </span>
                                  <div className="min-w-0">
                                    <div className="flex items-center gap-1.5 font-semibold text-neutral-900">
                                      <span className="truncate">
                                        {displayTitle(art.title)}
                                      </span>
                                      {(art.attachments?.length || 0) > 0 && (
                                        <span className="inline-flex shrink-0 items-center gap-0.5 rounded-md bg-neutral-100 px-1.5 py-0.5 text-[10px] font-medium text-neutral-500">
                                          <Paperclip className="h-3 w-3" />
                                          {art.attachments!.length}
                                        </span>
                                      )}
                                    </div>
                                    <div className="mt-0.5 line-clamp-1 text-[11px] text-neutral-400">
                                      {displayExcerpt(art.content, 80)}
                                    </div>
                                  </div>
                                </div>
                              </td>
                              <td className="px-2 py-3.5">
                                <span
                                  className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold ${style.pill}`}
                                >
                                  {art.category}
                                </span>
                              </td>
                              <td className="px-2 py-3.5">
                                <span className="inline-flex min-w-0 items-center gap-2">
                                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-[10px] font-bold text-neutral-800">
                                    {initials(art.author)}
                                  </span>
                                  <span className="truncate text-neutral-700">
                                    {art.author || '—'}
                                  </span>
                                </span>
                              </td>
                              <td className="px-2 py-3.5 text-center font-medium tabular-nums text-neutral-800">
                                {(art.views || 0).toLocaleString()}
                              </td>
                              <td className="px-2 py-3.5">
                                <span className="inline-flex items-center gap-1.5 text-neutral-700">
                                  <span
                                    className={`h-1.5 w-1.5 rounded-full ${
                                      draft ? 'bg-amber-500' : 'bg-emerald-500'
                                    }`}
                                  />
                                  {draft ? 'Draft' : 'Published'}
                                </span>
                              </td>
                              <td className="px-2 py-3.5 tabular-nums text-neutral-500">
                                {art.updatedAt || '—'}
                              </td>
                              <td className="px-1 py-3.5 text-right">
                                <button
                                  type="button"
                                  className="rounded-lg p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
                                  aria-label="More"
                                >
                                  <MoreVertical className="h-4 w-4" />
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  <div className="flex flex-col gap-2 border-t border-neutral-100 px-3 py-3 @[480px]:flex-row @[480px]:items-center @[480px]:justify-between @[480px]:px-4">
                    <p className="text-[11px] text-neutral-500">
                      Showing{' '}
                      <span className="font-semibold text-neutral-700">
                        {showingFrom}
                      </span>{' '}
                      to{' '}
                      <span className="font-semibold text-neutral-700">
                        {showingTo}
                      </span>{' '}
                      of{' '}
                      <span className="font-semibold text-neutral-700">
                        {filteredArticles.length}
                      </span>{' '}
                      articles
                    </p>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        disabled={pageSafe <= 1}
                        onClick={() => setPage((p) => Math.max(1, p - 1))}
                        className="rounded-lg border border-neutral-200 p-1.5 text-neutral-500 disabled:opacity-40 hover:bg-neutral-50"
                      >
                        <ChevronLeft className="h-3.5 w-3.5" />
                      </button>
                      {Array.from({ length: totalPages }, (_, i) => i + 1)
                        .slice(0, 5)
                        .map((n) => (
                          <button
                            key={n}
                            type="button"
                            onClick={() => setPage(n)}
                            className={`min-w-7 rounded-lg px-2 py-1 text-[11px] font-semibold ${
                              n === pageSafe
                                ? 'bg-neutral-950 text-white'
                                : 'text-neutral-600 hover:bg-neutral-50'
                            }`}
                          >
                            {n}
                          </button>
                        ))}
                      <button
                        type="button"
                        disabled={pageSafe >= totalPages}
                        onClick={() =>
                          setPage((p) => Math.min(totalPages, p + 1))
                        }
                        className="rounded-lg border border-neutral-200 p-1.5 text-neutral-500 disabled:opacity-40 hover:bg-neutral-50"
                      >
                        <ChevronRight className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                </>
              )}
            </section>
          </div>

          {/* Sidebar */}
          <aside className="relative z-0 min-w-0 space-y-3 @[720px]:sticky @[720px]:top-0 @[720px]:self-start">
            <div className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
              <h4 className="text-sm font-semibold text-neutral-900">Categories</h4>
              <ul className="mt-3 space-y-1">
                {availableCategories.map((name) => {
                  const style = categoryStyle(name);
                  const Icon = style.Icon;
                  const active = activeTab === name;
                  return (
                    <li key={name}>
                      <button
                        type="button"
                        onClick={() => setActiveTab(name)}
                        className={`flex w-full items-center gap-2.5 rounded-xl px-2 py-2 text-left text-xs transition-colors ${
                          active
                            ? 'bg-neutral-950 text-white'
                            : 'text-neutral-600 hover:bg-neutral-50'
                        }`}
                      >
                        <span
                          className={`flex h-7 w-7 items-center justify-center rounded-lg ${
                            active
                              ? 'bg-white/15 text-white'
                              : style.iconBg
                          }`}
                        >
                          <Icon className="h-3.5 w-3.5" />
                        </span>
                        <span className="flex-1 font-medium truncate">{name}</span>
                        <span className={`tabular-nums ${active ? 'text-white/70' : 'text-neutral-400'}`}>
                          {categoryCounts[name] || 0}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
              {showManageCategories ? (
                <div className="mt-3 space-y-2 rounded-xl border border-neutral-100 bg-neutral-50/80 p-2.5">
                  <p className="text-[11px] text-neutral-500">
                    Add a category. It appears in filters once saved; articles keep the label in the database.
                  </p>
                  <div className="flex gap-1.5">
                    <input
                      type="text"
                      value={manageCategoryInput}
                      onChange={(e) => setManageCategoryInput(e.target.value)}
                      placeholder="Category name"
                      className="min-w-0 flex-1 rounded-lg border border-neutral-200 bg-white px-2 py-1.5 text-xs focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        const name = rememberCategory(manageCategoryInput);
                        setManageCategoryInput('');
                        setActiveTab(name);
                        setShowManageCategories(false);
                      }}
                      className="rounded-lg bg-neutral-950 px-2.5 text-[11px] font-semibold text-white"
                    >
                      Add
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setShowManageCategories(false);
                      setManageCategoryInput('');
                    }}
                    className="text-[11px] font-medium text-neutral-500 hover:text-neutral-800"
                  >
                    Done
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setShowManageCategories(true)}
                  className="mt-3 w-full text-left text-[11px] font-semibold text-neutral-900 hover:text-neutral-950"
                >
                  Manage Categories
                </button>
              )}
            </div>

            <div className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
              <h4 className="text-sm font-semibold text-neutral-900">
                Popular Articles
              </h4>
              <ul className="mt-3 space-y-2.5">
                {popularArticles.length === 0 ? (
                  <li className="text-[11px] text-neutral-400">No articles yet.</li>
                ) : (
                  popularArticles.map((art) => (
                    <li key={art.id}>
                      <button
                        type="button"
                        onClick={() => setSelectedArticleId(art.id)}
                        className="flex w-full items-start justify-between gap-2 rounded-lg px-1 py-0.5 text-left hover:bg-neutral-50"
                      >
                        <span className="min-w-0 text-xs font-medium text-neutral-800 line-clamp-2">
                          {displayTitle(art.title)}
                        </span>
                        <span className="inline-flex shrink-0 items-center gap-1 text-[11px] tabular-nums text-neutral-400">
                          <Eye className="h-3 w-3" />
                          {(art.views || 0).toLocaleString()}
                        </span>
                      </button>
                    </li>
                  ))
                )}
              </ul>
              <button
                type="button"
                onClick={() => viewAllArticles({ sort: 'views', focus: 'list' })}
                className="mt-3 inline-flex items-center gap-1 text-[11px] font-semibold text-neutral-900 hover:text-neutral-950"
              >
                View all popular
                <ArrowUpRight className="h-3 w-3" />
              </button>
            </div>

            <div className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
              <h4 className="text-sm font-semibold text-neutral-900">
                Quick Actions
              </h4>
              {sidebarHint && (
                <p className="mt-2 rounded-lg border border-neutral-100 bg-neutral-50 px-2.5 py-2 text-[11px] leading-relaxed text-neutral-600">
                  {sidebarHint}
                </p>
              )}
              <ul className="mt-3 space-y-1">
                <QuickAction
                  icon={<Plus className="h-3.5 w-3.5" />}
                  label="Create New Article"
                  onClick={
                    canMutate
                      ? () => {
                          setSidebarHint(null);
                          openCreate();
                        }
                      : undefined
                  }
                  disabled={!canMutate}
                />
                <QuickAction
                  icon={<Upload className="h-3.5 w-3.5" />}
                  label="Import Articles"
                  onClick={
                    canMutate
                      ? () => {
                          setSidebarHint(
                            'Paste JSON here, or in chat say “import articles” and paste the array for the KB agent.'
                          );
                          setShowImportForm(true);
                          setShowCreateForm(false);
                          setGuidedKb(false);
                        }
                      : undefined
                  }
                  disabled={!canMutate}
                />
                <QuickAction
                  icon={<RefreshCw className="h-3.5 w-3.5" />}
                  label="Bulk Update"
                  onClick={
                    canMutate
                      ? () => {
                          setSidebarHint(
                            'In chat, tell the KB agent what to change — e.g. “publish all Troubleshooting drafts” or “move login articles to Accounts”.'
                          );
                        }
                      : undefined
                  }
                  disabled={!canMutate}
                />
                <QuickAction
                  icon={<Download className="h-3.5 w-3.5" />}
                  label="Export Articles"
                  onClick={() => {
                    setSidebarHint(
                      'Exported from this page. In chat you can also say “export articles as csv”.'
                    );
                    downloadKbExport(
                      'json',
                      'worktual-kb.json',
                      articles.map((a) => ({
                        id: a.id,
                        title: a.title,
                        content: a.content,
                        category: a.category,
                        status: a.status,
                        author: a.author,
                        views: a.views || 0,
                      }))
                    );
                  }}
                />
              </ul>
            </div>

            <div className="rounded-2xl border border-neutral-200 bg-gradient-to-br from-neutral-50 to-white p-4 shadow-sm">
              <div className="mb-2 flex h-8 w-8 items-center justify-center rounded-lg bg-neutral-100 text-neutral-800">
                <Lightbulb className="h-4 w-4" />
              </div>
              <h4 className="text-sm font-semibold text-neutral-900">
                Improve your KB
              </h4>
              <p className="mt-1 text-[11px] leading-relaxed text-neutral-500">
                Fill gaps with clearer titles and richer bodies so agents find
                answers faster.
              </p>
              <button
                type="button"
                onClick={canMutate ? openCreate : undefined}
                className="mt-3 inline-flex items-center gap-1.5 rounded-xl bg-neutral-950 px-3 py-2 text-[11px] font-semibold text-white hover:bg-neutral-800"
              >
                <Play className="h-3 w-3 fill-current" />
                View Suggestions
              </button>
            </div>
          </aside>
        </div>
      </div>
    </PageShell>
  );

  if (onCoworkerMessage || onCoworkerChatActions) {
    return (
      <CoworkerSplitWorkspace
        pageLabel="Knowledge Base"
        contentTitle={guidedKb ? 'Next steps' : 'Articles'}
        placeholder="e.g. create article, search billing guides"
        suggestionChips={
          guidedKb
            ? guidedStepIndex === 3
              ? ['confirm', 'cancel']
              : ['cancel']
            : canMutate
              ? [
                  'create article',
                  'add category',
                  'export articles',
                  'import articles',
                  'list articles',
                ]
              : ['list articles', 'export articles', 'search KB']
        }
        getChatContext={getChatContext}
        onUserMessage={handleChatMessage}
        onChatActions={handleChatActions}
        onAgentRoute={onAgentRoute}
        module="kb"
        surface={
          guidedKb || showCreateForm
            ? 'create'
            : selectedArticle
              ? 'detail'
              : 'list'
        }
        onDraftPatch={(patch) => {
          void handleChatActions(
            [{ type: 'create_kb', ...patch }],
            { reply: '', agent: 'kb', userText: '' }
          );
        }}
        contentHeaderActions={
          guidedKb ? (
            <button
              type="button"
              onClick={openCreate}
              className="inline-flex items-center h-8 px-2.5 rounded-lg border border-neutral-200 bg-white text-xs font-semibold text-neutral-800 hover:bg-neutral-50"
            >
              Use form
            </button>
          ) : null
        }
      >
        {guidedKb ? (
          <GuidedKbPreview
            draft={{
              title: newTitle,
              category: guidedCategory || newCategory,
              body: newContent,
            }}
            stepIndex={guidedStepIndex}
            publishing={publishing}
            onCancel={cancelGuidedKb}
            onUseForm={openCreate}
            onConfirmCreate={() => {
              void handleCreateArticle();
            }}
          />
        ) : (
          listPanel
        )}
      </CoworkerSplitWorkspace>
    );
  }

  return listPanel;
}

function StatCard({
  label,
  value,
  icon,
  tone,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  tone: 'neutral' | 'emerald' | 'amber' | 'sky';
}) {
  const tones = {
    neutral: 'bg-neutral-100 text-neutral-700',
    emerald: 'bg-neutral-100 text-neutral-700',
    amber: 'bg-neutral-100 text-neutral-700',
    sky: 'bg-neutral-100 text-neutral-700',
  };
  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-3.5 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div
          className={`flex h-8 w-8 items-center justify-center rounded-lg ${tones[tone]}`}
        >
          {icon}
        </div>
      </div>
      <div className="mt-3 text-2xl font-bold tabular-nums tracking-tight text-neutral-950">
        {value.toLocaleString()}
      </div>
      <div className="mt-0.5 text-[11px] font-medium text-neutral-500">{label}</div>
    </div>
  );
}

function featuredTheme(category: string) {
  switch (category) {
    case 'Troubleshooting':
      return {
        wash: 'from-sky-100 via-sky-50 to-white',
        pill: 'bg-sky-50 text-sky-700 border-sky-200/70',
        accent: '#38bdf8',
        soft: '#e0f2fe',
        ink: '#0369a1',
      };
    case 'Accounts':
      return {
        wash: 'from-emerald-100 via-emerald-50 to-white',
        pill: 'bg-emerald-50 text-emerald-700 border-emerald-200/70',
        accent: '#34d399',
        soft: '#d1fae5',
        ink: '#047857',
      };
    case 'Billing':
      return {
        wash: 'from-indigo-100 via-indigo-50 to-white',
        pill: 'bg-indigo-50 text-indigo-700 border-indigo-200/70',
        accent: '#818cf8',
        soft: '#e0e7ff',
        ink: '#4338ca',
      };
    default:
      return {
        wash: 'from-violet-100 via-violet-50 to-white',
        pill: 'bg-violet-50 text-violet-700 border-violet-200/70',
        accent: '#a78bfa',
        soft: '#ede9fe',
        ink: '#6d28d9',
      };
  }
}

function FeatureIllustration({ category }: { category: string }) {
  const t = featuredTheme(category);
  if (category === 'Troubleshooting') {
    return (
      <svg viewBox="0 0 160 100" className="h-full w-full" aria-hidden>
        <rect x="28" y="18" width="104" height="64" rx="10" fill="#fff" stroke={t.accent} strokeWidth="2" />
        <rect x="36" y="28" width="88" height="40" rx="4" fill={t.soft} />
        <circle cx="80" cy="48" r="12" fill="#fdba74" />
        <path d="M80 42v8M80 54.5v1" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" />
        <rect x="58" y="82" width="44" height="6" rx="3" fill={t.accent} opacity="0.35" />
      </svg>
    );
  }
  if (category === 'Accounts') {
    return (
      <svg viewBox="0 0 160 100" className="h-full w-full" aria-hidden>
        <rect x="36" y="16" width="88" height="68" rx="12" fill="#fff" stroke={t.accent} strokeWidth="2" />
        <circle cx="80" cy="40" r="14" fill={t.soft} stroke={t.accent} strokeWidth="2" />
        <circle cx="80" cy="36" r="6" fill={t.accent} />
        <path d="M68 48c0-6.6 5.4-10 12-10s12 3.4 12 10" fill={t.accent} />
        <rect x="52" y="62" width="56" height="8" rx="4" fill={t.soft} />
        <rect x="60" y="74" width="40" height="5" rx="2.5" fill={t.accent} opacity="0.4" />
      </svg>
    );
  }
  // General / Billing — document / checklist card
  return (
    <svg viewBox="0 0 160 100" className="h-full w-full" aria-hidden>
      <rect x="40" y="12" width="80" height="76" rx="10" fill="#fff" stroke={t.accent} strokeWidth="2" />
      <rect x="52" y="26" width="40" height="6" rx="3" fill={t.soft} />
      <rect x="52" y="38" width="56" height="5" rx="2.5" fill={t.accent} opacity="0.35" />
      <rect x="52" y="48" width="48" height="5" rx="2.5" fill={t.accent} opacity="0.25" />
      <rect x="52" y="58" width="52" height="5" rx="2.5" fill={t.accent} opacity="0.2" />
      <circle cx="108" cy="72" r="14" fill={t.soft} stroke={t.accent} strokeWidth="2" />
      <path
        d="M102 72l4 4 8-9"
        fill="none"
        stroke={t.ink}
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

type FeaturedCardProps = {
  article: KBArticle;
  layout?: 'tile' | 'spotlight';
  onOpen?: () => void;
};

function FeaturedCard({
  article,
  layout = 'tile',
  onOpen,
}: FeaturedCardProps): React.ReactElement {
  const theme = featuredTheme(article.category);
  const spotlight = layout === 'spotlight';

  return (
    <article
      role={onOpen ? 'button' : undefined}
      tabIndex={onOpen ? 0 : undefined}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (!onOpen) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen();
        }
      }}
      className={`group min-w-0 overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-sm transition-all hover:border-neutral-300 hover:shadow-md h-full ${
        onOpen ? 'cursor-pointer' : ''
      } ${
        spotlight
          ? 'flex flex-col @[480px]:flex-row @[480px]:min-h-[168px]'
          : 'flex flex-col'
      }`}
    >
      <div
        className={`relative overflow-hidden bg-gradient-to-br ${theme.wash} ${
          spotlight
            ? 'h-[120px] w-full shrink-0 @[480px]:h-auto @[480px]:w-[42%] @[480px]:max-w-[240px]'
            : 'h-[120px] shrink-0'
        }`}
      >
        <div
          className={`absolute inset-0 ${
            spotlight
              ? 'inset-x-3 top-2 bottom-2 @[480px]:inset-4'
              : 'inset-x-4 bottom-0 top-3'
          }`}
        >
          <FeatureIllustration category={article.category} />
        </div>
      </div>

      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col gap-1.5 px-4 pb-4 pt-3.5">
        <button
          type="button"
          className="absolute right-3 top-3 rounded-lg p-1.5 text-neutral-400 transition-colors hover:bg-neutral-50 hover:text-neutral-700"
          aria-label="Bookmark"
          tabIndex={-1}
          onClick={(e) => e.stopPropagation()}
        >
          <Bookmark className="h-3.5 w-3.5" />
        </button>

        <div className="flex flex-wrap items-center gap-2 pr-7">
          <span
            className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${theme.pill}`}
          >
            {article.category}
          </span>
          <span className="text-[10px] font-medium tabular-nums text-neutral-400">
            {article.updatedAt || '—'}
          </span>
        </div>

        <h4
          className={`pr-6 font-bold leading-snug text-neutral-950 line-clamp-2 ${
            spotlight ? 'text-base @[480px]:text-lg' : 'text-[15px]'
          }`}
        >
          {displayTitle(article.title)}
        </h4>
        <p
          className={`text-[12px] leading-relaxed text-neutral-500 ${
            spotlight ? 'line-clamp-3 max-w-xl' : 'line-clamp-2'
          }`}
        >
          {displayExcerpt(article.content, spotlight ? 160 : 100)}
        </p>

        <div className="mt-auto flex items-center justify-between gap-2 border-t border-neutral-100 pt-3 text-[11px]">
          <span className="inline-flex min-w-0 items-center gap-2">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-[10px] font-bold text-neutral-800">
              {initials(article.author)}
            </span>
            <span className="truncate font-medium text-neutral-600">
              {article.author || 'Unknown'}
            </span>
          </span>
          <span className="inline-flex shrink-0 items-center gap-2 tabular-nums text-neutral-400">
            {(article.attachments?.length || 0) > 0 && (
              <span className="inline-flex items-center gap-0.5">
                <Paperclip className="h-3.5 w-3.5" />
                {article.attachments!.length}
              </span>
            )}
            <span className="inline-flex items-center gap-1">
              <Eye className="h-3.5 w-3.5" />
              {(article.views || 0).toLocaleString()} views
            </span>
          </span>
        </div>
      </div>
    </article>
  );
}

function QuickAction({
  icon,
  label,
  onClick,
  disabled,
}: {
  icon: React.ReactNode;
  label: string;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <li>
      <button
        type="button"
        disabled={disabled}
        onClick={onClick}
        className="flex w-full items-center gap-2.5 rounded-xl px-2 py-2 text-left text-xs font-medium text-neutral-700 transition-colors hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-45"
      >
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-neutral-100 text-neutral-600">
          {icon}
        </span>
        {label}
      </button>
    </li>
  );
}
