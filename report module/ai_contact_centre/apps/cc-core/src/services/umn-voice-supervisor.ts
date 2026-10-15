import { isCallChannel } from "../lib/channels.js";
import { getRedisClient } from "../lib/redis-client.js";
import type { DbClient } from "../lib/rls.js";
import { getConversation } from "./conversations.js";
import { umnCallPublishChannel } from "./umn-call-session.js";

export const SUPERVISOR_MONITOR_LISTEN = 1;
export const SUPERVISOR_MONITOR_WHISPER = 2;
export const SUPERVISOR_MONITOR_BARGE = 3;
export const SUPERVISOR_MONITOR_CANCEL = 5;

const CONTACT_CENTER_PRODUCT = "contact-center";

export function supervisorMonitorPublishBody(input: {
  sessionId: string;
  switchType: number;
  email: string;
  name: string;
  userId: string;
  ext: number;
  roleId?: number | null;
}): Record<string, unknown> {
  const userId = Number(input.userId);
  const body: Record<string, unknown> = {
    session_id: input.sessionId,
    req_type: "SUPERVISOR",
    switch_type: input.switchType,
    email: input.email,
    name: input.name,
    userId: Number.isSafeInteger(userId) ? userId : input.userId,
    ext: input.ext,
  };
  if (input.switchType === SUPERVISOR_MONITOR_LISTEN && input.roleId != null) {
    body.roleId = input.roleId;
  }
  return body;
}

async function publishAcd(body: Record<string, unknown>): Promise<void> {
  const redis = getRedisClient();
  if (!redis) {
    throw Object.assign(new Error("ACD supervisor listen is unavailable"), { status: 503 });
  }
  try {
    await redis.publish(umnCallPublishChannel(), JSON.stringify(body));
  } catch (error) {
    throw Object.assign(new Error("Failed to send supervisor listen to ACD"), {
      status: 503,
      cause: error,
    });
  }
}

async function loadSupervisor(
  db: DbClient,
  organizationId: string,
  userId: string,
): Promise<{ email: string; name: string; userId: string; ext: number; roleId: number | null }> {
  const rows = await db.$queryRaw<
    Array<{
      id: string;
      ext: number | null;
      work_email: string;
      first_name: string;
      last_name: string;
      role_id: string | null;
    }>
  >`
    SELECT
      su.id::text AS id,
      su.ext,
      su.work_email,
      su.first_name,
      su.last_name,
      supa.role_id::text AS role_id
    FROM accounts.setup_users su
    LEFT JOIN accounts.setup_user_product_access supa
      ON supa.user_id = su.id
     AND supa.organization_id = su.organization_id
     AND supa.product_id = ${CONTACT_CENTER_PRODUCT}
    WHERE su.organization_id = ${organizationId}::bigint
      AND su.id = ${userId}::bigint
    LIMIT 1
  `;
  const user = rows[0];
  if (!user || user.ext == null) {
    throw Object.assign(new Error("Supervisor has no SIP extension"), { status: 409 });
  }
  const roleId = user.role_id == null ? null : Number(user.role_id);
  return {
    email: user.work_email,
    name: `${user.first_name} ${user.last_name}`.trim(),
    userId: user.id,
    ext: user.ext,
    roleId: roleId != null && Number.isSafeInteger(roleId) ? roleId : null,
  };
}

async function loadVoiceSessionId(
  db: DbClient,
  organizationId: string,
  conversationId: string,
): Promise<string> {
  const conversation = await getConversation(db, organizationId, conversationId);
  if (!conversation || !isCallChannel(conversation.channel)) {
    throw Object.assign(new Error("Voice conversation not found"), { status: 404 });
  }
  const sessionId = conversation.providerThreadId || conversation.externalThreadId;
  if (!sessionId) {
    throw Object.assign(new Error("Call session id is missing"), { status: 409 });
  }
  return sessionId;
}

async function loadVoiceListenTarget(
  db: DbClient,
  organizationId: string,
  conversationId: string,
): Promise<{ sessionId: string; agentExt: string }> {
  const conversation = await getConversation(db, organizationId, conversationId);
  if (!conversation || !isCallChannel(conversation.channel)) {
    throw Object.assign(new Error("Voice conversation not found"), { status: 404 });
  }
  const sessionId = conversation.providerThreadId || conversation.externalThreadId;
  if (!sessionId) {
    throw Object.assign(new Error("Call session id is missing"), { status: 409 });
  }
  if (!conversation.assignedAgentId) {
    throw Object.assign(new Error("No agent is on this call"), { status: 409 });
  }
  const rows = await db.$queryRaw<Array<{ ext: number | null }>>`
    SELECT su.ext
    FROM ccass.agents a
    INNER JOIN accounts.setup_users su ON su.id = a.setup_user_id
    WHERE a.organization_id = ${organizationId}::bigint
      AND a.id = ${conversation.assignedAgentId}::bigint
    LIMIT 1
  `;
  const ext = rows[0]?.ext;
  if (ext == null) {
    throw Object.assign(new Error("The agent on this call has no SIP extension"), { status: 409 });
  }
  return { sessionId, agentExt: String(ext) };
}

export async function publishSupervisorListen(
  db: DbClient,
  organizationId: string,
  userId: string,
  conversationId: string,
): Promise<{ sessionId: string; agentExt: string }> {
  const target = await loadVoiceListenTarget(db, organizationId, conversationId);
  const supervisor = await loadSupervisor(db, organizationId, userId);
  if (String(supervisor.ext) === target.agentExt) {
    throw Object.assign(new Error("End your call before listening to it"), { status: 409 });
  }
  await publishAcd(
    supervisorMonitorPublishBody({
      sessionId: target.sessionId,
      switchType: SUPERVISOR_MONITOR_LISTEN,
      email: supervisor.email,
      name: supervisor.name,
      userId: supervisor.userId,
      ext: supervisor.ext,
      roleId: supervisor.roleId,
    }),
  );
  return { sessionId: target.sessionId, agentExt: target.agentExt };
}

export async function publishSupervisorListenCancel(
  db: DbClient,
  organizationId: string,
  userId: string,
  conversationId: string,
): Promise<{ sessionId: string }> {
  const sessionId = await loadVoiceSessionId(db, organizationId, conversationId);
  const supervisor = await loadSupervisor(db, organizationId, userId);
  await publishAcd(
    supervisorMonitorPublishBody({
      sessionId,
      switchType: SUPERVISOR_MONITOR_CANCEL,
      email: supervisor.email,
      name: supervisor.name,
      userId: supervisor.userId,
      ext: supervisor.ext,
    }),
  );
  return { sessionId };
}

/** Change mix on the open listen leg. Does not start a new SIP call. */
export async function publishSupervisorMonitorSwitch(
  db: DbClient,
  organizationId: string,
  userId: string,
  conversationId: string,
  switchType:
    | typeof SUPERVISOR_MONITOR_LISTEN
    | typeof SUPERVISOR_MONITOR_WHISPER
    | typeof SUPERVISOR_MONITOR_BARGE,
): Promise<{ sessionId: string }> {
  const sessionId = await loadVoiceSessionId(db, organizationId, conversationId);
  const supervisor = await loadSupervisor(db, organizationId, userId);
  await publishAcd(
    supervisorMonitorPublishBody({
      sessionId,
      switchType,
      email: supervisor.email,
      name: supervisor.name,
      userId: supervisor.userId,
      ext: supervisor.ext,
      roleId: supervisor.roleId,
    }),
  );
  return { sessionId };
}
