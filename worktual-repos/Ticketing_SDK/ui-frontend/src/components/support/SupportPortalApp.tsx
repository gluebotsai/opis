import React, { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Building2,
  Check,
  CheckCircle2,
  ChevronRight,
  Copy,
  Clock,
  FileText,
  LifeBuoy,
  Lock,
  LogOut,
  Mail,
  MessageCircle,
  Package,
  Paperclip,
  Phone,
  Plus,
  RotateCcw,
  X,
  Search,
  Send,
  Sparkles,
  Star,
  Ticket,
  User,
} from 'lucide-react';
import {
  handleCoworkerCopy,
  renderAssistantMessage,
} from '../coworker/CoworkerChatPanel';

type PortalConfig = {
  slug: string;
  name: string;
  portalLabel: string;
  portalLogoUrl?: string;
  portalAuthMode: 'password' | 'otp';
  businessType: 'b2b' | 'b2c';
};

type PortalCustomer = {
  id: string;
  name: string;
  email: string;
  phone: string;
  accountName?: string | null;
  products?: Array<{ id: string; code: string; name: string }>;
};

type PortalTicket = {
  id: string;
  subject: string;
  description: string;
  status: string;
  priority: string;
  createdAt: string;
  updatedAt: string;
  csatScore?: number | null;
  csatComment?: string | null;
  attachments?: string[];
};

function ticketFileIsImage(url: string): boolean {
  const name = url.split('/').pop() || '';
  const dot = name.lastIndexOf('.');
  if (dot < 0) return false;
  const ext = name.slice(dot + 1).toLowerCase();
  return (
    ext === 'png' ||
    ext === 'jpg' ||
    ext === 'jpeg' ||
    ext === 'gif' ||
    ext === 'webp' ||
    ext === 'bmp'
  );
}

type PortalAuthDialog = {
  title: string;
  body: string;
  code?: string;
};

type Article = {
  id: string;
  title: string;
  excerpt?: string;
  content?: string;
  category: string;
};

type PortalChatAttachment = { url: string; name: string };
type PortalChatMessage = {
  role: 'user' | 'assistant';
  text: string;
  attachments?: PortalChatAttachment[];
};

const inputClass =
  'w-full h-11 rounded-xl border border-neutral-200 bg-white px-3 text-sm text-neutral-900 placeholder:text-neutral-400 transition-colors';
const primaryBtn =
  'inline-flex items-center justify-center gap-2 h-11 px-4 rounded-xl bg-neutral-950 text-white text-sm font-semibold hover:bg-neutral-800 disabled:opacity-60 transition-colors';
const ghostBtn =
  'inline-flex items-center justify-center gap-2 h-11 px-4 rounded-xl border border-neutral-200 bg-white text-sm font-semibold text-neutral-800 hover:border-neutral-300 hover:bg-neutral-50 transition-colors';

function portalPath(slug: string, rest = '') {
  return `/support/${encodeURIComponent(slug)}${rest}`;
}

function supportApi(slug: string, rest = '') {
  return `/api/public/support/${encodeURIComponent(slug)}${rest}`;
}

function parsePortalLocation(): { slug: string; page: string; extra: string } {
  const parts = window.location.pathname.split('/').filter(Boolean);
  const decodePart = (value: string) => {
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  };
  const slug = decodePart(parts[1] || '');
  const page = decodePart(parts[2] || 'home');
  const extra = parts.slice(3).map(decodePart).join('/');
  return { slug, page, extra };
}

function formatWhen(raw?: string) {
  if (!raw) return '—';
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatDateTime(raw?: string) {
  if (!raw) return '—';
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function portalChatStorageKey(slug: string, customerId: string) {
  return `worktual_portal_chat:${slug}:${customerId}`;
}

function newPortalChatSessionId(slug: string, customerId: string) {
  const nonce =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `portal_${slug}_${customerId}_${nonce}`;
}

function normalizePortalChatMessages(raw: unknown): PortalChatMessage[] {
  if (!Array.isArray(raw)) return [];
  const out: PortalChatMessage[] = [];
  for (const row of raw) {
    if (!row || typeof row !== 'object') continue;
    const role = String((row as { role?: string }).role || '').trim();
    const text = String((row as { text?: string }).text || '').trim();
    if ((role === 'user' || role === 'assistant') && text) {
      out.push({ role, text });
    }
  }
  return out.slice(-100);
}

/** Restore mid-conversation chat after article navigation / remount. */
function loadPortalChatSession(slug: string, customerId: string): {
  sessionId: string;
  messages: PortalChatMessage[];
} {
  try {
    const raw = window.sessionStorage.getItem(portalChatStorageKey(slug, customerId));
    if (raw) {
      const parsed = JSON.parse(raw) as { sessionId?: string; messages?: unknown };
      const sessionId = String(parsed?.sessionId || '').trim();
      const messages = normalizePortalChatMessages(parsed?.messages);
      if (sessionId) {
        return { sessionId, messages };
      }
    }
  } catch {
    // Privacy mode / quota — start a new local session.
  }
  return {
    sessionId: newPortalChatSessionId(slug, customerId),
    messages: [],
  };
}

/** Explicit restart / logout only — clears stored transcript. */
function freshPortalChatSession(slug: string, customerId: string): {
  sessionId: string;
  messages: PortalChatMessage[];
} {
  clearPortalChatSession(slug, customerId);
  return {
    sessionId: newPortalChatSessionId(slug, customerId),
    messages: [],
  };
}

function clearPortalChatSession(slug: string, customerId: string) {
  try {
    window.sessionStorage.removeItem(portalChatStorageKey(slug, customerId));
  } catch {
    // Storage may be unavailable in privacy-restricted browsers.
  }
}

function statusTone(status: string) {
  const s = String(status || '').toLowerCase();
  if (s.includes('resolve') || s.includes('close')) return 'bg-neutral-950 text-white border-neutral-950';
  if (s.includes('pending') || s.includes('in progress') || s.includes('hold'))
    return 'bg-neutral-200 text-neutral-900 border-neutral-300';
  if (s.includes('overdue')) return 'bg-neutral-700 text-white border-neutral-700';
  return 'bg-white text-neutral-800 border-neutral-300';
}

/** Same customer label as staff: stored Pending is shown as In Progress. */
function portalStatusLabel(status: string) {
  const raw = String(status || '').trim();
  if (raw.toLowerCase() === 'pending') return 'In Progress';
  return raw || 'Open';
}

/** Screen-only. Stored category / filter values stay as saved. */
function displayCategoryLabel(raw: string | undefined | null): string {
  const s = String(raw || '').trim();
  return s ? s.toUpperCase() : 'GENERAL';
}

function categoryTone(category: string) {
  const key = String(category || 'general').toLowerCase();
  if (key.includes('how') || key.includes('guide')) return 'bg-neutral-950 text-white border-neutral-950';
  if (key.includes('bill')) return 'bg-neutral-700 text-white border-neutral-700';
  if (key.includes('trouble') || key.includes('fix')) return 'bg-neutral-200 text-neutral-900 border-neutral-300';
  if (key.includes('account')) return 'bg-white text-neutral-800 border-neutral-300';
  return 'bg-neutral-100 text-neutral-600 border-neutral-200';
}

function isResolvedPortalStatus(status: string) {
  return String(status || '').trim().toLowerCase() === 'resolved';
}

function isClosedPortalStatus(status: string) {
  return String(status || '').trim().toLowerCase() === 'closed';
}

function isFinishedPortalStatus(status: string) {
  return isResolvedPortalStatus(status) || isClosedPortalStatus(status);
}

const CSAT_LEVELS = [
  { score: 1, label: 'Very Dissatisfied' },
  { score: 2, label: 'Dissatisfied' },
  { score: 3, label: 'Neutral' },
  { score: 4, label: 'Satisfied' },
  { score: 5, label: 'Very Satisfied' },
] as const;

function csatLabelForScore(score: number | null | undefined): string | null {
  if (score == null || !Number.isFinite(Number(score))) return null;
  return CSAT_LEVELS.find((row) => row.score === Number(score))?.label ?? null;
}

function CsatStars({
  value,
  onChange,
  disabled,
  size = 'md',
  variant = 'default',
}: {
  value: number | null;
  onChange?: (score: number) => void;
  disabled?: boolean;
  size?: 'sm' | 'md';
  variant?: 'default' | 'onDark';
}) {
  const [hover, setHover] = useState<number | null>(null);
  const shown = hover ?? value ?? 0;
  const interactive = Boolean(onChange) && !disabled;
  const glyph = size === 'sm' ? 'h-[14px] w-[14px]' : 'h-[18px] w-[18px]';
  const hit = size === 'sm' ? 'h-7 w-7' : 'h-[38px] w-[38px]';
  const filledClass =
    variant === 'onDark'
      ? 'fill-amber-300 text-amber-300'
      : 'fill-amber-400 text-amber-400';
  const emptyClass =
    variant === 'onDark'
      ? 'fill-none text-white/45'
      : 'fill-none text-[#bfbfbf]';
  return (
    <div
      className="flex shrink-0 flex-nowrap items-center"
      onMouseLeave={() => setHover(null)}
      role={interactive ? 'radiogroup' : 'img'}
      aria-label={
        csatLabelForScore(value) ||
        (interactive ? 'Satisfaction rating' : 'Not rated')
      }
    >
      {CSAT_LEVELS.map((row) => {
        const filled = shown >= row.score;
        const inner = (
          <Star
            className={`${glyph} ${filled ? filledClass : emptyClass}`}
            strokeWidth={2.25}
          />
        );
        if (!interactive) {
          return (
            <span key={row.score} className={`grid ${hit} place-items-center`} aria-hidden>
              {inner}
            </span>
          );
        }
        return (
          <button
            key={row.score}
            type="button"
            role="radio"
            aria-checked={value === row.score}
            aria-label={row.label}
            title={row.label}
            disabled={disabled}
            onMouseEnter={() => setHover(row.score)}
            onFocus={() => setHover(row.score)}
            onClick={() => onChange?.(row.score)}
            className={`grid ${hit} place-items-center rounded-lg transition-colors disabled:opacity-50 hover:bg-neutral-50`}
          >
            {inner}
          </button>
        );
      })}
    </div>
  );
}

function PortalAuthDialogModal({
  dialog,
  orgName,
  onClose,
}: {
  dialog: PortalAuthDialog;
  orgName: string;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/40 px-4 backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="portal-auth-dialog-title"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-3xl border border-neutral-200 bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-amber-50 text-amber-900 border border-amber-200">
            <AlertTriangle className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id="portal-auth-dialog-title" className="text-base font-semibold text-neutral-950">
              {dialog.title}
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-neutral-600">{dialog.body}</p>
            {dialog.code === 'customer_not_found' && (
              <p className="mt-3 text-xs leading-relaxed text-neutral-500">
                Only customers already registered with {orgName} can sign in to raise or track tickets.
                Contact support if you believe your details should be on file.
              </p>
            )}
          </div>
        </div>
        <div className="mt-5 flex justify-end">
          <button type="button" className={primaryBtn} onClick={onClose}>
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}

export default function SupportPortalApp() {
  const [loc, setLoc] = useState(parsePortalLocation);
  useEffect(() => {
    const onPop = () => setLoc(parsePortalLocation());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  const [config, setConfig] = useState<PortalConfig | null>(null);
  const [loadError, setLoadError] = useState('');
  const [customer, setCustomer] = useState<PortalCustomer | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    (async () => {
      if (!loc.slug) {
        setLoadError('Missing organization in the support URL.');
        setReady(true);
        return;
      }
      try {
        const res = await fetch(supportApi(loc.slug));
        if (!res.ok) {
          setLoadError('Support portal not found.');
          setReady(true);
          return;
        }
        setConfig(await res.json());
        const me = await fetch('/api/portal/me', { credentials: 'include' });
        if (me.ok) {
          const data = await me.json();
          setCustomer(data.customer || null);
        }
      } catch {
        setLoadError('Could not load the support portal.');
      } finally {
        setReady(true);
      }
    })();
  }, [loc.slug]);

  if (!ready) {
    return (
      <div className="min-h-svh grid place-items-center bg-canvas text-sm text-neutral-500">
        Loading…
      </div>
    );
  }
  if (loadError || !config) {
    return (
      <div className="min-h-svh grid place-items-center bg-canvas px-4">
        <div className="max-w-md w-full bg-white border border-neutral-200 rounded-2xl p-8 text-center shadow-sm">
          <LifeBuoy className="h-8 w-8 mx-auto text-neutral-400 mb-3" />
          <p className="text-sm font-semibold text-neutral-900">{loadError || 'Not found'}</p>
          <p className="text-xs text-neutral-500 mt-2">Check the support link from your organization.</p>
        </div>
      </div>
    );
  }

  const go = (path: string) => {
    window.history.pushState({}, '', path);
    setLoc(parsePortalLocation());
  };

  return (
    <PortalShell
      config={config}
      customer={customer}
      page={loc.page}
      extra={loc.extra}
      onNavigate={go}
      onCustomer={setCustomer}
    />
  );
}

function PortalShell({
  config,
  customer,
  page,
  extra,
  onNavigate,
  onCustomer,
}: {
  config: PortalConfig;
  customer: PortalCustomer | null;
  page: string;
  extra: string;
  onNavigate: (path: string) => void;
  onCustomer: (c: PortalCustomer | null) => void;
}) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const onPop = () => setTick((n) => n + 1);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  void tick;

  const logout = async () => {
    try {
      await fetch('/api/portal/logout', { method: 'POST', credentials: 'include' });
    } finally {
      clearPortalChatSession(config.slug, customer?.id || 'guest');
      onCustomer(null);
      onNavigate(portalPath(config.slug));
    }
  };

  const gated = page === 'tickets' || page === 'profile' || page === 'new';
  if (gated && !customer) {
    return (
      <Layout config={config} customer={customer} page={page} onNavigate={onNavigate} onLogout={logout}>
        <AuthPanel config={config} onCustomer={onCustomer} onNavigate={onNavigate} />
      </Layout>
    );
  }

  return (
    <Layout config={config} customer={customer} page={page} onNavigate={onNavigate} onLogout={logout}>
      {page === 'login' || page === 'set-password' ? (
        <AuthPanel
          config={config}
          onCustomer={onCustomer}
          onNavigate={onNavigate}
          mode={page === 'set-password' ? 'set-password' : 'login'}
        />
      ) : page === 'tickets' && extra ? (
        <TicketDetail slug={config.slug} ticketNumber={extra} onNavigate={onNavigate} />
      ) : page === 'tickets' ? (
        <TicketList slug={config.slug} onNavigate={onNavigate} />
      ) : page === 'new' ? (
        <HomePanel
          key={`home-${customer?.id || 'guest'}`}
          config={config}
          customer={customer}
          onNavigate={onNavigate}
          composeTicket
        />
      ) : page === 'profile' ? (
        <ProfilePanel slug={config.slug} onNavigate={onNavigate} />
      ) : page === 'a' && extra ? (
        <ArticleDetail slug={config.slug} articleId={extra} onNavigate={onNavigate} />
      ) : (
        <HomePanel
          key={`home-${customer?.id || 'guest'}`}
          config={config}
          customer={customer}
          onNavigate={onNavigate}
        />
      )}
    </Layout>
  );
}

function Layout({
  config,
  customer,
  page,
  onNavigate,
  onLogout,
  children,
}: {
  config: PortalConfig;
  customer: PortalCustomer | null;
  page: string;
  onNavigate: (path: string) => void;
  onLogout: () => void;
  children: React.ReactNode;
}) {
  const brand = config.portalLabel || config.name;
  const [logoBroken, setLogoBroken] = useState(false);
  useEffect(() => {
    setLogoBroken(false);
  }, [config.portalLogoUrl]);
  const nav = (key: string) =>
    `inline-flex h-9 items-center justify-center rounded-lg px-3 text-sm font-medium transition-colors ${
      page === key || (key === 'home' && (page === 'home' || page === 'a'))
        ? 'bg-white/10 text-white'
        : 'text-white/70 hover:text-white hover:bg-white/5'
    }`;

  return (
    <div className="min-h-svh bg-canvas text-neutral-900 font-sans">
      <header className="sticky top-0 z-20 border-b border-white/10 bg-black/95 backdrop-blur-md text-white">
        <div className="grid h-16 w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-6 px-5 sm:px-8 lg:px-10">
          <button
            type="button"
            className="flex h-10 min-w-0 items-center gap-2.5 justify-self-start text-left"
            onClick={() => onNavigate(portalPath(config.slug))}
          >
            {config.portalLogoUrl && !logoBroken ? (
              <img
                src={config.portalLogoUrl}
                alt=""
                className="h-9 w-9 shrink-0 rounded-xl object-contain bg-white"
                onError={() => setLogoBroken(true)}
              />
            ) : (
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-white/20 bg-white/10">
                <LifeBuoy className="h-4 w-4 text-white" />
              </span>
            )}
            <span className="truncate text-sm font-semibold tracking-tight sm:text-base">{brand}</span>
          </button>
          <nav className="flex items-center justify-self-end gap-1">
            <button type="button" className={nav('home')} onClick={() => onNavigate(portalPath(config.slug))}>
              Help
            </button>
            <button
              type="button"
              className={nav('tickets')}
              onClick={() => onNavigate(portalPath(config.slug, '/tickets'))}
            >
              Tickets
            </button>
            {customer ? (
              <>
                <button
                  type="button"
                  className={`${nav('profile')} ml-1 max-w-40 border-l border-white/15 pl-4`}
                  onClick={() => onNavigate(portalPath(config.slug, '/profile'))}
                >
                  <span className="truncate">{customer.name}</span>
                </button>
                <button
                  type="button"
                  onClick={() => void onLogout()}
                  className="ml-1 inline-flex h-9 items-center gap-1.5 rounded-lg border border-white/15 px-3 text-xs font-semibold text-white/80 transition-colors hover:bg-white/10 hover:text-white"
                >
                  <LogOut className="h-3.5 w-3.5" /> Sign out
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => onNavigate(portalPath(config.slug, '/login'))}
                className="ml-1 inline-flex h-9 items-center rounded-lg bg-white px-3.5 text-xs font-semibold text-black transition-colors hover:bg-neutral-200"
              >
                Sign in
              </button>
            )}
          </nav>
        </div>
      </header>
      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-8 sm:py-10">{children}</main>
    </div>
  );
}

const PORTAL_OTP_PENDING_MS = 10 * 60 * 1000;

function portalOtpPendingKey(slug: string): string {
  return `portal-otp-pending:${slug}`;
}

function readPendingPortalOtp(slug: string): { identifier: string; masked: string } | null {
  try {
    const raw = sessionStorage.getItem(portalOtpPendingKey(slug));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { identifier?: string; masked?: string; sentAt?: number };
    const identifier = String(parsed.identifier || '').trim();
    const sentAt = Number(parsed.sentAt);
    if (!identifier || !Number.isFinite(sentAt) || Date.now() - sentAt > PORTAL_OTP_PENDING_MS) {
      sessionStorage.removeItem(portalOtpPendingKey(slug));
      return null;
    }
    return { identifier, masked: String(parsed.masked || '').trim() };
  } catch {
    return null;
  }
}

function writePendingPortalOtp(slug: string, identifier: string, masked: string) {
  try {
    sessionStorage.setItem(
      portalOtpPendingKey(slug),
      JSON.stringify({ identifier, masked, sentAt: Date.now() })
    );
  } catch {
    /* The verify step still works for this visit if storage is unavailable. */
  }
}

function clearPendingPortalOtp(slug: string) {
  try {
    sessionStorage.removeItem(portalOtpPendingKey(slug));
  } catch {
    /* ignore */
  }
}

function AuthPanel({
  config,
  onCustomer,
  onNavigate,
  mode = 'login',
}: {
  config: PortalConfig;
  onCustomer: (c: PortalCustomer) => void;
  onNavigate: (path: string) => void;
  mode?: 'login' | 'set-password';
}) {
  const token = useMemo(() => new URLSearchParams(window.location.search).get('token') || '', []);
  const slug = parsePortalLocation().slug || config.slug;
  const pendingOtp =
    mode === 'login' && config.portalAuthMode !== 'password' ? readPendingPortalOtp(slug) : null;
  const [identifier, setIdentifier] = useState(pendingOtp?.identifier ?? '');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [otpSent, setOtpSent] = useState(Boolean(pendingOtp));
  const [masked, setMasked] = useState(pendingOtp?.masked ?? '');
  const [error, setError] = useState('');
  const [resetMsg, setResetMsg] = useState('');
  const [authDialog, setAuthDialog] = useState<PortalAuthDialog | null>(null);
  const [loading, setLoading] = useState(false);

  const showAuthFailure = (data: {
    error?: string;
    code?: string;
    identifierKind?: string;
  }) => {
    const code = String(data.code || '');
    const idLabel =
      data.identifierKind === 'phone'
        ? identifier.trim() || 'this phone number'
        : identifier.trim() || 'this email';

    if (code === 'customer_not_found') {
      setAuthDialog({
        code,
        title: 'No customer account found',
        body: `We could not find a customer record for ${idLabel}. A verification code was not sent.`,
      });
      setError('');
      return;
    }
    if (code === 'customer_inactive') {
      setAuthDialog({
        code,
        title: 'Account inactive',
        body:
          data.error ||
          'Your customer record exists but is not active. Contact support to restore access.',
      });
      setError('');
      return;
    }
    setError(data.error || 'Sign-in failed.');
  };

  const finish = (customer: PortalCustomer) => {
    clearPendingPortalOtp(slug);
    onCustomer(customer);
    onNavigate(portalPath(slug, '/tickets'));
  };

  const sendOtp = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setLoading(true);
    setError('');
    try {
      const res = await fetch(supportApi(slug, '/otp/request'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier }),
      });
      const data = await res.json();
      if (!res.ok) {
        showAuthFailure(data);
        return;
      }
      const sentTo = identifier.trim();
      const sentMasked = String(data.masked || '');
      setOtpSent(true);
      setMasked(sentMasked);
      setCode('');
      writePendingPortalOtp(slug, sentTo, sentMasked);
    } catch {
      setError('Could not send a code.');
    } finally {
      setLoading(false);
    }
  };

  const verifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const res = await fetch(supportApi(slug, '/otp/verify'), {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier, code }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.code === 'customer_not_found' || data.code === 'customer_inactive') {
          showAuthFailure(data);
        } else {
          setError(data.error || 'Invalid code.');
        }
        return;
      }
      finish(data.customer);
    } catch {
      setError('Could not verify the code.');
    } finally {
      setLoading(false);
    }
  };

  const loginPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const res = await fetch(supportApi(slug, '/login'), {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: identifier, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        showAuthFailure(data);
        return;
      }
      finish(data.customer);
    } catch {
      setError('Sign-in failed.');
    } finally {
      setLoading(false);
    }
  };

  const requestPasswordReset = async () => {
    setLoading(true);
    setError('');
    setResetMsg('');
    try {
      const res = await fetch(supportApi(slug, '/forgot-password'), {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: identifier }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || 'Could not send a reset email.');
        return;
      }
      setResetMsg(
        'If that email is on a customer record, we sent a password reset link. Check your inbox.'
      );
    } catch {
      setError('Could not send a reset email.');
    } finally {
      setLoading(false);
    }
  };

  const goBack = () => {
    if (window.history.length > 1) {
      window.history.back();
      return;
    }
    onNavigate(portalPath(slug));
  };

  const setPw = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const res = await fetch(supportApi(slug, '/set-password'), {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Could not set password.');
        return;
      }
      if (data.customer) finish(data.customer);
      else onNavigate(portalPath(slug, '/login'));
    } catch {
      setError('Could not set password.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-md">
      {authDialog && (
        <PortalAuthDialogModal
          dialog={authDialog}
          orgName={config.name}
          onClose={() => setAuthDialog(null)}
        />
      )}
      <div className="rounded-3xl border border-neutral-200/80 bg-white p-7 shadow-[0_20px_50px_-24px_rgba(15,10,40,0.35)] sm:p-8">
        <button
          type="button"
          onClick={goBack}
          className="mb-5 inline-flex h-[38px] items-center gap-2 text-sm font-semibold text-neutral-800 hover:text-neutral-950"
        >
          <ArrowLeft className="h-[18px] w-[18px]" strokeWidth={2.25} />
          Back
        </button>
        <div className="space-y-5">
        <div className="flex items-center gap-3">
          <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-neutral-100 text-black">
            {mode === 'set-password' ? <Lock className="h-5 w-5" /> : <User className="h-5 w-5" />}
          </div>
          <h1 className="text-xl font-semibold tracking-tight">
            {mode === 'set-password' ? 'Set your password' : 'Verify you are a customer'}
          </h1>
        </div>
        <div className="space-y-1.5">
          {mode !== 'set-password' && (
            <p className="text-sm text-neutral-600">
              Sign in to <span className="font-semibold text-neutral-900">{config.name}</span>
            </p>
          )}
          <p className="text-xs text-neutral-500 leading-relaxed">
            Anyone can browse help articles. Raising or checking a ticket requires a customer already in this
            organization.
          </p>
        </div>
        {error && (
          <p className="text-xs text-neutral-900 bg-neutral-100 border border-neutral-300 rounded-xl px-3 py-2.5 flex gap-2">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            {error}
          </p>
        )}
        {mode === 'set-password' ? (
          <form onSubmit={setPw} className="space-y-3">
            <input
              type="password"
              minLength={8}
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="New password (8+ characters)"
              className={inputClass}
            />
            <button disabled={loading} className={`${primaryBtn} w-full`}>
              {loading ? 'Saving…' : 'Save password'}
            </button>
          </form>
        ) : config.portalAuthMode === 'password' ? (
          <form onSubmit={loginPassword} className="space-y-3">
            <label className="block space-y-1.5">
              <span className="text-xs font-semibold text-neutral-700">Email</span>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-neutral-400" />
                <input
                  type="email"
                  required
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  placeholder="you@company.com"
                  className={`${inputClass} pl-10`}
                />
              </div>
            </label>
            <label className="block space-y-1.5">
              <span className="text-xs font-semibold text-neutral-700">Password</span>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Password"
                className={inputClass}
              />
            </label>
            <button disabled={loading} className={`${primaryBtn} w-full`}>
              {loading ? 'Signing in…' : 'Sign in'}
            </button>
            <button
              type="button"
              disabled={loading || !identifier.trim()}
              onClick={() => void requestPasswordReset()}
              className="w-full text-xs font-semibold text-neutral-600 hover:text-neutral-950"
            >
              Forgot password?
            </button>
            {resetMsg && (
              <p className="text-xs text-neutral-600 leading-relaxed">{resetMsg}</p>
            )}
          </form>
        ) : (
          <form onSubmit={otpSent ? verifyOtp : sendOtp} className="space-y-3">
            <label className="block space-y-1.5">
              <span className="text-xs font-semibold text-neutral-700">Email or phone</span>
              <input
                required
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                placeholder="Email or phone on your customer record"
                className={inputClass}
              />
            </label>
            {otpSent && (
              <>
                <p className="text-xs text-neutral-500">Code sent to {masked}.</p>
                <input
                  required
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="6-digit code"
                  className={inputClass}
                />
              </>
            )}
            <button disabled={loading} className={`${primaryBtn} w-full`}>
              {loading ? 'Please wait…' : otpSent ? 'Verify code' : 'Send code'}
            </button>
            {otpSent ? (
              <button
                type="button"
                disabled={loading || !identifier.trim()}
                onClick={() => void sendOtp()}
                className="w-full h-[38px] rounded-lg border-[0.6px] border-[#bfbfbf] bg-white text-sm font-semibold text-neutral-800 hover:bg-neutral-50 shadow-none disabled:opacity-50"
              >
                Resend code
              </button>
            ) : null}
          </form>
        )}
        </div>
      </div>
    </div>
  );
}

const PORTAL_COMPOSER_MIN_PX = 20;
const PORTAL_COMPOSER_MAX_PX = 192;

function syncPortalComposerHeight(el: HTMLTextAreaElement | null): number {
  if (!el) return PORTAL_COMPOSER_MIN_PX;
  el.style.overflowY = 'hidden';
  el.style.height = '0px';
  const next = Math.min(Math.max(el.scrollHeight, PORTAL_COMPOSER_MIN_PX), PORTAL_COMPOSER_MAX_PX);
  el.style.height = `${next}px`;
  if (el.scrollHeight > PORTAL_COMPOSER_MAX_PX) el.style.overflowY = 'auto';
  return next;
}

function HomePanel({
  config,
  customer,
  onNavigate,
  composeTicket = false,
}: {
  config: PortalConfig;
  customer: PortalCustomer | null;
  onNavigate: (path: string) => void;
  composeTicket?: boolean;
}) {
  const chatCustomerId = customer?.id || 'guest';
  const initialChatSession = useMemo(
    () => loadPortalChatSession(config.slug, chatCustomerId),
    [config.slug, chatCustomerId]
  );
  const [q, setQ] = useState('');
  const [articles, setArticles] = useState<Article[]>([]);
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [chat, setChat] = useState<PortalChatMessage[]>(() => initialChatSession.messages);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [raising, setRaising] = useState(
    composeTicket || new URLSearchParams(window.location.search).get('raise') === '1'
  );
  const [previewArticleId, setPreviewArticleId] = useState<string | null>(null);
  const chatBoxRef = useRef<HTMLDivElement>(null);
  const chatMessagesRef = useRef<HTMLDivElement>(null);
  const chatInputRef = useRef<HTMLTextAreaElement>(null);
  const [composerExpanded, setComposerExpanded] = useState(false);
  const ticketFileRef = useRef<HTMLInputElement>(null);
  const ticketFileInputId = useId();
  const [pendingAttachments, setPendingAttachments] = useState<string[]>([]);
  const [attachError, setAttachError] = useState('');
  const [chatSessionId, setChatSessionId] = useState(() => initialChatSession.sessionId);
  const sessionEpochRef = useRef(0);
  const busyRef = useRef(false);

  const markBusy = (next: boolean) => {
    busyRef.current = next;
    setBusy(next);
  };

  // Identity changes remount HomePanel. Keep transient input clean on that boundary.
  useEffect(() => {
    setMessage('');
    markBusy(false);
    setRaising(composeTicket || new URLSearchParams(window.location.search).get('raise') === '1');
  }, [chatSessionId, composeTicket]);

  useLayoutEffect(() => {
    setComposerExpanded(syncPortalComposerHeight(chatInputRef.current) > 40);
  }, [message]);

  useEffect(() => {
    // Keep transcript + sessionId across article views / HomePanel remounts.
    try {
      window.sessionStorage.setItem(
        portalChatStorageKey(config.slug, chatCustomerId),
        JSON.stringify({ sessionId: chatSessionId, messages: chat.slice(-100) })
      );
    } catch {
      // Chat still works when session storage is unavailable.
    }
  }, [chat, chatCustomerId, chatSessionId, config.slug]);

  const clearChatSession = () => {
    sessionEpochRef.current += 1;
    clearPortalChatSession(config.slug, chatCustomerId);
    markBusy(false);
    setMessage('');
    setChat([]);
    setPendingAttachments([]);
    setAttachError('');
    setRaising(composeTicket || new URLSearchParams(window.location.search).get('raise') === '1');
    const next = freshPortalChatSession(config.slug, chatCustomerId);
    setChatSessionId(next.sessionId);
    requestAnimationFrame(() => {
      chatInputRef.current?.focus();
    });
  };

  const focusRaiseChat = () => {
    if (!customer) {
      onNavigate(portalPath(config.slug, '/login'));
      return;
    }
    setRaising(true);
    requestAnimationFrame(() => {
      chatBoxRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      chatInputRef.current?.focus();
    });
  };

  useEffect(() => {
    if (!raising || !customer) return;
    chatBoxRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    chatInputRef.current?.focus();
  }, [raising, customer]);

  useEffect(() => {
    const node = chatMessagesRef.current;
    if (!node) return;
    node.scrollTo({ top: node.scrollHeight, behavior: 'smooth' });
  }, [chat, busy]);

  useEffect(() => {
    if (!busy) chatInputRef.current?.focus();
  }, [busy]);

  const loadArticles = async (query = '') => {
    const res = await fetch(`${supportApi(config.slug, '/articles')}?q=${encodeURIComponent(query)}`);
    if (!res.ok) return;
    const data = await res.json();
    setArticles(data.articles || []);
    setSelectedCategories([]);
  };

  useEffect(() => {
    const t = window.setTimeout(() => {
      void loadArticles(q);
    }, q.trim() ? 250 : 0);
    return () => window.clearTimeout(t);
  }, [config.slug, q]);

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const a of articles) {
      const c = String(a.category || '').trim();
      if (c) set.add(c);
    }
    return Array.from(set);
  }, [articles]);

  const visible = useMemo(() => {
    if (selectedCategories.length === 0) return articles;
    const picked = new Set(selectedCategories);
    return articles.filter((a) => picked.has(String(a.category || '').trim()));
  }, [articles, selectedCategories]);

  const toggleCategory = (c: string) => {
    setSelectedCategories((prev) => {
      if (prev.includes(c)) return prev.filter((x) => x !== c);
      const next = [...prev, c];
      if (next.length >= categories.length) return [];
      return next;
    });
  };

  const sendPortalTurn = async (textRaw: string, attachments: string[]) => {
    const text = textRaw.trim();
    const attachmentUrls = attachments.filter((url) => url.startsWith('/uploads/'));
    const outgoingAttachments = attachmentUrls.map((url) => ({
      url,
      name: url.split('/').filter(Boolean).pop() || url,
    }));
    if (!text && !outgoingAttachments.length) return;
    if (busyRef.current) return;
    const epoch = sessionEpochRef.current;
    markBusy(true);
    setMessage('');
    setPendingAttachments([]);
    setChat((c) => [
      ...c,
      {
        role: 'user',
        text,
        attachments: outgoingAttachments.length ? outgoingAttachments : undefined,
      },
    ]);
    try {
      const res = await fetch('/api/portal/chat', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slug: config.slug,
          message: text,
          sessionId: chatSessionId,
          // Include the turn being sent so #N in this message is available server-side.
          history: [
            ...chat.map((m) => ({ role: m.role, text: m.text })),
            { role: 'user' as const, text },
          ],
          attachments: attachmentUrls,
        }),
      });
      const data = await res.json();
      if (epoch !== sessionEpochRef.current) return;
      const reply = String(data.reply || data.error || 'I could not reply just now.');
      setChat((c) => [...c, { role: 'assistant', text: reply }]);
      // Related articles from this chat turn (DSSA or list_kb / get_kb). Never invent rows.
      if (Array.isArray(data.articles) && data.articles.length) {
        setArticles(data.articles);
        setSelectedCategories([]);
      }
    } catch {
      if (epoch !== sessionEpochRef.current) return;
      setChat((c) => [...c, { role: 'assistant', text: 'Chat is temporarily unavailable.' }]);
    } finally {
      if (epoch === sessionEpochRef.current) markBusy(false);
    }
  };
  const sendChat = (e: React.FormEvent) => {
    e.preventDefault();
    if (busyRef.current) return;
    void sendPortalTurn(message, pendingAttachments);
  };

  return (
    <div className="space-y-8">
      <section className="relative overflow-hidden rounded-3xl bg-black text-white px-6 py-8 sm:px-10 sm:py-11 shadow-[0_24px_60px_-28px_rgba(0,0,0,0.55)]">
        <div
          className="pointer-events-none absolute inset-0 opacity-80"
          style={{
            background:
              'radial-gradient(ellipse 70% 80% at 12% 0%, rgba(255,255,255,0.16), transparent 55%), radial-gradient(ellipse 50% 60% at 100% 100%, rgba(255,255,255,0.08), transparent 50%)',
          }}
        />
        <div className="relative space-y-5 max-w-2xl">
          <p className="text-[18px] font-semibold uppercase tracking-[0.18em] text-white/60">
            {config.name} support
          </p>
          <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight leading-tight">How can we help?</h1>
          <p className="text-sm text-white/65 leading-relaxed">
            Search published articles or ask the assistant. Filing and tracking tickets is for customers already in this
            organization.
          </p>
          <form
            className="flex flex-col sm:flex-row gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void loadArticles(q);
            }}
          >
            <div className="relative flex-1">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-neutral-400" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search help articles"
                className="w-full h-12 pl-10 pr-3 rounded-2xl bg-white text-neutral-900 text-sm border-0 shadow-sm placeholder:text-neutral-400"
              />
            </div>
            <button type="submit" className="h-12 px-5 rounded-2xl bg-white text-black hover:bg-neutral-200 text-sm font-semibold">
              Search
            </button>
          </form>
        </div>
      </section>

      <div className="grid lg:grid-cols-12 gap-6 lg:gap-8 items-start">
        <section className="lg:col-span-7 space-y-6">
          <div className="grid sm:grid-cols-2 gap-3">
            <button
              type="button"
              onClick={focusRaiseChat}
              className="group text-left rounded-2xl border border-neutral-200/80 bg-white p-5 shadow-sm hover:border-black hover:shadow-md transition-all"
            >
              <span className="h-10 w-10 rounded-xl bg-neutral-950 text-white grid place-items-center mb-3">
                <Ticket className="h-4 w-4" />
              </span>
              <p className="text-sm font-semibold">Raise a ticket</p>
              <p className="text-xs text-neutral-500 mt-1 leading-relaxed">
                File an issue with this organization. Sign-in required.
              </p>
              <span className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-black">
                Continue <ArrowRight className="h-3.5 w-3.5 group-hover:translate-x-0.5 transition-transform" />
              </span>
            </button>
            <button
              type="button"
              onClick={() => onNavigate(portalPath(config.slug, customer ? '/tickets' : '/login'))}
              className="group text-left rounded-2xl border border-neutral-200/80 bg-white p-5 shadow-sm hover:border-black hover:shadow-md transition-all"
            >
              <span className="h-10 w-10 rounded-xl bg-neutral-100 text-black grid place-items-center mb-3">
                <Clock className="h-4 w-4" />
              </span>
              <p className="text-sm font-semibold">Check status</p>
              <p className="text-xs text-neutral-500 mt-1 leading-relaxed">
                Review tickets already filed on your customer record.
              </p>
              <span className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-black">
                View tickets <ArrowRight className="h-3.5 w-3.5 group-hover:translate-x-0.5 transition-transform" />
              </span>
            </button>
          </div>

          <div className="space-y-4">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold tracking-tight">Help articles</h2>
                <p className="text-xs text-neutral-500 mt-0.5">
                  {articles.length === 0 ? 'No published articles yet.' : `${visible.length} shown`}
                </p>
              </div>
              {categories.length > 1 && (
                <div className="flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    onClick={() => setSelectedCategories([])}
                    className={`h-7 px-2.5 rounded-full text-[11px] font-semibold border ${
                      selectedCategories.length === 0
                        ? 'bg-neutral-950 text-white border-neutral-950'
                        : 'bg-white text-neutral-600 border-neutral-200'
                    }`}
                  >
                    All
                  </button>
                  {categories.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => toggleCategory(c)}
                      className={`h-7 px-2.5 rounded-full text-[11px] font-semibold border ${
                        selectedCategories.includes(c)
                          ? 'bg-neutral-950 text-white border-neutral-950'
                          : 'bg-white text-neutral-600 border-neutral-200'
                      }`}
                    >
                      {displayCategoryLabel(c)}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {articles.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-neutral-300 bg-white/70 px-6 py-12 text-center">
                <FileText className="h-7 w-7 mx-auto text-neutral-300 mb-2" />
                <p className="text-sm text-neutral-500">No published articles yet.</p>
              </div>
            ) : (
              <div className="grid sm:grid-cols-2 gap-3">
                {visible.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => setPreviewArticleId(a.id)}
                    className="group text-left rounded-2xl border border-neutral-200/80 bg-white p-4 shadow-sm hover:border-black hover:shadow-md transition-all"
                  >
                    <span
                      className={`inline-flex text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full border ${categoryTone(
                        a.category
                      )}`}
                    >
                      {displayCategoryLabel(a.category)}
                    </span>
                    <p className="text-sm font-semibold mt-2.5 leading-snug group-hover:text-black">{a.title}</p>
                    {a.excerpt && (
                      <p className="text-xs text-neutral-500 mt-1.5 line-clamp-2 leading-relaxed">{a.excerpt}</p>
                    )}
                    <span className="mt-3 inline-flex items-center gap-0.5 text-[11px] font-semibold text-neutral-400 group-hover:text-black">
                      Read article <ChevronRight className="h-3.5 w-3.5" />
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </section>

        <aside className="lg:col-span-5 lg:sticky lg:top-20">
          <div
            ref={chatBoxRef}
            className={`bg-white border rounded-3xl shadow-sm flex flex-col h-[560px] max-h-[calc(100svh-6rem)] min-h-[420px] overflow-hidden ${
              raising ? 'border-black ring-2 ring-neutral-300' : 'border-neutral-200/80'
            }`}
          >
            <div className="px-4 py-3.5 border-b border-neutral-100 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2.5 min-w-0">
                <span className="h-8 w-8 rounded-xl bg-neutral-100 text-black grid place-items-center shrink-0">
                  <Sparkles className="h-4 w-4" />
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-semibold leading-tight">Assistant</p>
                  <p className="text-[11px] text-neutral-500">
                    {raising ? 'Describe the issue to file a ticket' : 'Articles and guidance'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                title="Restart conversation (new session)"
                onClick={clearChatSession}
                disabled={busy}
                className="p-2 rounded-lg text-neutral-500 hover:text-neutral-900 hover:bg-neutral-100 transition-colors disabled:opacity-50 shrink-0"
              >
                <RotateCcw className="h-4 w-4" />
              </button>
            </div>
            <div
              ref={chatMessagesRef}
              onCopy={handleCoworkerCopy}
              className="flex-1 min-h-0 space-y-2.5 overflow-y-auto overflow-x-auto overscroll-contain px-4 py-4 text-sm select-text cursor-text"
            >
              {chat.length === 0 && !busy && (
                <div className="rounded-2xl bg-neutral-100 border border-neutral-200 px-3.5 py-3 text-xs text-neutral-600 leading-relaxed">
                  <MessageCircle className="h-4 w-4 text-black mb-1.5" />
                  Describe the issue. I can suggest articles. Raising or checking tickets needs a registered customer
                  sign-in.
                </div>
              )}
              {chat.map((m, i) => {
                const hasTable = m.role === 'assistant' && /<table\b/i.test(m.text);
                return (
                <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div
                    className={`w-fit rounded-2xl px-3.5 py-2 text-xs leading-relaxed ${
                      m.role === 'user'
                        ? 'max-w-[80%] whitespace-pre-wrap bg-neutral-950 text-white rounded-br-sm'
                        : hasTable
                          ? 'portal-assistant-bubble w-full max-w-full bg-neutral-100 border border-neutral-200 text-neutral-800 rounded-bl-sm px-4 py-3'
                          : 'max-w-[80%] bg-neutral-100 border border-neutral-200 text-neutral-800 rounded-bl-sm'
                    }`}
                  >
                    {m.role === 'user' && m.attachments?.length ? (
                      <div
                        className={
                          m.attachments.length === 1
                            ? 'mb-2'
                            : 'mb-2 grid grid-cols-2 gap-1.5'
                        }
                      >
                        {m.attachments.map((file) => {
                          const image =
                            file.url.toLowerCase().includes('.png') ||
                            file.url.toLowerCase().includes('.jpg') ||
                            file.url.toLowerCase().includes('.jpeg') ||
                            file.url.toLowerCase().includes('.gif') ||
                            file.url.toLowerCase().includes('.webp');
                          return (
                            <div
                              key={file.url}
                              className="overflow-hidden rounded-xl bg-white/10"
                            >
                              {image ? (
                                <img
                                  src={file.url}
                                  alt=""
                                  className="max-h-48 w-full object-cover"
                                />
                              ) : (
                                <div className="px-2.5 py-2 text-[11px] leading-snug text-white/90">
                                  {file.name}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    ) : null}
                    {m.role === 'assistant' ? renderAssistantMessage(m.text) : m.text}
                  </div>
                </div>
                );
              })}
              {busy && (
                <div className="flex justify-start" aria-live="polite" aria-label="Thinking">
                  <div className="inline-flex items-center gap-2 rounded-2xl rounded-bl-sm bg-neutral-100 border border-neutral-200 px-3.5 py-2.5">
                    <span className="flex items-center gap-1" aria-hidden>
                      <span className="h-1.5 w-1.5 rounded-full bg-neutral-400 animate-[coworkerThink_1.05s_ease-in-out_infinite]" />
                      <span className="h-1.5 w-1.5 rounded-full bg-neutral-400 animate-[coworkerThink_1.05s_ease-in-out_0.15s_infinite]" />
                      <span className="h-1.5 w-1.5 rounded-full bg-neutral-400 animate-[coworkerThink_1.05s_ease-in-out_0.3s_infinite]" />
                    </span>
                    <span className="text-xs font-medium text-neutral-500">Thinking…</span>
                  </div>
                </div>
              )}
            </div>
            <form
              onSubmit={sendChat}
              className="p-3 border-t border-neutral-100"
            >
              <input
                ref={ticketFileRef}
                id={ticketFileInputId}
                type="file"
                multiple
                className="sr-only"
                tabIndex={-1}
                disabled={busy || !customer}
                onChange={async (e) => {
                  const files = e.target.files;
                  if (!files?.length) return;
                  const form = new FormData();
                  Array.from(files).forEach((f) => form.append('files', f));
                  setAttachError('');
                  try {
                    const res = await fetch('/api/portal/uploads', {
                      method: 'POST',
                      credentials: 'include',
                      body: form,
                    });
                    if (!res.ok) {
                      const body = (await res.json().catch(() => ({}))) as { error?: string };
                      setAttachError(body.error || 'Could not attach that file.');
                      e.target.value = '';
                      return;
                    }
                    const data = (await res.json()) as { urls?: string[] };
                    const urls = (data.urls || []).filter(
                      (u) => typeof u === 'string' && u.startsWith('/uploads/')
                    );
                    if (!urls.length) {
                      setAttachError('Could not attach that file.');
                    } else {
                      setPendingAttachments((prev) => [...prev, ...urls]);
                    }
                  } catch {
                    setAttachError('Could not attach that file.');
                  }
                  e.target.value = '';
                }}
              />
              <div
                className={`grid grid-cols-[32px_minmax(0,1fr)_32px] items-end gap-1 border-[0.6px] border-[#bfbfbf] bg-neutral-50/80 px-[6px] py-[3px] focus-within:border-neutral-400 focus-within:bg-white ${
                  composerExpanded
                    ? 'min-h-[42px] max-h-[250px] overflow-hidden rounded-2xl'
                    : 'h-[42px] overflow-hidden rounded-full'
                }`}
              >
                <label
                  htmlFor={ticketFileInputId}
                  aria-label="Attach"
                  className={`col-start-1 row-start-1 mb-px inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-[#171717] text-white shadow-[0_2px_8px_rgba(0,0,0,0.18)] hover:bg-neutral-800 ${
                    busy || !customer
                      ? 'pointer-events-none opacity-50 shadow-none'
                      : 'cursor-pointer'
                  }`}
                >
                  <Plus className="size-4 stroke-[2.25] text-white" />
                </label>
                <textarea
                  ref={chatInputRef}
                  rows={1}
                  value={message}
                  onChange={(e) => {
                    setMessage(e.target.value);
                    setComposerExpanded(syncPortalComposerHeight(e.target) > 40);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      if (busyRef.current) return;
                      void sendPortalTurn(message, pendingAttachments);
                    }
                  }}
                  placeholder={raising ? 'Describe the issue to file…' : 'Ask about an issue…'}
                  className="col-start-2 row-start-1 min-h-5 max-h-[192px] w-full resize-none overflow-hidden border-0 bg-transparent py-1.5 pl-[3px] text-sm leading-5 text-neutral-900 placeholder:text-neutral-400 outline-none shadow-none focus:!border-transparent focus:!shadow-none"
                />
                <button
                  type="submit"
                  disabled={busy || (!message.trim() && !pendingAttachments.length)}
                  title="Send"
                  className="col-start-3 row-start-1 mb-px inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-[#171717] text-white shadow-[0_2px_8px_rgba(0,0,0,0.18)] hover:bg-neutral-800 disabled:opacity-50 disabled:shadow-none"
                >
                  <ArrowUp className="size-4 stroke-[2.25] text-white" />
                </button>
              </div>
            </form>
            {attachError ? (
              <p className="px-3 pb-2 text-xs text-rose-600">{attachError}</p>
            ) : null}
            {pendingAttachments.length > 0 ? (
              <ul className="flex flex-wrap gap-1.5 px-3 pb-2">
                {pendingAttachments.map((url) => {
                  const name = url.split('/').filter(Boolean).pop() || url;
                  return (
                    <li
                      key={url}
                      className="inline-flex max-w-full items-center gap-1 rounded-full border border-neutral-200 bg-white px-2 py-0.5 text-[11px] text-neutral-700"
                    >
                      <span className="truncate">{name}</span>
                      <button
                        type="button"
                        aria-label={`Remove ${name}`}
                        onClick={() =>
                          setPendingAttachments((prev) => prev.filter((item) => item !== url))
                        }
                        className="inline-flex size-4 shrink-0 items-center justify-center rounded-full text-neutral-400 hover:text-neutral-900"
                      >
                        <X className="size-3 stroke-[2.25]" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </div>
        </aside>
      </div>
      {previewArticleId ? (
        <ArticlePreviewModal
          slug={config.slug}
          articleId={previewArticleId}
          onClose={() => setPreviewArticleId(null)}
        />
      ) : null}
    </div>
  );
}

function ArticlePreviewModal({
  slug,
  articleId,
  onClose,
}: {
  slug: string;
  articleId: string;
  onClose: () => void;
}) {
  const [article, setArticle] = useState<Article | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch(
        `/api/public/support/${encodeURIComponent(slug)}/articles/${encodeURIComponent(articleId)}`
      );
      if (!res.ok || cancelled) return;
      const data = await res.json();
      if (!cancelled) setArticle(data);
    })();
    return () => {
      cancelled = true;
    };
  }, [slug, articleId]);

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/40 px-4 backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="portal-article-preview-title"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl max-h-[min(85svh,720px)] overflow-y-auto rounded-3xl border border-neutral-200 bg-white p-6 sm:p-8 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 mb-4">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-neutral-400">
            Help article
          </p>
          <button
            type="button"
            onClick={onClose}
            className="text-xs font-semibold text-neutral-500 hover:text-neutral-900"
          >
            Close
          </button>
        </div>
        {!article ? (
          <p className="text-sm text-neutral-500">Loading article…</p>
        ) : (
          <div className="space-y-3">
            <span
              className={`inline-flex text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full border ${categoryTone(
                article.category
              )}`}
            >
              {displayCategoryLabel(article.category)}
            </span>
            <h2
              id="portal-article-preview-title"
              className="text-xl font-semibold tracking-tight leading-snug"
            >
              {article.title}
            </h2>
            <div className="text-sm text-neutral-700 whitespace-pre-wrap leading-relaxed">
              {article.content}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ArticleDetail({
  slug,
  articleId,
  onNavigate,
}: {
  slug: string;
  articleId: string;
  onNavigate: (path: string) => void;
}) {
  const [article, setArticle] = useState<Article | null>(null);
  useEffect(() => {
    (async () => {
      const res = await fetch(
        `/api/public/support/${encodeURIComponent(slug)}/articles/${encodeURIComponent(articleId)}`
      );
      if (res.ok) setArticle(await res.json());
    })();
  }, [slug, articleId]);
  if (!article) return <p className="text-sm text-neutral-500">Loading article…</p>;
  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <button
        type="button"
        onClick={() => onNavigate(portalPath(slug))}
        className="text-xs font-semibold text-neutral-500 hover:text-neutral-900"
      >
        ← Back to help
      </button>
      <article className="bg-white border border-neutral-200/80 rounded-3xl p-7 sm:p-9 shadow-sm space-y-4">
        <span
          className={`inline-flex text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full border ${categoryTone(
            article.category
          )}`}
        >
          {displayCategoryLabel(article.category)}
        </span>
        <h1 className="text-2xl font-semibold tracking-tight leading-snug">{article.title}</h1>
        <div className="text-sm text-neutral-700 whitespace-pre-wrap leading-relaxed">{article.content}</div>
      </article>
    </div>
  );
}

function TicketList({
  slug,
  onNavigate,
}: {
  slug: string;
  onNavigate: (path: string) => void;
}) {
  const [tickets, setTickets] = useState<PortalTicket[]>([]);
  useEffect(() => {
    (async () => {
      const res = await fetch('/api/portal/tickets', { credentials: 'include' });
      if (res.ok) setTickets(await res.json());
    })();
  }, []);
  return (
    <div className="max-w-3xl mx-auto space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Your tickets</h1>
          <p className="text-xs text-neutral-500 mt-0.5">
            {tickets.length === 0 ? 'No tickets yet.' : `${tickets.length} on your record`}
          </p>
        </div>
        <button
          type="button"
          onClick={() => onNavigate(`${portalPath(slug)}?raise=1`)}
          className={primaryBtn}
        >
          <Ticket className="h-3.5 w-3.5" /> New ticket
        </button>
      </div>
      {tickets.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-neutral-300 bg-white px-6 py-12 text-center">
          <CheckCircle2 className="h-7 w-7 mx-auto text-neutral-300 mb-2" />
          <p className="text-sm text-neutral-500">No tickets yet.</p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {tickets.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => onNavigate(portalPath(slug, `/tickets/${encodeURIComponent(t.id)}`))}
              className="w-full text-left bg-white border border-neutral-200/80 rounded-2xl p-4 shadow-sm hover:border-black hover:shadow-md transition-all"
            >
              <div className="flex justify-between gap-3 items-start">
                <p className="text-sm font-semibold leading-snug">{t.subject}</p>
                <span className={`shrink-0 text-[11px] font-semibold px-2 py-0.5 rounded-full border ${statusTone(t.status)}`}>
                  {portalStatusLabel(t.status)}
                </span>
              </div>
              <p className="text-xs text-neutral-500 mt-1.5">
                {t.id}
                {t.createdAt ? ` · ${formatWhen(t.createdAt)}` : ''}
              </p>
              {isFinishedPortalStatus(t.status) && t.csatScore == null && (
                <p className="mt-2 text-[11px] font-semibold text-amber-800">
                  Please leave a CSAT review
                </p>
              )}
              {t.csatScore != null && (
                <div className="mt-2 flex items-center gap-2">
                  <CsatStars value={t.csatScore} size="sm" />
                  <span className="text-[11px] font-semibold text-neutral-600">
                    {csatLabelForScore(t.csatScore)}
                  </span>
                </div>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function TicketDetail({
  slug,
  ticketNumber,
  onNavigate,
}: {
  slug: string;
  ticketNumber: string;
  onNavigate: (path: string) => void;
}) {
  const [data, setData] = useState<{
    ticket: PortalTicket;
    rateCsatEligible?: boolean;
    notes?: Array<{ id: string; author: string; text: string; time: string }>;
    progress?: {
      currentStatus: string;
      steps: Array<{
        key: string;
        label: string;
        state: 'done' | 'current' | 'upcoming';
      }>;
      history: Array<{
        id: string;
        at: string;
        label: string;
        actor: string | null;
        kind: 'created' | 'status' | 'assigned' | 'escalated' | 'reply';
      }>;
    };
  } | null>(null);
  const [copiedTicketId, setCopiedTicketId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [csatBusy, setCsatBusy] = useState(false);
  const [csatError, setCsatError] = useState('');
  const [csatScorePick, setCsatScorePick] = useState<number | null>(null);
  const [csatComment, setCsatComment] = useState('');
  const [csatModalOpen, setCsatModalOpen] = useState(false);
  const [statusBusy, setStatusBusy] = useState(false);
  const [statusError, setStatusError] = useState('');
  let normalizedTicketNumber = ticketNumber;
  try {
    normalizedTicketNumber = decodeURIComponent(ticketNumber);
  } catch {
    // Keep the original value if a malformed URL segment is supplied.
  }
  const load = async (opts?: { silent?: boolean }) => {
    try {
      const res = await fetch(`/api/portal/tickets/${encodeURIComponent(normalizedTicketNumber)}`, {
        credentials: 'include',
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error || 'Unable to load this ticket.');
        return;
      }
      const body = await res.json();
      setData(body);
      setError('');
      if (!opts?.silent) {
        const needsCsat =
          Boolean(body.rateCsatEligible) && body.ticket?.csatScore == null;
        setCsatModalOpen(needsCsat);
        if (!needsCsat) {
          setCsatScorePick(null);
          setCsatComment('');
          setCsatError('');
        }
      }
    } catch {
      setError('Unable to load this ticket. Please try again.');
    }
  };
  useEffect(() => {
    void load();
    const id = window.setInterval(() => {
      void load({ silent: true });
    }, 4000);
    return () => window.clearInterval(id);
  }, [normalizedTicketNumber]);

  const updateTicketStatus = async (nextStatus: 'Closed' | 'Reopened') => {
    setStatusBusy(true);
    setStatusError('');
    try {
      const res = await fetch(
        `/api/portal/tickets/${encodeURIComponent(normalizedTicketNumber)}/status`,
        {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: nextStatus }),
        }
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setStatusError(body.error || 'Could not update this ticket.');
        return;
      }
      if (body.ticket) {
        setData((prev) =>
          prev
            ? {
                ...prev,
                ticket: { ...prev.ticket, ...body.ticket },
              }
            : prev
        );
      }
      await load();
    } catch {
      setStatusError('Could not update this ticket. Please try again.');
    } finally {
      setStatusBusy(false);
    }
  };

  const submitCsat = async () => {
    if (csatBusy) return;
    if (csatScorePick == null) {
      setCsatError('Please choose how satisfied you were.');
      return;
    }
    if (csatComment.trim().length < 3) {
      setCsatError('Please add a short comment about your experience.');
      return;
    }
    setCsatBusy(true);
    setCsatError('');
    try {
      const res = await fetch(
        `/api/portal/tickets/${encodeURIComponent(normalizedTicketNumber)}/csat`,
        {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ score: csatScorePick, comment: csatComment.trim() }),
        }
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setCsatError(body.error || 'Could not save your rating.');
        return;
      }
      setCsatModalOpen(false);
      await load();
    } catch {
      setCsatError('Could not save your rating. Please try again.');
    } finally {
      setCsatBusy(false);
    }
  };

  if (!data && error) {
    return (
      <div className="max-w-4xl mx-auto space-y-4">
        <button type="button" className={ghostBtn} onClick={() => onNavigate(portalPath(slug, '/tickets'))}>
          <ArrowLeft className="h-4 w-4" /> Back to tickets
        </button>
        <div className="rounded-3xl border border-neutral-200 bg-white p-6 shadow-sm">
          <p className="text-sm font-semibold">Ticket could not be loaded</p>
          <p className="mt-1 text-xs text-neutral-500">{error}</p>
          <button type="button" className={`${ghostBtn} mt-4`} onClick={() => void load()}>
            Try again
          </button>
        </div>
      </div>
    );
  }
  if (!data) return <p className="text-sm text-neutral-500">Loading ticket…</p>;
  const status = data.ticket.status || 'Open';
  const fallbackStepIndex =
    status === 'Closed' ? 3 : status === 'Resolved' ? 2 : status === 'Open' ? 0 : 1;
  const rawProgress = data.progress || {
    currentStatus: status,
    steps: ['Submitted', 'In progress', 'Resolved', 'Closed'].map((label, index) => ({
      key: label,
      label,
      state: (
        status === 'Closed' ||
        (status === 'Resolved' && index <= 2) ||
        index < fallbackStepIndex
          ? 'done'
          : index === fallbackStepIndex && status !== 'Resolved'
            ? 'current'
            : 'upcoming'
      ) as 'done' | 'current' | 'upcoming',
    })),
    history: data.ticket.createdAt
      ? [{
          id: `created-${data.ticket.id}`,
          at: data.ticket.createdAt,
          label: 'Ticket submitted',
          actor: null,
          kind: 'created' as const,
        }]
      : [],
  };
  const progress = {
    ...rawProgress,
    steps: rawProgress.steps.map((step) => {
      if (!isResolvedPortalStatus(status) || isClosedPortalStatus(status)) return step;
      const key = String(step.key || '').toLowerCase();
      const label = String(step.label || '').toLowerCase();
      if (key === 'resolved' || label === 'resolved') {
        return { ...step, state: 'done' as const };
      }
      return step;
    }),
  };
  return (
    <div className="max-w-4xl mx-auto space-y-4">
      <button
        type="button"
        className="inline-flex items-center gap-2 text-sm font-semibold text-neutral-600 hover:text-black transition-colors"
        onClick={() => onNavigate(portalPath(slug, '/tickets'))}
      >
        <ArrowLeft className="h-4 w-4" />
        Back to tickets
      </button>

      <section className="overflow-hidden rounded-3xl border border-neutral-200 bg-white shadow-sm">
        <div className="border-b border-neutral-100 p-6 sm:p-8">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0 max-w-2xl">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  title="Copy ticket ID"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(data.ticket.id);
                      setCopiedTicketId(data.ticket.id);
                      window.setTimeout(() => setCopiedTicketId(null), 1500);
                    } catch {
                      /* ignore */
                    }
                  }}
                  className="inline-flex h-[38px] items-center gap-2 text-lg font-semibold text-neutral-900"
                >
                  Ticket {data.ticket.id}
                  {copiedTicketId === data.ticket.id ? (
                    <Check className="h-[18px] w-[18px] stroke-[2.25] text-emerald-600" />
                  ) : (
                    <Copy className="h-[18px] w-[18px] stroke-[2.25] text-neutral-400" />
                  )}
                </button>
                <span className="h-1 w-1 rounded-full bg-neutral-300" />
                <p className="text-xs text-neutral-500">Created {formatWhen(data.ticket.createdAt)}</p>
              </div>
              <h1 className="mt-2 text-2xl font-semibold tracking-tight text-neutral-950 sm:text-3xl">
                {data.ticket.subject}
              </h1>
              <p className="mt-3 max-w-2xl text-sm leading-relaxed text-neutral-600 whitespace-pre-wrap">
                {data.ticket.description}
              </p>
              {(data.ticket.attachments || []).length > 0 ? (
                <ul className="mt-4 space-y-2">
                  {(data.ticket.attachments || []).map((url) => (
                    <li
                      key={url}
                      className="overflow-hidden rounded-xl border border-neutral-200 bg-neutral-50"
                    >
                      {ticketFileIsImage(url) ? (
                        <a href={url} target="_blank" rel="noreferrer">
                          <img
                            src={url}
                            alt=""
                            className="max-h-56 w-full object-contain bg-white"
                          />
                        </a>
                      ) : (
                        <a
                          href={url}
                          target="_blank"
                          rel="noreferrer"
                          className="flex items-center gap-2 px-3 py-2.5 text-sm text-neutral-800"
                        >
                          <Paperclip className="h-[18px] w-[18px] stroke-[2.25] text-neutral-500" />
                          <span className="truncate">{url.split('/').pop()}</span>
                        </a>
                      )}
                    </li>
                  ))}
                </ul>
              ) : null}
              {isFinishedPortalStatus(data.ticket.status) || statusError ? (
                <div className="mt-5 flex flex-wrap items-center gap-2">
                  {isResolvedPortalStatus(data.ticket.status) ? (
                    <button
                      type="button"
                      className="inline-flex h-[38px] min-w-[160px] items-center justify-center gap-2 rounded-lg border-[0.6px] border-[#111111] bg-[#111111] px-4 text-sm font-semibold text-white shadow-none hover:bg-black disabled:opacity-60"
                      disabled={statusBusy}
                      onClick={() => void updateTicketStatus('Closed')}
                    >
                      <CheckCircle2 className="h-[18px] w-[18px] stroke-[2.25]" />
                      Close ticket
                    </button>
                  ) : null}
                  {isClosedPortalStatus(data.ticket.status) ? (
                    <button
                      type="button"
                      className="inline-flex h-[38px] min-w-[160px] items-center justify-center gap-2 rounded-lg border-[0.6px] border-[#bfbfbf] bg-white px-4 text-sm font-semibold text-neutral-800 shadow-none hover:bg-neutral-50 disabled:opacity-60"
                      disabled={statusBusy}
                      onClick={() => void updateTicketStatus('Reopened')}
                    >
                      <RotateCcw className="h-[18px] w-[18px] stroke-[2.25]" />
                      Reopen ticket
                    </button>
                  ) : null}
                  {statusError ? (
                    <p className="w-full text-xs text-red-600">{statusError}</p>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>
        </div>

        <div className="p-6 sm:p-8">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-neutral-950">Ticket progress</h2>
              <p className="mt-1 text-xs text-neutral-500">Follow every update from submission to resolution.</p>
            </div>
            <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${statusTone(progress.currentStatus)}`}>
              {portalStatusLabel(progress.currentStatus)}
            </span>
          </div>

          <ol className="mt-7 flex w-full min-w-0 list-none flex-nowrap items-start gap-0 overflow-hidden rounded-2xl bg-[#f3f4f6] px-2 py-5 sm:px-5">
            {progress.steps.map((step, index) => {
              const next = progress.steps[index + 1];
              const lineAfter =
                Boolean(next) && (next.state === 'done' || next.state === 'current');
              const done = step.state === 'done';
              const current = step.state === 'current';
              return (
                <li
                  key={step.key}
                  className="flex min-w-0 flex-1 basis-0 flex-col items-center"
                >
                  <div className="mb-2 flex w-full items-center">
                    {index > 0 ? (
                      <span
                        className={`h-0.5 min-w-0 flex-1 rounded-full ${
                          done || current ? 'bg-[#111111]' : 'bg-[#bfbfbf]'
                        }`}
                        aria-hidden
                      />
                    ) : (
                      <span className="min-w-0 flex-1" aria-hidden />
                    )}
                    <span
                      className={`mx-1 grid h-8 w-8 shrink-0 place-items-center rounded-full border-2 ${
                        done || current
                          ? 'border-[#111111] bg-[#111111] text-white'
                          : 'border-[#bfbfbf] bg-white text-neutral-400'
                      }`}
                    >
                      {done || current ? (
                        <Check className="h-3.5 w-3.5 stroke-[2.5]" />
                      ) : (
                        <span className="h-2 w-2 rounded-full bg-[#bfbfbf]" />
                      )}
                    </span>
                    {index < progress.steps.length - 1 ? (
                      <span
                        className={`h-0.5 min-w-0 flex-1 rounded-full ${
                          lineAfter ? 'bg-[#111111]' : 'bg-[#bfbfbf]'
                        }`}
                        aria-hidden
                      />
                    ) : (
                      <span className="min-w-0 flex-1" aria-hidden />
                    )}
                  </div>
                  <span
                    className={`w-full truncate whitespace-nowrap px-0.5 text-center text-[11px] font-semibold sm:text-xs ${
                      step.state === 'upcoming' ? 'text-neutral-400' : 'text-[#171717]'
                    }`}
                  >
                    {step.label}
                  </span>
                </li>
              );
            })}
          </ol>

          <div className="mt-8 border-t border-neutral-200 pt-6">
            <div className="mb-5 flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold text-neutral-950">Activity timeline</h3>
              <span className="text-xs text-neutral-400">{progress.history.length} updates</span>
            </div>
            <div className="max-h-[30rem] overflow-y-auto pr-2">
              {progress.history.map((event, index) => (
                <div key={event.id} className="relative flex gap-4 pb-5 last:pb-0">
                  {index < progress.history.length - 1 && (
                    <span className="absolute bottom-0 left-4 top-9 w-px bg-neutral-200" aria-hidden />
                  )}
                  <span className="relative z-10 grid h-8 w-8 shrink-0 place-items-center rounded-full border border-neutral-200 bg-white text-neutral-700 shadow-sm">
                    {event.kind === 'reply' ? (
                      <MessageCircle className="h-3.5 w-3.5" />
                    ) : event.kind === 'assigned' || event.kind === 'escalated' ? (
                      <ArrowRight className="h-3.5 w-3.5" />
                    ) : (
                      <CheckCircle2 className="h-3.5 w-3.5" />
                    )}
                  </span>
                  <div className="min-w-0 flex-1 rounded-2xl border border-neutral-100 bg-neutral-50 px-4 py-3">
                    <p className="text-sm font-semibold text-neutral-900">{event.label}</p>
                    <p className="mt-1 text-xs text-neutral-500">
                      {formatDateTime(event.at)}
                      {event.actor ? ` · ${event.actor}` : ''}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {((data.rateCsatEligible ?? isFinishedPortalStatus(data.ticket.status)) ||
        data.ticket.csatScore != null) && (
        <section className="rounded-3xl border border-neutral-200 bg-white p-6 shadow-sm sm:p-8">
          <div className="flex items-start gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-neutral-100 text-neutral-900">
              <Star className="h-4 w-4" strokeWidth={2.25} />
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="text-base font-semibold text-neutral-950">How did we do?</h2>
              <p className="mt-1 text-xs text-neutral-500">
                Rate your support experience for this resolved ticket.
              </p>
              {data.ticket.csatScore != null ? (
                <div className="mt-4 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <CsatStars value={data.ticket.csatScore} />
                    <p className="text-sm font-semibold text-neutral-900">
                      {csatLabelForScore(data.ticket.csatScore)}
                      <span className="ml-2 font-normal text-neutral-500">
                        Thanks for your feedback.
                      </span>
                    </p>
                  </div>
                  {data.ticket.csatComment ? (
                    <p className="text-sm text-neutral-700 leading-relaxed rounded-2xl border border-neutral-100 bg-neutral-50 px-3.5 py-3">
                      {data.ticket.csatComment}
                    </p>
                  ) : null}
                </div>
              ) : (
                <div className="mt-4">
                  <button
                    type="button"
                    className={primaryBtn}
                    onClick={() => {
                      setCsatError('');
                      setCsatModalOpen(true);
                    }}
                  >
                    Leave a CSAT review
                  </button>
                </div>
              )}
            </div>
          </div>
        </section>
      )}

      {csatModalOpen && data.ticket.csatScore == null && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/45"
          role="dialog"
          aria-modal="true"
          aria-labelledby="portal-csat-title"
        >
          <div className="w-full max-w-md rounded-3xl bg-white shadow-2xl border border-neutral-200 p-6 sm:p-7 space-y-5">
            <div className="flex items-start gap-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-neutral-100 text-neutral-900">
                <Star className="h-4 w-4" strokeWidth={2.25} />
              </span>
              <div className="min-w-0">
                <h2 id="portal-csat-title" className="text-base font-semibold text-neutral-950">
                  How was your support?
                </h2>
                <p className="mt-1 text-xs text-neutral-500 leading-relaxed">
                  Ticket {data.ticket.id} is resolved. Tap the stars that match how you felt, then add a short comment.
                </p>
              </div>
            </div>

            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-400 mb-2">
                Satisfaction
              </p>
              <div className="space-y-1.5" role="radiogroup" aria-label="Satisfaction">
                {[...CSAT_LEVELS].reverse().map((row) => {
                  const selected = csatScorePick === row.score;
                  return (
                    <button
                      key={row.score}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      disabled={csatBusy}
                      onClick={() => {
                        setCsatError('');
                        setCsatScorePick(row.score);
                      }}
                      className={`flex min-h-[38px] w-full items-center gap-3 rounded-xl border px-3 py-1.5 text-left transition-colors disabled:opacity-50 ${
                        selected
                          ? 'border-[#111111] bg-[#111111] text-white'
                          : 'border-[#bfbfbf] bg-white text-[#171717] hover:bg-[#f3f4f6]'
                      }`}
                    >
                      <CsatStars
                        value={row.score}
                        size="sm"
                        variant={selected ? 'onDark' : 'default'}
                      />
                      <span className="min-w-0 truncate text-sm font-semibold">
                        {row.label}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <label
                htmlFor="portal-csat-comment"
                className="text-[11px] font-semibold uppercase tracking-wide text-neutral-400"
              >
                Comment
              </label>
              <textarea
                id="portal-csat-comment"
                rows={4}
                value={csatComment}
                disabled={csatBusy}
                onChange={(e) => setCsatComment(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing) return;
                  e.preventDefault();
                  if (csatBusy) return;
                  void submitCsat();
                }}
                placeholder="Tell us what went well or what we could improve…"
                className="mt-2 w-full rounded-2xl border border-neutral-200 bg-white px-3.5 py-3 text-sm text-neutral-900 placeholder:text-neutral-400 resize-y min-h-[96px]"
              />
            </div>

            {csatError && (
              <p className="text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
                {csatError}
              </p>
            )}

            <div className="flex flex-col-reverse sm:flex-row gap-2 sm:justify-end">
              <button
                type="button"
                className={ghostBtn}
                disabled={csatBusy}
                onClick={() => setCsatModalOpen(false)}
              >
                Later
              </button>
              <button
                type="button"
                className={primaryBtn}
                disabled={csatBusy}
                onClick={() => void submitCsat()}
              >
                {csatBusy ? 'Saving…' : 'Submit review'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ProfilePanel({
  slug,
  onNavigate,
}: {
  slug: string;
  onNavigate: (path: string) => void;
}) {
  const [data, setData] = useState<{
    customer: PortalCustomer;
    businessType: string;
    tickets: PortalTicket[];
  } | null>(null);
  useEffect(() => {
    (async () => {
      const res = await fetch('/api/portal/profile', { credentials: 'include' });
      if (res.ok) setData(await res.json());
    })();
  }, []);
  if (!data) return <p className="text-sm text-neutral-500">Loading profile…</p>;
  const c = data.customer;
  const initials =
    c.name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0])
      .join('')
      .toUpperCase() || '?';
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-neutral-400">Account</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-neutral-950">Your profile</h1>
        <p className="mt-1 text-sm text-neutral-500">Your contact details and support history in one place.</p>
      </div>

      <section className="overflow-hidden rounded-3xl border border-neutral-200 bg-white shadow-sm">
        <div className="bg-neutral-950 px-6 py-7 text-white sm:px-8">
          <div className="flex flex-wrap items-center gap-5">
            <div className="grid h-16 w-16 shrink-0 place-items-center rounded-2xl border border-white/15 bg-white/10 text-lg font-semibold">
              {initials}
            </div>
            <div className="min-w-0">
              <p className="text-xs font-medium text-white/55">Customer profile</p>
              <h2 className="mt-1 truncate text-2xl font-semibold tracking-tight">{c.name}</h2>
              {c.accountName && <p className="mt-1 text-sm text-white/60">{c.accountName}</p>}
            </div>
          </div>
        </div>

        <div className="grid gap-3 p-6 sm:grid-cols-2 sm:p-8">
          <div className="flex min-w-0 items-center gap-3 rounded-2xl border border-neutral-200 bg-neutral-50 p-4">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white text-neutral-600 shadow-sm">
              <Mail className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-400">Email</p>
              <p className="mt-0.5 truncate text-sm font-medium text-neutral-900">{c.email || '—'}</p>
            </div>
          </div>
          <div className="flex min-w-0 items-center gap-3 rounded-2xl border border-neutral-200 bg-neutral-50 p-4">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white text-neutral-600 shadow-sm">
              <Phone className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-400">Phone</p>
              <p className="mt-0.5 truncate text-sm font-medium text-neutral-900">{c.phone || '—'}</p>
            </div>
          </div>
          {data.businessType === 'b2b' && c.accountName && (
            <div className="flex min-w-0 items-center gap-3 rounded-2xl border border-neutral-200 bg-neutral-50 p-4">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white text-neutral-600 shadow-sm">
                <Building2 className="h-4 w-4" />
              </span>
              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-400">Company</p>
                <p className="mt-0.5 truncate text-sm font-medium text-neutral-900">{c.accountName}</p>
              </div>
            </div>
          )}
          {(c.products || []).length > 0 && (
            <div className="flex min-w-0 items-center gap-3 rounded-2xl border border-neutral-200 bg-neutral-50 p-4">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white text-neutral-600 shadow-sm">
                <Package className="h-4 w-4" />
              </span>
              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-400">Products</p>
                <p className="mt-0.5 truncate text-sm font-medium text-neutral-900">
                  {(c.products || []).map((product) => product.name).join(', ')}
                </p>
              </div>
            </div>
          )}
        </div>
      </section>

      <section className="rounded-3xl border border-neutral-200 bg-white p-6 shadow-sm sm:p-8">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-neutral-950">Ticket history</h2>
            <p className="mt-1 text-xs text-neutral-500">Open a ticket to see its complete progress and conversation.</p>
          </div>
          <span className="rounded-full bg-neutral-100 px-3 py-1 text-xs font-semibold text-neutral-600">
            {data.tickets.length}
          </span>
        </div>

        <div className="mt-5 space-y-3">
          {data.tickets.map((ticket) => (
            <button
              key={ticket.id}
              type="button"
              onClick={() => onNavigate(portalPath(slug, `/tickets/${encodeURIComponent(ticket.id)}`))}
              className="group flex w-full items-center gap-4 rounded-2xl border border-neutral-200 bg-white p-4 text-left transition hover:border-black hover:shadow-sm"
            >
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-neutral-100 text-neutral-700 transition group-hover:bg-black group-hover:text-white">
                <Ticket className="h-4 w-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-xs font-semibold text-neutral-400">{ticket.id}</span>
                <span className="mt-0.5 block truncate text-sm font-semibold text-neutral-900">{ticket.subject}</span>
                <span className="mt-1 block text-[11px] text-neutral-400">
                  Created {formatWhen(ticket.createdAt)}
                </span>
              </span>
              <span className={`shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${statusTone(ticket.status)}`}>
                {portalStatusLabel(ticket.status)}
              </span>
              <ChevronRight className="h-4 w-4 shrink-0 text-neutral-300 transition group-hover:translate-x-0.5 group-hover:text-black" />
            </button>
          ))}
          {data.tickets.length === 0 && (
            <div className="rounded-2xl border border-dashed border-neutral-200 px-6 py-12 text-center">
              <Ticket className="mx-auto h-6 w-6 text-neutral-300" />
              <p className="mt-2 text-sm text-neutral-500">No tickets yet.</p>
            </div>
          )}
        </div>

        <div className="mt-5 flex justify-end">
          <button
            type="button"
            className={primaryBtn}
            onClick={() => onNavigate(`${portalPath(slug)}?raise=1`)}
          >
            <Ticket className="h-4 w-4" /> New ticket
          </button>
        </div>
      </section>
    </div>
  );
}
