/**
 * Thin CRM event emitters for Worktual platform combine (Phase 4 contracts).
 * Does not build CCaaS/Marketing — only publishes typed events when listeners exist.
 */

export type CrmPlatformEventType =
  | "activity.logged"
  | "deal.stage_changed"
  | "meeting.analyzed"
  | "lead.scored"
  | "proposal.approved"
  | "appointment.scheduled"
  | "appointment.rescheduled"
  | "appointment.canceled"
  | "appointment.completed";

export type CrmPlatformEvent = {
  type: CrmPlatformEventType;
  organizationId: string;
  cdpId?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  occurredAt: string;
  payload?: Record<string, unknown>;
};

type Listener = (event: CrmPlatformEvent) => void | Promise<void>;

const listeners: Listener[] = [];

/** Hub / webhook adapters register here later. */
export function onCrmPlatformEvent(listener: Listener): () => void {
  listeners.push(listener);
  return () => {
    const i = listeners.indexOf(listener);
    if (i >= 0) listeners.splice(i, 1);
  };
}

export function emitCrmPlatformEvent(
  event: Omit<CrmPlatformEvent, "occurredAt"> & { occurredAt?: string },
): void {
  const full: CrmPlatformEvent = {
    ...event,
    occurredAt: event.occurredAt || new Date().toISOString(),
  };
  for (const listener of listeners) {
    try {
      void Promise.resolve(listener(full)).catch((err) => {
        console.error("crm platform event listener failed", full.type, err);
      });
    } catch (err) {
      console.error("crm platform event listener failed", full.type, err);
    }
  }
  if (process.env.CRM_PLATFORM_EVENTS_LOG === "true") {
    console.log("[crm-event]", full.type, full.entityId || full.cdpId);
  }
}
