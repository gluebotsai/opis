import type {
  ChatMessage,
  DraftTemplateMoment,
  GenerationPin,
} from "@/lib/campaign-drafts";
import { remapTimelinePins } from "@/lib/campaign-drafts";
import {
  coerceTimelineMoments,
  dedupeTimelineByTemplateId,
  normalizeChatTimeline,
} from "@/lib/campaign-template-timeline";

function messageOrderChanged(a: ChatMessage[], b: ChatMessage[]): boolean {
  if (a.length !== b.length) return true;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i]?.id !== b[i]?.id) return true;
  }
  return false;
}

function batchIdOf(moment: DraftTemplateMoment): string {
  for (const card of moment.cards || []) {
    const id = String(card.generation_batch_id || "").trim();
    if (id) return id;
  }
  return String(moment.id || "").trim();
}

function unionCardsByTemplateId(
  primary: DraftTemplateMoment["cards"] | undefined,
  extra: DraftTemplateMoment["cards"] | undefined,
): DraftTemplateMoment["cards"] {
  const byId = new Map<string, DraftTemplateMoment["cards"][number]>();
  const order: string[] = [];
  const take = (card: DraftTemplateMoment["cards"][number] | undefined) => {
    if (!card) return;
    const tid = String(card.template_id || "").trim();
    if (!tid) return;
    if (!byId.has(tid)) {
      order.push(tid);
      byId.set(tid, { ...card });
      return;
    }
    const prev = byId.get(tid)!;
    const prevFields =
      prev.fields && typeof prev.fields === "object" ? prev.fields : {};
    const nextFields =
      card.fields && typeof card.fields === "object" ? card.fields : {};
    byId.set(tid, {
      ...card,
      ...prev,
      fields:
        Object.keys(prevFields).length > 0 ? prevFields : nextFields || prev.fields,
    });
  };
  for (const card of primary || []) take(card);
  for (const card of extra || []) take(card);
  return order.map((id) => byId.get(id)!);
}

function applyStoredPin(
  moment: DraftTemplateMoment,
  pin: GenerationPin | undefined,
): DraftTemplateMoment {
  if (!pin?.pinUserMessageId || pin.pinUserOrdinal < 1) return moment;
  return {
    ...moment,
    pinUserMessageId: pin.pinUserMessageId,
    afterMessageId: pin.pinUserMessageId,
    pinUserOrdinal: pin.pinUserOrdinal,
  };
}

function momentHasFrozenPin(moment: DraftTemplateMoment): boolean {
  if (String(moment.pinUserMessageId || moment.afterMessageId || "").trim()) {
    return true;
  }
  return Number(moment.pinUserOrdinal || 0) >= 1;
}

/**
 * Shown transcript wins. Cards already on a turn never move to an older or
 * newer user line. Session only adds missing template_ids.
 */
export function mergeTimelinesPreserveLocal(
  localTimeline: DraftTemplateMoment[] | undefined,
  remoteTimeline: DraftTemplateMoment[] | undefined,
  prevMessages: ChatMessage[],
  nextMessages: ChatMessage[],
  generationPins?: Record<string, GenerationPin>,
): DraftTemplateMoment[] {
  const local = dedupeTimelineByTemplateId(
    coerceTimelineMoments(localTimeline),
  ).map((m) => ({
    ...m,
    cards: (m.cards || []).map((c) => ({ ...c })),
  }));
  const remote = coerceTimelineMoments(remoteTimeline);

  const byBatch = new Map<string, DraftTemplateMoment>();
  const order: string[] = [];
  const remember = (moment: DraftTemplateMoment, isLocal: boolean) => {
    if (!(moment.cards?.length)) return;
    const batch = batchIdOf(moment);
    const existing = byBatch.get(batch);
    if (!existing) {
      const seeded =
        !isLocal && !momentHasFrozenPin(moment)
          ? applyStoredPin(moment, generationPins?.[batch])
          : moment;
      byBatch.set(batch, {
        ...seeded,
        cards: (seeded.cards || []).map((c) => ({ ...c })),
      });
      order.push(batch);
      return;
    }
    const cards = isLocal
      ? unionCardsByTemplateId(moment.cards, existing.cards)
      : unionCardsByTemplateId(existing.cards, moment.cards);
    byBatch.set(batch, { ...existing, cards });
  };

  for (const moment of local) remember(moment, true);
  for (const moment of remote) remember(moment, false);

  const next = order.map((batch) => {
    const moment = byBatch.get(batch)!;
    if (momentHasFrozenPin(moment)) return moment;
    return applyStoredPin(moment, generationPins?.[batch]);
  });

  const ids = new Set((nextMessages || []).map((m) => m.id));
  const pinsStillBound = next.every((m) => {
    const pinId = String(m.pinUserMessageId || m.afterMessageId || "").trim();
    return !pinId || ids.has(pinId);
  });
  const pinned =
    !pinsStillBound && messageOrderChanged(prevMessages, nextMessages)
      ? remapTimelinePins(next, prevMessages, nextMessages) ?? next
      : next;
  return normalizeChatTimeline(pinned, nextMessages);
}
