import { type TextareaHTMLAttributes, forwardRef } from "react";

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className = "", label, error, id, ...props }, ref) => {
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
        <textarea
          ref={ref}
          id={fieldId}
          className={`min-h-24 w-full rounded-lg border bg-surface px-3 py-2.5 text-sm text-text-primary placeholder:text-text-placeholder transition-colors focus:border-border-focus focus:outline-none focus:ring-2 focus:ring-border-focus/20 disabled:bg-neutral-200 ${
            error ? "border-text-danger" : "border-border-default"
          } ${className}`}
          {...props}
        />
        {error ? <p className="text-xs text-text-danger">{error}</p> : null}
      </div>
    );
  },
);

Textarea.displayName = "Textarea";
