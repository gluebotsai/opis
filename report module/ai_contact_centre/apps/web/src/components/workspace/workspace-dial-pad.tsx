import { ChevronDown, Delete, Grid3x3, Phone, PhoneOff, User, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { IconButton } from "@/components/ui/button";
import {
  composeDialedNumber,
  localNumberAfterDialCode,
  normalizeDialedNumber,
  shouldAutoOpenDialPad,
} from "@/features/voice/sip-outbound";
import {
  hangupOutboundCall,
  placeOutboundCall,
  type OutboundCallerOption,
  type SipCallState,
} from "@/features/voice/sip-ua";
import { useSipCallStatus } from "@/features/voice/use-sip-call-status";
import { contactsApi } from "@/features/contacts/api";
import { workspaceApi, type PresenceState } from "@/features/workspace/api";
import { useAgentPresence } from "@/features/workspace/use-agent-presence";
import { isVoiceChannel } from "@/features/workspace/workspace-utils";
import { cn } from "@/lib/utils";

const DIAL_KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "*", "0", "#"] as const;

const MAX_DIGITS = 16;

const DIAL_COUNTRIES = [
  { iso: "IN", name: "India", dial: "+91" },
  { iso: "US", name: "United States", dial: "+1" },
  { iso: "GB", name: "United Kingdom", dial: "+44" },
  { iso: "AE", name: "United Arab Emirates", dial: "+971" },
  { iso: "SA", name: "Saudi Arabia", dial: "+966" },
  { iso: "SG", name: "Singapore", dial: "+65" },
  { iso: "MY", name: "Malaysia", dial: "+60" },
  { iso: "AU", name: "Australia", dial: "+61" },
  { iso: "BD", name: "Bangladesh", dial: "+880" },
  { iso: "LK", name: "Sri Lanka", dial: "+94" },
  { iso: "NP", name: "Nepal", dial: "+977" },
  { iso: "PK", name: "Pakistan", dial: "+92" },
  { iso: "QA", name: "Qatar", dial: "+974" },
  { iso: "KW", name: "Kuwait", dial: "+965" },
  { iso: "OM", name: "Oman", dial: "+968" },
  { iso: "BH", name: "Bahrain", dial: "+973" },
  { iso: "CA", name: "Canada", dial: "+1" },
  { iso: "DE", name: "Germany", dial: "+49" },
  { iso: "FR", name: "France", dial: "+33" },
] as const;

const DEFAULT_COUNTRY_ISO = "IN";

const OUTBOUND_NOT_ALLOWED = "Outbound calling is not allowed";

function sanitizeLocalNumber(raw: string): string {
  const trimmed = raw.trim();
  const plus = trimmed.startsWith("+") ? "+" : "";
  const digits = (plus ? trimmed.slice(1) : trimmed).replace(/[^\d*#]/g, "");
  return `${plus}${digits.slice(0, MAX_DIGITS)}`;
}

function recentNumberForInput(phone: string, dialCode: string): string {
  const local = localNumberAfterDialCode(phone, dialCode);
  if (local) return local.slice(0, MAX_DIGITS);
  return sanitizeLocalNumber(phone);
}

function recentCallDestination(phone: string, dialCode: string): string {
  const trimmed = phone.trim();
  if (trimmed.startsWith("+") || trimmed.startsWith("00")) {
    const digits = normalizeDialedNumber(trimmed);
    return digits.startsWith("00") ? digits.slice(2) : digits;
  }
  const digits = normalizeDialedNumber(trimmed);
  if (localNumberAfterDialCode(digits, dialCode)) return digits;
  return composeDialedNumber(dialCode, digits);
}

function callStatusLabel(input: {
  registered: boolean;
  callState: SipCallState;
  error: string | null;
}): string | null {
  if (input.callState === "dialing") return "Calling…";
  if (input.callState === "ringing") return "Ringing…";
  if (input.callState === "active") return "Connected";
  if (input.error) return input.error;
  if (!input.registered) return "Registering…";
  return null;
}

function needsOutboundChoice(options: OutboundCallerOption[]): boolean {
  return options.some((option) => option.kind === "agent")
    && options.some((option) => option.kind === "queue");
}

function countryFlag(iso: string): string {
  return iso
    .toUpperCase()
    .replace(/./g, (letter) => String.fromCodePoint(127397 + letter.charCodeAt(0)));
}

type RecentDialCall = {
  id: string;
  name: string;
  phone: string;
};

type DialPadView = "keypad" | "recent";
type DialEntryMode = "typed" | "keypad";

function phoneDigits(value: string): string {
  return value.replace(/\D/g, "");
}

function sameDialedNumber(left: string, right: string): boolean {
  const a = phoneDigits(left);
  const b = phoneDigits(right);
  if (!a || !b) return false;
  if (a === b) return true;
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
  return shorter.length >= 7 && longer.endsWith(shorter) && longer.length - shorter.length <= 4;
}

function contactNameForNumber(calls: RecentDialCall[], number: string): string | null {
  const match = calls.find((call) => sameDialedNumber(call.phone, number));
  const name = match?.name.trim() ?? "";
  if (!name || !/[A-Za-z]/.test(name) || sameDialedNumber(name, match?.phone ?? number)) return null;
  return name;
}

function dialedDisplay(dialCode: string, local: string): string {
  const trimmed = local.trim();
  if (!trimmed) return dialCode;
  if (trimmed.startsWith("+")) return trimmed;
  return `${dialCode} ${trimmed}`;
}

function filterRecentCalls(calls: RecentDialCall[], query: string): RecentDialCall[] {
  const text = query.trim().toLowerCase();
  const digits = text.replace(/\D/g, "");
  if (!text) return calls;
  return calls.filter((call) => {
    if (call.name.toLowerCase().includes(text)) return true;
    return Boolean(digits) && call.phone.replace(/\D/g, "").includes(digits);
  });
}

function RecentCallRow({
  call,
  disabled,
  onCall,
}: {
  call: RecentDialCall;
  disabled: boolean;
  onCall: (phone: string) => void;
}) {
  return (
    <div className="flex items-center gap-2 rounded-xl px-1 py-1.5">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-blue-100 text-blue-600">
        <User className="size-[18px]" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-neutral-900">{call.name}</p>
        <p className="truncate text-xs tabular-nums text-neutral-600">{call.phone}</p>
      </div>
      <button
        type="button"
        aria-label={`Call ${call.name}`}
        disabled={disabled}
        onClick={() => onCall(call.phone)}
        className="flex size-[38px] items-center justify-center rounded-full border-[0.6px] border-[#bfbfbf] bg-white text-emerald-600 hover:bg-neutral-50 disabled:opacity-40"
      >
        <Phone className="size-[18px]" />
      </button>
    </div>
  );
}

type WorkspaceDialPadProps = {
  value: string;
  onChange: (value: string) => void;
  countryIso: string;
  onCountryIsoChange: (iso: string) => void;
  registered: boolean;
  callState: SipCallState;
  outboundCall: boolean;
  statusLabel: string | null;
  outboundOptions: OutboundCallerOption[];
  selectedOutboundId: string | null;
  showFromPicker: boolean;
  onSelectOutboundId: (id: string) => void;
  onCall: (value: string) => void;
  onHangup: () => void;
  onClose: () => void;
  padView: DialPadView;
  onPadViewChange: (view: DialPadView) => void;
  recentCalls: RecentDialCall[];
  namedCalls: RecentDialCall[];
  onCallRecent: (phone: string) => void;
  entryMode: DialEntryMode;
  onEntryModeChange: (mode: DialEntryMode) => void;
  className?: string;
};

export function WorkspaceDialPad({
  value,
  onChange,
  countryIso,
  onCountryIsoChange,
  registered,
  callState,
  outboundCall,
  statusLabel,
  outboundOptions,
  selectedOutboundId,
  showFromPicker,
  onSelectOutboundId,
  onCall,
  onHangup,
  onClose,
  padView,
  onPadViewChange,
  recentCalls,
  namedCalls,
  onCallRecent,
  entryMode,
  onEntryModeChange,
  className,
}: WorkspaceDialPadProps) {
  const [countryMenuOpen, setCountryMenuOpen] = useState(false);
  const selectedCountry =
    DIAL_COUNTRIES.find((country) => country.iso === countryIso) ??
    DIAL_COUNTRIES.find((country) => country.iso === DEFAULT_COUNTRY_ISO)!;
  const typedMatches = filterRecentCalls(recentCalls, value).slice(0, 5);
  const showTypedRecents =
    padView === "keypad" && entryMode === "typed" && value.length > 0 && typedMatches.length > 0;
  const keypadVisible = padView === "keypad" && !showTypedRecents;

  function appendDigit(digit: string) {
    if (value.length >= MAX_DIGITS) return;
    onEntryModeChange("keypad");
    onChange(`${value}${digit}`);
  }

  function backspace() {
    onChange(value.slice(0, -1));
  }

  const inCall = callState !== "idle";
  const dialedNumber = dialedDisplay(selectedCountry.dial, value);
  const callingText =
    inCall && outboundCall
      ? `Calling… ${contactNameForNumber(namedCalls, dialedNumber) ?? dialedNumber}`
      : null;
  const allowed = outboundOptions.length > 0;
  const canCall = value.length > 0 && !inCall && (allowed ? registered : true);

  return (
    <div
      className={cn(
        "w-[20rem] rounded-2xl border-[0.6px] border-[#bfbfbf] bg-white p-4 shadow-xl",
        className,
      )}
    >
      <div className="mb-3 flex items-center justify-between">
        <h2 className="min-w-0 truncate text-sm font-semibold text-neutral-900">
          {callingText ?? "Outbound Call"}
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close dial pad"
          className="-mr-1 flex size-8 items-center justify-center rounded-full text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900"
        >
          <X className="size-[18px]" />
        </button>
      </div>

      <div className="mb-3 flex items-center gap-2">
        <div className="relative flex min-w-0 flex-1 items-center rounded-full border-[0.6px] border-[#bfbfbf] bg-[#fafafa]">
          <button
            type="button"
            disabled={inCall}
            aria-label="Country code"
            aria-expanded={countryMenuOpen}
            onClick={() => setCountryMenuOpen((open) => !open)}
            className="flex h-[38px] shrink-0 items-center gap-1 rounded-l-full px-2.5 text-sm font-medium text-neutral-700 hover:bg-white disabled:opacity-40"
          >
            <span aria-hidden>{countryFlag(selectedCountry.iso)}</span>
            {selectedCountry.dial}
            <ChevronDown className="size-[18px] text-neutral-900" />
          </button>
          <input
            type="tel"
            inputMode="tel"
            autoComplete="off"
            disabled={inCall}
            value={value}
            placeholder="Enter number"
            aria-label="Phone number"
            onChange={(event) => {
              onEntryModeChange("typed");
              onChange(sanitizeLocalNumber(event.target.value));
            }}
            className="min-h-[38px] min-w-0 flex-1 bg-transparent px-2 text-sm font-semibold tracking-wide text-neutral-900 tabular-nums outline-none placeholder:font-normal placeholder:text-neutral-400 disabled:opacity-40"
          />
          <button
            type="button"
            onClick={backspace}
            disabled={!value || inCall}
            className="mr-1 flex size-7 shrink-0 items-center justify-center rounded-full text-neutral-400 transition hover:bg-white hover:text-neutral-700 disabled:pointer-events-none disabled:opacity-30"
            aria-label="Backspace"
          >
            <Delete className="size-[18px]" />
          </button>
          {countryMenuOpen && !inCall ? (
            <div
              role="listbox"
              aria-label="Country code"
              className="absolute left-0 top-full z-10 mt-1 max-h-52 w-full overflow-y-auto rounded-xl border-[0.6px] border-[#bfbfbf] bg-white p-1 shadow-lg"
            >
              {DIAL_COUNTRIES.map((country) => {
                const active = country.iso === selectedCountry.iso;
                return (
                  <button
                    key={country.iso}
                    type="button"
                    role="option"
                    aria-selected={active}
                    onClick={() => {
                      onCountryIsoChange(country.iso);
                      setCountryMenuOpen(false);
                    }}
                    className={cn(
                      "flex w-full items-center justify-between gap-2 rounded-lg px-2 py-2 text-left text-sm hover:bg-neutral-50",
                      active && "bg-neutral-50",
                    )}
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <span aria-hidden>{countryFlag(country.iso)}</span>
                      <span className="truncate text-neutral-900">{country.name}</span>
                    </span>
                    <span className="shrink-0 tabular-nums text-neutral-600">{country.dial}</span>
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>
        <button
          type="button"
          aria-label={keypadVisible ? "Show recent calls" : "Show keypad"}
          aria-pressed={keypadVisible}
          onClick={() => {
            if (keypadVisible) {
              onPadViewChange("recent");
              return;
            }
            onEntryModeChange("keypad");
            onPadViewChange("keypad");
          }}
          className={cn(
            "flex size-[38px] shrink-0 items-center justify-center rounded-full border-[0.6px] transition",
            keypadVisible
              ? "border-neutral-900 bg-neutral-900 text-white"
              : "border-[#bfbfbf] bg-[#f3f4f6] text-neutral-400",
          )}
        >
          <Grid3x3 className="size-[18px]" />
        </button>
      </div>

      {statusLabel &&
      statusLabel !== "Connected" &&
      statusLabel !== "Calling…" &&
      statusLabel !== "Ringing…" ? (
        <p
          className={cn(
            "mb-3 text-center text-xs",
            statusLabel === OUTBOUND_NOT_ALLOWED || statusLabel === "Choose which number to call from"
              ? "text-red-600"
              : "text-neutral-600",
          )}
        >
          {statusLabel}
        </p>
      ) : null}

      {padView === "recent" ? (
        <div className="rounded-xl border-[0.6px] border-[#bfbfbf] bg-[#fafafa] p-3">
          <p className="mb-2 text-sm font-medium text-neutral-600">Recent Calls</p>
          {recentCalls.length === 0 ? (
            <p className="py-6 text-center text-sm text-neutral-400">No recent calls</p>
          ) : (
            <ul className="max-h-64 space-y-1 overflow-y-auto">
              {recentCalls.slice(0, 5).map((call) => (
                <li key={call.id}>
                  <RecentCallRow call={call} disabled={inCall} onCall={onCallRecent} />
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <>
          {showTypedRecents ? (
            <div className="rounded-xl border-[0.6px] border-[#bfbfbf] bg-[#fafafa] p-2">
              <p className="px-1 pb-1 text-xs font-medium text-neutral-600">Recent contacts</p>
              <ul>
                {typedMatches.map((call) => (
                  <li key={call.id}>
                    <RecentCallRow call={call} disabled={inCall} onCall={onCallRecent} />
                  </li>
                ))}
              </ul>
            </div>
          ) : (
          <div className="grid grid-cols-3 gap-2">
            {DIAL_KEYS.map((digit) => (
              <button
                key={digit}
                type="button"
                onClick={() => appendDigit(digit)}
                disabled={inCall}
                className={cn(
                  "flex h-[38px] items-center justify-center rounded-full bg-[#f3f4f6] text-base font-medium text-neutral-900 transition",
                  "hover:bg-neutral-200 active:scale-[0.98]",
                  (digit === "*" || digit === "#") && "text-sm text-neutral-600",
                  inCall && "pointer-events-none opacity-40",
                )}
              >
                {digit}
              </button>
            ))}
          </div>
          )}

          {!showTypedRecents || inCall ? (
          <div className="mt-4 flex justify-center">
            {inCall ? (
              <button
                type="button"
                onClick={onHangup}
                aria-label="Hang up"
                className="flex size-12 items-center justify-center rounded-full bg-red-600 text-white transition hover:bg-red-700 active:scale-[0.98]"
              >
                <PhoneOff className="size-[18px]" />
              </button>
            ) : (
              <button
                type="button"
                disabled={!canCall}
                onClick={() => onCall(value)}
                aria-label="Call"
                className="flex size-12 items-center justify-center rounded-full border-[0.6px] border-[#bfbfbf] bg-white text-emerald-600 transition hover:bg-neutral-50 active:scale-[0.98] disabled:cursor-not-allowed disabled:text-neutral-300"
              >
                <Phone className="size-[18px]" />
              </button>
            )}
          </div>
          ) : null}
        </>
      )}

      {showFromPicker && !inCall ? (
        <div className="mt-3 space-y-1">
          <p className="px-0.5 text-xs font-medium text-neutral-600">Call from</p>
          {outboundOptions.map((option) => {
            const active = option.id === selectedOutboundId;
            return (
              <button
                key={option.id}
                type="button"
                onClick={() => onSelectOutboundId(option.id)}
                className={cn(
                  "flex w-full flex-col items-start rounded-xl border-[0.6px] px-2 py-1.5 text-left transition",
                  active
                    ? "border-neutral-900 bg-neutral-50 text-neutral-900"
                    : "border-[#bfbfbf] bg-white text-neutral-900 hover:bg-neutral-50",
                )}
              >
                <span className="truncate text-xs font-semibold">{option.label}</span>
                <span className="truncate text-[11px] text-neutral-600">
                  {option.phoneNumber}
                </span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function presencePhoneClass(state: PresenceState): string {
  const fill =
    state === "ready"
      ? "fill-emerald-500"
      : state === "after_contact_work"
        ? "fill-violet-500"
        : state === "busy"
          ? "fill-red-500"
          : state === "offline"
            ? "fill-neutral-400"
            : "fill-amber-500";
  return cn(fill, "text-[#bfbfbf]");
}

type WorkspaceDialPadTriggerProps = {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
};

export function WorkspaceDialPadTrigger({ open: openProp, onOpenChange }: WorkspaceDialPadTriggerProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const [value, setValue] = useState("");
  const [countryIso, setCountryIso] = useState(DEFAULT_COUNTRY_ISO);
  const [selectedOutboundId, setSelectedOutboundId] = useState<string | null>(null);
  const [showFromPicker, setShowFromPicker] = useState(false);
  const [padView, setPadView] = useState<DialPadView>("keypad");
  const [entryMode, setEntryMode] = useState<DialEntryMode>("keypad");
  const [recentCalls, setRecentCalls] = useState<RecentDialCall[]>([]);
  const [namedCalls, setNamedCalls] = useState<RecentDialCall[]>([]);
  const [dialedContactName, setDialedContactName] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const open = openProp ?? internalOpen;
  const { presenceState } = useAgentPresence();
  const sip = useSipCallStatus();
  const statusLabel = callStatusLabel(sip);
  const inCall = sip.callState !== "idle";
  const outboundOptions = sip.outboundOptions;
  const chooseFrom = needsOutboundChoice(outboundOptions);
  const selectedCountry =
    DIAL_COUNTRIES.find((country) => country.iso === countryIso) ??
    DIAL_COUNTRIES.find((country) => country.iso === DEFAULT_COUNTRY_ISO)!;
  const composedNumber = composeDialedNumber(selectedCountry.dial, value);
  const callingNames = dialedContactName
    ? [{ id: "matched-contact", name: dialedContactName, phone: composedNumber || value }, ...namedCalls]
    : namedCalls;

  useEffect(() => {
    if (sip.callState === "idle" || sip.direction !== "outbound") {
      setDialedContactName(null);
      return;
    }
    const lookup = phoneDigits(value);
    if (lookup.length < 7) return;
    let cancelled = false;
    void contactsApi
      .listContacts({ search: lookup, pageSize: 20 })
      .then((result) => {
        if (cancelled) return;
        const match = result.contacts.find(
          (contact) =>
            sameDialedNumber(contact.primaryPhone ?? "", composedNumber) ||
            sameDialedNumber(contact.secondaryPhone ?? "", composedNumber) ||
            sameDialedNumber(contact.primaryPhone ?? "", lookup),
        );
        const name = match?.fullName.trim() ?? "";
        setDialedContactName(
          name && /[A-Za-z]/.test(name) && !sameDialedNumber(name, lookup) ? name : null,
        );
      })
      .catch(() => {
        if (!cancelled) setDialedContactName(null);
      });
    return () => {
      cancelled = true;
    };
  }, [composedNumber, sip.callState, sip.direction, value]);

  useEffect(() => {
    if (chooseFrom) return;
    setSelectedOutboundId(outboundOptions[0]?.id ?? null);
    setShowFromPicker(false);
  }, [chooseFrom, outboundOptions]);

  function setDialOpen(next: boolean) {
    if (openProp === undefined) {
      setInternalOpen(next);
    }
    onOpenChange?.(next);
    if (!next && !inCall) {
      setValue("");
      setShowFromPicker(false);
      setPadView("keypad");
      setEntryMode("keypad");
      if (chooseFrom) setSelectedOutboundId(null);
    }
  }

  useEffect(() => {
    if (shouldAutoOpenDialPad(sip)) setDialOpen(true);
  }, [sip.callState, sip.direction]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void workspaceApi
      .listConversationSummaries()
      .then((items) => {
        if (cancelled) return;
        const seen = new Set<string>();
        const next: RecentDialCall[] = [];
        const names: RecentDialCall[] = [];
        for (const item of items) {
          if (!isVoiceChannel(item.channel)) continue;
          const phone = item.customer.phone?.trim();
          if (!phone || seen.has(phone)) continue;
          seen.add(phone);
          const call = {
            id: item.id,
            name: item.customer.name || phone,
            phone,
          };
          names.push(call);
          if (next.length < 5) next.push(call);
        }
        setRecentCalls(next);
        setNamedCalls(names);
      })
      .catch(() => {
        if (!cancelled) {
          setRecentCalls([]);
          setNamedCalls([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  function placeIfReady(number: string, outboundId: string | null) {
    const phone = outboundOptions.find((option) => option.id === outboundId)?.phoneNumber ?? null;
    void placeOutboundCall(number, phone);
  }

  function requestCall() {
    if (!composedNumber) return;
    if (outboundOptions.length === 0) {
      void placeOutboundCall(composedNumber);
      return;
    }
    if (chooseFrom && !selectedOutboundId) {
      setShowFromPicker(true);
      return;
    }
    placeIfReady(composedNumber, selectedOutboundId);
  }

  function handleSelectOutbound(id: string) {
    setSelectedOutboundId(id);
    if (composedNumber) placeIfReady(composedNumber, id);
  }

  useEffect(() => {
    if (!open) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        if (inCall) return;
        setDialOpen(false);
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        if (inCall) {
          hangupOutboundCall();
          return;
        }
        if (composedNumber) requestCall();
        return;
      }
      if (inCall) return;
      if (event.target instanceof HTMLInputElement) return;
      if (/^[0-9*#]$/.test(event.key)) {
        event.preventDefault();
        setEntryMode("typed");
        setValue((current) => (current.length < MAX_DIGITS ? `${current}${event.key}` : current));
        return;
      }
      if (event.key === "Backspace") {
        event.preventDefault();
        setValue((current) => current.slice(0, -1));
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [chooseFrom, composedNumber, inCall, open, selectedOutboundId, showFromPicker, sip.registered, value, outboundOptions]);

  return (
    <div ref={containerRef} className="relative">
      <IconButton
        className={cn(
          "text-neutral-700",
          open && "border-neutral-300 bg-neutral-50 text-neutral-800",
          inCall && "border-emerald-600 bg-emerald-50 text-emerald-700",
        )}
        aria-label="Phone"
        aria-expanded={open}
        onClick={() => setDialOpen(!open)}
      >
        <Phone className={presencePhoneClass(presenceState)} strokeWidth={1} />
      </IconButton>
      {open ? (
        <div className="absolute right-0 top-full z-50 mt-1">
          <WorkspaceDialPad
            value={value}
            onChange={setValue}
            countryIso={countryIso}
            onCountryIsoChange={setCountryIso}
            registered={sip.registered}
            callState={sip.callState}
            outboundCall={sip.direction === "outbound"}
            statusLabel={statusLabel}
            outboundOptions={outboundOptions}
            selectedOutboundId={selectedOutboundId}
            showFromPicker={showFromPicker}
            onSelectOutboundId={handleSelectOutbound}
            onCall={() => requestCall()}
            onHangup={hangupOutboundCall}
            onClose={() => setDialOpen(false)}
            padView={padView}
            onPadViewChange={setPadView}
            entryMode={entryMode}
            onEntryModeChange={setEntryMode}
            recentCalls={recentCalls}
            namedCalls={callingNames}
            onCallRecent={(phone) => {
              setValue(recentNumberForInput(phone, selectedCountry.dial));
              setPadView("keypad");
              const destination = recentCallDestination(phone, selectedCountry.dial);
              if (!destination) return;
              if (outboundOptions.length === 0) {
                void placeOutboundCall(destination);
                return;
              }
              if (chooseFrom && !selectedOutboundId) {
                setShowFromPicker(true);
                return;
              }
              placeIfReady(destination, selectedOutboundId);
            }}
          />
        </div>
      ) : null}
    </div>
  );
}