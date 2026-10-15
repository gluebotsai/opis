import {
  isCaptureBotName,
  meetChannelBindingsEnabled,
} from "@/lib/meet-channel-bindings";

/**
 * Who said this transcript line — Assist must coach on the customer only,
 * never on the sales rep's mic / own speech.
 *
 * Google Meet's live caption stream (what the Vexa bot forwards to us) never
 * gives a verified per-utterance email — only a channel index and a
 * flickering display-name string (see meeting-service/app/services/
 * pcm_session.py). There is therefore no email to compare on a per-line
 * basis, and comparing Meet's caption name against a CRM contact's stored
 * name/email is not a real identity check: it is a name-substring guess
 * that fails the moment a contact record shares a name, or even an email
 * address, with someone on the org side of the call (the exact bug this
 * file used to have). `shouldAutoAssistFromChunk` below therefore checks
 * nothing but `attendeeRole` — the channel/turn lock produced by
 * `classifyAttendeeTurn` in meeting-attendee-identity.ts, which only ever
 * grants "customer"/"other" via an explicit tap (`assignChannelEmail`) or
 * unambiguous process-of-elimination, never via name/email string matching.
 */

/**
 * Local Chrome/browser-mic capture is always rejected as an Assist trigger
 * — it mixes sales + room audio on one track and has no reliable
 * per-speaker channel at all, unlike the bot's per-participant PCM feed.
 */
const MIC_OR_LOCAL_SOURCE =
  /worktual_stt|browser_mic|media_recorder|listen_window|chrome_mic/i;

export function isMicOrLocalSttSource(source?: string | null): boolean {
  return Boolean(source && MIC_OR_LOCAL_SOURCE.test(source));
}

function norm(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Compare two Meet/CRM display-name strings. Used ONLY inside
 * `classifyAttendeeTurn` to link a Meet caption name to the internal/host
 * identity that verified its own Google sign-in on the Sales Assist panel
 * (`hostMeetName`) — a safe, block-only direction (it can only ever result
 * in *not* coaching someone, never in wrongly coaching the rep). It is
 * never used to decide a line is the customer; that decision comes from
 * `attendeeRole` alone (see `shouldAutoAssistFromChunk`).
 */
export function nameOverlap(a: string, b: string): boolean {
  const x = norm(a);
  const y = norm(b);
  if (!x || !y) return false;
  if (x === y) return true;
  if (x.length >= 3 && y.includes(x)) return true;
  if (y.length >= 3 && x.includes(y)) return true;
  // First+last token match (Meet captions often use full display names)
  const xt = x.split(" ").filter((t) => t.length > 1);
  const yt = y.split(" ").filter((t) => t.length > 1);
  if (xt.length && yt.length && xt[0] === yt[0] && xt[xt.length - 1] === yt[yt.length - 1]) {
    return true;
  }
  return false;
}

/**
 * True only when this line should drive auto Assist (customer question).
 *
 * The ONLY signal here is `attendeeRole` — the per-channel lock from
 * `classifyAttendeeTurn`. That lock becomes "customer"/"other" in exactly
 * two genuinely identifier-based ways:
 *   1. An explicit tap in the Meet panel ("This is Ravi Kumar") —
 *      `assignChannelEmail`, an exact lookup by the CRM email chosen, zero
 *      string matching involved.
 *   2. Unambiguous process-of-elimination once every other seat on this
 *      call is already accounted for (see `classifyAttendeeTurn`).
 *
 * There is deliberately no name or email comparison left in this function.
 * A CRM contact record that shares a name, or even an email address, with
 * the rep/pre-sales side can therefore never turn the rep's own speech into
 * "customer" coaching — there is nothing left here for it to fool.
 */
export function shouldAutoAssistFromChunk(input: {
  source?: string | null;
  attendeeRole?: "host" | "customer" | "other" | "unknown" | null;
  /**
   * Set only by the channel-binding path. When that flag is on, coaching
   * requires a finished roster lookup that found no employee for this
   * channel. Pending, failed, and employee bindings do not coach.
   * Omitted while the flag is off, which leaves the role check unchanged.
   */
  channelResolution?: "employee" | "pending" | "ambiguous" | "ready-unbound" | null;
  channelBindingsEnabled?: boolean;
}): boolean {
  if (isMicOrLocalSttSource(input.source)) return false;
  const bindingsOn =
    input.channelBindingsEnabled ?? meetChannelBindingsEnabled();
  if (bindingsOn && input.channelResolution !== "ready-unbound") return false;
  return input.attendeeRole === "customer" || input.attendeeRole === "other";
}

/** Heard bubble: hide the notetaker and the sales host; show everyone else. */
export function shouldPublishLiveHeard(input: {
  speaker?: string | null;
  attendeeRole?: string | null;
}): boolean {
  if (isCaptureBotName(input.speaker || "")) return false;
  if (input.attendeeRole === "host") return false;
  return true;
}

export function pickLatestNonHostHeard(
  rows: Array<{ speaker: string | null; text: string | null }>,
  hostNames: Array<string | null | undefined>,
): { speaker: string | null; text: string } | null {
  const hosts = hostNames.map((name) => (name || "").trim()).filter(Boolean);
  for (const row of rows) {
    const text = (row.text || "").trim();
    if (!text) continue;
    const speaker = (row.speaker || "").trim();
    if (isCaptureBotName(speaker)) continue;
    if (speaker && hosts.some((host) => nameOverlap(speaker, host))) continue;
    return { speaker: speaker || null, text };
  }
  return null;
}
