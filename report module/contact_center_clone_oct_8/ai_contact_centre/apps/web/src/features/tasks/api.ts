import { ccCoreHttp } from "@/services/http";
import { apiV1 } from "@/config/api-paths";
import type { AgentTask, AgentTaskStats } from "./types";

export type AgentTaskListResponse = {
  tasks: AgentTask[];
  stats: AgentTaskStats;
};

export type AgentTaskUpdateAction = "complete" | "dismiss" | "accept_suggestion";

export const tasksApi = {
  async listTasks(): Promise<AgentTaskListResponse> {
    const { data } = await ccCoreHttp.get<AgentTaskListResponse>(apiV1("/workspace/tasks"));
    return data;
  },

  async getTask(id: string): Promise<{ task: AgentTask }> {
    const { data } = await ccCoreHttp.get<{ task: AgentTask }>(apiV1(`/workspace/tasks/${id}`));
    return data;
  },

  async updateTask(
    id: string,
    action: AgentTaskUpdateAction,
  ): Promise<{ task: AgentTask }> {
    const { data } = await ccCoreHttp.patch<{ task: AgentTask }>(
      apiV1(`/workspace/tasks/${id}`),
      { action },
    );
    return data;
  },

  async openWorkspace(id: string): Promise<{ conversationId: string }> {
    const { data } = await ccCoreHttp.post<{ conversationId: string }>(
      apiV1(`/workspace/tasks/${id}/open-workspace`),
    );
    return data;
  },
};
