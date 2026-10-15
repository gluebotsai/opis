import { buildApp } from "./server.js";
import {
  startCronScheduler,
  stopCronScheduler,
} from "./service/scheduler/cron-scheduler.js";
import {
  startEnrichmentJobListener,
  stopEnrichmentJobListener,
} from "./service/ai/lead-enrichment-listen.js";
import { closeAgentEventBus } from "./service/ai/agent-event-bus.js";

const port = Number(process.env.API_PORT || 4000);
const host = process.env.API_HOST || "0.0.0.0";

const app = await buildApp();

try {
  await app.listen({ port, host });
  app.log.info(`CRM API listening on http://${host}:${port}`);
  app.log.info(`Swagger UI at http://${host}:${port}/docs`);
  await startCronScheduler();
  if (process.env.AI_WORKER_ENABLED?.trim().toLowerCase() !== "false") {
    void startEnrichmentJobListener();
  }
} catch (err) {
  app.log.error(err);
  process.exit(1);
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void Promise.all([
      stopCronScheduler(),
      stopEnrichmentJobListener(),
      closeAgentEventBus(),
    ]).finally(() => {
      void app.close().finally(() => process.exit(0));
    });
  });
}
