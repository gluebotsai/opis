import type { ChatMessage } from "@/lib/campaign-drafts";

/** Parse bubble timestamp for ordering (ISO from server or client). */
export function messageCreatedAtMs(m: ChatMessage): number {
  const raw = String(m.createdAt || "").trim();
  if (!raw) return NaN;
  const t = Date.parse(raw.replace(/(\.\d{3})\d+Z$/, "$1Z"));
  return Number.isFinite(t) ? t : NaN;
}

/** Detect scrambled thread (not normal assistant/user timestamp skew). */
export function hasFixableChatInversion(messages: ChatMessage[]): boolean {
  const list = Array.isArray(messages) ? messages : [];
  for (let i = 0; i < list.length - 1; i += 1) {
    const a = list[i]!;
    const b = list[i + 1]!;
    const ta = messageCreatedAtMs(a);
    const tb = messageCreatedAtMs(b);
    if (!Number.isFinite(ta) || !Number.isFinite(tb) || ta <= tb) continue;
    if (a.role === "assistant" && b.role === "user") continue;
    return true;
  }
  return false;
}

/**
 * Stable chronological order. Messages without timestamps keep their relative
 * position among other untimestamped rows (original index tie-break).
 * No-op when the list is already a plausible transcript order.
 */
export function sortChatMessagesStable(messages: ChatMessage[]): ChatMessage[] {
  const list = Array.isArray(messages) ? messages : [];
  if (list.length < 2) return [...list];
  const stamped = list.filter((m) => Number.isFinite(messageCreatedAtMs(m))).length;
  if (stamped < 2 || !hasFixableChatInversion(list)) return [...list];
  return list
    .map((m, i) => ({ m, i }))
    .sort((a, b) => {
      const ta = messageCreatedAtMs(a.m);
      const tb = messageCreatedAtMs(b.m);
      if (Number.isFinite(ta) && Number.isFinite(tb) && ta !== tb) return ta - tb;
      if (Number.isFinite(ta) && !Number.isFinite(tb)) return -1;
      if (!Number.isFinite(ta) && Number.isFinite(tb)) return 1;
      return a.i - b.i;
    })
    .map(({ m }) => m);
}

/** True when reordering would change the visible thread. */
export function chatMessageOrderChanged(
  before: ChatMessage[],
  after: ChatMessage[],
): boolean {
  if (before.length !== after.length) return true;
  return before.some((m, i) => m.id !== after[i]?.id);
}
