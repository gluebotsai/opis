import { ChevronDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { WorkspaceDialPadTrigger } from "@/components/workspace/workspace-dial-pad";
import { WorkspacePresenceNudges } from "@/components/workspace/workspace-presence-nudges";
import { type PresenceState } from "@/features/workspace/api";
import { useAgentPresence } from "@/features/workspace/use-agent-presence";
import { shouldLockAgentPresence } from "@/features/voice/sip-inbound";
import { shouldAutoOpenDialPad } from "@/features/voice/sip-outbound";
import { useSipCallStatus } from "@/features/voice/use-sip-call-status";
import { useVoiceConsultConnectedToast } from "@/features/voice/use-voice-consult-toast";
import { cn } from "@/lib/utils";

type WorkspaceToolbarProps = {
  availability?: "available" | "away" | "busy" | "after_contact_work";
  showNudges?: boolean;
};

const PRESENCE_OPTIONS: { label: string; state: PresenceState; dot: string }[] = [
  { label: "Ready", state: "ready", dot: "bg-emerald-500" },
  { label: "Not Ready", state: "not_ready", dot: "bg-neutral-400" },
  { label: "Busy", state: "busy", dot: "bg-red-500" },
  { label: "Away", state: "away", dot: "bg-amber-500" },
];

function presenceToAvailability(state: PresenceState): WorkspaceToolbarProps["availability"] {
  if (state === "ready") return "available";
  if (state === "away" || state === "not_ready" || state === "break") return "away";
  if (state === "after_contact_work") return "after_contact_work";
  return "busy";
}

function presenceLabel(state: PresenceState): string {
  if (state === "after_contact_work") return "After contact work";
  if (state === "break") return "Break";
  const option = PRESENCE_OPTIONS.find((item) => item.state === state);
  return option?.label ?? "Busy";
}

const DIAL_PAD_OPEN_KEY = "cc2-dial-pad-open";

export function WorkspaceToolbar({ availability = "busy", showNudges = false }: WorkspaceToolbarProps) {
  const { presenceState, menuOpen, setMenuOpen, setPresence } = useAgentPresence();
  const sip = useSipCallStatus();
  useVoiceConsultConnectedToast();
  const [dialPadOpen, setDialPadOpen] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.sessionStorage.getItem(DIAL_PAD_OPEN_KEY) === "1";
  });

  useEffect(() => {
    window.sessionStorage.setItem(DIAL_PAD_OPEN_KEY, dialPadOpen ? "1" : "0");
  }, [dialPadOpen]);
  const presenceMenuRef = useRef<HTMLDivElement>(null);

  const currentAvailability = presenceToAvailability(presenceState) ?? availability;
  const availabilityLabel = presenceLabel(presenceState);
  const presenceLocked = shouldLockAgentPresence({
    callState: sip.callState,
    awaitingDisposition: sip.awaitingDisposition,
    presenceState,
  });

  useEffect(() => {
    if (presenceLocked) setMenuOpen(false);
  }, [presenceLocked, setMenuOpen]);

  useEffect(() => {
    if (shouldAutoOpenDialPad(sip)) setDialPadOpen(true);
  }, [sip.callState, sip.direction]);

  useEffect(() => {
    if (!menuOpen) return;

    function handlePointerDown(event: MouseEvent) {
      if (presenceMenuRef.current && !presenceMenuRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setMenuOpen(false);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [menuOpen, setMenuOpen]);

  return (
    <>
      {showNudges ? (
        <WorkspacePresenceNudges presenceState={presenceState} setPresence={setPresence} />
      ) : null}
      <div className="relative flex shrink-0 items-center gap-2">
      <div ref={presenceMenuRef} className="relative">
      <Button
        variant="toolbar"
        disabled={presenceLocked}
        aria-label={presenceLocked ? `${availabilityLabel}; presence locked during call` : undefined}
        onClick={() => {
          setDialPadOpen(false);
          setMenuOpen((open) => !open);
        }}
      >
        <span
          className={cn(
            "size-2 rounded-full",
            currentAvailability === "available" && "bg-emerald-500",
            currentAvailability === "away" && "bg-amber-500",
            currentAvailability === "after_contact_work" && "bg-violet-500",
            currentAvailability === "busy" && "bg-red-500",
          )}
        />
        {availabilityLabel}
        <ChevronDown className="size-4 text-neutral-900" />
      </Button>
      {menuOpen ? (
        <div
          role="menu"
          className="absolute right-0 top-full z-20 mt-1 min-w-40 rounded-lg border-[0.6px] border-[#bfbfbf] bg-white p-1 shadow-lg"
        >
          {PRESENCE_OPTIONS.map((option) => {
            const busyDisabled = option.state === "busy";
            return (
            <button
              key={option.state}
              type="button"
              role="menuitem"
              disabled={busyDisabled}
              aria-disabled={busyDisabled || undefined}
              className={cn(
                "flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm",
                busyDisabled
                  ? "cursor-not-allowed text-neutral-400 opacity-50"
                  : "hover:bg-neutral-50",
              )}
              onClick={() => {
                if (busyDisabled) return;
                void setPresence(option.state);
              }}
            >
              <span
                className={cn(
                  "size-2 rounded-full",
                  option.dot,
                  busyDisabled && "opacity-50",
                )}
              />
              {option.label}
            </button>
            );
          })}
        </div>
      ) : null}
      </div>
      <WorkspaceDialPadTrigger
        open={dialPadOpen}
        onOpenChange={(open) => {
          setDialPadOpen(open);
          if (open) setMenuOpen(false);
        }}
      />
      </div>
    </>
  );
}
