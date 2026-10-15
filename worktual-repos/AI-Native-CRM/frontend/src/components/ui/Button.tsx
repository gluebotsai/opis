import { type ButtonHTMLAttributes, forwardRef } from "react";

type ButtonVariant = "primary" | "brand" | "secondary" | "tertiary" | "ghost";
type ButtonSize = "md" | "lg";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    "bg-black text-white hover:bg-neutral-800 active:bg-neutral-900 disabled:bg-neutral-200 disabled:text-neutral-400",
  brand:
    "bg-black text-white hover:bg-neutral-800 active:bg-neutral-900 disabled:bg-neutral-200 disabled:text-neutral-400",
  secondary:
    "bg-white text-neutral-700 border-[0.6px] border-[#bfbfbf] hover:bg-neutral-100 disabled:bg-neutral-200 disabled:text-neutral-400",
  tertiary:
    "bg-transparent text-neutral-900 hover:text-neutral-500 disabled:text-neutral-400",
  ghost:
    "bg-transparent text-white border-[0.6px] border-white/40 hover:bg-white/10",
};

const sizeClasses: Record<ButtonSize, string> = {
  md: "h-[38px] px-3.5 text-sm rounded-lg [&_svg]:size-[18px]",
  lg: "h-11 px-6 text-sm rounded-xl [&_svg]:size-[18px]",
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
        className={`inline-flex cursor-pointer items-center justify-center gap-2 font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-400 disabled:cursor-not-allowed ${variantClasses[variant]} ${sizeClasses[size]} ${className}`}
        {...props}
      >
        {children}
      </button>
    );
  },
);

Button.displayName = "Button";
