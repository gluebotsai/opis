/**
 * Start a create-campaign chat draft, optionally seeded from library selections.
 */

import {
  createEmptyDraft,
  ensureAgentSessionShell,
  ensureDraftOnServer,
  isDraftCommittable,
  upsertCampaignDraft,
  type CampaignChatDraft,
} from "@/lib/campaign-drafts";
import { bumpTemplateUsedCount } from "@/lib/campaign-templates";
import { toAgentChannelId } from "@/lib/campaign-channels";
import {
  buildGalleryImagesAcknowledgeSnippet,
  listSelectedGalleryImages,
} from "@/lib/selected-gallery-images";
import {
  buildLibraryAcknowledgeMessage,
  listSelectedTemplates,
} from "@/lib/selected-campaign-templates";
import type { CampaignTemplate } from "@/lib/campaign-templates";

/** Create hub with the drafts panel active — default back target from draft chat. */
export const CREATE_CAMPAIGN_DRAFTS_HREF = "/campaigns/create?tool=drafts";

/** WhatsApp template approvals — separate Create-campaign surface. */
export const CREATE_CAMPAIGN_WHATSAPP_HREF = "/campaigns/create/whatsapp";

function libraryTimelineFromTemplates(templates: CampaignTemplate[]) {
  const now = new Date().toISOString();
  const cards = templates
    .map((t) => {
      const channel = toAgentChannelId(t.primaryChannel);
      if (!channel || !t.fields || typeof t.fields !== "object") return null;
      return {
        template_id: t.id,
        channel,
        fields: t.fields,
        how_it_works: t.flowSteps?.join(" → ") || undefined,
      };
    })
    .filter((c): c is NonNullable<typeof c> => Boolean(c));
  if (!cards.length) return undefined;
  return [
    {
      id: crypto.randomUUID(),
      afterMessageIndex: 0,
      createdAt: now,
      cards,
    },
  ];
}

export function startCreateCampaignChat(options: {
  chatBasePath?: string;
  seed?: Partial<CampaignChatDraft>;
  /** When true (default), attach current library selections if no custom seed. */
  useLibrarySelection?: boolean;
}): CampaignChatDraft {
  const seed = options.seed;
  const useLibrary = options.useLibrarySelection !== false;
  const selected = useLibrary && !seed ? listSelectedTemplates() : [];
  const galleryImages =
    useLibrary && !seed ? listSelectedGalleryImages() : [];
  const hasHandoff = selected.length > 0 || galleryImages.length > 0;

  const now = new Date().toISOString();
  const acknowledgeText = buildLibraryAcknowledgeMessage(
    selected,
    buildGalleryImagesAcknowledgeSnippet(galleryImages),
  );
  const librarySeed =
    hasHandoff
      ? {
          status: "drafting" as const,
          dirty: true,
          libraryRun: selected.length > 0,
          usedLibraryTemplateIds: selected.map((t) => t.id),
          channels: [
            ...new Set(
              selected.flatMap((t) =>
                (t.channels || []).length ? t.channels : [t.primaryChannel],
              ),
            ),
          ],
          timelineTemplates: libraryTimelineFromTemplates(selected),
          ...(acknowledgeText.trim()
            ? {
                messages: [
                  {
                    id: crypto.randomUUID(),
                    role: "assistant" as const,
                    text: acknowledgeText,
                    createdAt: now,
                  },
                ],
              }
            : {}),
        }
      : null;

  const draft = createEmptyDraft({
    ...librarySeed,
    ...seed,
    ...(librarySeed && !seed?.usedLibraryTemplateIds
      ? { usedLibraryTemplateIds: librarySeed.usedLibraryTemplateIds }
      : {}),
    ...(librarySeed?.libraryRun ||
    seed?.usedLibraryTemplateIds?.length ||
    seed?.libraryRun
      ? { libraryRun: true }
      : {}),
  });

  if (selected.length > 0) {
    for (const t of selected) void bumpTemplateUsedCount(t.id);
  }

  upsertCampaignDraft(draft);
  void ensureAgentSessionShell(draft.id).catch(() => {
    /* offline — agents join will get-or-create later */
  });
  if (isDraftCommittable(draft)) {
    void ensureDraftOnServer(draft).catch(() => {
      /* offline / API — local cache + agent join still work */
    });
  }

  return draft;
}

export function chatPathForDraft(
  draftId: string,
  chatBasePath = "/campaigns/create",
): string {
  return `${chatBasePath}/${draftId}`;
}

/** Route from Drafts — approved WhatsApp mirror opens the dedicated run workspace. */
export function draftOpenPath(
  draft: { id: string; whatsappApprovedTemplateId?: string },
  chatBasePath = "/campaigns/create",
): string {
  const tid = String(draft.whatsappApprovedTemplateId || "").trim();
  if (tid) {
    return `/campaigns/create/whatsapp/approved/${encodeURIComponent(tid)}`;
  }
  return chatPathForDraft(draft.id, chatBasePath);
}
