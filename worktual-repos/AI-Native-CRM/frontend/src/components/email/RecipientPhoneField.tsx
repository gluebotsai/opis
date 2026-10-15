import { useState } from "react";
import type { ComposeContactOption } from "@/components/email/types";

function phoneDigits(value: string): string {
  return value.replace(/\D/g, "");
}

export function RecipientPhoneField({
  phone,
  onPhoneChange,
  selectedContact,
  onSelectContact,
  contacts,
  disabled,
}: {
  phone: string;
  onPhoneChange: (value: string) => void;
  selectedContact?: ComposeContactOption | null;
  onSelectContact?: (contact: ComposeContactOption | null) => void;
  contacts: ComposeContactOption[];
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);

  const trimmed = phone.trim();
  const isExactSelected =
    Boolean(selectedContact?.phone) &&
    phoneDigits(trimmed) === phoneDigits(selectedContact!.phone!);

  const results = trimmed
    ? contacts
        .filter(
          (c) =>
            c.displayName.toLowerCase().includes(trimmed.toLowerCase()) ||
            (c.phone && phoneDigits(c.phone).includes(phoneDigits(trimmed))),
        )
        .slice(0, 8)
    : contacts.filter((c) => c.phone).slice(0, 8);

  const showDropdown =
    open && onSelectContact && !disabled && !isExactSelected;

  function pickContact(contact: ComposeContactOption) {
    onSelectContact?.(contact);
    if (contact.phone) {
      onPhoneChange(contact.phone);
    }
    setOpen(false);
  }

  return (
    <div className="space-y-0">
      <label className="flex items-center gap-3 px-4 py-2.5 sm:px-5">
        <span className="w-14 shrink-0 text-xs text-text-caption">To</span>
        <div className="relative min-w-0 flex-1">
          <input
            type="tel"
            inputMode="tel"
            autoComplete="off"
            value={phone}
            onChange={(e) => {
              const value = e.target.value;
              onPhoneChange(value);
              setOpen(true);
              if (
                selectedContact?.phone &&
                phoneDigits(value) !== phoneDigits(selectedContact.phone)
              ) {
                onSelectContact?.(null);
              }
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => window.setTimeout(() => setOpen(false), 150)}
            placeholder="Type a name or phone number"
            disabled={disabled}
            className="w-full bg-transparent text-sm text-text-primary outline-none placeholder:text-text-placeholder disabled:opacity-60"
          />

          {showDropdown ? (
            <ul className="absolute top-full right-0 left-0 z-30 mt-1 max-h-44 overflow-y-auto rounded-lg border border-border-default bg-surface py-1 shadow-lg">
              {results.length === 0 ? (
                <li className="px-3 py-3 text-center text-xs text-text-caption">
                  {trimmed.length > 0
                    ? "No matching contacts — press Call to dial this number"
                    : "No contacts found"}
                </li>
              ) : (
                results.map((contact) => (
                  <li key={contact.id}>
                    <button
                      type="button"
                      className="flex w-full flex-col gap-0.5 px-3 py-2 text-left hover:bg-subtle"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => pickContact(contact)}
                    >
                      <span className="truncate text-sm font-medium text-text-primary">
                        {contact.displayName}
                      </span>
                      <span className="truncate text-xs text-text-caption">
                        {contact.phone || "No phone on file"}
                      </span>
                    </button>
                  </li>
                ))
              )}
            </ul>
          ) : null}
        </div>
      </label>
    </div>
  );
}
