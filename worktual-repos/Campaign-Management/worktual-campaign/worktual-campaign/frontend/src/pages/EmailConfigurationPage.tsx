import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import axios from "axios";
import { ArrowLeft, Mail } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { ContentFadeIn } from "@/components/skeleton";
import {
  fetchEmailPhase2Config,
  testEmailPhase2Send,
  type AccountsEmailMailbox,
} from "@/services/configuration.service";
import { useEmbedPageReady } from "@/hooks/useEmbedPageReady";

const inputClass =
  "w-full rounded-lg border border-border-default bg-surface px-3 py-2 text-sm text-text-primary focus:border-border-focus focus:outline-none focus:ring-2 focus:ring-border-focus/20";

function apiErrorMessage(err: unknown): string {
  if (axios.isAxiosError(err)) {
    const data = err.response?.data as { message?: string } | undefined;
    return data?.message || err.message || "Request failed";
  }
  return err instanceof Error ? err.message : "Request failed";
}

function statusBadge(status: string) {
  switch (status) {
    case "ready":
      return "bg-emerald-50 text-emerald-800 border-emerald-200";
    case "in_progress":
      return "bg-amber-50 text-amber-900 border-amber-200";
    case "blocked":
      return "bg-red-50 text-red-800 border-red-200";
    default:
      return "bg-subtle text-text-caption border-border-default";
  }
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block text-xs font-medium text-text-caption">
        {label}
      </span>
      {children}
    </label>
  );
}

/** Configuration → Email: My Accounts mailbox + one-off test send. */
export function EmailConfigurationPage() {
  const [mailboxes, setMailboxes] = useState<AccountsEmailMailbox[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [setupHint, setSetupHint] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toEmail, setToEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [testResult, setTestResult] = useState<{
    ok: boolean;
    text: string;
  } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchEmailPhase2Config();
      setMailboxes(data.mailboxes || []);
      setSetupHint(data.setup_hint || "");
      if (data.lookup_error) setError(data.lookup_error);
      const pick =
        data.selected?.channel_id ||
        data.mailboxes?.find((m) => m.send_ready)?.channel_id ||
        data.mailboxes?.[0]?.channel_id ||
        "";
      setSelectedId(pick);
    } catch (err) {
      setError(apiErrorMessage(err) || "Failed to load My Accounts email config");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEmbedPageReady(!loading);

  const selected = useMemo(
    () => mailboxes.find((m) => m.channel_id === selectedId) || null,
    [mailboxes, selectedId],
  );

  async function onSendTest() {
    const to = toEmail.trim();
    if (!to) {
      setTestResult({
        ok: false,
        text: "Enter a recipient email.",
      });
      return;
    }
    setSending(true);
    setTestResult(null);
    try {
      const result = await testEmailPhase2Send({
        to,
        channel_id: selectedId || undefined,
      });
      setTestResult({
        ok: true,
        text: `OK via ${result.transport}/${result.provider} · ${result.from} → ${result.to} · ${result.message_id}`,
      });
    } catch (err) {
      setTestResult({
        ok: false,
        text: apiErrorMessage(err) || "Test send failed",
      });
    } finally {
      setSending(false);
    }
  }

  const status = selected?.status || (mailboxes.length ? "in_progress" : "not_started");

  return (
    <ContentFadeIn className="min-w-0 px-4 py-6 sm:px-6 sm:py-8">
      <Link
        to="/configuration"
        className="inline-flex items-center gap-1.5 text-sm font-medium text-text-secondary hover:text-text-primary"
      >
        <ArrowLeft className="size-4" strokeWidth={1.75} />
        All channels
      </Link>

      <div className="mt-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight text-text-primary">
            <Mail className="size-6" strokeWidth={1.75} />
            Email
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-text-caption">
            Look up the campaign mailbox in My Accounts and send a one-off test
            email — same credentials as a live campaign send once launch is wired.
          </p>
        </div>
        <span
          className={`rounded-full border px-3 py-1 text-xs font-medium capitalize ${statusBadge(status)}`}
        >
          {status.replace(/_/g, " ")}
        </span>
      </div>

      {error ? (
        <p className="mt-4 rounded-xl border border-border-default bg-surface px-4 py-3 text-sm text-text-danger">
          {error}
        </p>
      ) : null}

      {loading ? (
        <p className="mt-6 text-sm text-text-caption">Loading email…</p>
      ) : (
        <div className="mt-6 max-w-xl">
          <section className="rounded-2xl border border-border-default bg-surface p-5">
            <h2 className="text-sm font-semibold text-text-primary">
              Send test to an inbox
            </h2>
            <p className="mt-2 text-sm text-text-caption">
              Campaign send From is this My Accounts mailbox only (Google /
              Microsoft / SMTP). Shared Worktual addresses are not used.
              Campaign reads{" "}
              <span className="font-medium text-text-primary">
                accounts.setup_channel_configs
              </span>{" "}
              (email, product campaign) joined to{" "}
              <span className="font-medium text-text-primary">
                accounts.setup_email_configs
              </span>
              , then sends with that mailbox.
            </p>

            {!mailboxes.length ? (
              <p className="mt-4 text-sm text-text-secondary">
                {setupHint ||
                  "No campaign email mailbox found. Open My Accounts → Setup → Channel Setup → Email."}
              </p>
            ) : (
              <>
                {mailboxes.length > 1 ? (
                  <div className="mt-4">
                    <Field label="Mailbox">
                      <select
                        className={inputClass}
                        value={selectedId}
                        onChange={(e) => setSelectedId(e.target.value)}
                      >
                        {mailboxes.map((m) => (
                          <option key={m.channel_id} value={m.channel_id}>
                            {m.display_from || m.name} ({m.transport})
                          </option>
                        ))}
                      </select>
                    </Field>
                  </div>
                ) : selected?.display_from ? (
                  <p className="mt-3 text-xs text-text-caption">
                    From {selected.display_from}
                    {selected.transport ? ` · ${selected.transport}` : ""}
                  </p>
                ) : null}

                {selected?.block_reason ? (
                  <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                    {selected.block_reason}
                  </p>
                ) : null}

                {!selected?.crypto_configured ? (
                  <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                    Set <code className="text-xs">MS_TOKEN_ENCRYPTION_KEY</code>{" "}
                    on the Campaign backend to decrypt mailbox secrets.
                  </p>
                ) : null}

                <div className="mt-4">
                  <Field label="Recipient email">
                    <input
                      className={inputClass}
                      type="email"
                      autoComplete="off"
                      value={toEmail}
                      onChange={(e) => setToEmail(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          void onSendTest();
                        }
                      }}
                      placeholder="you@company.com"
                    />
                  </Field>
                </div>

                {testResult ? (
                  <p
                    className={`mt-3 break-words text-xs ${
                      testResult.ok ? "text-emerald-700" : "text-text-danger"
                    }`}
                    role="status"
                  >
                    {testResult.text}
                  </p>
                ) : null}

                <div className="mt-4 flex justify-end">
                  <Button
                    type="button"
                    variant="brand"
                    disabled={sending || !toEmail.trim() || !selected?.send_ready}
                    onClick={() => void onSendTest()}
                  >
                    {sending ? "Sending…" : "Run"}
                  </Button>
                </div>
              </>
            )}

            <p className="mt-4 text-xs text-text-caption">
              Mailbox keys come from{" "}
              <span className="font-medium text-text-primary">
                My Accounts → Setup → Channel Setup → Email
              </span>
              .
            </p>
          </section>
        </div>
      )}
    </ContentFadeIn>
  );
}
