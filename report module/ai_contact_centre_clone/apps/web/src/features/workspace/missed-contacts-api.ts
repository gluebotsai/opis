import { ccCoreHttp } from "@/services/http";
import { apiV1 } from "@/config/api-paths";

export type AgentMissedContact = {
  id: string;
  conversationId: string;
  contactId: string | null;
  queueId: string | null;
  channel: string;
  reason: "offer_timeout" | "no_agent_available";
  customerName: string;
  customerEmail: string | null;
  customerPhone: string | null;
  offeredAt: string | null;
  missedAt: string;
  acknowledgedAt: string | null;
};

export type AgentMissedContactListResponse = {
  items: AgentMissedContact[];
  unreadCount: number;
};

export const missedContactsApi = {
  async list(limit = 20): Promise<AgentMissedContactListResponse> {
    const { data } = await ccCoreHttp.get<AgentMissedContactListResponse>(
      apiV1("/workspace/missed-contacts"),
      { params: { limit } },
    );
    return data;
  },

  async acknowledge(id: string): Promise<{ item: AgentMissedContact; unreadCount: number }> {
    const { data } = await ccCoreHttp.post<{ item: AgentMissedContact; unreadCount: number }>(
      apiV1(`/workspace/missed-contacts/${id}/acknowledge`),
    );
    return data;
  },

  async acknowledgeAll(): Promise<{ acknowledgedCount: number; unreadCount: number }> {
    const { data } = await ccCoreHttp.post<{ acknowledgedCount: number; unreadCount: number }>(
      apiV1("/workspace/missed-contacts/acknowledge-all"),
    );
    return data;
  },
};
