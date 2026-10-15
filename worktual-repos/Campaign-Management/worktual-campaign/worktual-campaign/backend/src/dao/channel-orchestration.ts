/**
 * Channel send strategy / PDOA — overlap risk + T0 caps.
 *
 * Default: prefer_primary → at most 1 messaging channel at send time (T0).
 * Staggered: primary at T0; later waves are planned (not auto-fired yet).
 * Broadcast: all selected channels at T0 — only when explicitly chosen.
 */

export type OrchestrationMode = "broadcast" | "prefer_primary" | "staggered";

export type ChannelOrchestrationInput = {
  channels: string[];
  /** Optional preference already chosen by the marketer. */
  primaryChannel?: string | null;
  orchestrationMode?: OrchestrationMode | null;
  /** Audience size for simultaneous-send estimate (optional). */
  audienceCount?: number | null;
  /** Explicit OK to hit every channel at once. */
  broadcastConfirmed?: boolean | null;
};

export type SendStrategyPlan = {
  mode: OrchestrationMode;
  /** Hard product rule: max messaging channels that fire together at T0. */
  t0_channel_cap: 1;
  /** Channels that fire at send time under this mode. */
  t0_channels: string[];
  primary_channel: string | null;
  /** Full priority order for stagger / fallback. */
  channel_sequence: string[];
  /** Human lines the create-campaign agent must show the user. */
  narrative: string[];
  /** Approximate concurrent notifications if every contact has all T0 channels. */
  estimated_simultaneous_sends: number | null;
  requires_broadcast_confirm: boolean;
};

export type ChannelOrchestrationResult = {
  warnings: string[];
  notes: string[];
  overlap_risk: "none" | "low" | "medium" | "high";
  messaging_channels: string[];
  recommended_primary: string | null;
  recommended_sequence: string[];
  suggested_mode: OrchestrationMode;
  send_strategy: SendStrategyPlan;
};

const MESSAGING = new Set(["email", "sms", "whatsapp", "push", "web"]);

/** B2B-friendly priority when picking primary / stagger order. */
const PRIORITY: Record<string, number> = {
  email: 10,
  whatsapp: 8,
  sms: 6,
  push: 4,
  web: 3,
  ppc: 0,
};

function normalizeChannel(raw: string): string {
  const c = String(raw || "").trim().toLowerCase();
  if (c === "app_push" || c === "apppush") return "push";
  if (c === "web_push" || c === "webpush") return "web";
  return c;
}

function sortByPriority(channels: string[]): string[] {
  return [...channels].sort(
    (a, b) => (PRIORITY[b] ?? 0) - (PRIORITY[a] ?? 0) || a.localeCompare(b),
  );
}

function resolveMode(
  messagingCount: number,
  requested: OrchestrationMode | null | undefined,
): OrchestrationMode {
  if (
    requested === "broadcast" ||
    requested === "prefer_primary" ||
    requested === "staggered"
  ) {
    return requested;
  }
  if (messagingCount <= 1) return "prefer_primary";
  // Default respect: one channel at T0 — never silent broadcast.
  return "prefer_primary";
}

function buildNarrative(args: {
  mode: OrchestrationMode;
  messaging: string[];
  primary: string | null;
  t0: string[];
  sequence: string[];
  audienceCount: number | null;
  estimated: number | null;
}): string[] {
  const lines: string[] = [];
  const modeLabel =
    args.mode === "broadcast"
      ? "Broadcast (all at once)"
      : args.mode === "staggered"
        ? "Staggered"
        : "Primary only";

  lines.push(`Send strategy: ${modeLabel}`);
  if (args.mode === "broadcast" && args.t0.length > 1) {
    lines.push(
      `At send time (T0): all selected messaging channels (${args.t0.join(", ")}).`,
    );
  } else {
    lines.push("At send time (T0): 1 channel per contact (product cap).");
  }

  if (args.primary) {
    lines.push(`Primary: ${args.primary}`);
  }
  if (args.sequence.length > 1) {
    lines.push(`Priority order: ${args.sequence.join(" → ")}`);
  }
  lines.push(
    `Fires at T0: ${args.t0.length ? args.t0.join(", ") : "(none)"}` +
      (args.mode === "prefer_primary" && args.messaging.length > 1
        ? ` — other selected channels (${args.messaging.filter((c) => !args.t0.includes(c)).join(", ") || "—"}) are not sent at the same time`
        : ""),
  );

  if (args.mode === "staggered" && args.sequence.length > 1) {
    lines.push(
      `Later waves (manual / follow-up): ${args.sequence.slice(1).join(" → ")} only if earlier wave did not engage`,
    );
  }

  if (args.mode === "broadcast" && args.messaging.length > 1) {
    lines.push(
      "Broadcast confirmed: each contact can receive the same campaign on every selected channel at once — use sparingly.",
    );
  }

  if (args.audienceCount != null && args.audienceCount > 0 && args.estimated != null) {
    const worst =
      args.audienceCount * Math.max(args.messaging.length, 1);
    lines.push(
      `Audience ~${args.audienceCount.toLocaleString()} → ~${args.estimated.toLocaleString()} sends at T0` +
        (args.mode !== "broadcast" && args.messaging.length > 1
          ? ` (vs ~${worst.toLocaleString()} if every channel blasted together)`
          : ""),
    );
  }

  return lines.filter(Boolean);
}

/**
 * Pure planner — no DB I/O. Kept async so call sites match other soft-check DAOs.
 */
export async function planChannelOrchestrationDao(
  _session: { organizationId: string } | null,
  input: ChannelOrchestrationInput,
): Promise<ChannelOrchestrationResult> {
  const channels = [
    ...new Set(
      (input.channels || []).map(normalizeChannel).filter(Boolean),
    ),
  ];
  const messaging = channels.filter((c) => MESSAGING.has(c));
  const recommended_sequence = sortByPriority(messaging);
  const primaryRaw = input.primaryChannel
    ? normalizeChannel(input.primaryChannel)
    : null;
  const recommended_primary =
    primaryRaw && messaging.includes(primaryRaw)
      ? primaryRaw
      : (recommended_sequence[0] ?? null);

  const mode = resolveMode(messaging.length, input.orchestrationMode ?? null);

  const warnings: string[] = [];
  const notes: string[] = [];

  let overlap_risk: ChannelOrchestrationResult["overlap_risk"] = "none";
  if (messaging.length === 2) overlap_risk = "medium";
  else if (messaging.length >= 3) overlap_risk = "high";

  // Always suggest respect-first modes when multi-channel.
  const suggested_mode: OrchestrationMode =
    messaging.length <= 1 ? "prefer_primary" : "prefer_primary";

  if (messaging.length <= 1) {
    notes.push(
      messaging.length === 1
        ? `Single messaging channel "${messaging[0]}" — no multi-channel overlap.`
        : "No messaging channels selected for orchestration.",
    );
  } else {
    warnings.push(
      `${messaging.length} messaging channels (${messaging.join(", ")}) can spam the same person if all fire together. ` +
        `Default: send only "${recommended_primary}" at T0 (prefer_primary). ` +
        `Choose staggered for follow-up waves, or broadcast only with explicit confirm.`,
    );
  }

  if (primaryRaw && !messaging.includes(primaryRaw)) {
    warnings.push(
      `Primary channel "${primaryRaw}" is not in the selected messaging channels. Using "${recommended_primary}" instead.`,
    );
  } else if (recommended_primary) {
    notes.push(`Primary channel: "${recommended_primary}".`);
  }

  const requires_broadcast_confirm =
    mode === "broadcast" &&
    messaging.length > 1 &&
    !input.broadcastConfirmed;

  if (requires_broadcast_confirm) {
    warnings.push(
      'Mode "broadcast" would notify each contact on every selected channel at once. ' +
        "Confirm broadcast explicitly, or switch to prefer_primary / staggered.",
    );
  }

  let t0_channels: string[];
  if (messaging.length === 0) {
    t0_channels = [];
  } else if (mode === "broadcast" && input.broadcastConfirmed) {
    t0_channels = [...messaging];
  } else if (mode === "broadcast" && !input.broadcastConfirmed) {
    // Refuse silent blast — fall back to primary until confirmed.
    t0_channels = recommended_primary ? [recommended_primary] : messaging.slice(0, 1);
    notes.push(
      "Broadcast not confirmed — T0 temporarily limited to primary until you confirm.",
    );
  } else {
    // prefer_primary + staggered: one channel at T0
    t0_channels = recommended_primary ? [recommended_primary] : messaging.slice(0, 1);
  }

  if (mode === "prefer_primary" && messaging.length > 1) {
    notes.push(
      `Orchestration "prefer_primary": T0 launch_channels = ["${t0_channels[0]}"]. Other channels are not sent simultaneously.`,
    );
  } else if (mode === "staggered" && recommended_sequence.length > 1) {
    notes.push(
      `Orchestration "staggered": T0 = "${t0_channels[0]}"; later ${recommended_sequence.slice(1).join(" → ")} (follow-up waves — not auto-fired in Phase 1).`,
    );
  } else if (mode === "broadcast" && input.broadcastConfirmed) {
    notes.push(
      'Orchestration "broadcast": all selected channels send at T0 to the same audience.',
    );
  }

  const audienceCount =
    typeof input.audienceCount === "number" && input.audienceCount > 0
      ? Math.floor(input.audienceCount)
      : null;
  const estimated =
    audienceCount != null ? audienceCount * Math.max(t0_channels.length, 0) : null;

  const send_strategy: SendStrategyPlan = {
    mode,
    t0_channel_cap: 1,
    t0_channels,
    primary_channel: recommended_primary,
    channel_sequence: recommended_sequence,
    narrative: buildNarrative({
      mode,
      messaging,
      primary: recommended_primary,
      t0: t0_channels,
      sequence: recommended_sequence,
      audienceCount,
      estimated,
    }),
    estimated_simultaneous_sends: estimated,
    requires_broadcast_confirm,
  };

  return {
    warnings,
    notes,
    overlap_risk,
    messaging_channels: messaging,
    recommended_primary,
    recommended_sequence,
    suggested_mode,
    send_strategy,
  };
}

/** Apply T0 channel list for launch planning from a strategy result. */
export function t0LaunchChannelsFromStrategy(
  strategy: SendStrategyPlan | null | undefined,
  fallbackChannels: string[],
): string[] {
  if (strategy?.t0_channels?.length) return [...strategy.t0_channels];
  const sorted = sortByPriority(
    fallbackChannels.map(normalizeChannel).filter((c) => MESSAGING.has(c)),
  );
  return sorted.slice(0, 1);
}
