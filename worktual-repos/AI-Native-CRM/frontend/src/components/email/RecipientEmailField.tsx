import { useState } from "react";
import type { ComposeContactOption } from "@/components/email/types";

export function RecipientEmailField({
  toEmail,
  onToEmailChange,
  selectedContact,
  onSelectContact,
  contacts,
  disabled,
}: {
  toEmail: string;
  onToEmailChange: (value: string) => void;
  selectedContact?: ComposeContactOption | null;
  onSelectContact?: (contact: ComposeContactOption | null) => void;
  /** Full contact list to filter client-side (no debounced server search in Fastify port). */
  contacts: ComposeContactOption[];
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);

  const trimmed = toEmail.trim();
  const isExactSelected =
    Boolean(selectedContact) &&
    trimmed.toLowerCase() === selectedContact!.email.trim().toLowerCase();

  const results = trimmed
    ? contacts
        .filter(
          (c) =>
            c.email &&
            (c.displayName.toLowerCase().includes(trimmed.toLowerCase()) ||
              c.email.toLowerCase().includes(trimmed.toLowerCase())),
        )
        .slice(0, 8)
    : contacts.filter((c) => c.email).slice(0, 8);

  const showDropdown =
    open && onSelectContact && !disabled && !isExactSelected;

  function pickContact(contact: ComposeContactOption) {
    onSelectContact?.(contact);
    onToEmailChange(contact.email);
    setOpen(false);
  }

  return (
    <div className="space-y-0">
      <label className="flex items-center gap-3 px-4 py-2.5 sm:px-5">
        <span className="w-14 shrink-0 text-xs text-text-caption">To</span>
        <div className="relative min-w-0 flex-1">
          <input
            type="text"
            inputMode="email"
            autoComplete="off"
            name="crm-compose-to"
            data-1p-ignore
            data-lpignore="true"
            data-form-type="other"
            value={toEmail}
            onChange={(e) => {
              const value = e.target.value;
              onToEmailChange(value);
              setOpen(true);
              if (
                selectedContact &&
                value.trim().toLowerCase() !==
                  selectedContact.email.trim().toLowerCase()
              ) {
                onSelectContact?.(null);
              }
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => window.setTimeout(() => setOpen(false), 150)}
            placeholder="Type a name, email, or anyone@example.com"
            disabled={disabled}
            className="w-full bg-transparent text-sm text-text-primary outline-none placeholder:text-text-placeholder disabled:opacity-60"
          />

          {showDropdown ? (
            <ul className="absolute top-full right-0 left-0 z-30 mt-1 max-h-44 overflow-y-auto rounded-lg border border-border-default bg-surface py-1 shadow-lg">
              {results.length === 0 ? (
                <li className="px-3 py-3 text-center text-xs text-text-caption">
                  {trimmed.length > 0
                    ? "No matching contacts — press send to email this address"
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
                        {contact.email}
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
