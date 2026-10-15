import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { ContentFadeIn } from "@/components/skeleton";
import {
  fetchSmsConfig,
  saveSmsConfig,
  type SmsConfigBundle,
} from "@/services/configuration.service";

function statusBadge(status: string) {
  const s = status.toLowerCase();
  if (s === "ready") {
    return "bg-emerald-50 text-emerald-800 border-emerald-200";
  }
  if (s === "in_progress") {
    return "bg-amber-50 text-amber-900 border-amber-200";
  }
  return "bg-subtle text-text-caption border-border-default";
}

function CheckItem({ ok, label }: { ok: boolean; label: string }) {
  return (
    <li className="flex items-center gap-2 text-sm">
      <span
        className={`size-2 shrink-0 rounded-full ${ok ? "bg-emerald-500" : "bg-neutral-300"}`}
      />
      <span className={ok ? "text-text-primary" : "text-text-caption"}>
        {label}
      </span>
    </li>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-text-primary">{label}</span>
      {hint ? (
        <span className="mt-0.5 block text-xs text-text-caption">{hint}</span>
      ) : null}
      <div className="mt-1.5">{children}</div>
    </label>
  );
}

const inputClass =
  "w-full rounded-lg border border-border-default bg-surface px-3 py-2 text-sm text-text-primary focus:border-border-focus focus:outline-none focus:ring-2 focus:ring-border-focus/20";

const EMPTY = {
  provider: "stub",
  sender_id: "",
  entity_id: "",
  api_key: "",
  base_url: "",
};

/** SMS / DLT sending settings stored in Campaign DB. */
export function SmsConfigurationPage() {
  const [bundle, setBundle] = useState<SmsConfigBundle | null>(null);
  const [form, setForm] = useState<Record<string, string>>({ ...EMPTY });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const next = await fetchSmsConfig();
    setBundle(next);
    setForm({ ...EMPTY, ...next.settings });
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        await refresh();
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : "Failed to load SMS config",
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  const onSave = async () => {
    setBusy(true);
    setError(null);
    setToast(null);
    try {
      const next = await saveSmsConfig(form);
      setBundle(next);
      setForm({ ...EMPTY, ...next.settings });
      setToast("SMS settings saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="p-6 text-sm text-text-caption">Loading SMS settings…</div>
    );
  }

  return (
    <ContentFadeIn className="mx-auto max-w-2xl space-y-6 p-6">
      <div>
        <Link
          to="/configuration"
          className="mb-3 inline-flex items-center gap-1.5 text-xs font-medium text-text-caption hover:text-text-primary"
        >
          <ArrowLeft className="size-3.5" strokeWidth={1.75} />
          Configuration
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-xl bg-subtle">
            <MessageSquare className="size-5 text-text-primary" strokeWidth={1.75} />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-text-primary">SMS</h1>
            <p className="text-sm text-text-caption">
              Sender and DLT entity for approved template test sends.
            </p>
          </div>
          {bundle ? (
            <span
              className={`ml-auto rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${statusBadge(bundle.status)}`}
            >
              {bundle.status.replace(/_/g, " ")}
            </span>
          ) : null}
        </div>
      </div>

      {error ? (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}
      {toast ? (
        <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {toast}
        </p>
      ) : null}

      {bundle ? (
        <ul className="flex flex-wrap gap-4 rounded-xl border border-border-default bg-surface px-4 py-3">
          <CheckItem ok={bundle.checklist.provider} label="Provider" />
          <CheckItem ok={bundle.checklist.sender_id} label="Sender ID" />
          <CheckItem ok={bundle.checklist.entity_id} label="Entity ID" />
          <CheckItem ok={bundle.checklist.api_key} label="API key" />
        </ul>
      ) : null}

      <section className="space-y-4 rounded-xl border border-border-default bg-surface p-4">
        <Field
          label="Provider"
          hint='Use "stub" for local test sends until a live SMS gateway is wired.'
        >
          <select
            className={inputClass}
            value={form.provider || "stub"}
            disabled={busy}
            onChange={(e) =>
              setForm((f) => ({ ...f, provider: e.target.value }))
            }
          >
            <option value="stub">Stub (dev / test)</option>
            <option value="http">HTTP gateway</option>
          </select>
        </Field>
        <Field label="Sender ID" hint="Approved DLT / operator header.">
          <input
            className={inputClass}
            value={form.sender_id || ""}
            disabled={busy}
            onChange={(e) =>
              setForm((f) => ({ ...f, sender_id: e.target.value }))
            }
            placeholder="WTUAL"
          />
        </Field>
        <Field label="Entity ID" hint="Optional DLT principal entity id.">
          <input
            className={inputClass}
            value={form.entity_id || ""}
            disabled={busy}
            onChange={(e) =>
              setForm((f) => ({ ...f, entity_id: e.target.value }))
            }
            placeholder="1201…"
          />
        </Field>
        {(form.provider || "stub") !== "stub" ? (
          <>
            <Field label="API key">
              <input
                className={inputClass}
                type="password"
                autoComplete="off"
                value={form.api_key || ""}
                disabled={busy}
                onChange={(e) =>
                  setForm((f) => ({ ...f, api_key: e.target.value }))
                }
                placeholder={
                  bundle?.secrets_set?.api_key ? "•••• (unchanged)" : "••••••••"
                }
              />
            </Field>
            <Field
              label="Gateway base URL"
              hint="POST {base}/send with JSON body when provider is HTTP."
            >
              <input
                className={inputClass}
                value={form.base_url || ""}
                disabled={busy}
                onChange={(e) =>
                  setForm((f) => ({ ...f, base_url: e.target.value }))
                }
                placeholder="https://sms-gateway.example.com"
              />
            </Field>
          </>
        ) : null}
        <Button type="button" variant="brand" disabled={busy} onClick={() => void onSave()}>
          Save SMS settings
        </Button>
      </section>
    </ContentFadeIn>
  );
}
