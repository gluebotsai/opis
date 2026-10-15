import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { searchMeetingParticipants } from "@/services/contacts";
import { normalizeEmailList } from "@/lib/meeting-body";

const SEARCH_DEBOUNCE_MS = 200;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function MeetingParticipantsField({
  label = "Participants",
  primaryEmail,
  primaryLabel,
  emails,
  onEmailsChange,
  disabled,
}: {
  label?: string;
  primaryEmail: string;
  primaryLabel: string;
  emails: string[];
  onEmailsChange: (emails: string[]) => void;
  disabled?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [results, setResults] = useState<
    Array<{ id: string; displayName: string; email: string; detail: string }>
  >([]);
  const requestId = useRef(0);
  const blurTimer = useRef<number | null>(null);

  const primary = primaryEmail.trim().toLowerCase();
  const extraEmails = normalizeEmailList(emails).filter((e) => e !== primary);

  useEffect(() => {
    if (!open || disabled) {
      setResults([]);
      return;
    }
    const handle = window.setTimeout(() => {
      const id = ++requestId.current;
      setPending(true);
      void searchMeetingParticipants(query)
        .then((items) => {
          if (id !== requestId.current) return;
          setResults(items);
        })
        .finally(() => {
          if (id === requestId.current) setPending(false);
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(handle);
  }, [query, open, disabled]);

  function addEmail(raw: string) {
    const email = raw.trim().toLowerCase();
    if (!EMAIL_RE.test(email) || email === primary) return;
    if (extraEmails.includes(email)) return;
    onEmailsChange([...extraEmails, email]);
    setQuery("");
    setOpen(false);
  }

  function removeEmail(email: string) {
    onEmailsChange(extraEmails.filter((e) => e !== email));
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      if (query.trim()) addEmail(query);
    }
    if (e.key === "Backspace" && !query && extraEmails.length > 0) {
      removeEmail(extraEmails[extraEmails.length - 1]);
    }
  }

  const showDropdown =
    open &&
    !disabled &&
    (pending || results.length > 0 || query.trim().length > 0);

  return (
    <div className="flex w-full flex-col gap-2">
      <label className="text-sm font-medium text-text-primary">{label}</label>
      <div className="rounded-lg border border-border-default bg-surface px-3 py-2">
        <div className="flex flex-wrap gap-1.5">
          <span className="inline-flex items-center gap-1 rounded-full bg-violet-0 px-2.5 py-1 text-xs font-medium text-brand">
            {primaryLabel}
            <span className="text-[10px] font-normal text-text-caption">
              ({primary})
            </span>
          </span>
          {extraEmails.map((email) => (
            <span
              key={email}
              className="inline-flex items-center gap-1 rounded-full bg-subtle px-2.5 py-1 text-xs text-text-primary"
            >
              {email}
              {!disabled ? (
                <button
                  type="button"
                  className="inline-flex size-4 items-center justify-center rounded-full text-text-caption hover:bg-surface hover:text-text-primary"
                  onClick={() => removeEmail(email)}
                  aria-label={`Remove ${email}`}
                >
                  <X className="size-3" />
                </button>
              ) : null}
            </span>
          ))}
          {!disabled ? (
            <div className="relative min-w-[140px] flex-1">
              <input
                type="text"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setOpen(true);
                }}
                onFocus={() => {
                  if (blurTimer.current) {
                    window.clearTimeout(blurTimer.current);
                    blurTimer.current = null;
                  }
                  setOpen(true);
                }}
                onBlur={() => {
                  blurTimer.current = window.setTimeout(() => setOpen(false), 180);
                }}
                onKeyDown={handleKeyDown}
                placeholder="Add email or search contacts and teammates…"
                disabled={disabled}
                className="h-7 w-full min-w-[140px] bg-transparent text-sm text-text-primary outline-none placeholder:text-text-placeholder"
              />
              {showDropdown ? (
                <ul className="absolute top-full right-0 left-0 z-40 mt-1 max-h-40 overflow-y-auto rounded-lg border border-border-default bg-surface py-1 shadow-lg">
                  {pending && results.length === 0 ? (
                    <li className="px-3 py-2 text-xs text-text-caption">
                      Searching…
                    </li>
                  ) : null}
                  {query.trim() && EMAIL_RE.test(query.trim().toLowerCase()) ? (
                    <li>
                      <button
                        type="button"
                        className="flex w-full px-3 py-2 text-left text-sm text-text-primary hover:bg-subtle"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => addEmail(query)}
                      >
                        Add {query.trim().toLowerCase()}
                      </button>
                    </li>
                  ) : null}
                  {results
                    .filter(
                      (c) =>
                        c.email.trim().toLowerCase() !== primary &&
                        !extraEmails.includes(c.email.trim().toLowerCase()),
                    )
                    .map((contact) => (
                      <li key={contact.id}>
                        <button
                          type="button"
                          className="flex w-full flex-col gap-0.5 px-3 py-2 text-left hover:bg-subtle"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => addEmail(contact.email)}
                        >
                          <span className="text-sm font-medium text-text-primary">
                            {contact.displayName}
                          </span>
                          <span className="text-xs text-text-caption">
                            {contact.detail} · {contact.email}
                          </span>
                        </button>
                      </li>
                    ))}
                  {!pending &&
                  results.length === 0 &&
                  !EMAIL_RE.test(query.trim().toLowerCase()) ? (
                    <li className="px-3 py-2 text-xs text-text-caption">
                      Type an email, or search customers and teammates
                    </li>
                  ) : null}
                </ul>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
      <p className="text-xs text-text-caption">
        Primary contact is always included. Search customers or any teammate,
        or type an email, then press Enter.
      </p>
    </div>
  );
}
