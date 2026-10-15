import { useEffect, useRef, useState } from "react";
import { Plus } from "lucide-react";
import { opportunityKindLabel, type OpportunityKind } from "@/lib/opportunity-events-store";
import { CREATE_EVENT_KINDS } from "@/components/events/create-event-defaults";

type Props = {
  onCreate: (kind: OpportunityKind) => void;
  /** Compact icon-only trigger (default). */
  variant?: "icon" | "button";
  buttonLabel?: string;
};

export function CreateEventKindMenu({
  onCreate,
  variant = "icon",
  buttonLabel = "Create event",
}: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  return (
    <div className="relative shrink-0" ref={rootRef}>
      {variant === "icon" ? (
        <button
          type="button"
          aria-label={buttonLabel}
          aria-expanded={open}
          aria-haspopup="menu"
          onClick={() => setOpen((v) => !v)}
          className="inline-flex size-10 items-center justify-center rounded-xl border border-neutral-200 bg-neutral-900 text-white shadow-sm transition hover:bg-neutral-800"
        >
          <Plus className="size-4" strokeWidth={2} />
        </button>
      ) : (
        <button
          type="button"
          aria-expanded={open}
          aria-haspopup="menu"
          onClick={() => setOpen((v) => !v)}
          className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-black px-3.5 text-xs font-medium text-white hover:bg-neutral-800"
        >
          <Plus className="size-3.5" strokeWidth={2} />
          {buttonLabel}
        </button>
      )}
      {open ? (
        <div
          role="menu"
          className="absolute right-0 top-full z-30 mt-1 min-w-[11rem] overflow-hidden rounded-lg border border-neutral-200 bg-white py-1 shadow-lg"
        >
          {CREATE_EVENT_KINDS.map((kind) => (
            <button
              key={kind}
              type="button"
              role="menuitem"
              className="flex w-full px-3 py-2 text-left text-sm text-neutral-900 hover:bg-neutral-50"
              onClick={() => {
                setOpen(false);
                onCreate(kind);
              }}
            >
              {opportunityKindLabel(kind)}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
