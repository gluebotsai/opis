import { useCallback, useLayoutEffect, useRef, useState, type ReactNode } from "react";

import { cn } from "@/lib/utils";

export type SegmentTabOption<T extends string> = {
  id: T;
  label: string;
  /** Shown after the label; kept visible even when the label truncates. */
  count?: number;
  leading?: (active: boolean) => ReactNode;
};

type SegmentTabsProps<T extends string> = {
  value: T;
  options: Array<SegmentTabOption<T>>;
  onChange: (value: T) => void;
  className?: string;
  buttonClassName?: string;
  /** Size tabs to their labels instead of stretching to the container width. */
  fitContent?: boolean;
  /** When fitContent, force every segment to the width of the widest label. */
  equalWidth?: boolean;
  /** Hide visible labels (keep them for accessibility via aria-label). */
  hideLabels?: boolean;
  /** Segment = pill slider; line = underline tabs. */
  variant?: "segment" | "line";
};

function LineTabs<T extends string>({
  value,
  options,
  onChange,
  className,
  buttonClassName,
  fitContent = false,
  equalWidth = false,
  hideLabels = false,
}: SegmentTabsProps<T>) {
  const equalFit = fitContent && equalWidth;

  return (
    <div
      className={cn(
        "border-b-[0.6px] border-[#bfbfbf]",
        equalFit
          ? "grid w-fit max-w-full grid-flow-col auto-cols-[1fr]"
          : fitContent
            ? "flex w-fit max-w-full gap-5"
            : "flex w-full",
        className,
      )}
      role="tablist"
    >
      {options.map((option) => {
        const active = value === option.id;
        return (
          <button
            key={option.id}
            type="button"
            role="tab"
            aria-label={option.label}
            aria-selected={active}
            onClick={() => onChange(option.id)}
            className={cn(
              "relative -mb-px inline-flex cursor-pointer items-center gap-1 border-b-2 pb-2.5 text-sm font-medium transition-colors",
              equalFit
                ? "w-full min-w-0 justify-center px-1"
                : fitContent
                  ? "shrink-0 px-1"
                  : "min-w-0 flex-1 justify-center px-2",
              active
                ? "border-neutral-900 text-neutral-900"
                : "border-transparent text-neutral-600 hover:border-[#bfbfbf] hover:text-neutral-800",
              buttonClassName,
            )}
          >
            {option.leading?.(active)}
            <span className={cn("min-w-0 truncate", hideLabels && "sr-only")}>{option.label}</span>
            {!hideLabels && option.count != null ? (
              <span className="shrink-0 tabular-nums text-neutral-400">({option.count})</span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

function SegmentTabsSlider<T extends string>({
  value,
  options,
  onChange,
  className,
  buttonClassName,
  fitContent = false,
  equalWidth = false,
  hideLabels = false,
}: SegmentTabsProps<T>) {
  const containerRef = useRef<HTMLDivElement>(null);
  const segmentRefs = useRef<Partial<Record<string, HTMLButtonElement | null>>>({});
  const indicatorReadyRef = useRef(false);
  const [indicator, setIndicator] = useState({ left: 0, width: 0 });
  const [indicatorReady, setIndicatorReady] = useState(false);

  const updateIndicator = useCallback(() => {
    const container = containerRef.current;
    const activeButton = segmentRefs.current[value];
    if (!container || !activeButton) return;

    const containerRect = container.getBoundingClientRect();
    const buttonRect = activeButton.getBoundingClientRect();
    setIndicator({
      left: buttonRect.left - containerRect.left,
      width: buttonRect.width,
    });
  }, [value]);

  useLayoutEffect(() => {
    updateIndicator();
    if (!indicatorReadyRef.current) {
      requestAnimationFrame(() => {
        indicatorReadyRef.current = true;
        setIndicatorReady(true);
      });
    }

    const container = containerRef.current;
    if (!container) return;

    const observer = new ResizeObserver(() => updateIndicator());
    observer.observe(container);
    for (const button of Object.values(segmentRefs.current)) {
      if (button) observer.observe(button);
    }

    return () => observer.disconnect();
  }, [updateIndicator, options, hideLabels, equalWidth]);

  const equalFit = fitContent && equalWidth;

  return (
    <div
      ref={containerRef}
      className={cn(
        "relative h-[38px] items-center rounded-lg border-[0.6px] border-[#bfbfbf] bg-neutral-50/90 p-0.5",
        equalFit
          ? "grid w-fit max-w-full grid-flow-col auto-cols-[1fr]"
          : "flex",
        fitContent && !equalFit ? "w-fit max-w-full" : null,
        !fitContent ? "w-full" : null,
        className,
      )}
    >
      <div
        aria-hidden
        className={cn(
          "pointer-events-none absolute top-0.5 bottom-0.5 left-0 rounded-md border border-neutral-900 bg-neutral-900 shadow-sm",
          indicatorReady &&
            "transition-[transform,width] duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] motion-reduce:transition-none",
        )}
        style={{
          width: indicator.width,
          transform: `translate3d(${indicator.left}px, 0, 0)`,
        }}
      />

      {options.map((option) => {
        const active = value === option.id;
        return (
          <button
            key={option.id}
            ref={(node) => {
              segmentRefs.current[option.id] = node;
            }}
            type="button"
            aria-label={option.label}
            title={option.label}
            onClick={() => onChange(option.id)}
            className={cn(
              "relative z-10 inline-flex h-full cursor-pointer items-center justify-center gap-1 rounded-md px-3 text-sm font-medium transition-colors duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] motion-reduce:transition-none",
              equalFit
                ? "w-full min-w-0"
                : fitContent
                  ? "shrink-0"
                  : "min-w-0 flex-1",
              active ? "text-white" : "text-neutral-600 hover:text-neutral-800",
              buttonClassName,
            )}
          >
            {option.leading?.(active)}
            <span className={cn("min-w-0 truncate", hideLabels && "sr-only")}>{option.label}</span>
            {!hideLabels && option.count != null ? (
              <span className="shrink-0 tabular-nums">({option.count})</span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

export function SegmentTabs<T extends string>(props: SegmentTabsProps<T>) {
  if (props.variant === "line") {
    return <LineTabs {...props} />;
  }
  return <SegmentTabsSlider {...props} />;
}
