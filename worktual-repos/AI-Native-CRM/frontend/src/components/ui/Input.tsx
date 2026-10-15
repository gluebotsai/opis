import { type InputHTMLAttributes, forwardRef, type ReactNode } from "react";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: ReactNode;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
  error?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  (
    {
      className = "",
      label,
      leftIcon,
      rightIcon,
      error,
      id,
      required,
      ...props
    },
    ref,
  ) => {
    const inputId = id ?? props.name;

    return (
      <div className="flex w-full flex-col gap-2">
        {label ? (
          <label
            htmlFor={inputId}
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
        <div className="relative">
          {leftIcon ? (
            <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-icon-on-light">
              {leftIcon}
            </span>
          ) : null}
          <input
            ref={ref}
            id={inputId}
            required={required}
            className={`w-full rounded-lg border-[0.6px] bg-neutral-50 text-sm text-neutral-900 placeholder:text-neutral-400 transition-colors focus:border-neutral-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-neutral-200 disabled:bg-neutral-200 disabled:text-neutral-500 ${
              /\bh-/.test(className) ? "" : "h-[38px]"
            } ${
              error ? "border-text-danger" : "border-[#bfbfbf]"
            } ${leftIcon ? "pl-10" : "pl-3"} ${rightIcon ? "pr-10" : "pr-3"} ${className}`}
            {...props}
          />
          {rightIcon ? (
            <span className="absolute top-1/2 right-3 -translate-y-1/2 text-icon-on-light">
              {rightIcon}
            </span>
          ) : null}
        </div>
        {error ? <p className="text-xs text-text-danger">{error}</p> : null}
      </div>
    );
  },
);

Input.displayName = "Input";
