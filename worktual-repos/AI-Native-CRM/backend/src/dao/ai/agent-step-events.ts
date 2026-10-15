/**
 * Curated step-by-step trace for proactive agent runs (lead enrichment first).
 * Raw SQL so it works even when a long-lived process holds a PrismaClient
 * generated before AgentStepEvent existed — same convention as
 * lead-enrichment-store.ts / lead-summary-store.ts.
 *
 * One row per (jobId, step): "started" inserts, "ok"/"failed"/"skipped"
 * updates the same row in place. `detail` must stay small and curated —
 * never raw HTML/prompt/tool dumps.
 */

import { randomBytes } from "node:crypto";
import { getPrismaClient } from "@/dao/db/prisma";
import { publishAgentEvent } from "@/service/ai/agent-event-bus";

export type AgentStepStatus = "started" | "ok" | "failed" | "skipped";

export type AgentStepEventRow = {
  id: string;
  organizationId: string;
  agent: string;
  jobId: string;
  contactId: string | null;
  step: string;
  label: string;
  status: AgentStepStatus;
  detail: unknown;
  errorReason: string | null;
  startedAt: Date;
  endedAt: Date | null;
};

function cuidLike(): string {
  return `ase${randomBytes(12).toString("hex")}`;
}

function mapRow(r: Record<string, unknown>): AgentStepEventRow {
  return {
    id: String(r.id),
    organizationId: String(r.organization_id),
    agent: String(r.agent),
    jobId: String(r.job_id),
    contactId: r.contact_id == null ? null : String(r.contact_id),
    step: String(r.step),
    label: String(r.label),
    status: r.status as AgentStepStatus,
    detail: r.detail ?? null,
    errorReason: r.error_reason == null ? null : String(r.error_reason),
    startedAt: new Date(String(r.started_at)),
    endedAt: r.ended_at ? new Date(String(r.ended_at)) : null,
  };
}

/**
 * Upsert one step row. "started" (re)opens the row (ended_at cleared);
 * "ok" | "failed" | "skipped" closes it. Safe to call finish without a
 * prior start (creates the row directly in the finished state).
 */
export async function recordAgentStep(input: {
  organizationId: string;
  agent: string;
  jobId: string;
  contactId: string | null;
  step: string;
  label: string;
  status: AgentStepStatus;
  detail?: unknown;
  errorReason?: string | null;
}): Promise<AgentStepEventRow> {
  const prisma = getPrismaClient();
  const id = cuidLike();
  const detailJson =
    input.detail === undefined || input.detail === null
      ? null
      : JSON.stringify(input.detail);
  const rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
    `
    INSERT INTO agent_step_events (
      id, organization_id, agent, job_id, contact_id, step, label, status,
      detail, error_reason, started_at, ended_at
    ) VALUES (
      $1, $2::bigint, $3, $4, $5, $6, $7, $8::"AgentStepStatus",
      $9::jsonb, $10, NOW(),
      CASE WHEN $8 = 'started' THEN NULL ELSE NOW() END
    )
    ON CONFLICT (job_id, step) DO UPDATE SET
      label = EXCLUDED.label,
      status = EXCLUDED.status,
      detail = COALESCE(EXCLUDED.detail, agent_step_events.detail),
      error_reason = EXCLUDED.error_reason,
      ended_at = CASE WHEN EXCLUDED.status = 'started' THEN NULL ELSE NOW() END
    RETURNING *
    `,
    id,
    input.organizationId,
    input.agent,
    input.jobId,
    input.contactId,
    input.step,
    input.label,
    input.status,
    detailJson,
    input.errorReason ?? null,
  );
  const row = mapRow(rows[0]!);
  const detail =
    row.detail && typeof row.detail === "object"
      ? (row.detail as Record<string, unknown>)
      : {};
  void publishAgentEvent({
    organizationId: row.organizationId,
    runId: row.jobId,
    traceId:
      typeof detail.traceId === "string" ? detail.traceId : `job-${row.jobId}`,
    type: "step",
    data: {
      id: row.id,
      agent: row.agent,
      step: row.step,
      label: row.label,
      status: row.status,
      detail: row.detail,
      errorReason: row.errorReason,
      startedAt: row.startedAt.toISOString(),
      endedAt: row.endedAt?.toISOString() ?? null,
    },
  });
  return row;
}

/**
 * Persist the first "load context" step when Fastify skips/fails a job
 * before the Python graph runs (e.g. contact_not_found). Never throws —
 * a missing step table must not fail the job itself.
 */
export async function recordLoadContextStep(input: {
  organizationId: string;
  agent: string;
  jobId: string;
  contactId: string | null;
  status: "skipped" | "failed" | "ok";
  label: string;
  errorReason?: string | null;
}): Promise<void> {
  try {
    await recordAgentStep({
      organizationId: input.organizationId,
      agent: input.agent,
      jobId: input.jobId,
      contactId: input.contactId,
      step: "load_context",
      label: input.label,
      status: input.status,
      errorReason: input.errorReason ?? null,
    });
  } catch (err) {
    console.error("recordLoadContextStep failed", input.agent, input.jobId, err);
  }
}

export async function listStepsForJob(
  jobId: string,
): Promise<AgentStepEventRow[]> {
  const prisma = getPrismaClient();
  const rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
    `
    SELECT * FROM agent_step_events
    WHERE job_id = $1
    ORDER BY started_at ASC
    `,
    jobId,
  );
  return rows.map(mapRow);
}

export async function listStepsForContact(
  organizationId: string,
  contactId: string,
  agent: string,
  limit = 50,
): Promise<AgentStepEventRow[]> {
  const prisma = getPrismaClient();
  const rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
    `
    SELECT * FROM agent_step_events
    WHERE organization_id = $1::bigint AND contact_id = $2::text AND agent = $3
    ORDER BY started_at DESC
    LIMIT $4
    `,
    organizationId,
    contactId,
    agent,
    Math.min(200, Math.max(1, limit)),
  );
  return rows.map(mapRow);
}

/**
 * "Recent runs" row for agents with no persisted job table (lead_summary,
 * sales_assignment, meeting_brief/reminder, meeting_miss_escalation,
 * meeting_mom, post_meeting_process). One `job_id` = one run: it is an
 * ephemeral id the Python agent generates at the start of `run()` and reuses
 * for every step it posts. Shape mirrors `AgentRunJobRow` in
 * agents-commands.ts so both "kinds" of run source can share the same
 * summary/detail rendering.
 */
export type AgentEventRunRow = {
  id: string;
  organizationId: string;
  contactId: string | null;
  /** From step `detail` JSON — set by deal/company/invoice agents. */
  companyId: string | null;
  dealId: string | null;
  invoiceId: string | null;
  status: "running" | "failed" | "skipped" | "ok";
  attempts: number;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
};

function mapEventRunRow(r: Record<string, unknown>): AgentEventRunRow {
  const status = String(r.derived_status) as AgentEventRunRow["status"];
  const completedAt = status === "running" ? null : new Date(String(r.updated_at));
  return {
    id: String(r.job_id),
    organizationId: String(r.organization_id),
    contactId: r.contact_id == null ? null : String(r.contact_id),
    companyId: r.company_id == null ? null : String(r.company_id),
    dealId: r.deal_id == null ? null : String(r.deal_id),
    invoiceId: r.invoice_id == null ? null : String(r.invoice_id),
    status,
    attempts: 1,
    lastError: r.last_error == null ? null : String(r.last_error),
    createdAt: new Date(String(r.created_at)),
    updatedAt: new Date(String(r.updated_at)),
    completedAt,
  };
}

/**
 * `failed` beats `skipped` beats `running` (an open "started" step) beats
 * `ok`. `last_error` is the `error_reason` of the row that drove that
 * status, so the UI can show *why* a run failed/was skipped.
 */
const RUN_STATUS_CTE = `
  runs AS (
    SELECT
      job_id,
      MAX(organization_id) AS organization_id,
      MAX(contact_id) AS contact_id,
      (ARRAY_AGG(detail->>'companyId' ORDER BY started_at DESC)
        FILTER (WHERE detail->>'companyId' IS NOT NULL AND detail->>'companyId' <> ''))[1] AS company_id,
      (ARRAY_AGG(detail->>'dealId' ORDER BY started_at DESC)
        FILTER (WHERE detail->>'dealId' IS NOT NULL AND detail->>'dealId' <> ''))[1] AS deal_id,
      (ARRAY_AGG(detail->>'invoiceId' ORDER BY started_at DESC)
        FILTER (WHERE detail->>'invoiceId' IS NOT NULL AND detail->>'invoiceId' <> ''))[1] AS invoice_id,
      MIN(started_at) AS created_at,
      MAX(COALESCE(ended_at, started_at)) AS updated_at,
      BOOL_OR(status = 'failed') AS has_failed,
      BOOL_OR(status = 'skipped') AS has_skipped,
      BOOL_OR(status = 'started') AS has_open,
      (ARRAY_AGG(error_reason ORDER BY
        CASE status WHEN 'failed' THEN 0 WHEN 'skipped' THEN 1 ELSE 2 END,
        started_at DESC
      ) FILTER (WHERE error_reason IS NOT NULL))[1] AS last_error
    FROM agent_step_events
    WHERE organization_id = $1::bigint AND agent = $2
    GROUP BY job_id
  ),
  classified AS (
    SELECT
      job_id, organization_id, contact_id, company_id, deal_id, invoice_id,
      created_at, updated_at, last_error,
      CASE
        WHEN has_failed THEN 'failed'
        WHEN has_skipped THEN 'skipped'
        WHEN has_open THEN 'running'
        ELSE 'ok'
      END AS derived_status
    FROM runs
  )
`;

export async function listRunsForAgentPage(
  organizationId: string,
  agent: string,
  opts: {
    limit?: number;
    offset?: number;
    status: string | null;
    since: Date;
    until: Date;
  },
): Promise<{ rows: AgentEventRunRow[]; total: number }> {
  const prisma = getPrismaClient();
  const limit = Math.min(100, Math.max(1, opts.limit ?? 25));
  const offset = Math.max(0, opts.offset ?? 0);
  const rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
    `
    WITH ${RUN_STATUS_CTE}
    SELECT *, COUNT(*) OVER() AS total_count
    FROM classified
    WHERE ($3::text IS NULL OR derived_status = $3)
      AND updated_at >= $6
      AND updated_at <= $7
    ORDER BY created_at DESC
    LIMIT $4 OFFSET $5
    `,
    organizationId,
    agent,
    opts.status,
    limit,
    offset,
    opts.since,
    opts.until,
  );
  const total = rows.length > 0 ? Number(rows[0]!.total_count) : 0;
  return { rows: rows.map(mapEventRunRow), total };
}

export async function findRunByJobIdFromEvents(
  organizationId: string,
  agent: string,
  jobId: string,
): Promise<AgentEventRunRow | null> {
  const prisma = getPrismaClient();
  const rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
    `
    WITH ${RUN_STATUS_CTE}
    SELECT * FROM classified WHERE job_id = $3
    `,
    organizationId,
    agent,
    jobId,
  );
  return rows[0] ? mapEventRunRow(rows[0]) : null;
}
