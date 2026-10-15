import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";

import { listRowDividerClassName } from "@/components/ui/list-row";
import { cn } from "@/lib/utils";

export type MenuSelectOption<T extends string = string> = {
  value: T;
  label: string;
};

type MenuSelectProps<T extends string> = {
  value: T;
  options: Array<MenuSelectOption<T>>;
  onChange: (value: T) => void;
  ariaLabel?: string;
  id?: string;
  placeholder?: string;
  className?: string;
  listClassName?: string;
  disabled?: boolean;
};

export function MenuSelect<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  id,
  placeholder = "Select",
  className,
  listClassName,
  disabled = false,
}: MenuSelectProps<T>) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(() =>
    Math.max(0, options.findIndex((option) => option.value === value)),
  );
  const [menuStyle, setMenuStyle] = useState<CSSProperties>({});
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  const selected = options.find((option) => option.value === value);
  const displayLabel = selected?.label ?? placeholder;
  const searchable = options.length >= 20;
  const normalizedQuery = query.trim().toLowerCase();
  const visibleOptions =
    normalizedQuery.length === 0
      ? options
      : options.filter((option) => option.label.toLowerCase().includes(normalizedQuery));

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  function positionMenu() {
    if (!buttonRef.current) return;
    const rect = buttonRef.current.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const openUpward = spaceBelow < 300 && rect.top > spaceBelow;
    setMenuStyle({
      position: "fixed",
      left: rect.left,
      width: rect.width,
      top: openUpward ? undefined : rect.bottom + 6,
      bottom: openUpward ? window.innerHeight - rect.top + 6 : undefined,
      zIndex: 80,
    });
  }

  useLayoutEffect(() => {
    if (!open) return;
    positionMenu();
  }, [open]);

  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: MouseEvent) {
      const target = event.target as Node;
      if (rootRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        setOpen(false);
        buttonRef.current?.focus();
        return;
      }

      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        setHighlight((current) => {
          const next =
            event.key === "ArrowDown"
              ? Math.min(visibleOptions.length - 1, current + 1)
              : Math.max(0, current - 1);
          return next;
        });
        return;
      }

      if (event.key === "Home") {
        event.preventDefault();
        setHighlight(0);
        return;
      }

      if (event.key === "End") {
        event.preventDefault();
        setHighlight(Math.max(0, visibleOptions.length - 1));
        return;
      }

      if (event.key === "Enter") {
        event.preventDefault();
        const option = visibleOptions[highlight];
        if (option) {
          onChange(option.value);
          setOpen(false);
          buttonRef.current?.focus();
        }
      }
    }

    function onReposition() {
      positionMenu();
    }

    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", onReposition);
    window.addEventListener("scroll", onReposition, true);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", onReposition);
      window.removeEventListener("scroll", onReposition, true);
    };
  }, [highlight, onChange, open, visibleOptions]);

  useEffect(() => {
    if (!open) return;
    const item = menuRef.current?.querySelector<HTMLElement>(`[data-index="${highlight}"]`);
    item?.scrollIntoView({ block: "nearest" });
  }, [highlight, open]);

  useEffect(() => {
    if (!open || !searchable) return;
    searchRef.current?.focus();
  }, [open, searchable]);

  function choose(next: T) {
    onChange(next);
    setOpen(false);
    buttonRef.current?.focus();
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={buttonRef}
        id={id}
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        disabled={disabled}
        onClick={() => {
          if (disabled) return;
          setQuery("");
          setHighlight(Math.max(0, options.findIndex((option) => option.value === value)));
          setOpen((current) => !current);
        }}
        className={cn(
          "flex h-[38px] w-full cursor-pointer items-center justify-between gap-2 rounded-lg border-[0.6px] border-[#bfbfbf] bg-white py-2 pl-2.5 pr-2.5 text-left text-sm text-neutral-700 outline-none transition",
          "hover:border-[#bfbfbf] hover:bg-white",
          "focus:border-neutral-400 focus:bg-white focus:ring-2 focus:ring-neutral-200",
          open && "border-neutral-400 bg-white ring-2 ring-neutral-200",
          !selected && "text-neutral-600",
          disabled && "cursor-not-allowed bg-neutral-50 text-neutral-400 opacity-100 hover:bg-neutral-50",
          className,
        )}
      >
        <span className="min-w-0 truncate">{displayLabel}</span>
        <ChevronDown
          className={cn(
            "size-[18px] shrink-0 text-neutral-600 transition-transform",
            open && "rotate-180",
          )}
          aria-hidden
        />
      </button>
      {open
        ? createPortal(
            <div
              ref={menuRef}
              data-menu-select-list=""
              style={menuStyle}
              className={cn(
                "max-h-72 overflow-auto rounded-xl border-[0.6px] border-[#bfbfbf] bg-white py-1 shadow-sm",
                listClassName,
              )}
            >
              {searchable ? (
                <div className="sticky top-0 z-10 bg-white px-2 pb-1 pt-1">
                  <input
                    ref={searchRef}
                    type="search"
                    value={query}
                    onChange={(event) => {
                      setQuery(event.target.value);
                      setHighlight(0);
                    }}
                    placeholder="Search"
                    aria-label={`Search ${ariaLabel ?? "options"}`}
                    className="h-8 w-full rounded-lg border-[0.6px] border-[#bfbfbf] bg-white px-2.5 text-sm text-neutral-800 outline-none placeholder:text-neutral-500 focus:border-neutral-400 focus:ring-2 focus:ring-neutral-200"
                  />
                </div>
              ) : null}
              <ul id={listId} role="listbox" aria-label={ariaLabel}>
                {visibleOptions.length === 0 ? (
                  <li className="px-3 py-2.5 text-sm text-neutral-500">No matches</li>
                ) : (
                  visibleOptions.map((option, index) => {
                    const isSelected = option.value === value;
                    const isHighlighted = index === highlight;
                    return (
                      <li key={option.value} className={listRowDividerClassName("3")}>
                        <button
                          type="button"
                          role="option"
                          aria-selected={isSelected}
                          data-index={index}
                          onMouseEnter={() => setHighlight(index)}
                          onClick={() => choose(option.value)}
                          className={cn(
                            "flex w-full cursor-pointer items-center gap-2 px-3 py-2.5 text-left text-sm text-neutral-800 transition-colors",
                            isHighlighted && "bg-neutral-50",
                            isSelected && "font-medium text-neutral-900",
                          )}
                        >
                          <Check
                            className={cn(
                              "size-4 shrink-0 text-neutral-900",
                              !isSelected && "opacity-0",
                            )}
                            aria-hidden
                          />
                          <span className="min-w-0 truncate">{option.label}</span>
                        </button>
                      </li>
                    );
                  })
                )}
              </ul>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
