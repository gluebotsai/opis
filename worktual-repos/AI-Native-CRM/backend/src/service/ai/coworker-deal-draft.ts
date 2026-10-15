/**
 * Deal draft assist — thin pass-through to Python crm-agent.
 */

import {
  COWORKER_LLM_ERROR_SPEECH,
  lastUserText,
  type CoworkerMessage,
} from "@/service/ai/coworker-shared";
import { callAiServiceAgent, AI_SERVICE_DEFAULT_TIMEOUT_MS } from "@/service/ai/ai-service-client";
import { getServerUserId } from "@/service/account/session-cookie";
import { canEditDeals } from "@/service/auth/rbac";
import {
  getCurrentBusinessType,
  getCurrentOrganizationId,
  getCurrentUserRole,
  requireRole,
} from "@/service/auth/require-role";
import { getDealFormOptionsCommand } from "@/service/sales/deal-commands";
import { DEAL_STAGES } from "@/service/sales/stages";

export type DealDraftPatch = {
  title?: string;
  stage?: string;
  amount?: string;
  companyId?: string;
  locationId?: string;
  contactId?: string;
  notes?: string;
  expectedCloseDate?: string;
};

export type DealDraftMessage = CoworkerMessage;

function humanRecordName(value: string | null | undefined): string | null {
  const text = value?.trim() || "";
  if (!text) return null;
  if (/^\d{6,}$/.test(text)) return null;
  if (
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(text)
  ) {
    return null;
  }
  if (/^c[a-z0-9]{24}$/i.test(text)) return null;
  return text;
}

/** Contact the user already has open, so the deal draft does not ask again. */
async function loadOpenContact(contactId: string) {
  const id = contactId.trim();
  if (!id) return null;
  try {
    const { getContact } = await import("@/dao/contacts/contact-service");
    const view = await getContact(id);
    if (!view) return null;
    const person = view.person;
    const companyId = person.companyId?.trim() || person.company?.id?.trim() || "";
    let company: {
      id: string;
      name: string;
      locations: Array<{ id: string; name: string }>;
    } | null = null;
    if (companyId) {
      const { getCompany } = await import("@/dao/companies/company-service");
      const row = await getCompany(companyId);
      const name = humanRecordName(row?.name) || humanRecordName(person.company?.name);
      if (row && name) {
        company = {
          id: row.id,
          name,
          locations: (row.locations ?? []).map((location) => ({
            id: location.id,
            name: location.name,
          })),
        };
      }
    }
    const companyName = company?.name || humanRecordName(person.company?.name);
    const locationId =
      (person.locationId &&
      company?.locations.some((location) => location.id === person.locationId)
        ? person.locationId
        : company?.locations[0]?.id) || "";
    return {
      contact: {
        id: view.id,
        displayName: view.displayName,
        email: person.email || null,
        companyId: company?.id || null,
        companyName,
        locationId: locationId || null,
      },
      company,
    };
  } catch {
    return null;
  }
}

export async function dealDraftAssistCommand(input: {
  messages?: DealDraftMessage[];
  draft?: DealDraftPatch;
  pathname?: string | null;
  sessionMemory?: Record<string, unknown> | null;
  sourceContactId?: string | null;
}): Promise<
  | {
      ok: true;
      assistantText: string;
      patch?: DealDraftPatch;
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
  try {
    await requireRole(
      canEditDeals,
      "You do not have permission to create deals.",
    );

    const messages = Array.isArray(input.messages) ? input.messages : [];
    if (!lastUserText(messages)) {
      return { ok: false, error: "Send a message to update the deal draft." };
    }

    const options = await getDealFormOptionsCommand();
    const draft = input.draft ?? {};
    const open = await loadOpenContact(input.sourceContactId || "");
    const companies = options.companies.map((c) => ({
      id: c.id,
      name: c.name,
      locations: c.locations.map((l) => ({ id: l.id, name: l.name })),
    }));
    if (
      open?.company &&
      !companies.some((company) => company.id === open.company?.id)
    ) {
      companies.unshift(open.company);
    }

    let organizationId: string | null = null;
    try {
      organizationId = await getCurrentOrganizationId();
    } catch {
      organizationId = null;
    }
    const actingUserId = await getServerUserId();
    const role = await getCurrentUserRole();
    const businessType = await getCurrentBusinessType();
    const nativeOn =
      process.env.COWORKER_NATIVE_ENABLED?.trim().toLowerCase() === "true";
    const allow = new Set(
      (process.env.COWORKER_NATIVE_ALLOWLIST || "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean),
    );
    const executionMode =
      nativeOn &&
      (allow.has("*") ||
        (organizationId ? allow.has(organizationId) : false) ||
        (organizationId && actingUserId
          ? allow.has(`${organizationId}:${actingUserId}`)
          : false))
        ? "native"
        : "legacy";

    const result = await callAiServiceAgent<{
      ok?: boolean;
      error?: string;
      assistantText?: string;
      patch?: DealDraftPatch;
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
        intent: "deal_draft",
        messages,
        context: {
          module: "sales",
          surface: "create",
          draft,
          pathname: input.pathname || "/sales/new",
          sessionMemory: input.sessionMemory ?? null,
          organizationId,
          role,
          businessType,
          actingUserId,
          executionMode,
          sourceContactId: open?.contact.id ?? null,
        },
        organizationId,
        role,
        businessType,
        actingUserId,
        executionMode,
        catalog: {
          companies,
          contacts: options.contacts.slice(0, 80).map((c) => ({
            id: c.id,
            displayName: c.displayName,
            companyId: c.companyId,
          })),
          stages: DEAL_STAGES,
          currentDraft: draft,
          ...(open
            ? { openContact: open.contact, openCompany: open.company }
            : {}),
        },
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
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error ? err.message : "Failed to assist deal draft.",
    };
  }
}
