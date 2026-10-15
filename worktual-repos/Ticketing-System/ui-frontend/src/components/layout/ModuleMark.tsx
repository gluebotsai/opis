import React from 'react';

type ModuleMarkProps = {
  collapsed?: boolean;
  onClick?: () => void;
  portalLabel?: string;
};

/**
 * Sidebar brand — matches Contact Center reference:
 * white Worktual wordmark + portal subtitle (no duplicate text).
 */
export default function ModuleMark({
  collapsed = false,
  onClick,
  portalLabel = 'TICKETING PORTAL',
}: ModuleMarkProps) {
  if (collapsed) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="flex w-full items-center justify-center py-1.5 rounded-xl transition-colors hover:bg-white/5"
        title={`Worktual · ${portalLabel}`}
      >
        <span className="h-8 w-8 rounded-lg overflow-hidden flex items-center justify-start bg-transparent">
          <img
            src="/brand/worktual-logo.png"
            alt="Worktual"
            className="h-7 w-auto max-w-none object-contain object-left brightness-0 invert"
          />
        </span>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full flex-col items-start gap-1.5 px-2 py-1.5 text-left transition-colors hover:bg-white/5 rounded-xl"
      title="Worktual"
    >
      <img
        src="/brand/worktual-logo.png"
        alt="Worktual"
        className="h-7 w-auto max-w-full object-contain object-left brightness-0 invert"
      />
      <span className="text-[10px] tracking-[0.16em] uppercase text-white/45 pl-0.5">
        {portalLabel}
      </span>
    </button>
  );
}
