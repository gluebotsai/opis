import { type ButtonHTMLAttributes, forwardRef } from "react";

type ButtonVariant = "primary" | "brand" | "secondary" | "tertiary" | "ghost";
type ButtonSize = "md" | "lg";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    "bg-neutral-900 text-text-on-dark hover:bg-neutral-700 disabled:bg-neutral-200 disabled:text-neutral-400",
  brand:
    "bg-brand text-text-on-dark hover:bg-brand-hover active:bg-brand-active disabled:bg-neutral-200 disabled:text-neutral-400",
  secondary:
    "bg-surface text-text-primary border border-border-default hover:border-border-strong disabled:bg-neutral-200 disabled:text-neutral-400",
  tertiary:
    "bg-transparent text-text-primary hover:text-brand disabled:text-neutral-400",
  ghost:
    "bg-transparent text-text-on-dark border border-text-on-dark/40 hover:bg-white/10",
};

const sizeClasses: Record<ButtonSize, string> = {
  md: "h-10 px-6 text-sm rounded-lg",
  lg: "h-12 px-6 text-base rounded-lg",
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
        className={`inline-flex items-center justify-center gap-2 font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus disabled:cursor-not-allowed ${variantClasses[variant]} ${sizeClasses[size]} ${className}`}
        {...props}
      >
        {children}
      </button>
    );
  },
);

Button.displayName = "Button";
