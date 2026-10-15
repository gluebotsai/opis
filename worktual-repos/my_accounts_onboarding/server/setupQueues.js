import { pool } from "./db/pool.js";
import { isOrgAdminCustomer } from "./customerAuth.js";
import { isUuid } from "./db/util.js";
import { listSubscriptionsByOrganization } from "./subscriptions.js";
import * as orgRepo from "./repositories/raw/setupOrganization.repo.js";
import * as repo from "./repositories/raw/setupQueues.repo.js";

export const CCAAS_PRODUCT_ID = "contact-center";
export const CALL_TYPES = ["inbound", "outbound", "both"];

function normalizeCallType(value) {
  const raw = String(value || "both").trim().toLowerCase();
  return CALL_TYPES.includes(raw) ? raw : "both";
}

function assertOrgAdmin(customerUser) {
  if (!isOrgAdminCustomer(customerUser)) {
    const error = new Error("Only organization admins can modify setup workspace.");
    error.statusCode = 403;
    throw error;
  }
}

function assertQueueId(id) {
  if (!isUuid(id)) {
    const error = new Error("Queue id is invalid.");
    error.statusCode = 400;
    throw error;
  }
}

async function assertCcaasPurchased(organizationId) {
  const subscriptions = await listSubscriptionsByOrganization(organizationId);
  const hasCcaas = subscriptions.some(
    (row) => row.status === "active" && row.productId === CCAAS_PRODUCT_ID,
  );
  if (!hasCcaas) {
    const error = new Error("Queues are only available when Contact Centre is purchased.");
    error.statusCode = 403;
    throw error;
  }
}

function mapAgent(row) {
  return {
    userId: row.user_id,
    firstName: row.first_name || "",
    lastName: row.last_name || "",
    workEmail: row.work_email || "",
    handlesCalls: Boolean(row.handles_calls),
    callType: normalizeCallType(row.call_type),
    handlesEmail: Boolean(row.handles_email),
    handlesChat: Boolean(row.handles_chat),
    handlesWhatsapp: Boolean(row.handles_whatsapp),
    handlesInstagram: Boolean(row.handles_instagram),
    handlesFacebook: Boolean(row.handles_facebook),
    emailConcurrency: row.email_concurrency ?? 1,
    chatConcurrency: row.chat_concurrency ?? 1,
    whatsappConcurrency: row.whatsapp_concurrency ?? 1,
    instagramConcurrency: row.instagram_concurrency ?? 1,
    facebookConcurrency: row.facebook_concurrency ?? 1,
  };
}

function mapQueue(row, agents = null) {
  if (!row) return null;
  const mapped = {
    id: row.id,
    name: row.name,
    teamId: row.team_id,
    teamName: row.team_name || "",
    status: row.status || "active",
    agentCount: row.agent_count ?? (agents ? agents.length : 0),
  };
  if (agents) mapped.agents = agents.map(mapAgent);
  return mapped;
}

function userHasCcaasAccess(userRow) {
  const access = Array.isArray(userRow.product_access) ? userRow.product_access : [];
  return access.some((entry) => {
    const productId = entry?.productId || entry?.product_id;
    return productId === CCAAS_PRODUCT_ID;
  });
}

function teamMemberIds(team) {
  return Array.isArray(team?.member_ids) ? team.member_ids.map(String) : [];
}

function userBelongsToTeam(userRow, team) {
  if (!userRow || !team) return false;
  if (userRow.team_id && String(userRow.team_id) === String(team.id)) return true;
  return teamMemberIds(team).includes(String(userRow.id));
}

function normalizeAgentsPayload(agents = []) {
  if (!Array.isArray(agents)) return [];
  const seen = new Set();
  const normalized = [];
  for (const entry of agents) {
    const userId = String(entry?.userId || entry?.id || "").trim();
    if (!userId || seen.has(userId)) continue;
    seen.add(userId);
    normalized.push({
      userId,
      handlesCalls: Boolean(entry.handlesCalls),
      callType: normalizeCallType(entry.callType),
      handlesEmail: Boolean(entry.handlesEmail),
      handlesChat: Boolean(entry.handlesChat),
      handlesWhatsapp: Boolean(entry.handlesWhatsapp),
      handlesInstagram: Boolean(entry.handlesInstagram),
      handlesFacebook: Boolean(entry.handlesFacebook),
      emailConcurrency: Math.max(1, Number(entry.emailConcurrency) || 1),
      chatConcurrency: Math.max(1, Number(entry.chatConcurrency) || 1),
      whatsappConcurrency: Math.max(1, Number(entry.whatsappConcurrency) || 1),
      instagramConcurrency: Math.max(1, Number(entry.instagramConcurrency) || 1),
      facebookConcurrency: Math.max(1, Number(entry.facebookConcurrency) || 1),
    });
  }
  return normalized;
}

async function validateAgentsForQueue(organizationId, team, agents, excludeQueueId = null) {
  if (!agents.length) return;
  const users = await orgRepo.listUsers(pool, organizationId);
  const usersById = new Map(users.map((user) => [user.id, user]));
  const assignments = await repo.listAgentQueueAssignments(pool, organizationId);
  const assignmentByUser = new Map(
    assignments
      .filter((row) => !excludeQueueId || row.queue_id !== excludeQueueId)
      .map((row) => [row.user_id, row]),
  );

  for (const agent of agents) {
    const user = usersById.get(agent.userId);
    if (!user) {
      const error = new Error("One or more selected agents were not found.");
      error.statusCode = 400;
      throw error;
    }
    const label =
      [user.first_name, user.last_name].filter(Boolean).join(" ").trim() ||
      user.work_email ||
      "This agent";

    if (!userHasCcaasAccess(user)) {
      const error = new Error(
        `${label} does not have Contact Centre access and cannot join a queue.`,
      );
      error.statusCode = 400;
      throw error;
    }
    if (!userBelongsToTeam(user, team)) {
      const error = new Error(
        `${label} is not on team “${team.name}”. A queue can only include agents from its team.`,
      );
      error.statusCode = 400;
      throw error;
    }
    const existing = assignmentByUser.get(agent.userId);
    if (existing) {
      const error = new Error(
        `${label} is already assigned to queue “${existing.queue_name}”. An agent can only belong to one queue.`,
      );
      error.statusCode = 400;
      throw error;
    }
  }
}

export async function listQueues(customerUser) {
  await assertCcaasPurchased(customerUser.organizationId);
  const rows = await repo.listQueues(pool, customerUser.organizationId);
  return rows.map((row) => mapQueue(row));
}

export async function getQueue(customerUser, id) {
  await assertCcaasPurchased(customerUser.organizationId);
  assertQueueId(id);
  const row = await repo.getQueueById(pool, customerUser.organizationId, id);
  if (!row) {
    const error = new Error("Queue not found.");
    error.statusCode = 404;
    throw error;
  }
  const agents = await repo.listQueueAgents(pool, id);
  return mapQueue(row, agents);
}

export async function createQueue(customerUser, body) {
  assertOrgAdmin(customerUser);
  await assertCcaasPurchased(customerUser.organizationId);

  const name = String(body?.name || "").trim();
  if (!name) {
    const error = new Error("Queue name is required.");
    error.statusCode = 400;
    throw error;
  }
  const teamId = String(body?.teamId || "").trim();
  if (!isUuid(teamId)) {
    const error = new Error("Select a team for this queue.");
    error.statusCode = 400;
    throw error;
  }
  const team = await orgRepo.getTeamById(pool, customerUser.organizationId, teamId);
  if (!team) {
    const error = new Error("Selected team was not found.");
    error.statusCode = 400;
    throw error;
  }

  const agents = normalizeAgentsPayload(body?.agents);
  await validateAgentsForQueue(customerUser.organizationId, team, agents);

  const row = await repo.insertQueue(pool, customerUser.organizationId, {
    name,
    teamId,
    status: body.status === "inactive" ? "inactive" : "active",
  });
  if (agents.length) {
    await repo.replaceQueueAgents(pool, row.id, agents);
  }
  const assigned = await repo.listQueueAgents(pool, row.id);
  return mapQueue(await repo.getQueueById(pool, customerUser.organizationId, row.id), assigned);
}

export async function patchQueue(customerUser, id, body) {
  assertOrgAdmin(customerUser);
  await assertCcaasPurchased(customerUser.organizationId);
  assertQueueId(id);

  const existing = await repo.getQueueById(pool, customerUser.organizationId, id);
  if (!existing) {
    const error = new Error("Queue not found.");
    error.statusCode = 404;
    throw error;
  }

  let nextTeamId = existing.team_id;
  if (body.teamId !== undefined) {
    const teamId = String(body.teamId || "").trim();
    if (!isUuid(teamId)) {
      const error = new Error("Select a team for this queue.");
      error.statusCode = 400;
      throw error;
    }
    const team = await orgRepo.getTeamById(pool, customerUser.organizationId, teamId);
    if (!team) {
      const error = new Error("Selected team was not found.");
      error.statusCode = 400;
      throw error;
    }
    nextTeamId = teamId;
  }

  const fields = {};
  if (body.name !== undefined) {
    const name = String(body.name || "").trim();
    if (!name) {
      const error = new Error("Queue name is required.");
      error.statusCode = 400;
      throw error;
    }
    fields.name = name;
  }
  if (body.teamId !== undefined) fields.teamId = nextTeamId;
  if (body.status !== undefined) {
    fields.status = body.status === "inactive" ? "inactive" : "active";
  }

  await repo.updateQueue(pool, customerUser.organizationId, id, fields);

  if (body.teamId !== undefined && nextTeamId !== existing.team_id) {
    // Drop agents who no longer belong to the new team.
    const team = await orgRepo.getTeamById(pool, customerUser.organizationId, nextTeamId);
    const currentAgents = await repo.listQueueAgents(pool, id);
    const users = await orgRepo.listUsers(pool, customerUser.organizationId);
    const usersById = new Map(users.map((user) => [user.id, user]));
    const kept = currentAgents
      .filter((agent) => userBelongsToTeam(usersById.get(agent.user_id), team))
      .map((agent) => ({
        userId: agent.user_id,
        handlesCalls: agent.handles_calls,
        callType: agent.call_type,
        handlesEmail: agent.handles_email,
        handlesChat: agent.handles_chat,
        handlesWhatsapp: agent.handles_whatsapp,
        handlesInstagram: agent.handles_instagram,
        handlesFacebook: agent.handles_facebook,
        emailConcurrency: agent.email_concurrency,
        chatConcurrency: agent.chat_concurrency,
        whatsappConcurrency: agent.whatsapp_concurrency,
        instagramConcurrency: agent.instagram_concurrency,
        facebookConcurrency: agent.facebook_concurrency,
      }));
    await repo.replaceQueueAgents(pool, id, kept);
  }

  const agents = await repo.listQueueAgents(pool, id);
  return mapQueue(
    await repo.getQueueById(pool, customerUser.organizationId, id),
    agents,
  );
}

export async function removeQueue(customerUser, id) {
  assertOrgAdmin(customerUser);
  await assertCcaasPurchased(customerUser.organizationId);
  assertQueueId(id);
  const ok = await repo.deleteQueue(pool, customerUser.organizationId, id);
  if (!ok) {
    const error = new Error("Queue not found.");
    error.statusCode = 404;
    throw error;
  }
}

export async function replaceQueueAgents(customerUser, id, body) {
  assertOrgAdmin(customerUser);
  await assertCcaasPurchased(customerUser.organizationId);
  assertQueueId(id);

  const queue = await repo.getQueueById(pool, customerUser.organizationId, id);
  if (!queue) {
    const error = new Error("Queue not found.");
    error.statusCode = 404;
    throw error;
  }
  const team = await orgRepo.getTeamById(pool, customerUser.organizationId, queue.team_id);
  if (!team) {
    const error = new Error("Queue team was not found.");
    error.statusCode = 400;
    throw error;
  }

  const agents = normalizeAgentsPayload(body?.agents);
  await validateAgentsForQueue(customerUser.organizationId, team, agents, id);
  await repo.replaceQueueAgents(pool, id, agents);
  const assigned = await repo.listQueueAgents(pool, id);
  return mapQueue(await repo.getQueueById(pool, customerUser.organizationId, id), assigned);
}

export async function listCcaasEligibleUsers(customerUser) {
  await assertCcaasPurchased(customerUser.organizationId);
  const users = await orgRepo.listUsers(pool, customerUser.organizationId);
  const assignments = await repo.listAgentQueueAssignments(pool, customerUser.organizationId);
  const assignmentByUser = new Map(assignments.map((row) => [row.user_id, row]));

  return users
    .filter((user) => userHasCcaasAccess(user))
    .map((user) => {
      const assignment = assignmentByUser.get(user.id);
      return {
        id: user.id,
        firstName: user.first_name || "",
        lastName: user.last_name || "",
        workEmail: user.work_email || "",
        teamId: user.team_id || null,
        status: user.status || "active",
        assignedQueueId: assignment?.queue_id || null,
        assignedQueueName: assignment?.queue_name || null,
      };
    });
}
