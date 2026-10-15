import type { HttpClient } from "../http.js";
import type { AgentQueue } from "../types.js";

export function createQueuesResource(http: HttpClient) {
  return {
    /** GET /api/queues — requires accessToken. */
    list(): Promise<AgentQueue[]> {
      return http.request<AgentQueue[]>({
        method: "GET",
        path: "/api/queues",
        auth: "accessToken",
      });
    },
  };
}

export type QueuesResource = ReturnType<typeof createQueuesResource>;
