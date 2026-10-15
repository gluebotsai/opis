/**
 * Product / invoice / activity / quote draft assists — thin pass-through to Python crm-agent.
 */

import {
  COWORKER_LLM_ERROR_SPEECH,
  lastUserText,
  type CoworkerMessage,
} from "@/service/ai/coworker-shared";
import { callAiServiceAgent, AI_SERVICE_DEFAULT_TIMEOUT_MS } from "@/service/ai/ai-service-client";
import { coworkerExecutionMode } from "@/service/ai/coworker-execution-mode";
import { getServerUserId } from "@/service/account/session-cookie";
import {
  canEditDeals,
  canEditFinance,
  canEditProducts,
  canEditContacts,
} from "@/service/auth/rbac";
import {
  getCurrentBusinessType,
  getCurrentOrganizationId,
  getCurrentUserRole,
  requireRole,
} from "@/service/auth/require-role";
import { enrichActivitiesCreateCatalog } from "@/service/ai/coworker-activity-catalog";
import { getDealFormOptionsCommand } from "@/service/sales/deal-commands";
import { getInvoiceCreateOptionsCommand } from "@/service/finance/invoice-commands";

export type ProductDraftPatch = {
  name?: string;
  sku?: string;
  brand?: string;
  category?: string;
  subcategory?: string;
  description?: string;
  price?: string;
  currency?: string;
  status?: string;
  active?: boolean;
  productType?: string;
  billingType?: string;
  billingFrequency?: string;
};

export type InvoiceDraftPatch = {
  dealId?: string;
  currency?: string;
  notes?: string;
  paymentTerms?: string;
};

export type ActivityDraftPatch = {
  contactId?: string;
  type?: string;
  subject?: string;
  body?: string;
  dueAt?: string;
};

export type QuoteDraftPatch = {
  dealId?: string;
  discountPct?: string;
  productId?: string;
  quantity?: string;
};

async function orgId(): Promise<string | null> {
  try {
    return await getCurrentOrganizationId();
  } catch {
    return null;
  }
}

type DraftToolProposal = {
  id: string;
  name: string;
  label: string;
  args: Record<string, unknown>;
  risk: "low" | "high";
};

async function callCrmDraft<T>(input: {
  intent: string;
  messages: CoworkerMessage[];
  module: string;
  draft?: Record<string, unknown>;
  catalog?: Record<string, unknown>;
  pathname?: string | null;
  sessionMemory?: Record<string, unknown> | null;
}): Promise<
  | {
      ok: true;
      assistantText: string;
      patch?: T;
      toolProposals?: DraftToolProposal[];
      sessionMemoryPatch?: Record<string, unknown>;
      sessionMemory?: Record<string, unknown>;
    }
  | { ok: false; error: string }
> {
  const organizationId = await orgId();
  const actingUserId = await getServerUserId();
  let role: string | null = null;
  let businessType: string | null = null;
  try {
    role = await getCurrentUserRole();
  } catch {
    role = null;
  }
  try {
    businessType = await getCurrentBusinessType();
  } catch {
    businessType = null;
  }
  const executionMode = coworkerExecutionMode(organizationId, actingUserId);

  const result = await callAiServiceAgent<{
    ok?: boolean;
    error?: string;
    assistantText?: string;
    patch?: T;
    toolProposals?: DraftToolProposal[];
    sessionMemoryPatch?: Record<string, unknown>;
    sessionMemory?: Record<string, unknown>;
  }>(
    "crm-agent",
    {
      intent: input.intent,
      messages: input.messages,
      context: {
        module: input.module,
        surface: "create",
        draft: input.draft ?? {},
        pathname: input.pathname || undefined,
        sessionMemory: input.sessionMemory ?? null,
        organizationId: organizationId ?? undefined,
        actingUserId: actingUserId ?? undefined,
        role: role ?? undefined,
        businessType: businessType ?? undefined,
        executionMode,
      },
      catalog: {
        currentDraft: input.draft ?? {},
        organizationId: organizationId ?? undefined,
        actingUserId: actingUserId ?? undefined,
        role: role ?? undefined,
        businessType: businessType ?? undefined,
        ...(input.catalog ?? {}),
      },
      organizationId,
      actingUserId,
      role,
      businessType,
      executionMode,
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
      // Chat "yes" / confirm emits propose_create_* — must reach the UI.
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

export async function productDraftAssistCommand(input: {
  messages?: CoworkerMessage[];
  draft?: ProductDraftPatch;
  pathname?: string | null;
  sessionMemory?: Record<string, unknown> | null;
}): Promise<
  | { ok: true; assistantText: string; patch?: ProductDraftPatch }
  | { ok: false; error: string }
> {
  try {
    await requireRole(
      canEditProducts,
      "You do not have permission to create products.",
    );
    const messages = input.messages ?? [];
    if (!lastUserText(messages)) {
      return { ok: false, error: "Send a message to update the draft." };
    }
    return callCrmDraft<ProductDraftPatch>({
      intent: "product_draft",
      messages,
      module: "product",
      draft: input.draft,
      pathname: input.pathname || "/product/new",
      sessionMemory: input.sessionMemory,
    });
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error ? err.message : "Failed to assist product draft.",
    };
  }
}

export async function invoiceDraftAssistCommand(input: {
  messages?: CoworkerMessage[];
  draft?: InvoiceDraftPatch;
  pathname?: string | null;
  sessionMemory?: Record<string, unknown> | null;
}): Promise<
  | { ok: true; assistantText: string; patch?: InvoiceDraftPatch }
  | { ok: false; error: string }
> {
  try {
    await requireRole(
      canEditFinance,
      "You do not have permission to create invoices.",
    );
    const messages = input.messages ?? [];
    if (!lastUserText(messages)) {
      return { ok: false, error: "Send a message to update the draft." };
    }
    const options = await getInvoiceCreateOptionsCommand();
    const deals = (options.deals ?? []).map(
      (d: { id: string; title: string; companyName?: string }) => ({
        id: d.id,
        title: d.title,
        companyName: d.companyName ?? "",
        contactName: "",
      }),
    );
    return callCrmDraft<InvoiceDraftPatch>({
      intent: "invoice_draft",
      messages,
      module: "finance",
      draft: input.draft,
      catalog: { deals: deals.slice(0, 50) },
      pathname: input.pathname || "/finance/new",
      sessionMemory: input.sessionMemory,
    });
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error ? err.message : "Failed to assist invoice draft.",
    };
  }
}

export async function activityDraftAssistCommand(input: {
  messages?: CoworkerMessage[];
  draft?: ActivityDraftPatch;
  pathname?: string | null;
  sessionMemory?: Record<string, unknown> | null;
}): Promise<
  | { ok: true; assistantText: string; patch?: ActivityDraftPatch }
  | { ok: false; error: string }
> {
  try {
    await requireRole(
      canEditContacts,
      "You do not have permission to log activities.",
    );
    const messages = input.messages ?? [];
    if (!lastUserText(messages)) {
      return { ok: false, error: "Send a message to update the draft." };
    }
    const options = await getDealFormOptionsCommand();
    const catalog: Record<string, unknown> = {
      contacts: options.contacts.map((c) => ({
        id: c.id,
        displayName: c.displayName,
        email: c.email,
        companyId: c.companyId,
      })),
      currentDraft: input.draft ?? {},
    };
    await enrichActivitiesCreateCatalog(catalog, input.sessionMemory);
    const contacts = Array.isArray(catalog.contacts)
      ? catalog.contacts
      : options.contacts;
    return callCrmDraft<ActivityDraftPatch>({
      intent: "activity_draft",
      messages,
      module: "activities",
      draft: input.draft,
      catalog: {
        ...catalog,
        contacts: (contacts as typeof options.contacts).slice(0, 200),
      },
      pathname: input.pathname || "/activities/log",
      sessionMemory: input.sessionMemory,
    });
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error ? err.message : "Failed to assist activity draft.",
    };
  }
}

export async function quoteDraftAssistCommand(input: {
  messages?: CoworkerMessage[];
  draft?: QuoteDraftPatch;
  pathname?: string | null;
  sessionMemory?: Record<string, unknown> | null;
}): Promise<
  | { ok: true; assistantText: string; patch?: QuoteDraftPatch }
  | { ok: false; error: string }
> {
  try {
    await requireRole(
      canEditDeals,
      "You do not have permission to create quotes.",
    );
    const messages = input.messages ?? [];
    if (!lastUserText(messages)) {
      return { ok: false, error: "Send a message to update the draft." };
    }
    return callCrmDraft<QuoteDraftPatch>({
      intent: "quote_draft",
      messages,
      module: "quotes",
      draft: input.draft,
      pathname: input.pathname || "/sales/quotes/new",
      sessionMemory: input.sessionMemory,
    });
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error ? err.message : "Failed to assist quote draft.",
    };
  }
}
