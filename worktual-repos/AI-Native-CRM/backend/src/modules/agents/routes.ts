import type { FastifyPluginAsync } from "fastify";
import {
  getAgentRunStepsCommand,
  getAgentsDashboardCommand,
  listAgentRunsPageCommand,
} from "@/service/ai/agents-commands";
import { requireSession, withUser } from "../../middlewares/auth.js";
import { sendSuccess, sendResult } from "../../helpers/response.js";
import { getCurrentOrganizationId } from "@/service/auth/require-role";
import {
  replayAgentEvents,
  subscribeAgentEvents,
  type AgentStreamEvent,
} from "@/service/ai/agent-event-bus";

export const agentsRoutes: FastifyPluginAsync = async (app) => {
  app.get<{
    Querystring: { range?: string };
  }>("/", async (request, reply) => {
    const userId = await requireSession(request, reply);
    if (!userId) return;
    return withUser(
      userId,
      async () => {
        const result = await getAgentsDashboardCommand({
          range: request.query.range,
        });
        if (!result.ok) {
          return sendResult(reply, result, result.status);
        }
        return sendSuccess(reply, { data: result.data  });
      },
      request,
    );
  });

  /**
   * Paginated run history for one agent's dedicated "Recent runs" page —
   * replaces the old in-card dropdown, which becomes unusable once there are
   * many runs. Shared by every agent that has a job table + contactId
   * (see SUPPORTED_AGENT_IDS in agents-commands.ts).
   */
  app.get<{
    Params: { agentId: string };
    Querystring: {
      limit?: string;
      offset?: string;
      status?: string;
      range?: string;
    };
  }>("/:agentId/runs/page", async (request, reply) => {
    const userId = await requireSession(request, reply);
    if (!userId) return;
    return withUser(
      userId,
      async () => {
        const result = await listAgentRunsPageCommand(request.params.agentId, {
          limit: request.query.limit ? Number(request.query.limit) : undefined,
          offset: request.query.offset
            ? Number(request.query.offset)
            : undefined,
          status: request.query.status || null,
          range: request.query.range || null,
        });
        if (!result.ok) return sendResult(reply, result, result.status);
        return sendSuccess(reply, { data: result.data });
      },
      request,
    );
  });

  /** Curated step trace for one agent run. */
  app.get<{ Params: { agentId: string; jobId: string } }>(
    "/:agentId/runs/:jobId/steps",
    async (request, reply) => {
      const userId = await requireSession(request, reply);
      if (!userId) return;
      return withUser(
        userId,
        async () => {
          const result = await getAgentRunStepsCommand(
            request.params.agentId,
            request.params.jobId,
          );
          if (!result.ok) return sendResult(reply, result, result.status);
          return sendSuccess(reply, { data: result.data });
        },
        request,
      );
    },
  );

  /** Authenticated, tenant-checked live step events for one run. */
  app.get<{
    Params: { agentId: string; jobId: string };
    Querystring: { cursor?: string };
  }>("/:agentId/runs/:jobId/events", async (request, reply) => {
    const userId = await requireSession(request, reply);
    if (!userId) return;
    return withUser(userId, async () => {
      const existing = await getAgentRunStepsCommand(
        request.params.agentId,
        request.params.jobId,
      );
      if (!existing.ok) return sendResult(reply, existing, existing.status);
      const organizationId = await getCurrentOrganizationId();
      reply.hijack();
      reply.raw.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });
      const cursor =
        typeof request.headers["last-event-id"] === "string"
          ? request.headers["last-event-id"]
          : request.query.cursor;
      const send = (event: AgentStreamEvent) => {
        reply.raw.write(
          `id: ${event.id}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`,
        );
      };
      for (const event of await replayAgentEvents(
        organizationId,
        request.params.jobId,
        cursor,
      )) {
        send(event);
      }
      const unsubscribe = await subscribeAgentEvents(
        organizationId,
        request.params.jobId,
        send,
      );
      const heartbeat = setInterval(
        () => reply.raw.write(`: heartbeat ${Date.now()}\n\n`),
        Math.max(5_000, Number(process.env.AGENT_SSE_HEARTBEAT_MS || 15_000)),
      );
      request.raw.once("close", () => {
        clearInterval(heartbeat);
        unsubscribe();
      });
    }, request);
  });
};
