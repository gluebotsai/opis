/**
 * Durable agent memory HTTP surface (Worktual hub + settings).
 * Prefix: /api/agent-memory
 */

import type { FastifyPluginAsync } from "fastify";
import {
  clearAgentMemory,
  isAllowedMemoryScopeType,
  listAgentMemories,
  memoriesToPromptMap,
  upsertAgentMemory,
  type AgentMemoryScopeType,
} from "@/dao/ai/agent-memory";
import { getCurrentOrganizationId } from "@/service/auth/require-role";
import { requireSession, withUser } from "../../middlewares/auth.js";
import { sendError, sendSuccess } from "../../helpers/response.js";

export const agentMemoryRoutes: FastifyPluginAsync = async (app) => {
  app.get("/", async (request, reply) => {
    const userId = await requireSession(request, reply);
    if (!userId) return;
    return withUser(userId, async () => {
      const q = (request.query || {}) as {
        contactId?: string;
        dealId?: string;
      };
      const organizationId = await getCurrentOrganizationId();
      const slots = await listAgentMemories({
        organizationId,
        userId,
        contactId: q.contactId,
        dealId: q.dealId,
      });
      return sendSuccess(reply, {
        slots,
        map: memoriesToPromptMap(slots),
      });
    });
  });

  app.post<{
    Body: {
      scopeType?: string;
      scopeId?: string;
      slotKey?: string;
      slotValue?: unknown;
      expiresInSeconds?: number;
    };
  }>("/", async (request, reply) => {
    const userId = await requireSession(request, reply);
    if (!userId) return;
    return withUser(userId, async () => {
      const organizationId = await getCurrentOrganizationId();
      const body = request.body ?? {};
      const rawScopeType = String(body.scopeType || "user");
      if (!isAllowedMemoryScopeType(rawScopeType)) {
        return sendError(reply, "Invalid memory scope", 400);
      }
      const scopeType: AgentMemoryScopeType = rawScopeType;
      const expiresInSeconds = body.expiresInSeconds;
      if (
        expiresInSeconds !== undefined &&
        (!Number.isInteger(expiresInSeconds) ||
          expiresInSeconds < 60 ||
          expiresInSeconds > 31_536_000)
      ) {
        return sendError(reply, "Invalid memory expiry", 400);
      }
      const row = await upsertAgentMemory({
        organizationId,
        scopeType,
        scopeId: scopeType === "user" ? userId : body.scopeId,
        slotKey: String(body.slotKey || ""),
        slotValue: body.slotValue,
        source: "settings",
        expiresAt:
          expiresInSeconds === undefined
            ? null
            : new Date(Date.now() + expiresInSeconds * 1000),
      });
      if (!row) {
        return sendError(reply, "Invalid memory slot", 400);
      }
      return sendSuccess(reply, { slot: row });
    });
  });

  app.delete<{
    Body: {
      scopeType?: string;
      scopeId?: string;
      slotKey?: string;
    };
  }>("/", async (request, reply) => {
    const userId = await requireSession(request, reply);
    if (!userId) return;
    return withUser(userId, async () => {
      const organizationId = await getCurrentOrganizationId();
      const body = request.body ?? {};
      const rawScopeType = String(body.scopeType || "user");
      if (!isAllowedMemoryScopeType(rawScopeType)) {
        return sendError(reply, "Invalid memory scope", 400);
      }
      const scopeType: AgentMemoryScopeType = rawScopeType;
      const cleared = await clearAgentMemory({
        organizationId,
        scopeType,
        scopeId: scopeType === "user" ? userId : body.scopeId,
        slotKey: body.slotKey ? String(body.slotKey) : null,
      });
      return sendSuccess(reply, { cleared });
    });
  });
};
