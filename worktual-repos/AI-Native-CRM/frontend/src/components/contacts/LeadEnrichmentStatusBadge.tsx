import { useEffect, useRef, useState } from "react";

type Props = {
  contactId: string;
  /** Initial server-rendered status if known */
  initialStatus?: string | null;
  /** Called once when enrichment completes so the detail page can reload fields */
  onRefreshed?: () => void;
};

const ACTIVE = new Set(["pending", "running"]);
const TERMINAL = new Set(["enriched", "skipped", "failed"]);

const DISMISS_MS = 3_500;

/**
 * Ephemeral enrichment tag next to the contact name.
 * - pending/running → "Enriching"
 * - enriched → "Enriched", then auto-hides after a few seconds
 * - already finished on page load / after refresh → hidden
 *
 * Step-by-step agent activity lives in its own page under Agents →
 * Lead enrichment → Recent runs, not on the contact page.
 */
export function LeadEnrichmentStatusBadge({
  contactId,
  initialStatus = null,
  onRefreshed,
}: Props) {
  const coldTerminal = TERMINAL.has(initialStatus || "");
  const [status, setStatus] = useState<string>(() =>
    ACTIVE.has(initialStatus || "") ? initialStatus! : "none",
  );
  const [visible, setVisible] = useState(() =>
    ACTIVE.has(initialStatus || ""),
  );
  const refreshed = useRef(false);
  const dismissTimer = useRef<number | null>(null);
  const onRefreshedRef = useRef(onRefreshed);
  onRefreshedRef.current = onRefreshed;

  const refreshOnce = () => {
    if (refreshed.current) return;
    refreshed.current = true;
    onRefreshedRef.current?.();
  };

  const scheduleDismiss = (alsoRefresh: boolean) => {
    if (dismissTimer.current) window.clearTimeout(dismissTimer.current);
    dismissTimer.current = window.setTimeout(() => {
      setVisible(false);
      if (alsoRefresh) refreshOnce();
    }, DISMISS_MS);
  };

  useEffect(() => {
    if (coldTerminal) return;
    if (!ACTIVE.has(initialStatus || "")) return;

    const es = new EventSource(
      `/api/contacts/${encodeURIComponent(contactId)}/enrichment/events`,
      { withCredentials: true },
    );

    const onEnrichment = (ev: MessageEvent) => {
      try {
        const data = JSON.parse(String(ev.data)) as {
          status?: string;
          lastError?: string | null;
        };
        const next = data.status || "none";
        if (ACTIVE.has(next)) {
          setStatus(next);
          setVisible(true);
          return;
        }
        if (next === "enriched") {
          setStatus("enriched");
          setVisible(true);
          scheduleDismiss(true);
          es.close();
          return;
        }
        setVisible(false);
        refreshOnce();
        es.close();
      } catch {
        /* ignore malformed */
      }
    };

    const onTimeout = () => {
      setVisible(false);
      refreshOnce();
      es.close();
    };

    es.addEventListener("enrichment", onEnrichment as EventListener);
    es.addEventListener("timeout", onTimeout as EventListener);
    es.onerror = () => {
      if (refreshed.current) es.close();
    };

    return () => {
      es.close();
      if (dismissTimer.current) window.clearTimeout(dismissTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount once per contact/job
  }, [coldTerminal, contactId, initialStatus]);

  useEffect(() => {
    const dismiss = () => {
      setVisible(false);
      if (dismissTimer.current) window.clearTimeout(dismissTimer.current);
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") dismiss();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", dismiss);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", dismiss);
    };
  }, []);

  const enriching = status === "pending" || status === "running";
  const enriched = status === "enriched";
  const showPill = visible && (enriching || enriched);

  if (!showPill) return null;

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${
        enriched
          ? "bg-[#e8f8ef] text-text-success ring-[#0e8f50]/25"
          : "bg-[#fff8e8] text-text-warning ring-[#866300]/25"
      }`}
      role="status"
      aria-live="polite"
    >
      {enriching ? (
        <>
          <span
            className="size-1.5 animate-pulse rounded-full bg-[#866300]"
            aria-hidden
          />
          Enriching
        </>
      ) : (
        <>
          <span className="size-1.5 rounded-full bg-[#0e8f50]" aria-hidden />
          Enriched
        </>
      )}
    </span>
  );
}
