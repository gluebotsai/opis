import type { DbClient } from "../lib/rls.js";
import { serializeEntityId, serializeEntityIdOptional } from "../lib/id-schema.js";
import type { AgentAttentionClassification } from "./agent-attention-context.js";
import { emitMonitoringUpdated } from "./realtime.js";

export type NotReadyEscalationRecord = {
  id: string;
  agentId: string;
  setupUserId: string | null;
  agentName: string;
  escalatedAt: string;
  metadata?: unknown;
  insightSummary?: string | null;
  insightSuggestion?: string | null;
  insightClassification?: string | null;
};

export type RecordNotReadyEscalationResult = {
  record: NotReadyEscalationRecord;
  isNew: boolean;
};

type EscalationRow = {
  id: string | bigint;
  agent_id: string | bigint;
  setup_user_id: string | bigint | null;
  agent_name: string;
  escalated_at: Date;
  metadata: unknown;
};

function isMissingEscalationsTable(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const details = error as Error & { meta?: { code?: string; message?: string } };
  return (
    details.meta?.code === "42P01" ||
    /agent_not_ready_escalations.*does not exist/i.test(
      `${error.message} ${details.meta?.message ?? ""}`,
    )
  );
}

function insightPreviewFromMetadata(metadata: unknown): {
  summary: string | null;
  suggestion: string | null;
  classification: AgentAttentionClassification | null;
} {
  if (!metadata || typeof metadata !== "object") {
    return { summary: null, suggestion: null, classification: null };
  }
  const insight = (metadata as { insight?: unknown }).insight;
  if (!insight || typeof insight !== "object") {
    return { summary: null, suggestion: null, classification: null };
  }
  const row = insight as {
    summary?: unknown;
    suggestion?: unknown;
    classification?: unknown;
  };
  const summary = typeof row.summary === "string" ? row.summary : null;
  const suggestion = typeof row.suggestion === "string" ? row.suggestion : null;
  const classification =
    typeof row.classification === "string"
      ? (row.classification as AgentAttentionClassification)
      : null;
  return { summary, suggestion, classification };
}

function mapEscalationRow(row: EscalationRow): NotReadyEscalationRecord {
  const preview = insightPreviewFromMetadata(row.metadata);
  return {
    id: serializeEntityId(row.id),
    agentId: serializeEntityId(row.agent_id),
    setupUserId: serializeEntityIdOptional(row.setup_user_id),
    agentName: row.agent_name,
    escalatedAt: row.escalated_at.toISOString(),
    metadata: row.metadata,
    insightSummary: preview.summary,
    insightSuggestion: preview.suggestion,
    insightClassification: preview.classification,
  };
}

export async function recordAgentNotReadyEscalation(
  db: DbClient,
  organizationId: string,
  userId: string,
): Promise<RecordNotReadyEscalationResult> {
  const agentRows = await db.$queryRaw<
    Array<{ id: string | bigint; display_name: string; setup_user_id: string | bigint | null }>
  >`
    SELECT id, display_name, setup_user_id
    FROM ccass.agents
    WHERE organization_id = ${organizationId}::bigint
      AND setup_user_id = ${userId}::bigint
    LIMIT 1
  `;
  const agent = agentRows[0];
  if (!agent) {
    throw Object.assign(new Error("Agent profile not found"), { status: 404 });
  }

  const recentRows = await db.$queryRaw<{ id: string | bigint }[]>`
    SELECT id
    FROM ccass.agent_not_ready_escalations
    WHERE organization_id = ${organizationId}::bigint
      AND agent_id = ${agent.id}::bigint
      AND acknowledged_at IS NULL
      AND escalated_at >= NOW() - INTERVAL '24 hours'
    ORDER BY escalated_at DESC
    LIMIT 1
  `;
  if (recentRows[0]) {
    const rows = await db.$queryRaw<EscalationRow[]>`
      SELECT id, agent_id, setup_user_id, agent_name, escalated_at, metadata
      FROM ccass.agent_not_ready_escalations
      WHERE id = ${recentRows[0].id}::bigint
      LIMIT 1
    `;
    const row = rows[0]!;
    return {
      record: mapEscalationRow(row),
      isNew: false,
    };
  }

  const rows = await db.$queryRaw<EscalationRow[]>`
    INSERT INTO ccass.agent_not_ready_escalations (
      organization_id,
      agent_id,
      setup_user_id,
      agent_name,
      metadata
    )
    VALUES (
      ${organizationId}::bigint,
      ${agent.id}::bigint,
      ${userId}::bigint,
      ${agent.display_name},
      ${JSON.stringify({ source: "agent_not_ready_banner_escalation" })}::jsonb
    )
    RETURNING id, agent_id, setup_user_id, agent_name, escalated_at, metadata
  `;
  const row = rows[0]!;
  emitMonitoringUpdated(organizationId, "agent.not_ready_escalated");
  return {
    record: mapEscalationRow(row),
    isNew: true,
  };
}

export async function getNotReadyEscalationById(
  db: DbClient,
  organizationId: string,
  escalationId: string,
): Promise<NotReadyEscalationRecord | null> {
  try {
    const rows = await db.$queryRaw<EscalationRow[]>`
      SELECT id, agent_id, setup_user_id, agent_name, escalated_at, metadata
      FROM ccass.agent_not_ready_escalations
      WHERE organization_id = ${organizationId}::bigint
        AND id = ${escalationId}::bigint
      LIMIT 1
    `;
    const row = rows[0];
    return row ? mapEscalationRow(row) : null;
  } catch (error) {
    if (isMissingEscalationsTable(error)) return null;
    throw error;
  }
}

export async function updateNotReadyEscalationMetadata(
  db: DbClient,
  organizationId: string,
  escalationId: string,
  updater: (metadata: Record<string, unknown>) => Record<string, unknown>,
): Promise<void> {
  const existing = await getNotReadyEscalationById(db, organizationId, escalationId);
  if (!existing) return;
  const current =
    existing.metadata && typeof existing.metadata === "object"
      ? (existing.metadata as Record<string, unknown>)
      : {};
  const next = updater(current);
  await db.$executeRaw`
    UPDATE ccass.agent_not_ready_escalations
    SET metadata = ${JSON.stringify(next)}::jsonb
    WHERE organization_id = ${organizationId}::bigint
      AND id = ${escalationId}::bigint
  `;
}

export async function listRecentNotReadyEscalations(
  db: DbClient,
  organizationId: string,
  limit = 20,
): Promise<NotReadyEscalationRecord[]> {
  try {
    const rows = await db.$queryRaw<EscalationRow[]>`
      SELECT id, agent_id, setup_user_id, agent_name, escalated_at, metadata
      FROM ccass.agent_not_ready_escalations
      WHERE organization_id = ${organizationId}::bigint
        AND acknowledged_at IS NULL
        AND escalated_at >= NOW() - INTERVAL '24 hours'
      ORDER BY escalated_at DESC
      LIMIT ${limit}
    `;
    return rows.map(mapEscalationRow);
  } catch (error) {
    if (isMissingEscalationsTable(error)) return [];
    throw error;
  }
}

export async function acknowledgeNotReadyEscalation(
  db: DbClient,
  organizationId: string,
  escalationId: string,
): Promise<void> {
  await db.$executeRaw`
    UPDATE ccass.agent_not_ready_escalations
    SET acknowledged_at = COALESCE(acknowledged_at, NOW())
    WHERE organization_id = ${organizationId}::bigint
      AND id = ${escalationId}::bigint
  `;
}
