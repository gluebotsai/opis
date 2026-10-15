import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { ChevronDown, Delete, Loader2, Phone, Search, UserRound } from "lucide-react";
import {
  getOutboundCallState,
  placeOutboundCall,
  subscribeOutboundCall,
} from "@/features/voice/sip-ua";
import {
  DEFAULT_DIAL_CODE,
  normalizeDialedNumber,
} from "@/features/voice/sip-outbound";
import { WORKTUAL_ICON_BUTTON } from "@/lib/worktual-control-tokens";
import {
  countryFlag,
  findCountry,
  searchCountries,
  type Country,
} from "@/lib/country-dial-codes";
import { searchContactsForCompose } from "@/services/contacts";

type ContactHit = {
  id: string;
  displayName: string;
  email: string;
  phone: string | null;
};

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "*", "0", "#"];

const FIELD =
  "h-10 rounded-xl border border-[#e5e5e5] bg-white text-sm text-neutral-900";
const ROW =
  "flex w-full items-center gap-2.5 rounded-xl px-2 py-2 text-left transition-colors hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50";

const COUNTRY_KEY = "worktual.dialpad.country";

/** Default country comes from the dial code the call stack already uses. */
const FALLBACK_COUNTRY: Country =
  findCountry("IN") ?? { iso2: "IN", name: "India", dialCode: DEFAULT_DIAL_CODE };

function readCountry(): Country {
  try {
    const stored = window.localStorage.getItem(COUNTRY_KEY);
    return (stored && findCountry(stored)) || FALLBACK_COUNTRY;
  } catch {
    return FALLBACK_COUNTRY;
  }
}

function writeCountry(iso2: string): void {
  try {
    window.localStorage.setItem(COUNTRY_KEY, iso2);
  } catch {
    // Ignore quota and privacy-mode failures.
  }
}

/** Dial any number from the header, without needing a contact record first. */
export function HeaderDialpad() {
  const call = useSyncExternalStore(
    subscribeOutboundCall,
    getOutboundCallState,
    getOutboundCallState,
  );
  const [open, setOpen] = useState(false);
  const [number, setNumber] = useState("");
  const [country, setCountry] = useState<Country>(readCountry);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [countryQuery, setCountryQuery] = useState("");
  const [hits, setHits] = useState<ContactHit[]>([]);
  const [searching, setSearching] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const countrySearchRef = useRef<HTMLInputElement>(null);

  const matches = useMemo(() => searchCountries(countryQuery), [countryQuery]);

  const live = call.phase !== "idle";
  const dialable = normalizeDialedNumber(number).length > 0;

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // Escape backs out of the country list before closing the whole pad.
      if (pickerOpen) setPickerOpen(false);
      else setOpen(false);
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, pickerOpen]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  // Look the typed text up against contacts, so a known person can be called
  // by name instead of by remembering their number. Debounced, and the
  // in-flight result is dropped if the query moved on.
  useEffect(() => {
    const query = number.trim();
    if (!open || pickerOpen || query.length < 2) {
      setHits([]);
      setSearching(false);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const timer = window.setTimeout(() => {
      void searchContactsForCompose(query)
        .then((items) => {
          if (cancelled) return;
          setHits(items.filter((item) => Boolean(item.phone)));
        })
        .catch(() => {
          if (!cancelled) setHits([]);
        })
        .finally(() => {
          if (!cancelled) setSearching(false);
        });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [number, open, pickerOpen]);

  useEffect(() => {
    if (!pickerOpen) {
      setCountryQuery("");
      return;
    }
    countrySearchRef.current?.focus();
  }, [pickerOpen]);

  // The call popup takes over once dialing starts, so the pad steps aside and
  // comes back empty for the next number.
  useEffect(() => {
    if (!live) return;
    setOpen(false);
    setPickerOpen(false);
    setNumber("");
    setHits([]);
  }, [live]);

  const press = (key: string) => {
    setNumber((current) => `${current}${key}`);
    inputRef.current?.focus();
  };

  const dial = () => {
    if (!dialable || live) return;
    void placeOutboundCall(number, country.dialCode);
  };

  const callContact = (hit: ContactHit) => {
    if (live || !hit.phone) return;
    void placeOutboundCall(hit.phone, country.dialCode, hit.displayName);
  };

  const chooseCountry = (next: Country) => {
    setCountry(next);
    writeCountry(next.iso2);
    setPickerOpen(false);
    inputRef.current?.focus();
  };

  const hint = !call.registered
    ? "Waiting for the phone to register…"
    : live
      ? "A call is already in progress."
      : null;

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        className={WORKTUAL_ICON_BUTTON}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label="Dialpad"
        title="Dialpad"
        onClick={() => setOpen((current) => !current)}
      >
        <Phone strokeWidth={1.75} />
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label="Dialpad"
          className="absolute right-0 top-full z-50 mt-1 w-72 rounded-lg border-[0.6px] border-[#bfbfbf] bg-white p-3 shadow-lg"
        >
          <div className="flex items-center gap-1">
            <button
              type="button"
              className={`${FIELD} inline-flex shrink-0 items-center gap-1 px-2 font-medium transition-colors hover:bg-neutral-50`}
              aria-haspopup="listbox"
              aria-expanded={pickerOpen}
              aria-label={`Country code: ${country.name} ${country.dialCode}`}
              onClick={() => setPickerOpen((current) => !current)}
            >
              <span aria-hidden>{countryFlag(country.iso2)}</span>
              <span>{country.dialCode}</span>
              <ChevronDown className="size-3.5 text-neutral-500" strokeWidth={1.75} />
            </button>
            <input
              ref={inputRef}
              value={number}
              onChange={(event) => setNumber(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") dial();
              }}
              inputMode="tel"
              placeholder="Name or number"
              aria-label="Search a contact or type a number"
              className={`${FIELD} min-w-0 flex-1 px-3 outline-none transition-colors placeholder:text-neutral-400 focus:border-neutral-400`}
            />
            <button
              type="button"
              className="inline-flex size-10 shrink-0 items-center justify-center rounded-xl text-neutral-500 transition-colors hover:bg-neutral-100 disabled:opacity-40"
              aria-label="Delete last digit"
              disabled={number.length === 0}
              onClick={() => setNumber((current) => current.slice(0, -1))}
            >
              <Delete className="size-4" strokeWidth={1.75} />
            </button>
          </div>

          {!pickerOpen && (searching || hits.length > 0) ? (
            <div className="mt-2.5 border-t border-[#f0f0f0] pt-2">
              <div className="flex items-center gap-1.5 px-1 pb-1">
                <p className="text-[11px] font-medium uppercase tracking-wide text-neutral-400">
                  Contacts
                </p>
                {searching ? (
                  <Loader2
                    className="size-3 animate-spin text-neutral-400"
                    aria-label="Searching"
                  />
                ) : null}
              </div>
              {hits.length === 0 ? null : (
                <ul className="max-h-44 overflow-y-auto">
                  {hits.map((hit) => (
                    <li key={hit.id}>
                      <button
                        type="button"
                        disabled={live || !call.registered}
                        className={ROW}
                        onClick={() => callContact(hit)}
                      >
                        <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-neutral-500">
                          <UserRound className="size-3.5" strokeWidth={1.75} aria-hidden />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-neutral-900">
                            {hit.displayName}
                          </span>
                          <span className="block truncate text-xs text-neutral-500">
                            {hit.phone}
                          </span>
                        </span>
                        <Phone
                          className="size-3.5 shrink-0 text-neutral-400"
                          strokeWidth={1.75}
                          aria-hidden
                        />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : null}

          {pickerOpen ? (
            <div className="mt-3">
              <div className={`${FIELD} flex items-center gap-2 px-2.5`}>
                <Search className="size-4 shrink-0 text-neutral-400" strokeWidth={1.75} />
                <input
                  ref={countrySearchRef}
                  value={countryQuery}
                  onChange={(event) => setCountryQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && matches[0]) chooseCountry(matches[0]);
                  }}
                  placeholder="Search country or code"
                  aria-label="Search country"
                  className="min-w-0 flex-1 bg-transparent text-sm text-neutral-900 outline-none placeholder:text-neutral-400"
                />
              </div>
              <ul role="listbox" className="mt-2 max-h-64 overflow-y-auto">
                {matches.length === 0 ? (
                  <li className="px-2 py-6 text-center text-xs text-neutral-400">
                    No country matches that.
                  </li>
                ) : (
                  matches.map((item) => (
                    <li key={item.iso2}>
                      <button
                        type="button"
                        role="option"
                        aria-selected={item.iso2 === country.iso2}
                        className={`${ROW} text-sm ${
                          item.iso2 === country.iso2 ? "bg-neutral-50 font-medium" : ""
                        }`}
                        onClick={() => chooseCountry(item)}
                      >
                        <span aria-hidden>{countryFlag(item.iso2)}</span>
                        <span className="min-w-0 flex-1 truncate text-neutral-900">
                          {item.name}
                        </span>
                        <span className="shrink-0 text-xs text-neutral-500">
                          {item.dialCode}
                        </span>
                      </button>
                    </li>
                  ))
                )}
              </ul>
            </div>
          ) : (
            <>
          <div className="mt-2.5 grid grid-cols-3 gap-1.5">
            {KEYS.map((key) => (
              <button
                key={key}
                type="button"
                className={`${FIELD} text-base font-medium transition-colors hover:bg-neutral-50 active:scale-95`}
                onClick={() => press(key)}
              >
                {key}
              </button>
            ))}
          </div>

          <button
            type="button"
            className="mt-2.5 inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-[#171717] text-sm font-medium text-white transition-colors hover:bg-neutral-800 active:scale-[0.98] disabled:cursor-not-allowed disabled:bg-neutral-200 disabled:text-neutral-400"
            disabled={!dialable || live || !call.registered}
            onClick={dial}
          >
            <Phone className="size-4" strokeWidth={2} />
            Call
          </button>

          {hint ? (
            <p className="mt-2 text-center text-xs text-neutral-500">{hint}</p>
          ) : call.error ? (
            <p className="mt-2 text-center text-xs text-red-600" role="alert">
              {call.error}
            </p>
          ) : (
            <p className="mt-2 text-center text-xs text-neutral-400">
              {country.dialCode} is added unless you start with + or 00.
            </p>
          )}
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
