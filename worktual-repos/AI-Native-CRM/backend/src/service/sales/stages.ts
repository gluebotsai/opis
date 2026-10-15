import type { ActivityType, DealStage, LocationType } from "@prisma/client";

export const DEAL_STAGES: DealStage[] = [
  "qualification",
  "discover",
  "propose",
  "negotiate",
  "closed_won",
  "closed_lost",
];

const DEAL_STAGE_ALIASES: Record<string, DealStage> = {
  qualify: "qualification",
  qualified: "qualification",
  qualification: "qualification",
  discover: "discover",
  discovery: "discover",
  propose: "propose",
  proposal: "propose",
  negotiate: "negotiate",
  negotiation: "negotiate",
  won: "closed_won",
  closed_won: "closed_won",
  lost: "closed_lost",
  closed_lost: "closed_lost",
};

/** Map a chat/tool label onto a stored DealStage. "proposal" is the Propose column. */
export function normalizeDealStage(
  raw: string | null | undefined,
): DealStage | null {
  if (!raw?.trim()) return null;
  const key = raw.trim().toLowerCase().replace(/[\s-]+/g, "_");
  const resolved = DEAL_STAGE_ALIASES[key];
  if (resolved) return resolved;
  return DEAL_STAGES.includes(key as DealStage) ? (key as DealStage) : null;
}

export const DEAL_STAGE_LABELS: Record<DealStage, string> = {
  qualification: "Qualify",
  discover: "Discover",
  propose: "Propose",
  negotiate: "Negotiate",
  closed_won: "Closed won",
  closed_lost: "Closed lost",
};

/** Compact labels for Kanban column headers */
export const DEAL_STAGE_SHORT_LABELS: Record<DealStage, string> = {
  qualification: "Qualify",
  discover: "Discover",
  propose: "Propose",
  negotiate: "Negotiate",
  closed_won: "Won",
  closed_lost: "Lost",
};

export const DEAL_STAGE_OPTIONS = DEAL_STAGES.map((value) => ({
  value,
  label: DEAL_STAGE_LABELS[value],
}));

export function nextDealStage(stage: DealStage): DealStage | null {
  if (stage === "negotiate") return "closed_won";
  if (stage === "closed_won" || stage === "closed_lost") return null;
  const idx = DEAL_STAGES.indexOf(stage);
  if (idx < 0 || idx >= DEAL_STAGES.length - 1) return null;
  return DEAL_STAGES[idx + 1];
}

export function stageAccentClass(stage: DealStage): string {
  switch (stage) {
    case "closed_won":
      return "bg-[#0e8f50]";
    case "closed_lost":
      return "bg-[#c73e32]";
    case "negotiate":
      return "bg-[#1869d3]";
    case "propose":
    case "discover":
      return "bg-brand";
    case "qualification":
      return "bg-violet-700";
    default:
      return "bg-neutral-400";
  }
}

export const LOCATION_TYPE_LABELS: Record<LocationType, string> = {
  hq: "HQ",
  branch: "Branch",
};

export const ACTIVITY_TYPES: ActivityType[] = [
  "call",
  "meeting",
  "email",
  "sms",
  "note",
  "task",
];

export const ACTIVITY_TYPE_LABELS: Record<ActivityType, string> = {
  call: "Call",
  meeting: "Meeting",
  email: "Email",
  sms: "SMS",
  note: "Note",
  task: "Task",
};

export const ACTIVITY_TYPE_OPTIONS = ACTIVITY_TYPES.map((value) => ({
  value,
  label: ACTIVITY_TYPE_LABELS[value],
}));

export function isTerminalStage(stage: DealStage): boolean {
  return stage === "closed_won" || stage === "closed_lost";
}

export function initialsFromName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}

const AVATAR_COLORS = [
  "bg-violet-600",
  "bg-violet-700",
  "bg-neutral-700",
  "bg-violet-800",
  "bg-neutral-800",
  "bg-[#1869d3]",
  "bg-[#0e8f50]",
  "bg-[#874400]",
] as const;

export function avatarColorFromName(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  }
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

export function stageBadgeClass(stage: DealStage): string {
  switch (stage) {
    case "closed_won":
      return "bg-[#e8f8ef] text-text-success";
    case "closed_lost":
      return "bg-[#fdecea] text-text-danger";
    case "negotiate":
      return "bg-[#e8f1fc] text-text-info";
    case "propose":
    case "discover":
      return "bg-violet-0 text-brand";
    default:
      return "bg-neutral-100 text-text-secondary";
  }
}
