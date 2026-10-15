import { Queue } from "bullmq";
import fp from "fastify-plugin";
import type { QueueName, QueuePayloadMap } from "../jobs/types.js";

const queueNames = [
  "email",
  "payment",
  "billing",
  "mail-sync",
  "graph-renewal",
] as const;

export default fp(
  async (app) => {
    if (!app.redis) {
      app.decorate("queues", null);
      return;
    }

    const queues = Object.fromEntries(
      queueNames.map((name) => [
        name,
        new Queue<QueuePayloadMap[typeof name], unknown, string>(name, {
          connection: app.redis!,
          defaultJobOptions: {
            attempts: 5,
            backoff: { type: "exponential", delay: 1_000 },
            removeOnComplete: 1_000,
            removeOnFail: 5_000,
          },
        }),
      ]),
    ) as { [K in QueueName]: Queue<QueuePayloadMap[K], unknown, string> };

    app.decorate("queues", queues);
    app.addHook("onClose", async () => {
      await Promise.all(Object.values(queues).map((queue) => queue.close()));
    });
  },
  { name: "queues", dependencies: ["redis"] },
);
