/**
 * Persist attendee-turn locks on the assist session so a restart does not
 * reclassify someone who was already identified.
 */

import { prisma } from "@/dao/db/prisma";
import {
  attendeeId,
  channelIdFromSpeakerKey,
  classifyAttendeeTurn,
  type AttendeeLock,
  type AttendeePerson,
  type AttendeeRole,
} from "@/lib/meeting-attendee-identity";
import {
  isCaptureBotName,
  meetChannelBindingsMode,
} from "@/lib/meet-channel-bindings";

const memory = new Map<string, Map<string, AttendeeLock>>();
type RecentAttributedSpeech = {
  fingerprint: string;
  channel: string;
  at: number;
  lock: AttendeeLock;
};

const recentAttributedSpeech = new Map<string, RecentAttributedSpeech>();
const DUPLICATE_CHANNEL_WINDOW_MS = 1_500;

function speechFingerprint(text: string | null | undefined): string {
  return (text || "").trim().toLowerCase().replace(/\s+/g, " ");
}

/** Pure decision used by lockAttendeeTurn and its regression test. */
export function mirrorDuplicateChannelLock(input: {
  sessionId: string;
  channel: string;
  displayName?: string | null;
  utteranceText?: string | null;
  recent?: RecentAttributedSpeech | null;
  now?: number;
}): AttendeeLock | null {
  const fingerprint = speechFingerprint(input.utteranceText);
  const recent = input.recent;
  if (
    !input.channel ||
    !fingerprint ||
    !recent ||
    recent.channel === input.channel ||
    recent.fingerprint !== fingerprint ||
    (input.now ?? Date.now()) - recent.at > DUPLICATE_CHANNEL_WINDOW_MS ||
    (recent.lock.role !== "customer" && recent.lock.role !== "other")
  ) {
    return null;
  }
  return {
    id: attendeeId(input.sessionId, input.channel),
    role: recent.lock.role,
    name: (input.displayName || "").trim() || recent.lock.name,
    email: recent.lock.email,
  };
}

function readTurns(meta: unknown): Map<string, AttendeeLock> {
  const turns = new Map<string, AttendeeLock>();
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return turns;
  const identity = (meta as Record<string, unknown>).attendeeIdentity;
  if (!identity || typeof identity !== "object" || Array.isArray(identity)) return turns;
  const raw = (identity as Record<string, unknown>).turns;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return turns;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const row = value as { id?: unknown; role?: unknown; name?: unknown; email?: unknown };
    const role = row.role;
    if (role !== "host" && role !== "customer" && role !== "other" && role !== "unknown") {
      continue;
    }
    turns.set(key, {
      id: typeof row.id === "string" ? row.id : "",
      role,
      name: typeof row.name === "string" ? row.name : "",
      email: typeof row.email === "string" ? row.email : null,
    });
  }
  return turns;
}

function identityRecord(meta: unknown): Record<string, unknown> | null {
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return null;
  const identity = (meta as Record<string, unknown>).attendeeIdentity;
  if (!identity || typeof identity !== "object" || Array.isArray(identity)) return null;
  return identity as Record<string, unknown>;
}

export function hostMeetNameFromMeta(meta: unknown): string | null {
  const name = identityRecord(meta)?.hostMeetName;
  return typeof name === "string" && name.trim() ? name.trim() : null;
}

export function hostEmailFromMeta(meta: unknown): string | null {
  const email = identityRecord(meta)?.hostEmail;
  return typeof email === "string" && email.includes("@") ? email.trim().toLowerCase() : null;
}

/**
 * Every internal person who has opened the Meet Assist panel for this
 * session (rep, plus pre-sales or anyone else on the org side who joins the
 * call and signs into the add-on) — not just whoever happened to bootstrap
 * first. `hostMeetName`/`hostEmail` above stay as the single "primary"
 * slot for older readers; this list is the superset used for elimination
 * and for excluding every known internal voice from customer coaching.
 */
export function internalIdentitiesFromMeta(
  meta: unknown,
): Array<{ name: string; email: string }> {
  const raw = identityRecord(meta)?.internalIdentities;
  if (!Array.isArray(raw)) return [];
  const out: Array<{ name: string; email: string }> = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const row = item as { name?: unknown; email?: unknown };
    const email =
      typeof row.email === "string" && row.email.includes("@")
        ? row.email.trim().toLowerCase()
        : "";
    if (!email) continue;
    const name = typeof row.name === "string" ? row.name.trim() : "";
    out.push({ name: name || email, email });
  }
  return out;
}

async function persistTurns(sessionId: string, turns: Map<string, AttendeeLock>): Promise<void> {
  const session = await prisma.meetingAssistSession.findUnique({
    where: { id: sessionId },
    select: { meta: true },
  });
  if (!session) return;
  const base =
    session.meta && typeof session.meta === "object" && !Array.isArray(session.meta)
      ? { ...(session.meta as Record<string, unknown>) }
      : {};
  const prev =
    base.attendeeIdentity &&
    typeof base.attendeeIdentity === "object" &&
    !Array.isArray(base.attendeeIdentity)
      ? { ...(base.attendeeIdentity as Record<string, unknown>) }
      : {};
  const encoded: Record<string, AttendeeLock> = {};
  for (const [key, lock] of turns) encoded[key] = lock;
  base.attendeeIdentity = { ...prev, turns: encoded };
  await prisma.meetingAssistSession.update({
    where: { id: sessionId },
    data: { meta: base as object },
  });
}

/**
 * Record one internal (org-side) person's identity for this call — the
 * primary bootstrap caller and every later viewer who opens the panel with
 * their own signed-in Google identity. Each distinct email gets its own
 * slot in `internalIdentities`; the very first one also fills the legacy
 * singular `hostMeetName`/`hostEmail` fields.
 */
export async function rememberInternalIdentity(
  sessionId: string,
  input: { name?: string | null; email?: string | null; googleSub?: string | null },
): Promise<void> {
  const name = (input.name || "").trim();
  const email = (input.email || "").trim().toLowerCase();
  // Stored for a later comparison against Meet `users/{id}`. Not used to
  // bind a channel — that equivalence is still unverified.
  const googleSub = (input.googleSub || "").trim();
  if (!name && !email.includes("@")) return;
  const session = await prisma.meetingAssistSession.findUnique({
    where: { id: sessionId },
    select: { meta: true },
  });
  if (!session) return;
  const base =
    session.meta && typeof session.meta === "object" && !Array.isArray(session.meta)
      ? { ...(session.meta as Record<string, unknown>) }
      : {};
  const prev =
    base.attendeeIdentity &&
    typeof base.attendeeIdentity === "object" &&
    !Array.isArray(base.attendeeIdentity)
      ? { ...(base.attendeeIdentity as Record<string, unknown>) }
      : {};
  const next = { ...prev };
  if (!prev.hostMeetName && name) next.hostMeetName = name;
  if (!prev.hostEmail && email.includes("@")) next.hostEmail = email;

  const priorList = Array.isArray(prev.internalIdentities)
    ? (prev.internalIdentities as Array<{ name?: unknown; email?: unknown; googleSub?: unknown }>)
    : [];
  const list = priorList
    .filter(
      (row) =>
        row && typeof row === "object" && typeof row.email === "string",
    )
    .map((row) => ({
      name: typeof row.name === "string" ? row.name : String(row.email),
      email: String(row.email).trim().toLowerCase(),
      googleSub: typeof row.googleSub === "string" ? row.googleSub : "",
    }));
  let listChanged = false;
  if (email.includes("@")) {
    const idx = list.findIndex((row) => row.email === email);
    if (idx === -1) {
      list.push({ name: name || email, email, googleSub });
      listChanged = true;
    } else if (
      (name && list[idx]!.name !== name) ||
      (googleSub && list[idx]!.googleSub !== googleSub)
    ) {
      list[idx] = {
        name: name || list[idx]!.name,
        email,
        googleSub: googleSub || list[idx]!.googleSub,
      };
      listChanged = true;
    }
  }
  next.internalIdentities = list;

  if (
    !listChanged &&
    next.hostMeetName === prev.hostMeetName &&
    next.hostEmail === prev.hostEmail
  ) {
    return;
  }
  base.attendeeIdentity = next;
  await prisma.meetingAssistSession.update({
    where: { id: sessionId },
    data: { meta: base as object },
  });
}

/** @deprecated use rememberInternalIdentity — kept for older imports. */
export async function rememberHostIdentity(
  sessionId: string,
  input: { name?: string | null; email?: string | null },
): Promise<void> {
  await rememberInternalIdentity(sessionId, input);
}

export async function rememberHostMeetName(sessionId: string, name: string): Promise<void> {
  await rememberInternalIdentity(sessionId, { name });
}

/**
 * Employees are the host (mailbox tile or hostMeetName). The capture bot is
 * skipped. Everyone else is the customer — including leftover "Speaker"
 * captions and lines that arrive before the Google roster is ready.
 */
export function applyMeetBindingDecisionToLock(input: {
  sessionId: string;
  channel: string;
  displayName?: string | null;
  hostPath: AttendeeLock;
  decisionRole: "host" | "unknown" | "defer" | "customer";
  decisionEmail: string | null;
}): {
  next: AttendeeLock;
  channelResolution: NonNullable<AttendeeLock["channelResolution"]>;
} {
  const channel = input.channel.trim() || "unkeyed";
  const id = attendeeId(input.sessionId, channel);
  const label = (input.displayName || "").trim() || "Speaker";
  if (isCaptureBotName(label)) {
    return {
      next: { id, role: "unknown", name: label, email: null },
      channelResolution: "pending",
    };
  }
  if (input.decisionRole === "host" && input.decisionEmail) {
    return {
      next: { id, role: "host", name: label, email: input.decisionEmail },
      channelResolution: "employee",
    };
  }
  if (input.hostPath.role === "host") {
    return { next: input.hostPath, channelResolution: "employee" };
  }
  return {
    next: { id, role: "customer", name: label, email: null },
    channelResolution: "ready-unbound",
  };
}

async function turnsFor(sessionId: string): Promise<Map<string, AttendeeLock>> {
  let turns = memory.get(sessionId);
  if (!turns) {
    const session = await prisma.meetingAssistSession.findUnique({
      where: { id: sessionId },
      select: { meta: true },
    });
    turns = readTurns(session?.meta);
    memory.set(sessionId, turns);
  }
  return turns;
}

export async function lockAttendeeTurn(input: {
  sessionId: string;
  speakerKey?: string | null;
  displayName?: string | null;
  /**
   * Used only to reconcile Vexa's duplicate transport channels: the same
   * finalized utterance can arrive twice, a few milliseconds apart, under
   * two channel ids. Text never grants identity on its own; it may only copy
   * an already-established customer-side lock to that duplicate channel.
   */
  utteranceText?: string | null;
  people: AttendeePerson[];
  hostMeetName?: string | null;
  hostEmail?: string | null;
  /** First speech time on this channel. Not join time. */
  activityAtMs?: number | null;
}): Promise<AttendeeLock> {
  const sessionId = input.sessionId.trim();
  const speakerKey = (input.speakerKey || "").trim();
  const channel = channelIdFromSpeakerKey(speakerKey);
  const turns = await turnsFor(sessionId);
  const existing = channel ? turns.get(channel) ?? null : null;
  const classify = () =>
    classifyAttendeeTurn({
      sessionId,
      speakerKey,
      displayName: input.displayName,
      people: input.people,
      hostMeetName: input.hostMeetName,
      hostEmail: input.hostEmail,
      locks: [...turns.values()].filter((lock) => lock.id !== existing?.id),
      existing,
    });
  let channelResolution: AttendeeLock["channelResolution"];
  let next: AttendeeLock;
  const bindingsMode = meetChannelBindingsMode();
  if (bindingsMode !== "off") {
    const hostPath = classify();
    if (bindingsMode === "shadow") {
      next = hostPath;
    } else if (channel) {
      const { decideSessionChannelBinding } = await import(
        "@/service/ai/meet-channel-binding-session"
      );
      const decision = await decideSessionChannelBinding({
        sessionId,
        channel,
        glow: input.displayName,
        activityAtMs: input.activityAtMs ?? Date.now(),
        utteranceText: input.utteranceText,
        hostPath: { role: hostPath.role, email: hostPath.email, name: hostPath.name },
      });
      const mapped = applyMeetBindingDecisionToLock({
        sessionId,
        channel,
        displayName: input.displayName,
        hostPath,
        decisionRole: decision.role,
        decisionEmail: decision.email,
      });
      next = mapped.next;
      channelResolution = mapped.channelResolution;
    } else {
      const mapped = applyMeetBindingDecisionToLock({
        sessionId,
        channel: "unkeyed",
        displayName: input.displayName,
        hostPath,
        decisionRole: "unknown",
        decisionEmail: null,
      });
      next = mapped.next;
      channelResolution = mapped.channelResolution;
    }
  } else {
    next = classify();
  }
  if (channelResolution) next = { ...next, channelResolution };
  const fingerprint = speechFingerprint(input.utteranceText);
  const recent = recentAttributedSpeech.get(sessionId);
  if (next.role === "unknown" && channelResolution !== "pending") {
    const mirrored = mirrorDuplicateChannelLock({
      sessionId,
      channel,
      displayName: input.displayName,
      utteranceText: input.utteranceText,
      recent,
    });
    if (mirrored) next = mirrored;
  }
  if (!channel) return next;
  const changed =
    !existing ||
    existing.role !== next.role ||
    existing.name !== next.name ||
    existing.email !== next.email;
  if (
    fingerprint &&
    (next.role === "customer" || next.role === "other")
  ) {
    recentAttributedSpeech.set(sessionId, {
      fingerprint,
      channel,
      at: Date.now(),
      lock: next,
    });
  }
  if (!changed) {
    return channelResolution ? { ...existing!, channelResolution } : existing!;
  }
  turns.set(channel, next);
  await persistTurns(sessionId, turns);
  return next;
}

/** Rep marked this microphone as a known email. Overrides a previous guess. */
export async function assignChannelEmail(input: {
  sessionId: string;
  speakerKey: string;
  email: string;
  people: AttendeePerson[];
  displayName?: string | null;
}): Promise<AttendeeLock | null> {
  const sessionId = input.sessionId.trim();
  const channel = channelIdFromSpeakerKey(input.speakerKey);
  const email = input.email.trim().toLowerCase();
  const person = input.people.find((p) => p.email === email);
  if (!channel || !person) return null;
  const turns = await turnsFor(sessionId);
  // Do not evict another channel with this email. Vexa currently exposes two
  // transport channels for one Meet participant; both are valid aliases for
  // the same exact attendee identity.
  const next: AttendeeLock = {
    id: `meet:${sessionId}:${channel}`,
    role: person.role,
    name: (input.displayName || "").trim() || person.name,
    email: person.email,
  };
  turns.set(channel, next);
  await persistTurns(sessionId, turns);
  return next;
}

/**
 * Final fallback for an uninvited customer colleague whose email is not in
 * the meeting's bounded pool. The rep explicitly confirms customer-side once;
 * the stable channel is locked as `other` without stealing the primary
 * contact's email identity.
 */
export async function assignChannelCustomerSide(input: {
  sessionId: string;
  speakerKey: string;
  displayName?: string | null;
}): Promise<AttendeeLock | null> {
  const sessionId = input.sessionId.trim();
  const channel = channelIdFromSpeakerKey(input.speakerKey);
  if (!channel) return null;
  const turns = await turnsFor(sessionId);
  const next: AttendeeLock = {
    id: attendeeId(sessionId, channel),
    role: "other",
    name: (input.displayName || "").trim() || "Customer attendee",
    email: null,
  };
  turns.set(channel, next);
  await persistTurns(sessionId, turns);
  return next;
}

export function attendeeRoleAllowsAssist(role: AttendeeRole): boolean {
  return role === "customer";
}
