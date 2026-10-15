import type {
  CampaignChatDraft,
  ChatMessage,
  DraftTemplateMoment,
  GenerationPin,
} from "@/lib/campaign-drafts";
import {
  momentsAfterUserTurn,
  userTurnOrdinal,
} from "@/lib/campaign-template-timeline";

export type GenerationBlock = {
  id: string;
  batchId: string;
  cards: DraftTemplateMoment["cards"];
};

function momentBatchId(moment: DraftTemplateMoment): string {
  for (const card of moment.cards || []) {
    const id = String(card.generation_batch_id || "").trim();
    if (id) return id;
  }
  return String(moment.id || "").trim();
}

function previousUserMessage(
  messages: ChatMessage[],
  assistant: ChatMessage,
): ChatMessage | null {
  const idx = messages.findIndex((m) => m.id === assistant.id);
  const start = idx >= 0 ? idx : messages.length;
  for (let i = start - 1; i >= 0; i -= 1) {
    const row = messages[i];
    if (row?.role === "user") return row;
    if (row?.role === "assistant") return null;
  }
  return null;
}

function isFirstAssistantAfterUser(
  messages: ChatMessage[],
  user: ChatMessage,
  assistant: ChatMessage,
): boolean {
  const uIdx = messages.findIndex((m) => m.id === user.id);
  const aIdx = messages.findIndex((m) => m.id === assistant.id);
  if (uIdx < 0 || aIdx <= uIdx) return false;
  return !messages.slice(uIdx + 1, aIdx).some((m) => m.role === "assistant");
}

function hasAssistantAfterUser(messages: ChatMessage[], user: ChatMessage): boolean {
  const uIdx = messages.findIndex((m) => m.id === user.id);
  if (uIdx < 0) return false;
  return messages.slice(uIdx + 1).some((m) => m.role === "assistant");
}

function blocksFromMoments(
  moments: DraftTemplateMoment[],
  user: ChatMessage,
  messages: ChatMessage[],
): GenerationBlock[] {
  return momentsAfterUserTurn(moments, user, messages).map((moment) => ({
    id: String(moment.id || momentBatchId(moment)),
    batchId: momentBatchId(moment),
    cards: moment.cards || [],
  }));
}

/** One block per generation_batch_id owned by this user turn. */
export function blocksAfterUserTurn(
  moments: DraftTemplateMoment[],
  msg: ChatMessage,
  messages: ChatMessage[],
): GenerationBlock[] {
  return blocksFromMoments(moments, msg, messages);
}

/**
 * Chat tiles sit under the first assistant reply for that generate.
 * While the reply is still streaming, they stay under the user turn.
 */
export function blocksForChatMessage(
  moments: DraftTemplateMoment[],
  msg: ChatMessage,
  messages: ChatMessage[],
): GenerationBlock[] {
  if (msg.role === "assistant") {
    const user = previousUserMessage(messages, msg);
    if (!user || !isFirstAssistantAfterUser(messages, user, msg)) return [];
    return blocksFromMoments(moments, user, messages);
  }
  if (msg.role === "user") {
    if (hasAssistantAfterUser(messages, msg)) return [];
    return blocksFromMoments(moments, msg, messages);
  }
  return [];
}

export function progressPinForTurn(
  draft: CampaignChatDraft | null | undefined,
  progress: { generation_batch_id?: string } | null | undefined,
): GenerationPin | null {
  if (!draft || !progress) return null;
  const batch = String(progress.generation_batch_id || "").trim();
  if (batch && draft.generationPins?.[batch]) {
    return draft.generationPins[batch]!;
  }
  return draft.pendingGeneratePin || null;
}

export function progressBelongsToUserTurn(
  draft: CampaignChatDraft | null | undefined,
  msg: ChatMessage,
  messages: ChatMessage[],
  progress: { generation_batch_id?: string } | null | undefined,
): boolean {
  if (!progress || msg.role !== "user") return false;
  const pin = progressPinForTurn(draft, progress);
  if (!pin) return false;
  if (pin.pinUserMessageId && pin.pinUserMessageId === msg.id) return true;
  const ordinal = userTurnOrdinal(messages, msg.id);
  return pin.pinUserOrdinal >= 1 && pin.pinUserOrdinal === ordinal;
}

export function inFlightProgressForTurn(opts: {
  draft: CampaignChatDraft | null | undefined;
  msg: ChatMessage;
  messages: ChatMessage[];
  progress: { generation_batch_id?: string; status?: string } | null | undefined;
  blocks: GenerationBlock[];
}): boolean {
  const { draft, msg, messages, progress, blocks } = opts;
  if (
    progress?.status &&
    progress.status !== "completed" &&
    progress.status !== "failed" &&
    msg.role === "user"
  ) {
    const batch = String(progress.generation_batch_id || "").trim();
    const pin =
      (batch && draft?.generationPins?.[batch]) ||
      draft?.pendingGeneratePin ||
      null;
    if (
      pin?.pinUserMessageId === msg.id &&
      !blocks.some(
        (b) =>
          b.batchId === batch &&
          b.cards.length > 0 &&
          batch.length > 0,
      )
    ) {
      return true;
    }
  }
  if (!progressBelongsToUserTurn(draft, msg, messages, progress)) return false;
  if (progress?.status === "failed") return true;
  const batch = String(progress?.generation_batch_id || "").trim();
  if (batch && blocks.some((b) => b.batchId === batch && b.cards.length > 0)) {
    return false;
  }
  if (!batch && blocks.length > 0 && progress?.status === "completed") {
    return false;
  }
  return true;
}
