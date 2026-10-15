import type { DbClient } from "../lib/rls.js";
import { serializeEntityIdOptional } from "../lib/id-schema.js";
import type {
  DiagnosticBaselineFacts,
  DiagnosticIncidentFacts,
  IncidentSeverity,
  IncidentStatus,
} from "./dashboard-analytics-types.js";

type IncidentRow = {
  id: string;
  fingerprint: string;
  incident_type: string;
  status: IncidentStatus;
  severity: IncidentSeverity;
  version: number;
  scope_json: Record<string, unknown>;
  current_facts_json: DiagnosticIncidentFacts;
  baseline_facts_json: DiagnosticBaselineFacts;
  headline: string;
  summary: string;
  source: string;
  schema_version: number;
  prompt_version: string | null;
  model_name: string | null;
  input_hash: string | null;
  first_detected_at: Date;
  last_detected_at: Date;
  resolved_at: Date | null;
};

type ForecastRunRow = {
  id: string;
  forecast_date: Date;
  history_days: number;
  horizon_hours: number;
  method: string;
  status: string;
  input_hash: string;
  baseline_json: Record<string, unknown>;
  llm_adjustment_json: Record<string, unknown> | null;
  forecast_json: Record<string, unknown>;
  summary_json: Record<string, unknown>;
  schema_version: number;
  prompt_version: string | null;
  model_name: string | null;
  validation_status: string;
  generated_at: Date;
};

type WorkforcePlanRow = {
  id: string;
  forecast_run_id: string | null;
  plan_date: Date;
  input_signature: string;
  plan_fingerprint: string;
  decision: "update" | "no_change";
  status: string;
  previous_plan_id: string | null;
  plan_json: Record<string, unknown>;
  source: string;
  schema_version: number;
  prompt_version: string | null;
  model_name: string | null;
  created_at: Date;
};

export type StoredIncident = {
  id: string;
  fingerprint: string;
  incidentType: string;
  status: IncidentStatus;
  severity: IncidentSeverity;
  version: number;
  scope: Record<string, unknown>;
  currentFacts: DiagnosticIncidentFacts;
  baselineFacts: DiagnosticBaselineFacts;
  headline: string;
  summary: string;
  source: string;
  schemaVersion: number;
  promptVersion: string | null;
  modelName: string | null;
  inputHash: string | null;
  firstDetectedAt: string;
  lastDetectedAt: string;
  resolvedAt: string | null;
};

export type StoredForecastRun = {
  id: string;
  forecastDate: string;
  historyDays: number;
  horizonHours: number;
  method: string;
  status: string;
  inputHash: string;
  baselineJson: Record<string, unknown>;
  llmAdjustmentJson: Record<string, unknown> | null;
  forecastJson: Record<string, unknown>;
  summaryJson: Record<string, unknown>;
  schemaVersion: number;
  promptVersion: string | null;
  modelName: string | null;
  validationStatus: string;
  generatedAt: string;
};

export type StoredWorkforcePlan = {
  id: string;
  forecastRunId: string | null;
  planDate: string;
  inputSignature: string;
  planFingerprint: string;
  decision: "update" | "no_change";
  status: string;
  previousPlanId: string | null;
  planJson: Record<string, unknown>;
  source: string;
  schemaVersion: number;
  promptVersion: string | null;
  modelName: string | null;
  createdAt: string;
};

function mapIncident(row: IncidentRow): StoredIncident {
  return {
    id: serializeEntityIdOptional(row.id)!,
    fingerprint: row.fingerprint,
    incidentType: row.incident_type,
    status: row.status,
    severity: row.severity,
    version: row.version,
    scope: row.scope_json ?? {},
    currentFacts: row.current_facts_json,
    baselineFacts: row.baseline_facts_json,
    headline: row.headline,
    summary: row.summary,
    source: row.source,
    schemaVersion: row.schema_version,
    promptVersion: row.prompt_version,
    modelName: row.model_name,
    inputHash: row.input_hash,
    firstDetectedAt: row.first_detected_at.toISOString(),
    lastDetectedAt: row.last_detected_at.toISOString(),
    resolvedAt: row.resolved_at?.toISOString() ?? null,
  };
}

function mapForecastRun(row: ForecastRunRow): StoredForecastRun {
  return {
    id: serializeEntityIdOptional(row.id)!,
    forecastDate: row.forecast_date.toISOString().slice(0, 10),
    historyDays: row.history_days,
    horizonHours: row.horizon_hours,
    method: row.method,
    status: row.status,
    inputHash: row.input_hash,
    baselineJson: row.baseline_json ?? {},
    llmAdjustmentJson: row.llm_adjustment_json,
    forecastJson: row.forecast_json ?? {},
    summaryJson: row.summary_json ?? {},
    schemaVersion: row.schema_version,
    promptVersion: row.prompt_version,
    modelName: row.model_name,
    validationStatus: row.validation_status,
    generatedAt: row.generated_at.toISOString(),
  };
}

function mapWorkforcePlan(row: WorkforcePlanRow): StoredWorkforcePlan {
  return {
    id: serializeEntityIdOptional(row.id)!,
    forecastRunId: serializeEntityIdOptional(row.forecast_run_id),
    planDate: row.plan_date.toISOString().slice(0, 10),
    inputSignature: row.input_signature,
    planFingerprint: row.plan_fingerprint,
    decision: row.decision,
    status: row.status,
    previousPlanId: serializeEntityIdOptional(row.previous_plan_id),
    planJson: row.plan_json ?? {},
    source: row.source,
    schemaVersion: row.schema_version,
    promptVersion: row.prompt_version,
    modelName: row.model_name,
    createdAt: row.created_at.toISOString(),
  };
}

function incidentFromJson(row: Record<string, unknown>): StoredIncident {
  return mapIncident({
    ...(row as unknown as IncidentRow),
    first_detected_at: new Date(String(row.first_detected_at)),
    last_detected_at: new Date(String(row.last_detected_at)),
    resolved_at: row.resolved_at ? new Date(String(row.resolved_at)) : null,
  });
}

function forecastRunFromJson(row: Record<string, unknown>): StoredForecastRun {
  return mapForecastRun({
    ...(row as unknown as ForecastRunRow),
    forecast_date: new Date(`${String(row.forecast_date)}T00:00:00.000Z`),
    generated_at: new Date(String(row.generated_at)),
  });
}

function workforcePlanFromJson(row: Record<string, unknown>): StoredWorkforcePlan {
  return mapWorkforcePlan({
    ...(row as unknown as WorkforcePlanRow),
    plan_date: new Date(`${String(row.plan_date)}T00:00:00.000Z`),
    created_at: new Date(String(row.created_at)),
  });
}

export async function getDashboardAnalyticsSnapshot(
  db: DbClient,
  organizationId: string,
): Promise<{
  incidents: StoredIncident[];
  forecastRun: StoredForecastRun | null;
  workforcePlan: StoredWorkforcePlan | null;
}> {
  const rows = await db.$queryRawUnsafe<
    Array<{
      incidents: Array<Record<string, unknown>>;
      forecast_run: Record<string, unknown> | null;
      workforce_plan: Record<string, unknown> | null;
    }>
  >(
    `
    SELECT
      COALESCE(
        (
          SELECT jsonb_agg(to_jsonb(incident_row))
          FROM (
            SELECT *
            FROM ccass.dashboard_analytics_incidents
            WHERE organization_id = $1::bigint
              AND status IN ('candidate', 'active', 'cooling')
            ORDER BY
              CASE severity
                WHEN 'critical' THEN 4
                WHEN 'high' THEN 3
                WHEN 'medium' THEN 2
                ELSE 1
              END DESC,
              last_detected_at DESC
          ) incident_row
        ),
        '[]'::jsonb
      ) AS incidents,
      (
        SELECT to_jsonb(forecast_row)
        FROM (
          SELECT *
          FROM ccass.dashboard_analytics_forecast_runs
          WHERE organization_id = $1::bigint
          ORDER BY forecast_date DESC, generated_at DESC
          LIMIT 1
        ) forecast_row
      ) AS forecast_run,
      (
        SELECT to_jsonb(plan_row)
        FROM (
          SELECT *
          FROM ccass.dashboard_analytics_workforce_plans
          WHERE organization_id = $1::bigint
          ORDER BY plan_date DESC, created_at DESC
          LIMIT 1
        ) plan_row
      ) AS workforce_plan
    `,
    organizationId,
  );
  const snapshot = rows[0];
  return {
    incidents: (snapshot?.incidents ?? []).map(incidentFromJson),
    forecastRun: snapshot?.forecast_run
      ? forecastRunFromJson(snapshot.forecast_run)
      : null,
    workforcePlan: snapshot?.workforce_plan
      ? workforcePlanFromJson(snapshot.workforce_plan)
      : null,
  };
}

export async function listActiveIncidents(
  db: DbClient,
  organizationId: string,
): Promise<StoredIncident[]> {
  const rows = await db.$queryRawUnsafe<IncidentRow[]>(
    `
    SELECT *
    FROM ccass.dashboard_analytics_incidents
    WHERE organization_id = $1::bigint
      AND status IN ('candidate', 'active', 'cooling')
    ORDER BY
      CASE severity
        WHEN 'critical' THEN 4
        WHEN 'high' THEN 3
        WHEN 'medium' THEN 2
        ELSE 1
      END DESC,
      last_detected_at DESC
    `,
    organizationId,
  );
  return rows.map(mapIncident);
}

export async function getIncidentByFingerprint(
  db: DbClient,
  organizationId: string,
  fingerprint: string,
): Promise<StoredIncident | null> {
  const rows = await db.$queryRawUnsafe<IncidentRow[]>(
    `
    SELECT *
    FROM ccass.dashboard_analytics_incidents
    WHERE organization_id = $1::bigint
      AND fingerprint = $2
    LIMIT 1
    `,
    organizationId,
    fingerprint,
  );
  return rows[0] ? mapIncident(rows[0]) : null;
}

export async function upsertIncident(
  db: DbClient,
  organizationId: string,
  input: {
    fingerprint: string;
    incidentType: string;
    status: IncidentStatus;
    severity: IncidentSeverity;
    version: number;
    scope: Record<string, unknown>;
    currentFacts: DiagnosticIncidentFacts;
    baselineFacts: DiagnosticBaselineFacts;
    headline: string;
    summary: string;
    source: string;
    schemaVersion: number;
    promptVersion?: string | null;
    modelName?: string | null;
    inputHash?: string | null;
    resolvedAt?: string | null;
  },
): Promise<StoredIncident> {
  const rows = await db.$queryRawUnsafe<IncidentRow[]>(
    `
    INSERT INTO ccass.dashboard_analytics_incidents (
      organization_id,
      fingerprint,
      incident_type,
      status,
      severity,
      version,
      scope_json,
      current_facts_json,
      baseline_facts_json,
      headline,
      summary,
      source,
      schema_version,
      prompt_version,
      model_name,
      input_hash,
      first_detected_at,
      last_detected_at,
      resolved_at,
      updated_at
    )
    VALUES (
      $1::bigint,
      $2,
      $3,
      $4,
      $5,
      $6,
      $7::jsonb,
      $8::jsonb,
      $9::jsonb,
      $10,
      $11,
      $12,
      $13,
      $14,
      $15,
      $16,
      NOW(),
      NOW(),
      $17::timestamptz,
      NOW()
    )
    ON CONFLICT (organization_id, fingerprint)
    DO UPDATE SET
      incident_type = EXCLUDED.incident_type,
      status = EXCLUDED.status,
      severity = EXCLUDED.severity,
      version = EXCLUDED.version,
      scope_json = EXCLUDED.scope_json,
      current_facts_json = EXCLUDED.current_facts_json,
      baseline_facts_json = EXCLUDED.baseline_facts_json,
      headline = EXCLUDED.headline,
      summary = EXCLUDED.summary,
      source = EXCLUDED.source,
      schema_version = EXCLUDED.schema_version,
      prompt_version = EXCLUDED.prompt_version,
      model_name = EXCLUDED.model_name,
      input_hash = EXCLUDED.input_hash,
      last_detected_at = NOW(),
      resolved_at = EXCLUDED.resolved_at,
      updated_at = NOW()
    RETURNING *
    `,
    organizationId,
    input.fingerprint,
    input.incidentType,
    input.status,
    input.severity,
    input.version,
    JSON.stringify(input.scope),
    JSON.stringify(input.currentFacts),
    JSON.stringify(input.baselineFacts),
    input.headline,
    input.summary,
    input.source,
    input.schemaVersion,
    input.promptVersion ?? null,
    input.modelName ?? null,
    input.inputHash ?? null,
    input.resolvedAt ?? null,
  );
  return mapIncident(rows[0]!);
}

export async function listRecentForecastRuns(
  db: DbClient,
  organizationId: string,
  sinceDate: string,
): Promise<StoredForecastRun[]> {
  const rows = await db.$queryRawUnsafe<ForecastRunRow[]>(
    `
    SELECT DISTINCT ON (forecast_date) *
    FROM ccass.dashboard_analytics_forecast_runs
    WHERE organization_id = $1::bigint
      AND forecast_date >= $2::date
    ORDER BY forecast_date DESC, generated_at DESC
    `,
    organizationId,
    sinceDate,
  );
  return rows.map(mapForecastRun).reverse();
}

export async function getLatestForecastRun(
  db: DbClient,
  organizationId: string,
  forecastDate?: string,
): Promise<StoredForecastRun | null> {
  const rows = forecastDate
    ? await db.$queryRawUnsafe<ForecastRunRow[]>(
        `
        SELECT *
        FROM ccass.dashboard_analytics_forecast_runs
        WHERE organization_id = $1::bigint
          AND forecast_date = $2::date
        ORDER BY generated_at DESC
        LIMIT 1
        `,
        organizationId,
        forecastDate,
      )
    : await db.$queryRawUnsafe<ForecastRunRow[]>(
        `
        SELECT *
        FROM ccass.dashboard_analytics_forecast_runs
        WHERE organization_id = $1::bigint
        ORDER BY forecast_date DESC, generated_at DESC
        LIMIT 1
        `,
        organizationId,
      );
  return rows[0] ? mapForecastRun(rows[0]) : null;
}

export async function saveForecastRun(
  db: DbClient,
  organizationId: string,
  input: {
    forecastDate: string;
    historyDays: number;
    horizonHours: number;
    method: string;
    status: string;
    inputHash: string;
    baselineJson: Record<string, unknown>;
    llmAdjustmentJson?: Record<string, unknown> | null;
    forecastJson: Record<string, unknown>;
    summaryJson: Record<string, unknown>;
    schemaVersion: number;
    promptVersion?: string | null;
    modelName?: string | null;
    validationStatus: string;
    generatedAt: string;
  },
): Promise<StoredForecastRun> {
  const rows = await db.$queryRawUnsafe<ForecastRunRow[]>(
    `
    INSERT INTO ccass.dashboard_analytics_forecast_runs (
      organization_id,
      forecast_date,
      history_days,
      horizon_hours,
      method,
      status,
      input_hash,
      baseline_json,
      llm_adjustment_json,
      forecast_json,
      summary_json,
      schema_version,
      prompt_version,
      model_name,
      validation_status,
      generated_at,
      updated_at
    )
    VALUES (
      $1::bigint,
      $2::date,
      $3,
      $4,
      $5,
      $6,
      $7,
      $8::jsonb,
      $9::jsonb,
      $10::jsonb,
      $11::jsonb,
      $12,
      $13,
      $14,
      $15,
      $16::timestamptz,
      NOW()
    )
    ON CONFLICT (organization_id, forecast_date, input_hash)
    DO UPDATE SET
      baseline_json = EXCLUDED.baseline_json,
      llm_adjustment_json = EXCLUDED.llm_adjustment_json,
      forecast_json = EXCLUDED.forecast_json,
      summary_json = EXCLUDED.summary_json,
      validation_status = EXCLUDED.validation_status,
      generated_at = EXCLUDED.generated_at,
      updated_at = NOW()
    RETURNING *
    `,
    organizationId,
    input.forecastDate,
    input.historyDays,
    input.horizonHours,
    input.method,
    input.status,
    input.inputHash,
    JSON.stringify(input.baselineJson),
    input.llmAdjustmentJson ? JSON.stringify(input.llmAdjustmentJson) : null,
    JSON.stringify(input.forecastJson),
    JSON.stringify(input.summaryJson),
    input.schemaVersion,
    input.promptVersion ?? null,
    input.modelName ?? null,
    input.validationStatus,
    input.generatedAt,
  );
  return mapForecastRun(rows[0]!);
}

export async function getLatestWorkforcePlan(
  db: DbClient,
  organizationId: string,
  planDate?: string,
): Promise<StoredWorkforcePlan | null> {
  const rows = planDate
    ? await db.$queryRawUnsafe<WorkforcePlanRow[]>(
        `
        SELECT *
        FROM ccass.dashboard_analytics_workforce_plans
        WHERE organization_id = $1::bigint
          AND plan_date = $2::date
        ORDER BY created_at DESC
        LIMIT 1
        `,
        organizationId,
        planDate,
      )
    : await db.$queryRawUnsafe<WorkforcePlanRow[]>(
        `
        SELECT *
        FROM ccass.dashboard_analytics_workforce_plans
        WHERE organization_id = $1::bigint
        ORDER BY plan_date DESC, created_at DESC
        LIMIT 1
        `,
        organizationId,
      );
  return rows[0] ? mapWorkforcePlan(rows[0]) : null;
}

export async function saveWorkforcePlan(
  db: DbClient,
  organizationId: string,
  input: {
    forecastRunId?: string | null;
    planDate: string;
    inputSignature: string;
    planFingerprint: string;
    decision: "update" | "no_change";
    status: string;
    previousPlanId?: string | null;
    planJson: Record<string, unknown>;
    source: string;
    schemaVersion: number;
    promptVersion?: string | null;
    modelName?: string | null;
  },
): Promise<StoredWorkforcePlan> {
  const rows = await db.$queryRawUnsafe<WorkforcePlanRow[]>(
    `
    INSERT INTO ccass.dashboard_analytics_workforce_plans (
      organization_id,
      forecast_run_id,
      plan_date,
      input_signature,
      plan_fingerprint,
      decision,
      status,
      previous_plan_id,
      plan_json,
      source,
      schema_version,
      prompt_version,
      model_name,
      updated_at
    )
    VALUES (
      $1::bigint,
      $2::bigint,
      $3::date,
      $4,
      $5,
      $6,
      $7,
      $8::bigint,
      $9::jsonb,
      $10,
      $11,
      $12,
      $13,
      NOW()
    )
    ON CONFLICT (organization_id, plan_date, input_signature)
    DO UPDATE SET
      forecast_run_id = EXCLUDED.forecast_run_id,
      plan_fingerprint = EXCLUDED.plan_fingerprint,
      decision = EXCLUDED.decision,
      status = EXCLUDED.status,
      previous_plan_id = EXCLUDED.previous_plan_id,
      plan_json = EXCLUDED.plan_json,
      source = EXCLUDED.source,
      schema_version = EXCLUDED.schema_version,
      prompt_version = EXCLUDED.prompt_version,
      model_name = EXCLUDED.model_name,
      updated_at = NOW()
    RETURNING *
    `,
    organizationId,
    input.forecastRunId ?? null,
    input.planDate,
    input.inputSignature,
    input.planFingerprint,
    input.decision,
    input.status,
    input.previousPlanId ?? null,
    JSON.stringify(input.planJson),
    input.source,
    input.schemaVersion,
    input.promptVersion ?? null,
    input.modelName ?? null,
  );
  return mapWorkforcePlan(rows[0]!);
}
