/**
 * Positive channel → employee binding from a Google Meet roster.
 *
 * MEET_CHANNEL_BINDINGS:
 *   0       — off. hostMeetName only. No roster lookup.
 *   shadow  — run roster, People lookup, and binding, and log both verdicts.
 *             Coaching still follows hostMeetName.
 *   1       — on. Each employee's configured Google mailbox identifies that
 *             employee. Tiles no mailbox recognizes are the customer.
 *             This is the CRM setup default (see .env).
 *
 * With tile labels present, a caption joins a participant by the exact Meet
 * tile. Time correlation remains only for roster rows that have no tile label.
 */

export type MeetChannelBindingsMode = "off" | "shadow" | "on";

export const BIND_CONFIRM_TURNS = 2;
export const DUPLICATE_CHANNEL_WINDOW_MS = 1_500;

export type RosterStatus = "pending" | "ready" | "failed";

export type MeetRosterEntry = {
  email: string;
  userId: string;
  earliestStartMs: number;
  latestEndMs: number | null;
  /** Meet tile label from the participant record. Exact match only. */
  displayName?: string;
};

export type ChannelBinding = {
  channel: string;
  email: string;
  userId: string;
  confirmedTurns: number;
  glow: string;
  firstActivityMs: number;
};

export type ChannelBindingState = {
  rosterStatus: RosterStatus;
  roster: MeetRosterEntry[];
  /** CRM employee emails. A roster row outside this set is not an employee. */
  employeeEmails: string[];
  /**
   * Meet tile labels for signed-in participants no employee mailbox recognized.
   * Exact match with the caption labels that person as the customer.
   */
  customerTiles?: string[];
  bindings: ChannelBinding[];
};

export type RecentEmployeeSpeech = {
  channel: string;
  fingerprint: string;
  atMs: number;
  email: string;
  userId: string;
};

export type ChannelBindingLog = {
  channel: string;
  email: string | null;
  activityAtMs: number;
  earliestStartMs: number | null;
  candidateCount: number;
  reason: string;
};

export type ChannelBindingDecision = {
  /** host = employee. customer = a recognized non-employee tile. unknown = do not coach. defer = existing classifier. */
  role: "host" | "unknown" | "defer" | "customer";
  email: string | null;
  userId: string | null;
  coaching: false | "defer";
  state: ChannelBindingState;
  recentEmployee: RecentEmployeeSpeech | null;
  log: ChannelBindingLog;
};

const UNRESOLVED_GLOW = /^(speaker|unknown)$/i;

export function meetChannelBindingsMode(
  env: NodeJS.ProcessEnv = process.env,
): MeetChannelBindingsMode {
  const raw = (env.MEET_CHANNEL_BINDINGS || "").trim().toLowerCase();
  if (raw === "1") return "on";
  if (raw === "shadow") return "shadow";
  return "off";
}

/** True only for MEET_CHANNEL_BINDINGS=1. Shadow must not change coaching. */
export function meetChannelBindingsEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return meetChannelBindingsMode(env) === "on";
}

/** `users/123` → `123`. Comparison only — never a binding input. */
export function rosterUserNumericId(userId: string): string {
  const raw = userId.trim();
  return raw.startsWith("users/") ? raw.slice("users/".length) : raw;
}

export function googleSubMatchesRoster(input: {
  googleSubs: string[];
  userIds: string[];
}): { equal: boolean; matches: Array<{ googleSub: string; userId: string }> } {
  const matches: Array<{ googleSub: string; userId: string }> = [];
  for (const googleSub of input.googleSubs) {
    const sub = googleSub.trim();
    if (!sub) continue;
    for (const userId of input.userIds) {
      if (sub === rosterUserNumericId(userId)) matches.push({ googleSub: sub, userId });
    }
  }
  return { equal: matches.length > 0, matches };
}

export function speechFingerprint(text: string | null | undefined): string {
  return (text || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function normEmail(email: string): string {
  return email.trim().toLowerCase();
}

function employeeSet(emails: string[]): Set<string> {
  return new Set(emails.map(normEmail).filter((email) => email.includes("@")));
}

function isRealGlow(glow: string): boolean {
  const name = glow.trim();
  return Boolean(name) && !UNRESOLVED_GLOW.test(name);
}

const CAPTURE_BOT = /notetaker|worktual\s+capture/i;

export function isCaptureBotName(name: string): boolean {
  return CAPTURE_BOT.test(name.trim());
}

function sameTile(a: string, b: string): boolean {
  return norm(a) === norm(b);
}

function norm(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function cloneState(state: ChannelBindingState): ChannelBindingState {
  return {
    rosterStatus: state.rosterStatus,
    roster: state.roster.map((row) => ({ ...row })),
    employeeEmails: [...state.employeeEmails],
    customerTiles: state.customerTiles ? [...state.customerTiles] : undefined,
    bindings: state.bindings.map((row) => ({ ...row })),
  };
}

function activeUnbound(
  state: ChannelBindingState,
  activityAtMs: number,
  skipChannel: string,
): MeetRosterEntry[] {
  const employees = employeeSet(state.employeeEmails);
  const taken = new Set(
    state.bindings
      .filter((row) => row.channel !== skipChannel && row.confirmedTurns >= 1)
      .map((row) => normEmail(row.email)),
  );
  return state.roster.filter((row) => {
    const email = normEmail(row.email);
    if (!employees.has(email) || taken.has(email)) return false;
    if (row.earliestStartMs > activityAtMs) return false;
    if (row.latestEndMs != null && row.latestEndMs <= activityAtMs) return false;
    return true;
  });
}

function logOf(
  channel: string,
  activityAtMs: number,
  email: string | null,
  candidates: MeetRosterEntry[],
  reason: string,
): ChannelBindingLog {
  const only = candidates.length === 1 ? candidates[0]! : null;
  return {
    channel,
    email,
    activityAtMs,
    earliestStartMs: only?.earliestStartMs ?? null,
    candidateCount: candidates.length,
    reason,
  };
}

/**
 * Still-active, unbound roster match. More than one candidate holds.
 * A confirmed binding is re-armed when the glow changes to a different
 * real name, because Meet can reuse the channel slot.
 */
export function decideChannelBinding(input: {
  channel: string;
  glow?: string | null;
  activityAtMs: number;
  utteranceText?: string | null;
  state: ChannelBindingState;
  recentEmployee?: RecentEmployeeSpeech | null;
}): ChannelBindingDecision {
  const state = cloneState(input.state);
  const channel = input.channel.trim().toLowerCase();
  const glow = (input.glow || "").trim();
  const fingerprint = speechFingerprint(input.utteranceText);
  const recent = input.recentEmployee ?? null;

  const deny = (
    reason: string,
    candidates: MeetRosterEntry[] = [],
    email: string | null = null,
  ): ChannelBindingDecision => ({
    role: "unknown",
    email,
    userId: null,
    coaching: false,
    state,
    recentEmployee: recent,
    log: logOf(channel, input.activityAtMs, email, candidates, reason),
  });

  if (!channel) return deny("missing_channel");

  if (
    recent &&
    fingerprint &&
    recent.channel !== channel &&
    recent.fingerprint === fingerprint &&
    input.activityAtMs - recent.atMs <= DUPLICATE_CHANNEL_WINDOW_MS &&
    input.activityAtMs >= recent.atMs
  ) {
    const copied: ChannelBinding = {
      channel,
      email: normEmail(recent.email),
      userId: recent.userId,
      confirmedTurns: BIND_CONFIRM_TURNS,
      glow: isRealGlow(glow) ? glow : "",
      firstActivityMs: input.activityAtMs,
    };
    const without = state.bindings.filter((row) => row.channel !== channel);
    state.bindings = [...without, copied];
    return {
      role: "host",
      email: copied.email,
      userId: copied.userId,
      coaching: false,
      state,
      recentEmployee: recent,
      log: logOf(channel, input.activityAtMs, copied.email, [], "duplicate_channel"),
    };
  }

  const existing = state.bindings.find((row) => row.channel === channel) ?? null;
  const glowChanged =
    existing != null &&
    isRealGlow(glow) &&
    isRealGlow(existing.glow) &&
    glow.trim().toLowerCase() !== existing.glow.trim().toLowerCase();
  if (glowChanged) {
    state.bindings = state.bindings.filter((row) => row.channel !== channel);
  }

  if (state.rosterStatus !== "ready") {
    return deny(state.rosterStatus === "failed" ? "roster_failed" : "roster_pending");
  }
  if (state.employeeEmails.length === 0) return deny("employee_list_missing");

  const tileDecision = decideByMeetTile(state, channel, glow, input.activityAtMs, recent);
  if (tileDecision) return tileDecision;

  const activityAtMs =
    !glowChanged && existing ? existing.firstActivityMs : input.activityAtMs;
  const candidates = activeUnbound(state, activityAtMs, channel);

  if (candidates.length === 0) {
    const inProgress = state.bindings.some(
      (row) => row.channel !== channel && row.confirmedTurns < BIND_CONFIRM_TURNS,
    );
    if (inProgress) return deny("awaiting_other_confirmation");
    return {
      role: "defer",
      email: null,
      userId: null,
      coaching: "defer",
      state,
      recentEmployee: recent,
      log: logOf(channel, activityAtMs, null, candidates, "no_employee_candidate"),
    };
  }
  if (candidates.length !== 1) {
    return deny("ambiguous_candidates", candidates);
  }

  const person = candidates[0]!;
  const prior = state.bindings.find((row) => row.channel === channel);
  const samePerson = prior && normEmail(prior.email) === normEmail(person.email);
  const confirmedTurns = (samePerson ? prior.confirmedTurns : 0) + 1;
  const binding: ChannelBinding = {
    channel,
    email: normEmail(person.email),
    userId: person.userId,
    confirmedTurns,
    glow: isRealGlow(glow) ? glow : prior?.glow || "",
    firstActivityMs: activityAtMs,
  };
  state.bindings = [
    ...state.bindings.filter((row) => row.channel !== channel),
    binding,
  ];

  if (confirmedTurns < BIND_CONFIRM_TURNS) {
    return {
      role: "unknown",
      email: binding.email,
      userId: binding.userId,
      coaching: false,
      state,
      recentEmployee: recent,
      log: logOf(channel, activityAtMs, binding.email, candidates, "awaiting_confirmation"),
    };
  }

  const nextRecent =
    fingerprint
      ? {
          channel,
          fingerprint,
          atMs: input.activityAtMs,
          email: binding.email,
          userId: binding.userId,
        }
      : recent;

  return {
    role: "host",
    email: binding.email,
    userId: binding.userId,
    coaching: false,
    state,
    recentEmployee: nextRecent,
    log: logOf(channel, activityAtMs, binding.email, candidates, "bound_employee"),
  };
}

/**
 * A customer tile or a deferred channel may be coached. An employee tile
 * may not. Pending and ambiguous stay silent.
 */
export function channelResolutionForAssist(
  decision: ChannelBindingDecision,
): "employee" | "pending" | "ambiguous" | "ready-unbound" {
  if (decision.role === "customer" || decision.role === "defer") return "ready-unbound";
  if (decision.role === "host") return "employee";
  if (decision.log.reason === "ambiguous_candidates" || decision.log.reason === "ambiguous_tile") {
    return "ambiguous";
  }
  return "pending";
}

/**
 * Employee mailboxes already identified staff. Exact tile match binds those
 * employees. Anyone else — including a leftover caption that still says
 * "Speaker" — is the customer. The capture bot is never coached.
 * Returns null when this roster has no tile labels, so the older
 * time-correlation path stays in place for those rows.
 */
function decideByMeetTile(
  state: ChannelBindingState,
  channel: string,
  glow: string,
  activityAtMs: number,
  recent: RecentEmployeeSpeech | null,
): ChannelBindingDecision | null {
  const employees = employeeSet(state.employeeEmails);
  const employeeRows = state.roster.filter(
    (row) => row.displayName && employees.has(normEmail(row.email)),
  );
  const customerTiles = (state.customerTiles || []).filter((name) => name.trim() && !isCaptureBotName(name));
  if (employeeRows.length === 0 && customerTiles.length === 0) return null;

  const denyTile = (reason: string): ChannelBindingDecision => ({
    role: "unknown",
    email: null,
    userId: null,
    coaching: false,
    state,
    recentEmployee: recent,
    log: logOf(channel, activityAtMs, null, [], reason),
  });
  const asCustomer = (reason: string): ChannelBindingDecision => ({
    role: "customer",
    email: null,
    userId: null,
    coaching: false,
    state,
    recentEmployee: recent,
    log: logOf(channel, activityAtMs, null, [], reason),
  });

  if (isCaptureBotName(glow)) return denyTile("unmatched_tile");
  const employeeHits = isRealGlow(glow)
    ? employeeRows.filter((row) => sameTile(row.displayName || "", glow))
    : [];
  const customerHits = isRealGlow(glow)
    ? customerTiles.filter((name) => sameTile(name, glow))
    : [];
  if (employeeHits.length === 1 && customerHits.length === 0) {
    const person = employeeHits[0]!;
    const binding: ChannelBinding = {
      channel,
      email: normEmail(person.email),
      userId: person.userId,
      confirmedTurns: BIND_CONFIRM_TURNS,
      glow: glow.trim(),
      firstActivityMs: activityAtMs,
    };
    state.bindings = [...state.bindings.filter((row) => row.channel !== channel), binding];
    return {
      role: "host",
      email: binding.email,
      userId: binding.userId,
      coaching: false,
      state,
      recentEmployee: recent,
      log: logOf(channel, activityAtMs, binding.email, [person], "bound_employee_tile"),
    };
  }
  if (customerHits.length === 1 && employeeHits.length === 0) {
    return asCustomer("customer_tile");
  }
  if (employeeHits.length + customerHits.length > 1) return denyTile("ambiguous_tile");
  if (employeeRows.length === 0 && !isRealGlow(glow)) return denyTile("unmatched_tile");
  return asCustomer(customerHits.length ? "customer_tile" : "leftover_non_employee");
}
