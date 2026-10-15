import { useCallback, useRef, useState } from "react";
import {
  mergeSessionMemoryPatch,
  type CoworkerSessionMemory,
  type CoworkerSessionMemoryPatch,
} from "@/services/coworker";

const STORAGE_PREFIX = "crm-coworker-stm:";

export function clearDraftSessionMemory(scope: string) {
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.removeItem(STORAGE_PREFIX + scope);
  } catch {
    /* private mode */
  }
}

export function writeDraftSessionMemory(scope: string, raw: string | null) {
  if (typeof sessionStorage === "undefined") return;
  try {
    if (!raw) sessionStorage.removeItem(STORAGE_PREFIX + scope);
    else sessionStorage.setItem(STORAGE_PREFIX + scope, raw);
  } catch {
    /* storage full or private mode */
  }
}

export function readDraftSessionMemoryRaw(scope: string): string | null {
  if (typeof sessionStorage === "undefined") return null;
  try {
    return sessionStorage.getItem(STORAGE_PREFIX + scope);
  } catch {
    return null;
  }
}

export function readDraftSessionMemory(scope: string): CoworkerSessionMemory {
  if (typeof sessionStorage === "undefined") return {};
  try {
    const raw = sessionStorage.getItem(STORAGE_PREFIX + scope);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as CoworkerSessionMemory;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeMemory(scope: string, memory: CoworkerSessionMemory) {
  if (typeof sessionStorage === "undefined") return;
  try {
    const empty =
      !memory.pendingIntent &&
      !memory.pendingAsk &&
      !memory.activeAgent &&
      !Object.keys(memory.slots ?? {}).length &&
      !Object.keys(memory.lastEntities ?? {}).length;
    if (empty) sessionStorage.removeItem(STORAGE_PREFIX + scope);
    else sessionStorage.setItem(STORAGE_PREFIX + scope, JSON.stringify(memory));
  } catch {
    /* storage full or private mode — memory still lives in the ref */
  }
}

/**
 * Short-term coworker memory for one create/chat scope.
 * Survives refresh on this tab and is sent back on the next turn.
 */
export function useDraftSessionMemory(scope: string) {
  const [memory, setMemory] = useState<CoworkerSessionMemory>(() =>
    readDraftSessionMemory(scope),
  );
  const memoryRef = useRef(memory);
  memoryRef.current = memory;

  const apply = useCallback(
    (patch?: CoworkerSessionMemoryPatch | null) => {
      if (!patch) return;
      setMemory((prev) => {
        const next = mergeSessionMemoryPatch(prev, patch);
        memoryRef.current = next;
        writeMemory(scope, next);
        return next;
      });
    },
    [scope],
  );

  const clear = useCallback(() => {
    const next: CoworkerSessionMemory = {};
    memoryRef.current = next;
    writeMemory(scope, next);
    setMemory(next);
  }, [scope]);

  return { memory, memoryRef, apply, clear };
}

/** Restore string fields already collected on a previous turn in this tab. */
export function hydrateDraftFromMemory<T extends Record<string, unknown>>(
  empty: T,
  memory: CoworkerSessionMemory | null | undefined,
  slotKey: string,
): T {
  const next = { ...empty };
  const stored = memory?.slots?.[slotKey];
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) return next;
  const fields = stored as Record<string, unknown>;
  for (const key of Object.keys(next)) {
    const current = next[key];
    if (typeof current !== "string" || current.trim()) continue;
    const val = fields[key];
    if (typeof val === "string" && val.trim()) {
      (next as Record<string, unknown>)[key] = val;
    }
  }
  return next;
}
