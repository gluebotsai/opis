/**
 * In-process pub/sub so SSE clients wake when enrichment finishes.
 * Same Node process as the job runner (dev / single instance).
 */

export type EnrichmentEventPayload = {
  contactId: string;
  status: string;
  filled?: string[];
  lastError?: string | null;
  resultSummary?: unknown;
};

type Listener = (payload: EnrichmentEventPayload) => void;

const listeners = new Map<string, Set<Listener>>();

export function subscribeEnrichmentEvents(
  contactId: string,
  listener: Listener,
): () => void {
  const key = contactId.trim();
  let set = listeners.get(key);
  if (!set) {
    set = new Set();
    listeners.set(key, set);
  }
  set.add(listener);
  return () => {
    set!.delete(listener);
    if (set!.size === 0) listeners.delete(key);
  };
}

export function publishEnrichmentEvent(payload: EnrichmentEventPayload): void {
  const set = listeners.get(payload.contactId.trim());
  if (!set?.size) return;
  for (const listener of [...set]) {
    try {
      listener(payload);
    } catch (err) {
      console.error("enrichment event listener failed", err);
    }
  }
}

/** One curated step of an enrichment run (see AgentStepEvent). */
export type EnrichmentStepEventPayload = {
  contactId: string;
  jobId: string;
  step: string;
  label: string;
  status: "started" | "ok" | "failed" | "skipped";
  detail?: unknown;
  errorReason?: string | null;
};

type StepListener = (payload: EnrichmentStepEventPayload) => void;

const stepListeners = new Map<string, Set<StepListener>>();

export function subscribeEnrichmentStepEvents(
  contactId: string,
  listener: StepListener,
): () => void {
  const key = contactId.trim();
  let set = stepListeners.get(key);
  if (!set) {
    set = new Set();
    stepListeners.set(key, set);
  }
  set.add(listener);
  return () => {
    set!.delete(listener);
    if (set!.size === 0) stepListeners.delete(key);
  };
}

export function publishEnrichmentStepEvent(
  payload: EnrichmentStepEventPayload,
): void {
  const set = stepListeners.get(payload.contactId.trim());
  if (!set?.size) return;
  for (const listener of [...set]) {
    try {
      listener(payload);
    } catch (err) {
      console.error("enrichment step event listener failed", err);
    }
  }
}
