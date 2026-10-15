import { useEffect } from "react";
import { AlertTriangle, LoaderCircle, X } from "lucide-react";

import { StatusBanner } from "@/components/ui/status-banner";
import { contactPreviewDisplayName } from "@/features/contacts/contacts-utils";
import type { CdpContact } from "@/features/contacts/types";

type ContactDeleteConfirmDialogProps = {
  contact: CdpContact | null;
  deleting: boolean;
  onClose: () => void;
  onConfirm: () => void;
};

export function ContactDeleteConfirmDialog({
  contact,
  deleting,
  onClose,
  onConfirm,
}: ContactDeleteConfirmDialogProps) {
  useEffect(() => {
    if (!contact) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !deleting) onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [contact, deleting, onClose]);

  if (!contact) return null;

  const displayName = contactPreviewDisplayName(contact);

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/35 p-4"
      role="presentation"
      onClick={deleting ? undefined : onClose}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="contact-delete-title"
        aria-describedby="contact-delete-description"
        className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-red-50 text-red-600">
              <AlertTriangle className="size-5" />
            </span>
            <div>
              <h2 id="contact-delete-title" className="text-base font-semibold text-neutral-900">
                Delete contact?
              </h2>
              <p id="contact-delete-description" className="mt-1 text-sm text-neutral-600">
                <span className="font-medium text-neutral-900">{displayName}</span> will be removed
                from your active contacts list. Conversation history is kept, but this profile will
                no longer appear in search or lists.
              </p>
            </div>
          </div>
          <button
            type="button"
            aria-label="Close dialog"
            disabled={deleting}
            onClick={onClose}
            className="grid size-8 shrink-0 place-items-center rounded-lg text-neutral-600 hover:bg-neutral-100 disabled:opacity-50"
          >
            <X className="size-4" />
          </button>
        </div>

        <StatusBanner tone="warning" className="mt-4">
          This action cannot be undone from the contacts list. You can recreate the contact later if
          needed.
        </StatusBanner>

        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            disabled={deleting}
            onClick={onClose}
            className="h-9 rounded-lg border-[0.6px] border-[#bfbfbf] px-4 text-sm font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={deleting}
            onClick={onConfirm}
            className="inline-flex h-9 items-center gap-2 rounded-lg bg-red-600 px-4 text-sm font-medium text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {deleting ? <LoaderCircle className="size-4 animate-spin" /> : null}
            Delete contact
          </button>
        </div>
      </div>
    </div>
  );
}
