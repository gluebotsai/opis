import { ChevronDown } from "lucide-react";
import { useEffect, useRef } from "react";
import {
  PRESENCE_OPTIONS,
  presenceDot,
  presenceLabel,
  useAgentPresence,
} from "@/features/voice/agent-presence";
import { WORKTUAL_HEADER_CONTROL } from "@/lib/worktual-control-tokens";

export function HeaderPresence() {
  const { presence, menuOpen, setMenuOpen, setPresence, locked } = useAgentPresence();
  const rootRef = useRef<HTMLDivElement>(null);
  const label = presenceLabel(presence.state);

  useEffect(() => {
    if (!menuOpen) return;
    const onPointer = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen, setMenuOpen]);

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        className={`${WORKTUAL_HEADER_CONTROL} gap-2 disabled:cursor-not-allowed disabled:opacity-60`}
        disabled={locked}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        aria-label={locked ? `${label}; presence locked during call` : label}
        onClick={() => setMenuOpen(!menuOpen)}
      >
        <span className={`size-2 rounded-full ${presenceDot(presence.state)}`} />
        {label}
        <ChevronDown className="size-4 text-neutral-900" />
      </button>
      {menuOpen ? (
        <div
          role="menu"
          className="absolute right-0 top-full z-50 mt-1 min-w-40 rounded-lg border-[0.6px] border-[#bfbfbf] bg-white p-1 shadow-lg"
        >
          {PRESENCE_OPTIONS.map((option) => {
            const busyDisabled = option.state === "busy";
            return (
              <button
                key={option.state}
                type="button"
                role="menuitem"
                disabled={busyDisabled}
                className={`flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm ${
                  busyDisabled
                    ? "cursor-not-allowed text-neutral-400 opacity-50"
                    : "hover:bg-neutral-50"
                }`}
                onClick={() => {
                  if (busyDisabled) return;
                  void setPresence(option.state);
                }}
              >
                <span
                  className={`size-2 rounded-full ${option.dot} ${busyDisabled ? "opacity-50" : ""}`}
                />
                {option.label}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
