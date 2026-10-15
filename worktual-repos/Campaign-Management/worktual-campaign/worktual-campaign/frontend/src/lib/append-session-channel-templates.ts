import {
  getCampaignDraft,
  patchTimelineCardFields,
  upsertCampaignDraft,
  type CampaignChatDraft,
} from "@/lib/campaign-drafts";
import { takePinForTemplatesReady } from "@/lib/campaign-generate-pin";
import {
  appendCreatedChannelTemplates,
  normalizeChatTimeline,
  pinForNewGeneration,
  rebuildTimelineFromSessionTemplates,
  selectFreshCardsForAppend,
  shouldShowTemplateLoadProgress,
  templatesReadyDedupeKey,
  type TemplateMomentPin,
} from "@/lib/campaign-template-timeline";
import { fetchSessionChannelTemplates } from "@/services/channelTemplates.api";
import type { TemplateCard } from "@/services/agents.socket";

const inflightTemplatesReady = new Map<
  string,
  Promise<{
    draft: CampaignChatDraft | null;
    added: TemplateCard[];
    showProgress: boolean;
  }>
>();

/** Single in-flight sync per session + batch (workspace + bridge share this). */
export function runTemplatesReadySync(
  sessionId: string,
  eventPayload?: Record<string, unknown> | null,
): Promise<{
  draft: CampaignChatDraft | null;
  added: TemplateCard[];
  showProgress: boolean;
}> {
  const key = `${sessionId}\0${templatesReadyDedupeKey(eventPayload)}`;
  const existing = inflightTemplatesReady.get(key);
  if (existing) return existing;
  const p = syncTemplatesReadyEvent(sessionId, eventPayload).finally(() => {
    inflightTemplatesReady.delete(key);
  });
  inflightTemplatesReady.set(key, p);
  return p;
}

/** Restore template cards from DB when reopening a draft with empty timeline. */
export async function recoverTimelineFromDbIfEmpty(
  sessionId: string,
): Promise<CampaignChatDraft | null> {
  return reconcileTimelineFromSessionIfNeeded(sessionId);
}

/** Backfill chat cards when session/DB has templates not on ui.timelineTemplates. */
export async function reconcileTimelineFromSessionIfNeeded(
  sessionId: string,
): Promise<CampaignChatDraft | null> {
  const draft = getCampaignDraft(sessionId);
  if (!draft) return null;

  let rows: TemplateCard[] = [];
  try {
    rows = await fetchSessionChannelTemplates(sessionId);
  } catch {
    return draft;
  }
  if (!rows.length) return draft;

  const next = rebuildTimelineFromSessionTemplates(draft, rows);
  const normalized: CampaignChatDraft = {
    ...next,
    timelineTemplates: normalizeChatTimeline(
      next.timelineTemplates,
      next.messages,
    ),
  };
  const prevTimeline = normalizeChatTimeline(
    draft.timelineTemplates,
    draft.messages,
  );
  const timelineChanged =
    JSON.stringify(normalized.timelineTemplates) !==
    JSON.stringify(prevTimeline);
  if (next !== draft || timelineChanged) {
    upsertCampaignDraft(normalized);
  }
  return normalized;
}

function templateIdsFromEvent(
  eventPayload?: Record<string, unknown> | null,
): string[] {
  const raw = eventPayload?.template_ids;
  if (!Array.isArray(raw)) return [];
  return raw.map((id) => String(id || "").trim()).filter(Boolean);
}

export async function pullAndAppendSessionTemplates(
  sessionId: string,
  opts?: {
    pin?: TemplateMomentPin;
    generationBatchId?: string | null;
    templateIds?: string[] | null;
  },
): Promise<{ draft: CampaignChatDraft; added: TemplateCard[] } | null> {
  let created: TemplateCard[] = [];
  try {
    created = await fetchSessionChannelTemplates(sessionId);
  } catch {
    const existing = getCampaignDraft(sessionId);
    return existing ? { draft: existing, added: [] } : null;
  }
  const latest = getCampaignDraft(sessionId);
  if (!latest) return null;

  const batchId = String(opts?.generationBatchId || "").trim() || null;
  const templateIds = opts?.templateIds ?? [];
  let fresh = selectFreshCardsForAppend(
    latest.timelineTemplates,
    created,
    batchId,
    templateIds,
  );

  if (!fresh.length && (batchId || templateIds.length)) {
    await new Promise((r) => window.setTimeout(r, 450));
    try {
      created = await fetchSessionChannelTemplates(sessionId);
    } catch {
      return { draft: latest, added: [] };
    }
    fresh = selectFreshCardsForAppend(
      latest.timelineTemplates,
      created,
      batchId,
      templateIds,
    );
  }

  if (!fresh.length) {
    return { draft: latest, added: [] };
  }

  const pin =
    opts?.pin ??
    pinForNewGeneration(latest, null, batchId);
  const next = appendCreatedChannelTemplates(
    latest,
    fresh,
    pin,
    batchId,
    templateIds,
  );
  if (next !== latest) upsertCampaignDraft(next);
  return { draft: next, added: fresh };
}

/**
 * Fill missing timeline fields from DB. Never overwrite cards that already have
 * a generation snapshot unless `onlyTemplateId` is set (explicit editor save).
 */
export async function hydrateTimelineFieldsFromDb(
  sessionId: string,
  onlyTemplateId?: string,
): Promise<CampaignChatDraft | null> {
  const draft = getCampaignDraft(sessionId);
  if (!draft?.timelineTemplates?.length) return draft ?? null;

  let created: TemplateCard[] = [];
  try {
    created = await fetchSessionChannelTemplates(sessionId);
  } catch {
    return draft;
  }
  if (!created.length) return draft;

  const byId = new Map(
    created
      .filter((c) => c?.template_id)
      .map((c) => [c.template_id, c] as const),
  );
  const tidFilter = String(onlyTemplateId || "").trim();
  let next = draft;

  for (const moment of draft.timelineTemplates || []) {
    for (const card of moment.cards || []) {
      const tid = String(card.template_id || "").trim();
      if (!tid) continue;
      if (tidFilter && tid !== tidFilter) continue;
      const row = byId.get(tid);
      const fields = row?.fields;
      if (!fields || typeof fields !== "object") continue;
      const hasSnapshot =
        card.fields &&
        typeof card.fields === "object" &&
        Object.keys(card.fields).length > 0;
      if (hasSnapshot && !tidFilter) continue;
      next = patchTimelineCardFields(
        next,
        tid,
        fields as Record<string, unknown>,
      );
    }
  }

  if (next !== draft) {
    upsertCampaignDraft(next);
  }
  return next;
}

/** Pull or hydrate after templates_ready — caller decides whether to show progress chrome. */
export async function syncTemplatesReadyEvent(
  sessionId: string,
  eventPayload?: Record<string, unknown> | null,
): Promise<{
  draft: CampaignChatDraft | null;
  added: TemplateCard[];
  showProgress: boolean;
}> {
  const latest = getCampaignDraft(sessionId);
  const batchId = String(eventPayload?.generation_batch_id || "").trim() || null;
  const templateIds = templateIdsFromEvent(eventPayload);
  const showProgress = shouldShowTemplateLoadProgress(latest, eventPayload);

  const pin = latest
    ? takePinForTemplatesReady(sessionId, latest, eventPayload)
    : undefined;
  const result = await pullAndAppendSessionTemplates(
    sessionId,
    {
      pin,
      generationBatchId: batchId,
      templateIds,
    },
  );
  return {
    draft: result?.draft ?? latest,
    added: result?.added ?? [],
    showProgress,
  };
}
