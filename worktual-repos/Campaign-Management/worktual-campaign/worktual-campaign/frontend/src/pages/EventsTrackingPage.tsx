import { useMemo } from "react";
import { useLocation } from "react-router-dom";
import { EventsTrackingWorkspace } from "@/components/campaigns/EventsTrackingWorkspace";

const EVENTS_SESSION_KEY = "worktual.events.tracking.session";

function getOrCreateEventsSessionId(): string {
  try {
    const existing = sessionStorage.getItem(EVENTS_SESSION_KEY)?.trim();
    if (existing) return existing;
    const id = crypto.randomUUID();
    sessionStorage.setItem(EVENTS_SESSION_KEY, id);
    return id;
  } catch {
    return crypto.randomUUID();
  }
}

function eventIdFromPath(pathname: string): string | null {
  const rest = pathname.replace(/^\/events\/?/, "").replace(/\/$/, "");
  if (!rest || rest.includes("/") || rest === "create") return null;
  return rest;
}

/**
 * Events tracking — events co-worker + launched events list/detail.
 */
export function EventsTrackingPage() {
  const location = useLocation();
  const eventId = eventIdFromPath(location.pathname);
  const sessionId = useMemo(() => getOrCreateEventsSessionId(), []);
  return (
    <EventsTrackingWorkspace sessionId={sessionId} initialEventId={eventId} />
  );
}
