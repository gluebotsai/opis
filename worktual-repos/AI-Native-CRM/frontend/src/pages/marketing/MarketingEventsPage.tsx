import { Radar } from "lucide-react";
import { MarketingModulePage } from "@/components/marketing/MarketingModulePage";
import { AgentModuleShell } from "@/components/coworker/AgentModuleShell";

export function MarketingEventsPage() {
  return (
    <AgentModuleShell
      moduleId="marketing"
      title="Events tracking"
      welcome="I'm your **marketing agent**. Ask me about forms, webinars, or coupon touchpoints — the events view stays fully usable on the right."
      chips={[
        {
          id: "chip-help",
          label: "What can you help with?",
          prompt: "What can you help me do with marketing events?",
        },
      ]}
      surface="list"
      workspace={
        <MarketingModulePage
          title="Events tracking"
          description="Track forms, webinars, coupons, and other campaign touchpoints."
          icon={Radar}
        />
      }
    />
  );
}
