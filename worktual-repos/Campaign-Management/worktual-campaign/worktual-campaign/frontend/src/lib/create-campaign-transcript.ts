/**
 * Create-campaign chat transcript: persistent static welcome, stable merge, one agent reply per user turn.
 */
import { shouldPreserveLocalTranscriptOnReady } from "@/lib/agents-chat-runtime";
import { sortChatMessagesStable } from "@/lib/chat-message-order";
import type { ChatMessage } from "@/lib/campaign-drafts";
import {
  dedupeConsecutiveUserMessages,
  preferRicherMessages,
} from "@/lib/campaign-drafts";

export function isCreateStaticWelcomeMessage(m: ChatMessage): boolean {
  return (
    m.role === "assistant" &&
    String(m.id || "").startsWith("static-welcome-")
  );
}

export function hasCreateNonStaticAssistantReply(
  messages: ChatMessage[],
): boolean {
  return messages.some(
    (m) => m.role === "assistant" && !isCreateStaticWelcomeMessage(m),
  );
}

function lastUserIndex(messages: ChatMessage[]): number {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i]?.role === "user") return i;
  }
  return -1;
}

function pickBetterAssistant(a: ChatMessage, b: ChatMessage): ChatMessage {
  const ta = (a.text || "").trim();
  const tb = (b.text || "").trim();
  if (ta === tb) return a.id ? a : b;
  return tb.length >= ta.length ? b : a;
}

/** Keep static welcome first; never remove it when merging. */
export function ensureStaticWelcomeFirst(
  messages: ChatMessage[],
  draftId: string,
): ChatMessage[] {
  const staticId = `static-welcome-${draftId}`;
  const staticRow =
    messages.find((m) => m.id === staticId) ||
    messages.find((m) => isCreateStaticWelcomeMessage(m));
  const rest = messages.filter((m) => !isCreateStaticWelcomeMessage(m));
  if (!staticRow) return sortChatMessagesStable(rest);
  return sortChatMessagesStable([staticRow, ...rest]);
}

/**
 * After each user message, keep at most one non-static assistant (longest wins).
 * Static welcome rows are never dropped.
 */
export function collapseDuplicateAssistantReplies(
  messages: ChatMessage[],
): ChatMessage[] {
  const sorted = sortChatMessagesStable([...messages]);
  const out: ChatMessage[] = [];

  for (const m of sorted) {
    if (m.role === "user") {
      out.push(m);
      continue;
    }
    if (isCreateStaticWelcomeMessage(m)) {
      if (!out.some((x) => x.id === m.id)) {
        out.unshift(m);
      }
      continue;
    }
    if (m.role !== "assistant") {
      out.push(m);
      continue;
    }

    const lastUser = lastUserIndex(out);
    if (lastUser < 0) {
      let replaced = false;
      for (let i = out.length - 1; i >= 0; i -= 1) {
        const row = out[i];
        if (row?.role === "assistant" && !isCreateStaticWelcomeMessage(row)) {
          out[i] = pickBetterAssistant(row, m);
          replaced = true;
          break;
        }
        if (row?.role === "user") break;
      }
      if (!replaced) out.push(m);
      continue;
    }

    let replaceIdx = -1;
    for (let i = out.length - 1; i > lastUser; i -= 1) {
      const row = out[i];
      if (row?.role === "assistant" && !isCreateStaticWelcomeMessage(row)) {
        replaceIdx = i;
        break;
      }
    }
    if (replaceIdx >= 0) {
      out[replaceIdx] = pickBetterAssistant(out[replaceIdx]!, m);
    } else {
      out.push(m);
    }
  }

  return dedupeConsecutiveUserMessages(out);
}

export function finalizeCreateCampaignMessages(
  draftId: string,
  messages: ChatMessage[],
): ChatMessage[] {
  return collapseDuplicateAssistantReplies(
    ensureStaticWelcomeFirst(messages, draftId),
  );
}

/** Merge local + server transcript for create draft (session_ready, bridge sync). */
export function mergeCreateCampaignChatMessages(
  draftId: string,
  local: ChatMessage[],
  remote: ChatMessage[],
  options: {
    preserveLocal?: boolean;
    busy?: boolean;
    followUpReady?: boolean;
    hydration?: boolean;
  } = {},
): ChatMessage[] {
  const { preserveLocal, busy, followUpReady, hydration } = options;
  let base: ChatMessage[];
  if (
    preserveLocal ||
    shouldPreserveLocalTranscriptOnReady({
      prev: local,
      remote,
      busy,
      followUpReady,
      hydration,
    })
  ) {
    base = local.length ? local : remote;
  } else if (!remote.length) {
    base = local;
  } else if (!local.length) {
    base = remote;
  } else {
    base = preferRicherMessages(local, remote);
  }
  const staticId = `static-welcome-${draftId}`;
  const localStatic = local.find((m) => m.id === staticId);
  if (localStatic && !base.some((m) => m.id === staticId)) {
    base = [localStatic, ...base];
  }
  return finalizeCreateCampaignMessages(draftId, base);
}

/** Append or replace the agent reply for the latest user turn (bridge agent_message). */
export function upsertCreateCampaignAssistantReply(
  draftId: string,
  existing: ChatMessage[],
  text: string,
): ChatMessage[] {
  const trimmed = text.trim();
  if (!trimmed) return existing;
  const row: ChatMessage = {
    id: crypto.randomUUID(),
    role: "assistant",
    text: trimmed,
    createdAt: new Date().toISOString(),
  };
  const messages = [...existing];
  const lastUser = lastUserIndex(messages);
  if (lastUser < 0) {
    const last = messages[messages.length - 1];
    if (last?.role === "assistant" && last.text.trim() === trimmed) {
      return messages;
    }
    messages.push(row);
    return finalizeCreateCampaignMessages(draftId, messages);
  }
  let replaceIdx = -1;
  for (let i = messages.length - 1; i > lastUser; i -= 1) {
    const m = messages[i];
    if (m?.role === "assistant" && !isCreateStaticWelcomeMessage(m)) {
      replaceIdx = i;
      break;
    }
  }
  if (replaceIdx >= 0) {
    if (messages[replaceIdx]!.text.trim() === trimmed) return messages;
    messages[replaceIdx] = pickBetterAssistant(messages[replaceIdx]!, row);
  } else {
    messages.push(row);
  }
  return finalizeCreateCampaignMessages(draftId, messages);
}
