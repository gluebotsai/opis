import { Prisma } from "@ai-contact-center/db-cc";
import type { FastifyInstance } from "fastify";
import type Redis from "ioredis";

import type { DbClient } from "../lib/rls.js";
import { withOrganizationContext } from "../lib/rls.js";
import { serializeEntityId } from "../lib/id-schema.js";
import { isPresenceEligibleForChannel } from "./presence-cache.js";
import { resolveAgentPresenceState } from "./presence.js";
import { QUEUE_MEMBER_ACTIVE_SHIFT_SQL } from "./shift-routing.js";
import { redisStreamMessage } from "./umn-call-session.js";

const NLP_URL = (process.env.NLP_SERVICE_URL ?? "http://localhost:8000").replace(/\/$/, "");
const INTERNAL_SERVICE_KEY = process.env.INTERNAL_SERVICE_KEY;
const ROUTING_SESSION_TTL_SECONDS = 60 * 60;
const ROUTING_AGENT_LOCK_SECONDS = 45;

export type AcdRoutingRequest = {
  sessionId: string;
  domainId: string;
  eventId: 1 | 5;
  cli: string;
  ddi: string;
  queueId: string;
};

export type VoiceQueueCandidate = {
  runtimeQueueId: string;
  setupQueueId: string;
  name: string;
  description: string;
  intents: string[];
  skills: string[];
};

export type VoiceAgentCandidate = {
  agentId: string;
  userId: string;
  email: string;
  extension: number;
  name: string;
};

type RedisStreamResponse = Array<[string, Array<[string, string[]]>]>;

function stringField(record: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return "";
}

function stringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map(String).map((item) => item.trim()).filter(Boolean);
  }
  if (typeof value === "string" && value.trim()) {
    try {
      return stringList(JSON.parse(value) as unknown);
    } catch {
      return [value.trim()];
    }
  }
  return [];
}

export function nlpCallSubscribeStream(): string {
  return process.env.NLP_CALL_SUB?.trim() || "NLP_CALL_SUB";
}

export function nlpCallPublishChannel(): string {
  return process.env.NLP_CALL_PUB?.trim() || "NLP_CALL_PUB";
}

export function parseAcdRoutingRequest(raw: string): AcdRoutingRequest | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const record = parsed as Record<string, unknown>;
  const eventId = Number(record.event_id ?? record.eventId);
  if (eventId !== 1 && eventId !== 5) return null;
  const sessionId = stringField(record, ["session_id", "sessionId"]);
  const domainId = stringField(record, ["domain_id", "domainId", "organizationId"]);
  if (!sessionId || !domainId) return null;
  return {
    sessionId: sessionId.slice(0, 128),
    domainId,
    eventId,
    cli: stringField(record, ["cli", "ani", "caller"]),
    ddi: stringField(record, ["ddi", "dnis", "called"]),
    queueId: stringField(record, ["queue_id", "queueId", "qid"]),
  };
}

export function buildAcdQueueResponse(
  request: AcdRoutingRequest,
  queueId: string,
): Record<string, unknown> {
  return {
    session_id: request.sessionId,
    domain_id: request.domainId,
    event_id: 2,
    cli: request.cli,
    ddi: request.ddi,
    queue_id: queueId,
  };
}

export function buildAcdAgentResponse(
  request: AcdRoutingRequest,
  agent: VoiceAgentCandidate | null,
): Record<string, unknown> {
  return {
    session_id: request.sessionId,
    domain_id: request.domainId,
    event_id: 6,
    cli: request.cli,
    ddi: request.ddi,
    queue_id: request.queueId,
    agent_email: agent?.email ?? "",
    agent_userId: agent?.userId ?? "0",
    agent_extn: agent?.extension ?? 0,
    agent_name: agent?.name ?? "",
  };
}

export function shouldUseLlmQueuePick(profileCode: string, transcript: string): boolean {
  return profileCode === "skill" && transcript.trim().length > 0;
}

export function fallbackQueueId(queues: VoiceQueueCandidate[]): string | null {
  return queues[0]?.setupQueueId ?? null;
}

export function shouldSkipDidQueueRouting(
  routes: Array<{ routingUserId: string | number | bigint | null }>,
): boolean {
  return routes.some((route) => route.routingUserId != null);
}

export function orderedCandidateIndexes(length: number, cursorIndex: number): number[] {
  if (length <= 0) return [];
  const start = ((cursorIndex % length) + length) % length;
  return Array.from({ length }, (_, offset) => (start + offset) % length);
}

export function orderedUntriedCandidateIndexes(
  candidates: Array<{ agentId: string }>,
  cursorIndex: number,
  excludedAgentIds: ReadonlySet<string>,
): number[] {
  return orderedCandidateIndexes(candidates.length, cursorIndex).filter(
    (index) => !excludedAgentIds.has(candidates[index]!.agentId),
  );
}

function routingCheckpointKey(stream: string): string {
  return `cc2:nlp-call-stream:last-id:${stream}`;
}

function routingResponseKey(stream: string, entryId: string): string {
  return `cc2:nlp-call-stream:response:${stream}:${entryId}`;
}

export function shouldPublishAcdRoutingReply(cachedResponse: string | null): boolean {
  return cachedResponse === null;
}

function offeredAgentsKey(request: AcdRoutingRequest): string {
  return `cc2:voice-routing:offered:${request.domainId}:${request.sessionId}`;
}

function lastOfferedAgentKey(request: AcdRoutingRequest): string {
  return `cc2:voice-routing:last-agent:${request.domainId}:${request.sessionId}`;
}

function agentOfferLockKey(domainId: string, agentId: string): string {
  return `cc2:voice-routing:agent-lock:${domainId}:${agentId}`;
}

async function publishRoutingResponse(
  redis: Redis,
  payload: Record<string, unknown>,
): Promise<void> {
  await redis.publish(nlpCallPublishChannel(), JSON.stringify(payload));
}

async function loadQueueCandidates(
  db: DbClient,
  request: AcdRoutingRequest,
): Promise<{ directDid: boolean; queues: VoiceQueueCandidate[] }> {
  const ddiDigits = request.ddi.replace(/\D/g, "");
  if (!ddiDigits) return { directDid: false, queues: [] };

  const rows = await db.$queryRaw<
    Array<{
      routing_user_id: string | bigint | null;
      runtime_queue_id: string | bigint | null;
      setup_queue_id: string | bigint | null;
      name: string | null;
      description: string | null;
      supported_intents: unknown;
      skills: unknown;
    }>
  >`
    SELECT
      did.routing_user_id,
      q.id AS runtime_queue_id,
      setup_queue.id AS setup_queue_id,
      setup_queue.name,
      COALESCE(profile.description, setup_queue.description, setup_queue.name) AS description,
      COALESCE(profile.supported_intents, '[]'::jsonb) AS supported_intents,
      COALESCE(q.skills, '[]'::jsonb) AS skills
    FROM accounts.setup_voice_dids did
    LEFT JOIN accounts.setup_ccaas_queues setup_queue
      ON setup_queue.id = did.routing_queue_id
     AND setup_queue.organization_id = did.organization_id
    LEFT JOIN ccass.queues q
      ON q.setup_queue_id = setup_queue.id
     AND q.organization_id = did.organization_id
     AND q.status = 'active'
    LEFT JOIN ccass.queue_routing_profiles profile ON profile.queue_id = q.id
    WHERE did.organization_id = ${request.domainId}::bigint
      AND did.status = 'active'
      AND regexp_replace(COALESCE(did.phone_number, ''), '\\D', '', 'g') = ${ddiDigits}
      AND (setup_queue.id IS NULL OR setup_queue.status = 'active')
    ORDER BY q.published_at ASC NULLS LAST, setup_queue.id ASC, q.id ASC
  `;

  const directDid = shouldSkipDidQueueRouting(
    rows.map((row) => ({ routingUserId: row.routing_user_id })),
  );
  const seen = new Set<string>();
  const queues: VoiceQueueCandidate[] = [];
  for (const row of rows) {
    if (row.runtime_queue_id == null || row.setup_queue_id == null || !row.name) continue;
    const setupQueueId = serializeEntityId(row.setup_queue_id);
    if (seen.has(setupQueueId)) continue;
    seen.add(setupQueueId);
    queues.push({
      runtimeQueueId: serializeEntityId(row.runtime_queue_id),
      setupQueueId,
      name: row.name,
      description: row.description ?? row.name,
      intents: stringList(row.supported_intents),
      skills: stringList(row.skills),
    });
  }
  return { directDid, queues };
}

async function loadRoutingProfileCode(db: DbClient, organizationId: string): Promise<string> {
  const rows = await db.$queryRaw<{ code: string }[]>`
    SELECT type.code
    FROM accounts.setup_organization_routing_profiles profile
    INNER JOIN accounts.routing_profile_types type ON type.id = profile.routing_type_id
    WHERE profile.organization_id = ${organizationId}::bigint
    LIMIT 1
  `;
  return rows[0]?.code ?? "skill";
}

async function loadSessionTranscript(
  db: DbClient,
  organizationId: string,
  sessionId: string,
): Promise<string> {
  const rows = await db.$queryRaw<{ sender_type: string; body: string }[]>`
    SELECT message.sender_type, message.body
    FROM ccass.conversation_messages message
    INNER JOIN ccass.conversations conversation ON conversation.id = message.conversation_id
    WHERE conversation.organization_id = ${organizationId}::bigint
      AND (
        conversation.provider_thread_id = ${sessionId}
        OR conversation.external_thread_id = ${sessionId}
      )
      AND message.visibility = 'customer'
    ORDER BY message.created_at DESC
    LIMIT 20
  `;
  return rows
    .reverse()
    .map((row) => `${row.sender_type}: ${row.body}`)
    .join("\n");
}

async function selectQueueWithNlp(
  request: AcdRoutingRequest,
  queues: VoiceQueueCandidate[],
  transcript: string,
): Promise<string | null> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-tenant-id": request.domainId,
  };
  if (INTERNAL_SERVICE_KEY) headers["x-internal-service-key"] = INTERNAL_SERVICE_KEY;
  const response = await fetch(`${NLP_URL}/internal/v1/voice-routing/select-queue`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      organization_id: request.domainId,
      transcript,
      queue_profiles: queues.map((queue) => ({
        key: queue.setupQueueId,
        name: queue.name,
        description: queue.description,
        intents: queue.intents,
        skills: queue.skills,
      })),
    }),
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error(`NLP queue selection failed (${response.status})`);
  const payload = (await response.json()) as { queue_id?: unknown };
  const queueId = typeof payload.queue_id === "string" ? payload.queue_id : "";
  return queues.some((queue) => queue.setupQueueId === queueId) ? queueId : null;
}

async function resolveQueueForEvent(
  app: FastifyInstance,
  request: AcdRoutingRequest,
): Promise<string | null> {
  return withOrganizationContext(app.prisma, request.domainId, async (db) => {
    const { directDid, queues } = await loadQueueCandidates(db, request);
    if (directDid || queues.length === 0) return null;
    if (queues.length === 1) return fallbackQueueId(queues);

    const [profileCode, transcript] = await Promise.all([
      loadRoutingProfileCode(db, request.domainId),
      loadSessionTranscript(db, request.domainId, request.sessionId),
    ]);
    if (!shouldUseLlmQueuePick(profileCode, transcript)) {
      return fallbackQueueId(queues);
    }
    try {
      return (await selectQueueWithNlp(request, queues, transcript)) ?? fallbackQueueId(queues);
    } catch (error) {
      app.log.warn(
        { err: error, sessionId: request.sessionId },
        "ACD NLP queue selection failed; using first DDI queue",
      );
      return fallbackQueueId(queues);
    }
  });
}

async function loadVoiceAgentCandidates(
  db: DbClient,
  request: AcdRoutingRequest,
): Promise<{
  runtimeQueueId: string | null;
  cursorIndex: number;
  candidates: VoiceAgentCandidate[];
  skippedPresence: Array<{ agentId: string; ext: number; presence: string | null }>;
}> {
  if (!/^\d+$/.test(request.queueId)) {
    return { runtimeQueueId: null, cursorIndex: 0, candidates: [], skippedPresence: [] };
  }
  const queueRows = await db.$queryRaw<{ id: string | bigint }[]>`
    SELECT id
    FROM ccass.queues
    WHERE organization_id = ${request.domainId}::bigint
      AND status = 'active'
      AND (id = ${request.queueId}::bigint OR setup_queue_id = ${request.queueId}::bigint)
    ORDER BY CASE WHEN setup_queue_id = ${request.queueId}::bigint THEN 0 ELSE 1 END
    LIMIT 1
  `;
  const runtimeQueueId = queueRows[0]?.id ? serializeEntityId(queueRows[0].id) : null;
  if (!runtimeQueueId) return { runtimeQueueId: null, cursorIndex: 0, candidates: [], skippedPresence: [] };

  const cursorRows = await db.$queryRaw<{ cursor_index: number }[]>`
    INSERT INTO ccass.routing_cursors (organization_id, queue_id, cursor_index)
    VALUES (${request.domainId}::bigint, ${runtimeQueueId}::bigint, 0)
    ON CONFLICT (queue_id) DO UPDATE
      SET updated_at = ccass.routing_cursors.updated_at
    RETURNING cursor_index
  `;

  const rows = await db.$queryRaw<
    Array<{
      agent_id: string;
      user_id: string;
      work_email: string;
      ext: number;
      first_name: string;
      last_name: string;
    }>
  >`
    SELECT
      agent.id::text AS agent_id,
      setup_user.id::text AS user_id,
      setup_user.work_email,
      setup_user.ext,
      setup_user.first_name,
      setup_user.last_name
    FROM ccass.queue_members qm
    INNER JOIN ccass.queues queue ON queue.id = qm.queue_id
    INNER JOIN ccass.agents agent
      ON agent.id = qm.agent_id
     AND agent.organization_id = queue.organization_id
    INNER JOIN accounts.setup_users setup_user
      ON setup_user.id = COALESCE(agent.setup_user_id, qm.setup_user_id)
     AND setup_user.organization_id = queue.organization_id
    WHERE qm.queue_id = ${runtimeQueueId}::bigint
      AND queue.organization_id = ${request.domainId}::bigint
      AND qm.handles_calls = TRUE
      AND qm.call_type IN ('inbound', 'both')
      AND setup_user.ext IS NOT NULL
      AND LOWER(COALESCE(agent.status, 'active')) NOT IN ('inactive', 'disabled', 'deleted')
      AND ${Prisma.raw(QUEUE_MEMBER_ACTIVE_SHIFT_SQL)}
      AND NOT EXISTS (
        SELECT 1
        FROM ccass.queue_skills required_queue_skill
        WHERE required_queue_skill.queue_id = qm.queue_id
          AND required_queue_skill.requirement_type = 'required'
          AND NOT EXISTS (
            SELECT 1
            FROM ccass.agent_skills agent_skill
            WHERE agent_skill.agent_id = qm.agent_id
              AND agent_skill.skill_id = required_queue_skill.skill_id
              AND agent_skill.proficiency >= required_queue_skill.min_proficiency
              AND (agent_skill.expires_at IS NULL OR agent_skill.expires_at > NOW())
          )
      )
      AND NOT EXISTS (
        SELECT 1
        FROM ccass.conversations active_call
        WHERE active_call.organization_id = queue.organization_id
          AND active_call.assigned_agent_id = qm.agent_id
          AND active_call.channel IN ('voice', 'call', 'phone')
          AND active_call.status = 'active'
      )
    ORDER BY qm.agent_id ASC
  `;

  const candidates: VoiceAgentCandidate[] = [];
  const skipped: Array<{ agentId: string; ext: number; presence: string | null }> = [];
  for (const row of rows) {
    const presence = await resolveAgentPresenceState(db, request.domainId, row.agent_id);
    if (!isPresenceEligibleForChannel("voice", presence)) {
      skipped.push({
        agentId: row.agent_id,
        ext: Number(row.ext),
        presence: presence ?? null,
      });
      continue;
    }
    candidates.push({
      agentId: row.agent_id,
      userId: row.user_id,
      email: row.work_email,
      extension: Number(row.ext),
      name: [row.first_name, row.last_name].filter(Boolean).join(" ").trim() || row.work_email,
    });
  }
  return {
    runtimeQueueId,
    cursorIndex: Number(cursorRows[0]?.cursor_index ?? 0),
    candidates,
    skippedPresence: skipped,
  };
}

async function releasePreviousOffer(redis: Redis, request: AcdRoutingRequest): Promise<void> {
  const previousAgentId = await redis.get(lastOfferedAgentKey(request));
  if (!previousAgentId) return;
  const lockKey = agentOfferLockKey(request.domainId, previousAgentId);
  const lockOwner = await redis.get(lockKey);
  if (lockOwner === request.sessionId) await redis.del(lockKey);
}

async function selectAgentForEvent(
  app: FastifyInstance,
  redis: Redis,
  request: AcdRoutingRequest,
): Promise<VoiceAgentCandidate | null> {
  await releasePreviousOffer(redis, request);
  const offeredKey = offeredAgentsKey(request);
  const excluded = new Set(await redis.smembers(offeredKey));

  return withOrganizationContext(app.prisma, request.domainId, async (db) => {
    const { runtimeQueueId, cursorIndex, candidates, skippedPresence } =
      await loadVoiceAgentCandidates(db, request);
    if (!runtimeQueueId || candidates.length === 0) {
      app.log.info(
        {
          event: "acd.routing.agent-unavailable",
          sessionId: request.sessionId,
          domainId: request.domainId,
          queueId: request.queueId,
          runtimeQueueId,
          candidateCount: candidates.length,
          skippedPresence,
        },
        "ACD event 5 found no Ready voice agent",
      );
      return null;
    }

    for (const index of orderedUntriedCandidateIndexes(candidates, cursorIndex, excluded)) {
      const candidate = candidates[index]!;
      const locked = await redis.set(
        agentOfferLockKey(request.domainId, candidate.agentId),
        request.sessionId,
        "EX",
        ROUTING_AGENT_LOCK_SECONDS,
        "NX",
      );
      if (locked !== "OK") continue;

      const nextCursor = (index + 1) % candidates.length;
      await db.$executeRaw`
        UPDATE ccass.routing_cursors
        SET
          cursor_index = ${nextCursor},
          last_agent_id = ${candidate.agentId}::bigint,
          updated_at = NOW()
        WHERE queue_id = ${runtimeQueueId}::bigint
          AND organization_id = ${request.domainId}::bigint
      `;
      const pipeline = redis.pipeline();
      pipeline.sadd(offeredKey, candidate.agentId);
      pipeline.expire(offeredKey, ROUTING_SESSION_TTL_SECONDS);
      pipeline.set(
        lastOfferedAgentKey(request),
        candidate.agentId,
        "EX",
        ROUTING_SESSION_TTL_SECONDS,
      );
      await pipeline.exec();
      return candidate;
    }
    return null;
  });
}

async function processRoutingRequest(
  app: FastifyInstance,
  redis: Redis,
  request: AcdRoutingRequest,
): Promise<Record<string, unknown> | null> {
  if (request.eventId === 1) {
    const queueId = await resolveQueueForEvent(app, request);
    if (!queueId) {
      app.log.info(
        { sessionId: request.sessionId, ddi: request.ddi },
        "ACD queue lookup skipped for direct or unmapped DID",
      );
      return null;
    }
    return buildAcdQueueResponse(request, queueId);
  }

  const agent = await selectAgentForEvent(app, redis, request);
  return buildAcdAgentResponse(request, agent);
}

export function startUmnCallRoutingStreamConsumer(
  app: FastifyInstance,
  streamClient: Redis,
  publisher: Redis,
): () => void {
  const stream = nlpCallSubscribeStream();
  const checkpointKey = routingCheckpointKey(stream);
  let stopped = false;
  app.log.info({ stream }, "ACD queue routing Redis Stream consumer connected");

  void (async () => {
    let lastId = "$";
    try {
      lastId = (await streamClient.get(checkpointKey)) || "$";
    } catch (error) {
      app.log.warn({ err: error, stream }, "ACD routing Stream checkpoint read failed");
    }
    while (!stopped) {
      try {
        const response = (await streamClient.xread(
          "COUNT",
          20,
          "BLOCK",
          5_000,
          "STREAMS",
          stream,
          lastId,
        )) as RedisStreamResponse | null;
        if (!response) continue;

        for (const [, entries] of response) {
          for (const [entryId, fields] of entries) {
            const message = redisStreamMessage(fields);
            const request = message ? parseAcdRoutingRequest(message) : null;
            if (request) {
              const responseKey = routingResponseKey(stream, entryId);
              const cachedResponse = await publisher.get(responseKey);
              if (shouldPublishAcdRoutingReply(cachedResponse)) {
                const output = await processRoutingRequest(app, publisher, request);
                const serialized = output ? JSON.stringify(output) : "__skip__";
                await publisher.set(
                  responseKey,
                  serialized,
                  "EX",
                  ROUTING_SESSION_TTL_SECONDS,
                );
                if (output) await publishRoutingResponse(publisher, output);
              }
            }
            await streamClient.set(checkpointKey, entryId);
            lastId = entryId;
          }
        }
      } catch (error) {
        if (stopped) return;
        app.log.warn({ err: error, stream, lastId }, "ACD routing Redis Stream read failed");
        await new Promise((resolve) => setTimeout(resolve, 1_000));
      }
    }
  })();

  return () => {
    stopped = true;
  };
}
