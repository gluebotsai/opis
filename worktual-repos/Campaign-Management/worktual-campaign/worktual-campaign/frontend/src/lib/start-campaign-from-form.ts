/**
 * Start (or resume) create-campaign chat from a designed form.
 * Form stays draft until the campaign itself is launched.
 */

import {
  listCampaignDrafts,
  type CampaignChatDraft,
} from "@/lib/campaign-drafts";
import {
  chatPathForDraft,
  startCreateCampaignChat,
} from "@/lib/start-create-campaign-chat";
import {
  formPublicUrl,
  type OpportunityEvent,
} from "@/lib/opportunity-events-store";

export function findDraftByFormEventId(
  eventId: string,
): CampaignChatDraft | null {
  const id = eventId.trim();
  if (!id) return null;
  return (
    listCampaignDrafts().find((d) => d.formEventId === id) || null
  );
}

export function startCampaignFromFormEvent(
  event: OpportunityEvent,
  opts?: { seedUserOnJoin?: string },
): { draft: CampaignChatDraft; path: string; resumed: boolean } {
  const existing = findDraftByFormEventId(event.id);
  if (existing) {
    return {
      draft: existing,
      path: chatPathForDraft(existing.id, "/campaigns/create"),
      resumed: true,
    };
  }

  const publicUrl = event.publicSlug ? formPublicUrl(event.publicSlug) : "";
  const title = event.title.trim() || "Untitled form";
  const seedUserOnJoin = opts?.seedUserOnJoin?.trim();
  const draft = startCreateCampaignChat({
    chatBasePath: "/campaigns/create",
    useLibrarySelection: false,
    seed: {
      status: "drafting",
      dirty: true,
      autoSaveOnLeave: true,
      formEventId: event.id,
      formPublicUrl: publicUrl || undefined,
      formTitle: title,
      messages: [],
      ...(seedUserOnJoin ? { seedUserOnJoin } : {}),
    },
  });

  return {
    draft,
    path: chatPathForDraft(draft.id, "/campaigns/create"),
    resumed: false,
  };
}
