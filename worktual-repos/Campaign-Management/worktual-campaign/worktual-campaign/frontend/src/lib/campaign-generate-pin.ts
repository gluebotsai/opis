import {
  getCampaignDraft,
  mergeGenerationPins,
  upsertCampaignDraft,
  type CampaignChatDraft,
  type ChatMessage,
  type GenerationPin,
} from "@/lib/campaign-drafts";
import {
  pinForNewGeneration,
  type TemplateMomentPin,
} from "@/lib/campaign-template-timeline";

export type GenerateUserPin = GenerationPin;

const lastUserPinBySession = new Map<string, GenerateUserPin>();
const batchPinBySession = new Map<string, Map<string, GenerateUserPin>>();
const landedBatchBySession = new Map<string, Set<string>>();

function lastUserPin(messages: ChatMessage[]): GenerateUserPin | null {
  const users = (messages || []).filter((m) => m.role === "user");
  const last = users[users.length - 1];
  if (!last?.id) return null;
  return { pinUserMessageId: last.id, pinUserOrdinal: users.length };
}

function timelineHasGenerationBatch(
  draft: CampaignChatDraft,
  batchId: string,
): boolean {
  const id = String(batchId || "").trim();
  if (!id) return false;
  return (draft.timelineTemplates || []).some((mom) =>
    (mom.cards || []).some(
      (c) => String(c.generation_batch_id || "").trim() === id,
    ),
  );
}

function hasOpenGenerationBatch(draft: CampaignChatDraft): boolean {
  const pins = draft.generationPins || {};
  for (const batchId of Object.keys(pins)) {
    const id = String(batchId || "").trim();
    if (id && !timelineHasGenerationBatch(draft, id)) return true;
  }
  return false;
}

function hasUnlandedBoundBatch(sessionId: string): boolean {
  const byBatch = batchPinBySession.get(sessionId);
  if (!byBatch || byBatch.size === 0) return false;
  const landed = landedBatchBySession.get(sessionId);
  for (const id of byBatch.keys()) {
    if (!landed?.has(id)) return true;
  }
  return false;
}

function markBatchesLanded(sessionId: string, batchIds: string[]): void {
  if (!sessionId || !batchIds.length) return;
  let landed = landedBatchBySession.get(sessionId);
  if (!landed) {
    landed = new Set();
    landedBatchBySession.set(sessionId, landed);
  }
  for (const id of batchIds) {
    const batchId = String(id || "").trim();
    if (batchId) landed.add(batchId);
  }
}

function shouldFreezeMemoryPin(sessionId: string): GenerateUserPin | null {
  const frozen = lastUserPinBySession.get(sessionId);
  if (!frozen?.pinUserMessageId || frozen.pinUserOrdinal < 1) return null;
  if (hasUnlandedBoundBatch(sessionId)) return frozen;
  return null;
}

function shouldFreezePendingPin(draft: CampaignChatDraft): GenerateUserPin | null {
  const frozen = draft.pendingGeneratePin || lastUserPinBySession.get(draft.id);
  if (!frozen?.pinUserMessageId || frozen.pinUserOrdinal < 1) return null;
  if (hasOpenGenerationBatch(draft)) return frozen;
  return null;
}

function persistDraftPins(
  sessionId: string,
  patch: Partial<
    Pick<CampaignChatDraft, "generationPins" | "pendingGeneratePin">
  >,
): void {
  const sid = String(sessionId || "").trim();
  if (!sid) return;
  const draft = getCampaignDraft(sid);
  if (!draft) return;
  upsertCampaignDraft({
    ...draft,
    ...patch,
    updatedAt: new Date().toISOString(),
  });
}

/** Fill in-memory maps from a persisted draft (refresh / View return). */
export function hydrateGeneratePinsFromDraft(
  draft: CampaignChatDraft | null | undefined,
): void {
  const sid = String(draft?.id || "").trim();
  if (!sid || !draft) return;
  const pending = draft.pendingGeneratePin;
  if (pending?.pinUserMessageId && pending.pinUserOrdinal >= 1) {
    lastUserPinBySession.set(sid, pending);
  }
  const stored = draft.generationPins || {};
  let byBatch = batchPinBySession.get(sid);
  if (!byBatch) {
    byBatch = new Map();
    batchPinBySession.set(sid, byBatch);
  }
  for (const [batchId, pin] of Object.entries(stored)) {
    const id = String(batchId || "").trim();
    if (!id || !pin?.pinUserMessageId || pin.pinUserOrdinal < 1) continue;
    if (!byBatch.has(id)) byBatch.set(id, pin);
  }
}

/** Call when a user message is appended locally — this is the generate ask. */
export function rememberGenerateUserPin(
  sessionId: string,
  messages: ChatMessage[],
): GenerateUserPin | null {
  const sid = String(sessionId || "").trim();
  if (!sid) return null;
  const draft = getCampaignDraft(sid);
  if (draft) {
    hydrateGeneratePinsFromDraft(draft);
    const frozen = shouldFreezePendingPin(draft);
    if (frozen) {
      lastUserPinBySession.set(sid, frozen);
      return frozen;
    }
  } else {
    const frozen = shouldFreezeMemoryPin(sid);
    if (frozen) return frozen;
  }
  const pin = lastUserPin(messages);
  if (!pin) return null;
  lastUserPinBySession.set(sid, pin);
  persistDraftPins(sid, { pendingGeneratePin: pin });
  return pin;
}

/** Freeze the current last-user ask to this batch (call on first template_progress). */
export function captureGeneratePinForNewBatch(
  sessionId: string,
  messages: ChatMessage[],
  generationBatchId?: string | null,
): GenerateUserPin | null {
  const sid = String(sessionId || "").trim();
  const batchId = String(generationBatchId || "").trim();
  if (!sid || !batchId) return null;
  const draft = getCampaignDraft(sid);
  if (draft) hydrateGeneratePinsFromDraft(draft);
  const existing =
    draft?.generationPins?.[batchId] ||
    batchPinBySession.get(sid)?.get(batchId) ||
    null;
  if (existing?.pinUserMessageId) return existing;
  const pin = rememberGenerateUserPin(sid, messages);
  return bindGeneratePinToBatch(sid, batchId, pin);
}

/** Bind a user ask to this generation_batch_id (progress start, or ready aliases). */
export function bindGeneratePinToBatch(
  sessionId: string,
  generationBatchId?: string | null,
  pinOverride?: GenerateUserPin | null,
): GenerateUserPin | null {
  const sid = String(sessionId || "").trim();
  const batchId = String(generationBatchId || "").trim();
  const pin = pinOverride || lastUserPinBySession.get(sid) || null;
  if (!sid || !pin || !batchId) return pin;
  let byBatch = batchPinBySession.get(sid);
  if (!byBatch) {
    byBatch = new Map();
    batchPinBySession.set(sid, byBatch);
  }
  if (!byBatch.has(batchId)) {
    byBatch.set(batchId, pin);
    const draft = getCampaignDraft(sid);
    persistDraftPins(sid, {
      generationPins: mergeGenerationPins(draft?.generationPins, {
        [batchId]: pin,
      }),
    });
  }
  return byBatch.get(batchId) || pin;
}

function batchIdsFromReadyEvent(
  eventPayload?: Record<string, unknown> | null,
): string[] {
  const ids: string[] = [];
  const primary = String(eventPayload?.generation_batch_id || "").trim();
  if (primary) ids.push(primary);
  const extra = eventPayload?.generation_batch_ids;
  if (Array.isArray(extra)) {
    for (const row of extra) {
      const id = String(row || "").trim();
      if (id && !ids.includes(id)) ids.push(id);
    }
  }
  return ids;
}

function rememberedPin(
  sessionId: string,
  draft: CampaignChatDraft,
  batchId: string,
): GenerateUserPin | null {
  hydrateGeneratePinsFromDraft(draft);
  const sid = String(sessionId || "").trim();
  const batch = String(batchId || "").trim();
  if (batch) {
    return (
      batchPinBySession.get(sid)?.get(batch) ||
      draft.generationPins?.[batch] ||
      null
    );
  }
  return (
    lastUserPinBySession.get(sid) ||
    draft.pendingGeneratePin ||
    lastUserPin(draft.messages || []) ||
    null
  );
}

/**
 * Pin for templates_ready. Uses the user ask frozen at send / progress.
 * Never uses a Python pin_user_message_id.
 * Binds UUID + persisted stable ids so reopen recovery can find the pin.
 */
export function takePinForTemplatesReady(
  sessionId: string,
  draft: CampaignChatDraft,
  eventPayload?: Record<string, unknown> | null,
): TemplateMomentPin {
  const sid = String(sessionId || "").trim();
  const batchIds = batchIdsFromReadyEvent(eventPayload);
  const batchId = batchIds[0] || "";
  let remembered: GenerateUserPin | null = null;
  for (const id of batchIds) {
    remembered = rememberedPin(sid, draft, id);
    if (remembered) break;
  }
  if (!remembered) {
    remembered = rememberedPin(sid, draft, "");
  }
  if (!remembered) {
    return pinForNewGeneration(draft, remembered, batchId);
  }
  for (const id of batchIds) {
    bindGeneratePinToBatch(sid, id, remembered);
  }
  markBatchesLanded(sid, batchIds);
  return pinForNewGeneration(draft, remembered, batchId);
}

export function resetGeneratePins(sessionId: string): void {
  const sid = String(sessionId || "").trim();
  lastUserPinBySession.delete(sid);
  batchPinBySession.delete(sid);
  landedBatchBySession.delete(sid);
  persistDraftPins(sid, { generationPins: {}, pendingGeneratePin: undefined });
}
