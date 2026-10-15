import type { DbClient } from "../lib/rls.js";
import { serializeEntityIdOptional } from "../lib/id-schema.js";
import {
  DIAGNOSTIC_THRESHOLDS,
  DASHBOARD_ANALYTICS_PROMPT_VERSION,
  DASHBOARD_ANALYTICS_SCHEMA_VERSION,
  WEEKLY_DIAGNOSTIC_THRESHOLDS,
  bucketStartIso,
  formatDuration,
  formatPercent,
  formatSignedDelta,
  hashInput,
  mad,
  median,
  robustZScore,
  weekdayHourKey,
} from "./dashboard-analytics-math.js";
import type {
  DiagnosticBaselineFacts,
  DiagnosticDriver,
  DiagnosticEvidence,
  DiagnosticIncidentFacts,
  DiagnosticIncidentRecord,
  DiagnosticWeeklyComparison,
  DiagnosticWeeklyWindowStats,
  IncidentSeverity,
  IncidentStatus,
} from "./dashboard-analytics-types.js";
import { fetchDiagnosticReview } from "./dashboard-analytics-nlp.js";
import {
  getIncidentByFingerprint,
  listActiveIncidents,
  upsertIncident,
  type StoredIncident,
} from "./dashboard-analytics-storage.js";

const DRIVER_LABELS: Record<string, string> = {
  offer_timeout: "Not picked up",
  no_agent_available: "No agents available",
  // Legacy stored incident drivers (pre-lookup backfill).
  manual_reject: "Not picked up",
  routing_exhausted: "No agents available",
};

type MissedBucketRow = {
  bucket_start: Date;
  channel: string;
  queue_id: string | null;
  queue_name: string | null;
  missed_event_count: number;
  unique_missed_conversations: number;
};

type DemandBucketRow = {
  bucket_start: Date;
  channel: string;
  queue_id: string | null;
  agent_demand_conversations: number;
};

type ReadyBucketRow = {
  bucket_start: Date;
  ready_agents_average: number | null;
};

type WaitBucketRow = {
  bucket_start: Date;
  channel: string;
  queue_id: string | null;
  oldest_wait_seconds: number | null;
};

type DriverRow = {
  reason: string;
  count: number;
};

export type MissedContactCandidate = {
  fingerprint: string;
  incidentType: string;
  severity: IncidentSeverity;
  status: IncidentStatus;
  persistenceBuckets: number;
  detectorReasons: string[];
  scope: {
    channel: string;
    queueId: string | null;
    queueName: string | null;
  };
  currentFacts: DiagnosticIncidentFacts;
  baselineFacts: DiagnosticBaselineFacts;
};

function driverLabel(key: string): string {
  return DRIVER_LABELS[key] ?? key.replaceAll("_", " ");
}

function buildFingerprint(
  organizationId: string,
  channel: string,
  queueId: string | null,
  topDriver: string,
): string {
  return `missed_contact:${organizationId}:${channel}:${queueId ?? "org"}:${topDriver}`;
}

function buildWeeklyFingerprint(
  organizationId: string,
  channel: string,
  queueId: string | null,
): string {
  return `weekly_missed_contact:${organizationId}:${channel}:${queueId ?? "org"}`;
}

function deriveWeeklySeverity(eventIncrease: number, rateDelta: number | null): IncidentSeverity {
  if (eventIncrease >= 30 || (rateDelta != null && rateDelta >= 15)) return "critical";
  if (eventIncrease >= 20 || (rateDelta != null && rateDelta >= 10)) return "high";
  if (eventIncrease >= 10 || (rateDelta != null && rateDelta >= 5)) return "medium";
  return "low";
}

function deriveSeverity(rateDelta: number, robustZ: number): IncidentSeverity {
  if (rateDelta >= 15 || robustZ >= 5) return "critical";
  if (rateDelta >= 10 || robustZ >= 4) return "high";
  if (rateDelta >= 5 || robustZ >= 3) return "medium";
  return "low";
}

const SEVERITY_RANK = { critical: 4, high: 3, medium: 2, low: 1 } as const;

function incidentScopeKey(scope: {
  channel: string;
  queueId: string | null;
  queueName?: string | null;
}): string {
  if (scope.channel === "all") return "org";
  return `label:${(scope.queueName ?? scope.channel).toLowerCase()}`;
}

export function incidentDisplayLabel(scope: {
  channel: string;
  queueId: string | null;
  queueName?: string | null;
}): string {
  if (scope.channel === "all") return "all";
  return scope.queueName ?? scope.channel;
}

function shouldPreferDiagnosticIncident(
  challenger: { severity: IncidentSeverity; incidentType: string },
  incumbent: { severity: IncidentSeverity; incidentType: string },
): boolean {
  const challengerRank = SEVERITY_RANK[challenger.severity];
  const incumbentRank = SEVERITY_RANK[incumbent.severity];
  if (challengerRank !== incumbentRank) {
    return challengerRank > incumbentRank;
  }
  return (
    challenger.incidentType === "weekly_missed_contact_spike" &&
    incumbent.incidentType !== "weekly_missed_contact_spike"
  );
}

function dedupeCandidatesByScope(
  candidates: MissedContactCandidate[],
): MissedContactCandidate[] {
  const byScope = new Map<string, MissedContactCandidate>();
  for (const candidate of candidates) {
    const key = incidentScopeKey(candidate.scope);
    const existing = byScope.get(key);
    if (!existing || shouldPreferDiagnosticIncident(candidate, existing)) {
      byScope.set(key, candidate);
    }
  }
  return [...byScope.values()].sort(
    (left, right) => SEVERITY_RANK[right.severity] - SEVERITY_RANK[left.severity],
  );
}

export function dedupeIncidentsByScope(
  incidents: DiagnosticIncidentRecord[],
): DiagnosticIncidentRecord[] {
  const byScope = new Map<string, DiagnosticIncidentRecord>();
  for (const incident of incidents) {
    const key = incidentScopeKey(incident.scope);
    const existing = byScope.get(key);
    if (!existing || shouldPreferDiagnosticIncident(incident, existing)) {
      byScope.set(key, incident);
    }
  }
  return [...byScope.values()].sort(
    (left, right) => SEVERITY_RANK[right.severity] - SEVERITY_RANK[left.severity],
  );
}

function buildDeterministicNarrative(
  currentFacts: DiagnosticIncidentFacts,
  baselineFacts: DiagnosticBaselineFacts,
  incidentType = "missed_contact_spike",
): { headline: string; summary: string; change: string; evidence: DiagnosticEvidence[] } {
  const queueLabel = currentFacts.queueName ?? currentFacts.channel;
  if (incidentType === "weekly_missed_contact_spike") {
    const eventDelta =
      currentFacts.missedEventCount - (baselineFacts.missedEventCount ?? 0);
    const rateDelta = currentFacts.missedContactRate - baselineFacts.missedContactRate;
    const headline = `Missed contacts up week over week in ${queueLabel}`;
    const summary = [
      `Missed-contact events rose from ${baselineFacts.missedEventCount ?? 0} last week to ${currentFacts.missedEventCount} in the latest 7 days.`,
      rateDelta > 0
        ? `The missed-contact rate moved from ${formatPercent(baselineFacts.missedContactRate)} to ${formatPercent(currentFacts.missedContactRate)}.`
        : "",
      currentFacts.drivers[0]
        ? `Most events were ${driverLabel(currentFacts.drivers[0].key).toLowerCase()}.`
        : "",
    ]
      .filter(Boolean)
      .join(" ");
    const evidence: DiagnosticEvidence[] = [
      {
        label: "This week",
        detail: `${currentFacts.missedEventCount} missed events across ${currentFacts.uniqueMissedConversations} conversations`,
      },
      {
        label: "Last week",
        detail: `${baselineFacts.missedEventCount ?? 0} missed events in the prior 7 days`,
      },
    ];
    if (currentFacts.agentDemandConversations > 0) {
      evidence.push({
        label: "Demand context",
        detail: `${currentFacts.agentDemandConversations} queued conversations this week`,
      });
    }
    return {
      headline,
      summary,
      change: formatSignedDelta(rateDelta > 0 ? rateDelta : eventDelta),
      evidence,
    };
  }

  const rateDelta = currentFacts.missedContactRate - baselineFacts.missedContactRate;
  const topDriver = currentFacts.drivers[0];
  const headline =
    rateDelta >= 0
      ? `Missed contacts elevated in ${queueLabel}`
      : `Missed contacts improved in ${queueLabel}`;
  const summary = [
    `The missed-contact rate moved from the ${formatPercent(baselineFacts.missedContactRate)} baseline to ${formatPercent(currentFacts.missedContactRate)}.`,
    topDriver
      ? `The change was concentrated in ${driverLabel(topDriver.key).toLowerCase()} events.`
      : "No single driver dominated the change.",
    currentFacts.readyAgentsAverage != null && baselineFacts.readyAgentsAverage != null
      ? `Ready coverage averaged ${currentFacts.readyAgentsAverage} agents versus the usual ${baselineFacts.readyAgentsAverage}.`
      : "",
  ]
    .filter(Boolean)
    .join(" ");

  const evidence: DiagnosticEvidence[] = [
    {
      label: "Affected workload",
      detail: `${currentFacts.uniqueMissedConversations} of ${currentFacts.agentDemandConversations} agent-demand conversations were missed`,
    },
  ];
  if (currentFacts.readyAgentsAverage != null && baselineFacts.readyAgentsAverage != null) {
    evidence.push({
      label: "Ready coverage",
      detail: `${currentFacts.readyAgentsAverage} agents on average versus usual ${baselineFacts.readyAgentsAverage}`,
    });
  }
  if (currentFacts.oldestWaitSeconds != null && baselineFacts.oldestWaitSeconds != null) {
    evidence.push({
      label: "Queue pressure",
      detail: `Oldest wait ${formatDuration(currentFacts.oldestWaitSeconds)} versus baseline ${formatDuration(baselineFacts.oldestWaitSeconds)}`,
    });
  }

  return {
    headline,
    summary,
    change: formatSignedDelta(rateDelta),
    evidence,
  };
}

export function storedIncidentToRecord(stored: StoredIncident): DiagnosticIncidentRecord {
  const deterministic = buildDeterministicNarrative(
    stored.currentFacts,
    stored.baselineFacts,
    stored.incidentType,
  );
  const isWeekly = stored.incidentType === "weekly_missed_contact_spike";
  return {
    id: stored.fingerprint,
    fingerprint: stored.fingerprint,
    version: stored.version,
    status: stored.status,
    severity: stored.severity,
    incidentType: stored.incidentType,
    metric: isWeekly ? "Missed contacts (7-day)" : "Missed contact rate",
    headline: stored.headline || deterministic.headline,
    change: isWeekly
      ? formatSignedDelta(
          stored.currentFacts.missedEventCount - (stored.baselineFacts.missedEventCount ?? 0),
        )
      : formatSignedDelta(
          stored.currentFacts.missedContactRate - stored.baselineFacts.missedContactRate,
        ),
    summary: stored.summary || deterministic.summary,
    factors: stored.currentFacts.drivers.map((driver) => ({
      label: driver.label,
      value: driver.share,
    })),
    evidence: deterministic.evidence,
    source: stored.source === "nlp" ? "nlp" : "rules",
    generatedAt: stored.lastDetectedAt,
    scope: {
      channel: stored.currentFacts.channel,
      queueId: stored.currentFacts.queueId,
      queueName: stored.currentFacts.queueName,
    },
    currentFacts: stored.currentFacts,
    baselineFacts: stored.baselineFacts,
  };
}

async function loadMissedBuckets(
  db: DbClient,
  organizationId: string,
  since: Date,
): Promise<MissedBucketRow[]> {
  return db.$queryRawUnsafe<MissedBucketRow[]>(
    `
    SELECT
      date_trunc('hour', amc.missed_at)
        + INTERVAL '15 min' * FLOOR(EXTRACT(MINUTE FROM amc.missed_at) / 15) AS bucket_start,
      amc.channel,
      amc.queue_id::text AS queue_id,
      q.name AS queue_name,
      COUNT(*)::int AS missed_event_count,
      COUNT(DISTINCT amc.conversation_id)::int AS unique_missed_conversations
    FROM ccass.agent_missed_contacts amc
    LEFT JOIN ccass.queues q
      ON q.id = amc.queue_id
     AND q.organization_id = amc.organization_id
    WHERE amc.organization_id = $1::bigint
      AND amc.missed_at >= $2::timestamptz
    GROUP BY 1, 2, 3, 4
    `,
    organizationId,
    since.toISOString(),
  );
}

async function loadDemandBuckets(
  db: DbClient,
  organizationId: string,
  since: Date,
): Promise<DemandBucketRow[]> {
  return db.$queryRawUnsafe<DemandBucketRow[]>(
    `
    SELECT
      date_trunc('hour', c.queued_at)
        + INTERVAL '15 min' * FLOOR(EXTRACT(MINUTE FROM c.queued_at) / 15) AS bucket_start,
      c.channel,
      c.queue_id::text AS queue_id,
      COUNT(DISTINCT c.id)::int AS agent_demand_conversations
    FROM ccass.conversations c
    WHERE c.organization_id = $1::bigint
      AND c.queued_at IS NOT NULL
      AND c.queued_at >= $2::timestamptz
    GROUP BY 1, 2, 3
    `,
    organizationId,
    since.toISOString(),
  );
}

async function loadReadyCoverage(
  db: DbClient,
  organizationId: string,
  since: Date,
): Promise<ReadyBucketRow[]> {
  return db.$queryRawUnsafe<ReadyBucketRow[]>(
    `
    SELECT
      date_trunc('hour', aph.started_at)
        + INTERVAL '15 min' * FLOOR(EXTRACT(MINUTE FROM aph.started_at) / 15) AS bucket_start,
      COUNT(DISTINCT CASE WHEN aph.new_state = 'ready' THEN aph.agent_id END)::float AS ready_agents_average
    FROM ccass.agent_presence_history aph
    INNER JOIN ccass.agents a
      ON a.id = aph.agent_id
     AND a.organization_id = aph.organization_id
    WHERE aph.organization_id = $1::bigint
      AND aph.started_at >= $2::timestamptz
    GROUP BY 1
    `,
    organizationId,
    since.toISOString(),
  );
}

async function loadOldestWaitBuckets(
  db: DbClient,
  organizationId: string,
  since: Date,
): Promise<WaitBucketRow[]> {
  return db.$queryRawUnsafe<WaitBucketRow[]>(
    `
    SELECT
      date_trunc('hour', c.queued_at)
        + INTERVAL '15 min' * FLOOR(EXTRACT(MINUTE FROM c.queued_at) / 15) AS bucket_start,
      c.channel,
      c.queue_id::text AS queue_id,
      MAX(
        EXTRACT(
          EPOCH FROM (
            COALESCE(c.assigned_at, c.first_response_at, NOW()) - c.queued_at
          )
        )
      )::float AS oldest_wait_seconds
    FROM ccass.conversations c
    WHERE c.organization_id = $1::bigint
      AND c.queued_at IS NOT NULL
      AND c.queued_at >= $2::timestamptz
    GROUP BY 1, 2, 3
    `,
    organizationId,
    since.toISOString(),
  );
}

async function loadDriversForWindow(
  db: DbClient,
  organizationId: string,
  windowStart: Date,
  windowEnd: Date,
  channel: string,
  queueId: string | null,
): Promise<DiagnosticDriver[]> {
  const rows = await db.$queryRawUnsafe<DriverRow[]>(
    `
    SELECT reason, COUNT(*)::int AS count
    FROM ccass.agent_missed_contacts
    WHERE organization_id = $1::bigint
      AND missed_at >= $2::timestamptz
      AND missed_at < $3::timestamptz
      AND channel = $4
      AND ($5::bigint IS NULL OR queue_id = $5::bigint)
    GROUP BY reason
    ORDER BY count DESC
    `,
    organizationId,
    windowStart.toISOString(),
    windowEnd.toISOString(),
    channel,
    queueId,
  );
  const total = rows.reduce((sum, row) => sum + row.count, 0);
  return rows.map((row) => ({
    key: row.reason,
    label: driverLabel(row.reason),
    count: row.count,
    share: total > 0 ? Math.round((row.count / total) * 1000) / 10 : 0,
  }));
}

function buildBaselineRates(
  missedBuckets: MissedBucketRow[],
  demandBuckets: DemandBucketRow[],
  currentBucket: Date,
): number[] {
  const currentKey = weekdayHourKey(currentBucket);
  const rates: number[] = [];
  for (const missed of missedBuckets) {
    if (weekdayHourKey(missed.bucket_start) !== currentKey) continue;
    const demand = demandBuckets.find(
      (row) =>
        row.bucket_start.getTime() === missed.bucket_start.getTime() &&
        row.channel === missed.channel &&
        row.queue_id === missed.queue_id,
    );
    if (!demand || demand.agent_demand_conversations <= 0) continue;
    rates.push((missed.unique_missed_conversations / demand.agent_demand_conversations) * 100);
  }
  return rates;
}

type WeeklyScopeRow = {
  channel: string;
  queue_id: string | null;
  queue_name: string | null;
  this_week_events: number;
  this_week_unique: number;
  last_week_events: number;
  last_week_unique: number;
  this_week_demand: number;
  last_week_demand: number;
};

function weeklyWindowBounds(): {
  thisStart: Date;
  thisEnd: Date;
  lastStart: Date;
  lastEnd: Date;
} {
  const thisEnd = new Date();
  const thisStart = new Date(thisEnd.getTime() - WEEKLY_DIAGNOSTIC_THRESHOLDS.windowDays * 86_400_000);
  const lastEnd = thisStart;
  const lastStart = new Date(lastEnd.getTime() - WEEKLY_DIAGNOSTIC_THRESHOLDS.windowDays * 86_400_000);
  return { thisStart, thisEnd, lastStart, lastEnd };
}

function toWeeklyWindowStats(
  bounds: ReturnType<typeof weeklyWindowBounds>,
  events: number,
  unique: number,
  demand: number,
  period: "this" | "last",
): DiagnosticWeeklyWindowStats {
  const windowStart = period === "this" ? bounds.thisStart : bounds.lastStart;
  const windowEnd = period === "this" ? bounds.thisEnd : bounds.lastEnd;
  const missedContactRate =
    demand > 0 ? Math.round((unique / demand) * 1000) / 10 : null;
  return {
    windowStart: windowStart.toISOString(),
    windowEnd: windowEnd.toISOString(),
    missedEventCount: events,
    uniqueMissedConversations: unique,
    agentDemandConversations: demand,
    missedContactRate,
  };
}

async function loadWeeklyScopeRows(
  db: DbClient,
  organizationId: string,
): Promise<WeeklyScopeRow[]> {
  const bounds = weeklyWindowBounds();
  return db.$queryRawUnsafe<WeeklyScopeRow[]>(
    `
    WITH missed AS (
      SELECT
        amc.channel,
        amc.queue_id::text AS queue_id,
        q.name AS queue_name,
        COUNT(*) FILTER (
          WHERE amc.missed_at >= $2::timestamptz AND amc.missed_at < $3::timestamptz
        )::int AS this_week_events,
        COUNT(DISTINCT amc.conversation_id) FILTER (
          WHERE amc.missed_at >= $2::timestamptz AND amc.missed_at < $3::timestamptz
        )::int AS this_week_unique,
        COUNT(*) FILTER (
          WHERE amc.missed_at >= $4::timestamptz AND amc.missed_at < $5::timestamptz
        )::int AS last_week_events,
        COUNT(DISTINCT amc.conversation_id) FILTER (
          WHERE amc.missed_at >= $4::timestamptz AND amc.missed_at < $5::timestamptz
        )::int AS last_week_unique
      FROM ccass.agent_missed_contacts amc
      LEFT JOIN ccass.queues q
        ON q.id = amc.queue_id
       AND q.organization_id = amc.organization_id
      WHERE amc.organization_id = $1::bigint
        AND amc.missed_at >= $4::timestamptz
      GROUP BY 1, 2, 3
    ),
    demand AS (
      SELECT
        c.channel,
        c.queue_id::text AS queue_id,
        COUNT(DISTINCT c.id) FILTER (
          WHERE c.queued_at >= $2::timestamptz AND c.queued_at < $3::timestamptz
        )::int AS this_week_demand,
        COUNT(DISTINCT c.id) FILTER (
          WHERE c.queued_at >= $4::timestamptz AND c.queued_at < $5::timestamptz
        )::int AS last_week_demand
      FROM ccass.conversations c
      WHERE c.organization_id = $1::bigint
        AND c.queued_at IS NOT NULL
        AND c.queued_at >= $4::timestamptz
      GROUP BY 1, 2
    )
    SELECT
      missed.channel,
      missed.queue_id,
      missed.queue_name,
      missed.this_week_events,
      missed.this_week_unique,
      missed.last_week_events,
      missed.last_week_unique,
      COALESCE(demand.this_week_demand, 0)::int AS this_week_demand,
      COALESCE(demand.last_week_demand, 0)::int AS last_week_demand
    FROM missed
    LEFT JOIN demand
      ON demand.channel = missed.channel
     AND demand.queue_id IS NOT DISTINCT FROM missed.queue_id
    `,
    organizationId,
    bounds.thisStart.toISOString(),
    bounds.thisEnd.toISOString(),
    bounds.lastStart.toISOString(),
    bounds.lastEnd.toISOString(),
  );
}

function rollupWeeklyScopes(rows: WeeklyScopeRow[]): WeeklyScopeRow[] {
  const orgTotals = rows.reduce(
    (acc, row) => {
      acc.this_week_events += row.this_week_events;
      acc.this_week_unique += row.this_week_unique;
      acc.last_week_events += row.last_week_events;
      acc.last_week_unique += row.last_week_unique;
      acc.this_week_demand += row.this_week_demand;
      acc.last_week_demand += row.last_week_demand;
      return acc;
    },
    {
      channel: "all",
      queue_id: null,
      queue_name: null,
      this_week_events: 0,
      this_week_unique: 0,
      last_week_events: 0,
      last_week_unique: 0,
      this_week_demand: 0,
      last_week_demand: 0,
    } satisfies WeeklyScopeRow,
  );
  return [orgTotals, ...rows.filter((row) => row.this_week_events > 0 || row.last_week_events > 0)];
}

export async function buildDiagnosticWeeklyComparison(
  db: DbClient,
  organizationId: string,
): Promise<DiagnosticWeeklyComparison | null> {
  const rows = rollupWeeklyScopes(await loadWeeklyScopeRows(db, organizationId));
  const orgRow = rows[0];
  if (!orgRow || (orgRow.this_week_events === 0 && orgRow.last_week_events === 0)) {
    return null;
  }
  const bounds = weeklyWindowBounds();
  const thisWeek = toWeeklyWindowStats(
    bounds,
    orgRow.this_week_events,
    orgRow.this_week_unique,
    orgRow.this_week_demand,
    "this",
  );
  const lastWeek = toWeeklyWindowStats(
    bounds,
    orgRow.last_week_events,
    orgRow.last_week_unique,
    orgRow.last_week_demand,
    "last",
  );
  const eventCountChange = thisWeek.missedEventCount - lastWeek.missedEventCount;
  const eventCountChangePercent =
    lastWeek.missedEventCount > 0
      ? Math.round((eventCountChange / lastWeek.missedEventCount) * 1000) / 10
      : null;
  const rateDeltaPoints =
    thisWeek.missedContactRate != null && lastWeek.missedContactRate != null
      ? Math.round((thisWeek.missedContactRate - lastWeek.missedContactRate) * 10) / 10
      : null;
  const highlightScope = rows
    .slice(1)
    .map((row) => ({
      row,
      increase: row.this_week_events - row.last_week_events,
    }))
    .sort((left, right) => right.increase - left.increase)[0]?.row;

  return {
    thisWeek,
    lastWeek,
    eventCountChange,
    eventCountChangePercent,
    rateDeltaPoints,
    trend: eventCountChange > 0 ? "up" : eventCountChange < 0 ? "down" : "flat",
    highlightScope: highlightScope
      ? {
          channel: highlightScope.channel,
          queueId: highlightScope.queue_id,
          queueName: highlightScope.queue_name,
        }
      : null,
  };
}

function passesWeeklyDetector(row: WeeklyScopeRow): string[] {
  const reasons: string[] = [];
  const eventIncrease = row.this_week_events - row.last_week_events;
  const multiplier =
    row.last_week_events > 0 ? row.this_week_events / row.last_week_events : Number.POSITIVE_INFINITY;
  const thisRate =
    row.this_week_demand > 0
      ? (row.this_week_unique / row.this_week_demand) * 100
      : null;
  const lastRate =
    row.last_week_demand > 0
      ? (row.last_week_unique / row.last_week_demand) * 100
      : null;
  const rateDelta =
    thisRate != null && lastRate != null ? thisRate - lastRate : null;

  if (row.this_week_events >= WEEKLY_DIAGNOSTIC_THRESHOLDS.minThisWeekEvents) {
    reasons.push("minimum_weekly_events_passed");
  }
  if (eventIncrease >= WEEKLY_DIAGNOSTIC_THRESHOLDS.minCountIncrease) {
    reasons.push("weekly_count_increase_passed");
  }
  if (multiplier >= WEEKLY_DIAGNOSTIC_THRESHOLDS.minCountMultiplier) {
    reasons.push("weekly_count_multiplier_passed");
  }
  if (rateDelta != null && rateDelta >= WEEKLY_DIAGNOSTIC_THRESHOLDS.minRateDeltaPoints) {
    reasons.push("weekly_rate_delta_passed");
  }
  return reasons;
}

export async function detectWeeklyMissedContactCandidates(
  db: DbClient,
  organizationId: string,
): Promise<MissedContactCandidate[]> {
  const bounds = weeklyWindowBounds();
  const rows = rollupWeeklyScopes(await loadWeeklyScopeRows(db, organizationId));
  const candidates: MissedContactCandidate[] = [];

  for (const row of rows) {
    const detectorReasons = passesWeeklyDetector(row);
    const countSignals = detectorReasons.filter((reason) =>
      reason.includes("count"),
    ).length;
    const hasRateSignal = detectorReasons.includes("weekly_rate_delta_passed");
    if (!detectorReasons.includes("minimum_weekly_events_passed")) continue;
    if (countSignals < 1 && !hasRateSignal) continue;

    const channel = row.channel === "all" ? "all" : row.channel;
    const queueId = row.channel === "all" ? null : row.queue_id;
    let normalizedDrivers: DiagnosticDriver[];
    let topDriver: string;

    if (channel === "all") {
      const orgDriverRows = await db.$queryRawUnsafe<DriverRow[]>(
        `
        SELECT reason, COUNT(*)::int AS count
        FROM ccass.agent_missed_contacts
        WHERE organization_id = $1::bigint
          AND missed_at >= $2::timestamptz
          AND missed_at < $3::timestamptz
        GROUP BY reason
        ORDER BY count DESC
        `,
        organizationId,
        bounds.thisStart.toISOString(),
        bounds.thisEnd.toISOString(),
      );
      const totalDriverCount = orgDriverRows.reduce((sum, driver) => sum + driver.count, 0);
      normalizedDrivers = orgDriverRows.map((driverRow) => ({
        key: driverRow.reason,
        label: driverLabel(driverRow.reason),
        count: driverRow.count,
        share: totalDriverCount > 0 ? Math.round((driverRow.count / totalDriverCount) * 1000) / 10 : 0,
      }));
      topDriver = orgDriverRows[0]?.reason ?? "unknown";
    } else {
      const drivers = await loadDriversForWindow(
        db,
        organizationId,
        bounds.thisStart,
        bounds.thisEnd,
        channel,
        queueId,
      );
      normalizedDrivers = drivers;
      topDriver = drivers[0]?.key ?? "unknown";
    }

    const thisRate =
      row.this_week_demand > 0
        ? Math.round((row.this_week_unique / row.this_week_demand) * 1000) / 10
        : 0;
    const lastRate =
      row.last_week_demand > 0
        ? Math.round((row.last_week_unique / row.last_week_demand) * 1000) / 10
        : 0;
    const eventIncrease = row.this_week_events - row.last_week_events;

    const baselineFacts: DiagnosticBaselineFacts = {
      method: "rolling_7d_week_over_week",
      lookbackDays: WEEKLY_DIAGNOSTIC_THRESHOLDS.windowDays,
      missedContactRate: lastRate,
      uniqueMissedConversations: row.last_week_unique,
      missedEventCount: row.last_week_events,
      readyAgentsAverage: null,
      oldestWaitSeconds: null,
      robustZScore: 0,
    };

    const currentFacts: DiagnosticIncidentFacts = {
      windowStart: bounds.thisStart.toISOString(),
      windowEnd: bounds.thisEnd.toISOString(),
      channel,
      queueId,
      queueName: row.queue_name,
      agentDemandConversations: row.this_week_demand,
      uniqueMissedConversations: row.this_week_unique,
      missedEventCount: row.this_week_events,
      missedContactRate: thisRate,
      readyAgentsAverage: null,
      oldestWaitSeconds: null,
      topDriver,
      drivers: normalizedDrivers,
    };

    candidates.push({
      fingerprint: buildWeeklyFingerprint(organizationId, channel, queueId),
      incidentType: "weekly_missed_contact_spike",
      severity: deriveWeeklySeverity(eventIncrease, thisRate - lastRate),
      status: "active",
      persistenceBuckets: 1,
      detectorReasons,
      scope: {
        channel,
        queueId,
        queueName: row.queue_name,
      },
      currentFacts,
      baselineFacts,
    });
  }

  return candidates.sort((left, right) => {
    const severityRank = { critical: 4, high: 3, medium: 2, low: 1 } as const;
    return severityRank[right.severity] - severityRank[left.severity];
  });
}

export async function detectMissedContactCandidates(
  db: DbClient,
  organizationId: string,
): Promise<MissedContactCandidate[]> {
  const lookbackStart = new Date(
    Date.now() - DIAGNOSTIC_THRESHOLDS.lookbackDays * 86_400_000,
  );
  const [missedBuckets, demandBuckets, readyBuckets, waitBuckets] = await Promise.all([
    loadMissedBuckets(db, organizationId, lookbackStart),
    loadDemandBuckets(db, organizationId, lookbackStart),
    loadReadyCoverage(db, organizationId, lookbackStart),
    loadOldestWaitBuckets(db, organizationId, lookbackStart),
  ]);

  const latestBuckets = new Map<string, MissedBucketRow>();
  for (const bucket of missedBuckets) {
    const key = `${bucket.bucket_start.toISOString()}:${bucket.channel}:${bucket.queue_id ?? "org"}`;
    const existing = latestBuckets.get(key);
    if (!existing || bucket.bucket_start > existing.bucket_start) {
      latestBuckets.set(key, bucket);
    }
  }

  const recentMissed = [...missedBuckets]
    .sort((left, right) => right.bucket_start.getTime() - left.bucket_start.getTime())
    .slice(0, 40);

  const candidates: MissedContactCandidate[] = [];

  for (const missed of recentMissed) {
    const demand = demandBuckets.find(
      (row) =>
        row.bucket_start.getTime() === missed.bucket_start.getTime() &&
        row.channel === missed.channel &&
        row.queue_id === missed.queue_id,
    );
    const agentDemandConversations = demand?.agent_demand_conversations ?? 0;
    if (agentDemandConversations <= 0) continue;

    const missedContactRate = (missed.unique_missed_conversations / agentDemandConversations) * 100;
    const baselineRates = buildBaselineRates(missedBuckets, demandBuckets, missed.bucket_start);
    const baselineRate = median(baselineRates);
    const baselineDispersion = mad(baselineRates, baselineRate);
    const robustZ = robustZScore(missedContactRate, baselineRate, baselineDispersion);
    const rateDelta = missedContactRate - baselineRate;
    const relativeMultiplier = baselineRate > 0 ? missedContactRate / baselineRate : Number.POSITIVE_INFINITY;

    const detectorReasons: string[] = [];
    if (missed.unique_missed_conversations >= DIAGNOSTIC_THRESHOLDS.minUniqueMissed) {
      detectorReasons.push("minimum_count_passed");
    }
    if (rateDelta >= DIAGNOSTIC_THRESHOLDS.minRateDeltaPoints) {
      detectorReasons.push("rate_delta_passed");
    }
    if (relativeMultiplier >= DIAGNOSTIC_THRESHOLDS.minRelativeMultiplier) {
      detectorReasons.push("relative_multiplier_passed");
    }
    if (robustZ >= DIAGNOSTIC_THRESHOLDS.minRobustZScore) {
      detectorReasons.push("robust_z_score_passed");
    }

    if (detectorReasons.length < 3) continue;

    const windowStart = missed.bucket_start;
    const windowEnd = new Date(
      windowStart.getTime() + DIAGNOSTIC_THRESHOLDS.bucketMinutes * 60_000,
    );
    const drivers = await loadDriversForWindow(
      db,
      organizationId,
      windowStart,
      windowEnd,
      missed.channel,
      missed.queue_id,
    );
    const topDriver = drivers[0]?.key ?? "unknown";
    const ready = readyBuckets.find(
      (row) => row.bucket_start.getTime() === missed.bucket_start.getTime(),
    );
    const wait = waitBuckets.find(
      (row) =>
        row.bucket_start.getTime() === missed.bucket_start.getTime() &&
        row.channel === missed.channel &&
        row.queue_id === missed.queue_id,
    );

    const baselineReady = median(
      readyBuckets
        .filter((row) => weekdayHourKey(row.bucket_start) === weekdayHourKey(missed.bucket_start))
        .map((row) => row.ready_agents_average ?? 0),
    );
    const baselineWait = median(
      waitBuckets
        .filter(
          (row) =>
            weekdayHourKey(row.bucket_start) === weekdayHourKey(missed.bucket_start) &&
            row.channel === missed.channel &&
            row.queue_id === missed.queue_id,
        )
        .map((row) => row.oldest_wait_seconds ?? 0),
    );

    const baselineFacts: DiagnosticBaselineFacts = {
      method: "matching_weekday_slot_median_mad",
      lookbackDays: DIAGNOSTIC_THRESHOLDS.lookbackDays,
      missedContactRate: Math.round(baselineRate * 10) / 10,
      uniqueMissedConversations: Math.round(
        median(
          missedBuckets
            .filter(
              (row) =>
                weekdayHourKey(row.bucket_start) === weekdayHourKey(missed.bucket_start) &&
                row.channel === missed.channel &&
                row.queue_id === missed.queue_id,
            )
            .map((row) => row.unique_missed_conversations),
        ),
      ),
      readyAgentsAverage: baselineReady > 0 ? Math.round(baselineReady) : null,
      oldestWaitSeconds: baselineWait > 0 ? Math.round(baselineWait) : null,
      robustZScore: Math.round(robustZ * 10) / 10,
    };

    const currentFacts: DiagnosticIncidentFacts = {
      windowStart: windowStart.toISOString(),
      windowEnd: windowEnd.toISOString(),
      channel: missed.channel,
      queueId: missed.queue_id,
      queueName: missed.queue_name,
      agentDemandConversations,
      uniqueMissedConversations: missed.unique_missed_conversations,
      missedEventCount: missed.missed_event_count,
      missedContactRate: Math.round(missedContactRate * 10) / 10,
      readyAgentsAverage: ready?.ready_agents_average
        ? Math.round(ready.ready_agents_average)
        : null,
      oldestWaitSeconds: wait?.oldest_wait_seconds
        ? Math.round(wait.oldest_wait_seconds)
        : null,
      topDriver,
      drivers,
    };

    const fingerprint = buildFingerprint(
      organizationId,
      missed.channel,
      missed.queue_id,
      topDriver,
    );

    candidates.push({
      fingerprint,
      incidentType: "missed_contact_spike",
      severity: deriveSeverity(rateDelta, robustZ),
      status: "active",
      persistenceBuckets: DIAGNOSTIC_THRESHOLDS.persistenceBuckets,
      detectorReasons,
      scope: {
        channel: missed.channel,
        queueId: missed.queue_id,
        queueName: missed.queue_name,
      },
      currentFacts,
      baselineFacts,
    });
  }

  const deduped = new Map<string, MissedContactCandidate>();
  for (const candidate of candidates) {
    const existing = deduped.get(candidate.fingerprint);
    if (!existing || candidate.currentFacts.missedContactRate > existing.currentFacts.missedContactRate) {
      deduped.set(candidate.fingerprint, candidate);
    }
  }
  return [...deduped.values()].sort((left, right) => {
    const severityRank = { critical: 4, high: 3, medium: 2, low: 1 } as const;
    return severityRank[right.severity] - severityRank[left.severity];
  });
}

function shouldRefreshNarrative(
  previous: StoredIncident | null,
  candidate: MissedContactCandidate,
): boolean {
  if (!previous) return true;
  if (previous.severity !== candidate.severity) return true;
  if (previous.currentFacts.topDriver !== candidate.currentFacts.topDriver) return true;
  const rateDelta = Math.abs(
    previous.currentFacts.missedContactRate - candidate.currentFacts.missedContactRate,
  );
  return rateDelta >= 2;
}

export async function refreshDiagnosticIncidents(
  db: DbClient,
  organizationId: string,
): Promise<{
  incidents: DiagnosticIncidentRecord[];
  weeklyComparison: DiagnosticWeeklyComparison | null;
}> {
  const [bucketCandidates, weeklyCandidates, weeklyComparison] = await Promise.all([
    detectMissedContactCandidates(db, organizationId),
    detectWeeklyMissedContactCandidates(db, organizationId),
    buildDiagnosticWeeklyComparison(db, organizationId),
  ]);
  const candidates = dedupeCandidatesByScope([...weeklyCandidates, ...bucketCandidates]);

  const stored = await Promise.all(candidates.slice(0, 5).map(async (candidate) => {
    const previous = await getIncidentByFingerprint(db, organizationId, candidate.fingerprint);
    const deterministic = buildDeterministicNarrative(
      candidate.currentFacts,
      candidate.baselineFacts,
      candidate.incidentType,
    );
    let headline = deterministic.headline;
    let summary = deterministic.summary;
    let source = "rules";
    let modelName: string | null = null;
    let version = (previous?.version ?? 0) + 1;

    if (shouldRefreshNarrative(previous, candidate)) {
      const review = await fetchDiagnosticReview(organizationId, {
        fingerprint: candidate.fingerprint,
        incidentType: candidate.incidentType,
        severity: candidate.severity,
        persistenceBuckets: candidate.persistenceBuckets,
        detectorReasons: candidate.detectorReasons,
        previousIncident: previous
          ? {
              version: previous.version,
              severity: previous.severity,
              headline: previous.headline,
              topDriver: previous.currentFacts.topDriver,
              missedContactRate: previous.currentFacts.missedContactRate,
              uniqueMissedConversations: previous.currentFacts.uniqueMissedConversations,
            }
          : null,
        currentFacts: candidate.currentFacts,
        baselineFacts: candidate.baselineFacts,
      });
      if (review && review.decision === "update") {
        headline = review.headline || headline;
        summary = review.summary || summary;
        source = "nlp";
        modelName = review.modelName ?? null;
      } else if (review?.decision === "no_change" && previous) {
        headline = previous.headline;
        summary = previous.summary;
        source = previous.source;
        modelName = previous.modelName;
        version = previous.version;
      }
    } else if (previous) {
      headline = previous.headline;
      summary = previous.summary;
      source = previous.source;
      modelName = previous.modelName;
      version = previous.version;
    }

    return upsertIncident(db, organizationId, {
      fingerprint: candidate.fingerprint,
      incidentType: candidate.incidentType,
      status: candidate.status,
      severity: candidate.severity,
      version,
      scope: candidate.scope,
      currentFacts: candidate.currentFacts,
      baselineFacts: candidate.baselineFacts,
      headline,
      summary,
      source,
      schemaVersion: DASHBOARD_ANALYTICS_SCHEMA_VERSION,
      promptVersion: DASHBOARD_ANALYTICS_PROMPT_VERSION,
      modelName,
      inputHash: hashInput({
        fingerprint: candidate.fingerprint,
        currentFacts: candidate.currentFacts,
        baselineFacts: candidate.baselineFacts,
      }),
    });
  }));

  const active = stored.length > 0 ? stored : await listActiveIncidents(db, organizationId);
  return {
    incidents: dedupeIncidentsByScope(active.map(storedIncidentToRecord)),
    weeklyComparison,
  };
}

export function selectIncident(
  incidents: DiagnosticIncidentRecord[],
  incidentId?: string | null,
): DiagnosticIncidentRecord | null {
  if (incidents.length === 0) return null;
  if (incidentId) {
    return incidents.find((incident) => incident.id === incidentId) ?? incidents[0] ?? null;
  }
  return incidents[0] ?? null;
}

export function emptyDiagnosticState(): DiagnosticIncidentRecord[] {
  return [];
}

export function formatIncidentBucket(date: Date): string {
  return bucketStartIso(date);
}

export function serializeQueueId(queueId: string | null | undefined): string | null {
  return serializeEntityIdOptional(queueId);
}
