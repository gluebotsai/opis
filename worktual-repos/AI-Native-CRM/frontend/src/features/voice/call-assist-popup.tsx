import { useEffect, useRef, useState, useSyncExternalStore, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, ArrowUp, Grid3x3, Mic, MicOff, Pause, PhoneOff, Play, Sparkles, X } from "lucide-react";
import {
  askCallAssist,
  callAssistEventsUrl,
  endCallAssist,
  executeCallAssistAction,
  startCallAssist,
  type AssistAction,
  type CallAssistResult,
  type CallAssistSession,
  type CallAssistSnapshot,
  type CallTranscriptChunk,
} from "@/services/callAssist";
import { notifyCallLogged } from "@/lib/call-logged-event";
import {
  acceptIncomingOffer,
  dismissOutboundCallError,
  getOutboundCallState,
  hangupOutboundCall,
  holdOutboundCall,
  muteOutboundCall,
  rejectIncomingOffer,
  sendOutboundDtmf,
  subscribeOutboundCall,
  type OutboundCallEndReason,
} from "@/features/voice/sip-ua";

const DTMF_KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "*", "0", "#"];

/** One definition for the in-call controls, so the row cannot drift out of line. */
const CALL_CONTROL =
  "inline-flex h-[52px] min-w-0 flex-col items-center justify-center gap-1 rounded-xl border text-center transition-colors active:scale-95";
const CALL_CONTROL_LABEL = "text-[11px] font-medium leading-none";

type ChatMessage = { role: "you" | "assist"; text: string; at: number };
type CoachNote = { query: string; text: string; at: number };

function sameQuestion(left: string, right: string): boolean {
  const a = left.trim().toLowerCase().replace(/\s+/g, " ");
  const b = right.trim().toLowerCase().replace(/\s+/g, " ");
  if (!a || !b) return false;
  return a === b || a.includes(b) || b.includes(a);
}

function anchorSeq(note: CoachNote, lines: CallTranscriptChunk[], destination: string | null): number | null {
  let seq: number | null = null;
  for (const line of lines) {
    if (!isCustomerLine(line, destination)) continue;
    if (sameQuestion(line.text, note.query)) seq = line.seq;
  }
  return seq;
}
type PanelPage = "live" | "ask";

function phoneTail(value: string | null | undefined): string {
  const digits = String(value ?? "").replace(/\D+/g, "");
  if (!digits) return "";
  return digits.length <= 10 ? digits : digits.slice(-10);
}

function isCustomerLine(chunk: CallTranscriptChunk, remoteNumber: string | null): boolean {
  if (chunk.isBot) return false;
  const speaker = phoneTail(chunk.speaker);
  const remote = phoneTail(remoteNumber);
  if (speaker && remote && speaker === remote) return true;
  if (speaker.length >= 7 && remote && speaker !== remote) return false;
  const label = String(chunk.speaker || "").toLowerCase();
  if (/\b(agent|bot|ivr|system|assistant|rep)\b/.test(label)) return false;
  return true;
}

function mergeLine(lines: CallTranscriptChunk[], chunk: CallTranscriptChunk): CallTranscriptChunk[] {
  if (!chunk.text?.trim() || lines.some((row) => row.seq === chunk.seq)) return lines;
  return [...lines, chunk].sort((a, b) => a.seq - b.seq);
}

function formatDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

function formatClock(at: number): string {
  return new Date(at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function YouBubble({ text, at }: { text: string; at?: number }) {
  return (
    <div className="ml-auto max-w-[85%]">
      <div className="rounded-2xl bg-[#f3f4f6] px-3.5 py-2.5 text-[13px] leading-snug text-neutral-800">{text}</div>
      {at ? <p className="mt-1 text-right text-[10px] text-neutral-400">{formatClock(at)}</p> : null}
    </div>
  );
}

function AiBubble({ text, at }: { text: string; at?: number }) {
  return (
    <div className="flex max-w-[92%] gap-2">
      <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-violet-50 text-violet-600">
        <Sparkles className="size-3.5" />
      </span>
      <div className="min-w-0">
        <p className="text-[11px] font-medium text-neutral-500">AI</p>
        <div className="mt-0.5 whitespace-pre-wrap rounded-2xl bg-[#f4f1ff] px-3.5 py-2.5 text-[13px] leading-snug text-neutral-900">
          {text}
        </div>
        {at ? <p className="mt-1 text-[10px] text-neutral-400">{formatClock(at)}</p> : null}
      </div>
    </div>
  );
}

function humanizeAssistError(reason: string | null | undefined): string {
  const code = (reason || "").trim();
  if (!code) return "Assist could not answer — try again.";
  switch (code) {
    case "empty_or_invalid_llm":
    case "ai_service_unavailable":
    case "llm_not_configured":
      return "AI briefly failed to answer — keep talking or Ask again.";
    default:
      if (/^[a-z0-9_]+$/i.test(code) && !code.includes(" ")) {
        return "Assist could not answer — try again.";
      }
      return code;
  }
}

function chatReply(result: CallAssistResult | null | undefined): string {
  return (
    (result?.talkTrack || "").trim() ||
    result?.suggestions?.find((item) => item.text?.trim())?.text.trim() ||
    humanizeAssistError(result?.reason)
  );
}

function doneActionLabel(kind: AssistAction["kind"]): string {
  if (kind === "schedule_meeting") return "Scheduled";
  if (kind === "send_case_study" || kind === "send_follow_up") return "Sent";
  return "Created";
}

function takeAction(result: CallAssistResult | null | undefined): AssistAction | null {
  const action = result?.action;
  if (action?.kind && action.detail?.trim()) return action;
  return null;
}

function hasReply(result: CallAssistResult): boolean {
  return Boolean(
    (result.talkTrack || "").trim() || result.suggestions?.some((item) => (item.text || "").trim()),
  );
}

function defaultPosition(): { x: number; y: number } {
  if (typeof window === "undefined") return { x: 16, y: 16 };
  return { x: Math.max(16, window.innerWidth - 400 - 16), y: 16 };
}

export function CallAssistPopup() {
  const call = useSyncExternalStore(subscribeOutboundCall, getOutboundCallState, getOutboundCallState);
  const [session, setSession] = useState<CallAssistSession | null>(null);
  const [startHint, setStartHint] = useState<string | null>(null);
  const [lines, setLines] = useState<CallTranscriptChunk[]>([]);
  const [coaching, setCoaching] = useState<CoachNote[]>([]);
  const [nextAction, setNextAction] = useState<AssistAction | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [actionDone, setActionDone] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [askChat, setAskChat] = useState<ChatMessage[]>([]);
  const [page, setPage] = useState<PanelPage>("live");
  const [askText, setAskText] = useState("");
  const [asking, setAsking] = useState(false);
  const [assistOpen, setAssistOpen] = useState(true);
  const [collapsed, setCollapsed] = useState(false);
  const [keypadOpen, setKeypadOpen] = useState(false);
  const [dtmfSent, setDtmfSent] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const [position, setPosition] = useState(defaultPosition);
  const phaseRef = useRef<typeof call.phase | null>(null);
  const sessionRef = useRef<string | null>(null);
  const startInFlight = useRef(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const askPending = useRef(false);

  const connected = call.phase === "active";
  const live = call.phase !== "idle";
  const activeSessionId = session?.sessionId;

  function pushAssist(result: CallAssistResult) {
    const text = chatReply(result);
    const query = (result.query || "").trim();
    if (!text.trim() || !hasReply(result)) return;
    setCoaching((current) => {
      const index = query
        ? current.findIndex((note) => sameQuestion(note.query, query))
        : current.findIndex((note) => note.text === text);
      const note = { query, text, at: Date.now() };
      if (index >= 0) {
        const next = [...current];
        next[index] = note;
        return next;
      }
      return [...current, note];
    });
  }

  useEffect(() => {
    if (!connected || !call.connectedAt) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [connected, call.connectedAt]);

  useEffect(() => {
    if (call.phase !== "active") return;
    const remoteNumber = call.destination?.trim() || "";
    if (!remoteNumber) {
      setStartHint("Waiting for the connected number…");
      return;
    }
    if (sessionRef.current) return;
    setCollapsed(false);
    setAssistOpen(true);
    setPage("live");

    let alive = true;
    const direction = call.direction === "inbound" ? "inbound" : "outbound";
    const connectedAt = call.connectedAt;
    const start = async () => {
      if (sessionRef.current || startInFlight.current) return;
      startInFlight.current = true;
      try {
        const result = await startCallAssist({
          remoteNumber,
          direction,
          connectedAt,
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        }).catch(() => null);
        if (!alive || sessionRef.current) return;
        if (!result || !result.ok) {
          setStartHint(
            result && "error" in result && result.error
              ? result.error
              : "Call assist did not start — retrying…",
          );
          return;
        }
        if (!result.open) {
          setStartHint(result.reason || "Call assist is not ready for this number yet.");
          return;
        }
        sessionRef.current = result.sessionId;
        setStartHint(null);
        setLines([]);
        setCoaching([]);
        setNextAction(null);
        setActionDone(false);
        setActionError(null);
        setAskChat([]);
        setPage("live");
        setSession({
          open: true,
          sessionId: result.sessionId,
          contactId: result.contactId,
          contactName: result.contactName,
          remoteDigits: result.remoteDigits,
        });
      } finally {
        startInFlight.current = false;
      }
    };
    void start();
    const retry = window.setInterval(() => {
      if (!sessionRef.current && !startInFlight.current) void start();
    }, 4000);
    return () => {
      alive = false;
      window.clearInterval(retry);
    };
  }, [call.phase, call.destination, call.direction, call.connectedAt]);

  useEffect(() => {
    const previous = phaseRef.current;
    phaseRef.current = call.phase;
    if (previous !== "active" || call.phase === "active") return;
    const sessionId = sessionRef.current;
    const reason: OutboundCallEndReason =
      call.endReason === "remote_bye" || call.endReason === "failed" ? call.endReason : "hangup";
    sessionRef.current = null;
    setSession(null);
    setStartHint(null);
    setLines([]);
    setCoaching([]);
    setNextAction(null);
    setActionDone(false);
    setActionError(null);
    setAskChat([]);
    setPage("live");
    setKeypadOpen(false);
    setDtmfSent("");
    if (!sessionId) return;
    void endCallAssist(sessionId, reason).catch(() =>
      endCallAssist(sessionId, reason).catch((error) => {
        console.error("[call-assist] end failed", error);
      }),
    );
  }, [call.phase, call.endReason]);

  useEffect(() => {
    if (!activeSessionId) return;
    const es = new EventSource(callAssistEventsUrl(activeSessionId), { withCredentials: true });
    const take = (event: MessageEvent, apply: (data: unknown) => void) => {
      try {
        apply(JSON.parse(event.data));
      } catch {
        /* ignore malformed events */
      }
    };
    const applyResult = (result: CallAssistResult | null | undefined) => {
      if (!result) return;
      const action = takeAction(result);
      if (action) {
        setNextAction((current) => {
          const same =
            current?.kind === action.kind &&
            current?.detail === action.detail &&
            current?.whenLocal === action.whenLocal;
          if (!same) {
            setActionDone(false);
            setActionError(null);
          }
          return action;
        });
      }
      if (!hasReply(result) || askPending.current) return;
      pushAssist(result);
    };
    es.addEventListener("snapshot", (event) => {
      take(event as MessageEvent, (data) => {
        const snapshot = data as CallAssistSnapshot;
        setLines(snapshot.chunks || []);
        if (snapshot.remoteDigits) {
          setSession((current) => {
            if (!current || current.sessionId !== activeSessionId) return current;
            const remoteDigits = snapshot.remoteDigits || current.remoteDigits;
            return remoteDigits === current.remoteDigits
              ? current
              : { ...current, remoteDigits };
          });
        }
        applyResult(snapshot.assist);
      });
    });
    es.addEventListener("chunk", (event) => {
      take(event as MessageEvent, (data) => {
        const row = data as CallTranscriptChunk & { type?: string };
        if (typeof row.seq !== "number" || !row.text?.trim()) return;
        setLines((current) => mergeLine(current, row));
      });
    });
    es.addEventListener("assist", (event) => {
      take(event as MessageEvent, (data) => {
        const payload = data as { result?: CallAssistResult };
        applyResult(payload.result);
      });
    });
    // The call activity is written before this event is published, so the
    // contact's timeline can refetch and show the call log straight away.
    es.addEventListener("ended", (event) => {
      take(event as MessageEvent, (data) => {
        const payload = data as { activityId?: string | null };
        notifyCallLogged(payload.activityId ?? null);
      });
    });
    return () => es.close();
  }, [activeSessionId]);

  useEffect(() => {
    const node = scrollRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, [lines, coaching, askChat, page, assistOpen, asking]);

  if (!live && !call.error) return null;

  const person = session?.contactName || call.label || call.destination || "Call";
  const title = call.error
    ? person
    : call.incomingOffer
      ? `Incoming ${person}`
      : connected
        ? person
        : `Calling ${person}`;
  const statusLine = call.error
    ? call.error
    : connected
      ? `${call.held ? "On hold" : "Connected"}${
          call.connectedAt ? ` · ${formatDuration((now - call.connectedAt) / 1000)}` : ""
        }${call.destination ? ` · ${call.destination}` : ""}`
      : call.incomingOffer
        ? "Incoming"
        : "Calling";
  const remoteMatch = session?.remoteDigits || call.destination;
  const customerLines = lines.filter((line) => isCustomerLine(line, remoteMatch));

  function onDragStart(event: ReactPointerEvent<HTMLElement>) {
    if ((event.target as HTMLElement).closest("button, input, a")) return;
    dragRef.current = { x: event.clientX, y: event.clientY, left: position.x, top: position.y };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function onDragMove(event: ReactPointerEvent<HTMLElement>) {
    const drag = dragRef.current;
    if (!drag) return;
    setPosition({
      x: Math.min(window.innerWidth - 120, Math.max(8, drag.left + event.clientX - drag.x)),
      y: Math.min(window.innerHeight - 80, Math.max(8, drag.top + event.clientY - drag.y)),
    });
  }

  function onDragEnd() {
    dragRef.current = null;
  }

  async function onAsk() {
    const query = askText.trim();
    if (!query || asking || !session) return;
    setAsking(true);
    askPending.current = true;
    setPage("ask");
    setAssistOpen(true);
    setAskChat((current) => [...current, { role: "you", text: query, at: Date.now() }]);
    setAskText("");
    const data = await askCallAssist(session.sessionId, query).catch(() => null);
    if (data && data.ok && data.result) {
      const action = takeAction(data.result);
      if (action) {
        setNextAction(action);
        setActionDone(false);
        setActionError(null);
      }
    }
    const reply =
      data && data.ok
        ? chatReply(data.result)
        : data && "error" in data
          ? data.error || "Assist could not answer — try again."
          : "Assist request failed — check API is running.";
    setAskChat((current) => [...current, { role: "assist", text: reply, at: Date.now() }]);
    askPending.current = false;
    setAsking(false);
  }

  async function runNextAction() {
    if (!nextAction || actionBusy || actionDone || !session) return;
    setActionBusy(true);
    setActionError(null);
    const data = await executeCallAssistAction(session.sessionId, nextAction).catch(() => null);
    setActionBusy(false);
    if (!data?.ok) {
      setActionError(
        data && "error" in data && data.error ? data.error : "Could not run that action.",
      );
      return;
    }
    setActionDone(true);
  }

  if (collapsed && !call.error) {
    return createPortal(
      <button
        type="button"
        onClick={() => setCollapsed(false)}
        className="fixed z-[250] inline-flex items-center gap-2 rounded-full border border-[#e5e5e5] bg-white px-3 py-2 text-sm font-medium text-neutral-900 shadow-lg"
        style={{ left: position.x, top: position.y }}
      >
        <span className="size-1.5 rounded-full bg-emerald-500" />
        {person}
      </button>,
      document.body,
    );
  }

  return createPortal(
    <section
      className="fixed z-[250] flex w-[min(24rem,calc(100vw-1rem))] flex-col overflow-hidden rounded-2xl border border-[#e6e6e6] bg-white shadow-[0_12px_40px_rgba(0,0,0,0.12)]"
      style={{
        left: position.x,
        top: position.y,
        height: connected && assistOpen ? "min(40rem, calc(100vh - 2rem))" : "auto",
        maxHeight: `calc(100vh - ${position.y}px - 8px)`,
      }}
      aria-label="Call assist"
    >
      <header
        className="flex shrink-0 cursor-grab touch-none items-start justify-between gap-3 px-4 pt-4 active:cursor-grabbing"
        onPointerDown={onDragStart}
        onPointerMove={onDragMove}
        onPointerUp={onDragEnd}
        onPointerCancel={onDragEnd}
      >
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <p className="truncate text-[15px] font-semibold text-neutral-900">{title}</p>
            {connected && !call.error ? (
              <span className="inline-flex shrink-0 items-center gap-1.5 text-[12px] font-medium text-emerald-600">
                <span className="size-1.5 rounded-full bg-emerald-500" />
                Live
              </span>
            ) : null}
          </div>
          <p className={`mt-0.5 truncate text-xs ${call.error ? "text-red-600" : "text-neutral-500"}`}>{statusLine}</p>
        </div>
        {call.error && !live ? (
          <button
            type="button"
            className="inline-flex size-8 items-center justify-center rounded-full text-neutral-400 hover:bg-neutral-100"
            aria-label="Dismiss"
            onClick={dismissOutboundCallError}
          >
            <X className="size-4" />
          </button>
        ) : (
          <div className="flex shrink-0 items-center gap-1.5">
            {/* Dialing and ringing have no control row yet, so the only way to
                give up on the call has to live here. */}
            {live && !connected && !call.incomingOffer ? (
              <button
                type="button"
                className="inline-flex h-8 items-center gap-1.5 rounded-full bg-red-600 px-3 text-xs font-medium text-white hover:bg-red-700"
                aria-label="Hang up"
                onClick={hangupOutboundCall}
              >
                <PhoneOff className="size-3.5" />
                Hang up
              </button>
            ) : null}
            <button
              type="button"
              className="inline-flex size-8 items-center justify-center rounded-full text-neutral-400 hover:bg-neutral-100"
              aria-label="Hide call"
              onClick={() => setCollapsed(true)}
            >
              <X className="size-4" />
            </button>
          </div>
        )}
      </header>

      {call.incomingOffer ? (
        <div className="mt-3 flex shrink-0 gap-2 px-4 pb-4">
          <button
            type="button"
            onClick={acceptIncomingOffer}
            className="inline-flex h-9 flex-1 items-center justify-center rounded-full bg-neutral-900 text-sm font-medium text-white"
          >
            Accept
          </button>
          <button
            type="button"
            onClick={rejectIncomingOffer}
            className="inline-flex h-9 flex-1 items-center justify-center rounded-full border border-[#e5e5e5] text-sm font-medium"
          >
            Reject
          </button>
        </div>
      ) : connected ? (
        <div className="mt-3 grid shrink-0 grid-cols-4 gap-1.5 px-4">
          <button
            type="button"
            aria-pressed={call.muted}
            onClick={() => muteOutboundCall(!call.muted)}
            className={`${CALL_CONTROL} ${
              call.muted
                ? "border-red-200 bg-red-50 text-red-600"
                : "border-[#e5e5e5] bg-white text-neutral-700 hover:bg-neutral-50"
            }`}
          >
            {call.muted ? <MicOff className="size-[18px]" /> : <Mic className="size-[18px]" />}
            <span className={CALL_CONTROL_LABEL}>{call.muted ? "Unmute" : "Mute"}</span>
          </button>
          <button
            type="button"
            aria-pressed={call.held}
            onClick={() => holdOutboundCall(!call.held)}
            className={`${CALL_CONTROL} ${
              call.held
                ? "border-amber-200 bg-amber-50 text-amber-700"
                : "border-[#e5e5e5] bg-white text-neutral-700 hover:bg-neutral-50"
            }`}
          >
            {call.held ? <Play className="size-[18px]" /> : <Pause className="size-[18px]" />}
            <span className={CALL_CONTROL_LABEL}>{call.held ? "Resume" : "Hold"}</span>
          </button>
          <button
            type="button"
            aria-pressed={keypadOpen}
            aria-expanded={keypadOpen}
            onClick={() => setKeypadOpen((current) => !current)}
            className={`${CALL_CONTROL} ${
              keypadOpen
                ? "border-neutral-300 bg-neutral-100 text-neutral-900"
                : "border-[#e5e5e5] bg-white text-neutral-700 hover:bg-neutral-50"
            }`}
          >
            <Grid3x3 className="size-[18px]" />
            <span className={CALL_CONTROL_LABEL}>Keypad</span>
          </button>
          <button
            type="button"
            onClick={hangupOutboundCall}
            className={`${CALL_CONTROL} border-transparent bg-red-600 text-white hover:bg-red-700`}
          >
            <PhoneOff className="size-[18px]" />
            <span className={CALL_CONTROL_LABEL}>End</span>
          </button>
        </div>
      ) : (
        <div className="h-4" />
      )}

      {connected && keypadOpen ? (
        <div className="mt-3 shrink-0 px-4">
          {/* Digits go down the live call as RFC 4733 tones, for IVR menus and
              conference PINs. Nothing is dialed and nothing is logged. */}
          <div className="flex h-7 items-center justify-between gap-2">
            <p className="truncate font-mono text-sm tracking-widest text-neutral-900">
              {dtmfSent || <span className="font-sans text-xs text-neutral-400">Tones you send appear here</span>}
            </p>
            {dtmfSent ? (
              <button
                type="button"
                className="shrink-0 text-xs font-medium text-neutral-500 hover:text-neutral-900"
                onClick={() => setDtmfSent("")}
              >
                Clear
              </button>
            ) : null}
          </div>
          <div className="mt-1.5 grid grid-cols-3 gap-1.5">
            {DTMF_KEYS.map((key) => (
              <button
                key={key}
                type="button"
                aria-label={`Send ${key}`}
                className="h-10 rounded-xl border border-[#e5e5e5] bg-white text-base font-medium text-neutral-900 transition-colors hover:bg-neutral-50 active:scale-95"
                onClick={() => {
                  sendOutboundDtmf(key);
                  setDtmfSent((current) => `${current}${key}`.slice(-24));
                }}
              >
                {key}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {session && connected && page === "ask" ? (
        <>
          <div className="mt-4 flex shrink-0 items-center border-t border-[#f0f0f0] px-4 pt-3">
            <button
              type="button"
              onClick={() => setPage("live")}
              className="inline-flex items-center gap-1 text-[15px] font-semibold text-neutral-900"
            >
              <ArrowLeft className="size-4" />
              Back
            </button>
          </div>
          <div ref={scrollRef} className="mt-3 flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 pb-2">
            {askChat.length === 0 ? (
              <p className="m-auto max-w-[16rem] text-center text-xs leading-snug text-neutral-400">
                Type a question about the lead, product, or deal. The call transcript stays on the previous screen.
              </p>
            ) : (
              askChat.map((message, index) =>
                message.role === "you" ? (
                  <YouBubble key={`${message.at}-${index}`} text={message.text} at={message.at} />
                ) : (
                  <AiBubble key={`${message.at}-${index}`} text={message.text} at={message.at} />
                ),
              )
            )}
          </div>
          <div className="m-3 flex items-center gap-2 rounded-full border border-[#e5e5e5] bg-white py-1.5 pl-4 pr-1.5">
            <input
              value={askText}
              onChange={(event) => setAskText(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void onAsk();
              }}
              placeholder="Ask about this call..."
              disabled={asking}
              autoFocus
              className="h-8 min-w-0 flex-1 bg-transparent text-[13px] text-neutral-900 outline-none placeholder:text-neutral-400 disabled:opacity-60"
            />
            <button
              type="button"
              onClick={() => void onAsk()}
              disabled={asking || !askText.trim()}
              aria-label="Send"
              className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[#f3f4f6] text-neutral-700 hover:bg-neutral-200 disabled:opacity-50"
            >
              <ArrowUp className="size-4" />
            </button>
          </div>
        </>
      ) : null}

      {connected && page === "live" ? (
        <>
          <div className="mt-4 flex shrink-0 items-center justify-between border-t border-[#f0f0f0] px-4 pt-3">
            <p className="inline-flex items-center gap-1.5 text-sm font-semibold text-neutral-900">
              <Sparkles className="size-3.5 text-violet-500" />
              AI Sales Assist
            </p>
            <button
              type="button"
              className="inline-flex size-7 items-center justify-center rounded-full text-neutral-400 hover:bg-neutral-100"
              aria-label={assistOpen ? "Hide assist" : "Show assist"}
              onClick={() => setAssistOpen((open) => !open)}
            >
              <X className={`size-3.5 ${assistOpen ? "" : "rotate-45"}`} />
            </button>
          </div>
          {assistOpen ? (
            <>
              <div ref={scrollRef} className="mt-3 flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 pb-2">
                {customerLines.length === 0 ? (
                  <p className="text-xs leading-snug text-neutral-400">
                    {startHint || "Listening for the customer transcript…"}
                  </p>
                ) : (
                  customerLines.map((line) => {
                    const replies = coaching.filter(
                      (note) => anchorSeq(note, lines, remoteMatch) === line.seq,
                    );
                    return (
                      <div key={line.seq} className="space-y-3">
                        <YouBubble text={line.text} />
                        {replies.map((note) => (
                          <AiBubble key={`${line.seq}-${note.at}`} text={note.text} at={note.at} />
                        ))}
                      </div>
                    );
                  })
                )}
                {coaching
                  .filter((note) => anchorSeq(note, lines, remoteMatch) == null)
                  .map((note) => (
                    <AiBubble key={`loose-${note.at}`} text={note.text} at={note.at} />
                  ))}
                {nextAction ? (
                  <section className="space-y-2 rounded-xl border border-[#ececec] bg-[#fafafa] p-3">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
                      Next best action
                    </p>
                    <p className="text-[13px] leading-snug text-neutral-900">{nextAction.detail}</p>
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
                    {actionError ? <p className="text-xs text-red-600">{actionError}</p> : null}
                  </section>
                ) : null}
              </div>
              <div className="m-3 flex shrink-0 items-center gap-2 rounded-full border border-[#e5e5e5] bg-white py-1.5 pl-4 pr-1.5">
                <input
                  value={askText}
                  onChange={(event) => setAskText(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") void onAsk();
                  }}
                  placeholder="Ask about this call..."
                  disabled={asking || !session}
                  className="h-8 min-w-0 flex-1 bg-transparent text-[13px] text-neutral-900 outline-none placeholder:text-neutral-400 disabled:opacity-60"
                />
                <button
                  type="button"
                  onClick={() => void onAsk()}
                  disabled={asking || !askText.trim() || !session}
                  aria-label="Send"
                  className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[#f3f4f6] text-neutral-700 hover:bg-neutral-200 disabled:opacity-50"
                >
                  <ArrowUp className="size-4" />
                </button>
              </div>
            </>
          ) : (
            <div className="h-3" />
          )}
        </>
      ) : null}
    </section>,
    document.body,
  );
}
