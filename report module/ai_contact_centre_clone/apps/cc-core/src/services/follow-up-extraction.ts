import { createLogger } from "@ai-contact-center/observability";
import type { PrismaClient } from "@ai-contact-center/db-cc";

import { withOrganizationContext } from "../lib/rls.js";
import {
  createCoworkerFollowUpSuggestion,
  hasConversationEndFollowUpTask,
  type AgentTaskRecord,
} from "./agent-tasks.js";
import {
  buildAgentSessionTranscript,
  type AgentSessionTurn,
} from "./wrap-up-suggest.js";
import { getConversation, listConversationMessages } from "./conversations.js";

const NLP_URL = process.env.NLP_SERVICE_URL ?? "http://localhost:8000";
const INTERNAL_SERVICE_KEY = process.env.INTERNAL_SERVICE_KEY;
const FOLLOW_UP_EXTRACTION_ENABLED = process.env.FOLLOW_UP_EXTRACTION_ENABLED !== "false";

const logger = createLogger({ service: "cc-core-follow-up-extraction" });

export type FollowUpExtractionResult = {
  hasFollowUp: boolean;
  title: string;
  summary: string;
  notes: string | null;
  dueAt: string | null;
};

export function normalizeFollowUpExtraction(body: unknown): FollowUpExtractionResult | null {
  if (!body || typeof body !== "object") return null;
  const record = body as Record<string, unknown>;
  const hasFollowUp = record.has_follow_up === true || record.hasFollowUp === true;
  if (!hasFollowUp) {
    return {
      hasFollowUp: false,
      title: "",
      summary: "",
      notes: null,
      dueAt: null,
    };
  }

  const title = typeof record.title === "string" ? record.title.trim() : "";
  const summary = typeof record.summary === "string" ? record.summary.trim() : "";
  if (!title || !summary) return null;

  const notesRaw = record.notes;
  const notes =
    typeof notesRaw === "string" && notesRaw.trim() ? notesRaw.trim().slice(0, 4000) : null;
  const dueRaw = record.due_at ?? record.dueAt;
  const dueAt =
    typeof dueRaw === "string" && dueRaw.trim() && !Number.isNaN(Date.parse(dueRaw.trim()))
      ? new Date(dueRaw.trim()).toISOString()
      : null;

  return {
    hasFollowUp: true,
    title: title.slice(0, 200),
    summary: summary.slice(0, 2000),
    notes,
    dueAt,
  };
}

export async function extractFollowUpFromNlp(input: {
  organizationId: string;
  conversationId: string;
  channel: string | null;
  subject: string | null;
  transcript: AgentSessionTurn[];
  referenceTime: string;
}): Promise<FollowUpExtractionResult | null> {
  if (input.transcript.length === 0) return null;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
    "x-tenant-id": input.organizationId,
  };
  if (INTERNAL_SERVICE_KEY) {
    headers["x-internal-service-key"] = INTERNAL_SERVICE_KEY;
  }

  try {
    const response = await fetch(`${NLP_URL}/api/v1/workspace/follow-up/extract`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        organization_id: input.organizationId,
        conversation_id: input.conversationId,
        channel: input.channel,
        subject: input.subject,
        reference_time: input.referenceTime,
        transcript: input.transcript,
      }),
    });
    if (!response.ok) {
      throw new Error(`Follow-up extract failed (${response.status})`);
    }
    const body = await response.json();
    return normalizeFollowUpExtraction(body);
  } catch (error) {
    logger.warn(
      { err: error, conversationId: input.conversationId },
      "follow-up extraction NLP call failed",
    );
    return null;
  }
}

export async function extractAndCreateFollowUpTask(
  prisma: PrismaClient,
  organizationId: string,
  conversationId: string,
  assignedUserId: string,
): Promise<AgentTaskRecord | null> {
  const setup = await withOrganizationContext(prisma, organizationId, async (db) => {
    const alreadyCreated = await hasConversationEndFollowUpTask(db, organizationId, conversationId);
    if (alreadyCreated) return null;

    const conversation = await getConversation(db, organizationId, conversationId);
    if (!conversation) return null;

    const messages = await listConversationMessages(db, organizationId, conversationId);
    return {
      conversation,
      transcript: buildAgentSessionTranscript(messages, conversation.assignedAt),
    };
  });

  if (!setup || setup.transcript.length === 0) {
    return null;
  }

  const extraction = await extractFollowUpFromNlp({
    organizationId,
    conversationId,
    channel: setup.conversation.channel,
    subject: setup.conversation.subject,
    transcript: setup.transcript,
    referenceTime: new Date().toISOString(),
  });

  if (!extraction?.hasFollowUp) {
    return null;
  }

  return withOrganizationContext(prisma, organizationId, (db) =>
    createCoworkerFollowUpSuggestion(db, organizationId, {
      assignedUserId,
      conversationId,
      contactId: setup.conversation.contactId ?? undefined,
      channel: setup.conversation.channel as
        | "voice"
        | "email"
        | "webchat"
        | "whatsapp"
        | "instagram"
        | "facebook"
        | undefined,
      title: extraction.title,
      summary: extraction.summary,
      notes: extraction.notes ?? undefined,
      dueAt: extraction.dueAt ?? undefined,
    }),
  );
}

export function scheduleFollowUpExtractionOnConversationEnd(
  prisma: PrismaClient,
  organizationId: string,
  conversationId: string,
  assignedUserId: string | null | undefined,
): void {
  if (!FOLLOW_UP_EXTRACTION_ENABLED || !assignedUserId) return;

  void extractAndCreateFollowUpTask(prisma, organizationId, conversationId, assignedUserId).catch(
    (error) => {
      logger.warn({ err: error, conversationId }, "follow-up extraction on conversation end failed");
    },
  );
}
