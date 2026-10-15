import { ArrowRightLeft, GitMerge, Mic, MicOff, Pause, PhoneOff, Play, X } from "lucide-react";
import { useEffect, useState } from "react";

import {
  beginConsultTransferAction,
  cancelConsultTransfer,
  completeConsultMerge,
  completeConsultTransfer,
  failConsultTransferAction,
  hangupOutboundCall,
  holdOutboundCall,
  leaveConsultAsSecondary,
  leaveConsultConference,
  muteOutboundCall,
  prepareConsultMerge,
  requireVoiceDisposition,
} from "@/features/voice/sip-ua";
import {
  type VoiceTransferAction,
  TRANSFER_ACTION_TRANSFEREE_LEAVE,
  TRANSFER_ACTION_TRANSFEROR_CANCEL,
  TRANSFER_ACTION_TRANSFEROR_LEAVE,
  TRANSFER_ACTION_TRANSFEROR_MERGE,
  TRANSFER_ACTION_TRANSFEROR_TRANSFER,
  canShowVoiceConsultCompleteActions,
  canShowVoiceConsultLeave,
  isVoiceConsultRinging,
} from "@/features/voice/sip-transfer";
import { useSipCallStatus } from "@/features/voice/use-sip-call-status";
import { useRemoteCustomerWaveform } from "@/features/voice/use-remote-customer-waveform";
import { workspaceApi } from "@/features/workspace/api";
import type { WorkspaceConversation } from "@/features/workspace/types";
import { cn } from "@/lib/utils";

type WorkspaceVoiceCallBarProps = {
  conversation: WorkspaceConversation;
  onInviteTransfer?: () => void;
};

type VoiceCallState = {
  live: boolean;
  endedHere: boolean;
  audioLive: boolean;
  remoteEnded: boolean;
  muted: boolean;
  held: boolean;
  consultLabel: string | null;
  callState: "idle" | "dialing" | "ringing" | "active";
  connectedAt: number | null;
  endedAt: number | null;
};

function useVoiceCallState(conversationId: string): VoiceCallState {
  const sip = useSipCallStatus();
  const isThisCall = sip.conversationId === conversationId;
  const live =
    isThisCall &&
    (sip.callState === "dialing" || sip.callState === "ringing" || sip.callState === "active");
  return {
    live,
    endedHere: isThisCall && !live && (sip.awaitingDisposition || sip.remoteEnded),
    audioLive: live && sip.callState === "active" && !sip.held,
    remoteEnded: sip.remoteEnded,
    muted: sip.muted,
    held:
      isThisCall &&
      sip.transferConsultRole !== "secondary" &&
      sip.consultState !== "idle" &&
      !sip.merged
        ? sip.consultHeld
        : sip.held,
    consultLabel:
      isThisCall && sip.consultState !== "idle" && !sip.merged
        ? `Consulting ${sip.consultName?.trim() || sip.consultExt || "agent"}`
        : null,
    callState: sip.callState,
    connectedAt: sip.connectedAt,
    endedAt: sip.endedAt,
  };
}

export function formatLiveCallDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  if (hours > 0) {
    return [hours, minutes, remainder].map((part) => String(part).padStart(2, "0")).join(":");
  }
  return [minutes, remainder].map((part) => String(part).padStart(2, "0")).join(":");
}

export function WorkspaceVoiceWaveform({
  conversation,
  className,
}: WorkspaceVoiceCallBarProps & { className?: string }) {
  const call = useVoiceCallState(conversation.id);
  const { levels, speaking } = useRemoteCustomerWaveform(call.audioLive);

  if (!call.live && !call.endedHere) return null;

  const statusLabel = call.endedHere
    ? call.remoteEnded
      ? "Customer ended the call"
      : "Call ended"
    : call.consultLabel
      ? call.consultLabel
      : call.held
      ? "Call on hold"
      : call.callState !== "active"
        ? "Connecting customer"
        : speaking
          ? "Customer speaking"
          : "Customer listening";

  const half = Math.floor(levels.length / 2);
  const leftLevels = [...levels.slice(0, half)].reverse();
  const rightLevels = levels.slice(0, half);

  return (
    <div
      className={cn("flex h-9 w-[13.5rem] shrink-0 items-center gap-1.5", className)}
      title={statusLabel}
      role="img"
      aria-label={statusLabel}
    >
      <WaveformBars levels={leftLevels} live={call.audioLive} speaking={speaking} />
      <span
        className={cn(
          "flex size-5 shrink-0 items-center justify-center rounded-full border-[0.6px] bg-white",
          speaking && call.audioLive ? "border-emerald-400 text-emerald-600" : "border-[#bfbfbf] text-neutral-600",
        )}
      >
        <Mic className="size-3" strokeWidth={2.25} aria-hidden />
      </span>
      <WaveformBars levels={rightLevels} live={call.audioLive} speaking={speaking} />
    </div>
  );
}

export function WaveformBars({
  levels,
  live,
  speaking,
}: {
  levels: number[];
  live: boolean;
  speaking: boolean;
}) {
  return (
    <div className="flex h-7 min-w-0 flex-1 items-center gap-px overflow-hidden">
      {levels.map((level, index) => (
        <span
          key={index}
          className={cn(
            "min-w-px flex-1 rounded-full transition-[height,opacity] duration-150 ease-out",
            live ? "bg-emerald-500" : "bg-neutral-400",
          )}
          style={{
            height: `${speaking ? Math.max(4, level * 26) : 4}px`,
            opacity: live ? (speaking ? Math.max(0.55, 0.4 + level * 0.6) : 0.45) : 0.4,
          }}
        />
      ))}
    </div>
  );
}

export function WorkspaceVoiceCallTimer({ conversation }: WorkspaceVoiceCallBarProps) {
  const [now, setNow] = useState(() => Date.now());
  const call = useVoiceCallState(conversation.id);

  useEffect(() => {
    if (!call.connectedAt || call.endedAt) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [call.connectedAt, call.endedAt]);

  if (!call.live && !call.endedHere) return null;

  const elapsedSeconds = call.connectedAt
    ? ((call.endedAt ?? now) - call.connectedAt) / 1_000
    : 0;

  return (
    <span className="text-xl font-bold tabular-nums leading-none tracking-tight text-neutral-900 sm:text-2xl">
      {formatLiveCallDuration(elapsedSeconds)}
    </span>
  );
}

export function WorkspaceVoiceCallControls({
  conversation,
  onInviteTransfer,
}: WorkspaceVoiceCallBarProps) {
  const [transferActionPending, setTransferActionPending] = useState(false);
  const [transferActionError, setTransferActionError] = useState<string | null>(null);
  const call = useVoiceCallState(conversation.id);
  const sip = useSipCallStatus();
  const consultRinging = isVoiceConsultRinging(sip.consultState);
  const consultActive = canShowVoiceConsultCompleteActions(sip.consultState);
  const conferenceLeave = canShowVoiceConsultLeave({
    merged: sip.merged,
    transferConsultRole: sip.transferConsultRole,
  });

  function publish(action: "hold" | "unhold" | "mute" | "unmute") {
    void workspaceApi.controlVoiceCall(conversation.id, action).catch(() => undefined);
  }

  async function publishTransferAction(
    action: VoiceTransferAction,
    after?: () => void,
  ) {
    if (transferActionPending) return;
    setTransferActionPending(true);
    setTransferActionError(null);
    beginConsultTransferAction(action);
    try {
      if (
        action === TRANSFER_ACTION_TRANSFEROR_MERGE &&
        !(await prepareConsultMerge())
      ) {
        throw new Error("Both calls must be active before merging");
      }
      await workspaceApi.voiceTransferAction(conversation.id, action);
      after?.();
    } catch (error) {
      failConsultTransferAction(action);
      setTransferActionError(
        error instanceof Error ? error.message : "Unable to update the voice transfer",
      );
    } finally {
      setTransferActionPending(false);
    }
  }

  if (!call.live && !call.endedHere) {
    return (
      <p className="text-center text-sm text-neutral-600">
        Live audio is not connected in this tab.
      </p>
    );
  }

  if (!call.live) {
    return (
      <p className="text-center text-sm text-neutral-600">
        {call.remoteEnded ? "The customer ended the call." : "Call ended."}
      </p>
    );
  }

  return (
    <div className="flex flex-wrap items-center justify-center gap-2">
      <button
        type="button"
        onClick={() => {
          const next = !call.muted;
          muteOutboundCall(next);
          publish(next ? "mute" : "unmute");
        }}
        className={cn(
          "inline-flex h-[38px] items-center gap-1.5 rounded-full border-[0.6px] border-[#bfbfbf] bg-white px-4 text-sm font-medium text-neutral-700 hover:bg-neutral-50",
          call.muted && "border-red-200 bg-red-50 text-red-700",
        )}
      >
        {call.muted ? <MicOff className="size-[18px]" /> : <Mic className="size-[18px]" />}
        {call.muted ? "Unmute" : "Mute"}
      </button>
      <button
        type="button"
        onClick={() => {
          const next = !call.held;
          holdOutboundCall(next);
          publish(next ? "hold" : "unhold");
        }}
        className={cn(
          "inline-flex h-[38px] items-center gap-1.5 rounded-full border-[0.6px] border-[#bfbfbf] bg-white px-4 text-sm font-medium text-neutral-700 hover:bg-neutral-50",
          call.held && "border-amber-200 bg-amber-50 text-amber-800",
        )}
      >
        {call.held ? <Play className="size-[18px]" /> : <Pause className="size-[18px]" />}
        {call.held ? "Resume" : "Hold"}
      </button>
      {consultRinging || consultActive ? (
        <span className="w-full text-center text-xs text-neutral-600">
          {consultActive
            ? sip.merged
              ? `Conference with ${sip.consultName ?? "agent"}`
              : `Consulting ${sip.consultName ?? "agent"}`
            : `Ringing ${sip.consultName ?? "agent"}…`}
        </span>
      ) : null}
      {transferActionError ? (
        <p className="w-full text-center text-xs font-medium text-red-600" role="alert">
          {transferActionError}
        </p>
      ) : null}
      {consultRinging ? (
        <button
          type="button"
          disabled={transferActionPending}
          onClick={() => {
            void publishTransferAction(TRANSFER_ACTION_TRANSFEROR_CANCEL, () => {
              cancelConsultTransfer();
            });
          }}
          className="inline-flex h-[38px] items-center gap-1.5 rounded-full border-[0.6px] border-[#bfbfbf] bg-white px-4 text-sm font-medium text-neutral-700 hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <X className="size-[18px]" />
          Cancel invite
        </button>
      ) : null}
      {consultActive && !sip.merged ? (
        <>
          <button
            type="button"
            disabled={transferActionPending}
            onClick={() => {
              void publishTransferAction(TRANSFER_ACTION_TRANSFEROR_TRANSFER, () => {
                completeConsultTransfer();
              });
            }}
            className="inline-flex h-[38px] items-center gap-1.5 rounded-full border-[0.6px] border-[#bfbfbf] bg-white px-4 text-sm font-medium text-neutral-700 hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <ArrowRightLeft className="size-[18px]" />
            Transfer
          </button>
          <button
            type="button"
            disabled={transferActionPending}
            onClick={() => {
              void publishTransferAction(TRANSFER_ACTION_TRANSFEROR_MERGE, () => {
                completeConsultMerge();
              });
            }}
            className="inline-flex h-[38px] items-center gap-1.5 rounded-full border-[0.6px] border-[#bfbfbf] bg-white px-4 text-sm font-medium text-neutral-700 hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <GitMerge className="size-[18px]" />
            Merge
          </button>
        </>
      ) : null}
      {conferenceLeave ? (
        <button
          type="button"
          disabled={transferActionPending}
          onClick={() => {
            if (sip.transferConsultRole === "secondary") {
              void publishTransferAction(TRANSFER_ACTION_TRANSFEREE_LEAVE, () => {
                leaveConsultAsSecondary();
              });
              return;
            }
            void publishTransferAction(TRANSFER_ACTION_TRANSFEROR_LEAVE, () => {
              leaveConsultConference();
              requireVoiceDisposition(conversation.id, {
                transferred: true,
                completeTransfer: false,
              });
            });
          }}
          className="inline-flex h-[38px] items-center gap-1.5 rounded-full border-[0.6px] border-[#bfbfbf] bg-white px-4 text-sm font-medium text-neutral-700 hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-60"
        >
          Leave
        </button>
      ) : null}
      {!consultRinging && !consultActive && onInviteTransfer ? (
        <button
          type="button"
          onClick={onInviteTransfer}
          className="inline-flex h-[38px] items-center gap-1.5 rounded-full border-[0.6px] border-[#bfbfbf] bg-white px-4 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
        >
          <ArrowRightLeft className="size-[18px]" />
          Transfer
        </button>
      ) : null}
      <button
        type="button"
        disabled={transferActionPending}
        onClick={hangupOutboundCall}
        className="inline-flex h-[38px] items-center gap-1.5 rounded-full bg-neutral-900 px-4 text-sm font-medium text-white hover:bg-neutral-800"
      >
        <PhoneOff className="size-[18px]" />
        Hang up
      </button>
    </div>
  );
}
