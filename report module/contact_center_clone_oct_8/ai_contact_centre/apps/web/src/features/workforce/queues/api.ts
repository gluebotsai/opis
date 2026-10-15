import { ccCoreHttp } from "@/services/http";
import { apiV1 } from "@/config/api-paths";
import type {
  BusinessHours,
  EligibleAgent,
  Queue,
  QueueAgent,
  QueueInput,
  QueueListQuery,
  QueueListResponse,
  Team,
} from "./types";

/** Workforce queues — cc-core setup APIs against accounts.setup_ccaas_* tables. */
export const queuesApi = {
  async listTeams(): Promise<{ teams: Team[] }> {
    const { data } = await ccCoreHttp.get<{ teams: Team[] }>(apiV1("/setup/ccaas/teams"));
    return data;
  },

  async listBusinessHours(): Promise<{ schedules: BusinessHours[] }> {
    const { data } = await ccCoreHttp.get<{ schedules: BusinessHours[] }>(
      apiV1("/setup/ccaas/business-hours"),
    );
    return data;
  },

  async listEligibleAgents(queueId?: string): Promise<{ agents: EligibleAgent[] }> {
    const { data } = await ccCoreHttp.get<{ agents: EligibleAgent[] }>(
      apiV1("/setup/ccaas/eligible-agents"),
      { params: queueId ? { queueId } : undefined },
    );
    return data;
  },

  async listQueues(query?: QueueListQuery): Promise<QueueListResponse> {
    const { data } = await ccCoreHttp.get<QueueListResponse>(apiV1("/setup/ccaas/queues"), {
      params: query,
    });
    return data;
  },

  async getQueue(id: string): Promise<{ queue: Queue }> {
    const { data } = await ccCoreHttp.get<{ queue: Queue }>(`${apiV1(`/setup/ccaas/queues/${id}`)}`);
    return data;
  },

  async createQueue(input: QueueInput): Promise<{ queue: Queue }> {
    const { data } = await ccCoreHttp.post<{ queue: Queue }>(apiV1("/setup/ccaas/queues"), input);
    return data;
  },

  async updateQueue(id: string, input: Partial<QueueInput>): Promise<{ queue: Queue }> {
    const { data } = await ccCoreHttp.patch<{ queue: Queue }>(
      `${apiV1(`/setup/ccaas/queues/${id}`)}`,
      input,
    );
    return data;
  },

  async deleteQueue(id: string): Promise<void> {
    await ccCoreHttp.delete(`${apiV1(`/setup/ccaas/queues/${id}`)}`);
  },

  async replaceQueueAgents(id: string, agents: QueueAgent[]): Promise<{ queue: Queue }> {
    const { data } = await ccCoreHttp.put<{ queue: Queue }>(
      `${apiV1(`/setup/ccaas/queues/${id}/agents`)}`,
      { agents },
    );
    return data;
  },
};
