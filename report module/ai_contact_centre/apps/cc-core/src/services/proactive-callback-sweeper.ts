import type { FastifyInstance } from "fastify";

import type { DbClient } from "../lib/rls.js";
import { sweepProactiveCallbacks } from "./proactive-callback.js";

export function startProactiveCallbackSweeper(
  app: FastifyInstance,
  intervalMs = Number(process.env.PROACTIVE_CALLBACK_SWEEP_INTERVAL_MS ?? 90_000),
): () => void {
  const dbFactory = (): DbClient => app.prisma;

  const tick = () => {
    const db = dbFactory();
    void sweepProactiveCallbacks(db).catch((error) => {
      app.log.warn({ err: error }, "proactive callback sweep failed");
    });
  };

  tick();
  const timer = setInterval(tick, intervalMs);
  timer.unref?.();

  return () => clearInterval(timer);
}
