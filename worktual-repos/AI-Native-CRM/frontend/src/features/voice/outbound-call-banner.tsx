import { useEffect, useState, useSyncExternalStore } from "react";
import { Mic, MicOff, Pause, PhoneOff, Play, X } from "lucide-react";
import {
  acceptIncomingOffer,
  dismissOutboundCallError,
  getOutboundCallState,
  hangupOutboundCall,
  holdOutboundCall,
  muteOutboundCall,
  rejectIncomingOffer,
  subscribeOutboundCall,
} from "@/features/voice/sip-ua";

function formatDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

export function OutboundCallBanner() {
  const call = useSyncExternalStore(
    subscribeOutboundCall,
    getOutboundCallState,
    getOutboundCallState,
  );
  const [now, setNow] = useState(() => Date.now());
  const live = call.phase !== "idle";
  const connected = call.phase === "active";

  useEffect(() => {
    if (!connected || !call.connectedAt) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [connected, call.connectedAt]);

  if (!live && !call.error) return null;

  const person = call.label || call.destination || "Call";
  const title = call.error
    ? person
    : call.incomingOffer
      ? `Incoming ${person}`
      : connected
        ? person
        : `Calling ${person}`;
  const status = call.error
    ? call.error
    : connected
      ? call.held
        ? "On hold"
        : "Connected"
      : null;

  return (
    <div
      className="pointer-events-none fixed top-4 right-4 z-[250] flex w-[min(100%-2rem,22rem)] justify-end"
      role="status"
      aria-live="polite"
    >
      <div className="pointer-events-auto w-full rounded-2xl border border-[#bfbfbf] bg-white p-3 shadow-lg">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-neutral-900">{title}</p>
            {status ? (
              <p className={`mt-0.5 text-xs ${call.error ? "text-red-600" : "text-neutral-600"}`}>
                {status}
                {connected && call.connectedAt
                  ? ` · ${formatDuration((now - call.connectedAt) / 1000)}`
                  : null}
                {connected && call.destination && call.label ? ` · ${call.destination}` : null}
              </p>
            ) : null}
          </div>
          {connected || call.incomingOffer ? null : call.error && !live ? (
            <button
              type="button"
              className="inline-flex size-8 shrink-0 items-center justify-center rounded-full text-neutral-500 hover:bg-neutral-100"
              aria-label="Dismiss"
              onClick={dismissOutboundCallError}
            >
              <X className="size-4" />
            </button>
          ) : (
            <button
              type="button"
              className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-neutral-900 text-white hover:bg-neutral-800"
              aria-label="Hang up"
              onClick={hangupOutboundCall}
            >
              <PhoneOff className="size-4" />
            </button>
          )}
        </div>
        {call.incomingOffer ? (
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={acceptIncomingOffer}
              className="inline-flex h-9 flex-1 items-center justify-center rounded-full bg-neutral-900 px-3 text-sm font-medium text-white hover:bg-neutral-800"
            >
              Accept
            </button>
            <button
              type="button"
              onClick={rejectIncomingOffer}
              className="inline-flex h-9 flex-1 items-center justify-center rounded-full border border-[#bfbfbf] bg-white px-3 text-sm font-medium text-neutral-800 hover:bg-neutral-50"
            >
              Reject
            </button>
          </div>
        ) : connected ? (
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => muteOutboundCall(!call.muted)}
              className={`inline-flex h-9 items-center gap-1.5 rounded-full border border-[#bfbfbf] bg-white px-3 text-sm font-medium text-neutral-700 hover:bg-neutral-50 ${
                call.muted ? "border-red-200 bg-red-50 text-red-700" : ""
              }`}
            >
              {call.muted ? <MicOff className="size-4" /> : <Mic className="size-4" />}
              {call.muted ? "Unmute" : "Mute"}
            </button>
            <button
              type="button"
              onClick={() => holdOutboundCall(!call.held)}
              className={`inline-flex h-9 items-center gap-1.5 rounded-full border border-[#bfbfbf] bg-white px-3 text-sm font-medium text-neutral-700 hover:bg-neutral-50 ${
                call.held ? "border-amber-200 bg-amber-50 text-amber-800" : ""
              }`}
            >
              {call.held ? <Play className="size-4" /> : <Pause className="size-4" />}
              {call.held ? "Resume" : "Hold"}
            </button>
            <button
              type="button"
              onClick={hangupOutboundCall}
              className="inline-flex h-9 items-center gap-1.5 rounded-full bg-neutral-900 px-3 text-sm font-medium text-white hover:bg-neutral-800"
            >
              <PhoneOff className="size-4" />
              Hang up
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
