import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  BookOpen,
  Building2,
  Check,
  Copy,
  ExternalLink,
  Globe,
  KeyRound,
  MessageSquare,
  X,
} from 'lucide-react';
import { useSetPageTitle } from './layout/PageTitleContext';
import PageShell from './layout/PageShell';

type OrgPrefs = {
  ticketPrefix: string;
  portalLabel: string;
  displayTimezone: string;
  organizationName: string;
  slug: string;
  helpCenterPath: string;
  supportPortalPath: string;
  portalAuthMode: 'password' | 'otp';
  businessType: 'b2b' | 'b2c';
};

type WidgetRow = {
  id: string;
  name: string;
  publicId: string;
  allowedOrigins: string[];
  enabled: boolean;
  buttonLabel: string;
};

type ApiKeyRow = {
  id: string;
  name: string;
  keyPrefix: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
};

interface OrgPreferencesViewProps {
  embedded?: boolean;
  listRefreshToken?: number;
}

function formatWhen(iso: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export default function OrgPreferencesView({
  embedded = false,
  listRefreshToken = 0,
}: OrgPreferencesViewProps) {
  useSetPageTitle('Org preferences');
  const [prefs, setPrefs] = useState<OrgPrefs>({
    ticketPrefix: '#',
    portalLabel: '',
    displayTimezone: 'UTC',
    organizationName: '',
    slug: '',
    helpCenterPath: '',
    supportPortalPath: '',
    portalAuthMode: 'otp',
    businessType: 'b2c',
  });
  const [copiedHelpUrl, setCopiedHelpUrl] = useState(false);
  const [widgets, setWidgets] = useState<WidgetRow[]>([]);
  const [apiKeys, setApiKeys] = useState<ApiKeyRow[]>([]);
  const [embedHint, setEmbedHint] = useState<string | null>(null);
  const [widgetName, setWidgetName] = useState('Website Help');
  const [widgetOrigins, setWidgetOrigins] = useState('');
  const [apiKeyName, setApiKeyName] = useState('Website + email integrations');
  const [newSecret, setNewSecret] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [creatingWidget, setCreatingWidget] = useState(false);
  const [creatingKey, setCreatingKey] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadWidgets = async () => {
    const res = await fetch('/api/integration/widgets', { credentials: 'include' });
    if (!res.ok) return;
    const body = await res.json();
    setWidgets(body.widgets || []);
  };

  const loadApiKeys = async () => {
    const res = await fetch('/api/integration/keys', { credentials: 'include' });
    if (!res.ok) return;
    const body = await res.json();
    setApiKeys(body.keys || []);
  };

  const loadAll = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/org-preferences', { credentials: 'include' });
      if (!res.ok) throw new Error('Failed');
      setPrefs(await res.json());
      await Promise.all([loadWidgets(), loadApiKeys()]);
    } catch {
      setError('Could not load org preferences.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadAll();
  }, []);

  useEffect(() => {
    if (!listRefreshToken) return;
    void loadAll();
  }, [listRefreshToken]);

  const save = async () => {
    setSaving(true);
    setMessage(null);
    setError(null);
    try {
      const res = await fetch('/api/org-preferences', {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(prefs),
      });
      if (!res.ok) throw new Error('Failed');
      setPrefs(await res.json());
      setMessage('Saved.');
    } catch {
      setError('Could not save preferences.');
    } finally {
      setSaving(false);
    }
  };

  const createApiKey = async () => {
    setCreatingKey(true);
    setError(null);
    setCopied(false);
    try {
      const res = await fetch('/api/integration/keys', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: apiKeyName || 'Integration key',
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'Failed');
      setNewSecret(String(body.secret || ''));
      setMessage('API key created — copy the secret now.');
      await loadApiKeys();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create API key.');
    } finally {
      setCreatingKey(false);
    }
  };

  const copySecret = async () => {
    if (!newSecret) return;
    try {
      await navigator.clipboard.writeText(newSecret);
      setCopied(true);
    } catch {
      setError('Could not copy — select the key and copy manually.');
    }
  };

  const closeSecretModal = () => {
    setNewSecret(null);
    setCopied(false);
  };

  const revokeApiKey = async (id: string) => {
    if (!window.confirm('Revoke this API key? Integrations using it will stop working.')) {
      return;
    }
    setRevokingId(id);
    setError(null);
    try {
      const res = await fetch(`/api/integration/keys/${id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'Failed');
      setMessage('API key revoked.');
      await loadApiKeys();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not revoke API key.');
    } finally {
      setRevokingId(null);
    }
  };

  const createWidget = async () => {
    setCreatingWidget(true);
    setError(null);
    setEmbedHint(null);
    try {
      const origins = widgetOrigins
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      const res = await fetch('/api/integration/widgets', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: widgetName || 'Help widget',
          allowedOrigins: origins,
          buttonLabel: 'Help',
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'Failed');
      setEmbedHint(body.embedSnippet || null);
      setMessage('Help widget created.');
      await loadWidgets();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create widget.');
    } finally {
      setCreatingWidget(false);
    }
  };

  const toggleWidget = async (w: WidgetRow) => {
    try {
      const res = await fetch(`/api/integration/widgets/${w.id}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !w.enabled }),
      });
      if (!res.ok) throw new Error('Failed');
      await loadWidgets();
    } catch {
      setError('Could not update widget.');
    }
  };

  const activeKeys = apiKeys.filter((k) => !k.revokedAt);
  const helpCenterUrl =
    typeof window !== 'undefined' && prefs.helpCenterPath
      ? `${window.location.origin}${prefs.helpCenterPath}`
      : prefs.helpCenterPath;
  const fieldClass =
    'w-full h-10 rounded-xl border border-neutral-200 bg-white px-3 text-sm text-neutral-900 placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-neutral-900/10 focus:border-neutral-400';

  const content = (
    <div className="space-y-5 max-w-5xl mx-auto w-full px-5 sm:px-8 py-5 pb-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm text-neutral-500">
            Branding and access defaults for this company. SLA hours live under Priorities.
          </p>
          {prefs.organizationName ? (
            <p className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-neutral-100 px-2.5 py-1 text-xs font-medium text-neutral-700">
              <Building2 className="h-3.5 w-3.5" />
              {prefs.organizationName}
            </p>
          ) : null}
        </div>
      </div>
      {error && (
        <div className="flex items-center gap-2 text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}
      {message && (
        <p className="text-sm text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2">
          {message}
        </p>
      )}
      {loading ? (
        <p className="text-sm text-neutral-400">Loading…</p>
      ) : (
        <>
          <section className="rounded-2xl border border-neutral-200 bg-white shadow-sm overflow-hidden">
            <div className="flex items-center justify-between gap-3 border-b border-neutral-100 px-5 py-4">
              <div className="flex items-start gap-3 min-w-0">
                <span className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-neutral-900 text-white">
                  <Globe className="h-4 w-4" />
                </span>
                <div>
                  <h3 className="text-sm font-semibold text-neutral-900">Identity & portal</h3>
                  <p className="text-xs text-neutral-500 mt-0.5">
                    Ticket numbers, portal wording, timezone, and who can sign in.
                  </p>
                </div>
              </div>
              <button
                type="button"
                disabled={saving}
                onClick={() => void save()}
                className="h-9 px-4 rounded-xl bg-neutral-900 text-white text-xs font-semibold disabled:opacity-40 shrink-0"
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
            <div className="p-5 grid grid-cols-1 sm:grid-cols-2 gap-4">
              <label className="block space-y-1.5">
                <span className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wide">
                  Ticket prefix
                </span>
                <input
                  value={prefs.ticketPrefix}
                  onChange={(e) =>
                    setPrefs((p) => ({ ...p, ticketPrefix: e.target.value }))
                  }
                  className={fieldClass}
                />
                <span className="text-[11px] text-neutral-400">Shown on ticket IDs, e.g. #1042.</span>
              </label>
              <label className="block space-y-1.5">
                <span className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wide">
                  Portal label
                </span>
                <input
                  value={prefs.portalLabel}
                  onChange={(e) =>
                    setPrefs((p) => ({ ...p, portalLabel: e.target.value }))
                  }
                  placeholder="e.g. Support desk"
                  className={fieldClass}
                />
                <span className="text-[11px] text-neutral-400">Name customers see on the support portal.</span>
              </label>
              <label className="block space-y-1.5">
                <span className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wide">
                  Display timezone
                </span>
                <input
                  value={prefs.displayTimezone}
                  onChange={(e) =>
                    setPrefs((p) => ({ ...p, displayTimezone: e.target.value }))
                  }
                  placeholder="UTC"
                  className={fieldClass}
                />
                <span className="text-[11px] text-neutral-400">IANA zone used for timestamps in the UI.</span>
              </label>
              <label className="block space-y-1.5">
                <span className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wide">
                  Business type
                </span>
                <select
                  value={prefs.businessType}
                  onChange={(e) =>
                    setPrefs((p) => ({
                      ...p,
                      businessType: e.target.value === 'b2b' ? 'b2b' : 'b2c',
                    }))
                  }
                  className={fieldClass}
                >
                  <option value="b2c">B2C — people as customers</option>
                  <option value="b2b">B2B — people belong to accounts</option>
                </select>
              </label>
              <label className="block space-y-1.5 sm:col-span-2">
                <span className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wide">
                  Support portal sign-in
                </span>
                <select
                  value={prefs.portalAuthMode}
                  onChange={(e) =>
                    setPrefs((p) => ({
                      ...p,
                      portalAuthMode: e.target.value === 'password' ? 'password' : 'otp',
                    }))
                  }
                  className={fieldClass}
                >
                  <option value="otp">Open to everyone — OTP for registered customers</option>
                  <option value="password">Password — customers sign in with email and password</option>
                </select>
              </label>
              {prefs.supportPortalPath && (
                <div className="space-y-1.5 sm:col-span-2">
                  <span className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wide">
                    Support portal
                  </span>
                  <div className="flex flex-wrap items-center gap-2">
                    <code className="flex-1 min-w-0 text-xs bg-neutral-50 border border-neutral-200 rounded-xl px-3 py-2.5 truncate font-mono text-neutral-700">
                      {typeof window !== 'undefined'
                        ? `${window.location.origin}${prefs.supportPortalPath}`
                        : prefs.supportPortalPath}
                    </code>
                    <a
                      href={prefs.supportPortalPath}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-neutral-200 px-3 text-xs font-semibold text-neutral-800 hover:bg-neutral-50"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                      Open
                    </a>
                  </div>
                </div>
              )}
            </div>
          </section>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <section className="rounded-2xl border border-neutral-200 bg-white shadow-sm overflow-hidden">
            <div className="flex items-start gap-3 border-b border-neutral-100 px-5 py-4">
              <span className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-neutral-100 text-neutral-800">
                <BookOpen className="h-4 w-4" />
              </span>
              <div>
                <h3 className="text-sm font-semibold text-neutral-900">Public help center</h3>
                <p className="text-xs text-neutral-500 mt-0.5">
                  Customers search published Knowledge Base articles without signing in.
                </p>
              </div>
            </div>
            <div className="p-5 space-y-3">
            {prefs.helpCenterPath ? (
              <>
                <div className="space-y-1.5">
                  <span className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wide">
                    Public URL
                  </span>
                  <div className="flex gap-2 items-stretch">
                    <input
                      readOnly
                      value={helpCenterUrl}
                      className={`${fieldClass} font-mono text-xs bg-neutral-50`}
                      onFocus={(e) => e.target.select()}
                    />
                    <button
                      type="button"
                      className="h-10 px-3 rounded-xl border border-neutral-200 text-xs font-semibold inline-flex items-center gap-1.5 hover:bg-neutral-50"
                      onClick={async () => {
                        const url = `${window.location.origin}${prefs.helpCenterPath}`;
                        try {
                          await navigator.clipboard.writeText(url);
                          setCopiedHelpUrl(true);
                          window.setTimeout(() => setCopiedHelpUrl(false), 1500);
                        } catch {
                          setError('Could not copy URL.');
                        }
                      }}
                    >
                      {copiedHelpUrl ? (
                        <>
                          <Check className="h-3.5 w-3.5" />
                          Copied
                        </>
                      ) : (
                        <>
                          <Copy className="h-3.5 w-3.5" />
                          Copy
                        </>
                      )}
                    </button>
                  </div>
                </div>
                <a
                  href={prefs.helpCenterPath}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-neutral-800 hover:underline underline-offset-2"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  Open help center
                </a>
              </>
            ) : (
              <p className="text-sm text-neutral-500">
                Portal URL will appear after preferences load — refresh if it stays empty.
              </p>
            )}
            </div>
          </section>

          <section className="rounded-2xl border border-neutral-200 bg-white shadow-sm overflow-hidden">
            <div className="flex items-start gap-3 border-b border-neutral-100 px-5 py-4">
              <span className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-neutral-100 text-neutral-800">
                <KeyRound className="h-4 w-4" />
              </span>
              <div>
                <h3 className="text-sm font-semibold text-neutral-900">API keys</h3>
                <p className="text-xs text-neutral-500 mt-0.5">
                  Server-to-server access. Do not put a key in a public webpage.
                </p>
              </div>
            </div>
            <div className="p-5 space-y-3">
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                value={apiKeyName}
                onChange={(e) => setApiKeyName(e.target.value)}
                placeholder="Key name"
                className={`${fieldClass} sm:flex-1`}
              />
              <button
                type="button"
                disabled={creatingKey}
                onClick={() => void createApiKey()}
                className="h-10 px-4 rounded-xl bg-neutral-900 text-white text-xs font-semibold disabled:opacity-40 shrink-0"
              >
                {creatingKey ? 'Creating…' : 'Create key'}
              </button>
            </div>
            {activeKeys.length > 0 ? (
              <ul className="divide-y divide-neutral-100 border border-neutral-100 rounded-xl overflow-hidden">
                {activeKeys.map((k) => (
                  <li
                    key={k.id}
                    className="flex items-start justify-between gap-3 px-3 py-2.5 text-xs bg-white"
                  >
                    <div className="min-w-0">
                      <p className="font-semibold text-neutral-800">{k.name}</p>
                      <p className="font-mono text-[11px] text-neutral-500 truncate">
                        {k.keyPrefix}…
                      </p>
                      <p className="text-[11px] text-neutral-400 mt-0.5">
                        Created {formatWhen(k.createdAt)}
                        {k.lastUsedAt ? ` · Last used ${formatWhen(k.lastUsedAt)}` : ''}
                      </p>
                    </div>
                    <button
                      type="button"
                      disabled={revokingId === k.id}
                      onClick={() => void revokeApiKey(k.id)}
                      className="shrink-0 h-8 px-2.5 rounded-lg text-[11px] font-semibold bg-red-50 text-red-700 disabled:opacity-40"
                    >
                      {revokingId === k.id ? 'Revoking…' : 'Revoke'}
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-neutral-400">No API keys yet.</p>
            )}
            </div>
          </section>
          </div>

          <section className="rounded-2xl border border-neutral-200 bg-white shadow-sm overflow-hidden">
            <div className="flex items-start gap-3 border-b border-neutral-100 px-5 py-4">
              <span className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-neutral-100 text-neutral-800">
                <MessageSquare className="h-4 w-4" />
              </span>
              <div>
                <h3 className="text-sm font-semibold text-neutral-900">Help widget</h3>
                <p className="text-xs text-neutral-500 mt-0.5">
                  Embed on a customer site. Uses a public widget id — no API secret in the browser.
                </p>
              </div>
            </div>
            <div className="p-5 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="block space-y-1.5">
              <span className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wide">
                Widget name
              </span>
              <input
                value={widgetName}
                onChange={(e) => setWidgetName(e.target.value)}
                className={fieldClass}
              />
            </label>
            <label className="block space-y-1.5">
              <span className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wide">
                Allowed origins (optional)
              </span>
              <input
                value={widgetOrigins}
                onChange={(e) => setWidgetOrigins(e.target.value)}
                placeholder="https://app.customer.com, https://www.customer.com"
                className={fieldClass}
              />
              <span className="text-[11px] text-neutral-400">
                Comma-separated. Leave empty to allow any origin (dev only).
              </span>
            </label>
            </div>
            <button
              type="button"
              disabled={creatingWidget}
              onClick={() => void createWidget()}
              className="h-10 px-4 rounded-xl bg-neutral-900 text-white text-xs font-semibold disabled:opacity-40"
            >
              {creatingWidget ? 'Creating…' : 'Create Help widget'}
            </button>
            {embedHint && (
              <div className="space-y-1">
                <p className="text-[11px] font-semibold text-neutral-600 uppercase tracking-wide">
                  Embed snippet
                </p>
                <textarea
                  readOnly
                  value={embedHint}
                  className="w-full h-20 rounded-lg border border-neutral-200 px-3 py-2 text-[11px] font-mono bg-neutral-50"
                  onFocus={(e) => e.target.select()}
                />
              </div>
            )}
            {widgets.length > 0 && (
              <ul className="divide-y divide-neutral-100 border border-neutral-100 rounded-lg">
                {widgets.map((w) => (
                  <li
                    key={w.id}
                    className="flex items-start justify-between gap-3 px-3 py-2 text-xs"
                  >
                    <div className="min-w-0">
                      <p className="font-semibold text-neutral-800">{w.name}</p>
                      <p className="font-mono text-[10px] text-neutral-500 truncate">
                        {w.publicId}
                      </p>
                      <p className="text-[10px] text-neutral-400">
                        {w.allowedOrigins.length
                          ? w.allowedOrigins.join(', ')
                          : 'Any origin'}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => void toggleWidget(w)}
                      className={`shrink-0 h-7 px-2 rounded-md text-[10px] font-semibold ${
                        w.enabled
                          ? 'bg-emerald-50 text-emerald-800'
                          : 'bg-neutral-100 text-neutral-500'
                      }`}
                    >
                      {w.enabled ? 'Enabled' : 'Disabled'}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            </div>
          </section>
        </>
      )}

      {newSecret && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="api-key-secret-title"
        >
          <div className="w-full max-w-md rounded-xl border border-neutral-200 bg-white p-5 shadow-lg space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2
                  id="api-key-secret-title"
                  className="text-sm font-semibold text-neutral-900"
                >
                  Copy your API key
                </h2>
                <p className="text-xs text-neutral-500 mt-1">
                  This secret is shown once. Store it securely — you will not see it again.
                </p>
              </div>
              <button
                type="button"
                onClick={closeSecretModal}
                className="shrink-0 h-7 w-7 inline-flex items-center justify-center rounded-md text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-900">
              Use as <span className="font-mono">Authorization: Bearer …</span> on intake and
              email endpoints. Never put this in a public website.
            </div>
            <div className="space-y-1">
              <p className="text-[11px] font-semibold text-neutral-600 uppercase tracking-wide">
                Secret
              </p>
              <textarea
                readOnly
                value={newSecret}
                className="w-full h-16 rounded-lg border border-neutral-200 px-3 py-2 text-[11px] font-mono bg-neutral-50"
                onFocus={(e) => e.target.select()}
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void copySecret()}
                className="h-9 px-4 rounded-lg bg-neutral-900 text-white text-xs font-semibold inline-flex items-center gap-1.5"
              >
                {copied ? (
                  <>
                    <Check className="h-3.5 w-3.5" />
                    Copied
                  </>
                ) : (
                  <>
                    <Copy className="h-3.5 w-3.5" />
                    Copy secret
                  </>
                )}
              </button>
              <button
                type="button"
                onClick={closeSecretModal}
                className="h-9 px-4 rounded-lg border border-neutral-200 text-neutral-700 text-xs font-semibold"
              >
                {copied ? 'Done' : "I've copied it"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  if (embedded) return content;
  return <PageShell>{content}</PageShell>;
}
