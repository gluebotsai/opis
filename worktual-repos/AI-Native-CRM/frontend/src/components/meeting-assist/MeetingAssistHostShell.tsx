import { useEffect, useRef, useState, useTransition } from "react";
import { Headphones } from "lucide-react";
import { AssistSidePanel } from "@/components/meeting-assist/AssistSidePanel";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/skeleton/Skeleton";
import { SkeletonText } from "@/components/skeleton/SkeletonText";
import {
  clearMeetingAssistPanelToken,
  getMeetingAssistPanelToken,
  hydrateMeetingAssistPanelTokenFromUrl,
  setMeetingAssistPanelToken,
} from "@/lib/meeting-assist-panel-auth";
import {
  issueMeetingAssistHostToken,
  listHostMeetings,
  resolveMeetCodeForHost,
  startHostMeetingAssist,
  type HostMeetingRow,
} from "@/services/meetingAssist";

export type MeetingAssistHostKind = "meet" | "zoom" | "teams";

const HOST_META: Record<
  MeetingAssistHostKind,
  { title: string; provider: string; hint: string }
> = {
  meet: {
    title: "Google Meet",
    provider: "google_meet",
    hint: "Connect CRM, then pick the Meet you scheduled from a contact.",
  },
  zoom: {
    title: "Zoom",
    provider: "zoom",
    hint: "Connect CRM (Zoom OAuth install is account-admin). Pick the Zoom meeting from CRM.",
  },
  teams: {
    title: "Microsoft Teams",
    provider: "teams",
    hint: "Connect CRM after tenant install. Open this panel from meeting Apps.",
  },
};

type Active = {
  sessionId: string;
  contactId: string;
  contactName: string;
  topic: string | null;
};

/**
 * Shared linking shell for official Meet / Zoom / Teams side panels.
 * Uses CRM design tokens (violet accent + brand CTAs). After a meeting is
 * linked, renders AssistSidePanel against the CRM session.
 */
export function MeetingAssistHostShell({
  host,
  sdkStatus = null,
  autoMeetingCode = null,
}: {
  host: MeetingAssistHostKind;
  /** Optional SDK readiness line (Meet add-on / Zoom Apps / Teams JS). */
  sdkStatus?: string | null;
  /**
   * Meeting code read directly from the host SDK (e.g. Meet's
   * getMeetingInfo()). When present, we skip the meeting picker entirely and
   * jump straight into the assist session for the current call — no picking
   * an attendee, no manual code entry, no extra buttons.
   */
  autoMeetingCode?: string | null;
}) {
  const meta = HOST_META[host];
  const [token, setToken] = useState<string | null>(null);
  const [meetings, setMeetings] = useState<HostMeetingRow[]>([]);
  const [meetCode, setMeetCode] = useState("");
  const [active, setActive] = useState<Active | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [autoResolveFailed, setAutoResolveFailed] = useState(false);
  const [autoAttemptedFor, setAutoAttemptedFor] = useState<string | null>(null);
  // Bumped on every activate() so AssistSidePanel always fully remounts, even
  // when re-selecting the same (reactivated) sessionId — otherwise it keeps
  // its stale "ended" state from a prior run and never reopens its SSE
  // connection to pick up the now-active status.
  const activationSeq = useRef(0);
  const [activationKey, setActivationKey] = useState(0);

  const clearAuth = () => {
    clearMeetingAssistPanelToken();
    setToken(null);
    setMeetings([]);
    setActive(null);
  };

  const refreshMeetings = (authToken: string) => {
    setMeetingAssistPanelToken(authToken);
    startTransition(async () => {
      const list = await listHostMeetings({
        provider: meta.provider,
        limit: 12,
      });
      if (list.ok) {
        setMeetings(list.meetings);
        setError(null);
      } else if (
        ("error" in list && list.error?.includes("Unauthorized")) ||
        !list.ok
      ) {
        clearAuth();
        setError("Connect CRM to continue (cookies are blocked in meeting iframes).");
      }
    });
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const fromUrl = hydrateMeetingAssistPanelTokenFromUrl(
        window.location.search,
      );
      const existing = fromUrl || getMeetingAssistPanelToken();
      if (existing) {
        if (!cancelled) {
          setToken(existing);
          refreshMeetings(existing);
        }
        return;
      }

      // Localhost / same-origin CRM tab: cookie session can issue the host
      // JWT without a popup (Meet iframes still need Connect CRM).
      try {
        const issued = await issueMeetingAssistHostToken();
        if (cancelled) return;
        if (issued.ok && issued.token) {
          setMeetingAssistPanelToken(issued.token);
          setToken(issued.token);
          refreshMeetings(issued.token);
          return;
        }
      } catch {
        /* not signed in on this origin — show Connect CRM */
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [host]);

  useEffect(() => {
    function onMessage(ev: MessageEvent) {
      if (ev.origin !== window.location.origin) return;
      const data = ev.data as {
        type?: string;
        token?: string;
        host?: string;
      };
      if (
        (data?.type === "worktual-meeting-assist-linked" ||
          data?.type === "worktual-meet-addon-linked") &&
        data.token
      ) {
        setMeetingAssistPanelToken(data.token);
        setToken(data.token);
        refreshMeetings(data.token);
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [host]);

  const connectCrm = () => {
    setError(null);
    startTransition(async () => {
      // Prefer cookie session on this origin (no popup).
      try {
        const issued = await issueMeetingAssistHostToken();
        if (issued.ok && issued.token) {
          setMeetingAssistPanelToken(issued.token);
          setToken(issued.token);
          refreshMeetings(issued.token);
          return;
        }
      } catch {
        /* fall through */
      }

      const returnTo = `/meeting-assist/hosts/${host}`;
      const popupUrl = `/meeting-assist/link?popup=1&host=${encodeURIComponent(host)}`;
      const popup = window.open(
        popupUrl,
        "worktual-assist-link",
        "popup=yes,width=480,height=640",
      );
      if (popup) return;

      // Popup blocked (common in Cursor preview / strict Chrome) — same tab.
      window.location.assign(
        `/meeting-assist/link?host=${encodeURIComponent(host)}&returnTo=${encodeURIComponent(returnTo)}`,
      );
    });
  };

  const activate = (row: {
    sessionId: string;
    contactId: string;
    contactName: string;
    topic: string | null;
    token: string;
  }) => {
    setMeetingAssistPanelToken(row.token);
    setToken(row.token);
    activationSeq.current += 1;
    setActivationKey(activationSeq.current);
    setActive({
      sessionId: row.sessionId,
      contactId: row.contactId,
      contactName: row.contactName,
      topic: row.topic,
    });
  };

  const startFromActivity = (activityId: string) => {
    setError(null);
    startTransition(async () => {
      const result = await startHostMeetingAssist({ activityId });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      activate(result);
    });
  };

  const resolveCode = (code: string, { isAuto }: { isAuto: boolean }) => {
    setError(null);
    startTransition(async () => {
      const result = await resolveMeetCodeForHost(code);
      if (!result.ok) {
        if (isAuto) {
          setAutoResolveFailed(true);
          setMeetCode(code);
        }
        setError(result.error);
        return;
      }
      activate(result);
    });
  };

  const startFromCode = () => {
    if (host !== "meet" || !meetCode.trim()) return;
    resolveCode(meetCode.trim(), { isAuto: false });
  };

  // Meet tells us exactly which call we're in — jump straight to that
  // attendee's assist session instead of making the user pick from a list.
  useEffect(() => {
    if (
      host !== "meet" ||
      !token ||
      !autoMeetingCode ||
      active ||
      autoResolveFailed ||
      autoAttemptedFor === autoMeetingCode
    ) {
      return;
    }
    setAutoAttemptedFor(autoMeetingCode);
    resolveCode(autoMeetingCode, { isAuto: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [host, token, autoMeetingCode, active, autoResolveFailed, autoAttemptedFor]);

  const autoResolving =
    host === "meet" && !!autoMeetingCode && !autoResolveFailed && !active;

  // Live session: full-bleed Assist panel only (matches reference — no shell chrome).
  if (active) {
    return (
      <div className="h-screen min-h-0 bg-canvas">
        <AssistSidePanel
          key={activationKey}
          sessionId={active.sessionId}
          contactId={active.contactId}
          contactName={active.contactName}
          topic={active.topic}
          hostLabel="AI sales Assist"
        />
      </div>
    );
  }

  return (
    <div className="flex h-screen min-h-0 flex-col bg-canvas p-3 text-text-primary">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-violet-600">
          <Headphones className="size-4" strokeWidth={1.75} />
          <span className="text-xs font-semibold uppercase tracking-wide">
            Assist
          </span>
        </div>
        {token ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 ring-1 ring-emerald-200">
            <span className="size-1.5 rounded-full bg-emerald-500" />
            CRM connected
          </span>
        ) : null}
      </div>
      {sdkStatus ? (
        <p className="mt-1.5 rounded-lg bg-amber-50 px-2 py-1 text-[10px] leading-snug text-amber-800 ring-1 ring-amber-200">
          {sdkStatus}
        </p>
      ) : null}

      {!token ? (
        <div className="mt-4 space-y-3 rounded-xl border border-border-default bg-surface p-4">
          <p className="text-sm text-text-secondary">{meta.hint}</p>
          <p className="text-xs text-text-caption">
            If you are already signed into CRM on this same site, Connect uses
            that session (no popup). Inside Meet, cookies are blocked — Connect
            opens a secure window for a short-lived panel token.
          </p>
          {error ? (
            <p className="rounded-lg border border-red-200 bg-red-50 px-2 py-1.5 text-xs text-red-700">
              {error}
            </p>
          ) : null}
          <Button
            type="button"
            className="h-9 w-full"
            onClick={connectCrm}
            disabled={pending}
          >
            {pending ? "Connecting…" : "Connect CRM"}
          </Button>
        </div>
      ) : autoResolving ? (
        <div className="mt-6 flex flex-1 flex-col items-center justify-center gap-3 text-center">
          <Skeleton height={16} width={16} borderRadius={999} />
          <SkeletonText width={144} height={12} />
        </div>
      ) : (
        <div className="mt-3 min-h-0 flex-1 space-y-3 overflow-y-auto">
          {error ? (
            <p className="rounded-lg border border-red-200 bg-red-50 px-2 py-1.5 text-xs text-red-700">
              {error}
            </p>
          ) : null}

          {host === "meet" ? (
            <div className="space-y-1.5">
              <p className="text-[11px] font-medium text-text-caption">
                Meet code (from URL)
              </p>
              <div className="flex gap-2">
                <input
                  value={meetCode}
                  onChange={(e) => setMeetCode(e.target.value)}
                  placeholder="abc-defg-hij"
                  className="h-8 flex-1 rounded-lg border border-border-default bg-surface px-2 text-xs outline-none focus:border-border-focus"
                />
                <Button
                  type="button"
                  className="h-8 text-xs"
                  onClick={startFromCode}
                  disabled={pending || !meetCode.trim()}
                >
                  Start
                </Button>
              </div>
            </div>
          ) : null}

          <div className="space-y-1.5">
            <p className="text-[11px] font-medium text-text-caption">
              Recent CRM {meta.title} meetings
            </p>
            {pending && meetings.length === 0 ? (
              <div className="space-y-2 rounded-xl border border-border-default bg-surface p-3">
                <SkeletonText width="72%" height={12} />
                <SkeletonText width="88%" height={12} />
                <SkeletonText width="64%" height={12} />
              </div>
            ) : meetings.length === 0 ? (
              <p className="text-xs text-text-caption">
                No matching meetings yet. Schedule from a contact in CRM, then
                refresh.
              </p>
            ) : (
              <ul className="space-y-1.5">
                {meetings.map((m) => (
                  <li key={m.activityId}>
                    <button
                      type="button"
                      onClick={() => startFromActivity(m.activityId)}
                      className="w-full rounded-xl border border-border-default bg-surface px-2.5 py-2 text-left transition-colors hover:border-border-focus/40 hover:bg-subtle"
                    >
                      <p className="text-xs font-semibold text-text-primary">
                        {m.contactName}
                      </p>
                      <p className="truncate text-[11px] text-text-secondary">
                        {m.topic || m.subject}
                      </p>
                      {m.meetCode ? (
                        <p className="text-[10px] font-medium text-violet-600">
                          {m.meetCode}
                        </p>
                      ) : null}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <button
            type="button"
            onClick={connectCrm}
            className="text-[11px] font-medium text-text-link underline underline-offset-2"
          >
            Reconnect CRM account
          </button>
        </div>
      )}
    </div>
  );
}
