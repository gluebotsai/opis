import type { E2eServiceConfig } from "./e2e-config.js";
import type { AgentSession } from "./cc-core-client.js";

export class NlpClient {
  constructor(private readonly config: E2eServiceConfig) {}

  private headers(organizationId: string): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "x-tenant-id": organizationId,
    };
    if (this.config.internalServiceKey) {
      headers["x-internal-service-key"] = this.config.internalServiceKey;
    }
    return headers;
  }

  async webchatTurn(input: {
    organizationId: string;
    conversationId: string;
    message: string;
    transcript?: Array<{ role: string; content: string }>;
    tenantContext?: Record<string, unknown>;
  }) {
    return this.post("/api/v1/webchat/turn", input.organizationId, {
      organization_id: input.organizationId,
      conversation_id: input.conversationId,
      message: input.message,
      transcript: input.transcript ?? [],
      tenant_context: input.tenantContext ?? {},
    });
  }

  async copilotTurn(
    session: AgentSession,
    input: {
      message: string;
      surface?: string;
      path?: string;
      conversationId?: string;
    },
  ) {
    const response = await fetch(`${this.config.nlpUrl}/api/v1/copilot`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.token}`,
      },
      body: JSON.stringify({
        message: input.message,
        role: "agent",
        context: {
          path: input.path ?? "/admin/performance",
          surface: input.surface ?? "performance",
          conversationId: input.conversationId,
        },
        history: [],
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(`NLP POST /api/v1/copilot failed (${response.status}): ${JSON.stringify(payload)}`);
    }
    return payload as { turnId?: string; reply?: string; route?: string };
  }

  async whatsappTurn(input: {
    organizationId: string;
    conversationId: string;
    message: string;
  }) {
    return this.post("/api/v1/whatsapp/turn", input.organizationId, {
      organization_id: input.organizationId,
      conversation_id: input.conversationId,
      message: input.message,
    });
  }

  private async post(path: string, organizationId: string, body: unknown) {
    const response = await fetch(`${this.config.nlpUrl}${path}`, {
      method: "POST",
      headers: this.headers(organizationId),
      body: JSON.stringify(body),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(`NLP POST ${path} failed (${response.status}): ${JSON.stringify(payload)}`);
    }
    return payload as {
      reply?: string;
      confidence?: number;
      intent?: string | null;
      handoff_recommended?: boolean;
      model_name?: string;
      knowledge_used?: string[];
      summary?: string | null;
      important_facts?: string[];
      contact_entities?: { phone?: string | null; email?: string | null };
    };
  }
}
