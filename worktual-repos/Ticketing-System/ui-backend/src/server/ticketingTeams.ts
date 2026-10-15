/**
 * Ticketing-owned teams (agent_queues + agent_queue_members).
 * MyAccount supplies users/roles/skills only — never accounts.setup_teams.
 */
import { query } from "./db";
import {
  listAssignableAgents,
  type AssignableAgent,
} from "./accountsSync";

export type TicketingTeam = {
  id: string;
  organizationId: string;
  name: string;
  description: string;
  status: string;
  memberIds: string[];
  members: AssignableAgent[];
  openTickets: number;
  assigned: number;
  slaStatus: "At Risk" | "On Track";
};

const STAFF_ROLES = new Set(["agent", "resolver", "admin"]);

/**
 * Map a member token from create/update team payloads to a staff id.
 * Accepts roster id, work email, or display name — Express identity resolution
 * (not NLP keyword routing). Ambiguous name matches return undefined.
 */
export function resolveAgentIdByName(
  agents: AssignableAgent[],
  needle: string
): string | undefined {
  const raw = needle.trim();
  const q = raw.toLowerCase();
  if (!q) return undefined;

  const byId = agents.find((a) => a.id === raw || a.id.toLowerCase() === q);
  if (byId) return byId.id;

  const bySetup = agents.find(
    (a) =>
      a.setupUserId &&
      (a.setupUserId === raw || a.setupUserId.toLowerCase() === q)
  );
  if (bySetup) return bySetup.id;

  const byEmail = agents.find((a) => a.email.trim().toLowerCase() === q);
  if (byEmail) return byEmail.id;

  const exact = agents.find((a) => a.name.toLowerCase() === q);
  if (exact) return exact.id;
  const firsts = agents.filter(
    (a) => a.name.toLowerCase().split(/\s+/)[0] === q
  );
  if (firsts.length === 1) return firsts[0].id;
  const lasts = agents.filter((a) => {
    const parts = a.name.toLowerCase().split(/\s+/);
    return parts[parts.length - 1] === q;
  });
  if (lasts.length === 1) return lasts[0].id;
  const contains = agents.filter((a) => a.name.toLowerCase().includes(q));
  if (contains.length === 1) return contains[0].id;
  return undefined;
}

/** Resolve write tokens to ticketing.agents.id. Invented numeric ids are leftover. */
export function collectResolvedMemberIds(
  agents: AssignableAgent[],
  input: { memberIds?: string[]; members?: string[] }
): {
  resolved: string[];
  unresolvedIds: string[];
  unresolvedNames: string[];
} {
  const staff = agents.filter((r) =>
    STAFF_ROLES.has(String(r.role || "").toLowerCase())
  );
  const idTokens = [
    ...new Set(
      (input.memberIds || []).map((id) => String(id).trim()).filter(Boolean)
    ),
  ];
  const nameTokens = [
    ...new Set(
      (input.members || []).map((n) => String(n).trim()).filter(Boolean)
    ),
  ];
  const unresolvedIds: string[] = [];
  const unresolvedNames: string[] = [];
  const fromIds: string[] = [];
  const fromNames: string[] = [];
  for (const token of idTokens) {
    const id = resolveAgentIdByName(staff, token);
    if (!id) unresolvedIds.push(token);
    else if (!fromIds.includes(id)) fromIds.push(id);
  }
  for (const token of nameTokens) {
    const id = resolveAgentIdByName(staff, token);
    if (!id) unresolvedNames.push(token);
    else if (!fromNames.includes(id)) fromNames.push(id);
  }
  // Names are the people the user named. Conflicting LLM ids (another
  // teammate's agents.id) must not also be added.
  if (nameTokens.length) {
    return {
      resolved: fromNames,
      unresolvedIds: [],
      unresolvedNames,
    };
  }
  return { resolved: fromIds, unresolvedIds, unresolvedNames };
}

export async function listTicketingTeams(orgId: string): Promise<TicketingTeam[]> {
  const { rows: teamRows } = await query(
    `SELECT id::text AS id,
            organization_id::text AS organization_id,
            queue_name AS name,
            COALESCE(description, '') AS description,
            type,
            open_tickets,
            assigned,
            sla_status
     FROM agent_queues
     WHERE organization_id = $1::bigint
     ORDER BY queue_name`,
    [orgId]
  );

  if (!teamRows.length) return [];

  const agents = await listAssignableAgents(orgId);
  const byId = new Map(agents.map((a) => [a.id, a]));

  const { rows: memberRows } = await query(
    `SELECT queue_id::text AS queue_id, user_id::text AS user_id
     FROM agent_queue_members
     WHERE organization_id = $1::bigint`,
    [orgId]
  );

  const membersByQueue = new Map<string, string[]>();
  for (const m of memberRows) {
    const qid = String(m.queue_id);
    const uid = String(m.user_id);
    if (!membersByQueue.has(qid)) membersByQueue.set(qid, []);
    membersByQueue.get(qid)!.push(uid);
  }

  const { rows: statsRows } = await query(
    `SELECT
       COALESCE(queue_id::text, '') AS team_id,
       COALESCE(queue_name, '') AS team_name,
       COUNT(*) FILTER (
         WHERE status IS DISTINCT FROM 'Resolved'
       )::int AS open_tickets,
       COUNT(*) FILTER (
         WHERE assignee_id IS NOT NULL
           AND COALESCE(assignee_name, '') NOT IN ('', 'Unassigned')
           AND status IS DISTINCT FROM 'Resolved'
       )::int AS assigned,
       COUNT(*) FILTER (
         WHERE due_at IS NOT NULL
           AND due_at < NOW()
           AND status IS DISTINCT FROM 'Resolved'
       )::int AS overdue
     FROM tickets
     WHERE organization_id = $1::bigint
     GROUP BY 1, 2`,
    [orgId]
  );

  const statsById = new Map<string, { open: number; assigned: number; overdue: number }>();
  const statsByName = new Map<string, { open: number; assigned: number; overdue: number }>();
  for (const s of statsRows) {
    const payload = {
      open: Number(s.open_tickets || 0),
      assigned: Number(s.assigned || 0),
      overdue: Number(s.overdue || 0),
    };
    if (s.team_id) statsById.set(String(s.team_id), payload);
    if (s.team_name) statsByName.set(String(s.team_name).toLowerCase(), payload);
  }

  return teamRows.map((t) => {
    const id = String(t.id);
    const name = String(t.name || "");
    const memberIds = membersByQueue.get(id) || [];
    const members = memberIds
      .map((uid) => byId.get(uid))
      .filter((a): a is AssignableAgent => Boolean(a));
    const stats =
      statsById.get(id) ||
      statsByName.get(name.toLowerCase()) ||
      { open: 0, assigned: 0, overdue: 0 };
    return {
      id,
      organizationId: String(t.organization_id),
      name,
      description: String(t.description || ""),
      status: "active",
      memberIds,
      members,
      openTickets: stats.open,
      assigned: stats.assigned,
      slaStatus: stats.overdue > 0 ? "At Risk" : "On Track",
    };
  });
}

export async function resolveTicketingTeam(
  orgId: string,
  teamNameOrId: string
): Promise<TicketingTeam | null> {
  const wanted = String(teamNameOrId || "").trim();
  if (!wanted) return null;
  const teams = await listTicketingTeams(orgId);
  const byId = teams.find((t) => t.id === wanted);
  if (byId) return byId;
  const lower = wanted.toLowerCase();
  return teams.find((t) => t.name.toLowerCase() === lower) || null;
}

export async function userTeamIds(orgId: string, userId: string): Promise<string[]> {
  const { rows } = await query(
    `SELECT queue_id::text AS queue_id
     FROM agent_queue_members
     WHERE organization_id = $1::bigint AND user_id = $2::bigint`,
    [orgId, userId]
  );
  return rows.map((r) => String(r.queue_id));
}

async function validateMemberIds(
  orgId: string,
  memberIds: string[]
): Promise<string[]> {
  if (!memberIds.length) return [];
  const unique = [...new Set(memberIds.map((id) => String(id).trim()).filter(Boolean))];
  const rows = await listAssignableAgents(orgId);
  const staff = rows.filter((r) =>
    STAFF_ROLES.has(String(r.role || "").toLowerCase())
  );
  const resolved: string[] = [];
  const bad: string[] = [];
  const seen = new Set<string>();
  for (const token of unique) {
    const id = resolveAgentIdByName(staff, token);
    if (!id) {
      bad.push(token);
      continue;
    }
    if (seen.has(id)) continue;
    seen.add(id);
    resolved.push(id);
  }
  if (bad.length) {
    throw Object.assign(
      new Error(`Invalid team members: ${bad.join(", ")}`),
      { status: 400 }
    );
  }
  return resolved;
}

async function replaceMembers(
  orgId: string,
  queueId: string,
  memberIds: string[]
): Promise<void> {
  await query(`DELETE FROM agent_queue_members WHERE queue_id = $1::bigint`, [queueId]);
  for (const userId of memberIds) {
    await query(
      `INSERT INTO agent_queue_members (organization_id, queue_id, user_id)
       VALUES ($1::bigint, $2::bigint, $3::bigint)
       ON CONFLICT (queue_id, user_id) DO NOTHING`,
      [orgId, queueId, userId]
    );
  }
}

export async function createTicketingTeam(input: {
  orgId: string;
  name: string;
  description: string;
  memberIds?: string[];
}): Promise<TicketingTeam> {
  const name = String(input.name || "").trim();
  const description = String(input.description || "").trim();
  if (name.length < 2) {
    throw Object.assign(new Error("Team name is required (min 2 characters)."), {
      status: 400,
    });
  }
  if (!description) {
    throw Object.assign(new Error("Team description is required."), { status: 400 });
  }
  const memberIds = await validateMemberIds(input.orgId, input.memberIds || []);

  const duplicate = await resolveTicketingTeam(input.orgId, name);
  if (duplicate) {
    throw Object.assign(
      new Error(
        `A team named “${duplicate.name}” already exists. Choose a different name.`
      ),
      { status: 409 }
    );
  }

  let row: { id: string };
  try {
    const inserted = await query(
      `INSERT INTO agent_queues (organization_id, queue_name, description, type)
       VALUES ($1::bigint, $2, $3, 'Shared')
       RETURNING id::text AS id`,
      [input.orgId, name, description]
    );
    row = inserted.rows[0] as { id: string };
  } catch (err) {
    const msg = (err as Error).message || "";
    if (msg.includes("unique") || msg.includes("duplicate")) {
      throw Object.assign(
        new Error("A team with this name already exists. Choose a different name."),
        { status: 409 }
      );
    }
    throw err;
  }

  await replaceMembers(input.orgId, row.id, memberIds);
  const team = await resolveTicketingTeam(input.orgId, row.id);
  if (!team) throw new Error("Failed to load created team");
  return team;
}

export async function updateTicketingTeam(input: {
  orgId: string;
  teamId: string;
  name?: string;
  description?: string;
  memberIds?: string[];
}): Promise<TicketingTeam> {
  const existing = await resolveTicketingTeam(input.orgId, input.teamId);
  if (!existing) {
    throw Object.assign(new Error("Team not found."), { status: 404 });
  }

  const name =
    input.name !== undefined ? String(input.name).trim() : existing.name;
  const description =
    input.description !== undefined
      ? String(input.description).trim()
      : existing.description;

  if (name.length < 2) {
    throw Object.assign(new Error("Team name is required (min 2 characters)."), {
      status: 400,
    });
  }
  if (!description) {
    throw Object.assign(new Error("Team description is required."), { status: 400 });
  }

  const clash = await resolveTicketingTeam(input.orgId, name);
  if (clash && clash.id !== existing.id) {
    throw Object.assign(
      new Error(
        `A team named “${clash.name}” already exists. Choose a different name.`
      ),
      { status: 409 }
    );
  }

  try {
    await query(
      `UPDATE agent_queues
       SET queue_name = $3,
           description = $4,
           updated_at = NOW()
       WHERE id = $1::bigint AND organization_id = $2::bigint`,
      [existing.id, input.orgId, name, description]
    );
  } catch (err) {
    const msg = (err as Error).message || "";
    if (msg.includes("unique") || msg.includes("duplicate")) {
      throw Object.assign(
        new Error("A team with this name already exists. Choose a different name."),
        { status: 409 }
      );
    }
    throw err;
  }

  if (input.memberIds !== undefined) {
    const memberIds = await validateMemberIds(input.orgId, input.memberIds);
    await replaceMembers(input.orgId, existing.id, memberIds);
  }

  // Keep ticket queue_name in sync when renamed
  if (name !== existing.name) {
    await query(
      `UPDATE tickets
       SET queue_name = $3
       WHERE organization_id = $1::bigint AND queue_id = $2::bigint`,
      [input.orgId, existing.id, name]
    );
  }

  const team = await resolveTicketingTeam(input.orgId, existing.id);
  if (!team) throw new Error("Failed to load updated team");
  return team;
}

export async function deleteTicketingTeam(
  orgId: string,
  teamId: string
): Promise<void> {
  const existing = await resolveTicketingTeam(orgId, teamId);
  if (!existing) {
    throw Object.assign(new Error("Team not found."), { status: 404 });
  }
  await query(
    `UPDATE tickets
     SET queue_id = NULL, queue_name = NULL
     WHERE organization_id = $1::bigint AND queue_id = $2::bigint`,
    [orgId, existing.id]
  );
  await query(
    `DELETE FROM agent_queues WHERE id = $1::bigint AND organization_id = $2::bigint`,
    [existing.id, orgId]
  );
}

export function teamToQueuePayload(t: TicketingTeam) {
  return {
    id: t.id,
    external_id: t.id,
    queue_name: t.name,
    type: "Shared" as const,
    open_tickets: t.openTickets,
    assigned: t.assigned,
    sla_status: t.slaStatus,
    description: t.description,
    members: t.members.map((m) => m.name),
    memberDetails: t.members.map((m) => ({
      id: m.id,
      name: m.name,
      email: m.email,
      role: m.role,
      skills: m.skills,
    })),
    memberIds: t.memberIds,
  };
}

/**
 * Reassign target allowed?
 * Admin → agents or resolvers (any team)
 * Agent → agents or resolvers (any team)
 * Resolver → resolvers sharing a team with actor
 */
export async function assertReassignTargetAllowed(input: {
  orgId: string;
  actorId: string;
  actorRole: string;
  targetUserId: string;
}): Promise<{ id: string; name: string; role: string }> {
  const roster = await listAssignableAgents(input.orgId);
  const target = roster.find((user) => user.id === input.targetUserId);
  if (!target) {
    throw Object.assign(new Error("Target user not found."), { status: 400 });
  }
  const targetRole = String(target.role || "").toLowerCase();
  const actorRole = String(input.actorRole || "").toLowerCase();

  if (actorRole === "admin" || actorRole === "agent") {
    if (targetRole !== "agent" && targetRole !== "resolver") {
      throw Object.assign(
        new Error("You can reassign only to agents or resolvers."),
        { status: 403 }
      );
    }
    return { id: String(target.id), name: String(target.name), role: targetRole };
  }

  if (actorRole === "resolver") {
    if (targetRole !== "resolver") {
      throw Object.assign(
        new Error("Resolvers can reassign only to resolvers on their teams."),
        { status: 403 }
      );
    }
    const actorTeams = await userTeamIds(input.orgId, input.actorId);
    const targetTeams = await userTeamIds(input.orgId, input.targetUserId);
    const share = actorTeams.some((id) => targetTeams.includes(id));
    if (!share) {
      throw Object.assign(
        new Error("Resolvers can reassign only to resolvers on their teams."),
        { status: 403 }
      );
    }
    return { id: String(target.id), name: String(target.name), role: targetRole };
  }

  throw Object.assign(new Error("Insufficient permissions to reassign."), {
    status: 403,
  });
}

export async function filterRosterForActor(input: {
  orgId: string;
  actorId: string;
  actorRole: string;
  teamFilter?: string;
}): Promise<AssignableAgent[]> {
  const agents = await listAssignableAgents(input.orgId);
  const teams = await listTicketingTeams(input.orgId);
  const role = String(input.actorRole || "").toLowerCase();

  let pool = agents;

  if (input.teamFilter?.trim()) {
    const team = await resolveTicketingTeam(input.orgId, input.teamFilter.trim());
    if (!team) return [];
    const idSet = new Set(team.memberIds);
    pool = agents.filter((a) => idSet.has(a.id));
  }

  if (role === "admin" || role === "agent") {
    return pool.filter((a) => {
      const r = String(a.role || "").toLowerCase();
      return r === "agent" || r === "resolver";
    });
  }

  if (role === "resolver") {
    const mine = await userTeamIds(input.orgId, input.actorId);
    if (!mine.length) return [];
    const idSet = new Set(
      teams.filter((t) => mine.includes(t.id)).flatMap((t) => t.memberIds)
    );
    return pool.filter(
      (a) =>
        String(a.role || "").toLowerCase() === "resolver" && idSet.has(a.id)
    );
  }

  return [];
}
