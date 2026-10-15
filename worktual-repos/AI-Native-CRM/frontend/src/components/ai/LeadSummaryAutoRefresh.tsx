import { useEffect, useRef } from "react";

/**
 * Opens a single SSE connection and calls `onRefresh` when the lead's
 * timeline or score changes. While `inFlight` is true (score pending/scoring),
 * also polls so a missed SSE still updates the gauge without a full reload.
 */
export function LeadSummaryAutoRefresh({
  contactId,
  onRefresh,
  inFlight = false,
}: {
  contactId: string;
  onRefresh: () => void;
  /** When true, poll every 2s until score settles (or SSE fires). */
  inFlight?: boolean;
}) {
  const cooldown = useRef(false);
  const onRefreshRef = useRef(onRefresh);
  onRefreshRef.current = onRefresh;

  useEffect(() => {
    const es = new EventSource(
      `/api/contacts/${encodeURIComponent(contactId)}/summary/events`,
      { withCredentials: true },
    );

    const onSummary = () => {
      if (cooldown.current) return;
      cooldown.current = true;
      onRefreshRef.current();
      // Debounce bursts of events (e.g. bulk logging) to one refresh / 1.5s.
      setTimeout(() => {
        cooldown.current = false;
      }, 1_500);
    };

    es.addEventListener("summary", onSummary as EventListener);
    return () => {
      es.close();
    };
  }, [contactId]);

  useEffect(() => {
    if (!inFlight) return;
    // Immediate second look shortly after mount (score often finishes fast).
    const first = window.setTimeout(() => onRefreshRef.current(), 800);
    const id = window.setInterval(() => onRefreshRef.current(), 2_000);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(id);
    };
  }, [contactId, inFlight]);

  return null;
}
