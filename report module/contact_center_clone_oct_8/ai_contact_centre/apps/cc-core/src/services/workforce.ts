import { Prisma, type PrismaClient } from "@ai-contact-center/db-cc";
import type { DbClient } from "../lib/rls.js";
import { PRESENCE_STATE_SINCE_SQL } from "../lib/presence-state-since-sql.js";
import { z } from "zod";

import { serializeEntityId, toDbId } from "../lib/id-schema.js";
import { fetchActiveAuthSessionEmails } from "./auth-sessions.js";
import type { PresenceState } from "./presence.js";
import { resolveAgentPresenceState } from "./presence.js";
import { isLoggedInPresenceState } from "./presence-cache.js";

const statusSchema = z.enum(["active", "inactive"]);

export const updateAgentSkillsSchema = z.object({
  skills: z.array(z.string().trim().min(1)).default([]),
});

export const businessHoursInputSchema = z.object({
  name: z.string().trim().min(1),
  description: z.string().trim().nullable().optional(),
  timezone: z.string().trim().min(1).default("Asia/Kolkata"),
  status: statusSchema.default("active"),
  openTime: z.string().nullable().optional(),
  closeTime: z.string().nullable().optional(),
  workingDays: z.array(z.string()).default([]),
});

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  return [];
}

function fallbackPresenceState(agent: {
  presenceState: string | null;
  presenceStatus: string | null;
}): PresenceState {
  const raw = agent.presenceState ?? agent.presenceStatus;
  if (raw === "available" || raw === "ready") return "ready";
  if (
    raw === "busy" ||
    raw === "not_ready" ||
    raw === "break" ||
    raw === "away" ||
    raw === "after_contact_work" ||
    raw === "offline"
  ) {
    return raw;
  }
  return "offline";
}

async function resolveMonitoringPresence(
  prisma: DbClient,
  organizationId: string,
  agent: {
    id: string;
    presenceState: string | null;
    presenceStatus: string | null;
  },
): Promise<PresenceState> {
  return (
    (await resolveAgentPresenceState(prisma, organizationId, agent.id)) ??
    fallbackPresenceState(agent)
  );
}

function formatTime(value: Date | string | null | undefined): string | null {
  if (value == null) return null;
  if (value instanceof Date) {
    const hours = value.getUTCHours().toString().padStart(2, "0");
    const minutes = value.getUTCMinutes().toString().padStart(2, "0");
    return `${hours}:${minutes}`;
  }
  return value.length === 5 ? `${value}:00` : value;
}

function parseTime(value: string | null | undefined): Date | null {
  if (!value) return null;
  const normalized = value.length === 5 ? `${value}:00` : value;
  return new Date(`1970-01-01T${normalized}Z`);
}

export async function listWorkforceAgents(prisma: DbClient, organizationId: string) {
  const rows = await prisma.setup_users.findMany({
    where: { organization_id: toDbId(organizationId) },
    orderBy: [{ first_name: "asc" }, { last_name: "asc" }],
    select: {
      id: true,
      first_name: true,
      last_name: true,
      work_email: true,
      team_id: true,
      skills: true,
      status: true,
      shift_types: true,
      setup_teams: { select: { name: true } },
      setup_ccaas_queue_agents: {
        select: {
          setup_ccaas_queues: { select: { id: true, name: true } },
        },
      },
    },
  });

  return {
    agents: rows.map((row) => ({
      id: serializeEntityId(row.id),
      firstName: row.first_name,
      lastName: row.last_name,
      workEmail: row.work_email,
      teamId: row.team_id ? serializeEntityId(row.team_id) : null,
      teamName: row.setup_teams?.name ?? null,
      skill: asStringArray(row.skills)[0] ?? null,
      skills: asStringArray(row.skills),
      status: row.status as "active" | "inactive",
      shiftTypes: asStringArray(row.shift_types),
      queueId: row.setup_ccaas_queue_agents[0]?.setup_ccaas_queues.id
        ? serializeEntityId(row.setup_ccaas_queue_agents[0].setup_ccaas_queues.id)
        : null,
      queueName: row.setup_ccaas_queue_agents[0]?.setup_ccaas_queues.name ?? null,
    })),
  };
}

export async function updateAgentSkills(
  prisma: DbClient,
  organizationId: string,
  userId: string,
  skills: string[],
) {
  const existing = await prisma.setup_users.findFirst({
    where: { id: toDbId(userId), organization_id: toDbId(organizationId) },
    select: { id: true },
  });
  if (!existing) {
    throw Object.assign(new Error("Agent not found"), { status: 404 });
  }

  const updated = await prisma.setup_users.update({
    where: { id: toDbId(userId) },
    data: {
      skills,
      updated_at: new Date(),
    },
    select: {
      id: true,
      first_name: true,
      last_name: true,
      work_email: true,
      skills: true,
    },
  });

  const normalizedSkills = asStringArray(updated.skills);
  return {
    agent: {
      id: serializeEntityId(updated.id),
      firstName: updated.first_name,
      lastName: updated.last_name,
      workEmail: updated.work_email,
      skills: normalizedSkills,
      skill: normalizedSkills[0] ?? null,
    },
  };
}

export async function listWorkforceShifts(prisma: DbClient, organizationId: string) {
  const hours = await prisma.setup_business_hours.findMany({
    where: { organization_id: toDbId(organizationId) },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      description: true,
      timezone: true,
      status: true,
      open_time: true,
      close_time: true,
      working_days: true,
    },
  });

  const shifts = await prisma.setup_business_hour_shifts.findMany({
    where: { setup_business_hours: { organization_id: toDbId(organizationId) } },
    orderBy: [{ business_hours_id: "asc" }, { shift_type: "asc" }],
  });

  const shiftsByHours = new Map<string, typeof shifts>();
  for (const shift of shifts) {
    const key = serializeEntityId(shift.business_hours_id);
    const list = shiftsByHours.get(key) ?? [];
    list.push(shift);
    shiftsByHours.set(key, list);
  }

  return {
    schedules: hours.map((row) => ({
      id: serializeEntityId(row.id),
      name: row.name,
      description: row.description,
      timezone: row.timezone ?? "Asia/Kolkata",
      status: row.status as "active" | "inactive",
      openTime: formatTime(row.open_time),
      closeTime: formatTime(row.close_time),
      workingDays: asStringArray(row.working_days),
      shifts: (shiftsByHours.get(serializeEntityId(row.id)) ?? []).map((shift) => ({
        id: serializeEntityId(shift.id),
        shiftType: shift.shift_type,
        dayOfWeek: shift.day_of_week,
        startTime: formatTime(shift.start_time) ?? "",
        endTime: formatTime(shift.end_time) ?? "",
      })),
    })),
  };
}

export async function createBusinessHours(
  prisma: DbClient,
  organizationId: string,
  input: z.infer<typeof businessHoursInputSchema>,
) {
  const parsed = businessHoursInputSchema.parse(input);
  const created = await prisma.setup_business_hours.create({
    data: {
      organization_id: toDbId(organizationId),
      name: parsed.name,
      description: parsed.description ?? null,
      timezone: parsed.timezone,
      status: parsed.status,
      open_time: parseTime(parsed.openTime ?? null),
      close_time: parseTime(parsed.closeTime ?? null),
      working_days: parsed.workingDays,
    },
    select: { id: true, name: true },
  });
  return { schedule: created };
}

async function applyActiveSessionNotReady<T extends { presence: string; email?: string | null }>(
  rootPrisma: PrismaClient | undefined,
  agents: T[],
): Promise<T[]> {
  if (!rootPrisma) return agents;
  const offlineEmails = agents
    .filter((agent) => agent.presence === "offline" && agent.email?.trim())
    .map((agent) => agent.email!);
  const loggedInEmails = await fetchActiveAuthSessionEmails(rootPrisma, offlineEmails);
  if (loggedInEmails.size === 0) return agents;
  return agents.map((agent) => {
    if (
      agent.presence === "offline" &&
      agent.email &&
      loggedInEmails.has(agent.email.trim().toLowerCase())
    ) {
      return { ...agent, presence: "not_ready" };
    }
    return agent;
  });
}

export async function listPresence(
  prisma: DbClient,
  organizationId: string,
  rootPrisma?: PrismaClient,
) {
  const rows = await prisma.$queryRaw<
    Array<{
      id: string | bigint;
      setup_user_id: string | bigint | null;
      display_name: string;
      email: string | null;
      agent_status: string;
      presence_status: string | null;
      presence_state: string | null;
      presence_updated_at: Date | null;
      queue_id: string | bigint | null;
      queue_name: string | null;
      employee_id: string | null;
      work_email: string | null;
      first_name: string | null;
      last_name: string | null;
      primary_language: string | null;
      secondary_language: string | null;
      location_id: string | null;
      city: string | null;
      state: string | null;
      country: string | null;
      user_status: string | null;
      skills: unknown;
      shift_types: unknown;
      team_name: string | null;
    }>
  >`
    SELECT
      a.id,
      a.setup_user_id,
      a.display_name,
      a.email,
      a.status AS agent_status,
      ap.status AS presence_status,
      ap.presence_state,
      ${Prisma.raw(`${PRESENCE_STATE_SINCE_SQL} AS presence_updated_at`)},
      q.id AS queue_id,
      q.name AS queue_name,
      su.employee_id,
      su.work_email,
      su.first_name,
      su.last_name,
      su.primary_language,
      su.secondary_language,
      su.location_id,
      su.city,
      su.state,
      su.country,
      su.status AS user_status,
      su.skills,
      su.shift_types,
      st.name AS team_name
    FROM ccass.agents a
    LEFT JOIN ccass.agent_presence ap
      ON ap.agent_id = a.id
     AND ap.organization_id = a.organization_id
    LEFT JOIN ccass.queue_members qm
      ON qm.agent_id = a.id
    LEFT JOIN ccass.queues q
      ON q.id = qm.queue_id
     AND q.organization_id = a.organization_id
    LEFT JOIN accounts.setup_users su
      ON su.id = a.setup_user_id
    LEFT JOIN accounts.setup_teams st
      ON st.id = su.team_id
    WHERE a.organization_id = ${organizationId}::bigint
    ORDER BY a.display_name ASC, q.name ASC NULLS LAST
  `;

  const agentsById = new Map<
    string,
    {
      id: string;
      setupUserId: string | null;
      displayName: string;
      email: string | null;
      agentStatus: string;
      presenceStatus: string | null;
      presenceState: string | null;
      presenceUpdatedAt: Date | null;
      queueIds: string[];
      queueNames: string[];
      employeeId: string | null;
      workEmail: string | null;
      firstName: string | null;
      lastName: string | null;
      primaryLanguage: string | null;
      secondaryLanguage: string | null;
      locationId: string | null;
      city: string | null;
      state: string | null;
      country: string | null;
      userStatus: string | null;
      skills: string[];
      shiftTypes: string[];
      teamName: string | null;
    }
  >();

  for (const row of rows) {
    const agentId = serializeEntityId(row.id);
    let agent = agentsById.get(agentId);
    if (!agent) {
      agent = {
        id: agentId,
        setupUserId: row.setup_user_id == null ? null : serializeEntityId(row.setup_user_id),
        displayName: row.display_name,
        email: row.email,
        agentStatus: row.agent_status,
        presenceStatus: row.presence_status,
        presenceState: row.presence_state,
        presenceUpdatedAt: row.presence_updated_at,
        queueIds: [],
        queueNames: [],
        employeeId: row.employee_id,
        workEmail: row.work_email,
        firstName: row.first_name,
        lastName: row.last_name,
        primaryLanguage: row.primary_language,
        secondaryLanguage: row.secondary_language,
        locationId: row.location_id,
        city: row.city,
        state: row.state,
        country: row.country,
        userStatus: row.user_status,
        skills: asStringArray(row.skills),
        shiftTypes: asStringArray(row.shift_types),
        teamName: row.team_name,
      };
      agentsById.set(agentId, agent);
    }
    if (row.queue_id != null && row.queue_name) {
      const queueId = serializeEntityId(row.queue_id);
      if (!agent.queueIds.includes(queueId)) {
        agent.queueIds.push(queueId);
        agent.queueNames.push(row.queue_name);
      }
    }
  }

  const agents = await applyActiveSessionNotReady(
    rootPrisma,
    await Promise.all(
      [...agentsById.values()].map(async (agent) => {
        const presence = await resolveMonitoringPresence(prisma, organizationId, agent);
        const location = [agent.city, agent.state, agent.country].filter(Boolean).join(", ");
        return {
          id: agent.setupUserId ?? agent.id,
          agentId: agent.id,
          name: agent.displayName,
          email: agent.email,
          workEmail: agent.workEmail,
          employeeId: agent.employeeId,
          firstName: agent.firstName,
          lastName: agent.lastName,
          teamName: agent.teamName,
          skills: agent.skills,
          shiftTypes: agent.shiftTypes,
          primaryLanguage: agent.primaryLanguage,
          secondaryLanguage: agent.secondaryLanguage,
          location: location || agent.locationId,
          accountStatus: agent.userStatus,
          agentStatus: agent.agentStatus,
          presenceUpdatedAt: agent.presenceUpdatedAt?.toISOString() ?? null,
          queueId: agent.queueIds[0] ?? null,
          queueName: agent.queueNames[0] ?? null,
          queueIds: agent.queueIds,
          presence,
        };
      }),
    ),
  );

  return {
    agents: agents.map((agent) => ({
      ...agent,
      loggedIn: isLoggedInPresenceState(agent.presence),
    })),
  };
}
