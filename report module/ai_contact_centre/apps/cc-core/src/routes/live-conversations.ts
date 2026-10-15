import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { listLiveConversations } from "../services/live-conversations.js";

const requestSchema = z.object({
  organizationId: z.string().trim().min(1).max(32),
  identifier: z.string().trim().min(1).max(256),
});

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
    if (status === 400) throw app.httpErrors.badRequest(message);
  }
  throw error;
}

export async function registerLiveConversationRoutes(app: FastifyInstance): Promise<void> {
  await app.register(async (scoped) => {
    scoped.addHook("preHandler", app.requireInternalService);

    const paths = [
      "/internal/v1/contacts/live-conversations",
      "/cc-core-api/internal/v1/contacts/live-conversations",
    ];
    for (const path of paths) {
      scoped.post(path, async (request) => {
        try {
          const body = requestSchema.parse(request.body ?? {});
          return await listLiveConversations(app.prisma, body);
        } catch (error) {
          handleRouteError(app, error);
        }
      });
    }
  });
}
