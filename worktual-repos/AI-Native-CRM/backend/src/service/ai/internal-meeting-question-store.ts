/**
 * Latest unanswered manager question for each targeted employee.
 *
 * Redis keeps routing correct across API replicas. The memory fallback is for
 * local development only. One key per employee lets every member of a team
 * answer the same team question once.
 */
import { getRedisPublisher } from "@/lib/redis";

export type PendingInternalQuestion = {
  sessionId: string;
  askerUserId: string;
  askerName: string;
  employeeUserId: string;
  question: string;
  createdAt: number;
};

const TTL_SECONDS = 5 * 60;
const memory = new Map<string, PendingInternalQuestion>();

function key(sessionId: string, employeeUserId: string): string {
  return `meeting-assist:internal-question:${sessionId.trim()}:${employeeUserId.trim()}`;
}

export async function savePendingInternalQuestion(input: {
  sessionId: string;
  askerUserId: string;
  askerName: string;
  question: string;
  employeeUserIds: string[];
}): Promise<void> {
  const createdAt = Date.now();
  const redis = getRedisPublisher();
  await Promise.all(
    [...new Set(input.employeeUserIds)].map(async (employeeUserId) => {
      const row: PendingInternalQuestion = {
        sessionId: input.sessionId,
        askerUserId: input.askerUserId,
        askerName: input.askerName,
        employeeUserId,
        question: input.question,
        createdAt,
      };
      const storageKey = key(input.sessionId, employeeUserId);
      if (redis) {
        try {
          await redis.set(storageKey, JSON.stringify(row), "EX", TTL_SECONDS);
          return;
        } catch (err) {
          console.warn("internal question redis set failed", err);
        }
      }
      memory.set(storageKey, row);
    }),
  );
}

/** Claim once so duplicate caption deliveries do not create duplicate fact cards. */
export async function claimPendingInternalQuestion(
  sessionId: string,
  employeeUserId: string,
): Promise<PendingInternalQuestion | null> {
  const storageKey = key(sessionId, employeeUserId);
  const redis = getRedisPublisher();
  if (redis) {
    try {
      const raw = await redisGetDel(redis, storageKey);
      if (raw) return JSON.parse(raw) as PendingInternalQuestion;
    } catch (err) {
      console.warn("internal question redis claim failed", err);
    }
  }
  const row = memory.get(storageKey) ?? null;
  memory.delete(storageKey);
  if (!row || Date.now() - row.createdAt > TTL_SECONDS * 1000) return null;
  return row;
}

export async function getPendingInternalQuestion(
  sessionId: string,
  employeeUserId: string,
): Promise<PendingInternalQuestion | null> {
  const storageKey = key(sessionId, employeeUserId);
  const redis = getRedisPublisher();
  if (redis) {
    try {
      const raw = await redis.get(storageKey);
      if (raw) return JSON.parse(raw) as PendingInternalQuestion;
    } catch (err) {
      console.warn("internal question redis get failed", err);
    }
  }
  const row = memory.get(storageKey) ?? null;
  if (!row || Date.now() - row.createdAt > TTL_SECONDS * 1000) return null;
  return row;
}

export function clearPendingInternalQuestions(sessionId: string): void {
  const prefix = `meeting-assist:internal-question:${sessionId.trim()}:`;
  for (const storageKey of memory.keys()) {
    if (storageKey.startsWith(prefix)) memory.delete(storageKey);
  }
}

async function redisGetDel(
  redis: NonNullable<ReturnType<typeof getRedisPublisher>>,
  storageKey: string,
): Promise<string | null> {
  const getdel = (
    redis as { getdel?: (key: string) => Promise<string | null> }
  ).getdel;
  if (typeof getdel === "function") {
    return (await getdel.call(redis, storageKey)) ?? null;
  }
  const tx = await redis.multi().get(storageKey).del(storageKey).exec();
  const result = tx?.[0];
  if (!result) return null;
  const [err, value] = result;
  if (err) throw err;
  return typeof value === "string" ? value : null;
}
