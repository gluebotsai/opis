/**
 * Local campaign chat drafts (Phase 1).
 * Replace with campaign_db / Campaign MS API later — same shape.
 */

export type CampaignDraftStatus =
  | "empty"
  | "drafting"
  | "draft_saved"
  | "ready"
  | "scheduled"
  | "live"
  | "completed"
  | "cancelled";

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  createdAt: string;
};

export type CampaignChatDraft = {
  id: string;
  name: string;
  goal: string;
  channels: string[];
  audience: string;
  schedule: string;
  flowSteps: string[];
  status: CampaignDraftStatus;
  messages: ChatMessage[];
  dirty: boolean;
  createdAt: string;
  updatedAt: string;
  launchedAt: string | null;
};

const STORAGE_KEY = "worktual.campaignChatDrafts.v1";

function canUseStorage() {
  return typeof window !== "undefined" && typeof localStorage !== "undefined";
}

function readAll(): CampaignChatDraft[] {
  if (!canUseStorage()) return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as CampaignChatDraft[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeAll(drafts: CampaignChatDraft[]) {
  if (!canUseStorage()) return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(drafts));
}

export function listCampaignDrafts(): CampaignChatDraft[] {
  return readAll()
    .filter(
      (d) =>
        d.messages.length > 0 ||
        d.status === "draft_saved" ||
        d.status === "scheduled" ||
        d.status === "live" ||
        d.status === "completed",
    )
    .sort(
      (a, b) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    );
}

export function getCampaignDraft(id: string): CampaignChatDraft | null {
  return readAll().find((d) => d.id === id) ?? null;
}

export function upsertCampaignDraft(draft: CampaignChatDraft): void {
  const all = readAll();
  const i = all.findIndex((d) => d.id === draft.id);
  if (i >= 0) all[i] = draft;
  else all.unshift(draft);
  writeAll(all);
}

export function deleteCampaignDraft(id: string): void {
  writeAll(readAll().filter((d) => d.id !== id));
}

export function createEmptyDraft(
  partial?: Partial<CampaignChatDraft>,
): CampaignChatDraft {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    name: "Untitled campaign",
    goal: "Not set yet",
    channels: [],
    audience: "Not set yet",
    schedule: "Not set yet",
    flowSteps: ["Audience enters campaign", "Add channels via chat"],
    status: "empty",
    messages: [],
    dirty: false,
    createdAt: now,
    updatedAt: now,
    launchedAt: null,
    ...partial,
  };
}

/** Ask save popup only when there is real chat content still unfinished. */
export function shouldPromptSaveOnLeave(draft: CampaignChatDraft): boolean {
  if (draft.messages.length === 0) return false;

  if (
    draft.status === "scheduled" ||
    draft.status === "live" ||
    draft.status === "completed" ||
    draft.status === "cancelled"
  ) {
    return false;
  }

  if (draft.status === "draft_saved" && !draft.dirty) {
    return false;
  }

  return true;
}

const CHANNEL_KEYWORDS: { match: RegExp; label: string }[] = [
  { match: /whats?\s*app|wa\b/i, label: "WhatsApp" },
  { match: /\bsms\b|text message/i, label: "SMS" },
  { match: /email|e-mail/i, label: "Email" },
  { match: /webinar/i, label: "Webinar" },
  { match: /form|landing/i, label: "Form" },
  { match: /coupon|offer|promo/i, label: "Coupon" },
  { match: /push/i, label: "Push" },
  { match: /social|ads?/i, label: "Ads" },
];

function detectChannels(text: string): string[] {
  const found = CHANNEL_KEYWORDS.filter((c) => c.match.test(text)).map(
    (c) => c.label,
  );
  return found.length > 0 ? [...new Set(found)] : ["Email"];
}

function detectGoal(text: string): string {
  if (/webinar|register/i.test(text)) return "Webinar registrations";
  if (/coupon|sale|purchase|cart/i.test(text)) return "Sales / conversions";
  if (/lead|nurture|form/i.test(text)) return "Lead generation";
  if (/awareness|brand/i.test(text)) return "Awareness";
  return "Engagement";
}

export function applyUserPromptToDraft(
  draft: CampaignChatDraft,
  text: string,
): CampaignChatDraft {
  const channels = detectChannels(text);
  const goal = detectGoal(text);
  const name = `${goal} · ${channels.slice(0, 2).join(" + ")}`.slice(0, 72);
  const flowSteps = [
    "Audience enters campaign",
    ...channels.map((ch, i) =>
      `${i === 0 ? "First touch" : "Next touch"}: ${ch}`,
    ),
    goal.toLowerCase().includes("webinar")
      ? "Webinar registration / attend"
      : goal.toLowerCase().includes("lead")
        ? "Form submit → CRM lead handoff"
        : goal.toLowerCase().includes("sale")
          ? "Offer redeem / purchase"
          : "Conversion / exit",
  ];
  const audience = /cart|abandon/i.test(text)
    ? "Cart abandoners (segment)"
    : /b2c|festival/i.test(text)
      ? "B2C active customers"
      : draft.audience === "Not set yet"
        ? "Not set yet"
        : draft.audience;
  const schedule = /weekend|this week|next week/i.test(text)
    ? "Suggested: this week"
    : draft.schedule;

  const now = new Date().toISOString();
  const userMsg: ChatMessage = {
    id: crypto.randomUUID(),
    role: "user",
    text: text.trim(),
    createdAt: now,
  };
  const assistantMsg: ChatMessage = {
    id: crypto.randomUUID(),
    role: "assistant",
    text: `Draft updated. Goal: ${goal}. Channels: ${channels.join(", ")}. Continue chatting or save when ready.`,
    createdAt: now,
  };

  return {
    ...draft,
    name: draft.name === "Untitled campaign" ? name : draft.name,
    goal,
    channels,
    audience,
    schedule,
    flowSteps,
    status: "drafting",
    dirty: true,
    updatedAt: now,
    messages: [...draft.messages, userMsg, assistantMsg],
  };
}

export function markDraftSaved(draft: CampaignChatDraft): CampaignChatDraft {
  const now = new Date().toISOString();
  return {
    ...draft,
    status: "draft_saved",
    dirty: false,
    updatedAt: now,
  };
}

export function markDraftLaunched(
  draft: CampaignChatDraft,
  as: "scheduled" | "live" = "scheduled",
): CampaignChatDraft {
  const now = new Date().toISOString();
  return {
    ...draft,
    status: as,
    dirty: false,
    updatedAt: now,
    launchedAt: now,
    schedule: draft.schedule === "Not set yet" ? "Scheduled now" : draft.schedule,
  };
}

export function statusLabel(status: CampaignDraftStatus): string {
  switch (status) {
    case "empty":
      return "New";
    case "drafting":
      return "In progress";
    case "draft_saved":
      return "Draft";
    case "ready":
      return "Ready";
    case "scheduled":
      return "Scheduled";
    case "live":
      return "Live";
    case "completed":
      return "Completed";
    case "cancelled":
      return "Cancelled";
    default:
      return status;
  }
}

export function formatRelativeTime(iso: string): string {
  const t = new Date(iso).getTime();
  const diff = Date.now() - t;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}
