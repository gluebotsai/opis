import { type SelectHTMLAttributes, forwardRef } from "react";

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  error?: string;
  options: { value: string; label: string }[];
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ className = "", label, error, id, options, ...props }, ref) => {
    const fieldId = id ?? props.name;

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
        <select
          ref={ref}
          id={fieldId}
          className={`h-11 w-full rounded-lg border bg-surface px-3 text-sm text-text-primary transition-colors focus:border-border-focus focus:outline-none focus:ring-2 focus:ring-border-focus/20 disabled:bg-neutral-200 ${
            error ? "border-text-danger" : "border-border-default"
          } ${className}`}
          {...props}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        {error ? <p className="text-xs text-text-danger">{error}</p> : null}
      </div>
    );
  },
);

Select.displayName = "Select";
