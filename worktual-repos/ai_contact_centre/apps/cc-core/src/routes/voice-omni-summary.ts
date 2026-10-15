import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { refreshVoicebotOmniChannelSummary } from "../services/voice-omni-summary.js";

const requestSchema = z.object({
  organizationId: z.string().trim().min(1).max(32),
  mobile: z.string().trim().min(1).max(32),
  sessionId: z.string().trim().min(1).max(128),
});

export async function registerVoiceOmniSummaryRoutes(app: FastifyInstance): Promise<void> {
  await app.register(async (scoped) => {
    scoped.addHook("preHandler", app.requireInternalService);

    const paths = [
      "/internal/v1/voice/omni-channel-summary",
      "/cc-core-api/internal/v1/voice/omni-channel-summary",
    ];
    for (const path of paths) {
      scoped.post(path, async (request) => {
        const body = requestSchema.parse(request.body ?? {});
        const result = await refreshVoicebotOmniChannelSummary(app.prisma, body);
        request.log.info(
          {
            event: "voice.omni-summary.refreshed",
            organizationId: body.organizationId.trim(),
            conversationId: result.conversationId,
            contactId: result.contactId,
          },
          "Voice omni-channel summary refreshed",
        );
        return {
          ok: true,
          contactId: result.contactId,
          conversationId: result.conversationId,
          omniChannelSummary: result.omniChannelSummary,
          updatedAt: result.updatedAt,
        };
      });
    }
  });
}
