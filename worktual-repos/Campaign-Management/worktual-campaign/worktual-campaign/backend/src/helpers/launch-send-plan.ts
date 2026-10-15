import { toAgentChannel } from "./channel-ids.js";

/** Channels that freeze audience destinations into send batches on launch. */
const SENDABLE_CHANNELS = new Set(["email", "web", "push", "whatsapp"]);

/** How long launch may sit live with no batches before we treat planning as finished. */
export const LAUNCH_SEND_PLANNING_GRACE_MS = 10 * 60 * 1000;

export function isSendableLaunchChannel(raw: string): boolean {
  return SENDABLE_CHANNELS.has(toAgentChannel(raw));
}

/** Draft/cancelled never get new send batches. Completed is allowed so a too-early Past flip cannot drop remaining channels. */
export function canPlanLaunchBatches(status: string): boolean {
  const s = String(status || "").toLowerCase();
  return s !== "draft" && s !== "cancelled";
}

export function readSendPlannedAt(launchPlan: unknown): string | null {
  if (!launchPlan || typeof launchPlan !== "object") return null;
  const v = (launchPlan as Record<string, unknown>).send_planned_at;
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/** JSON flag set on on-demand API launches (excluded from Live / Scheduled / Past). */
export const ON_DEMAND_LAUNCH_FLAG = "on_demand";

/** JSON flag set on CRM Personalised CRM runs (own monitor tab; not Hub on-demand). */
export const PERSONALISED_CRM_LAUNCH_FLAG = "personalised_crm";

function launchPlanFlag(launchPlan: unknown, key: string): boolean {
  return Boolean(
    launchPlan &&
      typeof launchPlan === "object" &&
      !Array.isArray(launchPlan) &&
      (launchPlan as Record<string, unknown>)[key] === true,
  );
}

export function isOnDemandLaunchPlan(launchPlan: unknown): boolean {
  return launchPlanFlag(launchPlan, ON_DEMAND_LAUNCH_FLAG);
}

export function isPersonalisedCrmLaunchPlan(launchPlan: unknown): boolean {
  return launchPlanFlag(launchPlan, PERSONALISED_CRM_LAUNCH_FLAG);
}

/** Full CDP cdp_id strings for frozen audience (Hub webtracking opaque ids). */
export function readAudienceCdpLookupIds(launchPlan: unknown): string[] {
  if (!launchPlan || typeof launchPlan !== "object" || Array.isArray(launchPlan)) {
    return [];
  }
  const raw = (launchPlan as Record<string, unknown>).audience_cdp_ids;
  if (!Array.isArray(raw)) return [];
  return [
    ...new Set(
      raw.map((id) => String(id || "").trim()).filter(Boolean),
    ),
  ];
}

/** Hub/spoke/CRM one-to-one sends — operator picked the recipient explicitly. */
export function bypassEmailSuppressionForLaunch(launchPlan: unknown): boolean {
  if (!launchPlan || typeof launchPlan !== "object" || Array.isArray(launchPlan)) {
    return false;
  }
  if (isPersonalisedCrmLaunchPlan(launchPlan)) return true;
  if (!isOnDemandLaunchPlan(launchPlan)) return false;
  const hub = String(
    (launchPlan as Record<string, unknown>).hub_source || "",
  )
    .trim()
    .toLowerCase();
  return hub === "hub" || hub === "spoke" || hub === "internal";
}

/** Hub on-demand + Personalised CRM — keep out of Live / Scheduled / Past. */
export function isIsolatedLaunchPlan(launchPlan: unknown): boolean {
  return isOnDemandLaunchPlan(launchPlan) || isPersonalisedCrmLaunchPlan(launchPlan);
}

/**
 * Prisma `NOT: { launchPlan: { path: ["on_demand"], equals: true } }` is unsafe:
 * missing JSON keys become SQL NULL, so every normal campaign is dropped from lists.
 * Prefer a positive `equals: true` match (works) and subtract / filter in JS.
 */
export const onDemandLaunchPlanPrismaFilter = {
  launchPlan: {
    path: [ON_DEMAND_LAUNCH_FLAG],
    equals: true,
  },
} as const;

export const personalisedCrmLaunchPlanPrismaFilter = {
  launchPlan: {
    path: [PERSONALISED_CRM_LAUNCH_FLAG],
    equals: true,
  },
} as const;

/**
 * True while from-session is still creating per-channel batches.
 * Lifecycle must not mark Past until this is false, or email-only can finish
 * and cancel web/push/whatsapp before those channels are planned.
 */
export function isLaunchSendPlanningOpen(args: {
  createdAt: Date | string | null | undefined;
  launchPlan: unknown;
  channelKeys: string[];
}): boolean {
  const sendable = args.channelKeys
    .map((c) => toAgentChannel(c))
    .filter((c) => SENDABLE_CHANNELS.has(c));
  if (!sendable.length) return false;
  if (readSendPlannedAt(args.launchPlan)) return false;
  const created =
    args.createdAt instanceof Date
      ? args.createdAt
      : args.createdAt
        ? new Date(args.createdAt)
        : null;
  if (!created || Number.isNaN(created.getTime())) return true;
  return Date.now() - created.getTime() < LAUNCH_SEND_PLANNING_GRACE_MS;
}
