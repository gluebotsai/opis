/**
 * Create-campaign draft bound to a recommendation card (run agent).
 */

import {
  getCampaignDraft,
  type CampaignChatDraft,
} from "@/lib/campaign-drafts";
import {
  getRecommendation,
  upsertRecommendation,
  type CampaignRecommendation,
} from "@/lib/campaign-recommendations-store";
import { isChannelParked } from "@/lib/campaign-channels";
import { startCreateCampaignChat } from "@/lib/start-create-campaign-chat";

export const REC_RUN_WELCOME =
  "This idea is on the right.\nDo you want to edit this recommendation, or run this campaign?";

export function ensureRecommendationRunDraft(
  card: CampaignRecommendation,
): CampaignChatDraft {
  const fresh = getRecommendation(card.id) || card;
  if (fresh.runDraftId) {
    const existing = getCampaignDraft(fresh.runDraftId);
    if (existing) return existing;
  }

  const channels = (fresh.channels || []).filter((ch) => !isChannelParked(ch));
  const welcome = {
    id: `rec-run-welcome-${fresh.id}`,
    role: "assistant" as const,
    text: REC_RUN_WELCOME,
    createdAt: new Date().toISOString(),
  };
  const draft = startCreateCampaignChat({
    useLibrarySelection: false,
    seed: {
      name: fresh.title,
      goal: fresh.goal,
      objective: fresh.objective,
      channels,
      audience: fresh.audience,
      schedule: fresh.timingLabel,
      status: "drafting",
      dirty: false,
      autoSaveOnLeave: true,
      messages: [welcome],
    },
  });

  const saved = getRecommendation(fresh.id) || fresh;
  upsertRecommendation({
    ...saved,
    runDraftId: draft.id,
  });
  return draft;
}
