import { type ButtonHTMLAttributes, forwardRef } from "react";

type ButtonVariant = "primary" | "brand" | "secondary" | "tertiary" | "ghost";
type ButtonSize = "md" | "lg";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

/** CCaaS: primary actions are black; brand alias matches primary. */
const variantClasses: Record<ButtonVariant, string> = {
  primary:
    "bg-black text-white hover:bg-neutral-800 disabled:bg-neutral-200 disabled:text-neutral-400",
  brand:
    "bg-black text-white hover:bg-neutral-800 disabled:bg-neutral-200 disabled:text-neutral-400",
  secondary:
    "bg-white text-neutral-900 border border-neutral-200 hover:border-neutral-900 disabled:bg-neutral-200 disabled:text-neutral-400",
  tertiary:
    "bg-transparent text-neutral-900 hover:text-neutral-600 disabled:text-neutral-400",
  ghost:
    "bg-transparent text-white border border-white/40 hover:bg-white/10",
};

const sizeClasses: Record<ButtonSize, string> = {
  md: "h-10 px-5 text-sm rounded-xl",
  lg: "h-12 px-6 text-base rounded-xl",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className = "",
      variant = "primary",
      size = "md",
      type = "button",
      children,
      ...props
    },
    ref,
  ) => {
    return (
      <button
        ref={ref}
        type={type}
        className={`inline-flex items-center justify-center gap-2 font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black disabled:cursor-not-allowed ${variantClasses[variant]} ${sizeClasses[size]} ${className}`}
        {...props}
      >
        {children}
      </button>
    );
  },
);

Button.displayName = "Button";
