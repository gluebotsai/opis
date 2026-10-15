import type { PrismaClient } from "@ai-contact-center/db-cc";
import type Redis from "ioredis";

import type { DbClient } from "../lib/rls.js";
import { publishAutoBotCall } from "./auto-bot-call.js";

const FOLLOW_UP_LIMIT = 20;

export type DueCallOutcome = {
  id: string;
  organization_id: string;
  mobile: string;
  customer_name: string | null;
  email: string | null;
  instruction: string | null;
  reason: string | null;
};

export function followUpInstruction(row: Pick<DueCallOutcome, "instruction" | "reason">): string {
  const instruction = row.instruction?.trim();
  if (instruction) return instruction;
  const reason = row.reason?.trim();
  if (reason) return `This is the scheduled callback. ${reason}`;
  return "This is the scheduled callback.";
}

export function followUpCallData(
  row: Pick<DueCallOutcome, "mobile" | "customer_name" | "email">,
): Record<string, unknown> {
  const data: Record<string, unknown> = { phone: row.mobile };
  const name = row.customer_name?.trim();
  const email = row.email?.trim();
  if (name) data.customer_name = name;
  if (email) data.email = email;
  return data;
}

export async function claimDueCallOutcomes(db: DbClient, limit = FOLLOW_UP_LIMIT): Promise<DueCallOutcome[]> {
  return db.$queryRaw<DueCallOutcome[]>`
    WITH due AS (
      SELECT id
      FROM ccass.voice_call_outcomes
      WHERE status = 'pending'
        AND outcome = 'Callback'
        AND callback_at <= NOW()
      ORDER BY callback_at
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    UPDATE ccass.voice_call_outcomes AS outcome
    SET status = 'triggered', updated_at = NOW()
    FROM due
    WHERE outcome.id = due.id
    RETURNING
      outcome.id::text AS id,
      outcome.organization_id::text AS organization_id,
      outcome.mobile,
      outcome.customer_name,
      outcome.email,
      outcome.instruction,
      outcome.reason
  `;
}

async function releaseCallOutcome(db: DbClient, id: string): Promise<void> {
  await db.$executeRaw`
    UPDATE ccass.voice_call_outcomes
    SET status = 'pending', updated_at = NOW()
    WHERE id = ${id}::bigint
      AND status = 'triggered'
      AND triggered_session_id IS NULL
  `;
}

async function storeTriggeredSession(db: DbClient, id: string, sessionId: string): Promise<void> {
  await db.$executeRaw`
    UPDATE ccass.voice_call_outcomes
    SET triggered_session_id = ${sessionId}, updated_at = NOW()
    WHERE id = ${id}::bigint
      AND status = 'triggered'
  `;
}

export async function sweepDueCallOutcomes(
  prisma: PrismaClient,
  redis: Redis | null,
  limit = FOLLOW_UP_LIMIT,
  onError?: (row: DueCallOutcome, error: unknown) => void,
): Promise<number> {
  if (!redis) return 0;
  const claimed = await claimDueCallOutcomes(prisma, limit);
  let published = 0;
  for (const row of claimed) {
    try {
      const result = await publishAutoBotCall(prisma, redis, {
        organizationId: row.organization_id,
        customerNumber: row.mobile,
        data: followUpCallData(row),
        instruction: followUpInstruction(row),
      });
      await storeTriggeredSession(prisma, row.id, result.sessionId);
      published += 1;
    } catch (error) {
      onError?.(row, error);
      await releaseCallOutcome(prisma, row.id);
    }
  }
  return published;
}
