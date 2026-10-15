import { ArrowLeftRight } from "lucide-react";

import { WaveformBars } from "@/components/workspace/workspace-voice-call-bar";
import { useMonitorListenWaveform } from "@/features/voice/use-remote-customer-waveform";
import { cn } from "@/lib/utils";

function partyInitial(name: string, fallback: string): string {
  const letter = name.trim().charAt(0).toUpperCase();
  return letter || fallback;
}

function displayLevels(levels: number[], count = 12): number[] {
  if (levels.length <= count) return levels;
  return Array.from({ length: count }, (_, index) => {
    const at = Math.floor((index * levels.length) / count);
    return levels[at] ?? 0;
  });
}

function SpeakingParty({
  name,
  initial,
  tone,
  levels,
  speaking,
}: {
  name: string;
  initial: string;
  tone: "customer" | "agent";
  levels: number[];
  speaking: boolean;
}) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <span
        className={cn(
          "flex size-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold",
          tone === "customer" ? "bg-violet-100 text-violet-700" : "bg-sky-100 text-sky-700",
        )}
      >
        {initial}
      </span>
      <div className="w-24 shrink-0">
        <p className="truncate text-sm font-semibold leading-5 text-neutral-900" title={name}>
          {name}
        </p>
        <p
          className={cn(
            "mt-0.5 flex items-center gap-1 text-xs leading-4",
            speaking ? "text-emerald-600" : "text-neutral-600",
          )}
        >
          <span
            className={cn("size-1.5 shrink-0 rounded-full", speaking ? "bg-emerald-500" : "bg-neutral-300")}
          />
          {speaking ? "Speaking" : "On call"}
        </p>
      </div>
      <div className="flex h-10 w-28 shrink-0 items-center">
        <WaveformBars levels={displayLevels(levels, 16)} live speaking={speaking} />
      </div>
    </div>
  );
}

/** Live voice drawer card. Each waveform follows that side of the listen audio. */
export function MonitoringListenSpeakingCard({
  customer,
  agentName,
}: {
  customer: string;
  agentName: string;
}) {
  const { customer: customerAudio, agent: agentAudio } = useMonitorListenWaveform(true);
  const customerName = customer.trim() || "Customer";
  const agent = agentName.trim() || "Agent";

  return (
    <div className="flex shrink-0 items-center justify-between rounded-xl border-[0.6px] border-[#bfbfbf] bg-white px-4 py-3">
      <SpeakingParty
        name={customerName}
        initial={partyInitial(customerName, "C")}
        tone="customer"
        levels={customerAudio.levels}
        speaking={customerAudio.speaking}
      />
      <div className="flex shrink-0 items-center gap-3 px-3">
        <span className="h-8 w-[0.6px] bg-[#bfbfbf]" />
        <ArrowLeftRight className="size-[18px] text-neutral-400" strokeWidth={2.25} />
        <span className="h-8 w-[0.6px] bg-[#bfbfbf]" />
      </div>
      <SpeakingParty
        name={agent}
        initial={partyInitial(agent, "A")}
        tone="agent"
        levels={agentAudio.levels}
        speaking={agentAudio.speaking}
      />
    </div>
  );
}
