import { queuesApi } from "@/features/workforce/queues/api";
import { ASSISTANT_QUEUE_DRAFT_APPLY } from "@/features/workforce/queues/queue-draft-context";
import type { Team } from "@/features/workforce/queues/types";

import type {
  CreateQueueArgs,
  CreateQueueResult,
  ListQueuesResult,
  QueueActionResult,
} from "./copilot-engine";

function normalize(text: string) {
  return text.trim().toLowerCase();
}

async function findQueueByName(name: string) {
  const { queues } = await queuesApi.listQueues();
  const { teams } = await queuesApi.listTeams();
  const teamName = (teamId: string) => teams.find((t) => t.id === teamId)?.name ?? "—";

  const lower = normalize(name);
  const exact = queues.find((q) => normalize(q.name) === lower);
  const match =
    exact ??
    queues.find((q) => lower.includes(normalize(q.name)) || normalize(q.name).includes(lower));

  if (!match) {
    throw new Error(`Queue "${name}" was not found.`);
  }

  return { queue: match, teamName: teamName(match.teamId) };
}

export function applyQueueCreateDraft(
  args: CreateQueueArgs,
  teams: Team[],
): { teamId: string; teamName: string } {
  const team =
    teams.find((t) => normalize(t.name) === normalize(args.teamName)) ??
    teams.find(
      (t) =>
        normalize(args.teamName).includes(normalize(t.name)) ||
        normalize(t.name).includes(normalize(args.teamName)),
    );

  if (!team) {
    throw new Error(`Team "${args.teamName}" was not found.`);
  }

  window.dispatchEvent(
    new CustomEvent(ASSISTANT_QUEUE_DRAFT_APPLY, {
      detail: {
        name: args.name,
        description: args.description ?? "",
        teamId: team.id,
        businessHoursId: team.businessHoursId ?? "",
        shiftTypes: [],
        skills: [],
        status: args.status,
        step: "hours",
      },
    }),
  );

  return { teamId: team.id, teamName: team.name };
}

export async function runCreateQueueTool(
  args: CreateQueueArgs,
  teams: Team[],
): Promise<CreateQueueResult> {
  const { teamId } = applyQueueCreateDraft(args, teams);
  const { queue } = await queuesApi.createQueue({
    name: args.name,
    description: args.description,
    teamId,
    businessHoursId: teams.find((t) => t.id === teamId)?.businessHoursId ?? null,
    shiftTypes: [],
    skills: [],
    status: args.status,
  });

  return { id: queue.id, createdAt: queue.createdAt, draftOnly: false };
}

export async function runListQueuesTool(): Promise<ListQueuesResult> {
  const [{ queues }, { teams }] = await Promise.all([
    queuesApi.listQueues(),
    queuesApi.listTeams(),
  ]);
  const teamName = (teamId: string) => teams.find((t) => t.id === teamId)?.name ?? "—";

  return {
    queues: queues.map((q) => ({
      id: q.id,
      name: q.name,
      teamName: teamName(q.teamId),
      status: q.status,
      agentCount: q.agents.length,
    })),
  };
}

export async function runUpdateQueueStatusTool(
  queueName: string,
  status: "active" | "inactive",
): Promise<QueueActionResult> {
  const { queue } = await findQueueByName(queueName);
  if (queue.status === status) {
    return { id: queue.id, name: queue.name, status: queue.status };
  }
  const { queue: updated } = await queuesApi.updateQueue(queue.id, { status });
  return { id: updated.id, name: updated.name, status: updated.status };
}

export async function runDeleteQueueTool(queueName: string): Promise<QueueActionResult> {
  const { queue } = await findQueueByName(queueName);
  await queuesApi.deleteQueue(queue.id);
  return { id: queue.id, name: queue.name };
}
