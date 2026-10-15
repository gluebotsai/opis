import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { CALL_OUTCOMES, saveVoiceCallOutcome } from "../services/voice-call-outcome.js";

const requestSchema = z.object({
  organizationId: z.string().trim().min(1).max(32),
  sessionId: z.string().trim().min(1).max(128),
  outcome: z.enum(CALL_OUTCOMES),
  mobile: z.string().trim().min(1).max(32),
  name: z.string().trim().min(1).max(200).optional(),
  email: z.string().trim().min(1).max(320).optional(),
  instruction: z.string().trim().min(1).max(4_000).optional(),
  reason: z.string().trim().max(2_000).optional(),
  callbackAt: z.string().trim().min(1).max(64).optional(),
  timezone: z.string().trim().min(1).max(64).optional(),
});

export async function registerVoiceCallOutcomeRoutes(app: FastifyInstance): Promise<void> {
  await app.register(async (scoped) => {
    scoped.addHook("preHandler", app.requireInternalService);

    const paths = [
      "/internal/v1/voice/call-outcome",
      "/cc-core-api/internal/v1/voice/call-outcome",
    ];
    for (const path of paths) {
      scoped.post(path, async (request) => {
        const parsed = requestSchema.safeParse(request.body ?? {});
        if (!parsed.success) {
          throw Object.assign(new Error("Invalid call outcome"), { status: 400 });
        }
        const body = parsed.data;
        const result = await saveVoiceCallOutcome(app.prisma, body);
        request.log.info(
          {
            event: "voice.call-outcome.saved",
            organizationId: body.organizationId.trim(),
            sessionId: result.sessionId,
            outcome: result.outcome,
          },
          "Voice call outcome saved",
        );
        return {
          ok: true,
          sessionId: result.sessionId,
          outcome: result.outcome,
          mobile: result.mobile,
          status: result.status,
          name: result.name,
          email: result.email,
          instruction: result.instruction,
          timezone: result.timezone,
          createdAt: result.createdAt,
        };
      });
    }
  });
}
