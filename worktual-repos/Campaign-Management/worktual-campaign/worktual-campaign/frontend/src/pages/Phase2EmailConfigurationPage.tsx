import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Mail, Send } from "lucide-react";
import axios from "axios";
import { Button } from "@/components/ui/Button";
import { ContentFadeIn } from "@/components/skeleton";
import {
  fetchEmailPhase2Config,
  testEmailPhase2Send,
  type AccountsEmailMailbox,
  type EmailPhase2TestSendResult,
} from "@/services/configuration.service";
import { useEmbedPageReady } from "@/hooks/useEmbedPageReady";

const inputClass =
  "w-full rounded-lg border border-border-default bg-surface px-3 py-2 text-sm text-text-primary focus:border-border-focus focus:outline-none focus:ring-2 focus:ring-border-focus/20";

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

function statusLabel(status: string) {
  switch (status) {
    case "ready":
      return "Ready";
    case "in_progress":
      return "In progress";
    case "blocked":
      return "Blocked";
    default:
      return "Not started";
  }
}

function apiErrorMessage(err: unknown): string {
  if (axios.isAxiosError(err)) {
    const data = err.response?.data as { message?: string } | undefined;
    return data?.message || err.message || "Request failed";
  }
  return err instanceof Error ? err.message : "Request failed";
}

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <p className="text-xs font-medium text-text-caption">{label}</p>
      <p className="mt-0.5 text-sm text-text-primary break-all">{value || "—"}</p>
    </div>
  );
}

export function Phase2EmailConfigurationPage() {
  const [mailboxes, setMailboxes] = useState<AccountsEmailMailbox[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [setupHint, setSetupHint] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toEmail, setToEmail] = useState("");
  const [subject, setSubject] = useState("Worktual Campaign — Phase 2 mailbox test");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [sendResult, setSendResult] = useState<EmailPhase2TestSendResult | null>(
    null,
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchEmailPhase2Config();
      setMailboxes(data.mailboxes || []);
      setSetupHint(data.setup_hint || "");
      if (data.lookup_error) {
        setError(data.lookup_error);
      }
      const pick =
        data.selected?.channel_id ||
        data.mailboxes?.find((m) => m.send_ready)?.channel_id ||
        data.mailboxes?.[0]?.channel_id ||
        "";
      setSelectedId(pick);
    } catch (err) {
      setError(apiErrorMessage(err) || "Failed to load Phase 2 email config");
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
    setSending(true);
    setSendError(null);
    setSendResult(null);
    try {
      const result = await testEmailPhase2Send({
        to: toEmail.trim(),
        channel_id: selectedId || undefined,
        subject: subject.trim() || undefined,
      });
      setSendResult(result);
    } catch (err) {
      setSendError(apiErrorMessage(err) || "Test send failed");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="min-h-full bg-[#f3f4f6] px-4 py-6 sm:px-6 sm:py-8">
      <Link
        to="/configuration"
        className="inline-flex items-center gap-1.5 text-sm font-medium text-text-secondary hover:text-text-primary"
      >
        <ArrowLeft className="size-4" strokeWidth={1.75} />
        All channels
      </Link>

      <div className="mt-4 flex items-start gap-3">
        <span className="inline-flex size-10 items-center justify-center rounded-xl bg-neutral-900 text-white">
          <Mail className="size-5" strokeWidth={1.75} />
        </span>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-text-primary">
            Email — Phase 2 (Accounts)
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-text-caption">
            Read your campaign mailbox from My Accounts and send one test email
            via OAuth or SMTP. This does <b>not</b> use the Worktual campaign
            blast API — Phase 1 bulk sends are unchanged.
          </p>
        </div>
      </div>

      {error ? (
        <p className="mt-4 rounded-xl border border-border-default bg-surface px-4 py-3 text-sm text-text-danger">
          {error}
        </p>
      ) : null}

      {loading ? (
        <div className="mt-6 space-y-3" aria-busy="true">
          <div className="h-4 w-48 animate-pulse rounded bg-neutral-200" />
          <div className="h-28 animate-pulse rounded-2xl bg-neutral-200" />
          <div className="h-40 animate-pulse rounded-2xl bg-neutral-200" />
        </div>
      ) : (
        <ContentFadeIn className="mt-6 flex flex-col gap-6">
          {!mailboxes.length ? (
            <section className="rounded-2xl border border-border-default bg-surface p-5">
              <p className="text-sm text-text-secondary">
                No campaign email mailbox found for this organization.
              </p>
              <p className="mt-2 text-sm text-text-caption">{setupHint}</p>
            </section>
          ) : (
            <>
              <section className="rounded-2xl border border-border-default bg-surface p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h2 className="text-sm font-semibold text-text-primary">
                    Accounts mailbox
                  </h2>
                  {selected ? (
                    <span
                      className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${statusBadge(selected.status)}`}
                    >
                      {statusLabel(selected.status)}
                    </span>
                  ) : null}
                </div>
                <p className="mt-2 text-sm text-text-caption">
                  Campaign launch From is this mailbox. Shared Worktual From
                  addresses are not used.
                </p>

                {mailboxes.length > 1 ? (
                  <label className="mt-4 block text-sm">
                    <span className="mb-1 block text-xs font-medium text-text-caption">
                      Select mailbox
                    </span>
                    <select
                      className={inputClass}
                      value={selectedId}
                      onChange={(e) => setSelectedId(e.target.value)}
                    >
                      {mailboxes.map((m) => (
                        <option key={m.channel_id} value={m.channel_id}>
                          {m.name} — {m.display_from || m.provider_type}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}

                {selected ? (
                  <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    <Field label="Provider" value={selected.provider_type} />
                    <Field label="Mode" value={selected.third_party_mode} />
                    <Field label="Transport" value={selected.transport} />
                    <Field label="From" value={selected.display_from} />
                    <Field label="Sender name" value={selected.sender_name} />
                    <Field label="Reply-To" value={selected.reply_to} />
                    <Field label="OAuth provider" value={selected.oauth_provider} />
                    <Field
                      label="OAuth account"
                      value={selected.oauth_account_email}
                    />
                    <Field label="Channel status" value={selected.channel_status} />
                  </div>
                ) : null}

                {selected?.block_reason ? (
                  <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                    {selected.block_reason}
                  </p>
                ) : null}

                {!selected?.crypto_configured ? (
                  <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                    Set <code className="text-xs">MS_TOKEN_ENCRYPTION_KEY</code> on
                    the Campaign backend to decrypt Accounts mailbox secrets.
                  </p>
                ) : null}
              </section>

              <section className="rounded-2xl border border-border-default bg-surface p-5">
                <h2 className="text-sm font-semibold text-text-primary">
                  Send test email
                </h2>
                <p className="mt-1 text-xs text-text-caption">
                  Sends one message through the Accounts mailbox (OAuth Gmail/Graph
                  or SMTP). Not linked to campaign bulk / Worktual API.
                </p>

                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  <label className="block text-sm sm:col-span-2">
                    <span className="mb-1 block text-xs font-medium text-text-caption">
                      To (test recipient)
                    </span>
                    <input
                      className={inputClass}
                      type="email"
                      placeholder="you@company.com"
                      value={toEmail}
                      onChange={(e) => setToEmail(e.target.value)}
                    />
                  </label>
                  <label className="block text-sm sm:col-span-2">
                    <span className="mb-1 block text-xs font-medium text-text-caption">
                      Subject
                    </span>
                    <input
                      className={inputClass}
                      type="text"
                      value={subject}
                      onChange={(e) => setSubject(e.target.value)}
                    />
                  </label>
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-3">
                  <Button
                    type="button"
                    disabled={
                      sending ||
                      !toEmail.trim() ||
                      !selected?.send_ready
                    }
                    onClick={() => void onSendTest()}
                  >
                    <Send className="size-4" strokeWidth={1.75} />
                    {sending ? "Sending…" : "Send test"}
                  </Button>
                  {!selected?.send_ready ? (
                    <span className="text-xs text-text-caption">
                      Fix mailbox readiness before test send.
                    </span>
                  ) : null}
                </div>

                {sendError ? (
                  <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                    {sendError}
                  </p>
                ) : null}

                {sendResult ? (
                  <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-3 text-sm text-emerald-900">
                    <p className="font-medium">Test sent</p>
                    <p className="mt-1 text-xs">
                      Transport: {sendResult.transport} / {sendResult.provider}
                    </p>
                    <p className="mt-1 text-xs break-all">
                      From {sendResult.from} → {sendResult.to}
                    </p>
                    <p className="mt-1 text-xs break-all">
                      Message id: {sendResult.message_id}
                    </p>
                  </div>
                ) : null}
              </section>
            </>
          )}

          <section className="rounded-2xl border border-dashed border-border-default bg-subtle/40 p-4 text-xs text-text-caption">
            Phase 1 live bulk email still uses{" "}
            <Link to="/configuration/email" className="font-medium underline">
              Configuration → Email
            </Link>{" "}
            and the Worktual campaign API. Wire bulk to Accounts only after this
            test path succeeds.
          </section>
        </ContentFadeIn>
      )}
    </div>
  );
}
