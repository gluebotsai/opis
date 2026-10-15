import type { LeadSummaryCitation, LeadSummaryView } from "@/services/leadSummary";
import type { ContactActivityDetail } from "@/services/contacts";
import { sanitizeActivityDisplayText } from "@/lib/activity-display";

export type IntelligenceChannelId =
  | "email"
  | "call"
  | "meeting"
  | "sms"
  | "whatsapp"
  | "chat"
  | "social"
  | "ccaas"
  | "note";

export const CHANNEL_ORDER: IntelligenceChannelId[] = [
  "email",
  "call",
  "meeting",
  "sms",
  "whatsapp",
  "chat",
  "social",
  "ccaas",
  "note",
];

export const CHANNEL_LABEL: Record<IntelligenceChannelId, string> = {
  email: "Email",
  call: "Calls",
  meeting: "Meetings",
  sms: "SMS",
  whatsapp: "WhatsApp",
  chat: "Chat",
  social: "Social",
  ccaas: "CCaaS",
  note: "Notes",
};

const CHANNEL_HEADING_RE =
  /^(email|e-mail|call|calls|phone|voice(?:bot)?|voice bot|whatsapp|wa|chat|web\s*chat|live\s*chat|sms|text|instagram|facebook|linkedin|social|meeting|meetings|note|notes|ccaas)\s*[:\-–—]\s*/i;

const CHANNEL_ALIASES: Record<string, IntelligenceChannelId> = {
  email: "email",
  "e-mail": "email",
  call: "call",
  calls: "call",
  phone: "call",
  voice: "call",
  voicebot: "call",
  "voice bot": "call",
  whatsapp: "whatsapp",
  wa: "whatsapp",
  chat: "chat",
  "web chat": "chat",
  "live chat": "chat",
  sms: "sms",
  text: "sms",
  instagram: "social",
  facebook: "social",
  linkedin: "social",
  social: "social",
  meeting: "meeting",
  meetings: "meeting",
  note: "note",
  notes: "note",
  ccaas: "ccaas",
};

export type ChannelItem = {
  text: string;
  sourceId?: string | null;
  sourceKind?: LeadSummaryCitation["sourceKind"];
  when?: string | null;
};

export type ChannelSection = {
  id: IntelligenceChannelId;
  label: string;
  items: ChannelItem[];
  detail?: string | null;
};

export function channelForActivityType(
  type: string | null | undefined,
): IntelligenceChannelId | null {
  if (type === "email") return "email";
  if (type === "call") return "call";
  if (type === "meeting") return "meeting";
  if (type === "sms") return "sms";
  if (type === "note") return "note";
  return null;
}

function channelFromHeading(raw: string): IntelligenceChannelId | null {
  const key = raw.trim().toLowerCase().replace(/\s+/g, " ");
  return CHANNEL_ALIASES[key] ?? null;
}

const PASTE_RE =
  /<!doctype|<html|<\/?[a-z][^>]{0,80}>|charset\s*=|xmlns\s*=|meta\s+name|meet\.google|calendar\/event|google\.com\/calendar|\beid=|@[a-z0-9.-]+\.[a-z]{2,}|^from:\s|^to:\s|^cc:\s|sent via gmail|join with google meet|invitation from google calendar/i;

const HTML_TAG_RE = /<[^>]+>/g;
const EMAIL_RE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const URL_RE = /https?:\/\/\S+|\bwww\.\S+/gi;
const UUID_RE =
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const CDP_ID_RE = /\bCDP-[\w.-]+/g;
const CUID_RE = /\b[cC][a-z0-9]{20,}\b/g;
const CONVERSATION_ID_RE =
  /\bconversation(?:Id|\s+id)\s*[:#]?\s*[A-Za-z0-9_-]{3,}\b/gi;
const LABELED_ID_RE =
  /\s*\(\s*(?:run|campaign|message|batch|ticket|recipient|contact|conversation|event|source)\s+id\s*[:#]?\s*[A-Za-z0-9_-]+\s*\)|\b(?:run|campaign|message|batch|ticket|recipient|contact|conversation|event|source)\s+id\s*[:#]?\s*[A-Za-z0-9_-]+\b|\bid\s*[:#]\s*\d{2,}\b/gi;
const CHANNEL_SECTION_RE = /^channel summaries:?$/i;
const KEY_NOTES_RE = /^key notes:?$/i;
const LABELED_LINE_RE = /^([^:]{1,40}):\s*(.+)$/;

export type ChannelSummaryLine = {
  label: string;
  text: string;
};

export type ChannelSummaryBrief = {
  narrative: string;
  channels: ChannelSummaryLine[];
  notes: string[];
};

/** Drop tags, links, and internal ids. Keep the words a person said. */
export function cleanSummaryText(raw: string | null | undefined): string {
  if (!raw?.trim()) return "";
  let text = raw.replace(/\r\n/g, "\n");
  text = text.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ");
  text = text.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ");
  text = text.replace(/<br\s*\/?>/gi, "\n");
  text = text.replace(/<\/(p|div|li|tr|h[1-6])>/gi, "\n");
  text = text.replace(HTML_TAG_RE, " ");
  text = text
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
  text = text.replace(/\[([^\]]+)\]\((?:https?:\/\/|www\.)[^)]+\)/gi, "$1");
  text = text.replace(URL_RE, "");
  text = text.replace(EMAIL_RE, "");
  text = text.replace(UUID_RE, "");
  text = text.replace(CDP_ID_RE, "");
  text = text.replace(CUID_RE, "");
  text = text.replace(CONVERSATION_ID_RE, "");
  text = text.replace(LABELED_ID_RE, "");
  text = text.replace(/\(\s*\)/g, "");
  return text
    .split("\n")
    .map((line) => line.replace(/[ \t]{2,}/g, " ").replace(/\s+([.,;:])/g, "$1").trim())
    .filter((line) => line && !/^(open|from|to|cc|sent via gmail.*)$/i.test(line))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** True when a line is the email, invite, or page itself rather than a summary of it. */
export function isPastedSource(
  raw: string | null | undefined,
  maxWords = 120,
): boolean {
  const text = raw?.trim() ?? "";
  if (!text) return true;
  if (PASTE_RE.test(text)) return true;
  const cleaned = cleanSummaryText(text);
  if (!cleaned || PASTE_RE.test(cleaned)) return true;
  return cleaned.split(/\s+/).filter(Boolean).length > maxWords;
}

/**
 * Split a CCaaS omni summary into the narrative, channel lines, and key notes
 * already present in the text. Missing sections stay empty.
 */
export function parseChannelSummary(
  raw: string | null | undefined,
): ChannelSummaryBrief | null {
  const cleaned = cleanSummaryText(raw);
  if (!cleaned) return null;

  const narrative: string[] = [];
  const channels: ChannelSummaryLine[] = [];
  const notes: string[] = [];
  let mode: "narrative" | "channels" | "notes" = "narrative";
  let sawChannelHeading = false;

  for (const line of cleaned.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) {
      if (mode === "narrative" && narrative.length > 0 && narrative[narrative.length - 1] !== "") {
        narrative.push("");
      }
      continue;
    }
    if (CHANNEL_SECTION_RE.test(trimmed)) {
      mode = "channels";
      sawChannelHeading = true;
      continue;
    }
    if (KEY_NOTES_RE.test(trimmed)) {
      mode = "notes";
      continue;
    }
    if (mode === "channels") {
      const labeled = trimmed.match(LABELED_LINE_RE);
      if (labeled?.[2]) {
        channels.push({ label: labeled[1].trim(), text: labeled[2].trim() });
      }
      continue;
    }
    if (mode === "notes") {
      const note = trimmed.replace(/^[-•*]\s+/, "").trim();
      if (note) notes.push(note);
      continue;
    }
    narrative.push(trimmed);
  }

  if (!sawChannelHeading) {
    const kept: string[] = [];
    for (const line of narrative) {
      if (!line) {
        kept.push(line);
        continue;
      }
      const match = line.match(CHANNEL_HEADING_RE);
      if (!match) {
        kept.push(line);
        continue;
      }
      const text = line.replace(CHANNEL_HEADING_RE, "").trim();
      if (!text) continue;
      const label = match[1].replace(/\s+/g, " ").trim();
      channels.push({ label, text });
    }
    while (kept.length > 0 && kept[kept.length - 1] === "") kept.pop();
    narrative.length = 0;
    narrative.push(...kept);
  }

  const brief: ChannelSummaryBrief = {
    narrative: narrative.join("\n").replace(/\n{3,}/g, "\n\n").trim(),
    channels,
    notes,
  };
  if (!brief.narrative && brief.channels.length === 0 && brief.notes.length === 0) {
    return null;
  }
  return brief;
}

export function splitOmniByChannel(
  text: string | null | undefined,
): { id: IntelligenceChannelId; body: string }[] {
  const value = text?.trim();
  if (!value) return [];
  const lines = value.replace(/\r\n/g, "\n").split("\n");
  const buckets: { id: IntelligenceChannelId; body: string }[] = [];
  let current: IntelligenceChannelId = "ccaas";
  let buffer: string[] = [];
  const flush = () => {
    const body = buffer.join("\n").trim();
    if (!body) return;
    const last = buckets[buckets.length - 1];
    if (last && last.id === current) {
      last.body = `${last.body}\n${body}`.trim();
    } else {
      buckets.push({ id: current, body });
    }
    buffer = [];
  };
  for (const line of lines) {
    const match = line.trim().match(CHANNEL_HEADING_RE);
    if (match) {
      flush();
      current = channelFromHeading(match[1]) ?? "ccaas";
      const rest = line.trim().replace(CHANNEL_HEADING_RE, "").trim();
      buffer = rest ? [rest] : [];
      continue;
    }
    buffer.push(line);
  }
  flush();
  if (buckets.length === 0) return [{ id: "ccaas", body: value }];
  return buckets;
}

function activitySnippet(activity: ContactActivityDetail): string {
  const subject = sanitizeActivityDisplayText(activity.subject || "");
  const body = sanitizeActivityDisplayText(activity.body || "")
    .replace(/\s+/g, " ")
    .trim();
  if (!body || isPastedSource(body)) return subject.slice(0, 180);
  if (subject && !body.startsWith(subject)) {
    const combined = `${subject} — ${body.slice(0, 180)}`;
    return isPastedSource(combined) ? subject.slice(0, 180) : combined;
  }
  return (subject || body).slice(0, 180);
}

/** Name, email, phone, and city already sit on the contact card. */
function isContactDirectory(text: string): boolean {
  return /\bEmail:\s*\S/.test(text) && /\b(?:Phone|Location):\s*\S/.test(text);
}

/**
 * The intelligence paragraph is the model's engagement summary.
 * Contact-card facts are never substituted for it.
 */
function repeatsNarrative(narrative: string, text: string): boolean {
  const left = narrative.replace(/\s+/g, " ").trim().toLowerCase();
  const right = text.replace(/\s+/g, " ").trim().toLowerCase();
  if (!left || !right) return false;
  if (left === right) return true;
  const shorter = left.length < right.length ? left : right;
  if (shorter.length < 40) return false;
  return left.includes(right) || right.includes(left);
}

function channelSummaryLabel(type: string | null | undefined): string | null {
  if (type === "email") return "Email";
  if (type === "call") return "Call";
  if (type === "meeting") return "Meeting";
  if (type === "sms") return "SMS";
  if (type === "note") return "Note";
  return null;
}

function firstCleanParagraph(summary: LeadSummaryView): string {
  const headline = cleanSummaryText(summary.headline || "");
  if (
    headline &&
    !/not enough information/i.test(headline) &&
    !isContactDirectory(headline) &&
    !isPastedSource(headline)
  ) {
    return headline;
  }
  for (const part of (summary.summary || "").split(/\n\s*\n/)) {
    const text = cleanSummaryText(part);
    if (
      !text ||
      /not enough information/i.test(text) ||
      isContactDirectory(text) ||
      isPastedSource(part) ||
      isPastedSource(text)
    ) {
      continue;
    }
    return text;
  }
  return "";
}

/**
 * Narrative plus one line per channel. Drops the email body, invite, links, and tags.
 */
export function eventSummaryBrief(
  summary: LeadSummaryView | null,
): ChannelSummaryBrief | null {
  if (!summary) return null;
  const omni = parseChannelSummary(summary.omniChannelSummary);
  const narrative = [omni?.narrative, firstCleanParagraph(summary)]
    .filter((part): part is string => Boolean(part && part.trim()))
    .filter((part, index, all) => all.findIndex((item) => item === part) === index)
    .join("\n\n");
  const channels: ChannelSummaryLine[] = [...(omni?.channels ?? [])];
  const seen = new Set(channels.map((line) => `${line.label}:${line.text}`.toLowerCase()));
  for (const line of summary.citations ?? []) {
    if (line.sourceKind === "omni") continue;
    if (isPastedSource(line.text, 45)) continue;
    const text = cleanSummaryText(line.text);
    if (!text || isPastedSource(text, 45) || repeatsNarrative(narrative, text)) continue;
    const label =
      channelSummaryLabel(line.activityType) ??
      (line.sourceKind === "score" ? "Note" : null);
    if (!label) continue;
    const key = `${label}:${text}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    channels.push({ label, text });
  }
  const brief: ChannelSummaryBrief = {
    narrative,
    channels: channels.slice(0, 8),
    notes: omni?.notes ?? [],
  };
  if (!brief.narrative && brief.channels.length === 0 && brief.notes.length === 0) {
    return null;
  }
  return brief;
}

export function intelligenceOverview(summary: LeadSummaryView | null): string {
  return summary ? firstCleanParagraph(summary) : "";
}

export function buildChannelSections(input: {
  summary: LeadSummaryView | null;
  activities: ContactActivityDetail[];
}): ChannelSection[] {
  const sections = new Map<IntelligenceChannelId, ChannelSection>();
  const ensure = (id: IntelligenceChannelId): ChannelSection => {
    let section = sections.get(id);
    if (!section) {
      section = { id, label: CHANNEL_LABEL[id], items: [] };
      sections.set(id, section);
    }
    return section;
  };
  const seen = new Set<string>();
  const pushItem = (
    id: IntelligenceChannelId,
    item: ChannelItem,
  ) => {
    const key = `${id}:${item.sourceId ?? ""}:${item.text.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    ensure(id).items.push(item);
  };

  for (const line of input.summary?.citations ?? []) {
    const text = cleanSummaryText(line.text);
    if (!text || /not enough information/i.test(text) || isPastedSource(line.text, 45)) continue;
    if (line.sourceKind === "omni") {
      pushItem("ccaas", {
        text,
        sourceKind: "omni",
        sourceId: line.conversationId,
      });
      continue;
    }
    const channel =
      channelForActivityType(line.activityType) ??
      (line.sourceKind === "score" ? "note" : null);
    if (!channel) continue;
    pushItem(channel, {
      text,
      sourceKind: line.sourceKind,
      sourceId: line.sourceId,
    });
  }

  for (const chunk of splitOmniByChannel(input.summary?.omniChannelSummary)) {
    const section = ensure(chunk.id);
    if (chunk.id === "ccaas") {
      section.detail = chunk.body;
    } else {
      pushItem(chunk.id, { text: chunk.body, sourceKind: "omni" });
    }
  }

  const usedActivityIds = new Set(
    (input.summary?.citations ?? [])
      .filter((line) => line.sourceKind === "activity" && line.sourceId)
      .map((line) => line.sourceId as string),
  );
  for (const activity of input.activities) {
    const channel = channelForActivityType(activity.type);
    if (!channel || channel === "note") continue;
    if (usedActivityIds.has(activity.id)) continue;
    const text = activitySnippet(activity);
    if (!text || isPastedSource(text)) continue;
    pushItem(channel, {
      text,
      sourceId: activity.id,
      sourceKind: "activity",
      when: activity.createdAt,
    });
  }

  return CHANNEL_ORDER.map((id) => sections.get(id))
    .filter((section): section is ChannelSection => Boolean(section))
    .filter((section) => section.items.length > 0 || Boolean(section.detail?.trim()))
    .map((section) => ({
      ...section,
      items: section.items.slice(0, 6),
    }));
}
