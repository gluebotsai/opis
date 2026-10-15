/**
 * Host-side coworker agent-turn helper: hydrate context, mint MCP JWT, call AI.
 */
import type { AuthUser } from "../../types";
import { canCreateTicket as roleCanCreateTicket } from "../../rbac";
import { callAiServiceAgent, callAiServiceAgentStream, callLegacyAgentTurn } from "./aiServiceClient";
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
};

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
    message: input.message,
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
    focusedEntity: input.focusedEntity,
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
      message: input.message,
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
      focused_entity: input.focusedEntity || null,
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
