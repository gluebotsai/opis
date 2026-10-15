import { useCallback, useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { ConfigurationShell } from "@/components/configuration/ConfigurationShell";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { Input } from "@/components/ui/Input";
import { canManageApiKeys, normalizeRole } from "@/lib/rbac";
import {
  API_KEY_SCOPE_OPTIONS,
  createTenantApiKey,
  fetchTenantApiKeys,
  revokeTenantApiKey,
  type TenantApiKey,
} from "@/services/configuration";
import { useAppSelector } from "@/store";
import {
  PAGE_H1_CLASS,
  SECTION_H2_CLASS,
  SUCCESS_FLASH_CLASS,
  TONE_DANGER,
} from "@/lib/ui-tones";

function apiBaseUrl(): string {
  const fromEnv = (
    import.meta.env.VITE_API_PUBLIC_URL as string | undefined
  )?.trim();
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  return window.location.origin;
}

function docsUrl(): string {
  return `${apiBaseUrl()}/docs`;
}

export function ApiDevelopersPage() {
  const role = normalizeRole(useAppSelector((s) => s.auth.user?.role));
  const [keys, setKeys] = useState<TenantApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<string[]>([
    "companies",
    "deals",
    "activities",
  ]);
  const [creating, setCreating] = useState(false);
  const [newSecret, setNewSecret] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchTenantApiKeys();
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setKeys(result.items);
    } catch {
      setError("Failed to load API keys.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  if (!canManageApiKeys(role)) {
    return <Navigate to="/configuration/email" replace />;
  }

  const toggleScope = (id: string) => {
    setScopes((prev) =>
      prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id],
    );
  };

  const onCreate = async () => {
    setCreating(true);
    setError(null);
    setMessage(null);
    try {
      const result = await createTenantApiKey({ name, scopes });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setNewSecret(result.secret);
      setName("");
      setMessage("API key created. Copy the secret now — it will not be shown again.");
      await reload();
    } catch {
      setError("Failed to create API key.");
    } finally {
      setCreating(false);
    }
  };

  const onRevoke = async (id: string) => {
    if (!window.confirm("Revoke this API key? Integrations using it will fail.")) {
      return;
    }
    setBusyId(id);
    setError(null);
    try {
      const result = await revokeTenantApiKey(id);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setMessage("API key revoked.");
      await reload();
    } catch {
      setError("Failed to revoke API key.");
    } finally {
      setBusyId(null);
    }
  };

  const base = apiBaseUrl();

  return (
    <ConfigurationShell>
      <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
        <h1 className={PAGE_H1_CLASS}>Developers</h1>
        <p className="mt-2 max-w-2xl text-sm text-text-secondary">
          Create API keys so your chatbot, website, or ERP can call this CRM.
          Use{" "}
          <code className="rounded bg-subtle px-1 text-xs">
            Authorization: Bearer &lt;secret&gt;
          </code>
          . Contacts and leads already have APIs — include the{" "}
          <strong>contacts</strong> scope or use{" "}
          <code className="rounded bg-subtle px-1 text-xs">
            POST /api/marketing/leads
          </code>
          .
        </p>

        {message ? (
          <p className={`mt-4 text-sm ${SUCCESS_FLASH_CLASS}`} role="status">
            {message}
          </p>
        ) : null}
        {error ? (
          <p className={`mt-4 text-sm ${TONE_DANGER}`} role="alert">
            {error}
          </p>
        ) : null}

        <section className="mt-8 rounded-xl border border-border-default bg-surface p-5">
          <h2 className={SECTION_H2_CLASS}>Connection</h2>
          <dl className="mt-3 space-y-2 text-sm">
            <div className="flex flex-wrap gap-2">
              <dt className="w-28 shrink-0 text-text-caption">API base</dt>
              <dd>
                <code className="break-all text-text-primary">{base}</code>
              </dd>
            </div>
            <div className="flex flex-wrap gap-2">
              <dt className="w-28 shrink-0 text-text-caption">OpenAPI</dt>
              <dd>
                <a
                  href={docsUrl()}
                  target="_blank"
                  rel="noreferrer"
                  className="font-medium text-brand underline"
                >
                  {docsUrl()}
                </a>
              </dd>
            </div>
          </dl>
        </section>

        <section className="mt-8 rounded-xl border border-border-default bg-surface p-5">
          <h2 className={SECTION_H2_CLASS}>Create API key</h2>
          <div className="mt-4 max-w-md">
            <Input
              label="Name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Production chatbot"
            />
          </div>
          <fieldset className="mt-4">
            <legend className="text-xs font-medium text-text-caption">
              Scopes
            </legend>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {API_KEY_SCOPE_OPTIONS.map((opt) => (
                <Checkbox
                  key={opt.id}
                  checked={scopes.includes(opt.id)}
                  onChange={() => toggleScope(opt.id)}
                  label={opt.label}
                />
              ))}
            </div>
          </fieldset>
          <Button
            type="button"
            variant="primary"
            className="mt-4"
            disabled={creating || !name.trim() || scopes.length === 0}
            onClick={() => void onCreate()}
          >
            {creating ? "Creating…" : "Create key"}
          </Button>
        </section>

        {newSecret ? (
          <div
            className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-5"
            role="dialog"
            aria-labelledby="secret-title"
          >
            <h2 id="secret-title" className="text-sm font-semibold text-amber-950">
              Copy your secret now
            </h2>
            <p className="mt-1 text-xs text-amber-900">
              This is the only time the full key is shown.
            </p>
            <pre className="mt-3 overflow-x-auto rounded-lg bg-white p-3 text-xs text-text-primary">
              {newSecret}
            </pre>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  void navigator.clipboard.writeText(newSecret);
                  setMessage("Secret copied to clipboard.");
                }}
              >
                Copy
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => setNewSecret(null)}
              >
                Done
              </Button>
            </div>
          </div>
        ) : null}

        <section className="mt-8 rounded-xl border border-border-default bg-surface p-5">
          <h2 className={SECTION_H2_CLASS}>Your keys</h2>
          {loading ? (
            <p className="mt-3 text-sm text-text-caption">Loading…</p>
          ) : keys.length === 0 ? (
            <p className="mt-3 text-sm text-text-caption">
              No active API keys yet.
            </p>
          ) : (
            <ul className="mt-4 divide-y divide-border-default">
              {keys.map((key) => (
                <li
                  key={key.id}
                  className="flex flex-wrap items-center justify-between gap-3 py-3"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-text-primary">
                      {key.name}
                    </p>
                    <p className="text-xs text-text-caption">
                      <code>{key.keyPrefix}…</code>
                      {" · "}
                      {key.scopes.join(", ")}
                      {" · "}
                      Created {new Date(key.createdAt).toLocaleDateString()}
                      {key.lastUsedAt
                        ? ` · Last used ${new Date(key.lastUsedAt).toLocaleString()}`
                        : " · Never used"}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={busyId === key.id}
                    onClick={() => void onRevoke(key.id)}
                  >
                    {busyId === key.id ? "Revoking…" : "Revoke"}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="mt-8 rounded-xl border border-border-default bg-surface p-5">
          <h2 className={SECTION_H2_CLASS}>Quick recipes</h2>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-text-secondary">
            <li>
              <strong>Company:</strong>{" "}
              <code className="text-xs">POST {base}/api/companies</code>
            </li>
            <li>
              <strong>Deal:</strong>{" "}
              <code className="text-xs">POST {base}/api/sales/deals</code>
            </li>
            <li>
              <strong>Activity:</strong>{" "}
              <code className="text-xs">POST {base}/api/activities</code>
            </li>
            <li>
              <strong>Quote / invoice:</strong>{" "}
              <code className="text-xs">/api/sales/quotes</code>,{" "}
              <code className="text-xs">/api/finance/invoices</code>
            </li>
            <li>
              <strong>Contacts (existing):</strong>{" "}
              <code className="text-xs">POST {base}/api/contacts</code> or{" "}
              <code className="text-xs">POST {base}/api/marketing/leads</code>
            </li>
          </ul>
        </section>
      </div>
    </ConfigurationShell>
  );
}
