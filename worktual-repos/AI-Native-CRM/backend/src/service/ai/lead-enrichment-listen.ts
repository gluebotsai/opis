/**
 * LISTEN crm_lead_enrichment — wake enrichment drain when contact_profiles
 * trigger notifies (external/bulk inserts). Debounced so a 10k insert burst
 * collapses into a few drain kicks instead of 10k worker storms.
 */

import { Client } from "pg";
import { processDueLeadEnrichmentJobs } from "@/service/ai/lead-enrichment-job";

const CHANNEL = "crm_lead_enrichment";
const DEBOUNCE_MS = 250;

let client: Client | null = null;
let debounceTimer: NodeJS.Timeout | null = null;
let drainInFlight = false;
let started = false;

function isListenEnabled(): boolean {
  const raw = process.env.ENRICH_LISTEN_ENABLED?.trim().toLowerCase();
  if (raw === "false" || raw === "0" || raw === "off") return false;
  return true;
}

function scheduleDrain(): void {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    void kickDrain();
  }, DEBOUNCE_MS);
}

async function kickDrain(): Promise<void> {
  if (drainInFlight) {
    // Another drain is running — schedule one more pass after it finishes.
    scheduleDrain();
    return;
  }
  drainInFlight = true;
  try {
    let guard = 0;
    // Keep draining while the queue is hot (bulk inserts), but cap loops.
    while (guard < 40) {
      guard += 1;
      const result = await processDueLeadEnrichmentJobs();
      if (result.processed === 0) break;
    }
  } catch (err) {
    console.error("[enrich-listen] drain failed", err);
  } finally {
    drainInFlight = false;
  }
}

export async function startEnrichmentJobListener(): Promise<void> {
  if (started) return;
  if (!isListenEnabled()) {
    console.log(
      "[enrich-listen] disabled via ENRICH_LISTEN_ENABLED — relying on cron sweep only.",
    );
    return;
  }
  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    console.warn("[enrich-listen] DATABASE_URL missing — listener not started.");
    return;
  }

  started = true;
  const c = new Client({ connectionString: url });
  client = c;

  c.on("notification", (msg) => {
    if (msg.channel === CHANNEL) scheduleDrain();
  });
  c.on("error", (err) => {
    console.error("[enrich-listen] client error", err);
  });
  c.on("end", () => {
    console.warn("[enrich-listen] connection ended");
    client = null;
    started = false;
  });

  try {
    await c.connect();
    await c.query(`LISTEN ${CHANNEL}`);
    console.log(`[enrich-listen] LISTEN ${CHANNEL}`);
  } catch (err) {
    console.error("[enrich-listen] failed to start", err);
    try {
      await c.end();
    } catch {
      /* ignore */
    }
    client = null;
    started = false;
  }
}

export async function stopEnrichmentJobListener(): Promise<void> {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  const c = client;
  client = null;
  started = false;
  if (!c) return;
  try {
    await c.query(`UNLISTEN ${CHANNEL}`);
  } catch {
    /* ignore */
  }
  try {
    await c.end();
  } catch {
    /* ignore */
  }
}
