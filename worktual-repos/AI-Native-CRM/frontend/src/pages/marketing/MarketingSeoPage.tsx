import { AgentModuleShell } from "@/components/coworker/AgentModuleShell";
import { ContentMarketingWorkspace } from "@/components/marketing/ContentMarketingWorkspace";

export function MarketingSeoPage() {
  return (
    <AgentModuleShell
      moduleId="marketing"
      title="Your Digital Marketing Agent"
      welcome="I'm your **Digital Marketing agent**. Research keywords (LLM estimates until Semrush is on), then write SEO content and LinkedIn / Facebook / Instagram posts from that research."
      hideWorkspaceHeader
      chips={[
        {
          id: "chip-keywords",
          label: "Research keywords",
          prompt:
            "Research keywords for conversational chatbots for businesses. Call seo_research_keywords. Use the tool rows; do not invent extra volumes in chat.",
        },
        {
          id: "chip-content",
          label: "Write content",
          prompt:
            "Using the latest keyword_query_id from seo_research_keywords, write an SEO blog about conversational chatbots and save it with seo_save_generated_content.",
        },
        {
          id: "chip-social",
          label: "Generate posts",
          prompt:
            "Repurpose the latest saved Digital Marketing content into LinkedIn, Facebook, and Instagram posts with seo_repurpose_social. Do not call Semrush.",
        },
      ]}
      surface="list"
      workspace={<ContentMarketingWorkspace />}
    />
  );
}
