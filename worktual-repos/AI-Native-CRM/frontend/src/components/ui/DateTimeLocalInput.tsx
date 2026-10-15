import { useId, useState, type InputHTMLAttributes } from "react";

type DateTimeLocalInputProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "type" | "value" | "onChange" | "defaultValue"
> & {
  label?: string;
  error?: string;
  /** Shown when empty — mirrors locale date + time prompts. */
  emptyHint?: string;
  /** Controlled value (optional — omit for uncontrolled form fields). */
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
};

/**
 * datetime-local with a readable empty hint.
 * Native empty UI shows `dd/mm/yyyy, --:-- --`; we overlay `dd/mm/yyyy, hh:mm`.
 */
export function DateTimeLocalInput({
  label,
  value,
  defaultValue = "",
  onChange,
  error,
  emptyHint = "dd/mm/yyyy, hh:mm",
  id,
  className = "",
  disabled,
  name,
  ...props
}: DateTimeLocalInputProps) {
  const autoId = useId();
  const fieldId = id ?? name ?? autoId;
  const controlled = value !== undefined;
  const [inner, setInner] = useState(defaultValue);
  const current = controlled ? value : inner;
  const empty = !current;

  return (
    <div className="flex w-full flex-col gap-2">
      {label ? (
        <label
          htmlFor={fieldId}
          className="text-sm font-medium text-text-primary"
        >
          {label}
        </label>
      ) : null}
      <div className="relative">
        {empty ? (
          <span
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-3 z-[1] -translate-y-1/2 text-sm text-text-placeholder"
          >
            {emptyHint}
          </span>
        ) : null}
        <input
          {...props}
          id={fieldId}
          name={name}
          type="datetime-local"
          value={current}
          disabled={disabled}
          onChange={(e) => {
            const next = e.target.value;
            if (!controlled) setInner(next);
            onChange?.(next);
          }}
          className={`h-11 w-full rounded-lg border bg-surface px-3 text-sm text-text-primary transition-colors focus:border-border-focus focus:outline-none focus:ring-2 focus:ring-border-focus/20 disabled:bg-neutral-200 disabled:text-neutral-500 ${
            error ? "border-text-danger" : "border-border-default"
          } ${
            empty
              ? "text-transparent caret-transparent [&::-webkit-calendar-picker-indicator]:cursor-pointer [&::-webkit-calendar-picker-indicator]:opacity-100 [&::-webkit-datetime-edit]:text-transparent [&::-webkit-datetime-edit-fields-wrapper]:text-transparent"
              : ""
          } ${className}`}
        />
      </div>
      {error ? <p className="text-xs text-text-danger">{error}</p> : null}
    </div>
  );
}
