import type { CoworkerExpand } from "@/store/shellSlice";

const COWORKER_EXPAND_KEY = "worktual.coworker.expand";

const VALID: readonly CoworkerExpand[] = [
  "default",
  "chat",
  "draft",
  "chatFull",
];

export function readCoworkerExpandPreference(): CoworkerExpand {
  if (typeof window === "undefined") return "default";
  try {
    const stored = window.sessionStorage.getItem(COWORKER_EXPAND_KEY);
    return VALID.includes(stored as CoworkerExpand)
      ? (stored as CoworkerExpand)
      : "default";
  } catch {
    return "default";
  }
}

export function writeCoworkerExpandPreference(expand: CoworkerExpand): void {
  try {
    window.sessionStorage.setItem(COWORKER_EXPAND_KEY, expand);
  } catch {
    // Ignore quota and privacy-mode failures.
  }
}
