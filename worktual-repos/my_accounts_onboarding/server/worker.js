import "./load-env.js";

import {
  QUEUE_NAMES,
  createQueueWorker,
  scheduleBillingCron,
  setInlineProcessors,
} from "./infra/queues.js";
import {
  JOB_PROCESSORS,
  processBillingSweepJob,
  processEmailJob,
  processGraphRenewalJob,
  processMailSyncJob,
  processPaymentFulfillmentJob,
} from "./jobs/handlers.js";
import { closeQueues } from "./infra/queues.js";
import { closeRedis } from "./infra/redis.js";
import { migrateDatabase } from "./db/migrate.js";
import { shouldRunMigrationsOnBoot } from "./infra/env.js";

const workers = [];

async function startWorkers() {
  if (shouldRunMigrationsOnBoot()) {
    await migrateDatabase();
  }

  setInlineProcessors({
    [QUEUE_NAMES.EMAIL]: processEmailJob,
    [QUEUE_NAMES.PAYMENT]: processPaymentFulfillmentJob,
    [QUEUE_NAMES.BILLING]: processBillingSweepJob,
    [QUEUE_NAMES.MAIL]: processMailSyncJob,
  });

  for (const [queueName, processor] of Object.entries(JOB_PROCESSORS)) {
    const worker = createQueueWorker(queueName, processor);
    if (worker) {
      worker.on("failed", (job, error) => {
        console.error(
          `[worker] ${queueName} job ${job?.id} failed:`,
          error instanceof Error ? error.message : error,
        );
      });
      workers.push(worker);
      console.log(`[worker] Listening on ${queueName}`);
    }
  }

  await scheduleBillingCron();

  setInterval(() => {
    void processGraphRenewalJob().catch((error) => {
      console.warn(
        "[worker] Graph subscription renewal failed:",
        error instanceof Error ? error.message : error,
      );
    });
  }, 12 * 60 * 60 * 1000);

  console.log("[worker] Background worker ready.");
}

async function shutdown() {
  for (const worker of workers) {
    await worker.close();
  }
  await closeQueues();
  await closeRedis();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

startWorkers().catch((error) => {
  console.error("[worker] Failed to start:", error);
  process.exit(1);
});
