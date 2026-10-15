/**
 * Company / location draft assist — thin pass-through to Python crm-agent.
 */

import {
  COWORKER_LLM_ERROR_SPEECH,
  lastUserText,
  type CoworkerMessage,
} from "@/service/ai/coworker-shared";
import { callAiServiceAgent, AI_SERVICE_DEFAULT_TIMEOUT_MS } from "@/service/ai/ai-service-client";
import { canEditCompanies } from "@/service/auth/rbac";
import {
  getCurrentOrganizationId,
  requireRole,
} from "@/service/auth/require-role";

export type CompanyDraftPatch = {
  name?: string;
  domain?: string;
  industry?: string;
  locationName?: string;
  locationAddress?: string;
  locationType?: "hq" | "branch";
  employeeCount?: string;
  linkedinUrl?: string;
};

export type LocationDraftPatch = {
  name?: string;
  type?: "hq" | "branch";
  address?: string;
  industry?: string;
};

async function callDraft<T>(input: {
  intent: "company_draft" | "location_draft";
  messages: CoworkerMessage[];
  draft?: Record<string, unknown>;
  companyId?: string;
  pathname?: string | null;
  sessionMemory?: Record<string, unknown> | null;
}): Promise<
  | {
      ok: true;
      assistantText: string;
      patch?: T;
      toolProposals?: Array<{
        id: string;
        name: string;
        label: string;
        args: Record<string, unknown>;
        risk: "low" | "high";
      }>;
      sessionMemoryPatch?: Record<string, unknown>;
      sessionMemory?: Record<string, unknown>;
    }
  | { ok: false; error: string }
> {
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
    patch?: T;
    toolProposals?: Array<{
      id: string;
      name: string;
      label: string;
      args: Record<string, unknown>;
      risk: "low" | "high";
    }>;
    sessionMemoryPatch?: Record<string, unknown>;
    sessionMemory?: Record<string, unknown>;
  }>(
    "crm-agent",
    {
      intent: input.intent,
      messages: input.messages,
      context: {
        module: "company",
        surface: "create",
        draft: input.draft ?? {},
        pathname:
          input.pathname ||
          (input.intent === "location_draft" ? undefined : "/company/new"),
        sessionMemory: input.sessionMemory ?? null,
      },
      catalog: {
        currentDraft: input.draft ?? {},
        companyId: input.companyId ?? null,
      },
      organizationId,
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
      patch: result.patch,
      toolProposals: result.toolProposals,
      sessionMemoryPatch: result.sessionMemoryPatch,
      sessionMemory: result.sessionMemory,
    };
  }
  return {
    ok: true,
    assistantText: COWORKER_LLM_ERROR_SPEECH,
  };
}

export async function companyDraftAssistCommand(input: {
  messages?: CoworkerMessage[];
  draft?: CompanyDraftPatch;
  pathname?: string | null;
  sessionMemory?: Record<string, unknown> | null;
}): Promise<
  | {
      ok: true;
      assistantText: string;
      patch?: CompanyDraftPatch;
      toolProposals?: Array<{
        id: string;
        name: string;
        label: string;
        args: Record<string, unknown>;
        risk: "low" | "high";
      }>;
    }
  | { ok: false; error: string }
> {
  try {
    await requireRole(
      canEditCompanies,
      "You do not have permission to create companies.",
    );
    const messages = input.messages ?? [];
    if (!lastUserText(messages)) {
      return { ok: false, error: "Send a message to update the draft." };
    }
    return callDraft<CompanyDraftPatch>({
      intent: "company_draft",
      messages,
      draft: input.draft,
      pathname: input.pathname,
      sessionMemory: input.sessionMemory,
    });
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error ? err.message : "Failed to assist company draft.",
    };
  }
}

export async function locationDraftAssistCommand(input: {
  messages?: CoworkerMessage[];
  draft?: LocationDraftPatch;
  companyId?: string;
  pathname?: string | null;
  sessionMemory?: Record<string, unknown> | null;
}): Promise<
  | {
      ok: true;
      assistantText: string;
      patch?: LocationDraftPatch;
      toolProposals?: Array<{
        id: string;
        name: string;
        label: string;
        args: Record<string, unknown>;
        risk: "low" | "high";
      }>;
    }
  | { ok: false; error: string }
> {
  try {
    await requireRole(
      canEditCompanies,
      "You do not have permission to create locations.",
    );
    const messages = input.messages ?? [];
    if (!lastUserText(messages)) {
      return { ok: false, error: "Send a message to update the draft." };
    }
    return callDraft<LocationDraftPatch>({
      intent: "location_draft",
      messages,
      draft: input.draft,
      companyId: input.companyId,
      pathname: input.pathname,
      sessionMemory: input.sessionMemory,
    });
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error ? err.message : "Failed to assist location draft.",
    };
  }
}
