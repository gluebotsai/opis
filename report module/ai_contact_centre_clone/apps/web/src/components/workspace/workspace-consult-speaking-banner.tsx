import { Mic, MicOff, Pause, Play } from "lucide-react";

import { shouldShowConsultSpeakingBanner } from "@/features/voice/sip-transfer";
import { holdOutboundCall, muteOutboundCall } from "@/features/voice/sip-ua";
import { useRemoteCustomerWaveform } from "@/features/voice/use-remote-customer-waveform";
import { useSipCallStatus } from "@/features/voice/use-sip-call-status";
import { cn } from "@/lib/utils";

import { WaveformBars } from "./workspace-voice-call-bar";

export function WorkspaceConsultSpeakingBanner() {
  const sip = useSipCallStatus();
  const visible = shouldShowConsultSpeakingBanner({
    consultState: sip.consultState,
    merged: sip.merged,
    transferConsultRole: sip.transferConsultRole,
    callState: sip.callState,
    secondaryConsultOnly: sip.secondaryConsultOnly,
  });
  const { levels, speaking } = useRemoteCustomerWaveform(visible);
  if (!visible) return null;

  const held = sip.transferConsultRole === "secondary" ? sip.held : sip.consultHeld;
  const peer = sip.consultName?.trim() || sip.consultExt || "the other agent";
  const half = Math.floor(levels.length / 2);
  const leftLevels = [...levels.slice(0, half)].reverse();
  const rightLevels = levels.slice(0, half);

  return (
    <div className="flex h-[38px] max-w-[28rem] items-center gap-2 rounded-full border-[0.6px] border-[#bfbfbf] bg-white px-2">
      <div className="flex h-7 w-24 shrink-0 items-center gap-1" aria-hidden>
        <WaveformBars levels={leftLevels} live speaking={speaking && !sip.muted && !held} />
        <span
          className={cn(
            "flex size-5 shrink-0 items-center justify-center rounded-full border-[0.6px] bg-white",
            speaking && !sip.muted && !held
              ? "border-emerald-400 text-emerald-600"
              : "border-[#bfbfbf] text-neutral-600",
          )}
        >
          <Mic className="size-3" strokeWidth={2.25} />
        </span>
        <WaveformBars levels={rightLevels} live speaking={speaking && !sip.muted && !held} />
      </div>
      <span className="min-w-0 truncate text-sm font-medium text-neutral-900">
        Speaking with {peer}
      </span>
      <button
        type="button"
        onClick={() => muteOutboundCall(!sip.muted)}
        className="inline-flex h-[30px] shrink-0 items-center gap-1 rounded-full border-[0.6px] border-[#bfbfbf] bg-white px-2.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
        aria-label={sip.muted ? "Unmute consult" : "Mute consult"}
      >
        {sip.muted ? <MicOff className="size-[18px]" /> : <Mic className="size-[18px]" />}
        {sip.muted ? "Unmute" : "Mute"}
      </button>
      <button
        type="button"
        onClick={() => holdOutboundCall(!held)}
        className={cn(
          "inline-flex h-[30px] shrink-0 items-center gap-1 rounded-full border-[0.6px] border-[#bfbfbf] bg-white px-2.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50",
          held && "border-amber-200 bg-amber-50 text-amber-800",
        )}
        aria-label={held ? "Resume consult" : "Hold consult"}
      >
        {held ? <Play className="size-[18px]" /> : <Pause className="size-[18px]" />}
        {held ? "Resume" : "Hold"}
      </button>
    </div>
  );
}
