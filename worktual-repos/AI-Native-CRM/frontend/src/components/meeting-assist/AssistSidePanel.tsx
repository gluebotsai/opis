import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { ArrowLeft, FileText, Send } from "lucide-react";
import {
  meetingAssistEventsUrl,
  runMeetingAssist,
  startMeetMediaAssist,
  fetchMeetingAssistSession,
  type AssistAction,
  type AssistConversationContext,
  type AssistFitGap,
  type AssistSentiment,
  type AssistSuggestion,
} from "@/services/meetingAssist";
import { api } from "@/services/api";
import { meetingAssistPanelAuthHeaders } from "@/lib/meeting-assist-panel-auth";
import {
  assistSentimentStyles,
  normalizeAssistSentimentDisplay,
  shouldShowSentimentCoach,
} from "@/lib/assist-sentiment";

function doneActionLabel(kind: AssistAction["kind"]): string {
  if (kind === "schedule_meeting") return "Scheduled";
  if (kind === "send_case_study" || kind === "send_follow_up") return "Sent";
  return "Created";
}

function humanizeAssistError(reason: string | null | undefined): string {
  const code = (reason || "").trim();
  if (!code) return "Assist could not answer — try again.";
  switch (code) {
    case "empty_or_invalid_llm":
    case "ai_service_unavailable":
    case "llm_not_configured":
      return "AI briefly failed to answer — keep talking or Ask again.";
    case "unauthorized":
    case "session_not_found":
      return "Assist session expired — reconnect CRM from the host panel.";
    default:
      // Avoid leaking raw internal reason codes into the Meet panel.
      if (/^[a-z0-9_]+$/i.test(code) && !code.includes(" ")) {
        return "Assist could not answer — try again.";
      }
      return code;
  }
}

type AssistPayload = {
  ok?: boolean;
  talkTrack?: string | null;
  suggestions?: AssistSuggestion[];
  nextQuestions?: string[];
  query?: string | null;
  sentiment?: AssistSentiment | null;
  fitGaps?: AssistFitGap[];
  conversationContext?: AssistConversationContext | null;
  action?: AssistAction | null;
  nextBestAction?: string | null;
  sentimentCoachHint?: string | null;
  detectedObjection?: {
    kind: string;
    customerLine?: string;
    reply?: string;
    proofPoint?: string | null;
    question?: string | null;
  } | null;
  reason?: string | null;
  error?: string | null;
};

type LiveEvent =
  | {
      type: "chunk";
      text: string;
      speaker: string | null;
      seq: number;
      latencyDetail?: string | null;
    }
  | {
      type: "assist";
      result: AssistPayload;
      latencyDetail?: string | null;
    }
  | { type: "status"; status: string; message?: string }
  | { type: "stt_partial"; text: string };

/**
 * In-meeting Assist rail — coaches on the customer's questions only.
 * Default live path: meeting bot captions → transcript chunks (buyer-zero setup).
 * Optional: Meet Media API when MEETING_ASSIST_LIVE_SOURCE=meet_media.
 * Chrome mic is never used. Sales can still type Ask.
 */
export function AssistSidePanel({
  sessionId,
  contactId,
  contactName,
  topic,
  hostLabel = "AI sales Assist",
  enableLiveAssist,
  enableMeetMedia,
}: {
  sessionId: string;
  contactId: string;
  contactName: string;
  topic: string | null;
  hostLabel?: string;
  /** Start live customer captions (meeting bot or Meet Media). */
  enableLiveAssist?: boolean;
  /** @deprecated Use enableLiveAssist */
  enableMeetMedia?: boolean;
  /** @deprecated Mic fallback removed — Chrome mic cannot isolate the customer. */
  allowMicFallback?: boolean;
}) {
  const liveEnabled = enableLiveAssist ?? enableMeetMedia ?? true;
  const [talkTrack, setTalkTrack] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<AssistSuggestion[]>([]);
  const [nextAction, setNextAction] = useState<AssistAction | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [actionDone, setActionDone] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [answeredQuery, setAnsweredQuery] = useState<string | null>(null);
  const [sentiment, setSentiment] = useState<AssistSentiment | null>(null);
  const [ask, setAsk] = useState("");
  const [status, setStatus] = useState("active");
  const [mediaStatus, setMediaStatus] = useState<string | null>(null);
  const [mediaHint, setMediaHint] = useState<string | null>(null);
  const [fitGaps, setFitGaps] = useState<AssistFitGap[]>([]);
  const [liveMode, setLiveMode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const finalizedRef = useRef(false);
  const mediaStartedRef = useRef(false);
  // Reliability polling defaults to fast (SSE can be flaky behind Meet /
  // tunnel proxies), then backs off once SSE proves it's actually delivering
  // events — the fixed 2.5s poll was adding steady load to a Postgres pool
  // shared with the rest of the CRM (pool limit 5) on every open panel.
  const pollIntervalMsRef = useRef(2_500);
  const [heardLine, setHeardLine] = useState<string | null>(null);
  const [information, setInformation] =
    useState<AssistConversationContext | null>(null);
  const [sentimentHint, setSentimentHint] = useState<string | null>(null);
  const [objectionReply, setObjectionReply] = useState<string | null>(null);
  const [page, setPage] = useState<"live" | "ask">("live");
  const [chat, setChat] = useState<
    Array<{ role: "you" | "assist"; text: string }>
  >([]);
  const statusRef = useRef(status);
  statusRef.current = status;

  const finalizeOnce = useCallback(() => {
    if (finalizedRef.current) return;
    if (statusRef.current !== "active") return;
    finalizedRef.current = true;

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...meetingAssistPanelAuthHeaders(),
    };

    void fetch(`/api/meeting-assist/sessions/${sessionId}/finalize`, {
      method: "POST",
      credentials: "include",
      headers,
      body: JSON.stringify({ source: "meeting_unload" }),
      keepalive: true,
    }).then(() => {
      setStatus("ended");
    });
  }, [sessionId]);

  const applyAssistResult = (
    result: AssistPayload,
    opts?: { allowClear?: boolean },
  ) => {
    const talk = (result.talkTrack || "").trim();
    const nextSuggestions = Array.isArray(result.suggestions)
      ? result.suggestions
      : [];
    const gaps = Array.isArray(result.fitGaps) ? result.fitGaps : [];
    const ctx = result.conversationContext ?? null;
    const nba = result.action?.kind && result.action.detail ? result.action : null;
    const infoLines = ctx
      ? [
          ctx.backgroundOneLine,
          ctx.lastDiscussionSummary,
          ctx.theirPositionThen,
          ctx.theirFocusNow,
          ctx.whatChanged,
        ].filter((x) => (x || "").trim())
      : [];
    const hasCoaching =
      talk.length > 0 ||
      nextSuggestions.some((s) => (s.text || "").trim()) ||
      Boolean(nba) ||
      infoLines.length > 0 ||
      gaps.some((g) => (g.area || "").trim()) ||
      shouldShowSentimentCoach(
        result.sentiment,
        result.sentimentCoachHint,
      );

    // Failed Ask / empty poll payloads must not wipe a good recommendation.
    if (!hasCoaching && !opts?.allowClear) return false;

    setTalkTrack(talk || null);
    setSuggestions(nextSuggestions);
    setNextAction((current) => {
      const same =
        current?.kind === nba?.kind &&
        current?.detail === nba?.detail &&
        current?.whenLocal === nba?.whenLocal;
      if (!same) {
        setActionDone(false);
        setActionError(null);
      }
      return nba;
    });
    // A turn's LLM output can legitimately skip conversationContext (it
    // already answered the immediate question and had nothing new to add
    // about background/what-changed) — that must not blank out Information
    // that a previous turn already filled in. Only replace it when this
    // turn actually has something, or the caller explicitly wants a clear.
    if (infoLines.length > 0 || opts?.allowClear) setInformation(ctx);
    setFitGaps(gaps);
    setSentimentHint((result.sentimentCoachHint || "").trim() || null);
    const objection = (result.detectedObjection?.reply || "").trim();
    if (objection || opts?.allowClear) setObjectionReply(objection || null);
    const q = (result.query || "").trim();
    if (q) setAnsweredQuery(q);
    if (result.sentiment) setSentiment(result.sentiment);
    return true;
  };

  const runNextAction = useCallback(async () => {
    if (!nextAction || actionBusy || actionDone) return;
    setActionBusy(true);
    setActionError(null);
    const response = await api.post(
      `/api/meeting-assist/sessions/${sessionId}/execute-action`,
      {
        action: nextAction,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      },
    );
    const data = response.data as { ok?: boolean; error?: string };
    setActionBusy(false);
    if (!data?.ok) {
      setActionError(data?.error || "Could not run that action.");
      return;
    }
    setActionDone(true);
  }, [actionBusy, actionDone, nextAction, sessionId]);

  useEffect(() => {
    if (!liveEnabled || mediaStartedRef.current) return;
    mediaStartedRef.current = true;
    void (async () => {
      setMediaStatus("starting");
      const result = await startMeetMediaAssist(sessionId);
      if (result.ok) {
        if (result.mode) setLiveMode(result.mode);
        setMediaStatus(result.liveStatus || "listening");
        setMediaHint(null);
      } else {
        setMediaStatus("error");
        setMediaHint(result.error);
      }
    })();
  }, [liveEnabled, sessionId]);

  useEffect(() => {
    const es = new EventSource(meetingAssistEventsUrl(sessionId), {
      withCredentials: true,
    });

    es.addEventListener("live", (ev) => {
      try {
        const data = JSON.parse((ev as MessageEvent).data) as LiveEvent;

        pollIntervalMsRef.current = 8_000;
        if (data.type === "chunk") {
          const who = (data.speaker || "Customer").trim();
          const snippet = data.text.trim().slice(0, 160);
          if (snippet) setHeardLine(`${who}: ${snippet}`);
        } else if (data.type === "assist") {
          if (applyAssistResult(data.result)) setError(null);
        } else if (data.type === "status") {
          if (data.status.startsWith("media_")) {
            setMediaStatus(data.status.replace(/^media_/, ""));
            if (data.message) setMediaHint(data.message);
          } else {
            setStatus(data.status);
          }
        }
      } catch {
        /* ignore */
      }
    });

    es.addEventListener("ready", (ev) => {
      pollIntervalMsRef.current = 8_000;
      try {
        const data = JSON.parse((ev as MessageEvent).data) as {
          status?: string;
          lastSuggestions?: AssistPayload | null;
          lastHeard?: { speaker?: string | null; text?: string | null } | null;
        };
        if (data.status) setStatus(data.status);
        if (data.lastSuggestions) {
          if (applyAssistResult(data.lastSuggestions)) setError(null);
        }
        const heard = (data.lastHeard?.text || "").trim();
        if (heard) {
          const who = (data.lastHeard?.speaker || "Customer").trim();
          setHeardLine(`${who}: ${heard.slice(0, 160)}`);
        }
      } catch {
        /* ignore */
      }
    });

    es.onerror = () => {
      // Fall back to fast polling if SSE drops (common behind Meet / tunnel proxies).
      pollIntervalMsRef.current = 2_500;
    };

    return () => {
      es.close();
    };
  }, [sessionId]);

  // Reliability: poll last coaching while live — Meet iframe SSE is flaky.
  // Interval is dynamic (see pollIntervalMsRef): fast until SSE proves it's
  // delivering events, then backed off so idle panels stop hammering the
  // shared Postgres pool every 2.5s.
  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    const pull = async () => {
      try {
        const session = await fetchMeetingAssistSession(sessionId);
        if (cancelled || !session) return;
        if (session.status) setStatus(session.status);
        if (session.lastSuggestions) {
          if (applyAssistResult(session.lastSuggestions)) setError(null);
        }
        const lastChunk = session.chunks?.[session.chunks.length - 1];
        const heard = (lastChunk?.text || "").trim();
        if (heard) {
          const who = (lastChunk.speaker || "Customer").trim();
          setHeardLine(`${who}: ${heard.slice(0, 160)}`);
        }
        const bot = (
          session.meta as {
            botAssist?: { status?: string; error?: string };
          } | null
        )?.botAssist;
        if (bot?.status) {
          setMediaStatus(bot.status);
          if (bot.error) setMediaHint(bot.error);
        }
      } catch {
        /* ignore */
      }
    };
    const loop = async () => {
      await pull();
      if (cancelled) return;
      timer = window.setTimeout(loop, pollIntervalMsRef.current);
    };
    void loop();
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [sessionId]);

  useEffect(() => {
    const onUnload = () => {
      finalizeOnce();
    };
    window.addEventListener("pagehide", onUnload);
    window.addEventListener("beforeunload", onUnload);
    return () => {
      window.removeEventListener("pagehide", onUnload);
      window.removeEventListener("beforeunload", onUnload);
    };
  }, [finalizeOnce]);

  const onAsk = () => {
    const q = ask.trim();
    if (!q) return;
    setPage("ask");
    setChat((prev) => [...prev, { role: "you", text: q }]);
    setAsk("");
    startTransition(async () => {
      setError(null);
      try {
        const result = await runMeetingAssist({
          sessionId,
          query: q,
          mode: "auto",
        });
        applyAssistResult(result);
        const reply =
          (result.talkTrack || "").trim() ||
          result.suggestions?.find((s) => s.text?.trim())?.text?.trim() ||
          humanizeAssistError(
            result.reason || (result as { error?: string }).error,
          );
        setChat((prev) => [...prev, { role: "assist", text: reply }]);
      } catch {
        setChat((prev) => [
          ...prev,
          {
            role: "assist",
            text: "Assist request failed — check API is running.",
          },
        ]);
      }
    });
  };

  const live = status === "active";
  const recommendation =
    (talkTrack || "").trim() ||
    suggestions.find((s) => s.text?.trim())?.text?.trim() ||
    null;

  const usingBot = liveMode !== "meet_media";
  const mediaLine =
    mediaStatus === "listening"
      ? usingBot
        ? "Listening to customer via meeting captions…"
        : "Listening to customer via Meet Media…"
      : mediaStatus === "waiting_admit"
        ? mediaHint ||
          "Admit the Worktual bot (Zoom Waiting Room / Meet lobby) if prompted — captions start after it joins."
        : mediaStatus === "connecting" || mediaStatus === "starting"
          ? usingBot
            ? "Starting caption bot for this meeting…"
            : "Connecting Meet Media (customer audio)…"
          : mediaStatus === "error"
            ? mediaHint ||
              (usingBot
                ? "Live captions unavailable — use Ask, or contact Worktual ops."
                : "Meet Media unavailable — use Ask, or finish Workspace Preview setup.")
            : null;

  const toneSentiment = normalizeAssistSentimentDisplay(sentiment);
  const showToneCoach = shouldShowSentimentCoach(sentiment, sentimentHint);
  const toneStyles = toneSentiment
    ? assistSentimentStyles(toneSentiment)
    : null;

  const informationItems = information
    ? (
        [
          ["Background", information.backgroundOneLine],
          ["Last discussion", information.lastDiscussionSummary],
          ["They said then", information.theirPositionThen],
          ["They say now", information.theirFocusNow],
          ["What changed", information.whatChanged],
        ] as const
      ).filter(([, v]) => (v || "").trim())
    : [];

  return (
    <div className="flex h-full min-h-0 flex-col bg-canvas px-3 pb-3 pt-2 text-[13px] text-text-primary">
      <header className="flex items-center justify-between gap-2">
        {page === "ask" ? (
          <button
            type="button"
            onClick={() => setPage("live")}
            className="inline-flex min-w-0 items-center gap-1 text-[15px] font-semibold leading-5 text-text-primary"
          >
            <ArrowLeft className="size-4 shrink-0" strokeWidth={2} />
            Ask
          </button>
        ) : (
          <h1 className="truncate text-[15px] font-semibold leading-5 text-text-primary">
            {hostLabel}
          </h1>
        )}
        <span
          className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium ${
            live
              ? "bg-emerald-50 text-emerald-700"
              : "bg-subtle text-text-caption"
          }`}
        >
          <span
            className={`size-1.5 rounded-full ${live ? "bg-emerald-500" : "bg-text-caption"}`}
          />
          {live ? "Live" : status}
        </span>
      </header>

      {page === "ask" ? (
        <>
          <div className="mt-3 flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
            {chat.length === 0 ? (
              <p className="m-auto max-w-[16rem] text-center text-xs leading-snug text-text-caption">
                Type a question about the lead, product, or deal. Live coaching
                stays on the previous screen.
              </p>
            ) : (
              chat.map((msg, i) => (
                <div
                  key={`${msg.role}-${i}`}
                  className={`max-w-[94%] rounded-2xl px-3 py-2 text-[13px] leading-snug ${
                    msg.role === "you"
                      ? "ml-auto bg-neutral-900 text-white"
                      : "bg-subtle text-text-primary"
                  }`}
                >
                  {msg.text}
                </div>
              ))
            )}
          </div>
          <div className="mt-3 flex items-center gap-2 rounded-full bg-neutral-800 py-1.5 pl-4 pr-1.5">
            <input
              value={ask}
              onChange={(e) => setAsk(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") onAsk();
              }}
              placeholder="Ask about lead, product"
              disabled={!live || pending}
              className="h-8 min-w-0 flex-1 bg-transparent text-xs text-white outline-none placeholder:text-text-placeholder disabled:opacity-60"
            />
            <button
              type="button"
              onClick={onAsk}
              disabled={!live || pending || !ask.trim()}
              aria-label="Ask"
              className="flex size-8 shrink-0 items-center justify-center rounded-full bg-neutral-900 text-white transition-colors hover:bg-neutral-700 disabled:opacity-50"
            >
              <Send className="size-3.5" strokeWidth={2} />
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="mt-1 truncate text-[11px] text-text-caption">
            {contactName}
            {topic ? ` · ${topic}` : ""}
          </p>

          {error ? (
            <p className="mt-3 text-xs text-red-600">{error}</p>
          ) : null}

          {mediaLine ? (
            <p
              className={`mt-2 text-[11px] ${
                mediaStatus === "error" ? "text-amber-800" : "text-text-caption"
              }`}
            >
              {mediaLine}
            </p>
          ) : null}

          {heardLine ? (
            <section className="mt-3 space-y-1 rounded-lg bg-subtle px-2.5 py-2">
              <p className="text-[11px] font-medium text-text-secondary">
                Heard
              </p>
              <p className="text-xs leading-snug text-text-primary">
                {heardLine}
              </p>
            </section>
          ) : null}

          <div className="mt-5 min-h-0 flex-1 space-y-6 overflow-y-auto">
            <section className="space-y-2">
              <h2 className="text-sm font-semibold text-text-primary">
                Information
              </h2>
              {informationItems.length > 0 ? (
                <ul className="space-y-2 text-xs leading-snug text-text-secondary">
                  {informationItems.map(([label, value]) => (
                    <li key={label}>
                      <span className="font-medium text-text-primary">
                        {label}:
                      </span>{" "}
                      {value}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs leading-snug text-text-caption">
                  Fills in from the customer’s background and what changed.
                </p>
              )}
            </section>

            <section className="space-y-3">
              <h2 className="text-sm font-semibold text-text-primary">
                Recommendation
              </h2>
              {answeredQuery ? (
                <p className="text-[11px] leading-snug text-text-caption">
                  Answering: {answeredQuery}
                </p>
              ) : null}
              {showToneCoach && toneStyles && sentimentHint ? (
                <div className="flex gap-2.5">
                  <span
                    className={`mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full ${toneStyles.iconBgClass}`}
                  >
                    <span
                      className={`size-2.5 rounded-full ${toneStyles.dotClass}`}
                      aria-hidden
                    />
                  </span>
                  <div className="min-w-0">
                    <p
                      className={`text-[11px] font-semibold uppercase tracking-wide ${toneStyles.labelClass}`}
                    >
                      {toneStyles.label}
                    </p>
                    <p className="mt-0.5 leading-snug text-text-primary">
                      {sentimentHint}
                    </p>
                  </div>
                </div>
              ) : null}
              {recommendation ? (
                <div className="flex gap-2.5">
                  <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-subtle text-text-caption">
                    <FileText className="size-3.5" strokeWidth={1.75} />
                  </span>
                  <div className="min-w-0">
                    <p className="leading-snug text-text-primary">{recommendation}</p>
                    {objectionReply ? (
                      <p className="mt-2 leading-snug text-text-primary">
                        <span className="font-medium">Objection. </span>
                        {objectionReply}
                      </p>
                    ) : null}
                  </div>
                </div>
              ) : !showToneCoach ? (
                <p className="text-xs leading-snug text-text-caption">
                  Coaching appears from the customer’s questions (live captions
                  → transcript). Your own speech is ignored. Use Ask below
                  anytime.
                </p>
              ) : null}
            </section>

            {fitGaps.length > 0 ? (
              <section className="space-y-3">
                <h2 className="text-sm font-semibold text-text-primary">
                  Fit / gap
                </h2>
                <ul className="space-y-2 text-xs leading-snug text-text-primary">
                  {fitGaps.map((g, i) => (
                    <li key={`${g.area}-${i}`}>
                      <span className="font-medium capitalize">{g.status}</span>
                      {" · "}
                      {g.area}
                      {g.note ? (
                        <span className="text-text-caption"> — {g.note}</span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            {nextAction ? (
              <section className="space-y-2 rounded-lg border border-border-default bg-subtle/40 p-3">
                <h2 className="text-xs font-semibold text-text-secondary">
                  Next best action
                </h2>
                <p className="text-sm leading-6 text-text-primary">{nextAction.detail}</p>
                <button
                  type="button"
                  disabled={actionBusy || actionDone}
                  onClick={() => void runNextAction()}
                  className="h-8 rounded-lg bg-neutral-950 px-3 text-xs font-semibold text-white disabled:opacity-60"
                >
                  {actionDone
                    ? doneActionLabel(nextAction.kind)
                    : actionBusy
                      ? "Working…"
                      : nextAction.label}
                </button>
                {actionError ? (
                  <p className="text-xs text-red-600">{actionError}</p>
                ) : null}
              </section>
            ) : null}
          </div>

          <button
            type="button"
            onClick={() => setPage("ask")}
            className="mt-3 pt-1 text-left text-[11px] font-semibold text-text-secondary"
          >
            Ask about lead, product →
          </button>
        </>
      )}

      <span className="sr-only">{contactId}</span>
    </div>
  );
}
