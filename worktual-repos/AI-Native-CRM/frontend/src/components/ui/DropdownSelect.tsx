import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown } from "lucide-react";

const SIZE_BUTTON: Record<"sm" | "md" | "lg", string> = {
  sm: "h-[38px] min-w-[5.5rem] rounded-lg px-2 text-xs",
  md: "h-[38px] min-w-[8.5rem] rounded-lg px-3 text-sm",
  lg: "h-[38px] min-w-0 rounded-lg px-3 text-sm",
};

const SIZE_CHEVRON: Record<"sm" | "md" | "lg", string> = {
  sm: "size-[18px]",
  md: "size-[18px]",
  lg: "size-[18px]",
};

type MenuBox = { top: number; left: number; width: number; maxHeight: number };

export function DropdownSelect({
  value,
  options,
  onChange,
  disabled,
  id,
  "aria-label": ariaLabel,
  className = "",
  buttonClassName = "",
  size = "md",
  fullWidth = false,
}: {
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
  disabled?: boolean;
  id?: string;
  "aria-label"?: string;
  className?: string;
  buttonClassName?: string;
  size?: "sm" | "md" | "lg";
  fullWidth?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [menuBox, setMenuBox] = useState<MenuBox | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const listId = useId();
  const selectedLabel =
    options.find((option) => option.value === value)?.label ?? value;

  useLayoutEffect(() => {
    if (!open || !buttonRef.current) {
      setMenuBox(null);
      return;
    }
    const place = () => {
      const rect = buttonRef.current?.getBoundingClientRect();
      if (!rect) return;
      const gutter = 8;
      const spaceBelow = window.innerHeight - rect.bottom - gutter;
      const spaceAbove = rect.top - gutter;
      const preferBelow = spaceBelow >= 160 || spaceBelow >= spaceAbove;
      const maxHeight = Math.max(
        120,
        Math.min(240, preferBelow ? spaceBelow : spaceAbove),
      );
      const width = Math.max(rect.width, fullWidth ? rect.width : 0);
      const left = Math.min(
        Math.max(gutter, rect.right - width),
        window.innerWidth - width - gutter,
      );
      const top = preferBelow
        ? rect.bottom + 4
        : Math.max(gutter, rect.top - 4 - maxHeight);
      setMenuBox({ top, left, width, maxHeight });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, fullWidth, options.length]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (rootRef.current?.contains(target)) return;
      if (listRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const menu =
    open && menuBox
      ? createPortal(
          <ul
            ref={listRef}
            id={listId}
            role="listbox"
            aria-label={ariaLabel}
            style={{
              position: "fixed",
              top: menuBox.top,
              left: menuBox.left,
              width: menuBox.width,
              maxHeight: menuBox.maxHeight,
            }}
            className="z-[200] overflow-y-auto overscroll-contain rounded-xl border-[0.6px] border-[#bfbfbf] bg-white py-1 shadow-sm"
          >
            {options.map((option) => {
              const isSelected = option.value === value;
              return (
                <li key={option.value} role="presentation">
                  <button
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    title={option.label}
                    onClick={() => {
                      onChange(option.value);
                      setOpen(false);
                    }}
                    className={`flex w-full items-center px-3 py-2 text-left text-sm transition-colors ${
                      isSelected
                        ? "bg-subtle font-medium text-text-primary"
                        : "text-text-secondary hover:bg-subtle/80 hover:text-text-primary"
                    }`}
                  >
                    <span className="min-w-0 truncate">{option.label}</span>
                  </button>
                </li>
              );
            })}
          </ul>,
          document.body,
        )
      : null;

  return (
    <div
      ref={rootRef}
      className={`relative ${fullWidth ? "w-full" : ""} ${className}`.trim()}
    >
      <button
        ref={buttonRef}
        id={id}
        type="button"
        disabled={disabled}
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={listId}
        onClick={() => setOpen((current) => !current)}
        className={`${fullWidth ? "flex w-full" : "inline-flex"} items-center justify-between gap-2 border-[0.6px] border-[#bfbfbf] bg-neutral-50 text-neutral-900 transition-colors hover:border-neutral-400 hover:bg-white focus:border-neutral-400 focus:bg-white focus:ring-2 focus:ring-neutral-200 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 ${SIZE_BUTTON[size]} ${buttonClassName}`.trim()}
      >
        <span className="min-w-0 truncate text-left">{selectedLabel}</span>
        <ChevronDown
          className={`${SIZE_CHEVRON[size]} shrink-0 text-text-caption transition-transform ${open ? "rotate-180" : ""}`}
          strokeWidth={1.75}
        />
      </button>
      {menu}
    </div>
  );
}
