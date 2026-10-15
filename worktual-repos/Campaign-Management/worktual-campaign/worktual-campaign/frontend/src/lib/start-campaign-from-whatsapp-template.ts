/**
 * Start create-campaign from an approved WhatsApp regulated (Meta) template.
 */

import {
  createEmptyDraft,
  ensureDraftOnServer,
  type CampaignChatDraft,
} from "@/lib/campaign-drafts";
import {
  createCampaignTemplate,
  upsertCampaignTemplate,
  type CampaignTemplate,
} from "@/lib/campaign-templates";
import { selectTemplateForChannel } from "@/lib/selected-campaign-templates";
import { chatPathForDraft } from "@/lib/start-create-campaign-chat";
import type { RegulatedTemplateDto } from "@/services/regulatedTemplates.api";

export function campaignTemplateFromRegulatedWhatsApp(
  row: RegulatedTemplateDto,
): CampaignTemplate {
  const id = `regulated-wa-${row.id}`;
  const now = new Date().toISOString();
  const existingShape = createCampaignTemplate({
    id,
    name: row.name,
    description: `Approved WhatsApp template (${row.language || "en"})`,
    goal: "Engagement",
    primaryChannel: "whatsapp",
    externalTemplateId: row.providerTemplateId || row.externalId || row.name,
    channels: ["WhatsApp"],
    audience: "Audience with WhatsApp consent",
    flowSteps: [
      "Audience enters campaign",
      "Send approved WhatsApp template",
    ],
    starterMessage: `We'll run your approved WhatsApp template “${row.name}”. I'll ask a few campaign questions (audience, schedule, confirm) then launch.`,
    approvalStatus: "approved",
    bodyPreview: row.body || row.header || row.name,
    preview: {
      kind: "wa_text",
      visualKey: "announce",
      headline: row.header || row.name,
      body: row.body || "",
      cta: row.buttons.split("\n").map((s) => s.trim()).filter(Boolean)[0],
    },
    createdAt: now,
    updatedAt: now,
  });
  upsertCampaignTemplate(existingShape);
  return existingShape;
}

export function startCampaignFromApprovedWhatsApp(
  row: RegulatedTemplateDto,
): { draft: CampaignChatDraft; path: string } {
  const catalog = campaignTemplateFromRegulatedWhatsApp(row);
  selectTemplateForChannel(catalog);

  const now = new Date().toISOString();
  const buttons = row.buttons
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((label) => ({ label }));

  const draft = createEmptyDraft({
    name: "",
    goal: "",
    channels: ["whatsapp"],
    audience: "",
    status: "drafting",
    dirty: true,
    autoSaveOnLeave: true,
    usedLibraryTemplateIds: [catalog.id],
    messages: [
      {
        id: crypto.randomUUID(),
        role: "assistant",
        text:
          `You're using approved WhatsApp template “${row.name}”. ` +
          `I'll ask campaign questions on this side — audience, timing, and confirm — then we can launch. ` +
          `The selected template stays visible on the overview.`,
        createdAt: now,
      },
    ],
    timelineTemplates: [
      {
        id: crypto.randomUUID(),
        afterMessageIndex: 0,
        createdAt: now,
        cards: [
          {
            template_id: row.providerTemplateId || row.name,
            channel: "whatsapp",
            fields: {
              name: row.name,
              header: row.header,
              body: row.body,
              footer: row.footer,
              buttons,
              language: row.language,
              category: row.category,
              meta_approved: true,
            },
            how_it_works:
              "Approved Meta WhatsApp template selected from Template Library.",
          },
        ],
      },
    ],
  });

  void ensureDraftOnServer(draft).catch(() => {});
  return { draft, path: chatPathForDraft(draft.id, "/campaigns/create") };
}
