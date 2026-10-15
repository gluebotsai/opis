import type { DbClient } from "../lib/rls.js";
import { z } from "zod";
import { publishQueueToRouting, unpublishQueueFromRouting } from "./queue-publish.js";
import {
  agentSkillsFromUser,
  asStringArray,
  callDirectionFlagsFromAgent,
  mergeAgentSkillsForQueue,
} from "./queues-helpers.js";
import { entityIdSchema, serializeEntityId, toDbId, toDbIdList } from "../lib/id-schema.js";

const CONTACT_CENTER_PRODUCT_ID = "contact-center";

function contactCenterStaffAccessWhere(organizationId: string) {
  return {
    product_id: CONTACT_CENTER_PRODUCT_ID,
    organization_id: toDbId(organizationId),
    setup_roles: {
      OR: [
        { name: { equals: "Agent", mode: "insensitive" as const } },
        { name: { equals: "Admin", mode: "insensitive" as const } },
      ],
    },
  };
}

/**
 * Queue setup service — reads/writes accounts.setup_ccaas_* only.
 * Operational routing data is published separately into ccass (see queue-publish.ts).
 */

const shiftTypeSchema = z.string().trim().min(1, "Shift type is required").max(64);
const statusSchema = z.enum(["active", "inactive"]);
const callTypeSchema = z.enum(["inbound", "outbound", "both"]);

export const MISSED_CALLBACK_GRACE_MINUTES = [0, 5, 10, 15, 30] as const;
export type MissedCallbackGraceMinutes = (typeof MISSED_CALLBACK_GRACE_MINUTES)[number];

export const queueInputSchema = z.object({
  name: z.string().trim().min(1, "Queue name is required"),
  description: z
    .string()
    .trim()
    .nullable()
    .optional()
    .transform((value) => (value == null || value === "" ? null : value)),
  teamId: entityIdSchema,
  businessHoursId: z
    .string()
    .nullable()
    .optional()
    .transform((value) => (value == null || value.trim() === "" ? null : value)),
  shiftTypes: z.array(shiftTypeSchema).default([]),
  skills: z.array(z.string().trim().min(1)).default([]),
  status: statusSchema.default("active"),
  missedCallbackGraceMinutes: z
    .union([
      z.literal(0),
      z.literal(5),
      z.literal(10),
      z.literal(15),
      z.literal(30),
      z.null(),
    ])
    .optional()
    .nullable(),
});

export const queueAgentSchema = z.object({
  userId: entityIdSchema,
  shiftType: shiftTypeSchema.default("Regular"),
  handlesCalls: z.boolean(),
  handlesEmail: z.boolean(),
  handlesChat: z.boolean(),
  handlesWhatsapp: z.boolean(),
  handlesInstagram: z.boolean(),
  handlesFacebook: z.boolean(),
  chatConcurrency: z.number().int().min(1).max(20),
  emailConcurrency: z.number().int().min(1).max(20),
  socialConcurrency: z.number().int().min(1).max(20),
  whatsappConcurrency: z.number().int().min(1).max(20),
  instagramConcurrency: z.number().int().min(1).max(20),
  facebookConcurrency: z.number().int().min(1).max(20),
  callType: callTypeSchema,
});

export const listQueuesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
  teamId: entityIdSchema.optional(),
  status: statusSchema.optional(),
  sort: z.enum(["name", "updatedAt", "status"]).default("updatedAt"),
  order: z.enum(["asc", "desc"]).default("desc"),
});

export type QueueInput = z.infer<typeof queueInputSchema>;
export type QueueAgentInput = z.infer<typeof queueAgentSchema>;
export type ListQueuesQuery = z.infer<typeof listQueuesQuerySchema>;

type QueueRow = {
  id: string;
  name: string;
  description: string | null;
  team_id: string;
  status: string;
  created_at: Date;
  updated_at: Date;
  business_hours_id: string | null;
  shift_types: unknown;
  skills: unknown;
  missed_callback_grace_minutes: number | null;
  max_handle_minutes?: number;
  wrap_up_minutes?: number;
  max_wait_mode?: string;
  max_wait_minutes?: number | null;
  max_wait_callback?: boolean;
  max_wait_voicemail?: boolean;
  announcement_frequency_seconds?: number;
  announcement_slot_id?: string;
  announcement_audio_path?: string | null;
  announcement_audio_name?: string | null;
};

type AgentRow = {
  queue_id: string;
  user_id: string;
  shift_type: string;
  handles_calls: boolean;
  handles_email: boolean;
  handles_chat: boolean;
  handles_whatsapp: boolean;
  handles_instagram: boolean;
  handles_facebook: boolean;
  handles_social: boolean;
  chat_concurrency: number;
  email_concurrency: number;
  social_concurrency: number;
  whatsapp_concurrency: number;
  instagram_concurrency: number;
  facebook_concurrency: number;
  call_type: string;
  first_name: string | null;
  last_name: string | null;
  work_email: string | null;
};

function formatTime(value: Date | string | null | undefined): string | null {
  if (value == null) return null;
  if (value instanceof Date) {
    const hours = value.getUTCHours().toString().padStart(2, "0");
    const minutes = value.getUTCMinutes().toString().padStart(2, "0");
    return `${hours}:${minutes}`;
  }
  return value.length === 5 ? `${value}:00` : value;
}

function mapAgent(row: AgentRow) {
  return {
    userId: row.user_id,
    shiftType: row.shift_type as z.infer<typeof shiftTypeSchema>,
    handlesCalls: row.handles_calls,
    handlesEmail: row.handles_email,
    handlesChat: row.handles_chat,
    handlesWhatsapp: row.handles_whatsapp,
    handlesInstagram: row.handles_instagram,
    handlesFacebook: row.handles_facebook,
    chatConcurrency: row.chat_concurrency,
    emailConcurrency: row.email_concurrency,
    socialConcurrency: row.social_concurrency,
    whatsappConcurrency: row.whatsapp_concurrency,
    instagramConcurrency: row.instagram_concurrency,
    facebookConcurrency: row.facebook_concurrency,
    callType: row.call_type as "inbound" | "outbound" | "both",
    firstName: row.first_name,
    lastName: row.last_name,
    workEmail: row.work_email,
  };
}

function mapQueue(
  row: QueueRow,
  shiftTypes: string[],
  agents: ReturnType<typeof mapAgent>[] = [],
) {
  return {
    id: serializeEntityId(row.id),
    name: row.name,
    description: row.description,
    teamId: row.team_id,
    businessHoursId: row.business_hours_id != null ? serializeEntityId(row.business_hours_id) : null,
    shiftTypes: shiftTypes as z.infer<typeof shiftTypeSchema>[],
    skills: asStringArray(row.skills),
    status: row.status as "active" | "inactive",
    missedCallbackGraceMinutes: normalizeGraceMinutes(row.missed_callback_grace_minutes),
    maxHandleMinutes: row.max_handle_minutes ?? 10,
    wrapUpMinutes: row.wrap_up_minutes ?? 1,
    maxWaitMode: (row.max_wait_mode ?? "unlimited") as "unlimited" | "limited",
    maxWaitMinutes: row.max_wait_minutes ?? null,
    maxWaitCallback: row.max_wait_callback ?? false,
    maxWaitVoicemail: row.max_wait_voicemail ?? false,
    announcementFrequencySeconds: row.announcement_frequency_seconds ?? 30,
    announcementSlotId: row.announcement_slot_id ?? "queue_position",
    announcementAudioPath: row.announcement_audio_path ?? null,
    announcementAudioName: row.announcement_audio_name ?? null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    agents,
  };
}

export function normalizeGraceMinutes(
  value: number | null | undefined,
): MissedCallbackGraceMinutes | null {
  if (value == null) return null;
  if (value === 0) return 0;
  if (MISSED_CALLBACK_GRACE_MINUTES.includes(value as MissedCallbackGraceMinutes)) {
    return value as MissedCallbackGraceMinutes;
  }
  return null;
}

async function shiftTypesForBusinessHours(
  prisma: DbClient,
  businessHoursId: string | null,
): Promise<string[]> {
  if (!businessHoursId) return [];
  const rows = await prisma.setup_business_hour_shifts.findMany({
    where: { business_hours_id: toDbId(businessHoursId) },
    select: { shift_type: true },
    distinct: ["shift_type"],
    orderBy: { shift_type: "asc" },
  });
  return rows.map((row) => row.shift_type);
}

async function resolveBusinessHoursId(
  prisma: DbClient,
  organizationId: string,
  teamId: string,
  override: string | null | undefined,
): Promise<string | null> {
  if (override) {
    const hours = await prisma.setup_business_hours.findFirst({
      where: { id: toDbId(override), organization_id: toDbId(organizationId) },
      select: { id: true },
    });
    if (!hours) {
      throw Object.assign(new Error("Selected business hours were not found"), { status: 400 });
    }
    return override; // already validated string id
  }
  const team = await prisma.setup_teams.findFirst({
    where: { id: toDbId(teamId), organization_id: toDbId(organizationId) },
    select: { business_hours_id: true },
  });
  return team?.business_hours_id != null ? serializeEntityId(team.business_hours_id) : null;
}

export async function listTeams(prisma: DbClient, organizationId: string) {
  const rows = await prisma.setup_teams.findMany({
    where: { organization_id: toDbId(organizationId) },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      status: true,
      business_hours_id: true,
    },
  });

  return {
    teams: rows.map((row) => ({
      id: serializeEntityId(row.id),
      name: row.name,
      status: row.status as "active" | "inactive",
      businessHoursId: row.business_hours_id != null ? serializeEntityId(row.business_hours_id) : null,
    })),
  };
}

export async function listBusinessHours(prisma: DbClient, organizationId: string) {
  const hours = await prisma.setup_business_hours.findMany({
    where: { organization_id: toDbId(organizationId), status: "active" },
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
    orderBy: [{ business_hours_id: "asc" }, { shift_type: "asc" }, { day_of_week: "asc" }],
  });

  const shiftsByHours = new Map<string, typeof shifts>();
  for (const shift of shifts) {
    const list = shiftsByHours.get(serializeEntityId(shift.business_hours_id)) ?? [];
    list.push(shift);
    shiftsByHours.set(serializeEntityId(shift.business_hours_id), list);
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
        businessHoursId: serializeEntityId(shift.business_hours_id),
        shiftType: shift.shift_type,
        dayOfWeek: shift.day_of_week,
        endDayOfWeek: shift.end_day_of_week,
        startTime: formatTime(shift.start_time) ?? "",
        endTime: formatTime(shift.end_time) ?? "",
        crossesMidnight: shift.crosses_midnight,
        breakStartTime: formatTime(shift.break_start_time),
        breakEndTime: formatTime(shift.break_end_time),
        breakStartTime2: formatTime(shift.break_start_time_2),
        breakEndTime2: formatTime(shift.break_end_time_2),
      })),
    })),
  };
}

export async function listEligibleAgents(
  prisma: DbClient,
  organizationId: string,
  currentQueueId?: string,
) {
  const rows = await prisma.setup_users.findMany({
    where: {
      organization_id: toDbId(organizationId),
      status: "active",
      OR: [
        {
          setup_user_product_access: {
            some: contactCenterStaffAccessWhere(organizationId),
          },
        },
        ...(currentQueueId
          ? [
              {
                setup_ccaas_queue_agents: {
                  some: { queue_id: toDbId(currentQueueId) },
                },
              },
            ]
          : []),
      ],
    },
    orderBy: [{ first_name: "asc" }, { last_name: "asc" }],
    select: {
      id: true,
      first_name: true,
      last_name: true,
      work_email: true,
      team_id: true,
      skills: true,
      status: true,
      business_hours_id: true,
      shift_types: true,
      setup_ccaas_queue_agents: {
        where: {
          setup_ccaas_queues: {
            organization_id: toDbId(organizationId),
            ...(currentQueueId ? { id: { not: toDbId(currentQueueId) } } : {}),
          },
        },
        take: 1,
        select: {
          setup_ccaas_queues: {
            select: { id: true, name: true, status: true },
          },
        },
      },
    },
  });

  return {
    agents: rows.map((row) => {
      const skills = agentSkillsFromUser(row.skills, null);
      const otherQueue = row.setup_ccaas_queue_agents[0]?.setup_ccaas_queues;
      return {
        id: serializeEntityId(row.id),
        firstName: row.first_name,
        lastName: row.last_name,
        workEmail: row.work_email,
        teamId: row.team_id != null ? serializeEntityId(row.team_id) : null,
        skill: skills[0] ?? null,
        skills,
        status: row.status as "active" | "inactive",
        businessHoursId: row.business_hours_id != null ? serializeEntityId(row.business_hours_id) : null,
        shiftTypes: asStringArray(row.shift_types),
        currentQueueId: otherQueue ? serializeEntityId(otherQueue.id) : null,
        currentQueueName: otherQueue?.name ?? null,
        currentQueueStatus: otherQueue
          ? ((otherQueue.status === "inactive" ? "inactive" : "active") as "active" | "inactive")
          : null,
      };
    }),
  };
}

async function loadAgentsForQueues(prisma: DbClient, queueIds: string[]) {
  const agentsByQueue = new Map<string, ReturnType<typeof mapAgent>[]>();
  if (queueIds.length === 0) return agentsByQueue;

  const rows = await prisma.setup_ccaas_queue_agents.findMany({
    where: { queue_id: { in: toDbIdList(queueIds) } },
    orderBy: [{ shift_type: "asc" }, { created_at: "asc" }],
    include: {
      setup_users: {
        select: { first_name: true, last_name: true, work_email: true },
      },
    },
  });

  for (const row of rows) {
    const agentRow: AgentRow = {
      queue_id: serializeEntityId(row.queue_id),
      user_id: serializeEntityId(row.user_id),
      shift_type: row.shift_type,
      handles_calls: row.handles_calls,
      handles_email: row.handles_email,
      handles_chat: row.handles_chat,
      handles_whatsapp: row.handles_whatsapp,
      handles_instagram: row.handles_instagram,
      handles_facebook: row.handles_facebook,
      handles_social: row.handles_social,
      chat_concurrency: row.chat_concurrency,
      email_concurrency: row.email_concurrency,
      social_concurrency: row.social_concurrency,
      whatsapp_concurrency: row.whatsapp_concurrency,
      instagram_concurrency: row.instagram_concurrency,
      facebook_concurrency: row.facebook_concurrency,
      call_type: row.call_type,
      first_name: row.setup_users.first_name,
      last_name: row.setup_users.last_name,
      work_email: row.setup_users.work_email,
    };
    const list = agentsByQueue.get(serializeEntityId(row.queue_id)) ?? [];
    list.push(mapAgent(agentRow));
    agentsByQueue.set(serializeEntityId(row.queue_id), list);
  }
  return agentsByQueue;
}

function toQueueRow(row: {
  id: bigint;
  name: string;
  description: string | null;
  team_id: bigint;
  status: string;
  created_at: Date;
  updated_at: Date;
  business_hours_id: bigint | null;
  shift_types: unknown;
  skills: unknown;
  missed_callback_grace_minutes?: number | null;
  max_handle_minutes?: number;
  wrap_up_minutes?: number;
  max_wait_mode?: string;
  max_wait_minutes?: number | null;
  max_wait_callback?: boolean;
  max_wait_voicemail?: boolean;
  announcement_frequency_seconds?: number;
  announcement_slot_id?: string;
  announcement_audio_path?: string | null;
  announcement_audio_name?: string | null;
}): QueueRow {
  return {
    id: serializeEntityId(row.id),
    name: row.name,
    description: row.description,
    team_id: serializeEntityId(row.team_id),
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at,
    business_hours_id: row.business_hours_id != null ? serializeEntityId(row.business_hours_id) : null,
    shift_types: row.shift_types,
    skills: row.skills,
    missed_callback_grace_minutes: row.missed_callback_grace_minutes ?? null,
    max_handle_minutes: row.max_handle_minutes,
    wrap_up_minutes: row.wrap_up_minutes,
    max_wait_mode: row.max_wait_mode,
    max_wait_minutes: row.max_wait_minutes,
    max_wait_callback: row.max_wait_callback,
    max_wait_voicemail: row.max_wait_voicemail,
    announcement_frequency_seconds: row.announcement_frequency_seconds,
    announcement_slot_id: row.announcement_slot_id,
    announcement_audio_path: row.announcement_audio_path,
    announcement_audio_name: row.announcement_audio_name,
  };
}

async function loadQueueRows(
  prisma: DbClient,
  organizationId: string,
  options?: { id?: string; query?: ListQueuesQuery },
) {
  const query = options?.query;
  const where = {
    organization_id: toDbId(organizationId),
    ...(options?.id ? { id: toDbId(options.id) } : {}),
    ...(query?.teamId ? { team_id: toDbId(query.teamId) } : {}),
    ...(query?.status ? { status: query.status } : {}),
  };

  const orderBy =
    query?.sort === "name"
      ? { name: query.order }
      : query?.sort === "status"
        ? { status: query.order }
        : { updated_at: query?.order ?? "desc" };

  const rows = await prisma.setup_ccaas_queues.findMany({
    where,
    orderBy,
    ...(query && !options?.id
      ? {
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
        }
      : {}),
    select: {
      id: true,
      name: true,
      description: true,
      team_id: true,
      status: true,
      created_at: true,
      updated_at: true,
      business_hours_id: true,
      shift_types: true,
      skills: true,
      max_handle_minutes: true,
      wrap_up_minutes: true,
      max_wait_mode: true,
      max_wait_minutes: true,
      max_wait_callback: true,
      max_wait_voicemail: true,
      announcement_frequency_seconds: true,
      announcement_slot_id: true,
      announcement_audio_path: true,
      announcement_audio_name: true,
    },
  });

  return rows.map(toQueueRow);
}

async function loadGraceMinutesByQueueIds(
  prisma: DbClient,
  queueIds: string[],
): Promise<Map<string, number | null>> {
  const result = new Map<string, number | null>();
  if (queueIds.length === 0) return result;
  try {
    const rows = await prisma.$queryRaw<Array<{ id: bigint; grace: number | null }>>`
      SELECT id, missed_callback_grace_minutes AS grace
      FROM accounts.setup_ccaas_queues
      WHERE id = ANY(${toDbIdList(queueIds)}::bigint[])
    `;
    for (const row of rows) {
      result.set(serializeEntityId(row.id), row.grace);
    }
  } catch {
    // Column may be missing before migration; treat as Off.
  }
  return result;
}

async function countQueues(
  prisma: DbClient,
  organizationId: string,
  query?: ListQueuesQuery,
) {
  return prisma.setup_ccaas_queues.count({
    where: {
      organization_id: toDbId(organizationId),
      ...(query?.teamId ? { team_id: toDbId(query.teamId) } : {}),
      ...(query?.status ? { status: query.status } : {}),
    },
  });
}

async function hydrateQueues(prisma: DbClient, rows: QueueRow[]) {
  const agentsByQueue = await loadAgentsForQueues(
    prisma,
    rows.map((row) => row.id),
  );
  const graceByQueue = await loadGraceMinutesByQueueIds(
    prisma,
    rows.map((row) => row.id),
  );
  const queues = [];
  for (const row of rows) {
    const agents = agentsByQueue.get(row.id) ?? [];
    const persistedShifts = asStringArray(row.shift_types);
    let shiftTypes = persistedShifts;
    if (shiftTypes.length === 0 && agents.length > 0) {
      shiftTypes = [...new Set(agents.map((agent) => agent.shiftType))].sort();
    }
    if (shiftTypes.length === 0) {
      shiftTypes = await shiftTypesForBusinessHours(prisma, row.business_hours_id);
    }
    queues.push(
      mapQueue(
        {
          ...row,
          missed_callback_grace_minutes: graceByQueue.get(row.id) ?? null,
        },
        shiftTypes,
        agents,
      ),
    );
  }
  return queues;
}

async function persistQueueGraceMinutes(
  prisma: DbClient,
  queueId: string,
  grace: MissedCallbackGraceMinutes | null | undefined,
): Promise<void> {
  if (grace === undefined) return;
  try {
    await prisma.$executeRaw`
      UPDATE accounts.setup_ccaas_queues
      SET missed_callback_grace_minutes = ${grace},
          updated_at = NOW()
      WHERE id = ${queueId}::bigint
    `;
  } catch {
    // Grace column missing before migration.
  }
}

export async function listQueues(
  prisma: DbClient,
  organizationId: string,
  query?: ListQueuesQuery,
) {
  const parsed = query ? listQueuesQuerySchema.parse(query) : listQueuesQuerySchema.parse({});
  const [rows, total] = await Promise.all([
    loadQueueRows(prisma, organizationId, { query: parsed }),
    countQueues(prisma, organizationId, parsed),
  ]);
  return {
    queues: await hydrateQueues(prisma, rows),
    pagination: {
      page: parsed.page,
      pageSize: parsed.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / parsed.pageSize)),
    },
  };
}

export async function getQueue(prisma: DbClient, organizationId: string, id: string) {
  const rows = await loadQueueRows(prisma, organizationId, { id });
  if (rows.length === 0) {
    throw Object.assign(new Error("Queue not found"), { status: 404 });
  }
  const queues = await hydrateQueues(prisma, rows);
  const queue = queues[0];
  if (!queue) {
    throw Object.assign(new Error("Queue not found"), { status: 404 });
  }
  return { queue };
}

async function assertTeamInOrg(prisma: DbClient, organizationId: string, teamId: string) {
  const team = await prisma.setup_teams.findFirst({
    where: { id: toDbId(teamId), organization_id: toDbId(organizationId) },
    select: { id: true },
  });
  if (!team) {
    throw Object.assign(new Error("Selected team was not found"), { status: 400 });
  }
}

export async function createQueue(
  prisma: DbClient,
  organizationId: string,
  input: QueueInput,
) {
  await assertTeamInOrg(prisma, organizationId, input.teamId);
  const businessHoursId = await resolveBusinessHoursId(
    prisma,
    organizationId,
    input.teamId,
    input.businessHoursId,
  );

  const description =
    input.description == null || input.description.trim() === ""
      ? null
      : input.description.trim();

  const created = await prisma.setup_ccaas_queues.create({
    data: {
      organization_id: toDbId(organizationId),
      name: input.name,
      description,
      team_id: toDbId(input.teamId),
      business_hours_id: businessHoursId != null ? toDbId(businessHoursId) : null,
      shift_types: input.shiftTypes,
      skills: input.skills,
      status: input.status,
    },
    select: {
      id: true,
      name: true,
      description: true,
      team_id: true,
      status: true,
      created_at: true,
      updated_at: true,
      business_hours_id: true,
      shift_types: true,
      skills: true,
      max_handle_minutes: true,
      wrap_up_minutes: true,
      max_wait_mode: true,
      max_wait_minutes: true,
      max_wait_callback: true,
      max_wait_voicemail: true,
      announcement_frequency_seconds: true,
      announcement_slot_id: true,
      announcement_audio_path: true,
      announcement_audio_name: true,
    },
  });

  const queues = await hydrateQueues(prisma, [toQueueRow(created)]);
  const queue = queues[0];
  if (!queue) {
    throw Object.assign(new Error("Failed to create queue"), { status: 500 });
  }
  await persistQueueGraceMinutes(prisma, queue.id, input.missedCallbackGraceMinutes);
  if (input.status === "active") {
    await publishQueueToRouting(prisma, organizationId, queue.id);
  }
  const { queue: refreshed } = await getQueue(prisma, organizationId, queue.id);
  return { queue: refreshed };
}

export async function updateQueue(
  prisma: DbClient,
  organizationId: string,
  id: string,
  patch: Partial<QueueInput>,
) {
  const { queue: currentQueue } = await getQueue(prisma, organizationId, id);
  const next = {
    name: patch.name ?? currentQueue.name,
    description:
      patch.description === undefined ? currentQueue.description : patch.description,
    teamId: patch.teamId ?? currentQueue.teamId,
    businessHoursId:
      patch.businessHoursId === undefined
        ? currentQueue.businessHoursId
        : patch.businessHoursId,
    shiftTypes: patch.shiftTypes ?? currentQueue.shiftTypes,
    skills: patch.skills ?? currentQueue.skills,
    status: patch.status ?? currentQueue.status,
    missedCallbackGraceMinutes:
      patch.missedCallbackGraceMinutes === undefined
        ? currentQueue.missedCallbackGraceMinutes
        : patch.missedCallbackGraceMinutes,
  };

  const parsed = queueInputSchema.parse(next);
  await assertTeamInOrg(prisma, organizationId, parsed.teamId);
  const businessHoursId = await resolveBusinessHoursId(
    prisma,
    organizationId,
    parsed.teamId,
    parsed.businessHoursId,
  );

  const description =
    parsed.description == null || parsed.description.trim() === ""
      ? null
      : parsed.description.trim();

  const existing = await prisma.setup_ccaas_queues.findFirst({
    where: { id: toDbId(id), organization_id: toDbId(organizationId) },
    select: { id: true },
  });
  if (!existing) {
    throw Object.assign(new Error("Queue not found"), { status: 404 });
  }

  const updated = await prisma.setup_ccaas_queues.update({
    where: { id: toDbId(id) },
    data: {
      name: parsed.name,
      description,
      team_id: toDbId(parsed.teamId),
      business_hours_id: businessHoursId != null ? toDbId(businessHoursId) : null,
      shift_types: parsed.shiftTypes,
      skills: parsed.skills,
      status: parsed.status,
      updated_at: new Date(),
    },
    select: {
      id: true,
      name: true,
      description: true,
      team_id: true,
      status: true,
      created_at: true,
      updated_at: true,
      business_hours_id: true,
      shift_types: true,
      skills: true,
      max_handle_minutes: true,
      wrap_up_minutes: true,
      max_wait_mode: true,
      max_wait_minutes: true,
      max_wait_callback: true,
      max_wait_voicemail: true,
      announcement_frequency_seconds: true,
      announcement_slot_id: true,
      announcement_audio_path: true,
      announcement_audio_name: true,
    },
  });

  const queues = await hydrateQueues(prisma, [toQueueRow(updated)]);
  const queue = queues[0];
  if (!queue) {
    throw Object.assign(new Error("Queue not found"), { status: 404 });
  }
  await persistQueueGraceMinutes(prisma, id, parsed.missedCallbackGraceMinutes);
  await publishQueueToRouting(prisma, organizationId, queue.id);
  const { queue: refreshed } = await getQueue(prisma, organizationId, id);
  return { queue: refreshed };
}

export async function deleteQueue(prisma: DbClient, organizationId: string, id: string) {
  const queueId = toDbId(id);
  const orgId = toDbId(organizationId);

  const existing = await prisma.setup_ccaas_queues.findFirst({
    where: { id: queueId, organization_id: orgId },
    select: { id: true },
  });
  if (!existing) {
    throw Object.assign(new Error("Queue not found"), { status: 404 });
  }

  // Clear setup references that use NoAction FKs and block queue deletion.
  await prisma.setup_webchat_configs.updateMany({
    where: { routing_queue_id: queueId },
    data: { routing_queue_id: null, updated_at: new Date() },
  });
  await prisma.setup_voice_dids.updateMany({
    where: { routing_queue_id: queueId, organization_id: orgId },
    data: { routing_queue_id: null, updated_at: new Date() },
  });

  await unpublishQueueFromRouting(prisma, id);

  const result = await prisma.setup_ccaas_queues.deleteMany({
    where: { id: queueId, organization_id: orgId },
  });
  if (result.count === 0) {
    throw Object.assign(new Error("Queue not found"), { status: 404 });
  }
}

export async function replaceQueueAgents(
  prisma: DbClient,
  organizationId: string,
  id: string,
  agents: QueueAgentInput[],
) {
  const { queue } = await getQueue(prisma, organizationId, id);
  const parsedAgents = agents.map((agent) => queueAgentSchema.parse(agent));
  const userIds = [...new Set(parsedAgents.map((agent) => agent.userId))];

  if (userIds.length > 0) {
    const users = await prisma.setup_users.findMany({
      where: {
        organization_id: toDbId(organizationId),
        id: { in: toDbIdList(userIds) },
        status: "active",
        setup_user_product_access: {
          some: contactCenterStaffAccessWhere(organizationId),
        },
      },
      select: { id: true, team_id: true, skills: true },
    });
    if (users.length !== userIds.length) {
      throw Object.assign(new Error("One or more agents are not eligible for CCaaS"), {
        status: 400,
      });
    }

    const queueSkills = queue.skills;
    for (const user of users) {
      const userTeamId = user.team_id != null ? serializeEntityId(user.team_id) : null;
      if (userTeamId !== queue.teamId) {
        await prisma.setup_users.update({
          where: { id: user.id },
          data: { team_id: toDbId(queue.teamId), updated_at: new Date() },
        });
      }
      const agentSkills = agentSkillsFromUser(user.skills, null);
      const mergedSkills = mergeAgentSkillsForQueue(agentSkills, queueSkills);
      if (mergedSkills.length !== agentSkills.length) {
        await prisma.setup_users.update({
          where: { id: user.id },
          data: { skills: mergedSkills, updated_at: new Date() },
        });
      }
    }

    const elsewhere = await prisma.setup_ccaas_queue_agents.findMany({
      where: {
        user_id: { in: toDbIdList(userIds) },
        queue_id: { not: toDbId(id) },
        setup_ccaas_queues: { organization_id: toDbId(organizationId) },
      },
      select: { queue_id: true },
    });
    if (elsewhere.length > 0) {
      const sourceQueueIds = [
        ...new Set(elsewhere.map((row) => serializeEntityId(row.queue_id))),
      ];
      await prisma.setup_ccaas_queue_agents.deleteMany({
        where: {
          user_id: { in: toDbIdList(userIds) },
          queue_id: { not: toDbId(id) },
          setup_ccaas_queues: { organization_id: toDbId(organizationId) },
        },
      });
      await prisma.setup_ccaas_queues.updateMany({
        where: {
          id: { in: toDbIdList(sourceQueueIds) },
          organization_id: toDbId(organizationId),
        },
        data: { updated_at: new Date() },
      });
      for (const sourceQueueId of sourceQueueIds) {
        await publishQueueToRouting(prisma, organizationId, sourceQueueId);
      }
    }
  }

  await prisma.setup_ccaas_queue_agents.deleteMany({ where: { queue_id: toDbId(id) } });

  if (parsedAgents.length > 0) {
    await prisma.setup_ccaas_queue_agents.createMany({
      data: parsedAgents.map((agent) => {
        const handlesSocial =
          agent.handlesWhatsapp || agent.handlesInstagram || agent.handlesFacebook;
        const callDirection = callDirectionFlagsFromAgent(agent.handlesCalls, agent.callType);
        return {
          queue_id: toDbId(id),
          user_id: toDbId(agent.userId),
          shift_type: agent.shiftType,
          handles_calls: agent.handlesCalls,
          handles_email: agent.handlesEmail,
          handles_chat: agent.handlesChat,
          handles_social: handlesSocial,
          handles_whatsapp: agent.handlesWhatsapp,
          handles_instagram: agent.handlesInstagram,
          handles_facebook: agent.handlesFacebook,
          handles_inbound: callDirection.handlesInbound,
          handles_outbound: callDirection.handlesOutbound,
          handles_outbound_campaign: callDirection.handlesOutboundCampaign,
          chat_concurrency: agent.chatConcurrency,
          email_concurrency: agent.emailConcurrency,
          social_concurrency: agent.socialConcurrency,
          whatsapp_concurrency: agent.whatsappConcurrency,
          instagram_concurrency: agent.instagramConcurrency,
          facebook_concurrency: agent.facebookConcurrency,
          call_type: agent.callType,
        };
      }),
    });
  }

  await prisma.setup_ccaas_queues.updateMany({
    where: { id: toDbId(id), organization_id: toDbId(organizationId) },
    data: { updated_at: new Date() },
  });

  await publishQueueToRouting(prisma, organizationId, id);
  return getQueue(prisma, organizationId, id);
}
