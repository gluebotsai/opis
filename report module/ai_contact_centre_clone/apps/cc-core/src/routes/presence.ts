import type { FastifyInstance } from "fastify";
import { joinApiV1 } from "@ai-contact-center/api-paths";
import { z } from "zod";

import { withOrganizationContext } from "../lib/rls.js";
import {
  getAgentPresenceForUser,
  heartbeatAgentPresence,
  updateAgentPresence,
  updatePresenceSchema,
} from "../services/presence.js";
import { recordAgentNotReadyEscalation } from "../services/agent-not-ready-escalations.js";
import { generateAgentAttentionInsight } from "../services/agent-attention-insight.js";
import { claimPresenceInitialization } from "../services/auth-sessions.js";
import { applyPresenceRoutingEffects } from "../services/presence-routing.js";
import {
  emitPresenceUpdated,
  emitPresenceUpdatedForAgent,
} from "../services/realtime.js";

function requireTenantId(
  app: FastifyInstance,
  request: { tenantId?: string; userId?: string },
): { organizationId: string; userId: string } {
  if (!request.tenantId || !request.userId) {
    throw app.httpErrors.unauthorized("Missing tenant or user context");
  }
  return { organizationId: request.tenantId, userId: request.userId };
}

function handleRouteError(app: FastifyInstance, error: unknown): never {
  if (error instanceof z.ZodError) {
    throw app.httpErrors.badRequest(error.issues[0]?.message ?? "Invalid payload");
  }
  if (
    typeof error === "object" &&
    error &&
    "status" in error &&
    typeof (error as { status: number }).status === "number"
  ) {
    const status = (error as { status: number }).status;
    const message = error instanceof Error ? error.message : "Request failed";
    if (status === 403) throw app.httpErrors.forbidden(message);
    if (status === 400) throw app.httpErrors.badRequest(message);
    if (status === 503) throw app.httpErrors.serviceUnavailable(message);
    if (status === 504) throw app.httpErrors.gatewayTimeout(message);
  }
  throw error;
}

export async function registerPresenceRoutes(
  app: FastifyInstance,
  apiV1Base: string,
): Promise<void> {
  await app.register(async (scoped) => {
    scoped.addHook("preHandler", app.requireContactCenter);
    const prefix = joinApiV1(apiV1Base, "/workspace/presence");

    scoped.get(prefix, async (request) => {
      const { organizationId, userId } = requireTenantId(app, request);
      const presence = await withOrganizationContext(app.prisma, organizationId, (db) =>
        getAgentPresenceForUser(db, organizationId, userId),
      );
      return { presence };
    });

    scoped.post(`${prefix}/initialize`, async (request) => {
      try {
        const { organizationId, userId } = requireTenantId(app, request);
        const authorization = request.headers.authorization ?? "";
        const token = authorization.replace(/^Bearer\s+/i, "").trim();
        if (!token) throw app.httpErrors.unauthorized("Missing authenticated session");
        const firstForSession = await claimPresenceInitialization(app.prisma, token);
        const presence = await withOrganizationContext(
          app.prisma,
          organizationId,
          (db) =>
            firstForSession
              ? updateAgentPresence(
                  db,
                  organizationId,
                  userId,
                  {
                    state: "not_ready",
                    reasonCode: "login_default",
                    source: "login",
                  },
                  {
                    prisma: app.prisma,
                    onAck: (acked) => {
                      emitPresenceUpdated(organizationId, acked, userId);
                      emitPresenceUpdatedForAgent(organizationId, userId, acked);
                      void applyPresenceRoutingEffects(app, organizationId, userId, acked);
                    },
                  },
                )
              : getAgentPresenceForUser(db, organizationId, userId),
        );
        if (presence && (!firstForSession || presence.state === "not_ready")) {
          emitPresenceUpdated(organizationId, presence, userId);
          emitPresenceUpdatedForAgent(organizationId, userId, presence);
        }
        return { presence, initialized: firstForSession };
      } catch (error) {
        handleRouteError(app, error);
      }
    });

    scoped.patch(prefix, async (request) => {
      try {
        const { organizationId, userId } = requireTenantId(app, request);
        const payload = updatePresenceSchema.parse(request.body);
        const presence = await withOrganizationContext(app.prisma, organizationId, (db) =>
          updateAgentPresence(db, organizationId, userId, payload, {
            prisma: app.prisma,
            onAck: (acked) => {
              emitPresenceUpdated(organizationId, acked, userId);
              emitPresenceUpdatedForAgent(organizationId, userId, acked);
              void applyPresenceRoutingEffects(app, organizationId, userId, acked);
            },
          }),
        );
        if (presence.state === payload.state) {
          emitPresenceUpdated(organizationId, presence, userId);
          emitPresenceUpdatedForAgent(organizationId, userId, presence);
          await applyPresenceRoutingEffects(app, organizationId, userId, presence);
        }

        return { presence };
      } catch (error) {
        handleRouteError(app, error);
      }
    });

    scoped.post(`${prefix}/heartbeat`, async (request) => {
      const { organizationId, userId } = requireTenantId(app, request);
      const presence = await withOrganizationContext(app.prisma, organizationId, (db) =>
        heartbeatAgentPresence(db, organizationId, userId),
      );
      return { presence };
    });

    scoped.post(`${prefix}/not-ready-escalate`, async (request) => {
      try {
        const { organizationId, userId } = requireTenantId(app, request);
        const result = await withOrganizationContext(app.prisma, organizationId, (db) =>
          recordAgentNotReadyEscalation(db, organizationId, userId),
        );
        if (result.isNew) {
          void withOrganizationContext(app.prisma, organizationId, (db) =>
            generateAgentAttentionInsight(db, organizationId, result.record),
          ).catch(() => {
            // Insight generation is best-effort; escalation is already recorded.
          });
        }
        return { escalation: { id: result.record.id } };
      } catch (error) {
        if (error instanceof Error && "status" in error) {
          const status = (error as Error & { status: number }).status;
          if (status === 404) throw app.httpErrors.notFound(error.message);
        }
        handleRouteError(app, error);
      }
    });
  });
}
