import { ChevronDown } from "lucide-react";
import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

/** Native `<select>` with consistent chevron inset from the right edge. */
export function nativeSelectClassName(className?: string) {
  return cn(
    "w-full cursor-pointer appearance-none rounded-xl border-[0.6px] border-[#bfbfbf] bg-white pl-3 pr-12 text-sm outline-none focus:border-neutral-400 focus:ring-2 focus:ring-neutral-200 disabled:cursor-not-allowed",
    className,
  );
}

export function nativeSelectSmClassName(className?: string) {
  return cn(
    "w-full cursor-pointer appearance-none rounded-lg border-[0.6px] border-[#bfbfbf] bg-white pl-2.5 pr-10 text-xs outline-none focus:border-neutral-400 focus:ring-2 focus:ring-neutral-200 disabled:cursor-not-allowed",
    className,
  );
}

type NativeSelectProps = ComponentProps<"select"> & {
  wrapperClassName?: string;
};

export function NativeSelect({ className, wrapperClassName, children, ...props }: NativeSelectProps) {
  return (
    <div className={cn("relative", wrapperClassName)}>
      <select className={nativeSelectClassName(className)} {...props}>
        {children}
      </select>
      <ChevronDown
        className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-neutral-600"
        aria-hidden
      />
    </div>
  );
}

export function NativeSelectSm({
  className,
  wrapperClassName,
  children,
  ...props
}: NativeSelectProps) {
  return (
    <div className={cn("relative", wrapperClassName)}>
      <select className={nativeSelectSmClassName(className)} {...props}>
        {children}
      </select>
      <ChevronDown
        className="pointer-events-none absolute top-1/2 right-2.5 size-3.5 -translate-y-1/2 text-neutral-600"
        aria-hidden
      />
    </div>
  );
}
