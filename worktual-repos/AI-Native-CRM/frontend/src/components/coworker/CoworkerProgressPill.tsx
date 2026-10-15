import { useEffect, useState } from "react";
import { FlowerLoader } from "@/components/coworker/FlowerLoader";

const DEFAULT_LABELS = [
  "Working on that…",
  "Looking across your CRM…",
  "Putting the answer together…",
];

/**
 * CCaaS-style in-flight status: light pill + flower loader (no chat bubble).
 */
export function CoworkerProgressPill({
  labels = DEFAULT_LABELS,
  label,
}: {
  /** Rotating status lines while the agent turn is in flight. */
  labels?: string[];
  /** Fixed label — skips rotation when set. */
  label?: string;
}) {
  const pool = labels.length ? labels : DEFAULT_LABELS;
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    if (label || pool.length <= 1) {
      setIdx(0);
      return;
    }
    const id = window.setInterval(() => {
      setIdx((n) => (n + 1) % pool.length);
    }, 2800);
    return () => window.clearInterval(id);
  }, [label, pool.length]);

  const text = label || pool[idx % pool.length];

  return (
    <div className="px-4 pb-3 sm:px-5" role="status" aria-live="polite">
      <div className="inline-flex max-w-full items-center gap-2 rounded-full bg-neutral-100 px-3 py-1.5 text-[13px] text-neutral-600">
        <FlowerLoader />
        <span className="truncate">{text}</span>
      </div>
    </div>
  );
}
