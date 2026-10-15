import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { fetchCalendarIntegrations, scheduleMeeting } from "@/services/calendar";
import {
  MEETING_PROVIDERS,
  meetingProviderLabel,
  type MeetingProvider,
} from "@/lib/meeting-provider";

function parseParticipantEmails(raw: string): string[] {
  return raw
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter((s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s));
}

/** Compact schedule-meeting dialog used from the Inbox contact panel. */
export function ScheduleMeetingDialog({
  contactId,
  displayName,
  email,
  onClose,
  onScheduled,
}: {
  contactId: string;
  displayName: string;
  email: string;
  onClose: () => void;
  onScheduled?: () => void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [when, setWhen] = useState("");
  const [integrationsLoading, setIntegrationsLoading] = useState(true);
  const [integrationsLoadError, setIntegrationsLoadError] = useState<string | null>(
    null,
  );
  const [topic, setTopic] = useState("");
  const [duration, setDuration] = useState("30");
  const [provider, setProvider] = useState<MeetingProvider>("google_meet");
  const [participants, setParticipants] = useState("");
  const [integrations, setIntegrations] = useState<{
    canSendMail: boolean;
    googleCanScheduleMeetings: boolean;
    googleEmail: string | null;
    zoomConfigured: boolean;
    teamsConfigured: boolean;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    setIntegrationsLoading(true);
    setIntegrationsLoadError(null);
    void fetchCalendarIntegrations()
      .then((status) => {
        if (cancelled) return;
        setIntegrations({
          canSendMail: status.canSendMail,
          googleCanScheduleMeetings: status.googleCanScheduleMeetings,
          googleEmail: status.googleEmail,
          zoomConfigured: status.zoomConfigured,
          teamsConfigured: status.teamsConfigured,
        });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setIntegrations(null);
        setIntegrationsLoadError(
          err instanceof Error
            ? err.message
            : "Could not load calendar settings — is the API running?",
        );
      })
      .finally(() => {
        if (!cancelled) setIntegrationsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const scheduleReady =
    provider === "google_meet"
      ? Boolean(integrations?.googleCanScheduleMeetings)
      : Boolean(integrations?.canSendMail);
  const providerReady =
    provider === "google_meet" ||
    (provider === "zoom" && integrations?.zoomConfigured) ||
    (provider === "teams" && integrations?.teamsConfigured);

  const integrationsLoaded = !integrationsLoading && integrations !== null;

  async function onSave() {
    setError(null);
    if (integrationsLoading) {
      setError("Still checking your Google / email connection. Try again in a moment.");
      return;
    }
    if (integrationsLoadError) {
      setError(integrationsLoadError);
      return;
    }
    if (!when) {
      setError("Pick a date and time.");
      return;
    }
    if (!email) {
      setError("This contact needs an email address.");
      return;
    }
    if (!scheduleReady || !providerReady) {
      setError(
        provider === "google_meet"
          ? "Connect Google with Calendar in Configuration → Email."
          : "Connect email in Configuration → Email to send the invite.",
      );
      return;
    }
    setPending(true);
    try {
      const participantEmails = parseParticipantEmails(participants);
      const result = await scheduleMeeting({
        contactId,
        when,
        whenIso: new Date(when).toISOString(),
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        topic: topic.trim() || undefined,
        durationMinutes: Number.parseInt(duration, 10) || 30,
        participants: participants.trim() || undefined,
        participantEmails: participantEmails.length > 0 ? participantEmails : undefined,
        meetingProvider: provider,
      });
      if (!result?.ok) {
        setError(
          result?.needsConnect
            ? `${result.error} Open Configuration → Email.`
            : result?.error || "Could not schedule meeting.",
        );
        return;
      }
      if (!result.confirmationSent) {
        setError(
          result.emailError ||
            "Meeting saved on your calendar, but the invite email could not be sent.",
        );
        onScheduled?.();
        return;
      }
      if (result.warning) {
        setError(result.warning);
        onScheduled?.();
        return;
      }
      onScheduled?.();
      onClose();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Network error — check that the API is running on port 4000.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl border border-border-default bg-surface p-5 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-base font-semibold text-text-primary">Schedule meeting</h3>
        <p className="mt-1 text-sm text-text-caption">{displayName}</p>

        <div className="mt-4 grid gap-3">
          <Input
            label="When"
            type="datetime-local"
            value={when}
            onChange={(e) => setWhen(e.target.value)}
          />
          <Input
            label="Topic (optional)"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="Demo, discovery call…"
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <Select
              label="Duration"
              value={duration}
              onChange={(e) => setDuration(e.target.value)}
              options={[
                { value: "15", label: "15 min" },
                { value: "30", label: "30 min" },
                { value: "45", label: "45 min" },
                { value: "60", label: "60 min" },
              ]}
            />
            <div className="flex w-full flex-col gap-2">
              <span className="text-sm font-medium text-text-primary">Platform</span>
              <div className="grid grid-cols-3 gap-1.5">
                {MEETING_PROVIDERS.map((p) => {
                  const disabled =
                    pending ||
                    (p === "zoom" && !integrations?.zoomConfigured) ||
                    (p === "teams" && !integrations?.teamsConfigured);
                  const active = provider === p;
                  return (
                    <button
                      key={p}
                      type="button"
                      disabled={disabled}
                      onClick={() => setProvider(p)}
                      title={meetingProviderLabel(p)}
                      className={`rounded-lg border px-1 py-2 text-[11px] font-medium transition-colors ${
                        active
                          ? "border-brand bg-violet-0 text-brand"
                          : "border-border-default bg-surface text-text-secondary hover:bg-subtle"
                      } ${disabled ? "cursor-not-allowed opacity-45" : ""}`}
                    >
                      {p === "google_meet" ? "Meet" : meetingProviderLabel(p)}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
          <Input
            label="Additional participants (optional, comma-separated)"
            value={participants}
            onChange={(e) => setParticipants(e.target.value)}
            placeholder="jane@example.com, sam@example.com"
          />
          {integrationsLoading ? (
            <p className="text-xs text-text-caption">
              Checking email & calendar connection…
            </p>
          ) : integrationsLoadError ? (
            <p className="text-xs text-text-danger">{integrationsLoadError}</p>
          ) : integrations && !scheduleReady ? (
            <p className="text-xs text-text-danger">
              {provider === "google_meet"
                ? "Connect Google (with Calendar) in Configuration → Email for Meet."
                : "Connect any email account in Configuration → Email."}
            </p>
          ) : integrations?.googleEmail ? (
            <p className="text-xs text-text-caption">
              Invite sent from {integrations.googleEmail}
            </p>
          ) : null}
        </div>

        {error ? <p className="mt-3 text-sm text-text-danger">{error}</p> : null}

        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button
            type="button"
            onClick={() => void onSave()}
            disabled={
              pending ||
              integrationsLoading ||
              !when ||
              !email ||
              !integrationsLoaded ||
              !scheduleReady ||
              !providerReady
            }
          >
            {pending
              ? "Saving…"
              : integrationsLoading
                ? "Checking connection…"
                : "Schedule & send invite"}
          </Button>
        </div>
      </div>
    </div>
  );
}
