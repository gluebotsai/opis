/**
 * Persist user-selected library templates (max one per channel) for create-campaign.
 */

import type { CampaignChannelId } from "@/lib/campaign-channels";
import { packStorageKey } from "@/lib/industry-packs";
import {
  getCampaignTemplate,
  type CampaignTemplate,
} from "@/lib/campaign-templates";

const STORAGE_KEY_BASE = "worktual.selectedCampaignTemplates.v1";

function storageKey() {
  return packStorageKey(STORAGE_KEY_BASE);
}

export type SelectedTemplateMap = Partial<
  Record<CampaignChannelId, string>
>;

function canUseStorage() {
  return typeof window !== "undefined" && typeof localStorage !== "undefined";
}

export function readSelectedTemplateIds(): SelectedTemplateMap {
  if (!canUseStorage()) return {};
  try {
    const raw = localStorage.getItem(storageKey());
    if (!raw) return {};
    const parsed = JSON.parse(raw) as SelectedTemplateMap;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function writeSelectedTemplateIds(map: SelectedTemplateMap): void {
  if (!canUseStorage()) return;
  localStorage.setItem(storageKey(), JSON.stringify(map));
}

export function listSelectedTemplates(): CampaignTemplate[] {
  const map = readSelectedTemplateIds();
  const out: CampaignTemplate[] = [];
  for (const id of Object.values(map)) {
    if (!id) continue;
    const t = getCampaignTemplate(id);
    if (t) out.push(t);
  }
  return out;
}

export function getSelectedTemplateIdForChannel(
  channel: CampaignChannelId,
): string | null {
  return readSelectedTemplateIds()[channel] ?? null;
}

export function selectTemplateForChannel(
  template: CampaignTemplate,
): SelectedTemplateMap {
  const map = { ...readSelectedTemplateIds() };
  map[template.primaryChannel] = template.id;
  writeSelectedTemplateIds(map);
  return map;
}

export function deselectTemplate(templateId: string): SelectedTemplateMap {
  const map = { ...readSelectedTemplateIds() };
  for (const [channel, id] of Object.entries(map)) {
    if (id === templateId) {
      delete map[channel as CampaignChannelId];
    }
  }
  writeSelectedTemplateIds(map);
  return map;
}

export function deselectChannel(channel: CampaignChannelId): SelectedTemplateMap {
  const map = { ...readSelectedTemplateIds() };
  delete map[channel];
  writeSelectedTemplateIds(map);
  return map;
}

export function clearSelectedTemplates(): void {
  writeSelectedTemplateIds({});
}

/** Remove specific template IDs from the selection map (others stay). */
export function deselectTemplates(templateIds: string[]): SelectedTemplateMap {
  const remove = new Set(templateIds.filter(Boolean));
  if (remove.size === 0) return readSelectedTemplateIds();
  const map = { ...readSelectedTemplateIds() };
  for (const [channel, id] of Object.entries(map)) {
    if (id && remove.has(id)) {
      delete map[channel as CampaignChannelId];
    }
  }
  writeSelectedTemplateIds(map);
  return map;
}

/**
 * Clear only the library templates that were attached to a campaign draft
 * (after save or launch).
 */
export function clearUsedLibraryTemplatesFromSelection(
  templateIds: string[] | undefined | null,
): SelectedTemplateMap {
  if (!templateIds?.length) return readSelectedTemplateIds();
  return deselectTemplates(templateIds);
}

/** Guidance text for create-campaign agent (format references). */
export function buildSelectedTemplatesGuidance(
  templates: CampaignTemplate[] = listSelectedTemplates(),
): string {
  if (templates.length === 0) {
    return "";
  }
  const lines = templates.map((t) => {
    const headline = t.preview?.headline ? ` Headline: ${t.preview.headline}.` : "";
    const cta = t.preview?.cta ? ` CTA: ${t.preview.cta}.` : "";
    return `- ${t.channels[0] || t.primaryChannel}: follow format of “${t.name}” (${t.description || "B2B marketing template"}).${headline}${cta} Preview: ${t.bodyPreview || "n/a"}`;
  });
  return [
    "Selected library templates are in force for this campaign.",
    "When generating channel templates, keep each selected format/structure and fill marketing content from the knowledge base.",
    ...lines,
  ].join("\n");
}

/** Local first assistant message when starting chat with library selections. */
export function buildLibraryAcknowledgeMessage(
  templates: CampaignTemplate[],
  galleryAckSnippet = "",
): string {
  if (templates.length === 0 && !galleryAckSnippet.trim()) return "";
  const names = templates
    .map((t) => `“${t.name}” (${t.channels[0] || t.primaryChannel})`)
    .join(", ");
  const templateLine =
    templates.length === 0
      ? ""
      : templates.length === 1
        ? `I’ll use your selected library template ${names} as the format reference when we create channel content.`
        : `I’ll use your selected library templates — ${names} — as format references when we create channel content for this campaign.`;
  const galleryLine = galleryAckSnippet.trim();
  const intro = [templateLine, galleryLine].filter(Boolean).join(" ");
  return intro
    ? `${intro} What’s the campaign name, goal, audience, and timing? Share whatever you have.`
    : "";
}
