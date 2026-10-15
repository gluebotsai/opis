import {
  mergeGenerationPins,
  type CampaignChatDraft,
  type ChatMessage,
  type DraftTemplateMoment,
  type GenerationPin,
} from "@/lib/campaign-drafts";
import type { TemplateCard } from "@/services/agents.socket";

export type TemplateMomentPin = {
  afterMessageIndex: number;
  afterMessageId?: string;
  pinUserMessageId?: string;
  pinUserOrdinal?: number;
};

/** Always an array — repairs legacy corrupt values (e.g. draft object stored as timeline). */
export function coerceTimelineMoments(
  value: unknown,
): DraftTemplateMoment[] {
  if (Array.isArray(value)) {
    return value.filter(
      (m): m is DraftTemplateMoment =>
        Boolean(m && typeof m === "object" && Array.isArray((m as DraftTemplateMoment).cards)),
    );
  }
  if (value && typeof value === "object") {
    const nested = (value as { timelineTemplates?: unknown }).timelineTemplates;
    if (nested != null && nested !== value) {
      return coerceTimelineMoments(nested);
    }
  }
  return [];
}

export function flattenTimelineCards(
  moments: DraftTemplateMoment[] | undefined | null,
): TemplateCard[] {
  const list = Array.isArray(moments) ? moments : coerceTimelineMoments(moments);
  if (!list.length) return [];
  const byId = new Map<string, TemplateCard>();
  for (const moment of list) {
    for (const card of moment.cards) {
      if (!card?.template_id) continue;
      byId.set(card.template_id, card as TemplateCard);
    }
  }
  return Array.from(byId.values());
}

export function knownTemplateIds(
  moments: DraftTemplateMoment[] | undefined | null,
): Set<string> {
  const list = coerceTimelineMoments(moments);
  const ids = new Set<string>();
  for (const moment of list) {
    for (const card of moment.cards) {
      if (card?.template_id) ids.add(card.template_id);
    }
  }
  return ids;
}

/** Drop repeated template_id rows (keeps earliest pin). */
export function dedupeTimelineByTemplateId(
  moments: DraftTemplateMoment[],
): DraftTemplateMoment[] {
  const seen = new Set<string>();
  const out: DraftTemplateMoment[] = [];
  for (const moment of moments) {
    const cards = (moment.cards || []).filter((card) => {
      const tid = String(card.template_id || "").trim();
      if (!tid || seen.has(tid)) return false;
      seen.add(tid);
      return true;
    });
    if (cards.length) out.push({ ...moment, cards });
  }
  return out;
}

/** Merge duplicate stacks at the same user turn + generation batch. */
export function consolidateMomentsAtSamePin(
  moments: DraftTemplateMoment[],
): DraftTemplateMoment[] {
  const pinKey = (m: DraftTemplateMoment) =>
    `${m.pinUserMessageId || ""}|${m.afterMessageId || ""}|${m.afterMessageIndex}`;
  const batchKey = (m: DraftTemplateMoment) => {
    for (const card of m.cards || []) {
      const id = String(card.generation_batch_id || "").trim();
      if (id) return id;
    }
    return "";
  };

  const groups = new Map<string, DraftTemplateMoment>();
  const order: string[] = [];

  for (const moment of moments) {
    if (!(moment.cards?.length)) continue;
    const batch = batchKey(moment);
    // Never merge regen moments that lack a batch id — each append stays separate.
    const key = batch
      ? `${pinKey(moment)}::${batch}`
      : `${pinKey(moment)}::moment:${moment.id}`;
    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, {
        ...moment,
        cards: moment.cards.map((c) => ({ ...c })),
      });
      order.push(key);
      continue;
    }
    const merged = dedupeOnePerChannel([
      ...(existing.cards as TemplateCard[]),
      ...(moment.cards as TemplateCard[]),
    ]);
    groups.set(key, {
      ...existing,
      cards: merged.map((c) => snapshotCard(c)),
    });
  }
  return order.map((k) => groups.get(k)!);
}

/** Fill pinUserOrdinal once from a surviving user-message id. Never overwrite a stored ordinal. */
export function freezeMissingPinOrdinals(
  moments: DraftTemplateMoment[],
  messages: ChatMessage[],
): DraftTemplateMoment[] {
  const users = (messages || []).filter((m) => m.role === "user");
  if (!users.length) return moments;
  return moments.map((moment) => {
    if (Number(moment.pinUserOrdinal || 0) >= 1) return moment;
    const pinId = String(moment.pinUserMessageId || moment.afterMessageId || "").trim();
    if (!pinId) return moment;
    const idx = users.findIndex((u) => u.id === pinId);
    return idx >= 0 ? { ...moment, pinUserOrdinal: idx + 1 } : moment;
  });
}

/**
 * Rebind message ids after refresh / View return. pinUserOrdinal is immutable once set.
 * Never move a batch onto a different generate turn.
 */
export function repairTimelinePlacement(
  moments: DraftTemplateMoment[],
  messages: ChatMessage[],
): DraftTemplateMoment[] {
  if (!moments.length || !messages.length) return moments;
  const users = messages.filter((m) => m.role === "user");
  if (!users.length) return moments;
  const ids = new Set(messages.map((m) => m.id));

  return freezeMissingPinOrdinals(moments, messages).map((moment) => {
    const frozen = Number(moment.pinUserOrdinal || 0);
    const pinId = String(moment.pinUserMessageId || moment.afterMessageId || "").trim();

    if (pinId && ids.has(pinId)) {
      const byId = messages.findIndex((m) => m.id === pinId);
      const row = byId >= 0 ? messages[byId] : undefined;
      if (row?.role === "user") {
        return {
          ...moment,
          afterMessageIndex: byId + 1,
          afterMessageId: row.id,
          pinUserMessageId: row.id,
          pinUserOrdinal: frozen >= 1 ? frozen : users.findIndex((u) => u.id === row.id) + 1,
        };
      }
    }

    if (frozen >= 1 && users[frozen - 1]) {
      const user = users[frozen - 1]!;
      const idx = messages.findIndex((m) => m.id === user.id);
      return {
        ...moment,
        pinUserMessageId: user.id,
        afterMessageId: user.id,
        afterMessageIndex: idx >= 0 ? idx + 1 : moment.afterMessageIndex,
        pinUserOrdinal: frozen,
      };
    }

    return moment;
  });
}

export function normalizeChatTimeline(
  value: DraftTemplateMoment[] | undefined | null,
  messages?: ChatMessage[],
): DraftTemplateMoment[] {
  let next = consolidateMomentsAtSamePin(
    dedupeTimelineByTemplateId(coerceTimelineMoments(value)),
  );
  if (messages?.length) {
    next = freezeMissingPinOrdinals(next, messages);
  }
  return next;
}

/** Cards that belong under this user bubble. Identity first; frozen ordinal if ids churned. */
export function momentsAfterUserTurn(
  moments: DraftTemplateMoment[],
  msg: ChatMessage,
  messages: ChatMessage[],
): DraftTemplateMoment[] {
  if (msg.role !== "user") return [];
  const ordinal = userTurnOrdinal(messages, msg.id);
  const byId = new Map((messages || []).map((m) => [m.id, m] as const));
  return moments.filter((m) => {
    const pinId = String(m.pinUserMessageId || m.afterMessageId || "").trim();
    const pinned = pinId ? byId.get(pinId) : undefined;
    if (pinned?.role === "user") return pinned.id === msg.id;
    const pinOrd = Number(m.pinUserOrdinal || 0);
    if (pinOrd >= 1 && ordinal >= 1) return pinOrd === ordinal;
    return false;
  });
}

/** Moments not bound to a current user turn — still render so cards never vanish. */
export function unplacedTimelineMoments(
  moments: DraftTemplateMoment[],
  messages: ChatMessage[],
): { atStart: DraftTemplateMoment[]; orphaned: DraftTemplateMoment[] } {
  const users = messages.filter((m) => m.role === "user");
  const placed = new Set<string>();
  for (const user of users) {
    for (const moment of momentsAfterUserTurn(moments, user, messages)) {
      placed.add(moment.id);
    }
  }
  const leftover = moments.filter((m) => !placed.has(m.id));
  if (!messages.length) {
    return { atStart: leftover, orphaned: [] };
  }
  const atStart = leftover.filter((m) => {
    const pinId = String(m.pinUserMessageId || m.afterMessageId || "").trim();
    const pinOrd = Number(m.pinUserOrdinal || 0);
    return !pinId && pinOrd < 1 && Number(m.afterMessageIndex || 0) === 0;
  });
  const atStartIds = new Set(atStart.map((m) => m.id));
  return {
    atStart,
    orphaned: leftover.filter((m) => !atStartIds.has(m.id)),
  };
}

/** NEW cards only — never merge into an existing timeline moment. */
export function newCardsOnly(
  moments: DraftTemplateMoment[] | undefined | null,
  incoming: TemplateCard[] | undefined | null,
): TemplateCard[] {
  if (!incoming?.length) return [];
  const known = knownTemplateIds(moments);
  return incoming.filter(
    (card) => card?.template_id && !known.has(card.template_id),
  );
}

/** 1-based user-turn number. Survives message-id churn on View in/out. */
export function userTurnOrdinal(
  messages: ChatMessage[] | undefined | null,
  userMessageId?: string,
): number {
  const users = (messages || []).filter((m) => m.role === "user");
  if (!users.length) return 0;
  if (userMessageId) {
    const idx = users.findIndex((u) => u.id === userMessageId);
    if (idx >= 0) return idx + 1;
  }
  return users.length;
}

function withPinOrdinal(
  pin: TemplateMomentPin,
  messages: ChatMessage[] | undefined | null,
): TemplateMomentPin {
  const ordinal =
    Number(pin.pinUserOrdinal || 0) ||
    userTurnOrdinal(messages, pin.pinUserMessageId || pin.afterMessageId);
  return ordinal >= 1 ? { ...pin, pinUserOrdinal: ordinal } : pin;
}

/** Pin cards to the current user turn. Never reuse a previous generate's pin. */
export function pinFromDraft(draft: CampaignChatDraft): TemplateMomentPin {
  const msgs = draft.messages || [];
  const lastUser = [...msgs].reverse().find((m) => m.role === "user");
  if (lastUser?.id) {
    const idx = msgs.findIndex((m) => m.id === lastUser.id);
    return withPinOrdinal(
      {
        afterMessageIndex: idx >= 0 ? idx + 1 : msgs.length,
        afterMessageId: lastUser.id,
        pinUserMessageId: lastUser.id,
      },
      msgs,
    );
  }
  return { afterMessageIndex: msgs.length };
}

function momentGenerationBatchId(moment: DraftTemplateMoment): string {
  for (const card of moment.cards || []) {
    const id = String(card.generation_batch_id || "").trim();
    if (id) return id;
  }
  return "";
}

/** True when this user turn already owns a different generation (or cards with no batch). */
export function userTurnHasOtherGenerationBatch(
  draft: CampaignChatDraft,
  userMessageId: string | undefined,
  incomingBatchId?: string | null,
): boolean {
  const uid = String(userMessageId || "").trim();
  if (!uid) return false;
  const incoming = String(incomingBatchId || "").trim();
  return (draft.timelineTemplates || []).some((moment) => {
    const pin = String(moment.pinUserMessageId || moment.afterMessageId || "").trim();
    if (pin !== uid) return false;
    const owned = momentGenerationBatchId(moment);
    if (!owned) return true;
    return !incoming || owned !== incoming;
  });
}

function pinToUser(
  msgs: ChatMessage[],
  user: ChatMessage,
  ordinal?: number,
): TemplateMomentPin {
  const idx = msgs.findIndex((m) => m.id === user.id);
  return withPinOrdinal(
    {
      afterMessageIndex: idx >= 0 ? idx + 1 : msgs.length,
      afterMessageId: user.id,
      pinUserMessageId: user.id,
      pinUserOrdinal: ordinal,
    },
    msgs,
  );
}

/**
 * Pin a NEW generation. Preferred pin is the FE-remembered user ask.
 * Always honor that ask — do not walk older turns to "find a free slot".
 * Does not use Python pin_user_message_id / ordinal.
 */
export function pinForNewGeneration(
  draft: CampaignChatDraft,
  preferred?: { pinUserMessageId?: string; pinUserOrdinal?: number } | null,
  _incomingBatchId?: string | null,
): TemplateMomentPin {
  const msgs = draft.messages || [];
  const users = msgs.filter((m) => m.role === "user");
  const preferredId = String(preferred?.pinUserMessageId || "").trim();
  if (preferredId) {
    const user = users.find((m) => m.id === preferredId);
    if (user) {
      return pinToUser(
        msgs,
        user,
        Number(preferred?.pinUserOrdinal || 0) >= 1
          ? Number(preferred?.pinUserOrdinal)
          : undefined,
      );
    }
  }
  const preferredOrd = Number(preferred?.pinUserOrdinal || 0);
  if (preferredOrd >= 1 && users[preferredOrd - 1]) {
    return pinToUser(msgs, users[preferredOrd - 1]!, preferredOrd);
  }
  if (users.length) {
    return pinToUser(msgs, users[users.length - 1]!, users.length);
  }
  return { afterMessageIndex: msgs.length };
}

/** @deprecated Use pinForNewGeneration — Python event pins are ignored. */
export function pinFromEventOrDraft(
  draft: CampaignChatDraft,
  eventPayload?: Record<string, unknown> | null,
): TemplateMomentPin {
  return pinForNewGeneration(
    draft,
    null,
    String(eventPayload?.generation_batch_id || "").trim(),
  );
}

export function isChannelTemplatesReadyEvent(type?: string): boolean {
  return type === "templates_ready" || type === "template_cards";
}

/** True when this generation batch is not yet represented on the chat timeline. */
export function isNewTemplateGenerationBatch(
  draft: CampaignChatDraft | null | undefined,
  batchId: string | undefined | null,
): boolean {
  const cards = flattenTimelineCards(draft?.timelineTemplates);
  const id = String(batchId || "").trim();
  if (!id) return true;
  if (cards.length === 0) return true;
  return !cards.some((c) => String(c.generation_batch_id || "").trim() === id);
}

/** Show the template load progress chrome only for the first card landing or a new batch. */
export function shouldShowTemplateLoadProgress(
  draft: CampaignChatDraft | null | undefined,
  eventPayload?: Record<string, unknown> | null,
): boolean {
  const batchId = String(eventPayload?.generation_batch_id || "").trim();
  if (isNewTemplateGenerationBatch(draft, batchId || null)) return true;
  return false;
}

/** Progress bar for first generate and every regen (new generation_batch_id). */
export function shouldShowTemplateProgressUpdate(
  draft: CampaignChatDraft | null | undefined,
  progress: { status?: string; generation_batch_id?: string },
): boolean {
  const status = String(progress.status || "").trim();
  if (status === "failed") return true;

  const batchId = String(progress.generation_batch_id || "").trim();
  if (isNewTemplateGenerationBatch(draft, batchId || null)) {
    if (status === "started" || status === "generating" || status === "completed") {
      return true;
    }
    return false;
  }

  // Sub-steps (e.g. email compose) may omit batch id — still show while generating.
  if (
    !batchId &&
    flattenTimelineCards(draft?.timelineTemplates).length > 0 &&
    (status === "started" || status === "generating")
  ) {
    return true;
  }

  return false;
}

export function templatesReadyDedupeKey(
  eventPayload?: Record<string, unknown> | null,
): string {
  const batchId = String(eventPayload?.generation_batch_id || "").trim();
  if (batchId) return `batch:${batchId}`;
  const rawIds = eventPayload?.template_ids;
  if (Array.isArray(rawIds) && rawIds.length) {
    const ids = rawIds.map((id) => String(id || "").trim()).filter(Boolean);
    if (ids.length) return `ids:${ids.sort().join(",")}`;
  }
  const pin = String(eventPayload?.pin_user_message_id || "").trim();
  const source = String(eventPayload?.source || "").trim();
  const count = String(eventPayload?.template_count ?? "").trim();
  if (pin) return `pin:${pin}:${source}:${count}`;
  return `misc:${source}:${count}`;
}

function cloneFields(fields: TemplateCard["fields"]): TemplateCard["fields"] {
  if (!fields || typeof fields !== "object") return fields;
  try {
    return structuredClone(fields);
  } catch {
    return JSON.parse(JSON.stringify(fields)) as TemplateCard["fields"];
  }
}

function snapshotCard(c: TemplateCard): DraftTemplateMoment["cards"][number] {
  return {
    template_id: c.template_id,
    channel: c.channel,
    logo: c.logo,
    launch_at: c.launch_at,
    fields: cloneFields(c.fields),
    how_it_works: c.how_it_works,
    generation_batch_id: c.generation_batch_id,
  };
}

/** One card per channel for a single generate/regenerate request. */
export function dedupeOnePerChannel(cards: TemplateCard[]): TemplateCard[] {
  const byChannel = new Map<string, TemplateCard>();
  for (const card of cards) {
    const ch = String(card.channel || "")
      .trim()
      .toLowerCase();
    if (!ch || !card.template_id) continue;
    byChannel.set(ch, card);
  }
  return [...byChannel.values()];
}

/** Newest unknown generation only — never dump full session history into chat. */
function newestUnknownGenerationCards(
  moments: DraftTemplateMoment[] | undefined | null,
  sessionRows: TemplateCard[],
): TemplateCard[] {
  const unknown = newCardsOnly(moments, sessionRows);
  if (!unknown.length) return [];
  const groups = sessionRowsByGenerationBatch(unknown);
  if (!groups.length) return unknown;
  return groups[groups.length - 1]!.cards;
}

/** New template rows for this batch / this templates_ready id list only. */
export function selectFreshCardsForAppend(
  moments: DraftTemplateMoment[] | undefined | null,
  sessionRows: TemplateCard[] | undefined | null,
  generationBatchId?: string | null,
  templateIds?: string[] | null,
): TemplateCard[] {
  const pool = sessionRows ?? [];
  const known = knownTemplateIds(moments);
  const idSet = new Set(
    (templateIds || []).map((id) => String(id || "").trim()).filter(Boolean),
  );
  if (idSet.size) {
    const byId = pool.filter((c) => {
      const tid = String(c.template_id || "").trim();
      return Boolean(tid) && idSet.has(tid) && !known.has(tid);
    });
    if (byId.length) return dedupeOnePerChannel(byId);
  }
  const batchId = String(generationBatchId || "").trim();
  if (batchId) {
    const inBatch = pool.filter(
      (c) => String(c.generation_batch_id || "").trim() === batchId,
    );
    if (inBatch.length) {
      return dedupeOnePerChannel(newCardsOnly(moments, inBatch));
    }
  }
  return dedupeOnePerChannel(newestUnknownGenerationCards(moments, pool));
}

export function timelineHasGenerationBatch(
  draft: CampaignChatDraft | null | undefined,
  batchId: string,
): boolean {
  const id = String(batchId || "").trim();
  if (!id) return false;
  return (draft?.timelineTemplates || []).some((mom) =>
    (mom.cards || []).some(
      (c) => String(c.generation_batch_id || "").trim() === id,
    ),
  );
}

function templateRowSortTime(row: TemplateCard): number {
  const t = Date.parse(String(row.created_at || "").trim());
  return Number.isFinite(t) ? t : 0;
}

function sessionRowsByGenerationBatch(
  sessionRows: TemplateCard[],
): Array<{ batchKey: string; cards: TemplateCard[]; sortAt: number }> {
  const groups = new Map<string, TemplateCard[]>();
  for (const row of sessionRows) {
    if (!row?.template_id) continue;
    const key = String(row.generation_batch_id || row.template_id).trim();
    if (!key) continue;
    const list = groups.get(key) ?? [];
    list.push(row);
    groups.set(key, list);
  }

  return [...groups.entries()]
    .map(([batchKey, cards]) => ({
      batchKey,
      cards: dedupeOnePerChannel(cards),
      sortAt: cards.reduce(
        (min, c) => {
          const t = templateRowSortTime(c);
          if (!t) return min;
          return min === 0 || t < min ? t : min;
        },
        0,
      ),
    }))
    .filter((b) => b.cards.length > 0)
    .sort((a, b) => a.sortAt - b.sortAt);
}

function pinHasIdentity(pin: TemplateMomentPin | null | undefined): boolean {
  if (!pin) return false;
  if (String(pin.pinUserMessageId || "").trim()) return true;
  return Number(pin.pinUserOrdinal || 0) >= 1;
}

function pinForUnknownSessionBatch(
  draft: CampaignChatDraft,
  batchKey: string,
): TemplateMomentPin | null {
  const stored = draft.generationPins?.[batchKey];
  if (stored) {
    return pinForNewGeneration(draft, stored, batchKey);
  }
  const inflight = String(draft.inFlightProgress?.generation_batch_id || "").trim();
  if (
    inflight &&
    inflight === String(batchKey || "").trim() &&
    draft.pendingGeneratePin
  ) {
    return pinForNewGeneration(draft, draft.pendingGeneratePin, batchKey);
  }
  return null;
}

/**
 * Append timeline moments for session/DB templates missing from the chat timeline.
 * Never removes or overwrites existing card snapshots.
 * Only places a batch when a frozen generationPins entry names that batch.
 */
export function appendMissingTimelineCardsFromSession(
  draft: CampaignChatDraft,
  sessionRows: TemplateCard[] | undefined | null,
): CampaignChatDraft {
  if (!sessionRows?.length) return draft;
  const known = knownTemplateIds(draft.timelineTemplates);
  const unknown = sessionRows.filter(
    (r) => r?.template_id && !known.has(String(r.template_id)),
  );
  if (!unknown.length) return draft;

  const unknownBatches = sessionRowsByGenerationBatch(unknown);
  if (!unknownBatches.length) return draft;

  let next = draft;
  for (const batch of unknownBatches) {
    const pin = pinForUnknownSessionBatch(next, batch.batchKey);
    if (!pinHasIdentity(pin)) continue;
    const fresh = selectFreshCardsForAppend(
      next.timelineTemplates,
      batch.cards,
      batch.batchKey,
    );
    if (!fresh.length) continue;
    next = appendCreatedChannelTemplates(
      next,
      fresh,
      pin!,
      batch.batchKey,
    );
  }
  return next;
}

/**
 * Re-open / repair: fill missing generation batches from persisted channel templates.
 */
export function rebuildTimelineFromSessionTemplates(
  draft: CampaignChatDraft,
  sessionRows: TemplateCard[] | undefined | null,
): CampaignChatDraft {
  return appendMissingTimelineCardsFromSession(draft, sessionRows);
}

export function resolveMomentPinFromMessages(
  msgs: ChatMessage[],
  pinUserMessageId?: string,
  afterMessageId?: string,
  afterMessageIndex?: number,
  pinUserOrdinal?: number,
): TemplateMomentPin {
  const users = msgs.filter((m) => m.role === "user");
  const ordinal = Number(pinUserOrdinal || 0);
  if (ordinal >= 1 && users[ordinal - 1]) {
    const user = users[ordinal - 1]!;
    const idx = msgs.findIndex((m) => m.id === user.id);
    return {
      afterMessageIndex: idx >= 0 ? idx + 1 : afterMessageIndex ?? msgs.length,
      afterMessageId: user.id,
      pinUserMessageId: user.id,
      pinUserOrdinal: ordinal,
    };
  }

  const requestedId = String(pinUserMessageId || afterMessageId || "").trim();
  const match = requestedId
    ? msgs.find((m) => m.id === requestedId && m.role === "user")
    : undefined;
  if (match) {
    const idx = msgs.findIndex((m) => m.id === match.id);
    return withPinOrdinal(
      {
        afterMessageIndex: idx >= 0 ? idx + 1 : afterMessageIndex ?? msgs.length,
        afterMessageId: match.id,
        pinUserMessageId: match.id,
      },
      msgs,
    );
  }

  // Unplaced — never steal the last user turn.
  return {
    afterMessageIndex: afterMessageIndex ?? 0,
    afterMessageId: afterMessageId,
    pinUserMessageId: pinUserMessageId,
    pinUserOrdinal: ordinal >= 1 ? ordinal : undefined,
  };
}

export function appendTimelineMoment(
  timeline: DraftTemplateMoment[],
  messages: ChatMessage[],
  cards: TemplateCard[],
  afterMessageIndex?: number,
  afterMessageId?: string,
  pinUserMessageId?: string,
  pinUserOrdinal?: number,
): DraftTemplateMoment[] {
  if (!cards.length) return timeline;
  const msgs = messages || [];
  const pin = resolveMomentPinFromMessages(
    msgs,
    pinUserMessageId,
    afterMessageId,
    afterMessageIndex,
    pinUserOrdinal,
  );
  const moment: DraftTemplateMoment = {
    id: crypto.randomUUID(),
    afterMessageIndex: pin.afterMessageIndex,
    afterMessageId: pin.afterMessageId,
    pinUserMessageId: pin.pinUserMessageId,
    pinUserOrdinal: pin.pinUserOrdinal,
    createdAt: new Date().toISOString(),
    cards: cards.map((c) => snapshotCard(c)),
  };
  return [...timeline, moment];
}

export function appendTemplateMoment(
  draft: CampaignChatDraft,
  cards: TemplateCard[],
  afterMessageIndex?: number,
  afterMessageId?: string,
  pinUserMessageId?: string,
  pinUserOrdinal?: number,
): CampaignChatDraft {
  if (!cards.length) return draft;
  return {
    ...draft,
    timelineTemplates: appendTimelineMoment(
      coerceTimelineMoments(draft.timelineTemplates),
      draft.messages || [],
      cards,
      afterMessageIndex,
      afterMessageId,
      pinUserMessageId,
      pinUserOrdinal,
    ),
    dirty: draft.status === "draft_saved" ? false : true,
    updatedAt: new Date().toISOString(),
  };
}

function mergeFreshIntoGenerationBatch(
  draft: CampaignChatDraft,
  fresh: TemplateCard[],
  batchId: string,
): CampaignChatDraft {
  const timeline = coerceTimelineMoments(draft.timelineTemplates);
  const idx = timeline.findIndex((m) =>
    (m.cards || []).some(
      (c) => String(c.generation_batch_id || "").trim() === batchId,
    ),
  );
  if (idx < 0) return draft;
  const known = new Set(
    (timeline[idx]!.cards || []).map((c) => String(c.template_id || "").trim()),
  );
  const add = fresh.filter((c) => {
    const tid = String(c.template_id || "").trim();
    return Boolean(tid) && !known.has(tid);
  });
  if (!add.length) return draft;
  const cards = [
    ...(timeline[idx]!.cards || []),
    ...add.map((c) => snapshotCard(c)),
  ];
  return {
    ...draft,
    timelineTemplates: timeline.map((m, i) => (i === idx ? { ...m, cards } : m)),
    dirty: draft.status === "draft_saved" ? false : true,
    updatedAt: new Date().toISOString(),
  };
}

/** Append newly created templates at the current pin; keep earlier generation moments. */
export function appendCreatedChannelTemplates(
  draft: CampaignChatDraft,
  created: TemplateCard[] | undefined | null,
  pin?: TemplateMomentPin,
  generationBatchId?: string | null,
  templateIds?: string[] | null,
): CampaignChatDraft {
  const fresh = selectFreshCardsForAppend(
    draft.timelineTemplates,
    created,
    generationBatchId,
    templateIds,
  );
  if (!fresh.length) return draft;
  const resolved = withPinOrdinal(pin ?? pinFromDraft(draft), draft.messages);
  const batchId = String(
    generationBatchId || fresh[0]?.generation_batch_id || "",
  ).trim();
  if (batchId && timelineHasGenerationBatch(draft, batchId)) {
    return mergeFreshIntoGenerationBatch(draft, fresh, batchId);
  }
  const next = appendTemplateMoment(
    draft,
    fresh,
    resolved.afterMessageIndex,
    resolved.afterMessageId,
    resolved.pinUserMessageId,
    resolved.pinUserOrdinal,
  );
  const pinRecord: GenerationPin | undefined =
    resolved.pinUserMessageId && Number(resolved.pinUserOrdinal || 0) >= 1
      ? {
          pinUserMessageId: resolved.pinUserMessageId,
          pinUserOrdinal: Number(resolved.pinUserOrdinal),
        }
      : undefined;
  return {
    ...next,
    generationPins:
      batchId && pinRecord
        ? mergeGenerationPins(draft.generationPins, { [batchId]: pinRecord })
        : draft.generationPins,
    dirty: draft.status === "draft_saved" ? false : true,
    updatedAt: new Date().toISOString(),
  };
}

/** Library catalog ids from usedLibraryTemplateIds — campaign template ids are numeric too. */
export function isLibraryTemplateRef(
  templateId: string | undefined | null,
  libraryIds?: string[] | null,
): boolean {
  const tid = String(templateId || "").trim();
  if (!tid) return false;
  return Boolean(libraryIds?.includes(tid));
}

function latestSessionCardForChannel(
  sessionTemplates: TemplateCard[],
  channel: string,
  libraryIds: Set<string>,
): TemplateCard | undefined {
  const ch = channel.toLowerCase();
  const same = sessionTemplates.filter(
    (t) => String(t.channel || "").toLowerCase() === ch,
  );
  return (
    same.find((t) => t.template_id && !libraryIds.has(t.template_id)) ||
    same[same.length - 1]
  );
}

/** Replace library ids on timeline cards with persisted session channel template ids. */
export function reconcileLibraryTimelineIds(
  draft: CampaignChatDraft,
  sessionTemplates: TemplateCard[] | undefined | null,
): CampaignChatDraft {
  if (!sessionTemplates?.length) return draft;
  const libraryIds = new Set(draft.usedLibraryTemplateIds || []);
  const sessionIds = new Set(
    sessionTemplates
      .map((row) => String(row.template_id || "").trim())
      .filter(Boolean),
  );

  let changed = false;
  const timelineTemplates = (draft.timelineTemplates || []).map((moment) => {
    let cardsChanged = false;
    const cards = moment.cards.map((card) => {
      const tid = String(card.template_id || "").trim();
      const ch = String(card.channel || "").trim();
      if (!ch) return card;
      if (tid && sessionIds.has(tid)) return card;
      const db = latestSessionCardForChannel(sessionTemplates, ch, libraryIds);
      if (!db?.template_id) return card;
      const needsRemap = isLibraryTemplateRef(tid, draft.usedLibraryTemplateIds);
      if (!needsRemap || db.template_id === tid) return card;
      cardsChanged = true;
      changed = true;
      return {
        ...card,
        template_id: db.template_id,
        logo: db.logo ?? card.logo,
        launch_at: db.launch_at ?? card.launch_at,
        how_it_works: db.how_it_works ?? card.how_it_works,
        generation_batch_id:
          db.generation_batch_id ?? card.generation_batch_id,
        fields:
          db.fields && typeof db.fields === "object" && Object.keys(db.fields).length
            ? db.fields
            : card.fields,
      };
    });
    return cardsChanged ? { ...moment, cards } : moment;
  });
  if (!changed) return draft;
  return {
    ...draft,
    timelineTemplates,
    dirty: draft.status === "draft_saved" ? false : true,
    updatedAt: new Date().toISOString(),
  };
}

/** Map a timeline card to the persisted channel template row when opening the editor. */
export function resolveEditorTemplateCard(
  card: TemplateCard,
  sessionTemplates: TemplateCard[] | undefined | null,
  libraryIds?: string[] | null,
): TemplateCard {
  if (!sessionTemplates?.length) return card;
  const libSet = new Set(libraryIds || []);
  const tid = String(card.template_id || "").trim();
  const snapshotFields =
    card.fields && typeof card.fields === "object"
      ? (card.fields as Record<string, unknown>)
      : null;
  const hasSnapshot =
    snapshotFields != null && Object.keys(snapshotFields).length > 0;

  if (tid && sessionTemplates.some((r) => r.template_id === tid)) {
    const row = sessionTemplates.find((r) => r.template_id === tid)!;
    if (hasSnapshot) {
      return {
        ...row,
        ...card,
        template_id: card.template_id,
        fields: card.fields,
      };
    }
    return {
      ...card,
      ...row,
      template_id: card.template_id,
      fields: row.fields ?? card.fields,
    };
  }

  if (tid && isLibraryTemplateRef(tid, libraryIds)) {
    const db = latestSessionCardForChannel(
      sessionTemplates,
      String(card.channel || ""),
      libSet,
    );
    if (!db?.template_id) return card;
    return {
      ...card,
      template_id: db.template_id,
      logo: db.logo ?? card.logo,
      launch_at: db.launch_at ?? card.launch_at,
      how_it_works: db.how_it_works ?? card.how_it_works,
      generation_batch_id: db.generation_batch_id ?? card.generation_batch_id,
      fields: hasSnapshot ? card.fields : db.fields ?? card.fields,
    };
  }

  if (tid) {
    return card;
  }

  return card;
}
