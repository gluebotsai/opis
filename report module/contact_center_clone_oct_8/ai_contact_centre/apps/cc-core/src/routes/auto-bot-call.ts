import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { getRedisClient } from "../lib/redis-client.js";
import { publishAutoBotCall, resolveCampaignRedis } from "../services/auto-bot-call.js";

const triggerSchema = z.object({
  organizationId: z.string().min(1),
  number: z.string().min(1).max(32),
  data: z.record(z.unknown()).optional(),
  instruction: z.string().max(4_000).optional(),
});

export async function registerAutoBotCallRoutes(app: FastifyInstance): Promise<void> {
  await app.register(async (scoped) => {
    scoped.addHook("preHandler", app.requireInternalService);

    const paths = [
      "/internal/v1/voice/auto-bot-call",
      "/cc-core-api/internal/v1/voice/auto-bot-call",
    ];
    for (const path of paths) {
      scoped.post(path, async (request) => {
        const body = triggerSchema.parse(request.body ?? {});
        const redis = await resolveCampaignRedis(getRedisClient());
        if (!redis) {
          throw Object.assign(new Error("Campaign Redis is not configured"), { status: 503 });
        }
        const result = await publishAutoBotCall(app.prisma, redis, {
          organizationId: body.organizationId,
          customerNumber: body.number,
          data: body.data ?? {},
          instruction: body.instruction?.trim() ?? "",
        });
        request.log.info(
          {
            event: "voice.auto-bot-call.published",
            organizationId: body.organizationId.trim(),
            sessionId: result.sessionId,
            channel: result.channel,
          },
          "Auto bot call published",
        );
        return {
          ok: true,
          sessionId: result.sessionId,
          channel: result.channel,
          domainName: result.domainName,
          cli: result.cli,
        };
      });
    }
  });
}
