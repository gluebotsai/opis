/**
 * LLM access for the CRM. All model calls go through the Python ai-service
 * (own-server LLM via LLM_BASE_URL / LLM_API_KEY / LLM_MODEL on ai-service).
 *
 * Named CRM agents use dedicated LangGraph endpoints. This helper is for
 * lighter UI assists (AiAssist) — still Python chat agent, never a direct
 * cloud/OpenAI call from Next.js.
 */

import {
  callAiServiceAgent,
  AI_SERVICE_DEFAULT_TIMEOUT_MS,
} from "@/service/ai/ai-service-client";

export function isAiConfigured(): boolean {
  return Boolean(process.env.AI_SERVICE_BASE_URL?.trim());
}

export async function generateAiText(input: {
  system: string;
  user: string;
  maxTokens?: number;
  /** Abort after this many ms (clamped by AI_SERVICE_MAX_TIMEOUT_MS). */
  timeoutMs?: number;
}): Promise<string | null> {
  if (!isAiConfigured()) return null;

  const llmTimeout = input.timeoutMs ?? AI_SERVICE_DEFAULT_TIMEOUT_MS;
  const py = await callAiServiceAgent<{
    ok?: boolean;
    text?: string | null;
  }>(
    "chat",
    {
      system: input.system,
      user: input.user,
      maxTokens: input.maxTokens ?? 500,
      timeoutMs: llmTimeout,
    },
    // HTTP budget slightly above in-agent LLM timeout.
    { timeoutMs: llmTimeout + 15_000 },
  );

  if (py?.ok && py.text?.trim()) {
    return py.text.trim();
  }
  return null;
}
