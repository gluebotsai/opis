import type { E2eServiceConfig } from "./e2e-config.js";

export type AgentSession = {
  token: string;
  tenantId: string;
  userId: string;
};

export class CcCoreClient {
  private readonly agentSessions = new Map<string, AgentSession>();

  constructor(private readonly config: E2eServiceConfig) {}

  private internalHeaders(organizationId: string): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "x-tenant-id": organizationId,
    };
    if (this.config.internalServiceKey) {
      headers["x-internal-service-key"] = this.config.internalServiceKey;
    }
    return headers;
  }

  private workspaceHeaders(session: AgentSession): Record<string, string> {
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.token}`,
    };
  }

  async requestInternal<T>(
    organizationId: string,
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const response = await fetch(`${this.config.ccCoreUrl}${path}`, {
      method,
      headers: this.internalHeaders(organizationId),
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(
        `cc-core ${method} ${path} failed (${response.status}): ${JSON.stringify(payload)}`,
      );
    }
    return payload as T;
  }

  async requestWorkspace<T>(
    session: AgentSession,
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const response = await fetch(`${this.config.ccCoreUrl}${path}`, {
      method,
      headers: this.workspaceHeaders(session),
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(
        `workspace ${method} ${path} failed (${response.status}): ${JSON.stringify(payload)}`,
      );
    }
    return payload as T;
  }

  async logoutAgent(session: AgentSession): Promise<void> {
    await fetch(`${this.config.ccCoreUrl}/api/v1/auth/logout`, {
      method: "POST",
      headers: this.workspaceHeaders(session),
    }).catch(() => undefined);
  }

  async loginAgent(email?: string, password?: string): Promise<AgentSession> {
    const resolvedEmail = (email ?? this.config.agentEmail).trim().toLowerCase();
    const cached = this.agentSessions.get(resolvedEmail);
    if (cached) {
      return cached;
    }

    const response = await fetch(`${this.config.ccCoreUrl}/api/v1/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: resolvedEmail,
        password: password ?? this.config.agentPassword,
      }),
    });
    const payload = (await response.json()) as {
      token?: string;
      user?: { id?: string; organizationId?: string };
    };
    if (!response.ok || !payload.token) {
      throw new Error(`Agent login failed (${response.status}): ${JSON.stringify(payload)}`);
    }
    const session = {
      token: payload.token,
      tenantId: payload.user?.organizationId ?? "",
      userId: payload.user?.id ?? "",
    };
    this.agentSessions.set(resolvedEmail, session);
    return session;
  }

  startWebchatConversation(
    organizationId: string,
    input: {
      webchatId: string;
      visitorId: string;
      prechatAnswers?: Record<string, unknown>;
    },
  ) {
    return this.requestInternal<{ conversation: { id: string; contactId?: string | null } }>(
      organizationId,
      "POST",
      "/internal/v1/conversations",
      input,
    );
  }

  ingestEmail(
    organizationId: string,
    payload: Record<string, unknown>,
  ) {
    return this.requestInternal<{ conversation: { id: string; contactId?: string | null } }>(
      organizationId,
      "POST",
      "/internal/v1/email/conversations",
      payload,
    );
  }

  ingestSocial(
    organizationId: string,
    payload: Record<string, unknown>,
  ) {
    return this.requestInternal<{
      conversation: { id: string; contactId?: string | null };
      botEligible?: boolean;
    }>(organizationId, "POST", "/internal/v1/social/conversations", payload);
  }

  handoff(organizationId: string, conversationId: string, reason = "e2e_handoff") {
    return this.requestInternal(organizationId, "POST", `/internal/v1/conversations/${conversationId}/handoff`, {
      reason,
    });
  }

  getMemory(organizationId: string, conversationId: string) {
    return this.requestInternal<{
      conversationId: string;
      turns: Array<{ intent?: string | null; customerText: string; botReply?: string | null }>;
      memory: {
        organizationId: string;
        conversationId: string;
        rollingSummary?: string | null;
        extractedFacts?: string[];
      } | null;
    }>(organizationId, "GET", `/internal/v1/conversations/${conversationId}/memory`);
  }

  upsertMemory(
    organizationId: string,
    conversationId: string,
    input: {
      rollingSummary?: string | null;
      extractedFacts?: string[];
      modelName?: string;
    },
  ) {
    return this.requestInternal(
      organizationId,
      "PUT",
      `/internal/v1/conversations/${conversationId}/memory`,
      input,
    );
  }

  getChannelSummaries(organizationId: string, contactId: string) {
    return this.requestInternal<{
      channelSummaries: Array<{ channel: string; conversationId: string; summary: string }>;
      omniChannelSummary: string | null;
    }>(organizationId, "GET", `/internal/v1/contacts/${encodeURIComponent(contactId)}/channel-summaries`);
  }

  upsertOmniChannelSummary(organizationId: string, contactId: string, omniChannelSummary: string) {
    return this.requestInternal<{ contactId: string; omniChannelSummary: string }>(
      organizationId,
      "PUT",
      `/internal/v1/contacts/${encodeURIComponent(contactId)}/omni-channel-summary`,
      { omniChannelSummary },
    );
  }

  resolveContact(session: AgentSession, query: { email?: string; phone?: string }) {
    const params = new URLSearchParams();
    if (query.email) params.set("email", query.email);
    if (query.phone) params.set("phone", query.phone);
    return this.requestWorkspace<{ contactId: string }>(
      session,
      "GET",
      `/api/v1/cdp/contacts/resolve?${params.toString()}`,
    );
  }

  recordNlpTurn(
    organizationId: string,
    conversationId: string,
    input: Record<string, unknown>,
  ) {
    return this.requestInternal(
      organizationId,
      "POST",
      `/internal/v1/conversations/${conversationId}/nlp-turns`,
      input,
    );
  }

  enrichContact(organizationId: string, conversationId: string, enrich: Record<string, unknown>) {
    return this.requestInternal(
      organizationId,
      "POST",
      `/internal/v1/conversations/${conversationId}/contact/enrich`,
      enrich,
    );
  }

  getConversation(organizationId: string, conversationId: string) {
    return this.requestInternal<{
      conversation: {
        id: string;
        status: string;
        assignedAgentId?: string | null;
        contactId?: string | null;
      };
    }>(organizationId, "GET", `/internal/v1/conversations/${conversationId}`);
  }

  getContactInteractions(session: AgentSession, contactId: string) {
    return this.requestWorkspace<{
      interactions: Array<{ channel: string; conversationId: string; summary: string }>;
    }>(session, "GET", `/api/v1/cdp/contacts/${contactId}/interactions?limit=20`);
  }

  getConversationContext(session: AgentSession, conversationId: string) {
    return this.requestWorkspace<{
      context: { crossChannelSummary?: Array<{ channel: string; summary: string }> };
    }>(session, "GET", `/api/v1/workspace/conversations/${conversationId}/context`);
  }

  updatePresence(session: AgentSession, state: "ready" | "away" | "busy" | "not_ready") {
    return this.requestWorkspace<{ presence: { state: string } }>(
      session,
      "PATCH",
      "/api/v1/workspace/presence",
      { state },
    );
  }

  acceptOffer(session: AgentSession, conversationId: string) {
    return this.requestWorkspace(session, "POST", `/api/v1/workspace/conversations/${conversationId}/accept`, {});
  }

  rejectOffer(session: AgentSession, conversationId: string) {
    return this.requestWorkspace(session, "POST", `/api/v1/workspace/conversations/${conversationId}/reject`, {});
  }

  sendAgentMessage(session: AgentSession, conversationId: string, body: string) {
    return this.requestWorkspace<{ message: { id: string; body: string } }>(
      session,
      "POST",
      `/api/v1/workspace/conversations/${conversationId}/messages`,
      { body },
    );
  }

  listNlpTurns(organizationId: string, conversationId: string) {
    return this.requestInternal<{ turns: Array<{ intent?: string | null; customerText: string; botReply?: string | null }> }>(
      organizationId,
      "GET",
      `/internal/v1/conversations/${conversationId}/nlp-turns`,
    );
  }

  endConversation(
    session: AgentSession,
    conversationId: string,
    input: {
      reason: string;
      disposition?: { code: string; note?: string; isFinal?: boolean };
      resolution?: { code: string; summary?: string };
    },
  ) {
    return this.requestWorkspace<{ conversation: { id: string; status: string } }>(
      session,
      "POST",
      `/api/v1/workspace/conversations/${conversationId}/end`,
      {
        reason: input.reason,
        disposition: input.disposition,
        resolution: input.resolution,
      },
    );
  }

  resolveConversation(session: AgentSession, conversationId: string) {
    return this.requestWorkspace<{ conversation: { id: string; status: string } }>(
      session,
      "POST",
      `/api/v1/workspace/conversations/${conversationId}/resolve`,
      {},
    );
  }

  getWorkspaceConversation(session: AgentSession, conversationId: string) {
    return this.requestWorkspace<{
      conversation: {
        id: string;
        status: string;
        botActive: boolean;
        contactId?: string | null;
      };
      contact?: {
        id: string;
        primaryEmail?: string | null;
        primaryPhone?: string | null;
      } | null;
    }>(session, "GET", `/api/v1/workspace/conversations/${conversationId}`);
  }

  listWorkspaceMessages(session: AgentSession, conversationId: string) {
    return this.requestWorkspace<{
      messages: Array<{ id: string; body: string; senderType: string; direction: string }>;
    }>(session, "GET", `/api/v1/workspace/conversations/${conversationId}/messages?limit=50`);
  }
}
