import { type ReactNode, type TextareaHTMLAttributes, forwardRef } from "react";

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: ReactNode;
  error?: string;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className = "", label, error, id, required, ...props }, ref) => {
    const fieldId = id ?? props.name;
    return (
      <div className="flex w-full flex-col gap-2">
        {label ? (
          <label
            htmlFor={fieldId}
            className="text-sm font-medium text-text-primary"
          >
            {label}
            {required ? (
              <span className="ml-0.5 text-text-danger" aria-hidden>
                *
              </span>
            ) : null}
          </label>
        ) : null}
        <textarea
          ref={ref}
          id={fieldId}
          required={required}
          className={`min-h-24 w-full rounded-lg border-[0.6px] bg-neutral-50 px-3 py-2 text-sm text-neutral-900 transition-colors focus:border-neutral-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-neutral-200 disabled:bg-neutral-200 ${
            error ? "border-text-danger" : "border-[#bfbfbf]"
          } ${className}`}
          {...props}
        />
        {error ? <p className="text-xs text-text-danger">{error}</p> : null}
      </div>
    );
  },
);

Textarea.displayName = "Textarea";
