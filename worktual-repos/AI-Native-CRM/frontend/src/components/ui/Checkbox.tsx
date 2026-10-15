import { type InputHTMLAttributes, forwardRef } from "react";

interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  label: string;
}

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(
  ({ className = "", label, id, ...props }, ref) => {
    const checkboxId = id ?? props.name;

    return (
      <label
        htmlFor={checkboxId}
        className={`inline-flex cursor-pointer items-center gap-2 text-sm text-text-secondary ${className}`}
      >
        <input
          ref={ref}
          id={checkboxId}
          type="checkbox"
          className="size-4 rounded border-border-default text-brand accent-brand focus:ring-border-focus"
          {...props}
        />
        <span>{label}</span>
      </label>
    );
  },
);

Checkbox.displayName = "Checkbox";
