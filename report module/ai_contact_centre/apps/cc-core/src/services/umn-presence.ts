import type { FastifyInstance } from "fastify";
import type Redis from "ioredis";

import { serializeEntityId } from "../lib/id-schema.js";
import { getRedisClient } from "../lib/redis-client.js";
import type { DbClient } from "../lib/rls.js";
import { withOrganizationContext } from "../lib/rls.js";
import {
  getAgentPresenceByAgentId,
  type AgentPresenceRecord,
  type PresenceState,
} from "./presence.js";
import { applyPresenceRoutingEffects } from "./presence-routing.js";
import { emitPresenceUpdated, emitPresenceUpdatedForAgent } from "./realtime.js";

export type UmnPresenceOutboundPayload = {
  ext: string;
  statusName: string;
  UserName: string;
  isVoice: number;
  isVoiceCallTransfer: number;
  domainId: number;
  email: string;
  userId: string;
  inboundCall: number;
  outboundCampaignCall: number;
  is_outbound_campaign_specific_agent: number;
  forced_presence: number;
  quId: string;
  queueName: string;
  ccaasOrganizationId?: string;
  ccaasState?: string;
  ccaasReasonCode?: string | null;
  ccaasSource?: string;
};

export type UmnPresenceInboundPayload = {
  domainId: string;
  statusName: string;
  ext: string;
  email: string;
};

type SetupUserRow = {
  id: string;
  organization_id: string;
  ext: number | null;
  work_email: string;
  first_name: string;
  last_name: string;
};

type QueueMembershipRow = {
  id: string;
  name: string;
  handles_calls: boolean;
  handles_inbound: boolean;
  handles_outbound: boolean;
  handles_outbound_campaign: boolean;
};

function flag(value: boolean | null | undefined): number {
  return value ? 1 : 0;
}

export function umnPresencePublishChannel(): string {
  return process.env.AGENT_PRESENCE_PUB?.trim() || "AGENT_PRESENCE_PUB";
}

export function umnPresenceSubscribeChannel(): string {
  return process.env.AGENT_PRESENCE_SUB?.trim() || "AGENT_PRESENCE_SUB";
}

/** 3 = first login, 2 = Ready restored after an interaction, 0 = every other publish. */
export function umnForcedPresenceCode(source?: string | null, state?: string | null): number {
  if (source === "login") return 3;
  if (
    state === "ready" &&
    (source === "voice" ||
      source === "conversation_ended" ||
      source === "conversation_resolved" ||
      source === "conversation_transferred")
  ) {
    return 2;
  }
  return 0;
}

export function toUmnStatusName(state: PresenceState | string): string {
  if (state === "ready") return "Ready";
  if (state === "not_ready") return "Not Ready";
  if (state === "busy") return "Busy";
  if (state === "offline") return "Offline";
  return "Away";
}

export function toCcaasPresenceState(statusName: string): PresenceState | null {
  const normalized = statusName
    .trim()
    .toLowerCase()
    .split(" ")
    .filter((part) => part.length > 0)
    .join(" ");
  if (normalized === "ready") return "ready";
  if (normalized === "not ready" || normalized === "not_ready") return "not_ready";
  if (normalized === "busy") return "busy";
  if (normalized === "away") return "away";
  if (normalized === "offline") return "offline";
  return null;
}

/** The badge follows the stored row. An ACD message that the row does not match is not shown. */
export function inboundPresenceForUi(
  current: AgentPresenceRecord | null,
  _agentId: string,
  _organizationId: string,
  state: PresenceState,
): AgentPresenceRecord | null {
  if (current?.state === state) return current;
  return null;
}

export function shouldApplyInboundUmnBusy(input: {
  hasActiveVoiceWork: boolean;
}): boolean {
  return input.hasActiveVoiceWork;
}

export function umnDomainId(organizationId: string | number | bigint): number {
  const asNumber = Number(String(organizationId));
  return Number.isSafeInteger(asNumber) ? asNumber : 0;
}

export function parseInboundUmnPresence(raw: string): UmnPresenceInboundPayload | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const record = parsed as Record<string, unknown>;
  const domainId = record.domainId == null ? "" : String(record.domainId).trim();
  const statusName = record.statusName == null ? "" : String(record.statusName).trim();
  const ext = record.ext == null ? "" : String(record.ext).trim();
  const email = record.email == null ? "" : String(record.email).trim();
  if (!domainId || !statusName) return null;
  return { domainId, statusName, ext, email };
}

async function loadSetupUser(
  db: DbClient,
  organizationId: string,
  userId: string,
): Promise<SetupUserRow | null> {
  const rows = await db.$queryRaw<SetupUserRow[]>`
    SELECT id, organization_id, ext, work_email, first_name, last_name
    FROM accounts.setup_users
    WHERE id = ${userId}::bigint AND organization_id = ${organizationId}::bigint
    LIMIT 1
  `;
  const row = rows[0];
  if (!row) return null;
  return {
    ...row,
    id: serializeEntityId(row.id),
    organization_id: serializeEntityId(row.organization_id),
  };
}

async function loadPrimaryQueueMembership(
  db: DbClient,
  userId: string,
): Promise<QueueMembershipRow | null> {
  const rows = await db.$queryRaw<QueueMembershipRow[]>`
    SELECT q.id, q.name, qa.handles_calls, qa.handles_inbound, qa.handles_outbound,
           qa.handles_outbound_campaign
    FROM accounts.setup_ccaas_queue_agents qa
    INNER JOIN accounts.setup_ccaas_queues q ON q.id = qa.queue_id
    WHERE qa.user_id = ${userId}::bigint
    ORDER BY qa.id ASC
    LIMIT 1
  `;
  const row = rows[0];
  if (!row) return null;
  return { ...row, id: serializeEntityId(row.id) };
}

export function buildUmnPresencePayload(input: {
  user: SetupUserRow;
  queue: QueueMembershipRow | null;
  state: PresenceState | string;
  isVoiceCallTransfer?: boolean;
  reasonCode?: string | null;
  source?: string;
}): UmnPresenceOutboundPayload {
  const { user, queue, state } = input;
  const transferring = input.isVoiceCallTransfer ?? false;
  return {
    ext: user.ext == null ? "" : String(user.ext),
    statusName: toUmnStatusName(state),
    UserName: `${user.first_name} ${user.last_name}`.trim(),
    isVoice: state === "ready" ? 1 : 0,
    isVoiceCallTransfer: transferring ? 1 : 0,
    domainId: umnDomainId(user.organization_id),
    email: user.work_email,
    userId: user.id,
    inboundCall: flag(queue?.handles_inbound),
    outboundCampaignCall: flag(queue?.handles_outbound_campaign),
    is_outbound_campaign_specific_agent: flag(queue?.handles_outbound_campaign),
    forced_presence: umnForcedPresenceCode(input.source, state),
    quId: queue?.id ?? "",
    queueName: queue?.name ?? "",
    ccaasOrganizationId: user.organization_id,
    ccaasState: String(state),
    ccaasReasonCode: input.reasonCode ?? null,
    ccaasSource: input.source ?? "agent",
  };
}

export async function publishAgentPresenceToUmn(
  db: DbClient,
  organizationId: string,
  userId: string,
  state: PresenceState | string,
  options?: { isVoiceCallTransfer?: boolean; reasonCode?: string | null; source?: string },
): Promise<void> {
  const redis = getRedisClient();
  if (!redis) {
    throw Object.assign(new Error("UMN presence publication is unavailable"), { status: 503 });
  }

  const user = await loadSetupUser(db, organizationId, userId);
  if (!user) {
    throw Object.assign(new Error("Presence user not found in organization"), { status: 404 });
  }
  const queue = await loadPrimaryQueueMembership(db, userId);
  const payload = buildUmnPresencePayload({
    user,
    queue,
    state,
    isVoiceCallTransfer: options?.isVoiceCallTransfer,
    reasonCode: options?.reasonCode,
    source: options?.source,
  });
  const channel = umnPresencePublishChannel();
  await redis.publish(channel, JSON.stringify(payload));
  console.info("[presence] sent to ACD", {
    channel,
    organizationId: user.organization_id,
    userId: user.id,
    ext: payload.ext,
    email: user.work_email,
    state,
    statusName: payload.statusName,
    source: options?.source ?? "agent",
    reasonCode: options?.reasonCode ?? null,
    forcedPresence: payload.forced_presence,
  });
}

async function findUserForInbound(
  db: DbClient,
  organizationId: string,
  ext: string,
  email: string,
): Promise<{ id: string } | null> {
  const extNumber = Number(ext);
  if (ext && Number.isInteger(extNumber)) {
    const byExt = await db.$queryRaw<{ id: string }[]>`
      SELECT id FROM accounts.setup_users
      WHERE organization_id = ${organizationId}::bigint AND ext = ${extNumber}
      LIMIT 1
    `;
    if (byExt[0]) return { id: serializeEntityId(byExt[0].id) };
  }
  const emailNorm = email.trim().toLowerCase();
  if (!emailNorm) return null;
  const byEmail = await db.$queryRaw<{ id: string }[]>`
    SELECT id FROM accounts.setup_users
    WHERE organization_id = ${organizationId}::bigint
      AND lower(work_email) = ${emailNorm}
    LIMIT 1
  `;
  return byEmail[0] ? { id: serializeEntityId(byEmail[0].id) } : null;
}

export async function applyInboundUmnPresence(
  app: FastifyInstance,
  payload: UmnPresenceInboundPayload,
): Promise<void> {
  const state = toCcaasPresenceState(payload.statusName);
  if (!state) {
    app.log.warn({ statusName: payload.statusName }, "umn presence ignored: unknown status");
    return;
  }

  const organizationId = payload.domainId;
  await withOrganizationContext(app.prisma, organizationId, async (db) => {
    const user = await findUserForInbound(db, organizationId, payload.ext, payload.email);
    if (!user) {
      app.log.warn(
        { organizationId, ext: payload.ext, email: payload.email },
        "umn presence ignored: user not found",
      );
      return;
    }

    const agentRows = await db.$queryRaw<{ id: string }[]>`
      SELECT id FROM ccass.agents
      WHERE organization_id = ${organizationId}::bigint AND setup_user_id = ${user.id}::bigint
      LIMIT 1
    `;
    const agent = agentRows[0];
    if (!agent) {
      app.log.warn({ organizationId, userId: user.id }, "umn presence ignored: agent not found");
      return;
    }

    if (state === "busy") {
      const activeRows = await db.$queryRaw<{ has_active_voice_work: boolean }[]>`
        SELECT (
          EXISTS (
            SELECT 1
            FROM ccass.conversations conversation
            WHERE conversation.organization_id = ${organizationId}::bigint
              AND conversation.assigned_agent_id = ${agent.id}::bigint
              AND lower(conversation.channel) IN ('call', 'voice', 'phone')
              AND conversation.status IN ('assigned', 'active')
          )
          OR EXISTS (
            SELECT 1
            FROM ccass.conversation_transfers transfer
            INNER JOIN ccass.conversations conversation
              ON conversation.id = transfer.conversation_id
             AND conversation.organization_id = transfer.organization_id
            WHERE transfer.organization_id = ${organizationId}::bigint
              AND lower(COALESCE(transfer.channel, conversation.channel)) IN ('call', 'voice', 'phone')
              AND transfer.state IN ('offered', 'accepted')
              AND (
                transfer.from_agent_id = ${agent.id}::bigint
                OR transfer.requested_agent_id = ${agent.id}::bigint
                OR transfer.offered_agent_id = ${agent.id}::bigint
                OR transfer.accepted_agent_id = ${agent.id}::bigint
              )
          )
        ) AS has_active_voice_work
      `;
      if (
        !shouldApplyInboundUmnBusy({
          hasActiveVoiceWork: activeRows[0]?.has_active_voice_work ?? false,
        })
      ) {
        app.log.info(
          { organizationId, userId: user.id, ext: payload.ext },
          "stale UMN Busy ignored: no active voice work",
        );
        return;
      }
    }

    const current = await getAgentPresenceByAgentId(
      db,
      organizationId,
      serializeEntityId(agent.id),
    );
    const presence = inboundPresenceForUi(
      current,
      serializeEntityId(agent.id),
      organizationId,
      state,
    );
    if (!presence) return;
    app.log.info(
      {
        organizationId,
        userId: user.id,
        ext: payload.ext,
        email: payload.email,
        statusName: payload.statusName,
        state,
      },
      "[presence] inbound",
    );
    emitPresenceUpdated(organizationId, presence, user.id);
    emitPresenceUpdatedForAgent(organizationId, user.id, presence);
    await applyPresenceRoutingEffects(app, organizationId, user.id, presence);
  });
}

export function startUmnPresenceSubscriber(app: FastifyInstance, subscriber: Redis): void {
  const channel = umnPresenceSubscribeChannel();
  subscriber.on("message", (receivedChannel, message) => {
    if (receivedChannel !== channel) return;
    const payload = parseInboundUmnPresence(message);
    if (!payload) {
      app.log.warn({ channel, message }, "umn presence inbound payload invalid");
      return;
    }
    void applyInboundUmnPresence(app, payload).catch((error) => {
      app.log.warn({ err: error, payload }, "umn presence inbound apply failed");
    });
  });
  void subscriber.subscribe(channel).then(
    () => {
      app.log.info({ channel }, "UMN presence subscriber connected");
    },
    (error) => {
      app.log.warn({ err: error, channel }, "UMN presence subscribe failed");
    },
  );
}
