import { ChevronDown } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

export function WorkspaceViewSelect({ "aria-label": ariaLabel, onChange, options, value }) {
  const [isOpen, setIsOpen] = useState(false);
  const rootRef = useRef(null);
  const listboxId = useId();
  const selectedOption = options.find((option) => option.value === value) || options[0];

  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }

    function handlePointerDown(event) {
      if (rootRef.current && !rootRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    }

    function handleKeyDown(event) {
      if (event.key === "Escape") {
        setIsOpen(false);
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
  }

  return (
    <div className="workspace-view-select" ref={rootRef}>
      <button
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        aria-label={ariaLabel || "View"}
        className="workspace-view-select__trigger"
        onClick={() => setIsOpen((current) => !current)}
        type="button"
      >
        <span className="workspace-view-select__label">{selectedOption?.label}</span>
        <ChevronDown
          aria-hidden="true"
          className={`workspace-view-select__chevron ${isOpen ? "is-open" : ""}`}
          size={22}
          strokeWidth={2.5}
        />
      </button>

      {isOpen ? (
        <ul
          aria-activedescendant={`${listboxId}-${value}`}
          className="workspace-view-select__menu"
          id={listboxId}
          role="listbox"
        >
          {options.map((option) => {
            const isSelected = option.value === value;

            return (
              <li key={option.value} role="presentation">
                <button
                  aria-selected={isSelected}
                  className={`workspace-view-select__option ${isSelected ? "is-selected" : ""}`}
                  id={`${listboxId}-${option.value}`}
                  onClick={() => handleSelect(option.value)}
                  role="option"
                  type="button"
                >
                  {option.label}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
