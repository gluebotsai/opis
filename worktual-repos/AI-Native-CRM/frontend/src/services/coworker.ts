import { api } from "./api";
import type {
  StructuredAnalytics,
} from "./agent-stream";
import { notifyCrmSessionRevoked } from "@/lib/crm-session-revoked";
import { sendCoworkerAgentTurn } from "./coworker-socket";

type Msg = Array<{ role: "assistant" | "user"; text: string }>;

export type AgentToolProposal = {
  id: string;
  name: string;
  label: string;
  args: Record<string, unknown>;
  risk: "low" | "high";
};

async function assistDraft<T extends Record<string, unknown>>(
  path: string,
  input: {
    messages: Msg;
    draft: Partial<T>;
    companyId?: string;
    pathname?: string;
    sessionMemory?: CoworkerSessionMemory | null;
    sourceContactId?: string | null;
  },
) {
  const pathname =
    input.pathname ||
    (typeof window !== "undefined" ? window.location.pathname : undefined);
  const { data } = await api.post(`/api/coworker/${path}`, {
    ...input,
    pathname,
  });
  return data as
    | {
        ok: true;
        assistantText: string;
        patch?: Partial<T>;
        toolProposals?: AgentToolProposal[];
        sessionMemoryPatch?: CoworkerSessionMemoryPatch;
        sessionMemory?: CoworkerSessionMemory;
      }
    | { ok: false; error: string };
}

export type DealDraftFields = {
  title: string;
  stage: string;
  amount: string;
  companyId: string;
  /** Typed company label — used when picking from list or creating a new company. */
  companyName: string;
  locationId: string;
  contactId: string;
  contactName: string;
  currency: string;
  notes: string;
  expectedCloseDate: string;
};

export type ContactDraftFields = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  title: string;
  companyId: string;
  locationId: string;
  companyName: string;
  companyDomain: string;
  companyIndustry: string;
  contactType: string;
  leadStatus: string;
  notes: string;
  city: string;
  country: string;
  addressLine: string;
  leadSource: string;
  status: string;
  ownerUserId: string;
  tags: string;
  secondaryEmails: string;
  secondaryPhones: string;
  bantBudget: string;
  bantAuthority: string;
  bantNeed: string;
  bantTimeline: string;
  /** Comma-separated optional fields the user skipped (phone, company, title, …). */
  skippedOptional?: string;
};

export type CompanyDraftFields = {
  name: string;
  domain: string;
  industry: string;
  locationName: string;
  locationAddress: string;
  /** Empty until the user or agent sets HQ vs branch (save defaults to HQ). */
  locationType: "hq" | "branch" | "";
  employeeCount: string;
  linkedinUrl: string;
  ownerUserId: string;
  channelRole: string;
  parentCompanyId: string;
  /** Comma-separated optional slots skipped in guided create. */
  skippedOptional?: string;
};

export type LocationDraftFields = {
  name: string;
  type: "hq" | "branch" | "";
  address: string;
  industry: string;
  skippedOptional?: string;
};

export type ProductDraftFields = {
  name: string;
  sku: string;
  brand: string;
  category: string;
  subcategory: string;
  stockOnHand: string;
  productUrl: string;
  description: string;
  price: string;
  maxDiscountPercent: string;
  currency: string;
  status: string;
  active: boolean;
  productType: string;
  billingType: string;
  billingFrequency: string;
  tags: string;
  imageUrl: string;
  /** Newline- or comma-separated URLs. */
  galleryUrls: string;
  offers: Array<{
    name: string;
    code?: string;
    includedQty?: string;
    meterKey?: string;
    status?: string;
  }>;
  addons: Array<{
    name: string;
    unitLabel?: string;
    meterKey?: string;
    isOverage?: boolean;
    pricingModel: string;
    flatPrice?: string;
    unitPrice?: string;
    stepSize?: string;
    stepPrice?: string;
    tiers?: Array<{ minQty: string; maxQty: string; unitPrice: string }>;
  }>;
  /** Comma-separated optional slot ids the user skipped in guided create. */
  skippedOptional?: string;
};

export type InvoiceDraftFields = {
  dealId: string;
  currency: string;
  notes: string;
  paymentTerms: string;
  issueDate: string;
  dueDate: string;
  billingAddress: string;
  leadEmail: string;
  leadPhone: string;
  taxId: string;
  templateId: string;
  discountPct: string;
  productId: string;
  quantity: string;
  /** productId → qty for addons on the selected product. */
  addonQuantities: Record<string, string>;
};

export type ActivityDraftFields = {
  contactId: string;
  type: string;
  subject: string;
  body: string;
  dueAt: string;
  skippedOptional?: string;
};

export type QuoteDraftFields = {
  dealId: string;
  discountPct: string;
  productId: string;
  /** Units of fixed product, or of the selected offer (packs / seats). */
  quantity: string;
  offerId: string;
  /** Selected addon id → quantity string. */
  addonQuantities: Record<string, string>;
};

export const assistDealDraft = (input: {
  messages: Msg;
  draft: Partial<DealDraftFields>;
  sessionMemory?: CoworkerSessionMemory | null;
  sourceContactId?: string | null;
}) => assistDraft<DealDraftFields>("deal-draft", input);

export const assistContactDraft = (input: {
  messages: Msg;
  draft: Partial<ContactDraftFields>;
  sessionMemory?: CoworkerSessionMemory | null;
}) => assistDraft<ContactDraftFields>("contact-draft", input);

export const assistCompanyDraft = (input: {
  messages: Msg;
  draft: Partial<CompanyDraftFields>;
  sessionMemory?: CoworkerSessionMemory | null;
}) => assistDraft<CompanyDraftFields>("company-draft", input);

export const assistLocationDraft = (input: {
  messages: Msg;
  draft: Partial<LocationDraftFields>;
  companyId?: string;
  sessionMemory?: CoworkerSessionMemory | null;
}) => assistDraft<LocationDraftFields>("location-draft", input);

export const assistProductDraft = (input: {
  messages: Msg;
  draft: Partial<ProductDraftFields>;
  sessionMemory?: CoworkerSessionMemory | null;
}) => assistDraft<ProductDraftFields>("product-draft", input);

export const assistInvoiceDraft = (input: {
  messages: Msg;
  draft: Partial<InvoiceDraftFields>;
  sessionMemory?: CoworkerSessionMemory | null;
}) => assistDraft<InvoiceDraftFields>("invoice-draft", input);

export const assistActivityDraft = (input: {
  messages: Msg;
  draft: Partial<ActivityDraftFields>;
  sessionMemory?: CoworkerSessionMemory | null;
}) => assistDraft<ActivityDraftFields>("activity-draft", input);

export const assistQuoteDraft = (input: {
  messages: Msg;
  draft: Partial<QuoteDraftFields>;
  sessionMemory?: CoworkerSessionMemory | null;
}) => assistDraft<QuoteDraftFields>("quote-draft", input);

export type PageAssistAction = {
  type: "navigate";
  label: string;
  href: string;
};

export async function assistPageContext(input: {
  messages: Msg;
  context: {
    module?: string | null;
    surface?: string | null;
    entityId?: string | null;
    pathname?: string | null;
  };
}) {
  const { data } = await api.post("/api/coworker/page-assist", input);
  return data as
    | {
        ok: true;
        assistantText: string;
        actions?: PageAssistAction[];
      }
    | { ok: false; error: string };
};

export type CoworkerSessionMemory = {
  conversationId?: string;
  activeAgent?: string;
  activeDomain?: string;
  pendingIntent?: string;
  /** Next create/list ask, e.g. contact_phone | contact_company | company_location */
  pendingAsk?: string;
  /** Sticky entities + create progress (skippedOptional, createModule, dealId, …) */
  slots?: Record<string, unknown>;
  lastEntities?: Record<string, string>;
};

export type CoworkerSessionMemoryPatch = CoworkerSessionMemory & {
  clear?: boolean;
};

/** Merge a server sessionMemoryPatch into client-held short-term memory. */
export function mergeSessionMemoryPatch(
  current: CoworkerSessionMemory,
  patch?: CoworkerSessionMemoryPatch | null,
): CoworkerSessionMemory {
  if (!patch) return current;
  if (patch.clear) return {};
  const next: CoworkerSessionMemory = {
    ...current,
    slots: { ...(current.slots ?? {}) },
    lastEntities: { ...(current.lastEntities ?? {}) },
  };
  if ("pendingIntent" in patch) {
    next.pendingIntent = String(patch.pendingIntent ?? "");
  }
  if ("pendingAsk" in patch) {
    next.pendingAsk = String(patch.pendingAsk ?? "");
  }
  if (patch.conversationId) {
    next.conversationId = String(patch.conversationId);
  }
  if ("activeAgent" in patch) {
    next.activeAgent = String(patch.activeAgent ?? "");
  }
  if ("activeDomain" in patch) {
    next.activeDomain = String(patch.activeDomain ?? "");
  }
  if (patch.slots && typeof patch.slots === "object") {
    const slots = { ...(next.slots ?? {}) };
    for (const [k, v] of Object.entries(patch.slots)) {
      if (v == null || v === "" || (Array.isArray(v) && v.length === 0)) {
        delete slots[k];
      } else {
        slots[k] = v;
      }
    }
    next.slots = slots;
  }
  if (patch.lastEntities && typeof patch.lastEntities === "object") {
    const last = { ...(next.lastEntities ?? {}) };
    for (const [k, v] of Object.entries(patch.lastEntities)) {
      if (v == null || v === "") delete last[k];
      else last[k] = String(v);
    }
    next.lastEntities = last;
  }
  return next;
}

export async function assistAgentTurn(input: {
  messages: Msg;
  context: {
    module?: string | null;
    surface?: string | null;
    entityId?: string | null;
    pathname?: string | null;
    draft?: Record<string, unknown> | null;
    pageSnapshot?: Record<string, string>;
  };
  sessionMemory?: CoworkerSessionMemory | null;
  confirmTool?: { name: string; args?: Record<string, unknown> } | null;
}) {
  type TurnResult =
    | {
        ok: true;
        assistantText: string;
        toolProposals?: AgentToolProposal[];
        contactDraftPatch?: Partial<ContactDraftFields>;
        patch?: Record<string, unknown>;
        sessionMemoryPatch?: CoworkerSessionMemoryPatch;
        sessionMemory?: CoworkerSessionMemory;
        uiRefresh?: {
          modules?: string[];
          entityIds?: string[];
          reason?: string;
          href?: string;
          seoProgress?: {
            stage?: string;
            label?: string;
            detail?: string | null;
          };
          seoContent?: Record<string, unknown>;
          seoKeywords?: Record<string, unknown>;
          seoSocial?: Record<string, unknown>;
        };
        analytics?: StructuredAnalytics;
        suggestions?: string[];
        conversationId?: string;
        runId?: string;
        traceId?: string;
        idempotencyKey?: string;
        traceparent?: string;
      }
    | { ok: false; error: string; assistantText?: string };

  const isSessionExpiredError = (message: string) =>
    /unauthorized|sign in again|session.*expired|not authenticated/i.test(
      message,
    );

  const endSession = (error: string): TurnResult => {
    notifyCrmSessionRevoked();
    return { ok: false as const, error };
  };

  try {
    const data = (await sendCoworkerAgentTurn(input)) as TurnResult;
    if (
      data &&
      typeof data === "object" &&
      "ok" in data &&
      data.ok === false &&
      typeof data.error === "string" &&
      isSessionExpiredError(data.error)
    ) {
      return endSession(data.error);
    }
    return data;
  } catch (err) {
    // Socket can stick after API restarts; REST agent-turn is the durable path.
    try {
      const { data, status } = await api.post("/api/coworker/agent-turn", input, {
        timeout: 240_000,
      });
      const result = data as TurnResult;
      if (status === 401) {
        const msg =
          result &&
          typeof result === "object" &&
          "error" in result &&
          typeof result.error === "string"
            ? result.error
            : "Unauthorized — please sign in again.";
        return endSession(msg);
      }
      if (
        result &&
        typeof result === "object" &&
        "ok" in result &&
        result.ok === false &&
        typeof result.error === "string" &&
        isSessionExpiredError(result.error)
      ) {
        return endSession(result.error);
      }
      return result;
    } catch (httpErr) {
      const msg =
        err instanceof Error && err.message.trim()
          ? err.message.trim()
          : httpErr instanceof Error && httpErr.message.trim()
            ? httpErr.message.trim()
            : "Unable to reach the coworker service. Please try again.";
      return { ok: false as const, error: msg };
    }
  }
}

/** Confirm propose_* via Python MCP (agent-turn confirmTool). */
export async function confirmCoworkerTool(input: {
  name: string;
  args?: Record<string, unknown>;
  context: {
    module?: string | null;
    surface?: string | null;
    entityId?: string | null;
    pathname?: string | null;
    draft?: Record<string, unknown> | null;
  };
  sessionMemory?: CoworkerSessionMemory | null;
  messages?: Msg;
}) {
  return assistAgentTurn({
    messages: input.messages ?? [],
    context: input.context,
    sessionMemory: input.sessionMemory,
    confirmTool: { name: input.name, args: input.args },
  });
}

