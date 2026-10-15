import type { FastifyInstance } from "fastify";
import type { JobsOptions } from "bullmq";
import { AppError } from "../helpers/errors.js";
import type { QueueName, QueuePayloadMap } from "../jobs/types.js";

export async function enqueue<K extends QueueName>(
  app: FastifyInstance,
  queue: K,
  payload: QueuePayloadMap[K],
  options?: JobsOptions,
) {
  if (!app.queues) {
    throw new AppError(
      503,
      "QUEUE_UNAVAILABLE",
      "Background job processing is unavailable",
    );
  }
  // BullMQ derives name/data conditionally from generic payload shapes. The
  // function boundary above preserves the queue-to-payload relationship.
  return app.queues[queue].add(queue as never, payload as never, options);
}
