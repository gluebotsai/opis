import {
  startCronScheduler,
  stopCronScheduler,
} from "./service/scheduler/cron-scheduler.js";

await startCronScheduler();

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void stopCronScheduler().finally(() => process.exit(0));
  });
}
