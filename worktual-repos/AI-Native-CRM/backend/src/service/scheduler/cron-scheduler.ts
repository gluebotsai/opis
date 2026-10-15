/**
 * In-process scheduler for the `/api/cron/*` sweeps.
 *
 * These sweeps (lead enrichment/scoring/nurture/lifecycle, score decay,
 * lifecycle stall, meeting reminders/miss-escalation) were previously only
 * reachable via an authenticated HTTP call — nothing in this repo actually
 * invoked them on a schedule, so due jobs could sit unprocessed until someone
 * manually curled the endpoint. This calls the same job functions directly
 * (no HTTP hop) on a timer inside the API process.
 *
 * Disable with CRON_SCHEDULER_ENABLED=false — e.g. when an external
 * scheduler (hosted cron, systemd timer) already hits /api/cron/* and you
 * don't want double processing across multiple app instances. Safe either
 * way: every job claim is an atomic `UPDATE ... WHERE status = ... RETURNING`
 * in Postgres, so concurrent triggers cannot double-apply the same job.
 */

import { processMeetingReminders } from "@/dao/calendar/meeting-reminders";
import { processMeetingMissEscalations } from "@/dao/calendar/meeting-miss-escalation";
import { reconcileDueMeetingCaptures, refreshStaleScheduledCaptureBots } from "@/service/transcripts/meeting-capture";
import { syncAllConnectedCalendars } from "@/dao/calendar/sync-calendars";
import {
  syncAllConnectedMailboxes,
  syncLiveInboundMail,
  INBOX_SYNC_LIVE_INTERVAL_MS,
  INBOX_SYNC_FULL_INTERVAL_MS,
} from "@/dao/inbox/sync-mailboxes";
import {
  bootstrapGmailPushWatches,
  renewExpiringGmailPushWatches,
} from "@/service/inbox/gmail-push";
import {
  bootstrapGoogleCalendarWatches,
  isCalendarPushConfigured,
  renewExpiringGoogleCalendarWatches,
} from "@/service/calendar/google-calendar-push";
import {
  processDueLeadEnrichmentJobs,
  reconcileMissingLeadEnrichmentJobs,
} from "@/service/ai/lead-enrichment-job";
import { processDueLeadScoringJobs } from "@/service/ai/lead-scoring-job";
import {
  armScheduledVoiceNurtureTimers,
  processConversationDeferredNurtureJobs,
  processDueLeadNurtureJobs,
} from "@/service/ai/lead-nurture-job";
import { processDueLeadLifecycleJobs } from "@/service/ai/lead-lifecycle-job";
import { processLeadScoreDecay } from "@/service/ai/lead-score-decay";
import { processLifecycleStallFlags } from "@/service/ai/lead-lifecycle-stall";
import { processLeadAssignmentFollowups } from "@/service/ai/lead-assignment-followup";
import { processLeadSummaryRefreshes } from "@/service/ai/lead-summary-refresh";
import { processDispositionSweep } from "@/service/ai/disposition-job";
import { processPipelineForecastSweep } from "@/service/ai/pipeline-forecast-job";
import { processInvoiceEscalationSweep } from "@/service/ai/invoice-escalation-job";
import { processCompanyCollectionRiskSweep } from "@/service/ai/company-collection-risk-job";
import { syncCompaniesFromContactsSweep } from "@/dao/companies/sync-from-contacts";
import { processRevenueGapForecastSweep } from "@/service/ai/revenue-gap-forecast-job";
import { processInvoiceDunningSweep } from "@/service/ai/invoice-dunning-job";
import { processExpansionMatcherSweep } from "@/service/ai/expansion-matcher-job";
import { processProposalGenerationTick } from "@/service/sales/proposal-run-worker";
import { runProposalOutlineEvalsIfEnabled } from "@/service/sales/proposal-evals";
import {
  funnelSnapshotSweepIntervalMs,
  processFunnelSnapshotSweep,
} from "@/service/reports/funnel-snapshot-job";
import { processSeoSemrushWeeklySweep } from "@/service/seo/semrush-sync-job";
import { processDueSeoSocialPublishes } from "@/service/seo/social-publish-job";
import { processDueScheduledOutboundEmails } from "@/service/inbox/scheduled-outbound-email";
import { createHash } from "node:crypto";
import os from "node:os";
import pg from "pg";
import { runInCronDbContext } from "@/dao/db/prisma";

const MINUTES = 60_000;

type SweepDefinition = {
  name: string;
  intervalMs: number;
  /** Wait this long after boot before the first run (staggers cold-start DB load). */
  initialDelayMs: number;
  run: () => Promise<unknown>;
};

const SWEEPS: SweepDefinition[] = [
  {
    name: "inbox-sync-live",
    intervalMs: INBOX_SYNC_LIVE_INTERVAL_MS,
    initialDelayMs: 4_000,
    run: () => syncLiveInboundMail(),
  },
  {
    name: "inbox-sync",
    intervalMs: INBOX_SYNC_FULL_INTERVAL_MS,
    initialDelayMs: 10_000,
    run: () => syncAllConnectedMailboxes(25, { includeBotInboxes: false }),
  },
  {
    name: "gmail-push-renew",
    intervalMs: 6 * 60 * MINUTES,
    initialDelayMs: 60_000,
    run: () => renewExpiringGmailPushWatches(),
  },
  {
    name: "calendar-push-renew",
    intervalMs: 6 * 60 * MINUTES,
    initialDelayMs: 90_000,
    run: () => renewExpiringGoogleCalendarWatches(),
  },
  {
    name: "calendar-inbound",
    intervalMs: 10 * MINUTES,
    initialDelayMs: 12_000,
    run: async () => {
      if (isCalendarPushConfigured()) return { skipped: true, reason: "push" };
      return syncAllConnectedCalendars(25);
    },
  },
  {
    name: "lead-enrichment",
    // Fast base sweep; LISTEN crm_lead_enrichment wakes drain on insert bursts.
    intervalMs: 15_000,
    initialDelayMs: 5_000,
    run: () => processDueLeadEnrichmentJobs(),
  },
  {
    name: "lead-enrichment-reconcile",
    intervalMs: 5 * MINUTES,
    initialDelayMs: 45_000,
    run: () => reconcileMissingLeadEnrichmentJobs(100),
  },
  {
    name: "lead-scoring",
    intervalMs: 1 * MINUTES,
    initialDelayMs: 10_000,
    run: () => processDueLeadScoringJobs(),
  },
  {
    name: "lead-lifecycle",
    intervalMs: 2 * MINUTES,
    initialDelayMs: 15_000,
    run: () => processDueLeadLifecycleJobs(),
  },
  {
    name: "lead-nurture",
    intervalMs: 5 * MINUTES,
    initialDelayMs: 20_000,
    run: () => processDueLeadNurtureJobs(),
  },
  {
    name: "lead-nurture-conversation-gate",
    intervalMs: 30_000,
    initialDelayMs: 22_000,
    run: () => processConversationDeferredNurtureJobs(8),
  },
  {
    name: "meeting-reminders",
    intervalMs: 5 * MINUTES,
    initialDelayMs: 25_000,
    run: () => processMeetingReminders(),
  },
  {
    name: "meeting-capture-reconcile",
    intervalMs: 2 * MINUTES,
    initialDelayMs: 20_000,
    run: async () => {
      await refreshStaleScheduledCaptureBots();
      return reconcileDueMeetingCaptures();
    },
  },
  {
    name: "meeting-miss-escalations",
    intervalMs: 10 * MINUTES,
    initialDelayMs: 30_000,
    run: () => processMeetingMissEscalations(),
  },
  {
    name: "lead-assignment-followup",
    intervalMs: MINUTES,
    initialDelayMs: 20_000,
    run: () => processLeadAssignmentFollowups(),
  },
  {
    name: "lead-summary-refresh",
    intervalMs: 30_000,
    initialDelayMs: 25_000,
    run: () => processLeadSummaryRefreshes(),
  },
  {
    name: "disposition",
    intervalMs: 1 * MINUTES,
    initialDelayMs: 28_000,
    run: () => processDispositionSweep(),
  },
  {
    name: "lifecycle-stall",
    intervalMs: 30 * MINUTES,
    initialDelayMs: 35_000,
    run: () => processLifecycleStallFlags(),
  },
  {
    name: "pipeline-forecast",
    intervalMs: 30 * MINUTES,
    initialDelayMs: 38_000,
    run: () => processPipelineForecastSweep(),
  },
  {
    name: "invoice-escalation",
    intervalMs: 30 * MINUTES,
    initialDelayMs: 42_000,
    run: () => processInvoiceEscalationSweep(),
  },
  {
    name: "company-contact-sync",
    // Backfill contact company names into crm.companies. Off the list request
    // so opening Companies stays a single page read. Contact writes sync immediately.
    intervalMs: 10 * MINUTES,
    initialDelayMs: 22_000,
    run: () => syncCompaniesFromContactsSweep(),
  },
  {
    name: "company-collection-risk",
    // Company-level pattern moves slowly (24h recheck inside the job) —
    // hourly cadence is a safe ceiling, fingerprint dedup skips no-ops.
    intervalMs: 60 * MINUTES,
    initialDelayMs: 44_000,
    run: () => processCompanyCollectionRiskSweep(),
  },
  {
    name: "revenue-gap-forecast",
    intervalMs: 60 * MINUTES,
    initialDelayMs: 45_000,
    run: () => processRevenueGapForecastSweep(),
  },
  {
    name: "invoice-dunning",
    intervalMs: 30 * MINUTES,
    initialDelayMs: 43_000,
    run: () => processInvoiceDunningSweep(),
  },
  {
    name: "expansion-matcher",
    // 7-day staleness gate per company — expansion signals don't need daily
    // recompute the way open-deal forecasts / overdue invoices do.
    intervalMs: 24 * 60 * MINUTES,
    initialDelayMs: 46_000,
    run: () => processExpansionMatcherSweep(),
  },
  {
    name: "proposal-generation",
    intervalMs: 5_000,
    initialDelayMs: 8_000,
    run: () => processProposalGenerationTick(),
  },
  {
    name: "proposal-evals",
    intervalMs: 24 * 60 * MINUTES,
    initialDelayMs: 90_000,
    run: () => runProposalOutlineEvalsIfEnabled(),
  },
  {
    name: "lead-score-decay",
    // "Nightly" cadence — hourly is a safe ceiling since the query is bounded
    // (limit=150) and re-running against already-decayed jobs is a no-op cost,
    // not a correctness issue.
    intervalMs: 60 * MINUTES,
    initialDelayMs: 40_000,
    run: () => processLeadScoreDecay(),
  },
  {
    name: "funnel-snapshot",
    intervalMs: funnelSnapshotSweepIntervalMs(),
    initialDelayMs: 50_000,
    run: () => processFunnelSnapshotSweep(),
  },
  {
    name: "seo-semrush-sync",
    // Hourly tick; job no-ops unless Monday 04:00 Asia/Kolkata and not synced this ISO week.
    intervalMs: 60 * MINUTES,
    initialDelayMs: 55_000,
    run: () => processSeoSemrushWeeklySweep(),
  },
  {
    name: "seo-social-publish",
    intervalMs: 1 * MINUTES,
    initialDelayMs: 40_000,
    run: () => processDueSeoSocialPublishes(),
  },
  {
    name: "scheduled-outbound-email",
    intervalMs: 1 * MINUTES,
    initialDelayMs: 45_000,
    run: () => processDueScheduledOutboundEmails(),
  },
];

const timers: NodeJS.Timeout[] = [];
let started = false;
let leaderClient: InstanceType<typeof pg.Client> | null = null;
let activeAdvisoryLockId = "824673152019";

/** Production lock — one cron leader cluster-wide. */
const PRODUCTION_SCHEDULER_LOCK = "824673152019";

/**
 * Dev laptops share the Worktual DB; a global advisory lock leaves every
 * machine in standby except whoever connected first. Non-production uses a
 * per-host lock so local cron (reminders, nurture, scoring) still runs.
 */
export function resolveSchedulerAdvisoryLockId(): string {
  const override = process.env.CRON_SCHEDULER_LOCK_ID?.trim();
  if (override) return override;

  const env = (
    process.env.APP_ENV ||
    process.env.NODE_ENV ||
    "development"
  )
    .trim()
    .toLowerCase();
  if (env === "production") return PRODUCTION_SCHEDULER_LOCK;

  const host = os.hostname().trim() || "local";
  const hash = createHash("sha256")
    .update(`worktual-crm-cron:${host}`)
    .digest();
  const n = hash.readBigInt64BE(0) & BigInt("0x7FFFFFFFFFFFFFFF");
  return String(n);
}

function isEnabled(): boolean {
  const raw = process.env.CRON_SCHEDULER_ENABLED?.trim().toLowerCase();
  if (raw === "false" || raw === "0" || raw === "off") return false;
  return true;
}

function isSweepEnabled(sweep: SweepDefinition): boolean {
  // The open-lead nurture sweep can be disabled. The conversation gate must
  // keep polling every 30 seconds or a live chat is never resumed.
  if (sweep.name !== "lead-nurture") return true;
  const raw = process.env.LEAD_NURTURE_CRON_ENABLED?.trim().toLowerCase();
  return raw !== "false" && raw !== "0" && raw !== "off";
}

function runOnce(sweep: SweepDefinition, runningFlags: Set<string>): void {
  if (runningFlags.has(sweep.name)) {
    // Previous run of this sweep is still in flight — skip this tick rather
    // than pile up overlapping DB work.
    return;
  }
  runningFlags.add(sweep.name);
  // Routes every DB call this sweep makes (and its nested awaited calls) to
  // the isolated cron connection pool instead of the shared API pool — see
  // dao/db/prisma.ts. Purely additive: no DAO/service code changes needed.
  void runInCronDbContext(() => sweep.run())
    .then((result) => {
      if (process.env.CRON_SCHEDULER_VERBOSE === "true") {
        console.log(`[cron-scheduler] ${sweep.name} ok`, result);
      }
    })
    .catch((err) => {
      console.error(`[cron-scheduler] ${sweep.name} failed`, err);
    })
    .finally(() => {
      runningFlags.delete(sweep.name);
    });
}

/** Starts all recurring sweeps. Safe to call multiple times — only arms once. */
export async function startCronScheduler(): Promise<void> {
  if (started) return;
  if (!isEnabled()) {
    console.log(
      "[cron-scheduler] disabled via CRON_SCHEDULER_ENABLED — /api/cron/* sweeps must be triggered externally.",
    );
    return;
  }
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    console.error("[cron-scheduler] DATABASE_URL is required for the leader lease");
    return;
  }
  activeAdvisoryLockId = resolveSchedulerAdvisoryLockId();
  try {
    const client = new pg.Client({ connectionString: databaseUrl });
    await client.connect();
    const result = await client.query<{ acquired: boolean }>(
      "SELECT pg_try_advisory_lock($1::bigint) AS acquired",
      [activeAdvisoryLockId],
    );
    if (!result.rows[0]?.acquired) {
      await client.end();
      console.log(
        `[cron-scheduler] standby; lock ${activeAdvisoryLockId} held by another process on this machine`,
      );
      return;
    }
    leaderClient = client;
  } catch (error) {
    console.error("[cron-scheduler] leader lease unavailable", error);
    return;
  }
  started = true;
  const env = (process.env.APP_ENV || process.env.NODE_ENV || "development")
    .trim()
    .toLowerCase();
  if (env !== "production") {
    console.log(
      `[cron-scheduler] dev leader lock ${activeAdvisoryLockId} (${os.hostname()})`,
    );
  }
  const runningFlags = new Set<string>();

  const enabledSweeps = SWEEPS.filter(isSweepEnabled);
  for (const sweep of enabledSweeps) {
    const kickoff = setTimeout(() => {
      runOnce(sweep, runningFlags);
      const interval = setInterval(
        () => runOnce(sweep, runningFlags),
        sweep.intervalMs,
      );
      timers.push(interval);
    }, sweep.initialDelayMs);
    timers.push(kickoff);
  }

  console.log(
    `[cron-scheduler] started ${enabledSweeps.length} sweeps: ${enabledSweeps.map((s) => s.name).join(", ")}`,
  );

  void armScheduledVoiceNurtureTimers()
    .then((count) => {
      if (count > 0) {
        console.log(
          `[cron-scheduler] re-armed ${count} nurture voice delay timer(s)`,
        );
      }
    })
    .catch((err) => {
      console.error("[cron-scheduler] nurture voice timer bootstrap failed", err);
    });

  void bootstrapGmailPushWatches()
    .then((result) => {
      if (result.registered > 0 || result.errors.length > 0) {
        console.log("[cron-scheduler] gmail-push bootstrap", result);
      }
      if (result.errors.length > 0) {
        console.warn(
          `[cron-scheduler] gmail-push bootstrap had ${result.errors.length} error(s); API continues`,
        );
      }
    })
    .catch((err) => {
      console.error("[cron-scheduler] gmail-push bootstrap failed (non-fatal)", err);
    });

  void bootstrapGoogleCalendarWatches()
    .then((result) => {
      if (result.registered > 0 || result.errors.length > 0) {
        console.log("[cron-scheduler] calendar-push bootstrap", result);
      }
    })
    .catch((err) => {
      console.error("[cron-scheduler] calendar-push bootstrap failed", err);
    });
}

/** Stops all timers — used by graceful shutdown and tests. */
export async function stopCronScheduler(): Promise<void> {
  for (const t of timers) clearTimeout(t as NodeJS.Timeout);
  timers.length = 0;
  started = false;
  const client = leaderClient;
  leaderClient = null;
  if (client) {
    await client
      .query("SELECT pg_advisory_unlock($1::bigint)", [activeAdvisoryLockId])
      .catch(() => undefined);
    await client.end().catch(() => undefined);
  }
}
