/**
 * Aggregate AI agent performance for the Agents dashboard.
 * Counts use existing one-row-per-contact tables (latest state), filtered by
 * completedAt / updatedAt in the selected window — not a full run history log.
 */

import { getPrismaClient } from "@/dao/db/prisma";
import {
  rangeSince,
  type AgentMetricCard,
  type AgentRangeId,
  type AgentsDashboardPayload,
} from "@/dao/ai/agents-dashboard-shared";
import { resolveRequestOrganizationId } from "@/service/auth/require-role";

export type {
  AgentMetricCard,
  AgentRangeId,
  AgentsDashboardPayload,
} from "@/dao/ai/agents-dashboard-shared";
export {
  AGENT_RANGE_OPTIONS,
  parseAgentRange,
  rangeSince,
} from "@/dao/ai/agents-dashboard-shared";

export async function getAgentsDashboardMetrics(input?: {
  organizationId?: string | null;
  range?: AgentRangeId;
}): Promise<AgentsDashboardPayload> {
  const organizationId = await resolveRequestOrganizationId(input?.organizationId);
  const range = input?.range ?? "1d";
  const until = new Date();
  const since = rangeSince(range, until);
  const prisma = getPrismaClient();

  const [
    enrichmentRows,
    summaryRows,
    enrichmentActive,
    nurtureRows,
    scoringRows,
    lifecycleRows,
    assignmentRows,
    autoReplyRows,
    meetingReminderRows,
    meetingBriefRows,
    postMeetingRows,
    postMeetingPending,
    meetingMissRows,
    meetingMomRows,
    forecastRows,
    salesCoachRows,
    salesCoachFailedRows,
    complianceOptOutRows,
    complianceRequestRows,
    invoiceEscalationRows,
    collectionRiskRows,
    dunningRows,
    revenueForecastRows,
    expansionMatcherRows,
  ] = await Promise.all([
    prisma.$queryRawUnsafe<
      Array<{ status: string; count: number | bigint }>
    >(
      `
      SELECT status::text AS status, COUNT(*)::int AS count
      FROM lead_enrichment_jobs
      WHERE organization_id = $1::bigint
        AND completed_at IS NOT NULL
        AND completed_at >= $2
        AND completed_at <= $3
      GROUP BY status
    `,
      organizationId,
      since,
      until,
    ),
    prisma.$queryRawUnsafe<
      Array<{ source: string; count: number | bigint }>
    >(
      `
      SELECT COALESCE(source, 'unknown') AS source, COUNT(*)::int AS count
      FROM lead_summaries
      WHERE organization_id = $1::bigint
        AND updated_at >= $2
        AND updated_at <= $3
      GROUP BY COALESCE(source, 'unknown')
      `,
      organizationId,
      since,
      until,
    ),
    prisma.$queryRawUnsafe<
      Array<{ status: string; count: number | bigint }>
    >(
      `
      SELECT status::text AS status, COUNT(*)::int AS count
      FROM lead_enrichment_jobs
      WHERE organization_id = $1::bigint
        AND status IN ('pending', 'running')
      GROUP BY status
      `,
      organizationId,
    ),
    prisma.$queryRawUnsafe<
      Array<{ status: string; count: number | bigint }>
    >(
      `
      SELECT status::text AS status, COUNT(*)::int AS count
      FROM lead_nurture_jobs
      WHERE organization_id = $1::bigint
        AND completed_at IS NOT NULL
        AND completed_at >= $2
        AND completed_at <= $3
        AND status IN ('sent', 'failed')
      GROUP BY status
    `,
      organizationId,
      since,
      until,
    ),
    prisma.$queryRawUnsafe<
      Array<{
        status: string;
        grade: string | null;
        source: string | null;
        count: number | bigint;
      }>
    >(
      `
      SELECT status::text AS status,
             grade,
             COALESCE(result_summary->>'source', 'ai') AS source,
             COUNT(*)::int AS count
      FROM lead_scoring_jobs
      WHERE organization_id = $1::bigint
        AND completed_at IS NOT NULL
        AND completed_at >= $2
        AND completed_at <= $3
        AND status IN ('scored', 'failed')
      GROUP BY status, grade, COALESCE(result_summary->>'source', 'ai')
    `,
      organizationId,
      since,
      until,
    ),
    // Append-only run history: the job table keeps only the latest state per
    // contact, so a later run would otherwise shrink earlier counts.
    prisma.$queryRawUnsafe<
      Array<{ ladder: string | null; status: string; count: number | bigint }>
    >(
      `
      SELECT COALESCE(meta->>'ladder', 'none') AS ladder,
             COALESCE(meta->>'outcome', 'applied') AS status,
             COUNT(*)::int AS count
      FROM audit_logs
      WHERE organization_id = $1::bigint
        AND meta->>'agent' = 'lead_lifecycle'
        AND created_at >= $2
        AND created_at <= $3
      GROUP BY COALESCE(meta->>'ladder', 'none'),
               COALESCE(meta->>'outcome', 'applied')
    `,
      organizationId,
      since,
      until,
    ),
    prisma.$queryRawUnsafe<
      Array<{ matched: boolean | null; count: number | bigint }>
    >(
      `
      SELECT (meta->>'matchedRegion')::boolean AS matched, COUNT(*)::int AS count
      FROM audit_logs
      WHERE organization_id = $1::bigint
        AND action = 'assign'
        AND meta->>'agent' = 'sales_assignment'
        AND created_at >= $2
        AND created_at <= $3
      GROUP BY (meta->>'matchedRegion')::boolean
    `,
      organizationId,
      since,
      until,
    ),
    prisma.$queryRawUnsafe<
      Array<{ status: string; count: number | bigint }>
    >(
      `
      SELECT status::text AS status, COUNT(*)::int AS count
      FROM email_auto_reply_jobs
      WHERE organization_id = $1::bigint
        AND updated_at >= $2
        AND updated_at <= $3
        AND status IN ('replied', 'escalated', 'failed')
      GROUP BY status
    `,
      organizationId,
      since,
      until,
    ),
    prisma.$queryRawUnsafe<
      Array<{
        leg: string | null;
        window: string | null;
        outcome: string | null;
        count: number | bigint;
      }>
    >(
      `
      SELECT meta->>'leg' AS leg,
             meta->>'window' AS window,
             COALESCE(meta->>'outcome', 'sent') AS outcome,
             COUNT(*)::int AS count
      FROM audit_logs
      WHERE organization_id = $1::bigint
        AND meta->>'agent' = 'meeting_reminder'
        AND created_at >= $2
        AND created_at <= $3
      GROUP BY meta->>'leg', meta->>'window', COALESCE(meta->>'outcome', 'sent')
    `,
      organizationId,
      since,
      until,
    ),
    prisma.$queryRawUnsafe<
      Array<{ outcome: string | null; count: number | bigint }>
    >(
      `
      SELECT COALESCE(meta->>'outcome', 'sent') AS outcome, COUNT(*)::int AS count
      FROM audit_logs
      WHERE organization_id = $1::bigint
        AND meta->>'agent' = 'meeting_brief'
        AND created_at >= $2
        AND created_at <= $3
      GROUP BY COALESCE(meta->>'outcome', 'sent')
    `,
      organizationId,
      since,
      until,
    ),
    prisma.$queryRawUnsafe<
      Array<{ outcome: string | null; count: number | bigint }>
    >(
      `
      SELECT COALESCE(meta->>'outcome', 'completed') AS outcome, COUNT(*)::int AS count
      FROM audit_logs
      WHERE organization_id = $1::bigint
        AND meta->>'agent' = 'post_meeting_process'
        AND created_at >= $2
        AND created_at <= $3
      GROUP BY COALESCE(meta->>'outcome', 'completed')
    `,
      organizationId,
      since,
      until,
    ),
    prisma.$queryRawUnsafe<Array<{ count: number | bigint }>>(
      `
      SELECT COUNT(*)::int AS count
      FROM process_confirmations
      WHERE organization_id = $1::bigint
        AND status = 'pending'
    `,
      organizationId,
    ),
    prisma.$queryRawUnsafe<
      Array<{ outcome: string | null; count: number | bigint }>
    >(
      `
      SELECT COALESCE(meta->>'outcome', 'sent') AS outcome, COUNT(*)::int AS count
      FROM audit_logs
      WHERE organization_id = $1::bigint
        AND meta->>'agent' = 'meeting_miss_escalation'
        AND created_at >= $2
        AND created_at <= $3
      GROUP BY COALESCE(meta->>'outcome', 'sent')
    `,
      organizationId,
      since,
      until,
    ),
    prisma.$queryRawUnsafe<
      Array<{ outcome: string | null; count: number | bigint }>
    >(
      `
      SELECT COALESCE(meta->>'outcome', 'sent') AS outcome, COUNT(*)::int AS count
      FROM audit_logs
      WHERE organization_id = $1::bigint
        AND meta->>'agent' = 'meeting_mom'
        AND created_at >= $2
        AND created_at <= $3
      GROUP BY COALESCE(meta->>'outcome', 'sent')
    `,
      organizationId,
      since,
      until,
    ),
    prisma.$queryRawUnsafe<
      Array<{ category: string | null; flagged: boolean; count: number | bigint }>
    >(
      `
      SELECT forecast_category AS category, forecast_flagged AS flagged, COUNT(*)::int AS count
      FROM deals
      WHERE organization_id = $1::bigint
        AND forecast_last_run_at IS NOT NULL
        AND forecast_last_run_at >= $2
        AND forecast_last_run_at <= $3
      GROUP BY forecast_category, forecast_flagged
    `,
      organizationId,
      since,
      until,
    ),
    prisma.$queryRawUnsafe<
      Array<{ impression: string; count: number | bigint }>
    >(
      `
      SELECT overall_impression AS impression, COUNT(*)::int AS count
      FROM coaching_insights
      WHERE organization_id = $1::bigint
        AND analyzed_at >= $2
        AND analyzed_at <= $3
      GROUP BY overall_impression
    `,
      organizationId,
      since,
      until,
    ),
    prisma.$queryRawUnsafe<Array<{ count: number | bigint }>>(
      `
      SELECT COUNT(*)::int AS count
      FROM audit_logs
      WHERE organization_id = $1::bigint
        AND meta->>'agent' = 'sales_coach'
        AND meta->>'outcome' = 'failed'
        AND created_at >= $2
        AND created_at <= $3
    `,
      organizationId,
      since,
      until,
    ),
    prisma.$queryRawUnsafe<Array<{ count: number | bigint }>>(
      `
      SELECT COUNT(*)::int AS count
      FROM contact_profiles
      WHERE organization_id = $1::bigint
        AND marketing_opt_out_at >= $2
        AND marketing_opt_out_at <= $3
    `,
      organizationId,
      since,
      until,
    ),
    prisma.$queryRawUnsafe<Array<{ status: string; count: number | bigint }>>(
      `
      SELECT status::text AS status, COUNT(*)::int AS count
      FROM privacy_requests
      WHERE organization_id = $1::bigint
        AND created_at >= $2
        AND created_at <= $3
      GROUP BY status
    `,
      organizationId,
      since,
      until,
    ),
    prisma.$queryRawUnsafe<
      Array<{ severity: string | null; count: number | bigint }>
    >(
      `
      SELECT escalation_severity AS severity, COUNT(*)::int AS count
      FROM invoices
      WHERE organization_id = $1::bigint
        AND escalation_last_run_at IS NOT NULL
        AND escalation_last_run_at >= $2
        AND escalation_last_run_at <= $3
      GROUP BY escalation_severity
    `,
      organizationId,
      since,
      until,
    ),
    prisma.$queryRawUnsafe<
      Array<{ level: string | null; count: number | bigint }>
    >(
      `
      SELECT collection_risk_level AS level, COUNT(*)::int AS count
      FROM companies
      WHERE organization_id = $1::bigint
        AND collection_risk_last_run_at IS NOT NULL
        AND collection_risk_last_run_at >= $2
        AND collection_risk_last_run_at <= $3
      GROUP BY collection_risk_level
    `,
      organizationId,
      since,
      until,
    ),
    prisma.$queryRawUnsafe<
      Array<{ stage: string | null; count: number | bigint }>
    >(
      `
      SELECT dunning_stage AS stage, COUNT(*)::int AS count
      FROM invoices
      WHERE organization_id = $1::bigint
        AND dunning_stage_sent_at IS NOT NULL
        AND dunning_stage_sent_at >= $2
        AND dunning_stage_sent_at <= $3
      GROUP BY dunning_stage
    `,
      organizationId,
      since,
      until,
    ),
    prisma.$queryRawUnsafe<
      Array<{ has_forecast: boolean }>
    >(
      `
      SELECT (revenue_forecast_last_run_at IS NOT NULL
        AND revenue_forecast_last_run_at >= $2
        AND revenue_forecast_last_run_at <= $3) AS has_forecast
      FROM org_finance_settings
      WHERE organization_id = $1::bigint
    `,
      organizationId,
      since,
      until,
    ),
    prisma.$queryRawUnsafe<
      Array<{ signal: string | null; count: number | bigint }>
    >(
      `
      SELECT expansion_signal AS signal, COUNT(*)::int AS count
      FROM companies
      WHERE organization_id = $1::bigint
        AND expansion_last_run_at IS NOT NULL
        AND expansion_last_run_at >= $2
        AND expansion_last_run_at <= $3
      GROUP BY expansion_signal
    `,
      organizationId,
      since,
      until,
    ),
  ]);

  const enrichMap = new Map(
    enrichmentRows.map((r) => [r.status, Number(r.count)]),
  );
  const enriched = enrichMap.get("enriched") ?? 0;
  const skipped = enrichMap.get("skipped") ?? 0;
  const failed = enrichMap.get("failed") ?? 0;
  const enrichTotal = enriched + skipped + failed;

  const activeMap = new Map(
    enrichmentActive.map((r) => [r.status, Number(r.count)]),
  );
  const pending = activeMap.get("pending") ?? 0;
  const running = activeMap.get("running") ?? 0;

  const summaryMap = new Map(
    summaryRows.map((r) => [r.source, Number(r.count)]),
  );
  const summaryAi = summaryMap.get("ai") ?? 0;
  // Non-AI rows (legacy heuristic / unknown) count as Failed — summaries are LLM-only.
  const summaryFailed = [...summaryMap.entries()]
    .filter(([k]) => k !== "ai")
    .reduce((sum, [, n]) => sum + n, 0);
  const summaryTotal = summaryAi + summaryFailed;

  const nurtureMap = new Map(
    nurtureRows.map((r) => [r.status, Number(r.count)]),
  );
  const nurtureSent = nurtureMap.get("sent") ?? 0;
  const nurtureFailed = nurtureMap.get("failed") ?? 0;
  // Dashboard shows send vs fail only (waited / skipped stay in the job table).
  const nurtureTotal = nurtureSent + nurtureFailed;

  let scoringScored = 0;
  let scoringFailed = 0;
  let scoringGradeA = 0;
  let scoringGradeB = 0;
  let scoringOffline = 0;
  for (const row of scoringRows) {
    const n = Number(row.count);
    if (row.status === "failed") {
      scoringFailed += n;
      continue;
    }
    if (row.status === "scored") {
      scoringScored += n;
      if (row.source === "heuristic") scoringOffline += n;
      if (row.grade === "A") scoringGradeA += n;
      else if (row.grade === "B") scoringGradeB += n;
    }
  }
  const scoringTotal = scoringScored + scoringFailed;

  let lifecycleLeadStatus = 0;
  let lifecycleConverted = 0;
  let lifecyclePipeline = 0;
  let lifecycleFailed = 0;
  for (const row of lifecycleRows) {
    const n = Number(row.count);
    if (row.status === "failed") {
      lifecycleFailed += n;
      continue;
    }
    if (row.ladder === "lead_status") lifecycleLeadStatus += n;
    else if (row.ladder === "lifecycle") lifecycleConverted += n;
    else if (row.ladder === "pipeline") lifecyclePipeline += n;
  }
  const lifecycleTotal =
    lifecycleLeadStatus + lifecycleConverted + lifecyclePipeline + lifecycleFailed;

  let assignmentRegional = 0;
  let assignmentBalanced = 0;
  for (const row of assignmentRows) {
    const n = Number(row.count);
    if (row.matched === true) assignmentRegional += n;
    else assignmentBalanced += n;
  }
  const assignmentTotal = assignmentRegional + assignmentBalanced;

  const autoReplyMap = new Map(
    autoReplyRows.map((r) => [r.status, Number(r.count)]),
  );
  const autoReplied = autoReplyMap.get("replied") ?? 0;
  const autoAwaitingDemo = autoReplyMap.get("awaiting_demo") ?? 0;
  const autoEscalated = autoReplyMap.get("escalated") ?? 0;
  const autoFailed = autoReplyMap.get("failed") ?? 0;
  // Skipped mail (bounces, auto-responders) is noise, not agent work.
  const autoReplyTotal =
    autoReplied + autoAwaitingDemo + autoEscalated + autoFailed;

  let reminderOwnerSent = 0;
  let reminderCustomerSent = 0;
  let reminder24h = 0;
  let reminder1h = 0;
  let reminderFailed = 0;
  for (const row of meetingReminderRows) {
    const n = Number(row.count);
    if (row.outcome === "failed") {
      reminderFailed += n;
      continue;
    }
    if (row.outcome === "skipped") continue;
    if (row.leg === "owner") reminderOwnerSent += n;
    else if (row.leg === "customer") reminderCustomerSent += n;
    if (row.window === "24h") reminder24h += n;
    else if (row.window === "1h") reminder1h += n;
  }
  const reminderTotal =
    reminderOwnerSent + reminderCustomerSent + reminderFailed;

  const briefMap = new Map(
    meetingBriefRows.map((r) => [r.outcome ?? "sent", Number(r.count)]),
  );
  const briefSent = briefMap.get("sent") ?? 0;
  const briefFailed = briefMap.get("failed") ?? 0;
  const briefTotal = briefSent + briefFailed;

  const postMap = new Map(
    postMeetingRows.map((r) => [r.outcome ?? "completed", Number(r.count)]),
  );
  const postCompleted = postMap.get("completed") ?? 0;
  const postFailed = postMap.get("failed") ?? 0;
  const postPendingNow = Number(postMeetingPending[0]?.count ?? 0);
  const postTotal = postCompleted + postFailed;

  const missMap = new Map(
    meetingMissRows.map((r) => [r.outcome ?? "sent", Number(r.count)]),
  );
  const missSent = missMap.get("sent") ?? 0;
  const missNotifyOnly = missMap.get("notify_only") ?? 0;
  const missFailed = missMap.get("failed") ?? 0;
  const missTotal = missSent + missNotifyOnly + missFailed;

  const momMap = new Map(
    meetingMomRows.map((r) => [r.outcome ?? "sent", Number(r.count)]),
  );
  const momSent = momMap.get("sent") ?? 0;
  const momNotifyOnly = momMap.get("notify_only") ?? 0;
  const momFailed = momMap.get("failed") ?? 0;
  const momTotal = momSent + momNotifyOnly + momFailed;

  let forecastCommit = 0;
  let forecastBestCase = 0;
  let forecastPipeline = 0;
  let forecastOmitted = 0;
  let forecastFlagged = 0;
  for (const row of forecastRows) {
    const n = Number(row.count);
    if (row.flagged) forecastFlagged += n;
    if (row.category === "commit") forecastCommit += n;
    else if (row.category === "best_case") forecastBestCase += n;
    else if (row.category === "omitted") forecastOmitted += n;
    else forecastPipeline += n;
  }
  const forecastTotal =
    forecastCommit + forecastBestCase + forecastPipeline + forecastOmitted;

  let coachStrong = 0;
  let coachSolid = 0;
  let coachNeedsWork = 0;
  for (const row of salesCoachRows) {
    const n = Number(row.count);
    if (row.impression === "strong") coachStrong += n;
    else if (row.impression === "solid") coachSolid += n;
    else if (row.impression === "needs_work") coachNeedsWork += n;
  }
  const coachFailed = Number(salesCoachFailedRows[0]?.count ?? 0);
  const coachTotal = coachStrong + coachSolid + coachNeedsWork + coachFailed;

  const complianceOptOutApplied = Number(complianceOptOutRows[0]?.count ?? 0);
  const complianceRequestMap = new Map(
    complianceRequestRows.map((r) => [r.status, Number(r.count)]),
  );
  const compliancePendingReview = complianceRequestMap.get("pending_review") ?? 0;
  const complianceExecuted = complianceRequestMap.get("executed") ?? 0;
  const complianceDismissed = complianceRequestMap.get("dismissed") ?? 0;
  const complianceTotal =
    complianceOptOutApplied +
    compliancePendingReview +
    complianceExecuted +
    complianceDismissed;

  let escalationWatch = 0;
  let escalationEscalate = 0;
  let escalationUrgent = 0;
  for (const row of invoiceEscalationRows) {
    const n = Number(row.count);
    if (row.severity === "watch") escalationWatch += n;
    else if (row.severity === "escalate") escalationEscalate += n;
    else if (row.severity === "urgent") escalationUrgent += n;
  }
  const escalationTotal = escalationWatch + escalationEscalate + escalationUrgent;

  let collectionRiskWatch = 0;
  let collectionRiskRisk = 0;
  for (const row of collectionRiskRows) {
    const n = Number(row.count);
    if (row.level === "watch") collectionRiskWatch += n;
    else if (row.level === "risk") collectionRiskRisk += n;
  }
  const collectionRiskTotal = collectionRiskWatch + collectionRiskRisk;

  let dunningReminder = 0;
  let dunningWarning = 0;
  let dunningPauseNotice = 0;
  for (const row of dunningRows) {
    const n = Number(row.count);
    if (row.stage === "reminder") dunningReminder += n;
    else if (row.stage === "warning") dunningWarning += n;
    else if (row.stage === "pause_notice") dunningPauseNotice += n;
  }
  const dunningTotal = dunningReminder + dunningWarning + dunningPauseNotice;

  const hasRevenueForecast = revenueForecastRows.some((r) => r.has_forecast);

  let expansionWatch = 0;
  let expansionOpportunity = 0;
  for (const row of expansionMatcherRows) {
    const n = Number(row.count);
    if (row.signal === "watch") expansionWatch += n;
    else if (row.signal === "opportunity") expansionOpportunity += n;
  }
  const expansionTotal = expansionWatch + expansionOpportunity;

  let prospectReady = 0;
  let prospectImported = 0;
  let prospectFailed = 0;
  try {
    const prospectRows = await prisma.$queryRawUnsafe<
      Array<{ status: string; count: number | bigint }>
    >(
      `
      SELECT status::text AS status, COUNT(*)::int AS count
      FROM prospect_pull_jobs
      WHERE organization_id = $1::bigint
        AND created_at >= $2
        AND created_at <= $3
      GROUP BY status
      `,
      organizationId,
      since,
      until,
    );
    for (const row of prospectRows) {
      const n = Number(row.count);
      if (row.status === "ready_for_review") prospectReady += n;
      else if (row.status === "imported") prospectImported += n;
      else if (row.status === "failed") prospectFailed += n;
    }
  } catch {
    // Table may not exist until migration is applied.
  }
  const prospectTotal = prospectReady + prospectImported + prospectFailed;

  let corpusPendingReview = 0;
  let corpusFailed = 0;
  let corpusCompleted = 0;
  let playbooksApproved = 0;
  try {
    const corpusRows = await prisma.$queryRawUnsafe<
      Array<{ status: string; count: number | bigint }>
    >(
      `
      SELECT status::text AS status, COUNT(*)::int AS count
      FROM proposal_corpus_jobs
      WHERE organization_id = $1::bigint
        AND created_at >= $2
        AND created_at <= $3
      GROUP BY status
      `,
      organizationId,
      since,
      until,
    );
    for (const row of corpusRows) {
      const n = Number(row.count);
      if (row.status === "pending_review") corpusPendingReview += n;
      else if (row.status === "failed") corpusFailed += n;
      else if (row.status === "pending_review" || row.status === "synthesizing") {
        /* counted above */
      }
    }
    const playbookRows = await prisma.$queryRawUnsafe<
      Array<{ status: string; count: number | bigint }>
    >(
      `
      SELECT status::text AS status, COUNT(*)::int AS count
      FROM proposal_playbooks
      WHERE organization_id = $1::bigint
        AND created_at >= $2
        AND created_at <= $3
      GROUP BY status
      `,
      organizationId,
      since,
      until,
    );
    for (const row of playbookRows) {
      const n = Number(row.count);
      if (row.status === "approved") playbooksApproved += n;
      if (row.status === "pending_review") corpusPendingReview += n;
    }
    corpusCompleted = playbooksApproved;
  } catch {
    // Tables may not exist until migration is applied.
  }
  const corpusTotal =
    corpusPendingReview + corpusFailed + corpusCompleted + playbooksApproved;

  const agents: AgentMetricCard[] = [
    {
      id: "lead_enrichment",
      name: "Lead enrichment",
      description:
        "Fills firmographics (domain, industry, size), seniority & email domain type; 30-day domain cache; never overwrites user fields.",
      total: enrichTotal,
      breakdown: [
        { label: "Enriched", count: enriched },
        { label: "Skipped", count: skipped },
        { label: "Failed", count: failed },
        { label: "Pending now", count: pending },
        { label: "Running now", count: running },
      ],
    },
    {
      id: "lead_scoring",
      name: "Lead scoring",
      description:
        "Fit (0–50) + Intent (0–50). Total ≥40 → Assignment (Hot/Warm SLA); <40 → Nurture. Sequential after enrich.",
      total: scoringTotal,
      breakdown: [
        { label: "Scored", count: scoringScored },
        { label: "Grade A", count: scoringGradeA },
        { label: "Grade B", count: scoringGradeB },
        { label: "Offline fallback", count: scoringOffline },
        { label: "Failed", count: scoringFailed },
      ],
    },
    {
      id: "lead_summary",
      name: "Lead summary",
      description:
        "LLM narrative after score from enrichment + Fit/Intent facts only.",
      total: summaryTotal,
      breakdown: [
        { label: "AI-generated", count: summaryAi },
        { label: "Failed", count: summaryFailed },
      ],
    },
    {
      id: "lead_lifecycle",
      name: "Lead lifecycle",
      description:
        "Elevates lead status, lifecycle stage, and pipeline stage from CRM signals.",
      total: lifecycleTotal,
      breakdown: [
        { label: "Lead status", count: lifecycleLeadStatus },
        { label: "Converted", count: lifecycleConverted },
        { label: "Pipeline", count: lifecyclePipeline },
        { label: "Failed", count: lifecycleFailed },
      ],
    },
    {
      id: "sales_assignment",
      name: "Sales assignment",
      description:
        "Score-gated (≥40): Hot SLA 15m / Warm 2h. Territory + capacity; escalates when no eligible rep.",
      total: assignmentTotal,
      breakdown: [
        { label: "Region match", count: assignmentRegional },
        { label: "Load-balanced", count: assignmentBalanced },
      ],
    },
    {
      id: "email_auto_reply",
      name: "Email auto-reply",
      description:
        "Answers safe inbound email, books demos on the mailbox recipient's calendar, and escalates anything that needs a human.",
      total: autoReplyTotal,
      breakdown: [
        { label: "Replied", count: autoReplied },
        { label: "Demo pending", count: autoAwaitingDemo },
        { label: "Escalated", count: autoEscalated },
        { label: "Failed", count: autoFailed },
      ],
    },
    {
      id: "lead_nurture",
      name: "Lead nurture",
      description:
        "Activated when score <40. Sub-band intensity (20–39 active / 0–19 deep cold); exits to Assignment at 40.",
      total: nurtureTotal,
      breakdown: [
        { label: "Sent", count: nurtureSent },
        { label: "Failed", count: nurtureFailed },
      ],
    },
    {
      id: "meeting_brief",
      name: "Meeting brief",
      description:
        "When a meeting is booked, CRM-BOT emails the sales owner an AI 360 snapshot with recent contact activity.",
      total: briefTotal,
      breakdown: [
        { label: "Sent", count: briefSent },
        { label: "Failed", count: briefFailed },
      ],
    },
    {
      id: "meeting_reminder",
      name: "Meeting reminder",
      description:
        "Proactive T−24h and T−1h reminders: LangGraph LLM briefs the sales owner (importance-aware) and personalizes don’t-miss emails for every CRM participant.",
      total: reminderTotal,
      breakdown: [
        { label: "Owner briefs", count: reminderOwnerSent },
        { label: "Customer emails", count: reminderCustomerSent },
        { label: "24h window", count: reminder24h },
        { label: "1h window", count: reminder1h },
        { label: "Failed", count: reminderFailed },
      ],
    },
    {
      id: "post_meeting_process",
      name: "Post-meeting process",
      description:
        "LangGraph analyzes the transcript, creates linked proposal/quote drafts (never auto-emails the customer), notifies sales via CRM-BOT, auto-books follow-ups when free, and queues owner confirmations. Over-cap discounts go to Finance.",
      total: postTotal,
      breakdown: [
        { label: "Completed", count: postCompleted },
        { label: "Failed", count: postFailed },
        { label: "Pending now", count: postPendingNow },
      ],
    },
    {
      id: "meeting_miss_escalation",
      name: "Meeting miss escalation",
      description:
        "LangGraph analyzes lead importance, sales owner, deal, and capture evidence, then emails admins an intelligent miss escalation (no template).",
      total: missTotal,
      breakdown: [
        { label: "Sent", count: missSent },
        { label: "Notify-only", count: missNotifyOnly },
        { label: "Failed", count: missFailed },
      ],
    },
    {
      id: "meeting_mom",
      name: "Minutes of Meeting",
      description:
        "After a transcript is ready, CRM-BOT emails a customer-safe MOM to the contact and the detailed minutes to sales leadership.",
      total: momTotal,
      breakdown: [
        { label: "Sent", count: momSent },
        { label: "Notify-only", count: momNotifyOnly },
        { label: "Failed", count: momFailed },
      ],
    },
    {
      id: "pipeline_forecast",
      name: "Pipeline forecast auditor",
      description:
        "Judges whether each open deal's stage and expected close date are realistic given activity evidence. Never changes stage/close date — flags for the owner only.",
      total: forecastTotal,
      breakdown: [
        { label: "Commit", count: forecastCommit },
        { label: "Best case", count: forecastBestCase },
        { label: "Pipeline", count: forecastPipeline },
        { label: "Omitted", count: forecastOmitted },
        { label: "Flagged", count: forecastFlagged },
      ],
    },
    {
      id: "sales_coach",
      name: "Sales & pre-sales coach",
      description:
        "Reviews each call/meeting transcript and gives the rep private, evidence-based coaching (discovery, objections, methodology). Managers and admins get a performance summary (impression + growth areas); this card shows counts only, never coaching text.",
      total: coachTotal,
      breakdown: [
        { label: "Strong", count: coachStrong },
        { label: "Solid", count: coachSolid },
        { label: "Needs work", count: coachNeedsWork },
        { label: "Failed", count: coachFailed },
      ],
    },
    {
      id: "compliance_privacy",
      name: "Compliance & privacy control",
      description:
        "Classifies inbound GDPR/CCPA/privacy emails. Applies the reversible marketing opt-out automatically; data deletion/access always waits for an admin to confirm.",
      total: complianceTotal,
      breakdown: [
        { label: "Opt-outs applied", count: complianceOptOutApplied },
        { label: "Pending review", count: compliancePendingReview },
        { label: "Executed", count: complianceExecuted },
        { label: "Dismissed", count: complianceDismissed },
      ],
    },
    {
      id: "invoice_escalation",
      name: "Invoice escalation",
      description:
        "Judges the collections risk of overdue invoices and drafts an internal note plus a customer-safe reminder. Never marks paid/void or sends the reminder itself — always a human copy/send.",
      total: escalationTotal,
      breakdown: [
        { label: "Watch", count: escalationWatch },
        { label: "Escalate", count: escalationEscalate },
        { label: "Urgent", count: escalationUrgent },
        { label: "Total flagged", count: escalationTotal },
      ],
    },
    {
      id: "company_collection_risk",
      name: "Company collection risk",
      description:
        "Aggregates a customer company's whole invoice payment history into a risk band. Flag only — never blocks or pauses the account, that stays a Finance/Admin decision.",
      total: collectionRiskTotal,
      breakdown: [
        { label: "Watch", count: collectionRiskWatch },
        { label: "Risk", count: collectionRiskRisk },
        { label: "Total flagged", count: collectionRiskTotal },
      ],
    },
    {
      id: "invoice_dunning",
      name: "Invoice dunning",
      description:
        "Staged reminder -> warning -> service-pause-notice cadence for overdue invoices, drafting the next-stage message for a human to review and send. Never sends automatically.",
      total: dunningTotal,
      breakdown: [
        { label: "Reminder", count: dunningReminder },
        { label: "Warning", count: dunningWarning },
        { label: "Pause notice", count: dunningPauseNotice },
        { label: "Total advanced", count: dunningTotal },
      ],
    },
    {
      id: "revenue_gap_forecast",
      name: "Revenue gap forecast",
      description:
        "Collected revenue this period vs. optional target, plus ranked at-risk invoices. Read-only — feeds the Finance dashboard card, never modifies invoices or settings.",
      total: hasRevenueForecast ? 1 : 0,
      breakdown: [
        { label: "Forecast cached this window", count: hasRevenueForecast ? 1 : 0 },
      ],
    },
    {
      id: "expansion_matcher",
      name: "Expansion & revenue matcher",
      description:
        "Reviews each account's own closed-won deal history for a genuine upsell/cross-sell signal and drafts outreach talking points. Never creates a deal or contacts the account — always a human copy/send.",
      total: expansionTotal,
      breakdown: [
        { label: "Renewal watch", count: expansionWatch },
        { label: "Opportunity", count: expansionOpportunity },
        { label: "Total flagged", count: expansionTotal },
      ],
    },
    {
      id: "prospect_search",
      name: "Prospect search",
      description:
        "Chat-triggered multi-source search (Apollo, ZoomInfo, Lusha, BuiltWith). Fan-out + merge; no CRM writes until import.",
      total: prospectTotal,
      breakdown: [
        { label: "Ready for review", count: prospectReady },
        { label: "Imported", count: prospectImported },
        { label: "Failed", count: prospectFailed },
      ],
    },
    {
      id: "proposal_corpus",
      name: "Proposal pattern learning",
      description:
        "Ingests requirement↔proposal PDF pairs, synthesizes writing playbooks for HITL approval, then powers Generate from pattern on deals.",
      total: corpusTotal,
      breakdown: [
        { label: "Jobs pending review", count: corpusPendingReview },
        { label: "Approved playbooks", count: playbooksApproved },
        { label: "Failed jobs", count: corpusFailed },
      ],
    },
    {
      id: "prospect_qualify",
      name: "Prospect qualify",
      description:
        "LLM ranks searched candidates vs ICP, competitor stacks, and product fit before HITL import.",
      total: prospectTotal,
      breakdown: [
        { label: "Pulls in window", count: prospectTotal },
        { label: "Imported", count: prospectImported },
      ],
    },
    {
      id: "prospect_personnel",
      name: "Prospect personnel",
      description:
        "Fills missing contacts on shortlisted accounts via Lusha/Apollo person APIs.",
      total: prospectTotal,
      breakdown: [
        { label: "Pulls in window", count: prospectTotal },
        { label: "Imported", count: prospectImported },
      ],
    },
  ];

  return {
    organizationId,
    range,
    since: since.toISOString(),
    until: until.toISOString(),
    agents,
  };
}
