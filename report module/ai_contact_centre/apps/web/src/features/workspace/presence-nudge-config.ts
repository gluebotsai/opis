export type PresenceNudgeBanner = "post-login" | "first" | "second";

/** Indian English TTS reminder clips (mono 16-bit 24 kHz WAV). */
export const PRESENCE_NUDGE_AUDIO: Record<PresenceNudgeBanner, string> = {
  "post-login": "/audio/presence-nudges/post-login.wav",
  first: "/audio/presence-nudges/not-ready-10min.wav",
  second: "/audio/presence-nudges/not-ready-snooze.wav",
};

export const NOT_READY_ALERT_MINUTES = 10;

/** Presence nudge thresholds (ms). */
export const PRESENCE_NUDGE = {
  /** Post-login modal if still Not Ready. */
  POST_LOGIN_MS: 60_000,
  /** Not Ready banner based on continuous status duration. */
  NOT_READY_BANNER_MS: NOT_READY_ALERT_MINUTES * 60_000,
  /** Snooze before the second banner reminder. */
  NOT_READY_SNOOZE_MS: NOT_READY_ALERT_MINUTES * 60_000,
  /** Supervisor alert when agent stays Not Ready with no active work. */
  SUPERVISOR_NOT_READY_MS: NOT_READY_ALERT_MINUTES * 60_000,
  /** Time to respond on a Not Ready banner before auto-escalating to supervisor. */
  NOT_READY_BANNER_ACTION_MS: 60_000,
} as const;
