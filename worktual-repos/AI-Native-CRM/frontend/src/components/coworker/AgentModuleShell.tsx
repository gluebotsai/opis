import { emailAddresses } from "@/lib/coworker/email-addresses";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
  type ReactNode,
} from "react";
import { flushSync } from "react-dom";
import { useLocation, useNavigate } from "react-router-dom";
import { Expand, PanelRightClose, Shrink } from "lucide-react";
import { SeoGenerateProgress } from "@/components/marketing/SeoGenerateProgress";
import { CoworkerProgressPill } from "@/components/coworker/CoworkerProgressPill";
import {
  SEO_AGENT_PROMPT_EVENT,
  type SeoAgentPromptDetail,
} from "@/components/marketing/ContentMarketingWorkspace";
import { CoworkerChatFab, CoworkerWorkspaceFab } from "@/components/coworker/CoworkerChatFab";
import { CoworkerChatShell } from "@/components/coworker/CoworkerChatShell";
import { CoworkerWorkspace } from "@/components/coworker/CoworkerWorkspace";
import {
  COWORKER_ICON_BTN_CLASS,
  COWORKER_PANEL_HEADER_CLASS,
} from "@/components/coworker/coworker-layout";
import { WORKTUAL_CONTROL_RADIUS, WORKTUAL_WORKSPACE_PANEL } from "@/lib/worktual-control-tokens";
import { clearOpenWorkspace, peekOpenWorkspace } from "@/lib/nav-return";
import { writeCoworkerExpandPreference } from "@/lib/coworker-expand-preference";
import type {
  CoworkerAttachment,
  CoworkerMessage,
  CoworkerSuggestion,
} from "@/components/coworker/types";
import { Button } from "@/components/ui/Button";
import {
  buildCreateHandoffHref,
  isCreateHandoffHref,
  isSeededCreateHandoffTool,
  rememberHandoffContact,
  withHandoffContact,
  withHandoffDeal,
} from "@/lib/coworker/create-handoff";
import {
  useCoworkerThread,
  withModuleWelcome,
} from "@/lib/coworker/coworker-thread";
import { useDraftSessionMemory } from "@/lib/coworker/use-draft-session-memory";
import {
  configurationSubHref,
  inferModuleFromLabel,
  navigationClarification,
} from "@/lib/coworker/nav-routing";
import {
  mergeActivityDraftPatchFromTurn,
  pickActivityDraftPatch,
} from "@/lib/coworker/activity-draft-patch";
import { newCoworkerMessageId } from "@/lib/coworker/draft-progress";
import { runContactImportCoworkerTool } from "@/lib/coworker/contact-import-mutation";
import {
  COWORKER_LLM_ERROR_SPEECH,
  contactDraftNamedClient,
  contactDraftSaveReadyClient,
  draftReadyClientForModule,
  looksLikeCreateConfirmClient,
  shouldPersistCompanyDraftClient,
  looksLikeDeleteConfirmPromptClient,
  looksLikeDeleteConfirmReplyClient,
  quoteDraftReadyClient,
  sanitizeAssistantTextForUser,
} from "@/lib/coworker/sanitize-assistant-text";
import {
  REQUIREMENT_FILE_ACCEPT,
  REQUIREMENT_FILE_MAX_BYTES,
  REQUIREMENT_FILE_TYPES_LABEL,
  isRequirementUploadFile,
} from "@/lib/requirement-file";
import {
  assistAgentTurn,
  confirmCoworkerTool,
  mergeSessionMemoryPatch,
  type AgentToolProposal,
  type CoworkerSessionMemory,
  type CoworkerSessionMemoryPatch,
} from "@/services/coworker";
import { createProposal, updateDealStage } from "@/services/sales";
import { fetchContactDetail } from "@/services/contacts";
import {
  cancelScheduledInboxEmail,
  saveInboxDraft,
  scheduleInboxEmail,
  sendInboxEmail,
  updateInboxFolder,
} from "@/services/inbox";
import type { CoworkerEmailDraft } from "./types";
import {
  createQuote,
  createQuoteFromRequirement,
} from "@/services/quotes";
import {
  setCoworkerExpand,
  toggleCoworkerExpand,
  useAppDispatch,
  useAppSelector,
} from "@/store";

export type WorkspaceMode = "list" | "create" | "detail";

function draftRecipients(
  argsTo: unknown,
  priorTo: string | undefined,
  contactEmails: string[],
): string {
  const requested = emailAddresses(argsTo);
  if (requested.length) return requested.join(", ");
  const prior = emailAddresses(priorTo || "");
  if (prior.length) return prior.join(", ");
  if (contactEmails.length) return contactEmails.join(", ");
  return "";
}

function normalizeAssistantLine(text: string): string {
  return text.replace(/\*\*/g, "").replace(/\s+/g, " ").trim().toLowerCase();
}

/** Skip when the model already spoke the same confirmation this turn. */
function appendAssistantIfNew(
  prev: CoworkerMessage[],
  text: string,
): CoworkerMessage[] {
  const trimmed = text.trim();
  if (!trimmed) return prev;
  for (let i = prev.length - 1; i >= 0; i--) {
    if (prev[i].role !== "assistant") continue;
    if (
      normalizeAssistantLine(prev[i].text) === normalizeAssistantLine(trimmed)
    ) {
      return prev;
    }
    break;
  }
  return [
    ...prev,
    { id: newCoworkerMessageId(), role: "assistant", text: trimmed },
  ];
}

/**
 * Page-owned creates (Fastify forms / template assembly). MCP stubs must not
 * short-circuit these — otherwise chat says "created" while the workspace
 * never navigates to the real document (proposal) or never submits the draft.
 */
const FORM_OWNED_PROPOSE_TOOLS = new Set([
  "propose_create_contact",
  "propose_import_contacts",
  "propose_pull_prospect_leads",
  // Fastify updateContact / deleteContact — MCP must not stub notes-only writes.
  "propose_update_contact",
  "propose_set_lead_score",
  "propose_delete_contact",
  "propose_create_deal",
  "propose_update_deal",
  "propose_reassign_deal_owner",
  "propose_delete_deal",
  "propose_create_company",
  "propose_update_company",
  "propose_update_company_location",
  "propose_delete_company",
  "propose_create_product",
  "propose_update_product",
  "propose_delete_product",
  "propose_create_activity",
  "propose_save_email_draft",
  "propose_send_email",
  "propose_schedule_email",
  "propose_create_proposal",
  "propose_create_quote",
  "propose_update_quote",
  "propose_delete_quote",
  "propose_send_quote",
  "propose_create_invoice",
  "propose_update_invoice",
  "propose_delete_invoice",
  "propose_send_invoice",
  "propose_mark_invoice_paid",
  "propose_rewrite_proposal_section",
  "propose_patch_proposal_section",
  "propose_patch_proposal_document_text",
  "propose_rewrite_quote_section",
  "propose_update_document_asset",
  "propose_personalize_proposal",
  "propose_send_proposal",
  "propose_delete_proposal",
]);

type UiRefreshPayload = {
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

/** Module list pages that keep create in-shell instead of navigating to /…/new. */
export const IN_SHELL_CREATE_PATHS: Record<string, string> = {
  contact: "/contact/new",
  sales: "/sales/new",
  company: "/company/new",
  product: "/product/new",
  finance: "/finance/new",
  activities: "/activities/log",
  quotes: "/sales/quotes/new",
};

const MODULE_LIST_PATHS: Record<string, string> = {
  contact: "/contact",
  sales: "/sales",
  company: "/company",
  product: "/product",
  finance: "/finance",
  activities: "/activities",
  quotes: "/sales/quotes",
  calendar: "/sales/calendar",
  dashboard: "/dashboard",
  inbox: "/inbox",
  reports: "/reports",
  marketing: "/marketing/dashboard",
  agents: "/agents",
  commerce: "/commerce",
  service: "/service",
  configuration: "/configuration/email",
  "configuration-proposal-patterns": "/configuration/proposal-patterns",
  "configuration-proposal-templates": "/configuration/proposal-patterns",
  "configuration-quote-templates": "/configuration/quote-templates",
  "configuration-invoice-templates": "/configuration/invoice-templates",
  "configuration-developers": "/configuration/developers",
};

/** When a create seed is attached to a list href, open the create hybrid instead. */
const LIST_TO_CREATE_HANDOFF: Record<string, string> = {
  "/contact": "/contact/new",
  "/sales": "/sales/new",
  "/company": "/company/new",
  "/product": "/product/new",
  "/finance": "/finance/new",
  "/activities": "/activities/log",
  "/sales/quotes": "/sales/quotes/new",
};

function looksLikeCreateSeed(seed: string): boolean {
  return /\b(create|add|new|log)\b/i.test(seed.trim());
}

/** SEO pipeline UI only for generate turns — not casual chat or revise asks. */
function looksLikeSeoGenerateTurn(text: string): boolean {
  const t = text.trim().toLowerCase();
  if (!t) return false;
  // Customize / revise flows should use the normal thinking pill.
  if (
    /\b(revise|customize|update and save|what i'?d like to change)\b/.test(t)
  ) {
    return false;
  }
  return (
    /\b(find keywords|research keywords|write an seo|generate .+posts?|keyword generation|content generation|show them in keyword)\b/.test(
      t,
    ) ||
    /\b(keywords for|primary keyword|derive strong keyword)\b/.test(t)
  );
}

const ALLOWED_NAV_PREFIXES = [
  "/dashboard",
  "/contact",
  "/company",
  "/product",
  "/sales",
  "/finance",
  "/inbox",
  "/activities",
  "/commerce",
  "/configuration",
  "/reports",
  "/agents",
  "/process-approvals",
  "/service",
  "/marketing",
] as const;

const NAV_ALIASES: Record<string, string> = {
  "/calendar": "/sales/calendar",
  "/quotes": "/sales/quotes",
  "/quote": "/sales/quotes",
  "/deals": "/sales",
  "/pipeline": "/sales",
  "/companies": "/company",
  "/contacts": "/contact",
  "/products": "/product",
  "/invoices": "/finance",
  "/billing": "/finance",
  "/home": "/dashboard",
  "/settings": "/configuration/email",
  "/config": "/configuration/email",
  "/email": "/configuration/email",
};

function normalizeNavHref(href: string): string | null {
  const raw = href.trim();
  if (!raw.startsWith("/") || raw.startsWith("//")) return null;
  const pathOnly = raw.split("?")[0]?.split("#")[0] || "/";
  const query = raw.includes("?") ? raw.slice(pathOnly.length) : "";
  let path = NAV_ALIASES[pathOnly] ?? pathOnly;
  if (path.length > 1 && path.endsWith("/")) path = path.replace(/\/+$/, "");
  const allowed = ALLOWED_NAV_PREFIXES.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`),
  );
  if (!allowed) return null;
  return path + query;
}

/** When set_workspace can't run on this page, turn it into a silent navigate. */
function workspaceToolAsNavigate(
  tool: AgentToolProposal,
  currentModuleId: string,
): AgentToolProposal | null {
  if (tool.name !== "set_workspace") return null;
  const mode = String(tool.args.mode || "list");
  const subHref = configurationSubHref(tool.label || "");
  const inferred =
    inferModuleFromLabel(tool.label) ||
    (subHref ? null : currentModuleId in MODULE_LIST_PATHS ? currentModuleId : null);
  if (subHref) {
    const href = normalizeNavHref(subHref);
    if (!href) return null;
    return {
      ...tool,
      name: "navigate",
      label: tool.label,
      args: { href, auto: true },
      risk: "low",
    };
  }
  if (!inferred) return null;
  if (mode === "create" && IN_SHELL_CREATE_PATHS[inferred]) {
    const seed =
      typeof tool.args.seedPrompt === "string"
        ? tool.args.seedPrompt.trim()
        : "";
    const href = normalizeNavHref(IN_SHELL_CREATE_PATHS[inferred] ?? "");
    if (!href) return null;
    return {
      ...tool,
      name: "navigate",
      label: tool.label,
      args: {
        href,
        auto: true,
        ...(seed ? { seedPrompt: seed } : {}),
      },
      risk: "low",
    };
  }
  if (mode === "detail") {
    const entityId =
      typeof tool.args.entityId === "string" ? tool.args.entityId.trim() : "";
    if (entityId) {
      const detailPaths: Record<string, string> = {
        contact: `/contact?view=detail&id=${entityId}`,
        sales: `/sales/${entityId}`,
        company: `/company/${entityId}`,
        product: `/product/${entityId}`,
      };
      const href = detailPaths[inferred];
      if (href) {
        return {
          ...tool,
          name: "navigate",
          label: tool.label,
          args: { href, auto: true },
          risk: "low",
        };
      }
    }
  }
  const href = normalizeNavHref(MODULE_LIST_PATHS[inferred] ?? "");
  if (!href) return null;
  return {
    ...tool,
    name: "navigate",
    label: tool.label,
    args: { href, auto: true },
    risk: "low",
  };
}

const IN_SHELL_CREATE_LABELS: Record<string, string> = {
  contact: "Create contact",
  sales: "Create deal",
  company: "Create company",
  product: "Create product",
  finance: "Create invoice",
  activities: "Log activity",
  quotes: "Create quote",
};

const CHAT_PLACEHOLDERS: Record<string, string> = {
  contact: "Create or find a contact…",
  sales: "Ask about deals or pipeline…",
  company: "Create or find a company…",
  product: "Add or find a product…",
  finance: "Ask about invoices…",
  activities: "Log or find activity…",
  quotes: "Draft or edit a quote…",
  configuration: "Ask about settings…",
};

export type AgentModuleShellProps = {
  moduleId: string;
  title: string;
  welcome: string;
  chips?: CoworkerSuggestion[];
  surface?: string;
  entityId?: string | null;
  workspace: ReactNode;
  /** Current in-module workspace mode (list|create|detail). */
  workspaceMode?: WorkspaceMode | string | null;
  /** Draft snapshot when filling a create form in-shell. */
  draft?: Record<string, unknown> | null;
  /** Extra tool execution beyond built-in navigate / stage change / set_workspace.
   * Return true on success, false/void to skip, or a string error to show in chat.
   * For propose_import_contacts, a string starting with "Imported" is the success summary. */
  onToolConfirm?: (
    tool: AgentToolProposal,
  ) => Promise<boolean | string | void> | boolean | string | void;
  /** Handle set_workspace (and in-module create rewrite). Return true if handled. */
  onWorkspaceCommand?: (
    tool: AgentToolProposal,
  ) => Promise<boolean | void> | boolean | void;
  /** Apply a draft patch from agent-turn (create mode). */
  onDraftPatch?: (patch: Record<string, unknown>) => void;
  /** @deprecated use onDraftPatch */
  onContactDraftPatch?: (patch: Record<string, unknown>) => void;
  onAfterTool?: () => void;
  /** Seed utterance to auto-send once (e.g. after set_workspace create). */
  seedPrompt?: string | null;
  /** What the user actually typed, when seedPrompt is an internal rephrase. */
  seedDisplayText?: string | null;
  onSeedPromptConsumed?: () => void;
  /**
   * Expanding workspace goes full-width and chat collapses to a floating
   * Ask CRM button (same as pipeline / dashboard).
   */
  collapseChatToFab?: boolean;
  /** Ephemeral STM merged into each agent turn (e.g. pending duplicate contacts). */
  sessionMemoryExtraRef?: MutableRefObject<CoworkerSessionMemory | null>;
  /** Dashboard period / filter sync for analytics agent (CCaaS-style). */
  pageSnapshot?: Record<string, string>;
  /** Replaces the default "Workspace" label in the right-pane header. */
  workspaceTitle?: string;
  workspaceSubtitle?: string;
  /** Replaces default title/subtitle block (e.g. Reports header copy). */
  workspaceHeaderLeading?: ReactNode;
  workspaceHeaderActions?: ReactNode;
  /** Taller workspace header when leading includes a description line. */
  workspaceHeaderTall?: boolean;
  /** Hide the generic Workspace header so the pane can own mockup chrome. */
  hideWorkspaceHeader?: boolean;
  /** Chat panel title. Defaults to "co-worker". */
  chatTitle?: string;
  /** Seed the chat transcript (e.g. SEO mock conversation). */
  initialMessages?: CoworkerMessage[];
};

function sessionMemoryForTurn(
  base: CoworkerSessionMemory,
  extra?: CoworkerSessionMemory | null,
): CoworkerSessionMemory {
  if (!extra) return base;
  return mergeSessionMemoryPatch(base, extra);
}

function hrefWithModuleHandoffs(
  href: string,
  moduleId: string,
  entityId?: string | null,
): string {
  let out = withHandoffContact(
    href,
    moduleId === "contact" ? entityId || "" : "",
  );
  if (moduleId === "sales" && entityId) {
    out = withHandoffDeal(out, entityId);
  }
  return out;
}

function navigateHrefForTool(
  tool: AgentToolProposal,
  fallbackSeed?: string,
): string | null {
  const raw = String(tool.args.href || "");
  const normalized = normalizeNavHref(raw);
  if (!normalized) return null;
  let path = normalized.split("?")[0] ?? normalized;
  const seed =
    (typeof tool.args.seedPrompt === "string" && tool.args.seedPrompt.trim()) ||
    fallbackSeed?.trim() ||
    "";
  const typed = fallbackSeed?.trim() || "";
  const displayText = typed && typed !== seed ? typed : undefined;
  // Dashboard (and other non-shell pages) sometimes get navigate→list instead of
  // /…/new. Upgrade create intents so the form actually opens.
  if (seed && LIST_TO_CREATE_HANDOFF[path] && looksLikeCreateSeed(seed)) {
    path = LIST_TO_CREATE_HANDOFF[path]!;
  }
  const originalPath = normalized.split("?")[0] ?? normalized;
  if (!seed) return path === originalPath ? normalized : path;
  // Create handoffs and list/detail handoffs both need ?prompt= so the next
  // page's coworker can continue (bare /sales used to drop the seed).
  if (isCreateHandoffHref(path)) {
    return buildCreateHandoffHref(path, seed, displayText);
  }
  const params = new URLSearchParams(
    path === (normalized.split("?")[0] ?? "") && normalized.includes("?")
      ? normalized.slice(normalized.indexOf("?") + 1)
      : "",
  );
  params.set("prompt", seed.slice(0, 2000));
  if (displayText) params.set("said", displayText.slice(0, 500));
  return `${path}?${params.toString()}`;
}

function isInShellCreateNavigate(
  tool: AgentToolProposal,
  moduleId: string,
  pathname: string,
): boolean {
  if (tool.name !== "navigate" && tool.name !== "open_entity") return false;
  const path = String(tool.args.href || "").split("?")[0] ?? "";
  const expected = IN_SHELL_CREATE_PATHS[moduleId];
  if (expected && path === expected) return true;
  // Quotes list lives under /sales/quotes — match even if moduleId is sales
  if (
    path === "/sales/quotes/new" &&
    (moduleId === "quotes" || pathname.startsWith("/sales/quotes"))
  ) {
    return true;
  }
  return false;
}

function draftPatchFromTurn(
  moduleId: string,
  result: {
    patch?: Record<string, unknown>;
    contactDraftPatch?: Record<string, unknown>;
    toolProposals?: AgentToolProposal[] | null;
  },
): Record<string, unknown> {
  if (moduleId === "activities") {
    return (
      mergeActivityDraftPatchFromTurn({
        patch: result.patch ?? result.contactDraftPatch,
        toolProposals: result.toolProposals,
      }) ?? {}
    );
  }
  return (result.patch ?? result.contactDraftPatch ?? {}) as Record<
    string,
    unknown
  >;
}

function isSilentWorkspaceTool(tool: AgentToolProposal): boolean {
  // Clarification is spoken in chat only — never a Confirm chip.
  if (tool.name === "ask_clarification") {
    return true;
  }

  // Page-clone visible text edits must apply immediately — chat "yes" should not
  // require a separate Confirm chip while the agent already said it is done.
  if (tool.name === "propose_patch_proposal_document_text") {
    return true;
  }

  const autoRaw = tool.args?.auto;
  const auto =
    autoRaw === true ||
    autoRaw === "true" ||
    autoRaw === 1 ||
    autoRaw === "1";

  // Chat-confirmed create/update/delete runs silently (user already said so in chat).
  // Chat-confirmed mutations (including stage when user asked in chat) run silently.
  if (
    tool.name === "propose_create_contact" ||
    tool.name === "propose_import_contacts" ||
    tool.name === "propose_pull_prospect_leads" ||
    tool.name === "propose_update_contact" ||
    tool.name === "propose_set_lead_score" ||
    tool.name === "propose_delete_contact" ||
    tool.name === "propose_create_deal" ||
    tool.name === "propose_update_deal" ||
    tool.name === "propose_reassign_deal_owner" ||
    tool.name === "propose_delete_deal" ||
    tool.name === "propose_create_company" ||
    tool.name === "propose_update_company" ||
    tool.name === "propose_update_company_location" ||
    tool.name === "propose_delete_company" ||
    tool.name === "propose_create_product" ||
    tool.name === "propose_update_product" ||
    tool.name === "propose_delete_product" ||
    tool.name === "propose_create_invoice" ||
    tool.name === "propose_update_invoice" ||
    tool.name === "propose_delete_invoice" ||
    tool.name === "propose_send_invoice" ||
    tool.name === "propose_mark_invoice_paid" ||
    tool.name === "propose_create_quote" ||
    tool.name === "propose_update_quote" ||
    tool.name === "propose_delete_quote" ||
    tool.name === "propose_send_quote" ||
    tool.name === "propose_create_proposal" ||
    tool.name === "propose_send_proposal" ||
    tool.name === "propose_delete_proposal" ||
    tool.name === "propose_create_activity" ||
    tool.name === "propose_save_email_draft" ||
    tool.name === "propose_send_email" ||
    tool.name === "propose_schedule_email" ||
    tool.name === "propose_rewrite_proposal_section" ||
    tool.name === "propose_patch_proposal_section" ||
    tool.name === "propose_patch_proposal_document_text" ||
    tool.name === "propose_rewrite_quote_section" ||
    tool.name === "propose_update_document_asset" ||
    tool.name === "propose_personalize_proposal" ||
    tool.name === "propose_stage_change" ||
    tool.name.startsWith("patch_")
  ) {
    return auto || tool.name.startsWith("patch_") || tool.name === "propose_stage_change";
  }
  // Remaining high-risk tools still need an explicit Confirm click.
  if (tool.risk === "high") {
    return false;
  }

  if (tool.name === "set_workspace") {
    const mode = String(tool.args.mode || "");
    return (
      mode === "create" ||
      mode === "create_quote" ||
      mode === "list" ||
      mode === "detail"
    );
  }

  if (tool.name === "navigate" || tool.name === "open_entity") {
    const href = String(tool.args.href || "").trim();
    return href.startsWith("/") && !href.startsWith("//");
  }

  return false;
}

/** When the model says "saving…" but forgot the create tool, still persist. */
function syntheticCreateToolForSavingChat(input: {
  moduleId: string;
  assistantText: string;
  existing: AgentToolProposal[];
  userText: string;
  draft: Record<string, unknown> | null | undefined;
  businessType?: string | null;
}): AgentToolProposal | null {
  const { moduleId, assistantText, existing, userText, draft, businessType } =
    input;
  const userConfirmed = looksLikeCreateConfirmClient(userText);
  const text = (assistantText || "").toLowerCase();
  const savingSpeech =
    /saving .+\s+now|creating the invoice|logging that activity|writing the proposal|creating the quote|saving the quote/.test(
      text,
    );

  if (
    moduleId === "sales" &&
    quoteDraftReadyClient(draft) &&
    !existing.some((t) => t.name === "propose_create_quote")
  ) {
    if (
      savingSpeech ||
      (userConfirmed && quoteDraftReadyClient(draft))
    ) {
      if (savingSpeech && !text.includes("quote")) {
        // fall through to deal create heuristics
      } else {
        return {
          id: "synthetic-propose_create_quote",
          name: "propose_create_quote",
          label: "Create quote",
          args: { auto: true },
          risk: "low",
        };
      }
    }
  }

  const byModule: Record<string, { name: string; label: string }> = {
    quotes: { name: "propose_create_quote", label: "Create quote" },
    sales: { name: "propose_create_deal", label: "Create deal" },
    contact: { name: "propose_create_contact", label: "Create contact" },
    company: { name: "propose_create_company", label: "Create company" },
    product: { name: "propose_create_product", label: "Create product" },
    finance: { name: "propose_create_invoice", label: "Create invoice" },
    activities: { name: "propose_create_activity", label: "Log activity" },
  };
  const spec = byModule[moduleId];
  if (!spec) return null;
  if (existing.some((t) => t.name === spec.name)) return null;

  const draftReady = draftReadyClientForModule(moduleId, draft, businessType);
  // "Saving…" without the required fields is not a save — the patch may
  // arrive on a later seed turn. Creating now would submit an empty draft.
  if (!draftReady) return null;

  if (!savingSpeech && !userConfirmed) {
    return null;
  }
  if (moduleId === "quotes" && savingSpeech && !text.includes("quote")) {
    return null;
  }
  if (moduleId === "finance" && savingSpeech && !text.includes("invoice")) {
    return null;
  }
  return {
    id: `synthetic-${spec.name}`,
    name: spec.name,
    label: spec.label,
    args: { auto: true },
    risk: "low",
  };
}

/**
 * Chat-first agentic module layout (Worktual-style).
 * Low-risk workspace switches (create/list/navigate) run silently.
 * High-risk mutations (e.g. stage change) only run after the user confirms.
 * In-shell modules rewrite create navigates to set_workspace.
 */
export function AgentModuleShell({
  moduleId,
  title,
  welcome,
  surface = "list",
  entityId = null,
  workspace,
  workspaceMode = null,
  draft = null,
  onToolConfirm,
  onWorkspaceCommand,
  onDraftPatch,
  onContactDraftPatch,
  onAfterTool,
  seedPrompt = null,
  seedDisplayText = null,
  onSeedPromptConsumed,
  collapseChatToFab = true,
  sessionMemoryExtraRef,
  pageSnapshot,
  workspaceTitle,
  workspaceSubtitle,
  workspaceHeaderLeading,
  workspaceHeaderActions,
  workspaceHeaderTall,
  hideWorkspaceHeader = false,
  chatTitle = "co-worker",
  initialMessages,
}: AgentModuleShellProps) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  useEffect(() => {
    if (moduleId === "contact") rememberHandoffContact(entityId);
  }, [moduleId, entityId]);
  const dispatch = useAppDispatch();
  const expand = useAppSelector((s) => s.shell.coworkerExpand);
  useEffect(() => {
    writeCoworkerExpandPreference(expand);
  }, [expand]);
  const businessType = useAppSelector((s) => s.auth.user?.businessType) ?? "b2b";
  const [mobileTab, setMobileTab] = useState<"chat" | "draft">(() =>
    peekOpenWorkspace() ? "draft" : "chat",
  );
  useEffect(() => {
    clearOpenWorkspace();
  }, []);
  const { messages, setMessages, input, setInput } = useCoworkerThread();
  const initialMessagesRef = useRef(initialMessages);
  initialMessagesRef.current = initialMessages;
  const [sending, setSending] = useState(false);
  const [seoProgress, setSeoProgress] = useState<{
    stage?: string;
    label?: string;
    detail?: string | null;
  } | null>(null);
  const seoGenerateTurnRef = useRef(false);
  const [requirementPdf, setRequirementPdf] = useState<{
    name: string;
    base64: string;
    size: number;
  } | null>(null);
  const requirementPdfRef = useRef<{
    name: string;
    base64: string;
    size: number;
  } | null>(null);
  requirementPdfRef.current = requirementPdf;
  const [tools, setTools] = useState<AgentToolProposal[]>([]);
  const [busyTool, setBusyTool] = useState<string | null>(null);
  const sessionMemoryApi = useDraftSessionMemory(`shell:${moduleId}`);
  const emailDraftRef = useRef<CoworkerEmailDraft | null>(null);
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const [sendingEmailId, setSendingEmailId] = useState<string | null>(null);
  const sessionMemoryRef = sessionMemoryApi.memoryRef;
  const seedConsumedRef = useRef(false);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const applyDraftPatchProp = onDraftPatch ?? onContactDraftPatch;
  const applyDraftPatch = useCallback(
    (patch: Record<string, unknown>) => {
      if (!applyDraftPatchProp) return;
      draftRef.current = {
        ...(draftRef.current ?? {}),
        ...patch,
      };
      applyDraftPatchProp(patch);
    },
    [applyDraftPatchProp],
  );

  const turnSessionMemory = useCallback(
    () =>
      sessionMemoryForTurn(
        sessionMemoryRef.current,
        sessionMemoryExtraRef?.current ?? null,
      ),
    [sessionMemoryExtraRef],
  );

  const applyUiRefresh = useCallback(
    (ur?: UiRefreshPayload | null) => {
      const href = ur?.href ? normalizeNavHref(ur.href) : null;
      if (href) navigate(href);
      if (ur?.seoProgress || ur?.seoContent || ur?.seoKeywords || ur?.seoSocial) {
        if (ur.seoProgress) setSeoProgress(ur.seoProgress);
        if (ur.seoContent) {
          setSeoProgress({ stage: "done", label: "Content ready" });
        }
        window.dispatchEvent(
          new CustomEvent("worktual:seo-ui-refresh", {
            detail: {
              seoProgress: ur.seoProgress ?? null,
              seoContent: ur.seoContent ?? null,
              seoKeywords: ur.seoKeywords ?? null,
              seoSocial: ur.seoSocial ?? null,
            },
          }),
        );
      }
      onAfterTool?.();
    },
    [navigate, onAfterTool],
  );

  const createProposalFromTool = useCallback(
    async (
      args: Record<string, unknown>,
    ): Promise<true | string> => {
      const dealId = String(args.dealId || entityId || "").trim();
      if (!dealId) {
        return "I couldn't create the proposal yet — which deal should it attach to?";
      }
      const title =
        typeof args.title === "string" && args.title.trim()
          ? args.title.trim()
          : undefined;
      const productHint =
        typeof args.productHint === "string" && args.productHint.trim()
          ? args.productHint.trim()
          : undefined;
      const productIds = Array.isArray(args.productIds)
        ? args.productIds.filter(
            (id): id is string => typeof id === "string" && Boolean(id.trim()),
          )
        : undefined;
      const attached = requirementPdfRef.current;
      if (!attached) {
        return "Attach a BRD with the paperclip, then press Enter.";
      }
      try {
        const result = await createProposal({
          dealId,
          fromTemplate: true,
          ...(title ? { title } : {}),
          ...(productHint ? { productHint } : {}),
          ...(productIds?.length ? { productIds } : {}),
          requirementPdfBase64: attached.base64,
          requirementFilename: attached.name,
        });
        if (!result.ok) {
          return (
            result.error ||
            "Attach a BRD with the paperclip, then press Enter."
          );
        }
        setRequirementPdf(null);
        navigate(`/sales/proposals/${result.id}`);
        return true;
      } catch (err) {
        const msg =
          err && typeof err === "object" && "code" in err
            ? String((err as { code?: string }).code || "")
            : "";
        const text = err instanceof Error ? err.message : "";
        if (
          msg === "ECONNABORTED" ||
          /timeout/i.test(text)
        ) {
          return "Proposal generation took too long and the chat timed out. Check the Proposals tab — it may still have saved — or try again.";
        }
        return text.trim() || "Failed to create proposal.";
      }
    },
    [entityId, navigate],
  );

  const createQuoteFromTool = useCallback(
    async (args: Record<string, unknown>): Promise<true | string> => {
      const dealId = String(args.dealId || entityId || "").trim();
      if (!dealId) {
        return "Which deal should this quote attach to?";
      }
      const proposalId = String(args.proposalId || "").trim();
      try {
        if (proposalId) {
          const result = await createQuote({
            dealId,
            proposalId,
            fromTemplate: true,
            lines: [],
          });
          if (!result.ok) return result.error || "Couldn't create that quote.";
          navigate(`/sales/quotes/${result.id}`);
          return true;
        }
        const attached = requirementPdfRef.current;
        if (!attached) {
          return "Name a proposal on this deal, or attach a BRD with the paperclip and press Enter.";
        }
        const result = await createQuoteFromRequirement({
          dealId,
          requirementPdfBase64: attached.base64,
          requirementFilename: attached.name,
        });
        if (!result.ok) return result.error || "Couldn't create that quote.";
        setRequirementPdf(null);
        navigate(`/sales/quotes/${result.id}`);
        return true;
      } catch (err) {
        return err instanceof Error && err.message.trim()
          ? err.message.trim()
          : "Couldn't create that quote.";
      }
    },
    [entityId, navigate],
  );

  const applySessionMemoryPatch = useCallback(
    (patch?: CoworkerSessionMemoryPatch | null) => {
      if (!patch) return;
      sessionMemoryApi.apply(patch);
      // Keep create-draft skips in sync with STM (chat skip must show as Skipped).
      const slots = patch.slots;
      if (
        slots &&
        typeof slots === "object" &&
        typeof slots.skippedOptional === "string" &&
        slots.skippedOptional.trim() &&
        applyDraftPatch
      ) {
        applyDraftPatch({ skippedOptional: slots.skippedOptional.trim() });
      }
    },
    [applyDraftPatch, sessionMemoryApi.apply],
  );

  // Pending confirms belong to the page that offered them.
  useEffect(() => {
    setTools([]);
    setRequirementPdf(null);
    seedConsumedRef.current = false;
  }, [pathname]);

  // Greet only while this thread is still empty. A live chat stays put
  // when the workspace route changes.
  useEffect(() => {
    const scripted = initialMessagesRef.current;
    setMessages((prev) => {
      if (scripted && scripted.length > 0 && prev.length === 0) return scripted;
      return withModuleWelcome(prev, welcome);
    });
  }, [welcome, setMessages]);

  const context = useMemo(
    () => ({
      module: moduleId,
      surface: workspaceMode || surface,
      entityId,
      pathname,
      draft: draft ?? undefined,
      pageSnapshot: pageSnapshot ?? undefined,
      ...(pathname.startsWith("/marketing/seo") ? { contentAgent: true } : {}),
      ...(requirementPdf
        ? {
            requirementPdfAttached: {
              name: requirementPdf.name,
            },
          }
        : {}),
    }),
    [
      moduleId,
      surface,
      workspaceMode,
      entityId,
      pathname,
      draft,
      pageSnapshot,
      requirementPdf,
    ],
  );

  const lastUserText = useCallback(() => {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      if (messages[i]?.role === "user") return messages[i]!.text;
    }
    return "";
  }, [messages]);

  /** In-shell contact module: open_entity /contact/:id → set_workspace detail */
  const rewriteOpenEntityInShell = useCallback(
    (tool: AgentToolProposal): AgentToolProposal => {
      if (moduleId !== "contact" || !onWorkspaceCommand) return tool;
      if (tool.name !== "open_entity" && tool.name !== "navigate") return tool;
      const href = String(tool.args.href || "").trim();
      const match = /^\/contact\/([^/?#]+)/.exec(href.split("?")[0] ?? href);
      if (!match?.[1]) return tool;
      return {
        ...tool,
        name: "set_workspace",
        label: tool.label || "Open contact",
        args: { mode: "detail", entityId: match[1], auto: true },
        risk: "low",
      };
    },
    [moduleId, onWorkspaceCommand],
  );

  const rewriteInShellCreateTool = useCallback(
    (tool: AgentToolProposal, seedFallback?: string): AgentToolProposal => {
      if (!isInShellCreateNavigate(tool, moduleId, pathname)) return tool;
      const seed =
        (typeof tool.args.seedPrompt === "string" &&
          tool.args.seedPrompt.trim()) ||
        seedFallback?.trim() ||
        "";
      return {
        ...tool,
        name: "set_workspace",
        label: tool.label || IN_SHELL_CREATE_LABELS[moduleId] || "Create",
        args: {
          mode: "create",
          seedPrompt: seed || undefined,
          auto: true,
        },
        risk: "low",
      };
    },
    [moduleId, pathname],
  );

  const rememberEmailDraft = useCallback(
    (draft: CoworkerEmailDraft) => {
      emailDraftRef.current = draft;
      sessionMemoryApi.apply({
        slots: {
          emailDraft:
            draft.status === "sent"
              ? null
              : {
                  draftId: draft.draftId,
                  to: draft.to,
                  subject: draft.subject,
                  body: draft.body,
                  contactId: draft.contactId ?? "",
                  scheduleId: draft.scheduleId ?? "",
                  sendAt: draft.sendAt ?? "",
                  status: draft.status,
                },
        },
      });
      setMessages((prev) => {
        const previous = [...prev]
          .reverse()
          .find((m) => m.emailDraft?.draftId === draft.draftId);
        const same =
          previous?.emailDraft &&
          previous.emailDraft.subject === draft.subject &&
          previous.emailDraft.body === draft.body &&
          previous.emailDraft.to === draft.to &&
          previous.emailDraft.status === draft.status;
        if (same && previous) {
          return prev.map((m) =>
            m.id === previous.id ? { ...m, emailDraft: draft } : m,
          );
        }
        const text =
          draft.status === "scheduled"
            ? "Updated draft. It stays in Inbox Drafts and will send at the time you chose."
            : draft.status === "sent"
              ? "Sent."
              : previous
                ? "Updated draft."
                : "Draft saved. It stays in Inbox Drafts.";
        return [
          ...prev,
          {
            id: newCoworkerMessageId(),
            role: "assistant",
            text,
            emailDraft: draft,
          },
        ];
      });
    },
    [sessionMemoryApi.apply],
  );

  const sendEmailNow = useCallback(
    async (messageId: string) => {
      const current =
        messagesRef.current.find((m) => m.id === messageId)?.emailDraft ??
        emailDraftRef.current ??
        undefined;
      if (!current || current.status === "sent") return;
      setSendingEmailId(messageId);
      try {
        if (current.scheduleId) {
          await cancelScheduledInboxEmail({ id: current.scheduleId });
        }
        const result = await sendInboxEmail({
          to: current.to,
          subject: current.subject,
          body: current.body,
          contactId: current.contactId,
        });
        if (!result.ok) {
          rememberEmailDraft({ ...current, error: result.error });
          return;
        }
        if (current.draftId) {
          await updateInboxFolder(current.draftId, "trash");
        }
        rememberEmailDraft({
          ...current,
          status: "sent",
          error: undefined,
          scheduleId: undefined,
        });
      } finally {
        setSendingEmailId(null);
      }
    },
    [rememberEmailDraft],
  );

  const contactEmailsRef = useRef(new Map<string, string[]>());

  const emailsOnContact = useCallback(async (contactId: string) => {
    const cached = contactEmailsRef.current.get(contactId);
    if (cached) return cached;
    try {
      const detail = await fetchContactDetail(contactId);
      if (!detail.ok) return [];
      const person = detail.contact.person;
      const emails = emailAddresses(
        [person.email, ...(person.secondaryEmails ?? [])].join(","),
      );
      contactEmailsRef.current.set(contactId, emails);
      return emails;
    } catch {
      return [];
    }
  }, []);

  const runEmailTool = useCallback(
    async (tool: AgentToolProposal): Promise<true | string> => {
      const args = tool.args ?? {};
      const cardOnScreen = [...messagesRef.current]
        .reverse()
        .find((m) => m.emailDraft && m.emailDraft.status !== "sent")?.emailDraft;
      const prior =
        emailDraftRef.current && emailDraftRef.current.status !== "sent"
          ? emailDraftRef.current
          : (cardOnScreen ?? emailDraftRef.current);
      if (prior && prior.status !== "sent") emailDraftRef.current = prior;
      const contactId = String(args.contactId || prior?.contactId || "").trim();
      const draftId = String(args.draftId || prior?.draftId || "").trim();
      const contactEmails = contactId ? await emailsOnContact(contactId) : [];
      const sameContact =
        !prior?.contactId || !contactId || prior.contactId === contactId;
      const subject = String(args.subject || prior?.subject || "").trim();
      const body = String(args.body || prior?.body || "").trim();
      const to = draftRecipients(
        args.to,
        prior && sameContact && prior.status !== "sent" ? prior.to : undefined,
        sameContact ? contactEmails : [],
      );
      if (!to || !subject || !body) {
        if (!to && subject && body) {
          return "This contact has no email address.";
        }
        return "That email needs a recipient, subject, and body.";
      }
      if (tool.name === "propose_save_email_draft") {
        const saved = await saveInboxDraft({
          draftId: draftId || null,
          contactId: contactId || null,
          type: "email",
          subject,
          body,
        });
        if (!saved.ok) return saved.error;
        rememberEmailDraft({
          draftId: saved.id,
          to,
          subject,
          body,
          contactId: contactId || undefined,
          status: "draft",
        });
        return true;
      }
      if (tool.name === "propose_schedule_email") {
        const sendAt = String(args.sendAt || "").trim();
        if (!sendAt) return "Say when to send it.";
        const savedId = draftId || prior?.draftId;
        if (!savedId) return "Save the draft first.";
        const scheduled = await scheduleInboxEmail({
          to,
          subject,
          body,
          contactId: contactId || null,
          draftId: savedId,
          sendAt,
        });
        if (!scheduled.ok) return scheduled.error;
        rememberEmailDraft({
          draftId: savedId,
          to,
          subject,
          body,
          contactId: contactId || undefined,
          scheduleId: scheduled.id,
          sendAt: scheduled.sendAt,
          status: "scheduled",
        });
        return true;
      }
      if (prior?.scheduleId) {
        await cancelScheduledInboxEmail({ id: prior.scheduleId });
      }
      const sent = await sendInboxEmail({
        to,
        subject,
        body,
        contactId: contactId || undefined,
      });
      if (!sent.ok) return sent.error;
      const savedId = draftId || prior?.draftId;
      if (savedId) await updateInboxFolder(savedId, "trash");
      rememberEmailDraft({
        draftId: savedId || prior?.draftId || "sent",
        to,
        subject,
        body,
        contactId: contactId || undefined,
        status: "sent",
      });
      return true;
    },
    [emailsOnContact, rememberEmailDraft],
  );

  const runTool = useCallback(
    async (
      tool: AgentToolProposal,
      seedFallback?: string,
      opts?: { agentAlreadySpoke?: boolean },
    ) => {
      const effective = rewriteOpenEntityInShell(
        rewriteInShellCreateTool(tool, seedFallback),
      );
      // Prospect pull results (Found N / Imported / errors) are the real
      // answer — never drop them because the model already said "I'm pulling…".
      const skipShellConfirmation =
        opts?.agentAlreadySpoke === true &&
        isSilentWorkspaceTool(effective) &&
        effective.name !== "propose_pull_prospect_leads";
      setBusyTool(effective.id);
      try {
        if (effective.name === "patch_activity_draft" && applyDraftPatch) {
          const activityPatch = pickActivityDraftPatch(
            effective.args as Record<string, unknown>,
          );
          if (Object.keys(activityPatch).length > 0) {
            flushSync(() => {
              applyDraftPatch(activityPatch as Record<string, unknown>);
            });
          }
        }
        if (
          effective.name === "propose_save_email_draft" ||
          effective.name === "propose_send_email" ||
          effective.name === "propose_schedule_email"
        ) {
          const handled = await runEmailTool(effective);
          setTools((t) =>
            t.filter((x) => x.id !== tool.id && x.id !== effective.id),
          );
          if (handled !== true) {
            setMessages((p) => [
              ...p,
              {
                id: newCoworkerMessageId(),
                role: "assistant",
                text: handled,
              },
            ]);
          }
          return;
        }
        if (
          effective.name === "set_workspace" ||
          isInShellCreateNavigate(tool, moduleId, pathname)
        ) {
          if (onWorkspaceCommand) {
            const handled = await onWorkspaceCommand(effective);
            if (handled !== false) {
              setTools((t) =>
                t.filter((x) => x.id !== tool.id && x.id !== effective.id),
              );
              onAfterTool?.();
              // On narrow viewports, only jump to Workspace when opening create —
              // list/detail tools should keep chat visible so focus isn't lost.
              const wsMode = String(effective.args.mode || "");
              if (wsMode === "create" || wsMode === "create_quote") {
                setMobileTab("draft");
              }

              // Rich create seeds: fill draft + show the follow-up question in chat.
              // Vague creates omit seedPrompt so we don't double-ask.
              const seed =
                typeof effective.args.seedPrompt === "string"
                  ? effective.args.seedPrompt.trim()
                  : "";
              if (
                String(effective.args.mode || "") === "create" &&
                seed &&
                applyDraftPatch
              ) {
                void assistAgentTurn({
                  messages: [{ role: "user", text: seed }],
                  context: {
                    module: moduleId,
                    surface: "create",
                    pathname,
                    draft: {},
                  },
                  sessionMemory: turnSessionMemory(),
                }).then((result) => {
                  if (!result.ok) return;
                  if (result.ok && "sessionMemoryPatch" in result) {
                    applySessionMemoryPatch(result.sessionMemoryPatch);
                  }
                  const followUp = (result.assistantText || "").trim();
                  if (followUp) {
                    setMessages((p) => {
                      const lastAssistant = [...p]
                        .reverse()
                        .find((m) => m.role === "assistant");
                      const norm = (s: string) =>
                        s.replace(/\s+/g, " ").trim().toLowerCase();
                      // Seed re-entry used to append the same proposal/deal
                      // explanation a second time.
                      if (
                        lastAssistant &&
                        norm(lastAssistant.text) === norm(followUp)
                      ) {
                        return p;
                      }
                      return [
                        ...p,
                        {
                          id: newCoworkerMessageId(),
                          role: "assistant",
                          text: followUp,
                        },
                      ];
                    });
                  }
                  const patch = draftPatchFromTurn(moduleId, result);
                  if (Object.keys(patch).length > 0 && applyDraftPatch) {
                    flushSync(() => {
                      applyDraftPatch(patch);
                    });
                  }
                  const merged = {
                    ...((draftRef.current ?? {}) as Record<string, unknown>),
                    ...patch,
                  };
                  if (
                    moduleId === "company" &&
                    onToolConfirm &&
                    (result.toolProposals?.some(
                      (t) => t.name === "propose_create_company",
                    ) ||
                      shouldPersistCompanyDraftClient(seed, draftRef.current, merged))
                  ) {
                    void Promise.resolve(
                      onToolConfirm({
                        id: "seed-propose_create_company",
                        name: "propose_create_company",
                        label: "Create company",
                        args: { auto: true },
                        risk: "low",
                      }),
                    ).then((handled) => {
                      if (handled === true) {
                        setMessages((p) => [
                          ...p,
                          {
                            id: newCoworkerMessageId(),
                            role: "assistant",
                            text: "All set — company created.",
                          },
                        ]);
                        onAfterTool?.();
                        return;
                      }
                      if (typeof handled === "string" && handled.trim()) {
                        setMessages((p) => [
                          ...p,
                          {
                            id: newCoworkerMessageId(),
                            role: "assistant",
                            text: handled.trim(),
                          },
                        ]);
                      }
                    });
                  }
                });
              }
              return;
            }
          }

          // Dashboard / pages without in-shell workspace: navigate instead.
          const asNav = workspaceToolAsNavigate(effective, moduleId);
          if (asNav) {
            const href = hrefWithModuleHandoffs(
              navigateHrefForTool(asNav, seedFallback || lastUserText()) || "",
              moduleId,
              entityId,
            );
            if (href) {
              navigate(href);
              setTools((t) =>
                t.filter((x) => x.id !== tool.id && x.id !== effective.id),
              );
              return;
            }
          }
        }

        if (
          moduleId === "contact" &&
          effective.name === "propose_import_contacts"
        ) {
          const importResult = await runContactImportCoworkerTool(effective, {
            businessType,
            lastUserText: seedFallback || lastUserText(),
          });
          const importSpeech =
            typeof importResult === "string" ? importResult.trim() : "";
          const importOk = /^imported\b/i.test(importSpeech);
          setMessages((p) => [
            ...p,
            {
              id: newCoworkerMessageId(),
              role: "assistant",
              text:
                importSpeech ||
                "Import failed — attach a .csv or say import this sample.",
            },
          ]);
          if (importOk) {
            setTools((t) =>
              t.filter((x) => x.id !== tool.id && x.id !== effective.id),
            );
            onAfterTool?.();
          }
          return;
        }

        if (onToolConfirm) {
          // Python MCP for agent mutations — skip form-owned creates so the
          // page can submit drafts / assemble proposal templates and navigate.
          if (
            effective.name.startsWith("propose_") &&
            !FORM_OWNED_PROPOSE_TOOLS.has(effective.name)
          ) {
            try {
              const mcp = await confirmCoworkerTool({
                name: effective.name,
                args: { ...effective.args, confirmed: true },
                context: {
                  ...context,
                  module: moduleId,
                  surface: workspaceMode || surface,
                  entityId: context.entityId ?? null,
                  pathname,
                  draft: draftRef.current ?? context.draft ?? null,
                },
                sessionMemory: turnSessionMemory(),
                messages: messages.map((m) => ({ role: m.role, text: m.text })),
              });
              if (mcp.ok) {
                const follow =
                  sanitizeAssistantTextForUser(mcp.assistantText).trim() ||
                  "All set.";
                setMessages((p) => [
                  ...p,
                  {
                    id: newCoworkerMessageId(),
                    role: "assistant",
                    text: follow,
                  },
                ]);
                setTools((t) =>
                  t.filter((x) => x.id !== tool.id && x.id !== effective.id),
                );
                applyUiRefresh(mcp.ok ? mcp.uiRefresh : undefined);
                return;
              }
              // Fall through to page handler when MCP declines (form-owned).
            } catch {
              // Fall through to page handler.
            }
          }
          let handled: true | false | string;
          try {
            const confirmResult = await onToolConfirm(effective);
            handled = confirmResult === undefined ? false : confirmResult;
          } catch (err) {
            const msg =
              err instanceof Error && err.message.trim()
                ? err.message.trim()
                : "I couldn't complete that — check the workspace and try again.";
            setMessages((p) => [
              ...p,
              {
                id: newCoworkerMessageId(),
                role: "assistant",
                text: msg,
              },
            ]);
            return;
          }
          if (
            handled === false &&
            effective.name === "propose_create_proposal"
          ) {
            handled = await createProposalFromTool(effective.args);
          }
          if (
            handled === false &&
            effective.name === "propose_create_quote"
          ) {
            handled = await createQuoteFromTool(effective.args);
          }
          const importSummary =
            (effective.name === "propose_import_contacts" ||
              effective.name === "propose_pull_prospect_leads") &&
            typeof handled === "string" &&
            /^imported\b/i.test(handled.trim())
              ? handled.trim()
              : null;
          const prospectReview =
            effective.name === "propose_pull_prospect_leads" &&
            typeof handled === "string" &&
            /^found\b/i.test(handled.trim())
              ? handled.trim()
              : null;
          if (handled === true || importSummary || prospectReview) {
            const doneText =
              importSummary
                ? importSummary
                : prospectReview
                ? prospectReview
                : effective.name === "propose_import_contacts"
                ? "Import finished."
                : effective.name === "propose_pull_prospect_leads"
                ? "Prospect pull finished."
                : effective.name === "propose_create_contact"
                ? "All set — contact created."
                : effective.name === "propose_update_contact"
                  ? "Updated — that's saved."
                  : effective.name === "propose_set_lead_score"
                    ? `Lead score updated to **${String(effective.args.score)}** and the AI summary was refreshed.`
                  : effective.name === "propose_delete_contact"
                    ? "Done — that contact is removed."
                    : effective.name === "propose_create_deal"
                      ? "All set — deal created."
                      : effective.name === "propose_update_deal"
                        ? "Updated — that's saved."
                        : effective.name === "propose_reassign_deal_owner"
                          ? "Owner updated."
                          : effective.name === "propose_delete_deal"
                          ? "Done — that deal is removed."
                          : effective.name === "propose_create_company"
                      ? "All set — company created."
                      : effective.name === "propose_update_company"
                        ? "Updated — that's saved."
                        : effective.name === "propose_update_company_location"
                          ? "Updated — company location saved."
                          : effective.name === "propose_delete_company"
                          ? "Done — that company is removed."
                          : effective.name === "propose_create_product"
                            ? "All set — product created."
                            : effective.name === "propose_update_product"
                              ? "Updated — that's saved."
                              : effective.name === "propose_delete_product"
                                ? "Done — that product is removed."
                                : effective.name === "propose_create_invoice"
                                  ? "All set — invoice created."
                                  : effective.name === "propose_update_invoice"
                                    ? "Updated — that's saved."
                                    : effective.name === "propose_delete_invoice"
                                      ? "Done — that invoice is removed."
                                      : effective.name === "propose_send_invoice"
                                        ? "Sent — the invoice is on its way."
                                      : effective.name === "propose_mark_invoice_paid"
                                        ? "Done — marked as paid."
                                  : effective.name === "propose_create_quote"
                                    ? "All set — quote created."
                                    : effective.name === "propose_update_quote"
                                      ? "Updated — that's saved."
                                      : effective.name === "propose_send_quote"
                                        ? "Sent — the quote is on its way."
                                      : effective.name === "propose_delete_quote"
                                        ? "Done — that quote is removed."
                                    : effective.name === "propose_create_proposal"
                                      ? "All set — proposal created."
                                      : effective.name === "propose_send_proposal"
                                        ? "Sent — the proposal is on its way."
                                      : effective.name === "propose_delete_proposal"
                                        ? "Done — that proposal is removed."
                                    : effective.name === "propose_create_activity"
                                      ? "All set — activity logged."
                                      : effective.name ===
                                          "propose_rewrite_proposal_section"
                                        ? "Updated — that section is rewritten."
                                        : effective.name ===
                                            "propose_patch_proposal_document_text"
                                          ? "Done — the proposal layout is updated."
                                        : effective.name ===
                                            "propose_personalize_proposal"
                                          ? "Done — proposal regenerated for this customer."
                                        : effective.name === "propose_stage_change"
                                          ? `Stage updated to **${String(effective.args.stage || "").replace(/_/g, " ")}**.`
                                      : `All set — ${effective.label}.`;
            if (!skipShellConfirmation) {
              setMessages((p) => appendAssistantIfNew(p, doneText));
            }
            setTools((t) => t.filter((x) => x.id !== tool.id && x.id !== effective.id));
            onAfterTool?.();
            return;
          }
          // Chat create/update/delete cancelled / failed — explain in chat.
          if (
            effective.name === "propose_create_contact" ||
            effective.name === "propose_import_contacts" ||
            effective.name === "propose_pull_prospect_leads" ||
            effective.name === "propose_update_contact" ||
            effective.name === "propose_set_lead_score" ||
            effective.name === "propose_delete_contact" ||
            effective.name === "propose_create_deal" ||
            effective.name === "propose_update_deal" ||
            effective.name === "propose_reassign_deal_owner" ||
            effective.name === "propose_delete_deal" ||
            effective.name === "propose_create_company" ||
            effective.name === "propose_update_company" ||
            effective.name === "propose_update_company_location" ||
            effective.name === "propose_delete_company" ||
            effective.name === "propose_create_product" ||
            effective.name === "propose_update_product" ||
            effective.name === "propose_delete_product" ||
            effective.name === "propose_create_invoice" ||
            effective.name === "propose_update_invoice" ||
            effective.name === "propose_delete_invoice" ||
            effective.name === "propose_send_invoice" ||
            effective.name === "propose_mark_invoice_paid" ||
            effective.name === "propose_create_quote" ||
            effective.name === "propose_update_quote" ||
            effective.name === "propose_delete_quote" ||
            effective.name === "propose_send_quote" ||
            effective.name === "propose_create_proposal" ||
            effective.name === "propose_send_proposal" ||
            effective.name === "propose_delete_proposal" ||
            effective.name === "propose_create_activity" ||
            effective.name === "propose_rewrite_proposal_section" ||
            effective.name === "propose_personalize_proposal"
          ) {
            const errText =
              typeof handled === "string" && handled.trim()
                ? handled.trim() === "cancelled"
                  ? null
                  : handled.trim()
                : effective.name === "propose_create_contact"
                  ? "Email or phone number is required before I can save — add one on the draft."
                  : effective.name === "propose_create_deal"
                    ? "I couldn't save yet — title and company are required on the draft."
                    : effective.name === "propose_create_company"
                    ? "I couldn't save yet — company name and first location are required on the draft."
                    : effective.name === "propose_create_product"
                      ? "I couldn't save yet — product name and SKU are required on the draft."
                      : effective.name === "propose_create_invoice"
                        ? "I couldn't save the invoice yet — link a deal on the draft first."
                        : effective.name === "propose_create_quote"
                          ? "I couldn't save the quote yet — pick a deal and product on the draft."
                          : effective.name === "propose_create_proposal"
                            ? "I couldn't create the proposal yet — which deal should it attach to?"
                          : effective.name === "propose_create_activity"
                            ? "I couldn't log the activity yet — contact and subject are required."
                            : "I couldn't complete that — check the workspace and try again.";
            if (errText) {
              setMessages((p) => [
                ...p,
                {
                  id: newCoworkerMessageId(),
                  role: "assistant",
                  text: errText,
                },
              ]);
            }
            return;
          }
        } else if (effective.name === "propose_create_proposal") {
          const handled = await createProposalFromTool(effective.args);
          if (handled === true) {
            setMessages((p) => [
              ...p,
              {
                id: newCoworkerMessageId(),
                role: "assistant",
                text: "All set — proposal created.",
              },
            ]);
            setTools((t) =>
              t.filter((x) => x.id !== tool.id && x.id !== effective.id),
            );
            onAfterTool?.();
            return;
          }
          setMessages((p) => [
            ...p,
            {
              id: newCoworkerMessageId(),
              role: "assistant",
              text:
                typeof handled === "string"
                  ? handled
                  : "I couldn't create the proposal yet — which deal should it attach to?",
            },
          ]);
          return;
        } else if (
          effective.name.startsWith("propose_") &&
          !FORM_OWNED_PROPOSE_TOOLS.has(effective.name)
        ) {
          try {
            const mcp = await confirmCoworkerTool({
              name: effective.name,
              args: { ...effective.args, confirmed: true },
              context: {
                ...context,
                module: moduleId,
                surface: workspaceMode || surface,
                entityId: context.entityId ?? null,
                pathname,
                draft: draftRef.current ?? context.draft ?? null,
              },
              sessionMemory: turnSessionMemory(),
              messages: messages.map((m) => ({ role: m.role, text: m.text })),
            });
            if (mcp.ok) {
              const follow =
                sanitizeAssistantTextForUser(mcp.assistantText).trim() ||
                "All set.";
              setMessages((p) => [
                ...p,
                {
                  id: newCoworkerMessageId(),
                  role: "assistant",
                  text: follow,
                },
              ]);
              setTools((t) =>
                t.filter((x) => x.id !== tool.id && x.id !== effective.id),
              );
              applyUiRefresh(mcp.uiRefresh);
              return;
            }
          } catch {
            /* fall through */
          }
        }

        if (effective.name === "navigate" || effective.name === "open_entity") {
          const navText = `${effective.label || ""} ${seedFallback || lastUserText()}`.trim();
          const clarify = navigationClarification(navText);
          if (clarify) {
            setMessages((p) => [
              ...p,
              {
                id: newCoworkerMessageId(),
                role: "assistant",
                text: clarify,
              },
            ]);
            setTools((t) =>
              t.filter((x) => x.id !== tool.id && x.id !== effective.id),
            );
            return;
          }
          const href = hrefWithModuleHandoffs(
            navigateHrefForTool(effective, seedFallback || lastUserText()) || "",
            moduleId,
            entityId,
          );
          if (href) {
            navigate(href);
            setTools((t) => t.filter((x) => x.id !== tool.id && x.id !== effective.id));
            return;
          }
        }

        if (effective.name === "propose_stage_change") {
          const dealId = String(effective.args.dealId || entityId || "");
          const stage = String(effective.args.stage || "");
          if (!dealId || !stage) {
            setMessages((p) => [
              ...p,
              {
                id: newCoworkerMessageId(),
                role: "assistant",
                text: "I need a deal and stage before I can update that.",
              },
            ]);
            return;
          }
          const result = await updateDealStage(dealId, stage);
          if (!result.ok) {
            setMessages((p) => [
              ...p,
              {
                id: newCoworkerMessageId(),
                role: "assistant",
                text: result.error || "Could not update stage.",
              },
            ]);
            return;
          }
          const stageDone = `Stage updated to **${stage.replace(/_/g, " ")}**.`;
          if (!skipShellConfirmation) {
            setMessages((p) => appendAssistantIfNew(p, stageDone));
          }
          setTools((t) => t.filter((x) => x.id !== tool.id && x.id !== effective.id));
          onAfterTool?.();
          return;
        }

        // Never expose internal tool names to the user.
        setTools((t) => t.filter((x) => x.id !== tool.id && x.id !== effective.id));
      } finally {
        setBusyTool(null);
      }
    },
    [
      applyDraftPatch,
      applyUiRefresh,
      businessType,
      createProposalFromTool,
      createQuoteFromTool,
      entityId,
      lastUserText,
      moduleId,
      navigate,
      onAfterTool,
      onToolConfirm,
      onWorkspaceCommand,
      pathname,
      rewriteInShellCreateTool,
      rewriteOpenEntityInShell,
      runEmailTool,
      applySessionMemoryPatch,
      workspaceMode,
      surface,
      context,
      messages,
    ],
  );

  const onSend = useCallback(
    async (
      overrideText?: string,
      opts?: {
        hideUser?: boolean;
        displayText?: string;
        attachment?: CoworkerAttachment;
      },
    ) => {
      const attached = requirementPdfRef.current;
      const text = (overrideText ?? input).trim();
      const visibleText =
        opts?.displayText !== undefined ? opts.displayText.trim() : text;
      const turnText =
        text ||
        (attached ? "Use this attached file." : "");
      if ((!turnText && !attached) || sending) return;
      if (!overrideText) setInput("");
      const userMsgs: CoworkerMessage[] = [];
      if (attached) {
        userMsgs.push({
          id: newCoworkerMessageId(),
          role: "user",
          text: "",
          attachment: {
            name: attached.name,
            size: attached.size,
            kind: "pdf",
          },
        });
      }
      if (opts?.attachment) {
        userMsgs.push({
          id: newCoworkerMessageId(),
          role: "user",
          text: "",
          attachment: opts.attachment,
        });
      }
      if (visibleText) {
        userMsgs.push({
          id: newCoworkerMessageId(),
          role: "user",
          text: visibleText,
          hidden: Boolean(opts?.hideUser),
        });
      } else if (attached && userMsgs.length === 1) {
        // File-only send: keep the chip in chat; agent sees turnText.
      }
      const next = [...messages, ...userMsgs];
      setMessages(next);
      setSending(true);
      setTools([]);
      const isSeoPage = pathname.startsWith("/marketing/seo");
      const seoGenerateTurn = isSeoPage && looksLikeSeoGenerateTurn(turnText);
      seoGenerateTurnRef.current = seoGenerateTurn;
      if (seoGenerateTurn) {
        setSeoProgress({
          stage: "suggest_keywords",
          label: "Researching keywords",
        });
        window.dispatchEvent(
          new CustomEvent("worktual:seo-ui-refresh", {
            detail: {
              seoProgress: {
                stage: "suggest_keywords",
                label: "Suggesting keywords",
              },
            },
          }),
        );
      } else if (isSeoPage) {
        setSeoProgress(null);
      }
      try {
        // Delete confirm: run the Fastify delete directly — no second agent
        // socket turn (LLM confirm phrasing varies; reconnect drops were common).
        const lastAssistantText = [...messages]
          .reverse()
          .find((m) => m.role === "assistant")?.text;
        const activeContactId = entityId ?? context.entityId ?? null;
        if (
          moduleId === "contact" &&
          activeContactId &&
          onToolConfirm &&
          lastAssistantText &&
          looksLikeDeleteConfirmPromptClient(lastAssistantText) &&
          looksLikeDeleteConfirmReplyClient(turnText)
        ) {
          const deleteTool: AgentToolProposal = {
            id: "chat-delete-confirm",
            name: "propose_delete_contact",
            label: "Delete contact",
            args: { contactId: activeContactId, auto: true },
            risk: "low",
          };
          const handled = await onToolConfirm(deleteTool);
          if (handled === true) {
            setMessages((p) => [
              ...p,
              {
                id: newCoworkerMessageId(),
                role: "assistant",
                text: "Done — that contact is removed.",
              },
            ]);
            onAfterTool?.();
            return;
          }
          const errText =
            typeof handled === "string" && handled.trim()
              ? handled.trim()
              : "I couldn't delete this contact — check permissions and try again.";
          setMessages((p) => [
            ...p,
            {
              id: newCoworkerMessageId(),
              role: "assistant",
              text: errText,
            },
          ]);
          return;
        }

        // Prefer the latest draft ref — React state can lag one tick after a
        // same-turn patch (e.g. invoice dealId), which used to skip create.
        const liveContext = {
          ...context,
          draft: draftRef.current ?? context.draft,
          ...(attached
            ? { requirementPdfAttached: { name: attached.name } }
            : {}),
        };
        const result = await assistAgentTurn({
          messages: [
            ...messages.map((m) => ({ role: m.role, text: m.text })),
            { role: "user" as const, text: turnText },
          ],
          context: liveContext,
          sessionMemory: turnSessionMemory(),
        });
        if (!result.ok) {
          const speech =
            "assistantText" in result && typeof result.assistantText === "string"
              ? result.assistantText
              : result.error;
          setMessages((p) => [
            ...p,
            {
              id: newCoworkerMessageId(),
              role: "assistant",
              text: sanitizeAssistantTextForUser(speech) || COWORKER_LLM_ERROR_SPEECH,
            },
          ]);
          if (seoGenerateTurnRef.current) {
            setSeoProgress({
              stage: "error",
              label: "Could not generate",
              detail: speech || result.error,
            });
            window.dispatchEvent(
              new CustomEvent("worktual:seo-ui-refresh", {
                detail: {
                  seoProgress: {
                    stage: "error",
                    label: "Could not generate",
                    detail: speech || result.error,
                  },
                },
              }),
            );
          }
          return;
        }
        applySessionMemoryPatch(result.sessionMemoryPatch);
        const proposalsPreview = (result.toolProposals ?? []).map((t) =>
          rewriteInShellCreateTool(t, turnText),
        );
        const hasRequirementPdf = Boolean(attached || requirementPdfRef.current);
        const creatingProposalNow =
          hasRequirementPdf &&
          proposalsPreview.some((t) => t.name === "propose_create_proposal");
        const turnPatch = draftPatchFromTurn(moduleId, result);
        const beforeDraft = (draftRef.current ?? context.draft ?? {}) as Record<
          string,
          unknown
        >;
        const mergedDraft = { ...beforeDraft, ...turnPatch };
        const contactSaveBlocked =
          moduleId === "contact" &&
          contactDraftNamedClient(mergedDraft) &&
          !contactDraftSaveReadyClient(mergedDraft) &&
          (looksLikeCreateConfirmClient(text) ||
            proposalsPreview.some((t) => t.name === "propose_create_contact"));
        let speech = sanitizeAssistantTextForUser(result.assistantText);
        if (proposalsPreview.some(isSeededCreateHandoffTool)) {
          speech = "";
        }
        if (contactSaveBlocked) {
          const first = String(mergedDraft?.firstName ?? "").trim();
          const last = String(mergedDraft?.lastName ?? "").trim();
          const who = [first, last].filter(Boolean).join(" ").trim();
          speech = who
            ? `I still need an email or phone number for **${who}** before I can save.`
            : "Email or phone number is required before I can save this contact.";
        }
        const actionOnly =
          !speech &&
          (proposalsPreview.length > 0 ||
            Boolean(result.patch || result.contactDraftPatch));
        const agentSpokeThisTurn =
          !creatingProposalNow && Boolean(speech?.trim());
        // Proposal create auto-runs; don't show a "Shall I save it?" recap first.
        if (!creatingProposalNow && (speech || !actionOnly)) {
          setMessages((p) => [
            ...p,
            {
              id: newCoworkerMessageId(),
              role: "assistant",
              text: speech || COWORKER_LLM_ERROR_SPEECH,
              analytics: result.analytics,
            },
          ]);
        }
        const runToolOpts = { agentAlreadySpoke: agentSpokeThisTurn };
        if (result.uiRefresh) {
          applyUiRefresh(result.uiRefresh);
        }

        let proposals = proposalsPreview;
        if (contactSaveBlocked) {
          proposals = proposals.filter((t) => t.name !== "propose_create_contact");
        }
        // Safety: never auto-run proposal generate until a BRD is in chat.
        // The sales agent must ask for the PDF first; do not keyword-start.
        const proposalsForTurn = hasRequirementPdf
          ? proposals
          : proposals.filter((t) => t.name !== "propose_create_proposal");
        // Creating a proposal only needs dealId — opening deal detail navigates
        // away, remounts this shell, and drops the create tool mid-flight.
        const creatingProposal = proposalsForTurn.some(
          (t) => t.name === "propose_create_proposal",
        );
        // Field update/delete proposed while still on a list page: navigating to
        // the detail view first would remount this shell mid-flight and drop the
        // mutation. Stay put — the list page's onToolConfirm applies the mutation
        // directly (mirrors the detail page's handling for the same tool name).
        const mutatingInPlace = proposals.some(
          (t) =>
            t.name === "propose_update_contact" ||
            t.name === "propose_set_lead_score" ||
            t.name === "propose_delete_contact" ||
            t.name === "propose_update_product" ||
            t.name === "propose_delete_product" ||
            t.name === "propose_update_company" ||
            t.name === "propose_update_company_location" ||
            t.name === "propose_delete_company" ||
            t.name === "propose_update_quote" ||
            t.name === "propose_delete_quote" ||
            t.name === "propose_send_quote" ||
            t.name === "propose_update_invoice" ||
            t.name === "propose_delete_invoice" ||
            t.name === "propose_send_invoice" ||
            t.name === "propose_mark_invoice_paid" ||
            t.name === "propose_send_proposal" ||
            t.name === "propose_delete_proposal" ||
            t.name === "propose_rewrite_proposal_section" ||
            t.name === "propose_patch_proposal_section" ||
            t.name === "propose_patch_proposal_document_text" ||
            t.name === "propose_rewrite_quote_section" ||
            t.name === "propose_update_document_asset",
        );
        let filtered = creatingProposal || mutatingInPlace
          ? proposalsForTurn.filter((t) => {
              if (t.name !== "set_workspace") return true;
              return String(t.args.mode || "") !== "detail";
            })
          : [...proposalsForTurn];

        // Model said "saving…" (or user confirmed a ready quote) without a create tool.
        const synthetic = contactSaveBlocked
          ? null
          : syntheticCreateToolForSavingChat({
              moduleId,
              assistantText: result.assistantText,
              existing: filtered,
              userText: text,
              draft: mergedDraft,
              businessType,
            });
        if (synthetic) {
          filtered = [...filtered, synthetic];
        }
        const persistCompany =
          moduleId === "company" &&
          (filtered.some((t) => t.name === "propose_create_company") ||
            shouldPersistCompanyDraftClient(text, beforeDraft, mergedDraft));
        if (persistCompany) {
          filtered = filtered.filter(
            (t) => t.name !== "navigate" && t.name !== "open_entity",
          );
          if (!filtered.some((t) => t.name === "propose_create_company")) {
            filtered = [
              ...filtered,
              {
                id: "synthetic-propose_create_company",
                name: "propose_create_company",
                label: "Create company",
                args: { auto: true },
                risk: "low" as const,
              },
            ];
          }
        }

        const silent = filtered.filter(isSilentWorkspaceTool);
        const needsConfirm = filtered.filter((t) => !isSilentWorkspaceTool(t));
        const isWorkspaceTool = (t: AgentToolProposal) =>
          t.name === "navigate" ||
          t.name === "open_entity" ||
          t.name === "set_workspace";
        const workspaceSilent = silent.filter(isWorkspaceTool);
        const emailOrder = [
          "propose_save_email_draft",
          "propose_schedule_email",
          "propose_send_email",
        ];
        const mutationSilent = silent
          .filter((t) => !isWorkspaceTool(t))
          .sort((a, b) => {
            const ia = emailOrder.indexOf(a.name);
            const ib = emailOrder.indexOf(b.name);
            if (ia < 0 && ib < 0) return 0;
            if (ia < 0) return -1;
            if (ib < 0) return 1;
            return ia - ib;
          });

        if (silent.length) {
          if (creatingProposal) {
            setMessages((p) => [
              ...p,
              {
                id: newCoworkerMessageId(),
                role: "assistant",
                text: "Generating the proposal from your learned patterns…",
              },
            ]);
          }
          try {
            // Workspace open first (may reset draft), then patch, then create.
            for (const tool of workspaceSilent) {
              await runTool(tool, text, runToolOpts);
            }
            const patch = draftPatchFromTurn(moduleId, result);
            if (Object.keys(patch).length > 0 && applyDraftPatch) {
              // Commit draft before auto create/update — rAF alone can race
              // React state and submit an empty locationName / email.
              flushSync(() => {
                applyDraftPatch(patch);
              });
              setMobileTab("draft");
              await new Promise<void>((resolve) => {
                requestAnimationFrame(() => resolve());
              });
            }
            for (const tool of mutationSilent) {
              await runTool(tool, text, runToolOpts);
            }
          } catch (err) {
            const msg =
              err instanceof Error && err.message.trim()
                ? err.message.trim()
                : "Something went wrong while saving — try again, or use Create on the right.";
            setMessages((p) => [
              ...p,
              {
                id: newCoworkerMessageId(),
                role: "assistant",
                text: msg,
              },
            ]);
          }
        } else {
          // No silent tools — still apply any draft patch from this turn.
          const patch = draftPatchFromTurn(moduleId, result);
          if (Object.keys(patch).length > 0 && applyDraftPatch) {
            applyDraftPatch(patch);
            setMobileTab("draft");
          }
        }

        // High-risk mutations that still need a Confirm click (stage moves run in chat).
        setTools(needsConfirm);
        const opensCreate = filtered.some((t) => {
          if (t.name !== "set_workspace") return false;
          const mode = String(t.args.mode || "");
          return mode === "create" || mode === "create_quote";
        });
        if (opensCreate) {
          setMobileTab("draft");
        }
      } catch (err) {
        const msg =
          err instanceof Error && err.message.trim()
            ? err.message.trim()
            : COWORKER_LLM_ERROR_SPEECH;
        setMessages((p) => [
          ...p,
          {
            id: newCoworkerMessageId(),
            role: "assistant",
            text: msg,
          },
        ]);
        if (seoGenerateTurnRef.current) {
          setSeoProgress({
            stage: "error",
            label: "Could not generate",
            detail: msg,
          });
          window.dispatchEvent(
            new CustomEvent("worktual:seo-ui-refresh", {
              detail: {
                seoProgress: {
                  stage: "error",
                  label: "Could not generate",
                  detail: msg,
                },
              },
            }),
          );
        }
      } finally {
        setSending(false);
        seoGenerateTurnRef.current = false;
      }
    },
    [
      input,
      sending,
      messages,
      context,
      businessType,
      entityId,
      onAfterTool,
      onToolConfirm,
      runTool,
      moduleId,
      pathname,
      applyDraftPatch,
      applySessionMemoryPatch,
      rewriteInShellCreateTool,
      applyUiRefresh,
    ],
  );

  useEffect(() => {
    const seed = seedPrompt?.trim();
    if (!seed || seedConsumedRef.current || sending) return;
    seedConsumedRef.current = true;
    onSeedPromptConsumed?.();
    const said = seedDisplayText?.trim();
    void onSend(
      seed,
      said && said !== seed ? { displayText: said } : undefined,
    );
  }, [seedPrompt, seedDisplayText, sending, onSend, onSeedPromptConsumed]);

  useEffect(() => {
    if (!pathname.startsWith("/marketing/seo")) return;
    const onPrompt = (ev: Event) => {
      const detail = (ev as CustomEvent<SeoAgentPromptDetail>).detail;
      const prompt = detail?.prompt?.trim();
      if (!prompt || sending) return;
      dispatch(setCoworkerExpand("default"));
      setMobileTab("chat");
      void onSend(prompt, { hideUser: detail?.hideUser !== false });
    };
    window.addEventListener(SEO_AGENT_PROMPT_EVENT, onPrompt);
    return () => {
      window.removeEventListener(SEO_AGENT_PROMPT_EVENT, onPrompt);
    };
  }, [pathname, sending, onSend, dispatch]);

  const toggleExpand = (side: "chat" | "draft") => {
    if (side === "draft") {
      setMobileTab((tab) => (expand === "draft" ? tab : "draft"));
    }
    dispatch(toggleCoworkerExpand(side));
  };

  const chatExpandLabel =
    expand === "chat" ? "Restore layout" : "Expand chat";
  const workspaceExpandLabel =
    expand === "draft"
      ? collapseChatToFab
        ? "Restore chat"
        : "Restore layout"
      : "Expand workspace";

  const restoreFromCollapsed = () => {
    dispatch(setCoworkerExpand("default"));
    setMobileTab("chat");
  };

  const restoreWorkspace = () => {
    dispatch(setCoworkerExpand("default"));
    setMobileTab("draft");
  };

  const workspaceFabLabel = workspaceTitle ?? title ?? "Workspace";

  const pageFull =
    collapseChatToFab && expand === "draft";
  const workspacePaneClass =
    "@container scrollbar-hover flex min-h-0 flex-1 flex-col overflow-auto";

  return (
    <div
      role="region"
      aria-label={`${title} — agent and workspace`}
      className="flex h-full min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden bg-[#f3f4f6]"
    >
      <div
        className={
          pageFull
            ? "flex min-h-0 min-w-0 w-full flex-1 flex-col overflow-hidden p-0"
            : "flex min-h-0 min-w-0 w-full flex-1 flex-col overflow-hidden"
        }
      >
        <CoworkerWorkspace
          expand={expand}
          balance="agent"
          workspaceFullCollapse={collapseChatToFab}
          mobileTab={mobileTab}
          onMobileTab={setMobileTab}
          draftTabLabel="Workspace"
          collapsedChat={
            collapseChatToFab ? (
              <CoworkerChatFab
                onExpand={restoreFromCollapsed}
                sending={sending}
              />
            ) : undefined
          }
          collapsedWorkspace={
            <CoworkerWorkspaceFab
              label={workspaceFabLabel}
              onExpand={restoreWorkspace}
            />
          }
          chat={
            <div className="flex h-full min-h-0 w-full flex-col gap-2">
              <div className="min-h-0 flex-1">
                <CoworkerChatShell
                  title={chatTitle}
                  messages={messages}
                  onSendEmailNow={(messageId) => void sendEmailNow(messageId)}
                  sendingEmailId={sendingEmailId}
                  input={input}
                  onInputChange={setInput}
                  onSend={(text, opts) => void onSend(text, opts)}
                  allowCsvAttach={moduleId === "contact"}
                  fileAttach={
                    moduleId === "sales"
                      ? {
                          accept: REQUIREMENT_FILE_ACCEPT,
                          disabled: sending,
                          ariaLabel: "Attach requirement file",
                          title: `Attach a BRD (${REQUIREMENT_FILE_TYPES_LABEL}) for proposal generation`,
                          onFile: (file) => {
                            if (!file) {
                              setRequirementPdf(null);
                              return;
                            }
                            if (!isRequirementUploadFile(file)) {
                              setMessages((p) => [
                                ...p,
                                {
                                  id: newCoworkerMessageId(),
                                  role: "assistant",
                                  text: `That file type isn't supported — attach a ${REQUIREMENT_FILE_TYPES_LABEL} BRD.`,
                                },
                              ]);
                              return;
                            }
                            if (file.size > REQUIREMENT_FILE_MAX_BYTES) {
                              setMessages((p) => [
                                ...p,
                                {
                                  id: newCoworkerMessageId(),
                                  role: "assistant",
                                  text: "That file is too large — please keep requirement uploads under 12 MB.",
                                },
                              ]);
                              return;
                            }
                            const reader = new FileReader();
                            reader.onload = () => {
                              const raw = String(reader.result || "");
                              const base64 = raw.includes(",")
                                ? raw.split(",")[1] || ""
                                : raw;
                              if (!base64) {
                                setMessages((p) => [
                                  ...p,
                                  {
                                    id: newCoworkerMessageId(),
                                    role: "assistant",
                                    text: `I couldn't read that file — try another ${REQUIREMENT_FILE_TYPES_LABEL} document.`,
                                  },
                                ]);
                                return;
                              }
                              setRequirementPdf({
                                name: file.name,
                                base64,
                                size: file.size,
                              });
                            };
                            reader.onerror = () => {
                              setMessages((p) => [
                                ...p,
                                {
                                  id: newCoworkerMessageId(),
                                  role: "assistant",
                                  text: `I couldn't read that file — try another ${REQUIREMENT_FILE_TYPES_LABEL} document.`,
                                },
                              ]);
                            };
                            reader.readAsDataURL(file);
                          },
                          pending:
                            requirementPdf &&
                            !messages.some(
                              (m) =>
                                m.attachment?.name === requirementPdf.name,
                            )
                              ? {
                                  name: requirementPdf.name,
                                  size: requirementPdf.size,
                                }
                              : null,
                          onClearPending: () => setRequirementPdf(null),
                        }
                      : undefined
                  }
                  onRestart={() => {
                    setMessages([
                      { id: "welcome", role: "assistant", text: welcome },
                    ]);
                    setTools([]);
                    setInput("");
                    setSeoProgress(null);
                    setRequirementPdf(null);
                    sessionMemoryApi.clear();
                    seedConsumedRef.current = false;
                  }}
                  onMinimize={
                    collapseChatToFab
                      ? () => {
                          dispatch(setCoworkerExpand("draft"));
                          setMobileTab("draft");
                        }
                      : undefined
                  }
                  onExpand={() => toggleExpand("chat")}
                  expanded={expand === "chat"}
                  expandLabel={chatExpandLabel}
                  widePanel={expand === "chat" || expand === "chatFull"}
                  sending={sending}
                  sendingStatus={
                    pathname.startsWith("/marketing/seo") && seoProgress ? (
                      <SeoGenerateProgress
                        progress={seoProgress}
                        running={sending}
                      />
                    ) : (
                      <CoworkerProgressPill
                        labels={
                          moduleId === "sales"
                            ? [
                                "Checking the deal…",
                                "Looking at proposals and notes…",
                                "Putting the answer together…",
                              ]
                            : moduleId === "contact"
                              ? [
                                  "Looking up contacts…",
                                  "Checking CRM overlays…",
                                  "Putting the answer together…",
                                ]
                              : undefined
                        }
                      />
                    )
                  }
                  placeholder={
                    requirementPdf && moduleId === "sales"
                      ? "Add a note, then press Enter…"
                      : pathname.startsWith("/marketing/seo")
                        ? "Tell me what you want to promote…"
                        : (CHAT_PLACEHOLDERS[moduleId] ??
                          "Ask your CRM agent…")
                  }
                />
              </div>
              {tools.length > 0 ? (
                <div className={`flex shrink-0 flex-wrap gap-2 ${WORKTUAL_CONTROL_RADIUS} border-[0.6px] border-[#bfbfbf] bg-white p-2`}>
                  {tools.map((tool) => (
                    <Button
                      key={tool.id}
                      type="button"
                      variant="primary"
                      disabled={busyTool === tool.id}
                      onClick={() => void runTool(tool)}
                    >
                      {busyTool === tool.id
                        ? "Working…"
                        : `Confirm: ${tool.label}`}
                    </Button>
                  ))}
                </div>
              ) : null}
            </div>
          }
          draft={
            pageFull ? (
              <div className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-white">
                <div className={workspacePaneClass} data-workspace-scroll="">
                  {workspace}
                </div>
              </div>
            ) : (
              <div className={WORKTUAL_WORKSPACE_PANEL}>
                {hideWorkspaceHeader ? null : (
                <div
                  className={`${COWORKER_PANEL_HEADER_CLASS} ${
                    workspaceHeaderTall ||
                    workspaceHeaderLeading ||
                    workspaceSubtitle ||
                    workspaceHeaderActions
                      ? "h-auto min-h-16 flex-wrap items-center gap-x-2 gap-y-2 py-2.5"
                      : ""
                  }`}
                >
                  {workspaceHeaderLeading ? (
                    <div className="min-w-0 flex-1 basis-[12rem]">
                      {workspaceHeaderLeading}
                    </div>
                  ) : (
                    <div className="min-w-0 flex-1 basis-[12rem] leading-tight">
                      <p className="truncate text-[18px] font-semibold text-neutral-900">
                        {workspaceTitle ?? title ?? "Workspace"}
                      </p>
                      {workspaceSubtitle ? (
                        <p className="mt-0.5 truncate text-sm text-neutral-500">
                          {workspaceSubtitle}
                        </p>
                      ) : null}
                    </div>
                  )}
                  {workspaceHeaderActions ? (
                    <div className="ml-auto flex min-w-0 shrink-0 flex-wrap items-center justify-end gap-2">
                      {workspaceHeaderActions}
                    </div>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => {
                      dispatch(setCoworkerExpand("chatFull"));
                      setMobileTab("chat");
                    }}
                    className={`${COWORKER_ICON_BTN_CLASS} hidden shrink-0 lg:inline-flex`}
                    aria-label="Minimize workspace"
                    title="Minimize workspace"
                  >
                    <PanelRightClose className="size-[18px]" strokeWidth={1.75} />
                  </button>
                  <button
                    type="button"
                    onClick={() => toggleExpand("draft")}
                    className={`${COWORKER_ICON_BTN_CLASS} hidden shrink-0 lg:inline-flex`}
                    aria-label={workspaceExpandLabel}
                    title={workspaceExpandLabel}
                  >
                    {expand === "draft" ? (
                      <Shrink className="size-[18px]" strokeWidth={1.75} />
                    ) : (
                      <Expand className="size-[18px]" strokeWidth={1.75} />
                    )}
                  </button>
                </div>
                )}
                <div className={workspacePaneClass} data-workspace-scroll="">
                  {workspace}
                </div>
              </div>
            )
          }
        />
      </div>
    </div>
  );
}
