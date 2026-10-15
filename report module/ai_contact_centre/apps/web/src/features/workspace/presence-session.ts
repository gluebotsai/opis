import { PRESENCE_NUDGE } from "./presence-nudge-config";
import { WORKSPACE_PRESENCE_UPDATED, type PresenceState } from "./api";

const PRESENCE_SESSION_KEY = "cc2-agent-presence-session";
const READY_PROMPT_KEY = "cc2-ready-prompt-handled";
const NOT_READY_STAGE_KEY = "cc2-not-ready-banner-stage";
const NOT_READY_SNOOZE_UNTIL_KEY = "cc2-not-ready-banner-snooze-until";

export type NotReadyBannerStage =
  | "none"
  | "first-shown"
  | "snoozed"
  | "second-shown"
  | "completed";

export function notifyPresenceUpdated(state: PresenceState) {
  window.dispatchEvent(
    new CustomEvent(WORKSPACE_PRESENCE_UPDATED, { detail: { state } }),
  );
}

export function isPresenceSessionInitialized(): boolean {
  return sessionStorage.getItem(PRESENCE_SESSION_KEY) === "1";
}

export function markPresenceSessionInitialized() {
  sessionStorage.setItem(PRESENCE_SESSION_KEY, "1");
}

export function resetPresenceSession() {
  sessionStorage.removeItem(PRESENCE_SESSION_KEY);
  sessionStorage.removeItem(READY_PROMPT_KEY);
  sessionStorage.removeItem(NOT_READY_STAGE_KEY);
  sessionStorage.removeItem(NOT_READY_SNOOZE_UNTIL_KEY);
}

export function isReadyPromptHandled(): boolean {
  return sessionStorage.getItem(READY_PROMPT_KEY) === "1";
}

export function markReadyPromptHandled() {
  sessionStorage.setItem(READY_PROMPT_KEY, "1");
}

export function getNotReadyBannerStage(): NotReadyBannerStage {
  const raw = sessionStorage.getItem(NOT_READY_STAGE_KEY);
  if (
    raw === "none" ||
    raw === "first-shown" ||
    raw === "snoozed" ||
    raw === "second-shown" ||
    raw === "completed"
  ) {
    return raw;
  }
  return "none";
}

export function setNotReadyBannerStage(stage: NotReadyBannerStage) {
  sessionStorage.setItem(NOT_READY_STAGE_KEY, stage);
}

export function snoozeNotReadyBanner() {
  sessionStorage.setItem(
    NOT_READY_SNOOZE_UNTIL_KEY,
    String(Date.now() + PRESENCE_NUDGE.NOT_READY_SNOOZE_MS),
  );
  setNotReadyBannerStage("snoozed");
}

export function isNotReadyBannerSnoozed(): boolean {
  const raw = sessionStorage.getItem(NOT_READY_SNOOZE_UNTIL_KEY);
  if (!raw) return false;
  const until = Number(raw);
  if (!Number.isFinite(until)) {
    clearNotReadyBannerSnooze();
    return false;
  }
  return Date.now() < until;
}

export function clearNotReadyBannerSnooze() {
  sessionStorage.removeItem(NOT_READY_SNOOZE_UNTIL_KEY);
}
