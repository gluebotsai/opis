import {
  fetchSessionMemory,
  upsertConversationMemory,
  type IngestSocialConversationResult,
  type SessionMemoryResponse,
} from "./cc-core-social-client.js";

export function queueProfilesFromIngest(
  ingest: IngestSocialConversationResult,
): Array<{
  key: string;
  name: string;
  description: string;
  skills: string[];
  intents: string[];
}> {
  return (ingest.queueProfiles ?? []).map((queue) => ({
    key: queue.key || queue.id,
    name: queue.name,
    description: queue.description ?? queue.name,
    skills: queue.skills,
    intents: queue.intents,
  }));
}

export type SocialBotMemoryContext = {
  transcript: Array<{ role: string; content: string }>;
  tenantContext: Record<string, unknown>;
};

export function buildSocialBotMemoryContext(
  session: SessionMemoryResponse,
  baseTenantContext: Record<string, unknown>,
): SocialBotMemoryContext {
  const tenantContext: Record<string, unknown> = { ...baseTenantContext };
  if (session.longTermSummary) {
    tenantContext.rolling_summary = session.longTermSummary;
  }
  if (session.extractedFacts.length > 0) {
    tenantContext.extracted_facts = session.extractedFacts;
  }
  return {
    transcript: session.transcript,
    tenantContext,
  };
}

export async function loadSocialBotMemoryContext(
  organizationId: string,
  conversationId: string,
  baseTenantContext: Record<string, unknown>,
): Promise<SocialBotMemoryContext> {
  const session =
    (await fetchSessionMemory(organizationId, conversationId)) ??
    ({
      conversationId,
      turns: [],
      memory: null,
      transcript: [],
      longTermSummary: null,
      extractedFacts: [],
    } satisfies SessionMemoryResponse);

  return buildSocialBotMemoryContext(session, baseTenantContext);
}

export async function persistSocialBotTurnMemory(
  organizationId: string,
  conversationId: string,
  input: {
    importantFacts?: string[];
  },
): Promise<void> {
  if (!input.importantFacts?.length) return;

  const session = await fetchSessionMemory(organizationId, conversationId);
  const extractedFacts = [...(session?.extractedFacts ?? [])];
  for (const fact of input.importantFacts) {
    const trimmed = fact.trim();
    if (trimmed && !extractedFacts.includes(trimmed)) {
      extractedFacts.push(trimmed);
    }
  }

  await upsertConversationMemory(organizationId, conversationId, {
    extractedFacts: extractedFacts.slice(0, 50),
    modelName: "social-bot",
  });
}
