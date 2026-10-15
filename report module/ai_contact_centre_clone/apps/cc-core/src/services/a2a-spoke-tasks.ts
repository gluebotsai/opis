import { randomUUID } from "node:crypto";
import { z } from "zod";

import type { DbClient } from "../lib/rls.js";

const TASK_STATES = [
  "SUBMITTED",
  "WORKING",
  "INPUT_REQUIRED",
  "AUTH_REQUIRED",
  "COMPLETED",
  "FAILED",
  "CANCELED",
  "REJECTED",
] as const;

export type A2ATaskState = (typeof TASK_STATES)[number];

export const createA2ATaskSchema = z.object({
  organizationId: z.union([z.string(), z.number()]).transform(String),
  callerSubject: z.string().min(1).max(256),
  commandId: z.string().min(8).max(128),
  skillId: z.string().min(3).max(128),
  requestHash: z.string().min(16).max(128),
  requestEnvelope: z.record(z.string(), z.unknown()).default({}),
  contextId: z.string().min(1).max(128).optional().nullable(),
});

export const updateA2ATaskSchema = z.object({
  state: z.enum(TASK_STATES).optional(),
  resultArtifact: z.record(z.string(), z.unknown()).optional().nullable(),
  error: z.record(z.string(), z.unknown()).optional().nullable(),
  eventType: z.string().min(1).max(64).optional(),
  eventPayload: z.record(z.string(), z.unknown()).optional(),
});

type Db = DbClient;

function orgIdBigInt(organizationId: string): bigint {
  return BigInt(organizationId);
}

async function loadTaskRow(db: Db, organizationId: string, publicId: string) {
  const rows = await db.$queryRawUnsafe<
    Array<{
      id: bigint;
      public_id: string;
      organization_id: bigint;
      caller_subject: string;
      command_id: string;
      skill_id: string;
      request_hash: string;
      request_envelope: unknown;
      context_id: string | null;
      state: string;
      result_artifact: unknown;
      error: unknown;
      created_at: Date;
      updated_at: Date;
      completed_at: Date | null;
    }>
  >(
    `SELECT id, public_id, organization_id, caller_subject, command_id, skill_id,
            request_hash, request_envelope, context_id, state, result_artifact, error,
            created_at, updated_at, completed_at
     FROM ccass.a2a_tasks
     WHERE organization_id = $1 AND public_id = $2
     LIMIT 1`,
    orgIdBigInt(organizationId),
    publicId,
  );
  return rows[0] ?? null;
}

async function loadEvents(db: Db, taskPk: bigint) {
  return db.$queryRawUnsafe<
    Array<{ id: bigint; event_type: string; payload: unknown; created_at: Date }>
  >(
    `SELECT id, event_type, payload, created_at
     FROM ccass.a2a_task_events
     WHERE task_id = $1
     ORDER BY id ASC`,
    taskPk,
  );
}

async function loadArtifacts(db: Db, taskPk: bigint) {
  return db.$queryRawUnsafe<
    Array<{
      id: bigint;
      artifact_name: string;
      mime_type: string;
      payload: unknown;
      created_at: Date;
    }>
  >(
    `SELECT id, artifact_name, mime_type, payload, created_at
     FROM ccass.a2a_artifacts
     WHERE task_id = $1
     ORDER BY id ASC`,
    taskPk,
  );
}

function serializeTask(
  row: NonNullable<Awaited<ReturnType<typeof loadTaskRow>>>,
  events: Awaited<ReturnType<typeof loadEvents>>,
  artifacts: Awaited<ReturnType<typeof loadArtifacts>>,
  extra?: { idempotentReplay?: boolean },
) {
  return {
    id: row.public_id,
    organizationId: String(row.organization_id),
    callerSubject: row.caller_subject,
    commandId: row.command_id,
    skillId: row.skill_id,
    requestHash: row.request_hash,
    requestEnvelope: row.request_envelope,
    contextId: row.context_id,
    state: row.state,
    resultArtifact: row.result_artifact,
    error: row.error,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    completedAt: row.completed_at?.toISOString() ?? null,
    events: events.map((event) => ({
      id: String(event.id),
      type: event.event_type,
      payload: event.payload,
      createdAt: event.created_at.toISOString(),
    })),
    artifacts: artifacts.map((artifact) => ({
      artifactId: String(artifact.id),
      name: artifact.artifact_name,
      parts: [
        {
          kind: "data",
          mimeType: artifact.mime_type,
          data: artifact.payload,
        },
      ],
      createdAt: artifact.created_at.toISOString(),
    })),
    idempotentReplay: Boolean(extra?.idempotentReplay),
  };
}

export async function createOrGetA2ATask(
  db: Db,
  input: z.infer<typeof createA2ATaskSchema>,
) {
  const organizationId = input.organizationId;
  const existing = await db.$queryRawUnsafe<
    Array<{ public_id: string; request_hash: string }>
  >(
    `SELECT public_id, request_hash
     FROM ccass.a2a_tasks
     WHERE caller_subject = $1 AND organization_id = $2 AND command_id = $3
     LIMIT 1`,
    input.callerSubject,
    orgIdBigInt(organizationId),
    input.commandId,
  );

  if (existing[0]) {
    if (existing[0].request_hash !== input.requestHash) {
      const error = Object.assign(
        new Error("commandId reused with a different payload"),
        { status: 409, existingTaskId: existing[0].public_id },
      );
      throw error;
    }
    const row = await loadTaskRow(db, organizationId, existing[0].public_id);
    if (!row) {
      throw Object.assign(new Error("Task not found"), { status: 404 });
    }
    const [events, artifacts] = await Promise.all([
      loadEvents(db, row.id),
      loadArtifacts(db, row.id),
    ]);
    return serializeTask(row, events, artifacts, { idempotentReplay: true });
  }

  const publicId = `a2a_${randomUUID().replaceAll("-", "")}`;
  await db.$executeRawUnsafe(
    `INSERT INTO ccass.a2a_tasks (
       public_id, organization_id, caller_subject, command_id, skill_id,
       request_hash, request_envelope, context_id, state
     ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, 'SUBMITTED')`,
    publicId,
    orgIdBigInt(organizationId),
    input.callerSubject,
    input.commandId,
    input.skillId,
    input.requestHash,
    JSON.stringify(input.requestEnvelope ?? {}),
    input.contextId ?? null,
  );

  const row = await loadTaskRow(db, organizationId, publicId);
  if (!row) {
    throw Object.assign(new Error("Failed to create A2A task"), { status: 500 });
  }
  await db.$executeRawUnsafe(
    `INSERT INTO ccass.a2a_task_events (task_id, organization_id, event_type, payload)
     VALUES ($1, $2, 'submitted', '{}'::jsonb)`,
    row.id,
    orgIdBigInt(organizationId),
  );
  const [events, artifacts] = await Promise.all([
    loadEvents(db, row.id),
    loadArtifacts(db, row.id),
  ]);
  return serializeTask(row, events, artifacts, { idempotentReplay: false });
}

export async function getA2ATask(db: Db, organizationId: string, publicId: string) {
  const row = await loadTaskRow(db, organizationId, publicId);
  if (!row) {
    throw Object.assign(new Error("Task not found"), { status: 404 });
  }
  const [events, artifacts] = await Promise.all([
    loadEvents(db, row.id),
    loadArtifacts(db, row.id),
  ]);
  return serializeTask(row, events, artifacts);
}

export async function listA2ATasks(
  db: Db,
  organizationId: string,
  opts: { callerSubject?: string; limit?: number } = {},
) {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const rows = opts.callerSubject
    ? await db.$queryRawUnsafe<Array<{ public_id: string }>>(
        `SELECT public_id FROM ccass.a2a_tasks
         WHERE organization_id = $1 AND caller_subject = $2
         ORDER BY updated_at DESC
         LIMIT $3`,
        orgIdBigInt(organizationId),
        opts.callerSubject,
        limit,
      )
    : await db.$queryRawUnsafe<Array<{ public_id: string }>>(
        `SELECT public_id FROM ccass.a2a_tasks
         WHERE organization_id = $1
         ORDER BY updated_at DESC
         LIMIT $2`,
        orgIdBigInt(organizationId),
        limit,
      );

  const tasks = [];
  for (const item of rows) {
    tasks.push(await getA2ATask(db, organizationId, item.public_id));
  }
  return { tasks };
}

export async function updateA2ATask(
  db: Db,
  organizationId: string,
  publicId: string,
  input: z.infer<typeof updateA2ATaskSchema>,
) {
  const row = await loadTaskRow(db, organizationId, publicId);
  if (!row) {
    throw Object.assign(new Error("Task not found"), { status: 404 });
  }

  const nextState = input.state ?? row.state;
  const terminal = ["COMPLETED", "FAILED", "CANCELED", "REJECTED"].includes(nextState);
  await db.$executeRawUnsafe(
    `UPDATE ccass.a2a_tasks
     SET state = $3,
         result_artifact = COALESCE($4::jsonb, result_artifact),
         error = COALESCE($5::jsonb, error),
         updated_at = NOW(),
         completed_at = CASE WHEN $6 THEN COALESCE(completed_at, NOW()) ELSE completed_at END
     WHERE organization_id = $1 AND public_id = $2`,
    orgIdBigInt(organizationId),
    publicId,
    nextState,
    input.resultArtifact === undefined ? null : JSON.stringify(input.resultArtifact),
    input.error === undefined ? null : JSON.stringify(input.error),
    terminal,
  );

  if (input.eventType) {
    await db.$executeRawUnsafe(
      `INSERT INTO ccass.a2a_task_events (task_id, organization_id, event_type, payload)
       VALUES ($1, $2, $3, $4::jsonb)`,
      row.id,
      orgIdBigInt(organizationId),
      input.eventType,
      JSON.stringify(input.eventPayload ?? {}),
    );
  }

  if (input.resultArtifact) {
    await db.$executeRawUnsafe(
      `INSERT INTO ccass.a2a_artifacts (task_id, organization_id, artifact_name, mime_type, payload)
       VALUES ($1, $2, 'result', 'application/json', $3::jsonb)`,
      row.id,
      orgIdBigInt(organizationId),
      JSON.stringify(input.resultArtifact),
    );
  }

  return getA2ATask(db, organizationId, publicId);
}

export async function cancelA2ATask(
  db: Db,
  organizationId: string,
  publicId: string,
  reason?: string,
) {
  const row = await loadTaskRow(db, organizationId, publicId);
  if (!row) {
    throw Object.assign(new Error("Task not found"), { status: 404 });
  }
  if (["COMPLETED", "FAILED", "CANCELED", "REJECTED"].includes(row.state)) {
    return getA2ATask(db, organizationId, publicId);
  }
  return updateA2ATask(db, organizationId, publicId, {
    state: "CANCELED",
    eventType: "canceled",
    eventPayload: { reason: reason ?? "canceled" },
  });
}
