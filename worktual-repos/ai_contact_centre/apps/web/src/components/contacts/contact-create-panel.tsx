import { useState } from "react";
import { ArrowLeft, LoaderCircle, X } from "lucide-react";

import { PanelExpandButton } from "@/components/assistant/copilot-workspace";
import { ContactCreateForm } from "@/components/contacts/contact-create-form";
import { Button, IconButton } from "@/components/ui/button";
import { PanelScrollArea } from "@/components/ui/panel-scroll-area";
import { StatusBanner } from "@/components/ui/status-banner";
import { contactsApi } from "@/features/contacts/api";
import { contentPanelClassName, contentPanelHeaderBorderClassName } from "@/lib/panel-chrome";
import {
  buildContactCreateInput,
  emptyContactForm,
  type ContactFormState,
} from "@/features/contacts/contacts-utils";
import type { CdpContact } from "@/features/contacts/types";

type ContactCreatePanelProps = {
  onClose: () => void;
  onCreated: (contact: CdpContact) => void;
};

function createFormSnapshot(form: ContactFormState, notes: string) {
  return JSON.stringify({ form, notes });
}

export function ContactCreatePanel({ onClose, onCreated }: ContactCreatePanelProps) {
  const [form, setForm] = useState<ContactFormState>(() => emptyContactForm());
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  function patchForm(patch: Partial<ContactFormState>) {
    setForm((current) => ({ ...current, ...patch }));
    setSaveError(null);
  }

  function handleClose() {
    const dirty =
      createFormSnapshot(form, notes) !==
      createFormSnapshot(emptyContactForm(), "");
    if (dirty && !window.confirm("Discard this new contact?")) {
      return;
    }
    onClose();
  }

  async function handleCreate() {
    setSaving(true);
    setSaveError(null);
    try {
      const trimmedNotes = notes.trim();
      const input = {
        ...buildContactCreateInput(form),
        ...(trimmedNotes ? { customFields: { notes: trimmedNotes } } : {}),
      };
      const { contact } = await contactsApi.createContact(input);
      onCreated(contact);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Failed to create contact");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={contentPanelClassName}>
      <div className={`flex shrink-0 items-center justify-between gap-2 px-4 py-3 ${contentPanelHeaderBorderClassName}`}>
        <div className="flex min-w-0 items-center gap-2">
          <IconButton onClick={handleClose} className="shrink-0" aria-label="Back to contacts">
            <ArrowLeft className="size-4" />
          </IconButton>
          <h2 className="truncate text-sm font-semibold text-neutral-900">New contact</h2>
        </div>
        <div className="flex items-center gap-2">
          <PanelExpandButton side="right" />
          <IconButton onClick={handleClose} aria-label="Close">
            <X className="size-4" />
          </IconButton>
        </div>
      </div>

      {saveError ? (
        <div className="mx-4 mt-3 shrink-0">
          <StatusBanner tone="error">{saveError}</StatusBanner>
        </div>
      ) : null}

      <PanelScrollArea className="min-h-0 flex-1">
        <div className="space-y-4 px-4 py-4">
          <p className="text-sm text-neutral-600">
            First name and primary email are required. Other fields are optional.
          </p>
          <ContactCreateForm
            form={form}
            notes={notes}
            onPatch={patchForm}
            onNotesChange={setNotes}
          />
        </div>
      </PanelScrollArea>

      <div className="flex shrink-0 items-center justify-end gap-2 border-t-[0.6px] border-[#bfbfbf] px-4 py-3">
        <Button variant="outline" onClick={handleClose} disabled={saving}>
          Cancel
        </Button>
        <Button onClick={() => void handleCreate()} disabled={saving}>
          {saving ? <LoaderCircle className="size-3.5 animate-spin" /> : null}
          Create contact
        </Button>
      </div>
    </div>
  );
}
