import { useEffect, useState } from "react";
import { Calendar, Check, Copy, ExternalLink, Headphones, Users } from "lucide-react";
import {
  parseCalendarLinkFromMeetingBody,
  parseGuestsFromMeetingBody,
  isMeetingMarkedRescheduled,
  parseMeetingLinkFromBody,
  parseOrganizerFromMeetingBody,
  parsePreviousWhenLabelFromMeetingBody,
  parseProviderFromMeetingBody,
  parseTopicFromMeetingBody,
  parseWhenLabelFromMeetingBody,
} from "@/lib/meeting-body";
import { meetingJoinLabel, meetingProviderLabel } from "@/lib/meeting-provider";
import { Button } from "@/components/ui/Button";
import { MeetingAssistPanel } from "@/components/contacts/MeetingAssistPanel";
import { DispositionTag } from "@/components/contacts/DispositionTag";
import {
  fetchMeetingAssistForActivity,
  fetchNotetakerStatus,
} from "@/services/meetingAssist";
import { meetingCapturePollMaxAttempts } from "@/lib/meeting-capture-poll";

const POST_CALL_MEETING_SERVICE_STATUSES = new Set([
  "processing",
  "stopping",
  "completed",
  "completed_partial",
  "failed",
]);

function captureStatusLabel(
  status: string | undefined,
  error?: string | null,
  meetingServiceStatus?: string | null,
  hasFinalTranscript?: boolean,
): {
  label: string;
  className: string;
} {
  const ms = (meetingServiceStatus || "").toLowerCase();
  if (
    hasFinalTranscript &&
    ms !== "active" &&
    (status === "done" || POST_CALL_MEETING_SERVICE_STATUSES.has(ms))
  ) {
    return {
      label: "Transcript: captured",
      className: "bg-emerald-50 text-emerald-800",
    };
  }
  if (meetingServiceStatus === "awaiting_admission") {
    return {
      label: "Admit Worktual Notetaker in Meet (waits until scheduled slot end)",
      className: "bg-amber-50 text-amber-900",
    };
  }
  switch (status) {
    case "done":
      return {
        label: "Transcript: captured",
        className: "bg-emerald-50 text-emerald-800",
      };
    case "scheduled":
    case "joined":
      return {
        label:
          status === "joined" || meetingServiceStatus === "active"
            ? "Transcript: capturing (notetaker in call)"
            : "Transcript: notetaker joining",
        className: "bg-amber-50 text-amber-900",
      };
    case "missing":
    case "denied":
    case "failed": {
      const detail = error?.trim();
      const shortDetail =
        detail && detail.length > 100 ? `${detail.slice(0, 97)}…` : detail;
      return {
        label:
          status === "failed"
            ? shortDetail
              ? `Transcript: capture failed — ${shortDetail}`
              : "Transcript: capture failed — check bot config"
            : "Transcript: missing — admit Worktual Notetaker next time or attach notes",
        className: "bg-red-50 text-red-800",
      };
    }
    default:
      return {
        label: "Transcript: pending",
        className: "bg-subtle text-text-secondary",
      };
  }
}

export function MeetingActivityDetails({
  activityId,
  contactId,
  subject,
  body,
  dueAt,
  superseded = false,
  disposition = null,
}: {
  activityId?: string;
  contactId?: string | null;
  subject: string;
  body: string | null;
  dueAt: string | null;
  /** Prior slot closed by a reschedule — show struck-through. */
  superseded?: boolean;
  disposition?: string | null;
}) {
  const [copied, setCopied] = useState(false);
  const [captureStatus, setCaptureStatus] = useState<string | null>(null);
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [meetingServiceStatus, setMeetingServiceStatus] = useState<
    string | null
  >(null);
  const [adminsNotified, setAdminsNotified] = useState(false);
  const [momSent, setMomSent] = useState(false);
  const [transcriptText, setTranscriptText] = useState<string | null>(null);
  const [assistAddonUrl, setAssistAddonUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!activityId) return;
    let cancelled = false;
    let attempts = 0;
    const load = () =>
      Promise.all([
        fetchMeetingAssistForActivity(activityId),
        fetchNotetakerStatus(activityId).catch(() => null),
      ])
        .then(([session, notetaker]) => {
          if (cancelled) return "done" as const;
          const status =
            notetaker?.captureBot?.status ||
            session.meta?.captureBot?.status ||
            null;
          setCaptureStatus(status);
          setCaptureError(
            notetaker?.captureBot?.error ||
              session.meta?.captureBot?.error ||
              null,
          );
          setMeetingServiceStatus(
            notetaker?.captureBot?.meetingServiceStatus ||
              notetaker?.status ||
              null,
          );
          setAdminsNotified(Boolean(session.activity?.missEscalatedAt));
          setMomSent(Boolean(session.activity?.momSentAt));
          const hasTranscript = Boolean(session.activity?.transcriptText?.trim());
          setTranscriptText(session.activity?.transcriptText?.trim() || null);
          setAssistAddonUrl(
            notetaker?.assistAddonUrl ||
              session.meta?.assistAddonUrl ||
              null,
          );
          const ms = (
            notetaker?.captureBot?.meetingServiceStatus ||
            notetaker?.status ||
            ""
          ).toLowerCase();
          const captureSettled =
            status === "done" ||
            status === "missing" ||
            status === "failed";
          const postCall = POST_CALL_MEETING_SERVICE_STATUSES.has(ms);
          if (status === "done" && !hasTranscript) {
            return "wait" as const;
          }
          if (
            !captureSettled &&
            (status === "scheduled" ||
              status === "joined" ||
              (postCall && hasTranscript))
          ) {
            return "wait" as const;
          }
          return "done" as const;
        })
        .catch(() => {
          if (!cancelled) setCaptureStatus(null);
          return "done" as const;
        });
    void load();
    const maxAttempts = meetingCapturePollMaxAttempts(dueAt);
    const timer = window.setInterval(() => {
      attempts += 1;
      if (attempts > maxAttempts) {
        window.clearInterval(timer);
        return;
      }
      void load().then((state) => {
        if (state === "done") window.clearInterval(timer);
      });
    }, 4000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [activityId, dueAt]);

  const topic =
    parseTopicFromMeetingBody(body) ||
    subject.replace(/^Meeting:\s*/i, "").trim() ||
    subject;
  const whenLabel =
    parseWhenLabelFromMeetingBody(body) ||
    (dueAt
      ? new Date(dueAt).toLocaleString(undefined, {
          weekday: "long",
          month: "short",
          day: "numeric",
          year: "numeric",
          hour: "numeric",
          minute: "2-digit",
        })
      : null);
  const provider = parseProviderFromMeetingBody(body);
  const meetLink = parseMeetingLinkFromBody(body);
  const calendarLink = parseCalendarLinkFromMeetingBody(body);
  const organizer = parseOrganizerFromMeetingBody(body);
  const guests = parseGuestsFromMeetingBody(body);
  const joinLabel = meetingJoinLabel(provider);
  const captureUi = captureStatusLabel(
    captureStatus || undefined,
    captureError,
    meetingServiceStatus,
    Boolean(transcriptText?.trim()),
  );

  const previousWhen = parsePreviousWhenLabelFromMeetingBody(body);
  const rescheduled =
    isMeetingMarkedRescheduled(body) || Boolean(previousWhen);

  const onCopyLink = async () => {
    if (!meetLink) return;
    try {
      await navigator.clipboard.writeText(meetLink);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div
      className={`mt-2 space-y-3 ${superseded ? "opacity-70" : ""}`}
    >
      <p
        className={`text-sm font-semibold text-text-primary ${superseded ? "line-through text-text-caption" : ""}`}
      >
        {topic}
      </p>

      {whenLabel ? (
        <div className="flex items-start gap-2.5 rounded-lg border border-border-default bg-subtle/60 px-3 py-2.5">
          <span className="mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-md bg-pink-50 text-pink-700">
            <Calendar className="size-3.5" strokeWidth={1.75} />
          </span>
          <div className="min-w-0">
            <p className="text-[11px] font-medium tracking-wide text-text-caption uppercase">
              When
            </p>
            {previousWhen && !superseded ? (
              <p className="mt-0.5 text-sm text-text-caption line-through">
                {previousWhen}
              </p>
            ) : null}
            <p
              className={`mt-0.5 text-sm font-medium text-text-primary ${superseded ? "line-through text-text-caption" : ""}`}
            >
              {whenLabel}
            </p>
          </div>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        {superseded ? (
          <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
            Previous time
          </span>
        ) : null}
        {rescheduled && !superseded ? (
          <span className="rounded-md bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-900">
            Rescheduled
          </span>
        ) : null}
        <span className="rounded-md bg-pink-50 px-2 py-0.5 text-xs font-medium text-pink-700">
          {meetingProviderLabel(provider)}
        </span>
        {captureStatus ? (
          <span
            className={`rounded-md px-2 py-0.5 text-xs font-medium ${captureUi.className}`}
            title={captureError || undefined}
          >
            {captureUi.label}
          </span>
        ) : null}
        {adminsNotified ? (
          <span className="rounded-md bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-900">
            Meeting not conducted
          </span>
        ) : null}
        {momSent ? (
          <span className="rounded-md bg-cyan-50 px-2 py-0.5 text-xs font-medium text-cyan-900">
            Minutes of Meeting emailed
          </span>
        ) : null}
      </div>

      {meetLink ? (
        <div className="rounded-lg border border-border-default bg-surface px-3 py-2.5">
          <p className="text-[11px] font-medium tracking-wide text-text-caption uppercase">
            Meeting link
          </p>
          <p className="mt-1 truncate text-xs text-text-caption" title={meetLink}>
            {meetLink}
          </p>
          <div className="mt-2.5 flex flex-wrap gap-2">
            <a
              href={meetLink}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-brand px-3 text-xs font-semibold text-text-on-dark hover:opacity-90"
            >
              <ExternalLink className="size-3.5" strokeWidth={2} />
              {joinLabel}
            </a>
            <Button
              type="button"
              variant="secondary"
              className="h-8 text-xs"
              onClick={() => void onCopyLink()}
            >
              {copied ? (
                <Check className="size-3.5" strokeWidth={2} />
              ) : (
                <Copy className="size-3.5" strokeWidth={2} />
              )}
              {copied ? "Copied" : "Copy link"}
            </Button>
            {calendarLink ? (
              <a
                href={calendarLink}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border-default bg-surface px-3 text-xs font-semibold text-text-primary hover:bg-subtle"
              >
                Open calendar
              </a>
            ) : null}
          </div>
        </div>
      ) : null}

      {assistAddonUrl && !superseded ? (
        <div className="rounded-lg border border-border-default bg-surface px-3 py-2.5">
          <div className="flex items-start gap-2.5">
            <span className="mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-md bg-violet-50 text-brand">
              <Headphones className="size-3.5" strokeWidth={1.75} />
            </span>
            <div className="min-w-0">
              <p className="text-[11px] font-medium tracking-wide text-text-caption uppercase">
                Sales Assist
              </p>
              <p className="mt-0.5 text-sm text-text-primary">
                In Google Meet, open{" "}
                <span className="font-semibold">Activities → Worktual Assist</span>
                . Sign in with the same Google account as your CRM user, then
                ask questions about this call.
              </p>
            </div>
          </div>
        </div>
      ) : null}

      {disposition ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-medium tracking-wide text-text-caption uppercase">
            Transcript outcome
          </span>
          <DispositionTag label={disposition} />
        </div>
      ) : null}

      {activityId && contactId ? (
        <div className="flex flex-wrap gap-2">
          <MeetingAssistPanel
            activityId={activityId}
            contactId={contactId}
            provider={provider}
            dueAt={dueAt}
          />
        </div>
      ) : null}

      {(organizer || guests.length > 0) && (
        <div className="rounded-lg border border-border-default bg-surface px-3 py-2.5">
          <div className="flex items-center gap-1.5">
            <Users className="size-3.5 text-text-caption" strokeWidth={1.75} />
            <p className="text-[11px] font-medium tracking-wide text-text-caption uppercase">
              Participants
            </p>
          </div>

          {organizer ? (
            <div className="mt-2.5">
              <p className="text-[11px] font-semibold text-text-secondary">
                Organizer
              </p>
              <div className="mt-1 flex items-center gap-2">
                <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-violet-0 text-xs font-semibold text-brand">
                  {(organizer.name || organizer.email).charAt(0).toUpperCase()}
                </span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-text-primary">
                    {organizer.name}
                  </p>
                  <p className="truncate text-xs text-text-caption">
                    {organizer.email}
                  </p>
                </div>
              </div>
            </div>
          ) : null}

          {guests.length > 0 ? (
            <div className={organizer ? "mt-3" : "mt-2.5"}>
              <p className="text-[11px] font-semibold text-text-secondary">
                Guests ({guests.length})
              </p>
              <ul className="mt-1.5 flex flex-wrap gap-1.5">
                {guests.map((guest) => (
                  <li
                    key={guest}
                    className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-border-default bg-subtle px-2.5 py-1 text-xs text-text-secondary"
                  >
                    <span className="inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-surface text-[10px] font-semibold text-text-primary">
                      {guest.charAt(0).toUpperCase()}
                    </span>
                    <span className="truncate">{guest}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
