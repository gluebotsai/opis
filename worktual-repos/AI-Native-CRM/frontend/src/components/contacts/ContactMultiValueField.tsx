import { useEffect, useId, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";

/**
 * Compact dropdown for one or many secondary contact methods.
 */
export function ContactMultiValueField({
  label,
  values,
  empty = "—",
  kind = "text",
  onActivate,
  onCallRequest,
  className = "",
}: {
  label: string;
  values: string[];
  empty?: string;
  kind?: "text" | "email" | "phone";
  onActivate?: (value: string) => void;
  onCallRequest?: (value: string) => void;
  className?: string;
}) {
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const items = values.map((v) => v.trim()).filter(Boolean);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  function renderValue(value: string, classNameName = "") {
    if (kind === "email" && onActivate) {
      return (
        <button
          type="button"
          className={`block w-full break-all text-left font-medium text-text-primary hover:text-text-link hover:underline ${classNameName}`}
          onClick={() => {
            setOpen(false);
            onActivate(value);
          }}
          title="Compose email"
        >
          {value}
        </button>
      );
    }
    if (kind === "phone" && onCallRequest) {
      return (
        <button
          type="button"
          className={`block w-full break-all text-left font-medium text-text-primary hover:text-text-link ${classNameName}`}
          title="Click to call"
          onClick={() => {
            setOpen(false);
            onCallRequest(value);
          }}
        >
          {value}
        </button>
      );
    }
    return (
      <span className={`block w-full break-all text-text-primary ${classNameName}`}>
        {value}
      </span>
    );
  }

  if (items.length === 0) {
    return (
      <div className={`w-full min-w-0 ${className}`.trim()}>
        <dt className="text-xs font-medium tracking-wide text-text-caption uppercase">
          {label}
        </dt>
        <dd className="mt-1 text-sm text-text-primary">{empty}</dd>
      </div>
    );
  }

  const summary =
    items.length === 1 ? items[0]! : `${items[0]} · +${items.length - 1} more`;

  return (
    <div ref={rootRef} className={`relative w-full min-w-0 ${className}`.trim()}>
      <dt className="text-xs font-medium tracking-wide text-text-caption uppercase">
        {label}
      </dt>
      <dd className="relative mt-1 min-w-0">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={listId}
          aria-haspopup="listbox"
          onClick={() => setOpen((v) => !v)}
          className="flex h-11 w-full min-w-0 items-center justify-between gap-3 rounded-lg border border-border-default bg-surface px-3 text-left text-sm text-text-primary transition-colors hover:border-border-strong hover:bg-subtle focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
        >
          <span className="min-w-0 flex-1 truncate">{summary}</span>
          <span className="inline-flex shrink-0 items-center gap-1.5 text-text-caption">
            {items.length > 1 ? (
              <span className="rounded-md bg-subtle px-1.5 py-0.5 text-[11px] font-medium tabular-nums">
                {items.length}
              </span>
            ) : null}
            <ChevronDown
              className={`size-4 transition-transform ${open ? "rotate-180" : ""}`}
              strokeWidth={1.75}
            />
          </span>
        </button>

        {open ? (
          <ul
            id={listId}
            role="listbox"
            className="absolute right-0 left-0 z-20 mt-1 max-h-56 overflow-y-auto rounded-lg border border-border-default bg-surface py-1 shadow-lg"
          >
            {items.map((item) => (
              <li key={item} role="option" className="min-w-0 px-3 py-2">
                {renderValue(item)}
              </li>
            ))}
          </ul>
        ) : null}
      </dd>
    </div>
  );
}
