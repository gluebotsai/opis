import type { FastifyInstance } from "fastify";
import type Redis from "ioredis";

import { organizationRedisKey } from "../lib/redis-keys.js";
import { withOrganizationContext, type DbClient } from "../lib/rls.js";
import { presenceStateSchema, type PresenceState } from "./presence.js";
import { umnPresencePublishChannel, umnPresenceSubscribeChannel } from "./umn-presence.js";

export type EmbeddedPresenceIntent = {
  organizationId: string;
  userId: string;
  state: PresenceState;
  reasonCode: string | null;
  source: string;
  ext: string;
  email: string;
  statusName: string;
};

/** UMN writes ccass.agent_presence. This process only publishes the intent. */
export function embeddedUmnPresenceWriterEnabled(
  _env: NodeJS.ProcessEnv = process.env,
): boolean {
  return false;
}

export function parseEmbeddedPresenceIntent(raw: string): EmbeddedPresenceIntent | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const record = parsed as Record<string, unknown>;
  const organizationId = String(record.ccaasOrganizationId ?? record.domainId ?? "").trim();
  const userId = String(record.userId ?? "").trim();
  const stateResult = presenceStateSchema.safeParse(String(record.ccaasState ?? "").trim());
  if (!organizationId || !userId || !stateResult.success) return null;
  const reason = record.ccaasReasonCode;
  return {
    organizationId,
    userId,
    state: stateResult.data,
    reasonCode: reason == null || reason === "" ? null : String(reason),
    source: String(record.ccaasSource ?? "agent").trim() || "agent",
    ext: record.ext == null ? "" : String(record.ext),
    email: record.email == null ? "" : String(record.email),
    statusName: record.statusName == null ? "" : String(record.statusName),
  };
}

/** Upsert the authoritative presence row in the caller's organization context. */
export async function commitAgentPresenceRow(
  db: DbClient,
  input: {
    organizationId: string;
    agentId: string;
    state: PresenceState;
    reasonCode: string | null;
    source: string;
  },
): Promise<boolean> {
  const rows = await db.$queryRaw<Array<{ agent_id: string; previous_state: string | null }>>`
    WITH previous AS (
      SELECT presence_state
      FROM ccass.agent_presence
      WHERE organization_id = ${input.organizationId}::bigint
        AND agent_id = ${input.agentId}::bigint
    ),
    upserted AS (
      INSERT INTO ccass.agent_presence (
        organization_id, agent_id, status, presence_state, reason_code, source,
        version, updated_at, heartbeat_at
      )
      SELECT
        agent.organization_id, agent.id, ${input.state}, ${input.state},
        ${input.reasonCode}, ${input.source}, 1, NOW(), NOW()
      FROM ccass.agents agent
      WHERE agent.organization_id = ${input.organizationId}::bigint
        AND agent.id = ${input.agentId}::bigint
      ON CONFLICT (agent_id) DO UPDATE
      SET status = EXCLUDED.status,
          presence_state = EXCLUDED.presence_state,
          reason_code = EXCLUDED.reason_code,
          source = EXCLUDED.source,
          version = ccass.agent_presence.version + 1,
          updated_at = NOW(),
          heartbeat_at = NOW()
      WHERE ccass.agent_presence.organization_id = EXCLUDED.organization_id
        AND (
          ccass.agent_presence.presence_state IS DISTINCT FROM EXCLUDED.presence_state
          OR ccass.agent_presence.reason_code IS DISTINCT FROM EXCLUDED.reason_code
          OR ccass.agent_presence.source IS DISTINCT FROM EXCLUDED.source
        )
      RETURNING agent_id::text
    )
    SELECT upserted.agent_id, previous.presence_state AS previous_state
    FROM upserted
    LEFT JOIN previous ON TRUE
  `;
  const row = rows[0];
  if (!row) {
    const current = await db.$queryRaw<Array<{ presence_state: string }>>`
      SELECT presence_state
      FROM ccass.agent_presence
      WHERE organization_id = ${input.organizationId}::bigint
        AND agent_id = ${input.agentId}::bigint
      LIMIT 1
    `;
    return current[0]?.presence_state === input.state;
  }
  if (row.previous_state !== input.state) {
    await db.$executeRaw`
      INSERT INTO ccass.agent_presence_history (
        organization_id, agent_id, previous_state, new_state, reason_code, source, ended_at
      )
      VALUES (
        ${input.organizationId}::bigint, ${row.agent_id}::bigint,
        ${row.previous_state}, ${input.state}, ${input.reasonCode}, ${input.source}, NOW()
      )
    `;
  }
  return true;
}

export async function commitEmbeddedPresenceIntent(
  app: FastifyInstance,
  redis: Redis,
  intent: EmbeddedPresenceIntent,
): Promise<boolean> {
  const lockKey = organizationRedisKey(
    intent.organizationId,
    "cc",
    "presence-commit",
    intent.userId,
    intent.state,
    intent.reasonCode ?? "",
    intent.source,
  );
  const claimed = await redis.set(lockKey, "1", "EX", 10, "NX");
  if (claimed !== "OK") return false;

  const committed = await withOrganizationContext(app.prisma, intent.organizationId, async (db) => {
    const agents = await db.$queryRaw<Array<{ id: string }>>`
      SELECT id::text AS id
      FROM ccass.agents
      WHERE organization_id = ${intent.organizationId}::bigint
        AND setup_user_id = ${intent.userId}::bigint
      LIMIT 1
    `;
    const agentId = agents[0]?.id;
    if (!agentId) return false;
    return commitAgentPresenceRow(db, {
      organizationId: intent.organizationId,
      agentId,
      state: intent.state,
      reasonCode: intent.reasonCode,
      source: intent.source,
    });
  });

  if (!committed) return false;
  await redis.publish(
    umnPresenceSubscribeChannel(),
    JSON.stringify({
      domainId: intent.organizationId,
      statusName: intent.statusName || intent.state,
      ext: intent.ext,
      email: intent.email,
    }),
  );
  return true;
}

export function startEmbeddedUmnPresenceWriter(
  app: FastifyInstance,
  publisher: Redis,
  subscriber: Redis,
): void {
  if (!embeddedUmnPresenceWriterEnabled()) {
    app.log.info("External UMN is the presence writer; in-process committer is off");
    return;
  }
  const channel = umnPresencePublishChannel();
  subscriber.on("message", (receivedChannel, message) => {
    if (receivedChannel !== channel) return;
    const intent = parseEmbeddedPresenceIntent(message);
    if (!intent) {
      app.log.warn({ channel }, "presence intent missing organization, user, or state");
      return;
    }
    void commitEmbeddedPresenceIntent(app, publisher, intent).catch((error) => {
      app.log.warn({ err: error, organizationId: intent.organizationId }, "presence commit failed");
    });
  });
  void subscriber.subscribe(channel).then(
    () => {
      app.log.info({ channel }, "In-process presence committer subscribed");
    },
    (error) => {
      app.log.warn({ err: error, channel }, "In-process presence committer failed to subscribe");
    },
  );
}
