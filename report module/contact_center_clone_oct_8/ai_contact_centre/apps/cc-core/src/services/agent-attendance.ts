import type { DbClient } from "../lib/rls.js";
import { serializeEntityId } from "../lib/id-schema.js";

const DEFAULT_TZ = "Asia/Kolkata";

export type AttendanceStatus = "present" | "absent";

export type AgentAttendanceDay = {
  date: string;
  attendance: AttendanceStatus;
  hasHistory: boolean;
  durationsSeconds: Record<string, number>;
};

export type PresenceHistoryEvent = {
  at: Date;
  previousState: string | null;
  newState: string;
};

export type PresenceMixSlice = {
  state: string;
  seconds: number;
  percent: number;
};

const PRESENCE_MIX_ORDER = [
  "ready",
  "busy",
  "after_contact_work",
  "not_ready",
  "break",
  "away",
  "offline",
] as const;

export function presenceMixLabel(state: string): string {
  switch (normalizeState(state)) {
    case "ready":
      return "Ready";
    case "busy":
      return "Busy";
    case "after_contact_work":
      return "After contact work";
    case "not_ready":
      return "Not Ready";
    case "break":
      return "Break";
    case "away":
      return "Away";
    case "offline":
      return "Offline";
    default:
      return state.replaceAll("_", " ");
  }
}

function normalizeState(state: string | null | undefined): string {
  const value = (state ?? "offline").trim().toLowerCase();
  if (value === "available" || value === "active") return "ready";
  if (value === "inactive") return "offline";
  return value || "offline";
}

function isNonOffline(state: string): boolean {
  return normalizeState(state) !== "offline";
}

function ymdInTimeZone(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function addDaysYmd(dateYmd: string, days: number): string {
  const [y, m, d] = dateYmd.split("-").map(Number);
  const utc = new Date(Date.UTC(y!, m! - 1, d! + days));
  return utc.toISOString().slice(0, 10);
}

function listYmdRange(fromYmd: string, toYmd: string): string[] {
  const out: string[] = [];
  let cursor = fromYmd;
  while (cursor <= toYmd) {
    out.push(cursor);
    cursor = addDaysYmd(cursor, 1);
  }
  return out;
}

/**
 * Diff consecutive presence transitions into per-state seconds for a time window.
 */
export function summarizePresenceDurations(input: {
  rangeStart: Date;
  rangeEnd: Date;
  now: Date;
  events: PresenceHistoryEvent[];
  currentState?: string | null;
}): Record<string, number> {
  const windowEnd = input.now < input.rangeEnd ? input.now : input.rangeEnd;
  if (windowEnd <= input.rangeStart) {
    return {};
  }

  const events = [...input.events].sort((a, b) => a.at.getTime() - b.at.getTime());
  const before = events.filter((event) => event.at.getTime() < input.rangeStart.getTime());
  const inRange = events.filter(
    (event) =>
      event.at.getTime() >= input.rangeStart.getTime() && event.at.getTime() < input.rangeEnd.getTime(),
  );

  const rangeContainsNow =
    input.now >= input.rangeStart && input.now < input.rangeEnd;
  let state =
    before.length > 0
      ? normalizeState(before[before.length - 1]!.newState)
      : rangeContainsNow
        ? normalizeState(input.currentState ?? "offline")
        : "offline";

  const durationsSeconds: Record<string, number> = {};
  let cursorMs = input.rangeStart.getTime();

  const add = (presenceState: string, fromMs: number, toMs: number) => {
    const seconds = Math.max(0, Math.floor((toMs - fromMs) / 1000));
    if (seconds <= 0) return;
    const key = normalizeState(presenceState);
    durationsSeconds[key] = (durationsSeconds[key] ?? 0) + seconds;
  };

  for (const event of inRange) {
    const atMs = event.at.getTime();
    if (atMs > cursorMs) {
      add(state, cursorMs, Math.min(atMs, windowEnd.getTime()));
    }
    state = normalizeState(event.newState);
    cursorMs = Math.max(cursorMs, atMs);
    if (cursorMs >= windowEnd.getTime()) break;
  }

  if (cursorMs < windowEnd.getTime()) {
    add(state, cursorMs, windowEnd.getTime());
  }

  return durationsSeconds;
}

export function buildPresenceMix(
  totals: Record<string, number>,
): { totalSeconds: number; states: PresenceMixSlice[] } {
  const totalSeconds = Object.values(totals).reduce((sum, value) => sum + value, 0);
  if (totalSeconds <= 0) {
    return { totalSeconds: 0, states: [] };
  }

  const states = PRESENCE_MIX_ORDER.map((state) => ({
    state,
    seconds: totals[state] ?? 0,
    percent: Math.round(((totals[state] ?? 0) / totalSeconds) * 1000) / 10,
  })).filter((slice) => slice.seconds > 0);

  states.sort((left, right) => right.seconds - left.seconds || left.state.localeCompare(right.state));
  return { totalSeconds, states };
}

export async function loadOrganizationPresenceMix(
  db: DbClient,
  organizationId: string,
  start: Date,
  end: Date,
): Promise<{ totalSeconds: number; states: PresenceMixSlice[] }> {
  const agentRows = await db.$queryRaw<{ id: string | bigint }[]>`
    SELECT id
    FROM ccass.agents
    WHERE organization_id = ${organizationId}::bigint
  `;

  const totals: Record<string, number> = {};
  const now = new Date();
  const windowEnd = end < now ? end : now;
  if (windowEnd <= start || agentRows.length === 0) {
    return { totalSeconds: 0, states: [] };
  }

  for (const row of agentRows) {
    const agentId = serializeEntityId(row.id);
    const events = await loadHistoryEvents(db, organizationId, agentId, start, windowEnd);
    const currentState = await loadCurrentPresenceState(db, organizationId, agentId);
    const durations = summarizePresenceDurations({
      rangeStart: start,
      rangeEnd: windowEnd,
      now,
      events,
      currentState,
    });
    for (const [state, seconds] of Object.entries(durations)) {
      totals[state] = (totals[state] ?? 0) + seconds;
    }
  }

  return buildPresenceMix(totals);
}

export async function loadAgentPresenceMix(
  db: DbClient,
  organizationId: string,
  agentId: string,
  start: Date,
  end: Date,
): Promise<{ totalSeconds: number; states: PresenceMixSlice[] }> {
  const now = new Date();
  const windowEnd = end < now ? end : now;
  if (windowEnd <= start) {
    return { totalSeconds: 0, states: [] };
  }

  const events = await loadHistoryEvents(db, organizationId, agentId, start, windowEnd);
  const currentState = await loadCurrentPresenceState(db, organizationId, agentId);
  const durations = summarizePresenceDurations({
    rangeStart: start,
    rangeEnd: windowEnd,
    now,
    events,
    currentState,
  });
  return buildPresenceMix(durations);
}

export async function loadScopedPresenceMix(
  db: DbClient,
  organizationId: string,
  setupUserId: string | null,
  start: Date,
  end: Date,
): Promise<{ totalSeconds: number; states: PresenceMixSlice[] }> {
  if (!setupUserId) {
    return loadOrganizationPresenceMix(db, organizationId, start, end);
  }

  const rows = await db.$queryRaw<{ id: string | bigint }[]>`
    SELECT id
    FROM ccass.agents
    WHERE organization_id = ${organizationId}::bigint
      AND setup_user_id = ${setupUserId}::bigint
    LIMIT 1
  `;
  const agent = rows[0];
  if (!agent) {
    return { totalSeconds: 0, states: [] };
  }

  return loadAgentPresenceMix(db, organizationId, serializeEntityId(agent.id), start, end);
}

/**
 * Diff consecutive presence transitions into per-state seconds for one local day.
 * Present = any time spent in a non-offline state that day (login / on-duty).
 */
export function summarizeAttendanceDay(input: {
  date: string;
  dayStart: Date;
  dayEnd: Date;
  now: Date;
  events: PresenceHistoryEvent[];
  currentState?: string | null;
}): AgentAttendanceDay {
  const durationsSeconds = summarizePresenceDurations({
    rangeStart: input.dayStart,
    rangeEnd: input.dayEnd,
    now: input.now,
    events: input.events,
    currentState: input.currentState,
  });

  let presentSeconds = 0;
  for (const [key, seconds] of Object.entries(durationsSeconds)) {
    if (isNonOffline(key)) presentSeconds += seconds;
  }

  const inDay = input.events.filter(
    (event) =>
      event.at.getTime() >= input.dayStart.getTime() &&
      event.at.getTime() < input.dayEnd.getTime(),
  );
  const hasHistory = inDay.length > 0 || presentSeconds > 0;

  return {
    date: input.date,
    attendance: presentSeconds > 0 ? "present" : "absent",
    hasHistory,
    durationsSeconds,
  };
}

async function resolveOrgTimezone(_db: DbClient, _organizationId: string): Promise<string> {
  // Org-level timezone is not on accounts.organizations; use product default.
  return DEFAULT_TZ;
}

async function dayBounds(
  db: DbClient,
  dateYmd: string,
  timeZone: string,
): Promise<{ start: Date; end: Date }> {
  const rows = await db.$queryRaw<{ start_at: Date; end_at: Date }[]>`
    SELECT
      (${dateYmd}::timestamp AT TIME ZONE ${timeZone}) AS start_at,
      (((${dateYmd}::date + 1)::timestamp) AT TIME ZONE ${timeZone}) AS end_at
  `;
  return { start: rows[0]!.start_at, end: rows[0]!.end_at };
}

async function loadHistoryEvents(
  db: DbClient,
  organizationId: string,
  agentId: string,
  rangeStart: Date,
  rangeEnd: Date,
): Promise<PresenceHistoryEvent[]> {
  // Include last event before range so we know state at day start.
  const rows = await db.$queryRaw<
    {
      previous_state: string | null;
      new_state: string;
      at: Date;
    }[]
  >`
    SELECT previous_state, new_state, at FROM (
      (
        SELECT previous_state, new_state, COALESCE(ended_at, started_at) AS at
        FROM ccass.agent_presence_history
        WHERE organization_id = ${organizationId}::bigint
          AND agent_id = ${agentId}::bigint
          AND COALESCE(ended_at, started_at) < ${rangeStart}
        ORDER BY COALESCE(ended_at, started_at) DESC
        LIMIT 1
      )
      UNION ALL
      (
        SELECT previous_state, new_state, COALESCE(ended_at, started_at) AS at
        FROM ccass.agent_presence_history
        WHERE organization_id = ${organizationId}::bigint
          AND agent_id = ${agentId}::bigint
          AND COALESCE(ended_at, started_at) >= ${rangeStart}
          AND COALESCE(ended_at, started_at) < ${rangeEnd}
      )
    ) history
    ORDER BY at ASC
  `;

  return rows.map((row) => ({
    at: row.at,
    previousState: row.previous_state,
    newState: row.new_state,
  }));
}

async function loadCurrentPresenceState(
  db: DbClient,
  organizationId: string,
  agentId: string,
): Promise<string | null> {
  const rows = await db.$queryRaw<{ presence_state: string | null; status: string | null }[]>`
    SELECT presence_state, status
    FROM ccass.agent_presence
    WHERE organization_id = ${organizationId}::bigint
      AND agent_id = ${agentId}::bigint
    LIMIT 1
  `;
  const row = rows[0];
  if (!row) return null;
  return row.presence_state || row.status || null;
}

/** Agents who logged in / were on-duty at any point today (local org day). */
export async function loadPresentAgentIdsToday(
  db: DbClient,
  organizationId: string,
): Promise<Set<string>> {
  const timeZone = await resolveOrgTimezone(db, organizationId);
  const rows = await db.$queryRaw<{ agent_id: string | bigint }[]>`
    WITH bounds AS (
      SELECT
        ((CURRENT_TIMESTAMP AT TIME ZONE ${timeZone})::date::timestamp AT TIME ZONE ${timeZone}) AS start_at,
        ((((CURRENT_TIMESTAMP AT TIME ZONE ${timeZone})::date + 1)::timestamp) AT TIME ZONE ${timeZone}) AS end_at
    )
    SELECT DISTINCT h.agent_id
    FROM ccass.agent_presence_history h
    CROSS JOIN bounds b
    WHERE h.organization_id = ${organizationId}::bigint
      AND COALESCE(h.ended_at, h.started_at) >= b.start_at
      AND COALESCE(h.ended_at, h.started_at) < b.end_at
      AND lower(h.new_state) NOT IN ('offline', 'inactive')
    UNION
    SELECT ap.agent_id
    FROM ccass.agent_presence ap
    WHERE ap.organization_id = ${organizationId}::bigint
      AND lower(COALESCE(ap.presence_state, ap.status, 'offline')) NOT IN ('offline', 'inactive')
  `;

  return new Set(rows.map((row) => serializeEntityId(row.agent_id)));
}

export async function getAgentAttendanceRange(
  db: DbClient,
  organizationId: string,
  agentId: string,
  fromYmd: string,
  toYmd: string,
): Promise<{ timeZone: string; days: AgentAttendanceDay[] }> {
  const timeZone = await resolveOrgTimezone(db, organizationId);
  const dates = listYmdRange(fromYmd, toYmd);
  if (dates.length === 0) {
    return { timeZone, days: [] };
  }

  const firstBounds = await dayBounds(db, dates[0]!, timeZone);
  const lastBounds = await dayBounds(db, dates[dates.length - 1]!, timeZone);
  const events = await loadHistoryEvents(
    db,
    organizationId,
    agentId,
    firstBounds.start,
    lastBounds.end,
  );
  const currentState = await loadCurrentPresenceState(db, organizationId, agentId);
  const now = new Date();

  const boundByDate = new Map<string, { start: Date; end: Date }>();
  boundByDate.set(dates[0]!, firstBounds);
  if (dates.length > 1) {
    boundByDate.set(dates[dates.length - 1]!, lastBounds);
  }
  for (const date of dates) {
    if (!boundByDate.has(date)) {
      boundByDate.set(date, await dayBounds(db, date, timeZone));
    }
  }

  const days: AgentAttendanceDay[] = dates.map((date) => {
    const bounds = boundByDate.get(date)!;
    return summarizeAttendanceDay({
      date,
      dayStart: bounds.start,
      dayEnd: bounds.end,
      now,
      events,
      currentState,
    });
  });

  return { timeZone, days };
}

export async function getAgentAttendanceDay(
  db: DbClient,
  organizationId: string,
  agentId: string,
  dateYmd: string,
): Promise<{ timeZone: string; day: AgentAttendanceDay }> {
  const { timeZone, days } = await getAgentAttendanceRange(
    db,
    organizationId,
    agentId,
    dateYmd,
    dateYmd,
  );
  return {
    timeZone,
    day: days[0] ?? {
      date: dateYmd,
      attendance: "absent",
      hasHistory: false,
      durationsSeconds: {},
    },
  };
}

export function todayYmd(timeZone = DEFAULT_TZ, now = new Date()): string {
  return ymdInTimeZone(now, timeZone);
}

export function weekAgoYmd(timeZone = DEFAULT_TZ, now = new Date()): string {
  const today = todayYmd(timeZone, now);
  return addDaysYmd(today, -6);
}
