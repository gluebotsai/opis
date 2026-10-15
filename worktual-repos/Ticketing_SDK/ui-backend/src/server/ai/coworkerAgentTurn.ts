/**
 * Host-side coworker agent-turn helper: hydrate context, mint MCP JWT, call AI.
 */
import type { AuthUser } from "../../types";
import { canCreateTicket as roleCanCreateTicket } from "../../rbac";
import {
  callAiServiceAgent,
  callAiServiceAgentStream,
  callLegacyAgentTurn,
  runMessageFromUploads,
} from "./aiServiceClient";
import { issueMcpExecutionToken } from "./mcpToken";

export type CoworkerTurnInput = {
  user: AuthUser;
  message: string;
  sessionId?: string;
  requestId?: string;
  module?: string;
  surface?: string;
  page?: string;
  pageSurface?: string;
  /** Hub remainder channel: chat | email */
  channel?: string;
  history?: Array<{ role: string; text: string }>;
  focusedEntity?: Record<string, unknown> | null;
  drafts?: Record<string, unknown>;
  ticketDraft?: Record<string, unknown> | null;
  sessionMemory?: Record<string, unknown>;
  portalCustomerId?: string | null;
  portalAuthenticated?: boolean;
  portalAuthMode?: string | null;
  /** UI confirm-chip payload; authoritative confirmation for a proposed mutation. */
  confirmTool?: Record<string, unknown> | null;
  /** Open row id from the right-hand page when focused_entity was omitted. */
  entityId?: string | null;
  /** BCP 47 reply language for this turn. */
  locale?: string;
  /** SDK partner calls only. Staff chat leaves this unset. */
  debug?: boolean;
};

const MODULE_FOCUS_TYPE: Record<string, string> = {
  tickets: "ticket",
  ticket: "ticket",
  customers: "customer",
  customer: "customer",
  teams: "team",
  team: "team",
  queues: "team",
  kb: "article",
  article: "article",
  macros: "macro",
  macro: "macro",
  priorities: "priority",
  priority: "priority",
  statuses: "status",
  status: "status",
};

/** Prefer the UI-open row. Detail pages always have an id even if session focus lagged. */
export function resolveFocusedEntity(input: {
  focusedEntity?: Record<string, unknown> | null;
  entityId?: string | null;
  module?: string;
}): Record<string, unknown> | null {
  const fe = input.focusedEntity;
  if (fe && typeof fe === "object") {
    const id = String(fe.id || fe.ticketNumber || fe.ticket_number || "").trim();
    const name = String(fe.name || fe.subject || fe.title || "").trim();
    if (id || name) return fe;
  }
  const entityId = String(input.entityId || "").trim();
  const module = String(input.module || "").trim().toLowerCase();
  const type = MODULE_FOCUS_TYPE[module];
  if (entityId && type) {
    const row: Record<string, unknown> = {
      type,
      id: entityId,
      name: entityId,
    };
    if (type === "ticket") {
      row.ticketNumber = entityId;
    }
    return row;
  }
  return null;
}

/** Chat turn text: keep greeting/confirm empty so those routes stay unchanged. */
export function staffTurnUserMessage(input: {
  message?: string;
  ticketDraft?: Record<string, unknown> | null;
  kind?: string;
  confirmTool?: unknown;
}): string {
  const kind = String(input.kind || "").trim().toLowerCase();
  const raw = String(input.message || "").trim();
  if (kind === "greeting") return raw;
  if (input.confirmTool && !raw) return raw;
  return runMessageFromUploads(raw, input.ticketDraft);
}

function executionMode(): "native" | "legacy" {
  // Native is the sole production path; legacy only when explicitly forced.
  const mode = String(process.env.COWORKER_EXECUTION_MODE || "native")
    .trim()
    .toLowerCase();
  return mode === "legacy" ? "legacy" : "native";
}

function toAiInput(input: CoworkerTurnInput) {
  const role = String(input.user.role || "agent");
  const canCreate = roleCanCreateTicket(role as Parameters<typeof roleCanCreateTicket>[0]);
  const mcpToken = issueMcpExecutionToken({
    organizationId: String(input.user.organizationId),
    actorId: String(input.user.id),
    role,
    module: input.module,
    surface: input.surface || input.pageSurface,
    runId: input.requestId,
  });
  return {
    agentName: "ticketing-coworker" as const,
    message: runMessageFromUploads(input.message, input.ticketDraft),
    organizationId: String(input.user.organizationId),
    userId: String(input.user.id),
    userRole: role,
    userName: input.user.name,
    sessionId: input.sessionId,
    requestId: input.requestId,
    module: input.module,
    surface: input.surface,
    page: input.page,
    pageSurface: input.pageSurface,
    channel: input.channel || "chat",
    history: input.history,
    focusedEntity: resolveFocusedEntity(input),
    drafts: input.drafts,
    ticketDraft: input.ticketDraft,
    sessionMemory: input.sessionMemory,
    canCreateTicket: canCreate,
    mcpToken,
    portalCustomerId: input.portalCustomerId,
    portalAuthenticated: input.portalAuthenticated,
    portalAuthMode: input.portalAuthMode,
    confirmTool: input.confirmTool || null,
    executionMode: "native" as const,
    locale: input.locale,
    debug: input.debug === true,
  };
}

export async function runCoworkerAgentTurn(
  input: CoworkerTurnInput
): Promise<Record<string, unknown>> {
  const role = String(input.user.role || "agent");
  const canCreate = roleCanCreateTicket(role as Parameters<typeof roleCanCreateTicket>[0]);
  const mode = executionMode();

  if (mode === "legacy") {
    return callLegacyAgentTurn({
      message: runMessageFromUploads(input.message, input.ticketDraft),
      organization_id: input.user.organizationId,
      user_id: input.user.id,
      user_role: role,
      user_name: input.user.name,
      session_id: input.sessionId,
      request_id: input.requestId,
      module: input.module,
      surface: input.surface,
      page: input.page,
      page_surface: input.pageSurface,
      history: input.history || [],
      focused_entity: resolveFocusedEntity(input),
      ticket_draft: input.ticketDraft || null,
      draft: input.ticketDraft || null,
      session_memory: input.sessionMemory || {},
      can_create_ticket: canCreate,
      portal_customer_id: input.portalCustomerId || null,
      portal_authenticated: input.portalAuthenticated,
      portal_auth_mode: input.portalAuthMode || null,
    });
  }

  return callAiServiceAgent(toAiInput(input));
}

export async function runCoworkerAgentTurnStream(
  input: CoworkerTurnInput,
  onProgress?: (event: Record<string, unknown>) => void
): Promise<Record<string, unknown>> {
  const mode = executionMode();
  if (mode === "legacy") {
    return runCoworkerAgentTurn(input);
  }
  return callAiServiceAgentStream(toAiInput(input), onProgress);
}
