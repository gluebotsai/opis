import type { QueueStatus } from "./types";
import { cn } from "@/lib/utils";

type StatusToggleProps = {
  checked: boolean;
  onChange: (next: QueueStatus) => void;
  disabled?: boolean;
  readOnly?: boolean;
  id?: string;
  showLabel?: boolean;
  compact?: boolean;
  className?: string;
  ariaLabel?: string;
  checkedLabel?: string;
  uncheckedLabel?: string;
};

export function StatusToggle({
  checked,
  onChange,
  disabled = false,
  readOnly = false,
  id,
  showLabel = true,
  compact = false,
  className,
  ariaLabel,
  checkedLabel = "Active",
  uncheckedLabel = "Inactive",
}: StatusToggleProps) {
  const isInteractive = !disabled && !readOnly;

  return (
    <div className={cn("inline-flex items-center", compact ? "gap-1.5" : "gap-2.5", className)}>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-readonly={readOnly || undefined}
        aria-label={ariaLabel ?? (checked ? checkedLabel : uncheckedLabel)}
        disabled={disabled && !readOnly}
        onClick={isInteractive ? () => onChange(checked ? "inactive" : "active") : undefined}
        className={cn(
          "relative inline-flex shrink-0 items-center rounded-full transition",
          compact ? "h-4 w-7" : "h-5 w-9",
          checked ? (readOnly ? "bg-neutral-900" : "bg-neutral-800") : "bg-neutral-300",
          disabled && !readOnly
            ? "cursor-not-allowed opacity-60"
            : readOnly
              ? "cursor-default"
              : "cursor-pointer",
        )}
      >
        <span
          className={cn(
            "inline-block rounded-full bg-white shadow-sm transition",
            compact ? "size-3 translate-x-0.5" : "size-5 translate-x-0.5",
            checked && (compact ? "translate-x-[14px]" : "translate-x-[22px]"),
          )}
        />
      </button>
      {showLabel ? (
        <span
          className={cn(
            compact ? "text-xs" : "text-sm",
            "font-medium",
            checked ? "text-neutral-800" : "text-neutral-600",
          )}
        >
          {checked ? checkedLabel : uncheckedLabel}
        </span>
      ) : null}
    </div>
  );
}
