import React from 'react';

export type SegmentTabOption<T extends string = string> = {
  id: T;
  label: string;
  icon?: React.ReactNode;
  count?: number;
};

type SegmentTabsProps<T extends string> = {
  value: T;
  options: SegmentTabOption<T>[];
  onChange: (id: T) => void;
  ariaLabel?: string;
  className?: string;
  /** Grow tabs equally to fill the track (4+ labels). */
  stretch?: boolean;
  /**
   * Parent must be `@container`. Stacks full-width 38px tabs until the
   * pane is wide enough for one row — used in narrow ticket side rails.
   */
  stackWhenNarrow?: boolean;
  /** `underline` is a text + hairline bar, not the ink pill track. */
  variant?: 'segment' | 'underline';
  /** Show icons on narrow panes (default: from `sm` only). */
  alwaysShowIcons?: boolean;
};

/** 38px Worktual segment slider — hairline track, ink thumb, no shadow. */
export default function SegmentTabs<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  className = '',
  stretch = false,
  stackWhenNarrow = false,
  variant = 'segment',
  alwaysShowIcons = false,
}: SegmentTabsProps<T>) {
  const underline = variant === 'underline';
  const stackNarrow = !underline && stackWhenNarrow;
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={
        underline
          ? `flex w-full max-w-full items-end justify-between gap-3 overflow-x-auto border-b-[0.6px] border-[#bfbfbf] [scrollbar-width:none] [scrollbar-color:transparent_transparent] [&::-webkit-scrollbar]:h-0 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-transparent ${className}`
          : stackNarrow
            ? `flex h-auto w-full min-w-0 max-w-full flex-col gap-1 rounded-lg border-[0.6px] border-[#bfbfbf] bg-neutral-50/90 p-0.5 shadow-none @[22rem]:h-[38px] @[22rem]:flex-row @[22rem]:items-center @[22rem]:overflow-x-auto @[22rem]:[scrollbar-width:none] ${className}`
            : `inline-flex h-[38px] max-w-full items-center gap-1 overflow-x-auto rounded-lg border-[0.6px] border-[#bfbfbf] bg-neutral-50/90 p-0.5 shadow-none [scrollbar-width:none] ${className}`
      }
    >
      {options.map((opt) => {
        const active = opt.id === value;
        return (
          <button
            key={opt.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(opt.id)}
            title={opt.label}
            className={
              underline
                ? `-mb-px inline-flex h-10 shrink-0 items-center gap-1.5 border-b-2 px-0.5 text-sm font-medium whitespace-nowrap transition-colors ${
                    active
                      ? 'border-[#171717] text-[#171717]'
                      : 'border-transparent text-neutral-500 hover:border-[#bfbfbf] hover:text-[#171717]'
                  }`
                : `inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-2.5 text-sm font-medium transition-colors sm:px-3.5 ${
                    stackNarrow
                      ? 'h-[38px] w-full min-w-0 @[22rem]:h-full @[22rem]:w-auto @[22rem]:flex-1'
                      : `h-full ${stretch ? 'min-w-0 flex-1' : 'shrink-0'}`
                  } ${
                    active
                      ? 'bg-[#171717] text-white'
                      : 'text-neutral-600 hover:bg-white hover:text-[#171717]'
                  }`
            }
          >
            {opt.icon ? (
              <span
                className={`${
                  alwaysShowIcons ? 'inline-flex' : 'hidden sm:inline-flex'
                } h-[18px] w-[18px] items-center justify-center [&>svg]:h-[18px] [&>svg]:w-[18px] [&>svg]:stroke-[2.25]`}
              >
                {opt.icon}
              </span>
            ) : null}
            {opt.label}
            {opt.count != null && opt.count > 0 ? (
              <span
                className={`inline-flex min-w-[18px] items-center justify-center rounded-full px-2 py-0.5 text-[10px] font-semibold tabular-nums ${
                  underline
                    ? 'bg-[#171717] text-white'
                    : active
                      ? 'bg-white/20 text-white'
                      : 'bg-neutral-100 text-[#171717]'
                }`}
              >
                {opt.count > 99 ? '99+' : opt.count}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
