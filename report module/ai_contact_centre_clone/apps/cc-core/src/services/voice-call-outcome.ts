import type { PrismaClient } from "@ai-contact-center/db-cc";

import type { DbClient } from "../lib/rls.js";
import { withOrganizationContext } from "../lib/rls.js";
import { matchCallSessionIds } from "./umn-call-transcript.js";
import { voiceSessionUuid } from "./voice-omni-summary.js";

export const CALL_OUTCOMES = ["Interested", "Qualified", "Not Interested", "Callback"] as const;

export type CallOutcome = (typeof CALL_OUTCOMES)[number];
export type CallOutcomeStatus = "pending" | "triggered" | "closed";

export class VoiceCallOutcomeError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export type CallOutcomeInput = {
  organizationId: string;
  sessionId: string;
  outcome: string;
  mobile: string;
  name?: string | null;
  email?: string | null;
  instruction?: string | null;
  reason?: string | null;
  callbackAt?: string | null;
  timezone?: string | null;
};

export type NormalizedCallOutcome = {
  organizationId: string;
  sessionId: string;
  outcome: CallOutcome;
  mobile: string;
  status: CallOutcomeStatus;
  customerName: string | null;
  email: string | null;
  instruction: string | null;
  reason: string | null;
  callbackAt: Date | null;
  timezone: string | null;
};

type SavedCallOutcome = {
  session_id: string;
  outcome: CallOutcome;
  mobile: string;
  status: CallOutcomeStatus;
  customer_name: string | null;
  email: string | null;
  instruction: string | null;
  timezone: string | null;
  created_at: Date;
};

function validTimeZone(value: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export function normalizeCallOutcomeInput(input: CallOutcomeInput): NormalizedCallOutcome {
  const organizationId = input.organizationId.trim();
  const sessionId = input.sessionId.trim();
  const outcome = input.outcome.trim();
  const mobile = input.mobile.trim();
  const customerName = input.name?.trim() || null;
  const email = input.email?.trim() || null;
  const instruction = input.instruction?.trim() || null;
  const reason = input.reason?.trim() || null;
  if (email && !email.includes("@")) {
    throw new VoiceCallOutcomeError(400, "email is not valid");
  }
  const callbackText = input.callbackAt?.trim() || "";
  const timezone = input.timezone?.trim() || null;
  if (timezone && !validTimeZone(timezone)) {
    throw new VoiceCallOutcomeError(400, "timezone is not valid");
  }

  if (!/^\d+$/.test(organizationId)) {
    throw new VoiceCallOutcomeError(400, "organizationId must be a number");
  }
  if (!sessionId) {
    throw new VoiceCallOutcomeError(400, "sessionId is required");
  }
  if (!mobile) {
    throw new VoiceCallOutcomeError(400, "mobile is required");
  }
  if (!CALL_OUTCOMES.includes(outcome as CallOutcome)) {
    throw new VoiceCallOutcomeError(400, "outcome is not supported");
  }

  const selected = outcome as CallOutcome;
  if (selected === "Callback") {
    const callbackAt = new Date(callbackText);
    if (!callbackText || Number.isNaN(callbackAt.getTime())) {
      throw new VoiceCallOutcomeError(400, "callbackAt is required for Callback");
    }
    if (!timezone) {
      throw new VoiceCallOutcomeError(400, "timezone is required for Callback");
    }
    return {
      organizationId,
      sessionId,
      outcome: selected,
      mobile,
      status: "pending",
      customerName,
      email,
      instruction,
      reason,
      callbackAt,
      timezone,
    };
  }
  if (callbackText) {
    throw new VoiceCallOutcomeError(400, "callbackAt is only allowed for Callback");
  }
  return {
    organizationId,
    sessionId,
    outcome: selected,
    mobile,
    status: "closed",
    customerName,
    email,
    instruction,
    reason,
    callbackAt: null,
    timezone,
  };
}

async function findConversationId(
  db: DbClient,
  organizationId: string,
  sessionId: string,
): Promise<string | null> {
  const uuid = voiceSessionUuid(sessionId);
  const rows = await db.$queryRaw<
    Array<{ id: string; external_thread_id: string | null; provider_thread_id: string | null }>
  >`
    SELECT id::text AS id, external_thread_id, provider_thread_id
    FROM ccass.conversations
    WHERE organization_id = ${organizationId}::bigint
      AND channel IN ('call', 'voice', 'phone')
      AND created_at >= NOW() - INTERVAL '24 hours'
      AND (
        external_thread_id = ${sessionId}
        OR provider_thread_id = ${sessionId}
        OR (
          ${uuid} <> ''
          AND (
            external_thread_id LIKE ${`%${uuid}`}
            OR provider_thread_id LIKE ${`%${uuid}`}
          )
        )
      )
    ORDER BY updated_at DESC
    LIMIT 5
  `;
  const match = rows.find(
    (row) =>
      row.external_thread_id === sessionId ||
      row.provider_thread_id === sessionId ||
      matchCallSessionIds(sessionId, row.external_thread_id || "") ||
      matchCallSessionIds(sessionId, row.provider_thread_id || ""),
  );
  return match?.id ?? null;
}

export async function saveVoiceCallOutcome(
  prisma: PrismaClient,
  input: CallOutcomeInput,
): Promise<{
  sessionId: string;
  outcome: CallOutcome;
  mobile: string;
  status: CallOutcomeStatus;
  name: string | null;
  email: string | null;
  instruction: string | null;
  timezone: string | null;
  createdAt: string;
}> {
  const outcome = normalizeCallOutcomeInput(input);
  const saved = await withOrganizationContext(prisma, outcome.organizationId, async (db) => {
    const conversationId = await findConversationId(db, outcome.organizationId, outcome.sessionId);
    const conversationIdValue = conversationId ? BigInt(conversationId) : null;
    const rows = await db.$queryRaw<SavedCallOutcome[]>`
      INSERT INTO ccass.voice_call_outcomes (
        organization_id,
        session_id,
        conversation_id,
        outcome,
        reason,
        callback_at,
        timezone,
        mobile,
        customer_name,
        email,
        instruction,
        status
      )
      VALUES (
        ${outcome.organizationId}::bigint,
        ${outcome.sessionId},
        ${conversationIdValue},
        ${outcome.outcome},
        ${outcome.reason},
        ${outcome.callbackAt},
        ${outcome.timezone},
        ${outcome.mobile},
        ${outcome.customerName},
        ${outcome.email},
        ${outcome.instruction},
        ${outcome.status}
      )
      ON CONFLICT (organization_id, session_id)
      DO UPDATE SET
        conversation_id = COALESCE(
          EXCLUDED.conversation_id,
          ccass.voice_call_outcomes.conversation_id
        ),
        outcome = EXCLUDED.outcome,
        reason = EXCLUDED.reason,
        callback_at = EXCLUDED.callback_at,
        timezone = EXCLUDED.timezone,
        mobile = EXCLUDED.mobile,
        customer_name = EXCLUDED.customer_name,
        email = EXCLUDED.email,
        instruction = EXCLUDED.instruction,
        status = EXCLUDED.status,
        updated_at = NOW()
      RETURNING session_id, outcome, mobile, status, customer_name, email, instruction, timezone, created_at
    `;
    const row = rows[0];
    if (!row) throw new VoiceCallOutcomeError(500, "Call outcome was not saved");
    return row;
  });

  return {
    sessionId: saved.session_id,
    outcome: saved.outcome,
    mobile: saved.mobile,
    status: saved.status,
    name: saved.customer_name,
    email: saved.email,
    instruction: saved.instruction,
    timezone: saved.timezone,
    createdAt: saved.created_at.toISOString(),
  };
}
