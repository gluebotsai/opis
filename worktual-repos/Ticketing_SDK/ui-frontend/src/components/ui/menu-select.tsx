import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown } from 'lucide-react';

export type MenuSelectOption = { value: string; label: string; detail?: string };

type MenuSelectProps = {
  id?: string;
  label: string;
  value?: string;
  options: MenuSelectOption[];
  onChange?: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  /** Keep ticket-card clicks from expanding/collapsing the row. */
  stopPropagation?: boolean;
  className?: string;
  triggerClassName?: string;
  minMenuWidth?: number;
  /** Hug-content chip (ticket status/priority), not the 38px field. */
  compact?: boolean;
  /** Toggle several values; menu stays open. `allValue` clears the set. */
  multiple?: boolean;
  values?: string[];
  onChangeValues?: (values: string[]) => void;
  allValue?: string;
};

const DEFAULT_TRIGGER =
  'flex w-full min-w-0 h-[38px] items-center justify-between gap-2 rounded-lg border-[0.6px] border-[#bfbfbf] bg-neutral-50 pl-2.5 pr-3 text-sm font-medium text-neutral-700 shadow-none outline-none focus:border-neutral-400 disabled:cursor-not-allowed disabled:opacity-60';

/**
 * Worktual menu select — 38px trigger, portal list (not native OS <select>).
 */
export default function MenuSelect({
  id,
  label,
  value = '',
  options,
  onChange,
  placeholder,
  disabled,
  stopPropagation,
  className = '',
  triggerClassName,
  minMenuWidth = 168,
  compact,
  multiple,
  values = [],
  onChangeValues,
  allValue = 'All',
}: MenuSelectProps) {
  const [open, setOpen] = useState(false);
  const [scrolling, setScrolling] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const scrollHideRef = useRef<number>(0);
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(
    null
  );

  useEffect(() => {
    if (!open) return;
    const place = () => {
      const el = btnRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const width = Math.max(r.width, minMenuWidth);
      const left = Math.min(r.left, window.innerWidth - width - 8);
      const below = r.bottom + 4;
      const rowH = options.some((o) => o.detail) ? 56 : 38;
      const estimated = Math.min(options.length * rowH + 8, 280);
      const top =
        below + estimated > window.innerHeight - 8
          ? Math.max(8, r.top - estimated - 4)
          : below;
      setPos({ top, left: Math.max(8, left), width });
    };
    place();
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (btnRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, options.length, minMenuWidth]);

  useEffect(() => {
    if (!open) {
      setScrolling(false);
      window.clearTimeout(scrollHideRef.current);
    }
    return () => window.clearTimeout(scrollHideRef.current);
  }, [open]);

  const revealScrollbar = () => {
    setScrolling(true);
    window.clearTimeout(scrollHideRef.current);
    scrollHideRef.current = window.setTimeout(() => setScrolling(false), 900);
  };

  const selectedValues = multiple
    ? values.filter((v) => v && v !== allValue)
    : value
      ? [value]
      : [];
  const selected = options.find((o) => o.value === value);
  const multiLabels = options.filter((o) =>
    selectedValues.some((v) => v.toLowerCase() === o.value.toLowerCase())
  );
  const display = multiple
    ? multiLabels.length === 0
      ? options.find((o) => o.value === allValue)?.label || placeholder || label
      : multiLabels.length === 1
        ? multiLabels[0].label
        : `${multiLabels[0].label} +${multiLabels.length - 1}`
    : selected?.label || placeholder || label;

  const isChosen = (optionValue: string) => {
    if (multiple) {
      if (selectedValues.length === 0) return optionValue === allValue;
      return selectedValues.some((v) => v.toLowerCase() === optionValue.toLowerCase());
    }
    return optionValue === value;
  };

  const pick = (optionValue: string) => {
    if (!multiple) {
      onChange?.(optionValue);
      setOpen(false);
      return;
    }
    if (optionValue === allValue) {
      onChangeValues?.([]);
      return;
    }
    const exists = selectedValues.some((v) => v.toLowerCase() === optionValue.toLowerCase());
    const next = exists
      ? selectedValues.filter((v) => v.toLowerCase() !== optionValue.toLowerCase())
      : [...selectedValues, optionValue];
    onChangeValues?.(next);
  };

  const halt = (e: React.SyntheticEvent) => {
    if (stopPropagation) e.stopPropagation();
  };

  return (
    <div className={`relative min-w-0 ${className}`}>
      <button
        ref={btnRef}
        id={id}
        type="button"
        disabled={disabled}
        aria-label={label}
        aria-haspopup="listbox"
        aria-multiselectable={multiple || undefined}
        aria-expanded={open}
        onMouseDown={halt}
        onClick={(e) => {
          halt(e);
          if (!disabled) setOpen((v) => !v);
        }}
        className={triggerClassName || DEFAULT_TRIGGER}
      >
        <span className="min-w-0 truncate text-left">{display}</span>
        <ChevronDown
          className={`${compact ? 'size-3.5' : 'size-[18px]'} shrink-0 text-neutral-400`}
          strokeWidth={2.25}
          aria-hidden
        />
      </button>
      {open &&
        pos &&
        createPortal(
          <div
            ref={menuRef}
            role="listbox"
            aria-multiselectable={multiple || undefined}
            aria-label={label}
            style={{
              position: 'fixed',
              top: pos.top,
              left: pos.left,
              width: pos.width,
              zIndex: 90,
            }}
            onScroll={revealScrollbar}
            onWheel={revealScrollbar}
            className={`menu-select-list max-h-72 overflow-y-auto rounded-lg border-[0.6px] border-[#bfbfbf] bg-white py-1 shadow-none ${
              scrolling ? 'menu-select-list--scrolling' : ''
            }`}
          >
            {options.map((o) => (
              <button
                key={o.value === '' ? `${label}-empty` : o.value}
                type="button"
                role="option"
                aria-selected={isChosen(o.value)}
                onMouseDown={halt}
                onClick={(e) => {
                  halt(e);
                  pick(o.value);
                }}
                className={`flex w-full items-start gap-2 px-3 py-2 text-left text-sm ${
                  isChosen(o.value)
                    ? 'bg-neutral-100 font-semibold text-neutral-900'
                    : 'font-medium text-neutral-700'
                } hover:bg-neutral-100`}
              >
                {multiple ? (
                  <Check
                    className={`mt-0.5 size-3.5 shrink-0 ${
                      isChosen(o.value) ? 'text-neutral-900' : 'text-transparent'
                    }`}
                    strokeWidth={2.25}
                    aria-hidden
                  />
                ) : null}
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{o.label}</span>
                  {o.detail ? (
                    <span className="mt-0.5 block text-[11px] font-normal leading-snug text-neutral-500">
                      {o.detail}
                    </span>
                  ) : null}
                </span>
              </button>
            ))}
          </div>,
          document.body
        )}
    </div>
  );
}
