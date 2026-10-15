import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";

import { contactInputClassName } from "@/components/contacts/contact-form-fields";
import { cn } from "@/lib/utils";
import {
  DEFAULT_PHONE_COUNTRY,
  nationalFromStored,
  PHONE_COUNTRIES,
  phoneCountryByIso,
  phoneFromNationalInput,
  splitPhoneNumber,
} from "@/features/contacts/phone-country";

const VISIBLE_COUNTRIES = 5;
const COUNTRY_ROW_PX = 36;
const COUNTRY_LIST_HEIGHT = VISIBLE_COUNTRIES * COUNTRY_ROW_PX;

function FieldLabel({ children }: { children: string }) {
  return <span className="flex items-center gap-1.5 text-sm font-medium text-neutral-900">{children}</span>;
}

function CountryCodeMenu({
  id,
  label,
  iso,
  onChange,
}: {
  id: string;
  label: string;
  iso: string;
  onChange: (iso: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [menuStyle, setMenuStyle] = useState<CSSProperties>({});
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const selected = phoneCountryByIso(iso);
  const normalizedQuery = query.trim().toLowerCase();
  const visibleCountries =
    normalizedQuery.length === 0
      ? PHONE_COUNTRIES
      : PHONE_COUNTRIES.filter((country) =>
          `${country.name} ${country.dial}`.toLowerCase().includes(normalizedQuery),
        );

  function positionMenu() {
    const button = buttonRef.current;
    if (!button) return;
    const rect = button.getBoundingClientRect();
    const menuWidth = Math.min(280, window.innerWidth - 16);
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - menuWidth - 8));
    const menuHeight = COUNTRY_LIST_HEIGHT + 48;
    const belowTop = rect.bottom + 4;
    const fitsBelow = belowTop + menuHeight <= window.innerHeight - 8;
    const top = fitsBelow ? belowTop : Math.max(8, window.innerHeight - menuHeight - 8);
    setMenuStyle({
      position: "fixed",
      left,
      width: menuWidth,
      top,
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
      if (buttonRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
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
  }, [open]);

  useEffect(() => {
    if (!open) return;
    menuRef.current?.querySelector<HTMLElement>("[data-selected='true']")?.scrollIntoView({ block: "nearest" });
  }, [open]);

  return (
    <>
      <button
        ref={buttonRef}
        id={id}
        type="button"
        aria-label={`${label} country code`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        title={`${selected.name} (${selected.dial})`}
        onClick={() => {
          setQuery("");
          setOpen((current) => !current);
        }}
        className={cn(
          "flex h-[38px] w-[9.75rem] shrink-0 cursor-pointer items-center justify-between gap-1 rounded-lg border-[0.6px] border-[#bfbfbf] bg-white px-2.5 text-left text-[14px] text-neutral-800 outline-none",
          "focus:border-neutral-400 focus:ring-2 focus:ring-neutral-200",
          open && "border-neutral-400 ring-2 ring-neutral-200",
        )}
      >
        <span className="min-w-0 truncate">
          {selected.name} ({selected.dial})
        </span>
        <ChevronDown className={cn("size-4 shrink-0 text-neutral-600", open && "rotate-180")} aria-hidden />
      </button>
      {open
        ? createPortal(
            <div
              ref={menuRef}
              style={menuStyle}
              className="overflow-hidden rounded-lg border-[0.6px] border-[#bfbfbf] bg-white shadow-sm"
            >
              <div className="border-b-[0.6px] border-[#bfbfbf] p-1.5">
                <input
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search country"
                  aria-label={`Search ${label} country code`}
                  className="h-8 w-full rounded-md border-[0.6px] border-[#bfbfbf] bg-white px-2 text-sm text-neutral-800 outline-none placeholder:text-neutral-500 focus:border-neutral-400 focus:ring-2 focus:ring-neutral-200"
                />
              </div>
              <ul
                id={listId}
                role="listbox"
                aria-label={`${label} country code`}
                className="picker-scroll overflow-y-scroll"
                style={{ height: COUNTRY_LIST_HEIGHT }}
              >
                {visibleCountries.length === 0 ? (
                  <li className="px-2.5 py-2 text-sm text-neutral-500">No matches</li>
                ) : (
                  visibleCountries.map((country) => {
                    const isSelected = country.iso === iso;
                    return (
                      <li key={country.iso}>
                        <button
                          type="button"
                          role="option"
                          aria-selected={isSelected}
                          data-selected={isSelected ? "true" : undefined}
                          onClick={() => {
                            onChange(country.iso);
                            setOpen(false);
                            buttonRef.current?.focus();
                          }}
                          className={cn(
                            "flex h-9 w-full cursor-pointer items-center gap-2 px-2.5 text-left text-sm text-neutral-800 hover:bg-neutral-50",
                            isSelected && "bg-neutral-50 font-medium text-neutral-900",
                          )}
                        >
                          <Check className={cn("size-3.5 shrink-0", !isSelected && "opacity-0")} aria-hidden />
                          <span className="min-w-0 truncate">
                            {country.name} ({country.dial})
                          </span>
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
    </>
  );
}

export function ContactPhoneField({
  id,
  label,
  value,
  onChange,
  placeholder,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  const [iso, setIso] = useState(() => {
    const split = splitPhoneNumber(value);
    return split.matched ? split.iso : DEFAULT_PHONE_COUNTRY;
  });

  useEffect(() => {
    const split = splitPhoneNumber(value);
    if (!split.matched) return;
    const selectedCode = phoneCountryByIso(iso).code;
    const detectedCode = phoneCountryByIso(split.iso).code;
    if (selectedCode !== detectedCode) setIso(split.iso);
  }, [value, iso]);

  const national = nationalFromStored(value, iso);

  function apply(nextIso: string, nationalRaw: string) {
    const next = phoneFromNationalInput(nextIso, nationalRaw);
    setIso(next.iso);
    onChange(next.stored);
  }

  return (
    <div className="block min-w-0 space-y-2">
      <FieldLabel>{label}</FieldLabel>
      <div className="flex min-w-0 gap-2">
        <CountryCodeMenu id={`${id}-country`} label={label} iso={iso} onChange={(nextIso) => apply(nextIso, national)} />
        <input
          id={id}
          type="tel"
          inputMode="tel"
          autoComplete="tel-national"
          value={national}
          onChange={(event) => apply(iso, event.target.value)}
          placeholder={placeholder}
          className={contactInputClassName}
        />
      </div>
    </div>
  );
}
