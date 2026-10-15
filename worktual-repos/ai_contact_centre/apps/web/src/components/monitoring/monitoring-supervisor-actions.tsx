import { Mic, MicOff } from "lucide-react";

import { listenToLiveConversation, setSupervisorMonitorMode, setSupervisorMonitorMuted, stopSupervisorListen, useSupervisorListen } from "@/features/voice/supervisor-listen";
import { cn } from "@/lib/utils";

const actionButtonClass =
  "cursor-pointer rounded-lg border-[0.6px] px-3 py-1.5 text-xs font-medium transition-colors disabled:pointer-events-none disabled:opacity-50";

function actionTone(active: boolean): string {
  return active
    ? "border-neutral-900 bg-neutral-900 text-white hover:bg-neutral-800"
    : "border-[#bfbfbf] bg-white text-neutral-700 hover:border-neutral-400 hover:bg-neutral-100 hover:text-neutral-900";
}

export function MonitoringSupervisorActions({
  conversationId,
  channel,
  watchOnly = false,
}: {
  conversationId: string;
  channel: string;
  /** Opened from a sentiment alert: listen only, no whisper or barge. */
  watchOnly?: boolean;
}) {
  const listen = useSupervisorListen();
  const voice = channel === "voice" || channel === "call" || channel === "phone";
  if (!voice) return null;
  const onThisCall =
    voice &&
    listen.conversationId === conversationId &&
    (listen.phase === "listening" || listen.phase === "starting");
  const canSwitch = onThisCall && listen.phase === "listening";

  return (
    <div className="space-y-2 border-t-[0.6px] border-[#bfbfbf] pt-3">
      <p className="text-[10px] font-medium uppercase tracking-wide text-neutral-600">
        Supervisor actions
      </p>

      <div className="flex flex-wrap gap-2">
        {voice ? (
          onThisCall ? (
            <button
              type="button"
              disabled={listen.phase === "starting"}
              onClick={() => void stopSupervisorListen()}
              className={cn(actionButtonClass, actionTone(false))}
            >
              {listen.phase === "starting" ? "Listening…" : "Leave"}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void listenToLiveConversation(conversationId)}
              className={cn(actionButtonClass, actionTone(false))}
            >
              Listen
            </button>
          )
        ) : null}
        {watchOnly ? null : (
          <MonitorModeButton
            label="Whisper"
            active={canSwitch && listen.mode === "whisper"}
            disabled={!canSwitch}
            onClick={() => void setSupervisorMonitorMode("whisper")}
          />
        )}
        {watchOnly ? null : (
          <MonitorModeButton
            label="Barge"
            active={canSwitch && listen.mode === "barge"}
            disabled={!canSwitch}
            onClick={() => void setSupervisorMonitorMode("barge")}
          />
        )}
        {!watchOnly && canSwitch && (listen.mode === "whisper" || listen.mode === "barge") ? (
          <button
            type="button"
            onClick={() => setSupervisorMonitorMuted(!listen.muted)}
            aria-label={listen.muted ? "Unmute" : "Mute"}
            className={cn(
              "inline-flex size-8 cursor-pointer items-center justify-center rounded-lg border-[0.6px] transition-colors",
              actionTone(listen.muted),
            )}
          >
            {listen.muted ? (
              <MicOff className="size-[18px]" strokeWidth={2.25} />
            ) : (
              <Mic className="size-[18px]" strokeWidth={2.25} />
            )}
          </button>
        ) : null}
      </div>
      {voice && listen.error ? <p className="text-xs text-red-600">{listen.error}</p> : null}
    </div>
  );
}

function MonitorModeButton({
  label,
  active,
  disabled,
  onClick,
}: {
  label: string;
  active: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(actionButtonClass, actionTone(active))}
    >
      {label}
    </button>
  );
}
