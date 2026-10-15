import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "@/utils/cn";

export const IconButton = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement>
>(function IconButton({ className, type = "button", ...props }, ref) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(
        "inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-neutral-900 transition hover:bg-neutral-100 hover:text-neutral-900 disabled:pointer-events-none disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
});
