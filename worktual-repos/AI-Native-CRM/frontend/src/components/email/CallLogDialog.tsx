import { useEffect, useState } from "react";
import type { ComposeContactOption } from "@/components/email/types";
import { RecipientPhoneField } from "@/components/email/RecipientPhoneField";
import { Button } from "@/components/ui/Button";
import { Textarea } from "@/components/ui/Textarea";
import { createContactActivity, searchContactsForCompose } from "@/services/contacts";
import { createDealActivity } from "@/services/sales";
import { resolveContactForPhone } from "@/services/inbox";

export function CallLogDialog({
  onClose,
  onLogged,
  initialContact,
  initialPhone = "",
  dealId = null,
}: {
  onClose: () => void;
  /** Called after the call activity is logged successfully, before onClose. */
  onLogged?: () => void;
  initialContact?: ComposeContactOption | null;
  initialPhone?: string;
  /** When set, log the call on the deal instead of the contact. */
  dealId?: string | null;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [phone, setPhone] = useState(initialPhone || initialContact?.phone || "");
  const [selectedContact, setSelectedContact] = useState<ComposeContactOption | null>(
    initialContact ?? null,
  );
  const [notes, setNotes] = useState("");
  const [contacts, setContacts] = useState<ComposeContactOption[]>(
    initialContact ? [initialContact] : [],
  );

  useEffect(() => {
    let cancelled = false;
    void searchContactsForCompose().then((items) => {
      if (cancelled) return;
      setContacts((prev) => {
        const merged = [...prev];
        for (const item of items) {
          if (!merged.some((c) => c.id === item.id)) merged.push(item);
        }
        return merged;
      });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function onCall() {
    setError(null);
    if (!phone.trim()) {
      setError("Enter a phone number.");
      return;
    }

    setPending(true);
    let resolvedId = selectedContact?.id ?? null;
    if (!resolvedId && !dealId) {
      const result = await resolveContactForPhone(phone);
      if (!result.ok) {
        setPending(false);
        setError(result.error);
        return;
      }
      resolvedId = result.contactId;
    }

    const label = selectedContact?.displayName ?? phone.trim();
    const body = notes.trim() || `Called ${label}`;
    const subject = `Outbound call — ${label}`;

    const result = dealId
      ? await createDealActivity(dealId, { type: "call", subject, body })
      : await createContactActivity(resolvedId!, {
          type: "call",
          subject,
          body,
          folder: "inbox",
        });

    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }

    const tel = phone.trim().replace(/[^\d+]/g, "");
    if (tel) {
      window.location.href = `tel:${tel}`;
    }
    onLogged?.();
    onClose();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-border-default bg-surface p-5 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-base font-semibold text-text-primary">New call log</h3>
        <p className="mt-1 text-sm text-text-caption">
          Dial any number or pick an existing contact
        </p>

        <div className="mt-4 overflow-hidden rounded-xl border border-border-default">
          <RecipientPhoneField
            phone={phone}
            onPhoneChange={setPhone}
            selectedContact={selectedContact}
            onSelectContact={setSelectedContact}
            contacts={contacts}
            disabled={pending}
          />
        </div>

        <div className="mt-3">
          <Textarea
            label="Notes (optional)"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Log call purpose or outcome…"
            rows={3}
            disabled={pending}
          />
        </div>

        {error ? <p className="mt-3 text-sm text-text-danger">{error}</p> : null}

        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="button" variant="primary" onClick={() => void onCall()} disabled={pending}>
            {pending ? "Calling…" : "Save log"}
          </Button>
        </div>
      </div>
    </div>
  );
}
