export const SEO_UI_EVENT = "worktual:seo-ui-refresh";
export const SEO_CUSTOMIZE_EVENT = "worktual:seo-customize";
export const SEO_AGENT_PROMPT_EVENT = "worktual:seo-agent-prompt";

export type SeoUiEventDetail = {
  seoProgress?: {
    stage?: string;
    label?: string;
    detail?: string | null;
  } | null;
  seoContent?: Record<string, unknown> | null;
  seoKeywords?: Record<string, unknown> | null;
  seoSocial?: Record<string, unknown> | null;
};

export type SeoCustomizeEventDetail = {
  contentId: string;
  title: string;
};

export type SeoAgentPromptDetail = {
  prompt: string;
  hideUser?: boolean;
};

export function askDigitalMarketingAgent(
  prompt: string,
  opts?: { hideUser?: boolean },
) {
  window.dispatchEvent(
    new CustomEvent<SeoAgentPromptDetail>(SEO_AGENT_PROMPT_EVENT, {
      detail: { prompt, hideUser: opts?.hideUser !== false },
    }),
  );
}
