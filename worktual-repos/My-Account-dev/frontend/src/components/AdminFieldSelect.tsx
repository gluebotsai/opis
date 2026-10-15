// @ts-nocheck
import { Check, ChevronDown } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/**
 * Custom select for admin forms. Menu always opens below the trigger
 * (native <select> menus center on the selected option and cover the field).
 * Menu is portaled to document.body — outside-click handlers for filter
 * drawers must ignore `.admin-field-select__menu` (see helper below).
 */
export function isAdminFieldSelectMenuTarget(target) {
  return Boolean(
    target &&
      typeof target.closest === "function" &&
      target.closest(".admin-field-select__menu"),
  );
}

export function AdminFieldSelect({
  "aria-label": ariaLabel,
  className = "",
  disabled = false,
  invalid = false,
  menuMinWidth,
  onChange,
  options = [],
  placeholder = "Select…",
  required = false,
  value,
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [menuStyle, setMenuStyle] = useState(null);
  const rootRef = useRef(null);
  const triggerRef = useRef(null);
  const menuRef = useRef(null);
  const listboxId = useId();

  const selectedOption = options.find((option) => option.value === value);
  const displayLabel = selectedOption?.label || placeholder;

  function positionMenu() {
    const trigger = triggerRef.current;
    if (!trigger) {
      return;
    }

    const gap = 4;
    const viewportPad = 8;
    const preferredMax = 280;
    // ~3 option rows (10+10 pad + ~20 line) + menu chrome — keep scrollable list usable on short screens.
    const minVisibleHeight = 132;

    let rect = trigger.getBoundingClientRect();
    let spaceBelow = window.innerHeight - rect.bottom - gap - viewportPad;

    // Always open below (never flip above). If less than ~3 rows fit, scroll the field into view first.
    if (spaceBelow < minVisibleHeight) {
      trigger.scrollIntoView({ block: "center", inline: "nearest", behavior: "auto" });
      rect = trigger.getBoundingClientRect();
      spaceBelow = window.innerHeight - rect.bottom - gap - viewportPad;
    }

    // Never exceed remaining viewport below the trigger (avoids menu spilling off-screen).
    const maxHeight = Math.max(0, Math.min(preferredMax, spaceBelow));
    const width = Math.max(rect.width, menuMinWidth || 0);
    const left = Math.min(
      Math.max(8, rect.left),
      Math.max(8, window.innerWidth - width - 8),
    );

    setMenuStyle({
      left,
      maxHeight,
      top: rect.bottom + gap,
      width,
    });
  }

  useLayoutEffect(() => {
    if (!isOpen) {
      return undefined;
    }

    positionMenu();

    function handleReposition() {
      positionMenu();
    }

    window.addEventListener("resize", handleReposition);
    window.addEventListener("scroll", handleReposition, true);

    return () => {
      window.removeEventListener("resize", handleReposition);
      window.removeEventListener("scroll", handleReposition, true);
    };
  }, [isOpen, menuMinWidth, options.length]);

  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }

    function handlePointerDown(event) {
      if (
        rootRef.current?.contains(event.target) ||
        menuRef.current?.contains(event.target)
      ) {
        return;
      }
      setIsOpen(false);
    }

    function handleKeyDown(event) {
      if (event.key === "Escape") {
        event.stopPropagation();
        setIsOpen(false);
        triggerRef.current?.focus();
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  function handleSelect(nextValue) {
    if (nextValue !== value) {
      onChange(nextValue);
    }
    setIsOpen(false);
    triggerRef.current?.focus();
  }

  const menu =
    isOpen && menuStyle
      ? createPortal(
          <ul
            className="admin-field-select__menu"
            data-admin-field-select-menu=""
            id={listboxId}
            ref={menuRef}
            role="listbox"
            style={menuStyle}
          >
            {options.map((option) => {
              const isSelected = option.value === value;

              return (
                <li key={String(option.value ?? "__empty")} role="presentation">
                  <button
                    aria-selected={isSelected}
                    className={`admin-field-select__option${isSelected ? " is-selected" : ""}`}
                    onClick={() => handleSelect(option.value)}
                    role="option"
                    type="button"
                  >
                    <span>{option.label}</span>
                    {isSelected ? <Check aria-hidden="true" size={14} strokeWidth={2.5} /> : null}
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
      className={`admin-field-select${invalid ? " is-invalid" : ""}${className ? ` ${className}` : ""}`}
      ref={rootRef}
    >
      <button
        aria-controls={isOpen ? listboxId : undefined}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        aria-invalid={invalid ? "true" : undefined}
        aria-label={ariaLabel}
        aria-required={required || undefined}
        className="admin-field-select__trigger"
        disabled={disabled}
        onClick={() => {
          if (disabled) {
            return;
          }
          setIsOpen((current) => !current);
        }}
        ref={triggerRef}
        type="button"
      >
        <span
          className={`admin-field-select__value${!selectedOption ? " is-placeholder" : ""}`}
        >
          {displayLabel}
        </span>
        <ChevronDown aria-hidden="true" className="admin-field-select__chevron" size={16} />
      </button>
      {menu}
    </div>
  );
}
