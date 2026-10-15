/**
 * Persist recommendation manager chats (main + per-card) in localStorage.
 */

import { packStorageKey } from "@/lib/industry-packs";

export type RecommendationChatMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  createdAt: string;
};

const STORAGE_KEY_BASE = "worktual.recommendationChats.v6";

function storageKey() {
  return packStorageKey(STORAGE_KEY_BASE);
}
export const RECOMMENDATIONS_MAIN_SESSION = "recommendations-main-v2";

type ChatMap = Record<string, RecommendationChatMessage[]>;

function canUseStorage() {
  return typeof window !== "undefined" && typeof localStorage !== "undefined";
}

function writeMap(map: ChatMap) {
  if (!canUseStorage()) return;
  try {
    localStorage.setItem(storageKey(), JSON.stringify(map));
  } catch {
    /* quota / private mode */
  }
}

function readMap(): ChatMap {
  if (!canUseStorage()) return {};
  try {
    const raw = localStorage.getItem(storageKey());
    if (!raw) return {};
    const parsed = JSON.parse(raw) as ChatMap;
    if (!parsed || typeof parsed !== "object") return {};
    return parsed;
  } catch {
    return {};
  }
}

export function ensureRecommendationChatSeeds(_force = false): void {
  readMap();
}

export function loadRecommendationChat(
  sessionKey: string,
): RecommendationChatMessage[] {
  const map = readMap();
  const rows = map[sessionKey];
  if (Array.isArray(rows) && rows.length > 0) {
    return rows.map((m) => ({ ...m }));
  }
  return [];
}

export function saveRecommendationChat(
  sessionKey: string,
  messages: RecommendationChatMessage[],
): void {
  if (!sessionKey || !Array.isArray(messages) || messages.length === 0) {
    return;
  }
  const map = readMap();
  map[sessionKey] = messages.map((m) => ({ ...m }));
  writeMap(map);
}

export function mergeRecommendationChats(
  local: RecommendationChatMessage[],
  remote: RecommendationChatMessage[],
): RecommendationChatMessage[] {
  if (local.length === 0) return remote;
  if (remote.length === 0) return local;
  if (local.length >= remote.length) return local;
  if (remote.length === 1 && local.length > 0) return local;
  if (
    local[0] &&
    !remote.some((m) => m.id === local[0].id || m.text === local[0].text)
  ) {
    return [...local, ...remote.filter((m) => m.id !== local[0].id)];
  }
  return remote;
}
