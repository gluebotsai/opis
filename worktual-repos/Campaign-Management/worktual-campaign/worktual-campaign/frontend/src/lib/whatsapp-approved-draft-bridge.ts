/**
 * Mirror approved WhatsApp agent chat (wa-approved-*) into create_campaign drafts
 * without changing the whatsapp_approved socket session.
 */

import {
  campaignTemplateFromRegulatedWhatsApp,
} from "@/lib/start-campaign-from-whatsapp-template";
import {
  createEmptyDraft,
  ensureDraftOnServer,
  getCampaignDraft,
  markDraftLaunched,
  upsertCampaignDraft,
  type CampaignChatDraft,
  type CampaignDraftStatus,
  type ChatMessage,
} from "@/lib/campaign-drafts";
import type { RegulatedTemplateDto } from "@/services/regulatedTemplates.api";

export function whatsappApprovedDraftId(templateId: string): string {
  return `wa-draft-${String(templateId || "").trim()}`;
}

export function whatsappApprovedAgentSessionId(templateId: string): string {
  return `wa-approved-${String(templateId || "").trim()}`;
}

function buttonsToFields(raw: string) {
  return String(raw || "")
    .split(/\n+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((label) => ({ label }));
}

function timelineFromTemplate(row: RegulatedTemplateDto) {
  const now = new Date().toISOString();
  const catalog = campaignTemplateFromRegulatedWhatsApp(row);
  return {
    usedLibraryTemplateIds: [catalog.id],
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
              buttons: buttonsToFields(row.buttons),
              language: row.language,
              category: row.category,
              meta_approved: true,
            },
            how_it_works: "Approved Meta WhatsApp template run.",
          },
        ],
      },
    ],
  };
}

export function buildApprovedWhatsAppMirrorDraft(options: {
  template: RegulatedTemplateDto;
  messages: Array<{ id: string; role: "user" | "assistant"; text: string; createdAt?: string }>;
  status?: CampaignDraftStatus;
  launchedAt?: string | null;
  linkedCampaignId?: string | null;
}): CampaignChatDraft {
  const { template, messages, status, launchedAt, linkedCampaignId } = options;
  const templateId = template.id;
  const now = new Date().toISOString();
  const existing = getCampaignDraft(whatsappApprovedDraftId(templateId));
  const chatMessages: ChatMessage[] = messages.map((m) => ({
    id: m.id,
    role: m.role,
    text: m.text,
    createdAt: m.createdAt || now,
  }));
  const lastMsgAt =
    chatMessages.length > 0
      ? chatMessages[chatMessages.length - 1]?.createdAt || now
      : now;

  const name =
    String(template.campaignName || "").trim() ||
    String(template.name || "").trim() ||
    existing?.name ||
    "";

  const base = createEmptyDraft({
    id: whatsappApprovedDraftId(templateId),
    name,
    goal: template.goal || existing?.goal || "Not set yet",
    objective: template.objective || existing?.objective,
    channels: ["whatsapp"],
    audience: existing?.audience || "Not set yet",
    schedule: existing?.schedule || "Not set yet",
    status: status || existing?.status || "drafting",
    dirty: true,
    autoSaveOnLeave: true,
    whatsappApprovedTemplateId: templateId,
    whatsappApprovedAgentSessionId: whatsappApprovedAgentSessionId(templateId),
    linkedCampaignId:
      linkedCampaignId ||
      existing?.linkedCampaignId ||
      undefined,
    messages: chatMessages.length ? chatMessages : existing?.messages || [],
    launchedAt: launchedAt ?? existing?.launchedAt ?? null,
    createdAt: existing?.createdAt || now,
    updatedAt: lastMsgAt,
    pinned: existing?.pinned,
    ...(existing?.timelineTemplates?.length
      ? {
          usedLibraryTemplateIds: existing.usedLibraryTemplateIds,
          timelineTemplates: existing.timelineTemplates,
        }
      : timelineFromTemplate(template)),
  });

  return base;
}

export async function syncApprovedWhatsAppMirrorDraft(options: {
  template: RegulatedTemplateDto;
  messages: Array<{ id: string; role: "user" | "assistant"; text: string; createdAt?: string }>;
  status?: CampaignDraftStatus;
  launchedAs?: "scheduled" | "live";
  linkedCampaignId?: string | null;
}): Promise<void> {
  let draft = buildApprovedWhatsAppMirrorDraft({
    template: options.template,
    messages: options.messages,
    status: options.status,
    linkedCampaignId: options.linkedCampaignId,
  });
  if (
    options.launchedAs &&
    draft.status !== "scheduled" &&
    draft.status !== "live" &&
    draft.status !== "completed" &&
    draft.status !== "cancelled"
  ) {
    draft = markDraftLaunched(draft, options.launchedAs);
  }
  upsertCampaignDraft(draft);
  await ensureDraftOnServer(draft);
}
