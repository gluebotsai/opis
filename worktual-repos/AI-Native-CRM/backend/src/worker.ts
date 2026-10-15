import {
  startEnrichmentJobListener,
  stopEnrichmentJobListener,
} from "./service/ai/lead-enrichment-listen.js";

await startEnrichmentJobListener();

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void stopEnrichmentJobListener().finally(() => process.exit(0));
  });
}
