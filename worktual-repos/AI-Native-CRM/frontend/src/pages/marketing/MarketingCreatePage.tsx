import { CreateCampaignLanding } from "@/components/marketing/CreateCampaignLanding";
import { AgentModuleShell } from "@/components/coworker/AgentModuleShell";

export function MarketingCreatePage() {
  return (
    <AgentModuleShell
      moduleId="marketing"
      title="Create campaign"
      welcome="I'm your **marketing agent**. Tell me what kind of campaign you want and I can point you to the right starting point — the landing options stay fully usable on the right."
      chips={[
        {
          id: "chip-new-campaign",
          label: "Create a new campaign",
          prompt: "Help me create a new marketing campaign",
        },
      ]}
      surface="list"
      workspace={
        <CreateCampaignLanding
          chatBasePath="/marketing/create"
          templatesHref="/marketing/templates"
        />
      }
    />
  );
}
