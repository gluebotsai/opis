import { isPlaceholderDraftName } from "@/lib/campaign-drafts";
import type { CampaignAgentState } from "@/services/agents.socket";

/** Ordered setup fields — filled one-by-one; UI shows green tick when complete. */
export type CampaignGuidedKey =
  | "name"
  | "goal"
  | "objective"
  | "audience"
  | "channels"
  | "templates"
  | "launch"
  | "other";

export type CampaignGuidedFieldDef = {
  key: CampaignGuidedKey;
  label: string;
  optional?: boolean;
};

export const CAMPAIGN_GUIDED_FIELDS: CampaignGuidedFieldDef[] = [
  { key: "name", label: "Campaign name" },
  { key: "goal", label: "Goal" },
  { key: "objective", label: "Objective" },
  { key: "audience", label: "Audience" },
  { key: "channels", label: "Channels" },
  { key: "templates", label: "Templates" },
  { key: "launch", label: "Launch" },
  { key: "other", label: "Other", optional: true },
];

export type CampaignGuidedSnapshot = {
  name: string;
  goal: string;
  objective: string;
  audienceCount: number | null;
  audienceSamples: string[];
  audienceFiltersLabel: string;
  channels: string[];
  templateCount: number;
  /** When set, overrides the default "N cards" templates label (e.g. Email A/B). */
  templatesLabel?: string;
  launchLabel: string;
  sendTimeLabel: string;
  otherLabel: string;
};

/** Draft/list placeholders that must not count as collected field values. */
const EMPTY_FIELD_PLACEHOLDERS = new Set([
  "not set yet",
  "—",
  "-",
  "n/a",
  "waiting",
]);

function realFieldText(value: unknown): string {
  const s = String(value || "").trim();
  if (!s) return "";
  if (EMPTY_FIELD_PLACEHOLDERS.has(s.toLowerCase())) return "";
  return s;
}

function hasText(value: unknown): boolean {
  return realFieldText(value) !== "";
}

export function isCampaignFieldComplete(
  key: CampaignGuidedKey,
  snap: CampaignGuidedSnapshot,
): boolean {
  if (key === "name") return hasText(snap.name);
  if (key === "goal") return hasText(snap.goal);
  if (key === "objective") return hasText(snap.objective);
  if (key === "audience") {
    return snap.audienceCount != null && snap.audienceCount > 0;
  }
  if (key === "channels") return snap.channels.length > 0;
  if (key === "templates") {
    return (
      snap.templateCount > 0 ||
      Boolean(snap.templatesLabel && !snap.templatesLabel.includes(": 0"))
    );
  }
  if (key === "launch") {
    return /live|scheduled|launch now|immediate/i.test(snap.launchLabel);
  }
  if (key === "other") return hasText(snap.otherLabel);
  return false;
}

/** @deprecated use isCampaignFieldComplete for name/goal/objective */
export function campaignIdeaHasAny(snap: CampaignGuidedSnapshot): boolean {
  return (
    hasText(snap.name) || hasText(snap.goal) || hasText(snap.objective)
  );
}

export function campaignIdeaComplete(snap: CampaignGuidedSnapshot): boolean {
  return hasText(snap.name) && hasText(snap.goal) && hasText(snap.objective);
}

/**
 * When the assistant asked a question, align the overview highlight with that topic.
 * Order matters: prefer name/goal/templates over bare "email" (which appears in
 * "email template" / "Channel: Email ✅" recaps and used to wrongly light Channels).
 */
export function inferNextKeyFromAssistantQuestion(
  text: string,
): CampaignGuidedKey | null {
  const q = String(text || "").trim().toLowerCase();
  if (!q.includes("?")) return null;

  // Name / title — including "does X work as the campaign name?"
  if (
    /\b(campaign\s+name|name\s+for\s+(this|the)\s+campaign|call (it|this)|title)\b/.test(
      q,
    ) ||
    /\bas the (campaign )?name\b/.test(q) ||
    /\b(lock (these|this|it) in|lock in (the )?(name|details))\b/.test(q)
  ) {
    return "name";
  }
  if (/\bobjective\b/.test(q)) return "objective";
  if (/\bgoal\b/.test(q)) return "goal";
  if (/\b(who|audience|contact|reach|people|person|named|recipient)\b/.test(q)) {
    return "audience";
  }
  // Templates before channels — "generate the email template" is not a channel ask
  if (/\b(template|generate the email|regenerate|create (an? )?email)\b/.test(q)) {
    return "templates";
  }
  if (/\b(launch|schedule|send now|when to send|a\/b|ab test|split test)\b/.test(q)) {
    return "launch";
  }
  // Channels only on explicit channel-choice wording (not bare "email")
  if (
    /\b(which\s+channels?|what\s+channels?|channels?\s*[?:]|channel\s*[?:])\b/.test(
      q,
    ) ||
    /\b(web\s*push|webpush|whatsapp|app\s*push|apppush)\b/.test(q) ||
    /\b(email\s+only|email\s+channel|channel:\s*email)\b/.test(q)
  ) {
    return "channels";
  }
  if (/\b(name|idea|campaign)\b/.test(q)) return "name";
  return null;
}

export function computeMissingCampaignKeys(
  snap: CampaignGuidedSnapshot,
): CampaignGuidedKey[] {
  return CAMPAIGN_GUIDED_FIELDS.filter(
    ({ key, optional }) => !optional && !isCampaignFieldComplete(key, snap),
  ).map(({ key }) => key);
}

export function displayCampaignGuidedValue(
  key: CampaignGuidedKey,
  snap: CampaignGuidedSnapshot,
): string {
  if (key === "name") return realFieldText(snap.name);
  if (key === "goal") return realFieldText(snap.goal);
  if (key === "objective") return realFieldText(snap.objective);
  if (key === "audience") {
    if (snap.audienceCount != null && snap.audienceCount > 0) {
      const extra = snap.audienceFiltersLabel
        ? ` · ${snap.audienceFiltersLabel}`
        : "";
      const samples = snap.audienceSamples.length
        ? `\n${snap.audienceSamples.slice(0, 5).join(", ")}`
        : "";
      return `${snap.audienceCount} selected${extra}${samples}`;
    }
    if (snap.audienceFiltersLabel) {
      return `Suggested: ${snap.audienceFiltersLabel}`;
    }
    return "";
  }
  if (key === "channels") return snap.channels.join(", ");
  if (key === "templates") {
    if (snap.templatesLabel) return snap.templatesLabel;
    if (snap.templateCount <= 0) return "";
    return `${snap.templateCount} card${snap.templateCount === 1 ? "" : "s"}`;
  }
  if (key === "launch") {
    if (!hasText(snap.launchLabel) || snap.launchLabel === "—") return "";
    if (snap.sendTimeLabel && snap.sendTimeLabel !== "Not planned yet") {
      return `${snap.launchLabel}\n${snap.sendTimeLabel}`;
    }
    return snap.launchLabel;
  }
  return snap.otherLabel;
}

export function guidedCampaignTitle(snap: CampaignGuidedSnapshot): string {
  return snap.name.trim() || "New campaign";
}

function filterLabel(filters: Record<string, unknown> | undefined): string {
  if (!filters) return "";
  return Object.entries(filters)
    .filter(([, v]) => v != null && String(v).trim() !== "")
    .map(([k, v]) => `${k}=${String(v)}`)
    .join(", ");
}

function audienceCountFromState(
  audience: CampaignAgentState["audience"] | undefined,
): number | null {
  if (!audience) return null;
  const matched =
    audience.matched_count != null ? Number(audience.matched_count) : null;
  if (matched != null && Number.isFinite(matched) && matched > 0) return matched;

  const filters = audience.filters || {};
  const emails = Array.isArray(filters.emails) ? filters.emails : [];
  const phones = Array.isArray(filters.phones) ? filters.phones : [];
  const pasted = emails.length + phones.length;
  if (pasted > 0) return pasted;

  return matched != null && Number.isFinite(matched) ? matched : null;
}

function emailAbTemplatesLabel(
  templates: CampaignAgentState["templates"] | undefined,
): string | undefined {
  const cards = Array.isArray(templates) ? templates : [];
  const emailAb = cards.find((t) => {
    if (String(t?.channel || "").toLowerCase() !== "email") return false;
    const fields = (t?.fields || {}) as Record<string, unknown>;
    if (fields.ab_test === true) return true;
    return (
      fields.variant_a != null &&
      typeof fields.variant_a === "object" &&
      fields.variant_b != null &&
      typeof fields.variant_b === "object"
    );
  });
  if (!emailAb) return undefined;
  if (cards.length === 1) return "Email A/B · 2 variants";
  return `${cards.length} cards · Email A/B`;
}

export function snapshotFromCampaignState(input: {
  agentState: CampaignAgentState | null;
  draftName?: string;
  draftGoal?: string;
  draftObjective?: string;
  templateCount: number;
  templatesLabel?: string;
  sendTimeLabelOverride?: string;
  selectedChannelLabels: string[];
}): CampaignGuidedSnapshot {
  const state = input.agentState;
  const camp = state?.campaign || {};
  const audience = state?.audience || {};
  const plan = state?.launch_plan;
  const mode = String(plan?.schedule_mode || "").toLowerCase();
  let launchLabel = "—";
  if (state?.launch_confirmed) {
    launchLabel =
      mode === "now" ||
      mode === "immediate" ||
      String(state?.stage || "").toLowerCase() === "live"
        ? "Live / launch now"
        : "Scheduled";
  }

  let sendTimeLabel = input.sendTimeLabelOverride || "Not planned yet";
  if (!input.sendTimeLabelOverride && state?.launch_confirmed && plan) {
    if (mode === "now" || mode === "immediate") {
      sendTimeLabel = "Immediate (launch now)";
    } else if (plan.launch_local_date && plan.launch_local_time) {
      const tz = plan.timezone ? ` · ${plan.timezone}` : "";
      sendTimeLabel = `${plan.launch_local_date} ${plan.launch_local_time}${tz}`;
    } else if (plan.scheduled_at) {
      const tz = plan.timezone ? ` · ${plan.timezone}` : "";
      sendTimeLabel = `At ${plan.scheduled_at}${tz}`;
    }
  } else if (!input.sendTimeLabelOverride && plan?.launch_local_date && plan?.launch_local_time) {
    const tz = plan.timezone ? ` · ${plan.timezone}` : "";
    sendTimeLabel = `${plan.launch_local_date} ${plan.launch_local_time}${tz}`;
  }

  const otherBits: string[] = [];
  const formUrl = String(state?.form_url || state?.form_launch?.public_url || "").trim();
  if (formUrl) otherBits.push(`Form: ${formUrl}`);
  if (plan?.ab_enabled) {
    const pctA = plan.ab_pct_a ?? 20;
    const pctB = plan.ab_pct_b ?? 20;
    const pctH = plan.ab_pct_holdout ?? 60;
    const waitMin = plan.ab_decide_after_minutes ?? 15;
    const auto =
      plan.ab_auto === false
        ? "manual winner"
        : `auto winner after ${waitMin} min`;
    otherBits.push(
      `Email A/B ${pctA}% A / ${pctB}% B / ${pctH}% holdout · ${auto}`,
    );
  }
  if (plan?.primary_channel) {
    otherBits.push(`Prefer ${plan.primary_channel}`);
  }
  if (plan?.scheduled_at || (plan?.launch_local_date && plan?.launch_local_time)) {
    const when =
      plan.launch_local_date && plan.launch_local_time
        ? `${plan.launch_local_date} ${plan.launch_local_time}`
        : String(plan.scheduled_at || "");
    if (when && !state?.launch_confirmed) otherBits.push(`Planned send: ${when}`);
  }

  const count = audienceCountFromState(audience);

  // Placeholder UI titles ("New campaign") must not count as a filled field.
  const rawName = String(camp.name || input.draftName || "").trim();
  const name = isPlaceholderDraftName(rawName) ? "" : rawName;

  return {
    name,
    goal: realFieldText(camp.goal || input.draftGoal),
    objective: realFieldText(camp.objective || input.draftObjective),
    audienceCount: count,
    audienceSamples: (audience.sample_names || []).map(String).filter(Boolean),
    audienceFiltersLabel:
      filterLabel(audience.filters) ||
      String(audience.description || "").trim(),
    channels: input.selectedChannelLabels,
    templateCount: input.templateCount,
    templatesLabel:
      input.templatesLabel || emailAbTemplatesLabel(state?.templates),
    launchLabel,
    sendTimeLabel,
    otherLabel: otherBits.join("\n"),
  };
}
