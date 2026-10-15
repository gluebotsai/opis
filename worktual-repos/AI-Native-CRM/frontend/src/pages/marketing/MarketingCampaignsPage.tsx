import { Activity } from "lucide-react";
import { MarketingModulePage } from "@/components/marketing/MarketingModulePage";
import { AgentModuleShell } from "@/components/coworker/AgentModuleShell";
import { TONE_ACCENT } from "@/lib/ui-tones";

export function MarketingCampaignsPage() {
  const workspace = (
    <MarketingModulePage
      title="Campaign monitoring"
      description="Live, scheduled, and past campaigns for your branch."
      icon={Activity}
    >
      <div className="mb-4 flex gap-1 rounded-lg border border-border-default bg-surface p-1">
        {["Live", "Scheduled", "Past"].map((tab, i) => (
          <span
            key={tab}
            className={
              i === 0
                ? `rounded-md px-4 py-2 text-sm font-medium ${TONE_ACCENT}`
                : "rounded-md px-4 py-2 text-sm text-text-caption"
            }
          >
            {tab}
          </span>
        ))}
      </div>
      <div className="rounded-xl border border-dashed border-border-default bg-surface px-6 py-12 text-center">
        <p className="text-sm font-medium text-text-primary">
          No live campaigns yet
        </p>
        <p className="mt-1 text-sm text-text-caption">
          Campaigns from campaign_db will appear here for your tenant.
        </p>
      </div>
    </MarketingModulePage>
  );

  return (
    <AgentModuleShell
      moduleId="marketing"
      title="Campaign monitoring"
      welcome="I'm your **marketing agent**. Ask me about live, scheduled, or past campaigns — the campaign list stays fully usable on the right."
      chips={[
        {
          id: "chip-new-campaign",
          label: "Create a new campaign",
          prompt: "Help me create a new marketing campaign",
        },
      ]}
      surface="list"
      workspace={workspace}
    />
  );
}
