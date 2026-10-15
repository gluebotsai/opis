import { forwardRef, type ButtonHTMLAttributes } from "react";

import { cn } from "@/lib/utils";

const base =
  "inline-flex cursor-pointer items-center justify-center font-medium transition-colors disabled:pointer-events-none disabled:opacity-50";

export type ButtonVariant =
  | "primary"
  | "primaryIcon"
  | "secondary"
  | "outline"
  | "destructive"
  | "toolbar"
  | "ghostIcon"
  | "panelIcon"
  | "ghostIconSm"
  | "ghostIconDanger"
  | "chip"
  | "send"
  | "sendDisabled"
  | "link";

const variants: Record<ButtonVariant, string> = {
  primary: "h-[38px] gap-1.5 rounded-lg bg-black px-3 text-sm text-white hover:bg-neutral-800",
  primaryIcon: "size-[38px] rounded-lg bg-black text-white hover:bg-neutral-800",
  secondary:
    "h-[38px] gap-1.5 rounded-lg px-2.5 text-xs text-neutral-600 hover:bg-neutral-100 hover:text-neutral-800",
  outline:
    "h-[38px] gap-2 rounded-lg border-[0.6px] border-[#bfbfbf] bg-white px-4 text-sm text-neutral-700 hover:bg-neutral-50",
  destructive:
    "h-[38px] gap-1.5 rounded-lg border border-red-200 px-3 text-xs text-red-600 hover:bg-red-50",
  toolbar:
    "h-[38px] gap-2 rounded-lg border-[0.6px] border-[#bfbfbf] bg-white px-3 text-sm text-neutral-700 hover:bg-neutral-50",
  ghostIcon: "size-[38px] rounded-lg text-neutral-900 hover:bg-neutral-100 hover:text-neutral-900",
  panelIcon:
    "size-[38px] shrink-0 rounded-lg border-[0.6px] border-[#bfbfbf] bg-white text-neutral-900 transition hover:border-[#bfbfbf] hover:bg-neutral-50 hover:text-neutral-900 active:scale-95 [&_svg]:size-[18px]",
  ghostIconSm:
    "size-[38px] shrink-0 rounded-lg text-neutral-900 hover:bg-neutral-100 hover:text-neutral-900",
  ghostIconDanger:
    "size-[38px] shrink-0 rounded-lg border-[0.6px] border-[#bfbfbf] bg-white text-neutral-900 transition hover:border-[#bfbfbf] hover:bg-red-50 hover:text-red-600 active:scale-95 [&_svg]:size-[18px]",
  chip:
    "h-[38px] rounded-lg border-[0.6px] border-[#bfbfbf] bg-white px-2.5 text-[11px] text-neutral-700 hover:bg-neutral-100",
  send:
    "size-[38px] shrink-0 rounded-lg bg-neutral-900 text-white shadow-[0_2px_8px_rgba(0,0,0,0.18)] hover:bg-neutral-800 active:scale-95",
  sendDisabled: "size-[38px] shrink-0 cursor-not-allowed rounded-lg bg-neutral-200/90 text-neutral-400",
  link: "text-neutral-600 hover:text-neutral-800",
};

export function buttonClassName(variant: ButtonVariant, className?: string) {
  return cn(base, variants[variant], className);
}

export type SegmentTabOptions = {
  active?: boolean;
  className?: string;
};

/** Shared segment-tab styling (38px, 14px, rounded-lg, neutral active state). */
export function segmentTabClassName({ active, className }: SegmentTabOptions) {
  return cn(
    "inline-flex h-[38px] cursor-pointer items-center justify-center rounded-lg px-3 text-sm font-medium transition-colors",
    active ? "bg-neutral-900 text-white" : "text-neutral-600 hover:bg-neutral-100",
    className,
  );
}

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", className, type = "button", ...props },
  ref,
) {
  return <button ref={ref} type={type} className={buttonClassName(variant, className)} {...props} />;
});

export const IconButton = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }
>(function IconButton({ className, variant = "panelIcon", type = "button", ...props }, ref) {
  return (
    <button
      ref={ref}
      type={type}
      className={buttonClassName(variant, className)}
      {...props}
    />
  );
});
