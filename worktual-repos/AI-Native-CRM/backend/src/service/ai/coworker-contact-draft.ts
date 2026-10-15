/**
 * Contact draft assist — thin pass-through to Python crm-agent.
 * RBAC + catalog fetch stay in TypeScript; intelligence is in Python.
 */

import {
  COWORKER_LLM_ERROR_SPEECH,
  lastUserText,
  type CoworkerMessage,
} from "@/service/ai/coworker-shared";
import { callAiServiceAgent, AI_SERVICE_DEFAULT_TIMEOUT_MS } from "@/service/ai/ai-service-client";
import { canEditContacts } from "@/service/auth/rbac";
import {
  getCurrentOrganizationId,
  requireRole,
} from "@/service/auth/require-role";
import { getContactFormOptionsCommand } from "@/service/contacts/contact-commands";

export type ContactDraftPatch = {
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  title?: string;
  companyId?: string;
  locationId?: string;
  companyName?: string;
  contactType?: string;
  leadStatus?: string;
  notes?: string;
  city?: string;
  country?: string;
  leadSource?: string;
};

export type ContactDraftWorkspaceHint = {
  mode: "list" | "create" | "detail";
  label: string;
  search?: string;
};

export async function contactDraftAssistCommand(input: {
  messages?: CoworkerMessage[];
  draft?: ContactDraftPatch;
  pathname?: string | null;
  sessionMemory?: Record<string, unknown> | null;
}): Promise<
  | {
      ok: true;
      assistantText: string;
      patch?: ContactDraftPatch;
      workspaceHint?: ContactDraftWorkspaceHint;
      toolProposals?: Array<{
        id: string;
        name: string;
        label: string;
        args: Record<string, unknown>;
        risk: "low" | "high";
      }>;
      contactDraftPatch?: ContactDraftPatch;
      sessionMemoryPatch?: Record<string, unknown>;
      sessionMemory?: Record<string, unknown>;
    }
  | { ok: false; error: string }
> {
  try {
    await requireRole(
      canEditContacts,
      "You do not have permission to create contacts.",
    );
    const messages = input.messages ?? [];
    const userText = lastUserText(messages);
    if (!userText) {
      return { ok: false, error: "Send a message to update the contact draft." };
    }

    const options = await getContactFormOptionsCommand();
    if (!options.ok) {
      return { ok: false, error: options.error || "Failed to load form options." };
    }
    const companies = (options.companies ?? []).map((c) => ({
      id: c.id,
      name: c.name,
      locations: (c.locations ?? []).map((l) => ({ id: l.id, name: l.name })),
    }));

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
      patch?: ContactDraftPatch;
      contactDraftPatch?: ContactDraftPatch;
      workspaceHint?: ContactDraftWorkspaceHint;
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
        intent: "contact_draft",
        messages,
        context: {
          module: "contact",
          surface: "create",
          draft: input.draft ?? {},
          pathname: input.pathname || "/contact/new",
          sessionMemory: input.sessionMemory ?? null,
        },
        catalog: {
          companies,
          currentDraft: input.draft ?? {},
        },
        organizationId,
      },
      { timeoutMs: AI_SERVICE_DEFAULT_TIMEOUT_MS },
    );

    if (result?.ok === false && result.error) {
      return { ok: false, error: result.error };
    }
    const patch = result?.patch ?? result?.contactDraftPatch;
    const tools = result?.toolProposals;
    const speech = String(result?.assistantText || "").trim();
    if (speech || (Array.isArray(tools) && tools.length > 0) || patch) {
      return {
        ok: true,
        assistantText: speech || COWORKER_LLM_ERROR_SPEECH,
        patch,
        contactDraftPatch: patch,
        workspaceHint: result?.workspaceHint,
        toolProposals: tools,
        sessionMemoryPatch: result?.sessionMemoryPatch,
        sessionMemory: result?.sessionMemory,
      };
    }

    return {
      ok: true,
      assistantText: COWORKER_LLM_ERROR_SPEECH,
    };
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error ? err.message : "Failed to assist contact draft.",
    };
  }
}
