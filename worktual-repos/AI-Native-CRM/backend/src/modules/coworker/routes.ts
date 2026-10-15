import type { FastifyPluginAsync } from "fastify";
import { dealDraftAssistCommand } from "@/service/ai/coworker-deal-draft";
import { contactDraftAssistCommand } from "@/service/ai/coworker-contact-draft";
import {
  companyDraftAssistCommand,
  locationDraftAssistCommand,
} from "@/service/ai/coworker-company-draft";
import {
  activityDraftAssistCommand,
  invoiceDraftAssistCommand,
  productDraftAssistCommand,
  quoteDraftAssistCommand,
} from "@/service/ai/coworker-misc-drafts";
import { pageAssistCommand } from "@/service/ai/coworker-page-assist";
import { agentTurnCommand } from "@/service/ai/coworker-agent-turn";
import { executionIds, type ExecutionIds } from "@/service/ai/execution-context";
import { requireSession, withUser } from "../../middlewares/auth.js";
import { sendResult } from "../../helpers/response.js";

type DraftBody = {
  messages?: Array<{ role: "assistant" | "user"; text: string }>;
  draft?: Record<string, unknown>;
  companyId?: string;
  pathname?: string | null;
  sessionMemory?: Record<string, unknown> | null;
  sourceContactId?: string | null;
};

type AgentTurnBody = {
  messages?: Array<{ role: "assistant" | "user"; text: string }>;
  context?: {
    module?: string | null;
    surface?: string | null;
    entityId?: string | null;
    pathname?: string | null;
    draft?: Record<string, unknown> | null;
    sessionMemory?: Record<string, unknown> | null;
  };
  sessionMemory?: Record<string, unknown> | null;
  confirmTool?: { name?: string; args?: Record<string, unknown> } | null;
  conversationId?: string;
  runId?: string;
  traceId?: string;
  idempotencyKey?: string;
};

function turnInput(body: AgentTurnBody, ids: ExecutionIds, signal?: AbortSignal) {
  return {
    messages: body.messages,
    context: body.context,
    sessionMemory: body.sessionMemory ?? body.context?.sessionMemory,
    confirmTool: body.confirmTool?.name
      ? {
          name: String(body.confirmTool.name),
          args: body.confirmTool.args ?? {},
        }
      : null,
    execution: ids,
    signal,
  };
}

function registerDraftRoute(
  app: Parameters<FastifyPluginAsync>[0],
  path: string,
  run: (body: DraftBody) => Promise<{ ok: boolean; [k: string]: unknown }>,
) {
  app.post<{ Body: DraftBody }>(path, async (request, reply) => {
    const userId = await requireSession(request, reply);
    if (!userId) return;
    return withUser(userId, async () => {
      const result = await run(request.body ?? {});
      return sendResult(reply, result as { ok: true } | { ok: false; error: string });
    });
  });
}

export const coworkerRoutes: FastifyPluginAsync = async (app) => {
  registerDraftRoute(app, "/deal-draft", (body) =>
    dealDraftAssistCommand({
      messages: body.messages,
      draft: body.draft as never,
      pathname: body.pathname,
      sessionMemory: body.sessionMemory,
      sourceContactId: body.sourceContactId,
    }),
  );
  registerDraftRoute(app, "/contact-draft", (body) =>
    contactDraftAssistCommand({
      messages: body.messages,
      draft: body.draft as never,
      pathname: body.pathname,
      sessionMemory: body.sessionMemory,
    }),
  );
  registerDraftRoute(app, "/company-draft", (body) =>
    companyDraftAssistCommand({
      messages: body.messages,
      draft: body.draft as never,
      pathname: body.pathname,
      sessionMemory: body.sessionMemory,
    }),
  );
  registerDraftRoute(app, "/location-draft", (body) =>
    locationDraftAssistCommand({
      messages: body.messages,
      draft: body.draft as never,
      companyId: body.companyId,
      pathname: body.pathname,
      sessionMemory: body.sessionMemory,
    }),
  );
  registerDraftRoute(app, "/product-draft", (body) =>
    productDraftAssistCommand({
      messages: body.messages,
      draft: body.draft as never,
      pathname: body.pathname,
      sessionMemory: body.sessionMemory,
    }),
  );
  registerDraftRoute(app, "/invoice-draft", (body) =>
    invoiceDraftAssistCommand({
      messages: body.messages,
      draft: body.draft as never,
      pathname: body.pathname,
      sessionMemory: body.sessionMemory,
    }),
  );
  registerDraftRoute(app, "/activity-draft", (body) =>
    activityDraftAssistCommand({
      messages: body.messages,
      draft: body.draft as never,
      pathname: body.pathname,
      sessionMemory: body.sessionMemory,
    }),
  );
  registerDraftRoute(app, "/quote-draft", (body) =>
    quoteDraftAssistCommand({
      messages: body.messages,
      draft: body.draft as never,
      pathname: body.pathname,
      sessionMemory: body.sessionMemory,
    }),
  );

  app.post<{
    Body: {
      messages?: Array<{ role: "assistant" | "user"; text: string }>;
      context?: {
        module?: string | null;
        surface?: string | null;
        entityId?: string | null;
        pathname?: string | null;
      };
    };
  }>("/page-assist", async (request, reply) => {
    const userId = await requireSession(request, reply);
    if (!userId) return;
    return withUser(userId, async () => {
      const body = request.body ?? {};
      const result = await pageAssistCommand({
        messages: body.messages,
        context: body.context,
      });
      return sendResult(reply, result);
    });
  });

  app.post<{ Body: AgentTurnBody }>("/agent-turn", async (request, reply) => {
    const userId = await requireSession(request, reply);
    if (!userId) return;
    return withUser(userId, async () => {
      const body = request.body ?? {};
      const ids = executionIds(request, body as Record<string, unknown>);
      const result = await agentTurnCommand(turnInput(body, ids));
      return sendResult(reply, { ...result, ...ids });
    }, request);
  });

  /** @deprecated MCP lives in Python; use agent-turn + confirmTool. */
  app.post("/execute-tool", async (_request, reply) => {
    return sendResult(reply, {
      ok: false as const,
      error:
        "Coworker MCP is agent-only in Python. Confirm via chat or agent-turn confirmTool.",
    });
  });
};
