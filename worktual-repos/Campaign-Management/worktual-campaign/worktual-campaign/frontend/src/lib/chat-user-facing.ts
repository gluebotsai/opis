/**
 * Defense-in-depth: strip internal agent/tool text from assistant chat bubbles.
 * Mirrors agents/app/agents/create_campaign/user_facing.py markers.
 */

const INTERNAL_MARKERS = [
  "soft design/audience/orchestration",
  "soft notes (do not block)",
  "soft notes (not blocked)",
  "soft pdoa notes",
  "ontology_ok",
  "ontology_miss",
  "semantic_ok",
  "reports_miss",
  "launch not blocked",
  "orchestration_mode",
  "prefer_primary",
  "launch_channels=",
  "launch_channels",
  "channels_confirmed",
  "agent_instruction",
  "soft_warnings",
  "explain the send plan in your own words",
  "no template blocks",
  "call update_campaign_setup",
  "you must call",
  "tell the user",
  "separate tool calls",
  "do not paste",
  "emails_matched=",
  "phones_matched=",
  "suggest_campaign_names",
  "confirm_chat_images",
  "build_campaign(",
  "update_campaign_setup(",
  "[internal_nudge]",
  "[system]",
] as const;

const INTERNAL_RE =
  /launch_channels\s*=|orchestration[_ ]?mode|prefer[_ ]?primary|soft\s+(design|notes|warnings)|agent_instruction|channels_confirmed/i;

export function looksLikeInternalChatText(text: string): boolean {
  const t = String(text || "").trim().toLowerCase();
  if (!t) return false;
  if (INTERNAL_MARKERS.some((m) => t.includes(m))) return true;
  return INTERNAL_RE.test(t);
}

/** Safe assistant HTML/plain for FE rendering. */
export function sanitizeAssistantChatText(text: string): string {
  const raw = String(text || "").trim();
  if (!raw) return raw;
  if (!looksLikeInternalChatText(raw)) return raw;
  const lower = raw.toLowerCase();
  if (lower.includes("orchestrat") || lower.includes("prefer_primary") || lower.includes("launch_channels")) {
    return "<p>I've updated the send plan. Say when you want to launch, or tell me what to change.</p>";
  }
  if (lower.includes("audience") || lower.includes("matched") || lower.includes("contact")) {
    return "<p>Audience is updated — check the overview panel. Tell me if you want to change who we send to.</p>";
  }
  return "<p>I'm finishing that update — tell me what you'd like to change next.</p>";
}
