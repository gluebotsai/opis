/**
 * Persist form-design chats per event (localStorage).
 * Writes are deferred so chat UI stays responsive.
 */

import { packStorageKey } from "@/lib/industry-packs";

export type FormChatMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  createdAt: string;
};

const STORAGE_KEY_BASE = "worktual.formEventChats.v1";

function storageKey() {
  return packStorageKey(STORAGE_KEY_BASE);
}

type ChatMap = Record<string, FormChatMessage[]>;

let pendingTimer: ReturnType<typeof setTimeout> | null = null;
let pendingWrites: ChatMap = {};

function canUseStorage() {
  return typeof window !== "undefined" && typeof localStorage !== "undefined";
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

function writeMap(map: ChatMap) {
  if (!canUseStorage()) return;
  try {
    localStorage.setItem(storageKey(), JSON.stringify(map));
  } catch {
    /* quota / private mode */
  }
}

function flushPending() {
  pendingTimer = null;
  const batch = pendingWrites;
  pendingWrites = {};
  if (Object.keys(batch).length === 0) return;
  const map = readMap();
  for (const [key, rows] of Object.entries(batch)) {
    if (!key || !rows?.length) continue;
    map[key] = rows.map((m) => ({ ...m }));
  }
  writeMap(map);
}

/** Session key: forms-event-{eventId} */
export function loadFormEventChat(sessionKey: string): FormChatMessage[] {
  const rows = readMap()[sessionKey];
  if (!Array.isArray(rows) || rows.length === 0) return [];
  return rows.map((m) => ({ ...m }));
}

/**
 * Queue a chat save off the critical path (idle / next tick).
 * Empty arrays are ignored so welcome seeds aren't wiped accidentally.
 */
export function saveFormEventChatBackground(
  sessionKey: string,
  messages: FormChatMessage[],
): void {
  if (!sessionKey || !Array.isArray(messages) || messages.length === 0) return;
  pendingWrites[sessionKey] = messages.map((m) => ({ ...m }));
  if (pendingTimer != null) return;
  const schedule =
    typeof requestIdleCallback === "function"
      ? (cb: () => void) => {
          requestIdleCallback(() => cb(), { timeout: 800 });
        }
      : (cb: () => void) => {
          setTimeout(cb, 0);
        };
  schedule(() => {
    pendingTimer = setTimeout(flushPending, 0);
  });
}

export function mergeFormEventChats(
  local: FormChatMessage[],
  remote: FormChatMessage[],
): FormChatMessage[] {
  if (local.length === 0) return remote;
  if (remote.length === 0) return local;
  if (local.length >= remote.length) return local;
  return remote;
}
