/**
 * Page-scoped co-worker assist — thin pass-through to Python crm-agent.
 */

import {
  COWORKER_LLM_ERROR_SPEECH,
  lastUserText,
  type CoworkerMessage,
} from "@/service/ai/coworker-shared";
import { callAiServiceAgent, AI_SERVICE_DEFAULT_TIMEOUT_MS } from "@/service/ai/ai-service-client";
import { getServerUserId } from "@/service/account/session-cookie";
import {
  getCurrentBusinessType,
  getCurrentOrganizationId,
  getCurrentUserRole,
} from "@/service/auth/require-role";

export type PageAssistContext = {
  module?: string | null;
  surface?: string | null;
  entityId?: string | null;
  pathname?: string | null;
};

export type PageAssistAction = {
  type: "navigate";
  label: string;
  href: string;
};

export async function pageAssistCommand(input: {
  messages?: CoworkerMessage[];
  context?: PageAssistContext;
}): Promise<
  | {
      ok: true;
      assistantText: string;
      actions?: PageAssistAction[];
    }
  | { ok: false; error: string }
> {
  try {
    await getServerUserId();
    const role = await getCurrentUserRole();
    const businessType = await getCurrentBusinessType();
    const ctx = input.context ?? {};

    if (ctx.module === "finance" && businessType === "b2c") {
      return {
        ok: true,
        assistantText:
          "Finance isn’t available for B2C workspaces. Switch modules or ask about contacts and commerce instead.",
      };
    }

    const messages = input.messages ?? [];
    const userText = lastUserText(messages);
    if (!userText) {
      return { ok: false, error: "Send a message to get help on this page." };
    }

    let organizationId: string | null = null;
    try {
      organizationId = await getCurrentOrganizationId();
    } catch {
      organizationId = null;
    }

    const result = await callAiServiceAgent<{
      ok?: boolean;
      error?: string;
      assistantText?: string;
      actions?: PageAssistAction[];
    }>(
      "crm-agent",
      {
        intent: "page_assist",
        messages,
        context: ctx,
        catalog: { role, businessType },
        organizationId,
        role,
        businessType,
      },
      { timeoutMs: AI_SERVICE_DEFAULT_TIMEOUT_MS },
    );

    if (result?.ok === false && result.error) {
      return { ok: false, error: result.error };
    }
    if (result?.assistantText) {
      return {
        ok: true,
        assistantText: String(result.assistantText),
        actions: result.actions,
      };
    }

    return {
      ok: true,
      assistantText: COWORKER_LLM_ERROR_SPEECH,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to assist.",
    };
  }
}
