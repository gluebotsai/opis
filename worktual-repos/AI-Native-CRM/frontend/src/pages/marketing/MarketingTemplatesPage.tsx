import { TemplateLibraryClient } from "@/components/marketing/TemplateLibraryClient";
import { AgentModuleShell } from "@/components/coworker/AgentModuleShell";

export function MarketingTemplatesPage() {
  return (
    <AgentModuleShell
      moduleId="marketing"
      title="Templates"
      welcome="I'm your **marketing agent**. Ask me to find a template or start a new campaign from one — the template library stays fully usable on the right."
      chips={[
        {
          id: "chip-new-campaign",
          label: "Create a new campaign",
          prompt: "Help me create a new marketing campaign from a template",
        },
      ]}
      surface="list"
      workspace={<TemplateLibraryClient createBasePath="/marketing/create" />}
    />
  );
}
