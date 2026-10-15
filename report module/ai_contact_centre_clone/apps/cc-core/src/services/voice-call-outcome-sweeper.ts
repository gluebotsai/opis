import type { FastifyInstance } from "fastify";

import { getRedisClient } from "../lib/redis-client.js";
import { resolveCampaignRedis } from "./auto-bot-call.js";
import { sweepDueCallOutcomes } from "./voice-call-outcome-follow-up.js";

export function startVoiceCallOutcomeSweeper(
  app: FastifyInstance,
  intervalMs = Number(process.env.VOICE_CALL_OUTCOME_SWEEP_INTERVAL_MS ?? 60_000),
): () => void {
  let running = false;

  const tick = () => {
    if (running) return;
    running = true;
    void (async () => {
      const redis = await resolveCampaignRedis(getRedisClient());
      const published = await sweepDueCallOutcomes(app.prisma, redis, undefined, (row, error) => {
        app.log.warn(
          {
            err: error,
            event: "voice.call-outcome.follow-up-row-failed",
            organizationId: row.organization_id,
            outcomeId: row.id,
          },
          "Callback follow-up was returned to pending",
        );
      });
      if (published > 0) {
        app.log.info(
          { event: "voice.call-outcome.follow-up", published },
          "Due callback auto-bot calls published",
        );
      }
    })()
      .catch((error) => {
        app.log.warn({ err: error, event: "voice.call-outcome.follow-up-failed" }, "Callback follow-up sweep failed");
      })
      .finally(() => {
        running = false;
      });
  };

  tick();
  const timer = setInterval(tick, intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}
