import { useEffect, useState } from "react";
import { ChevronLeft, LoaderCircle, Pencil, Phone } from "lucide-react";

import { PanelExpandButton } from "@/components/assistant/copilot-workspace";
import { ContactCreateForm } from "@/components/contacts/contact-create-form";
import { ContactProfileRecords } from "@/components/contacts/contact-profile-records";
import { ContactRecentActivities } from "@/components/contacts/contact-recent-activities";
import { Button, IconButton } from "@/components/ui/button";
import { PanelScrollArea } from "@/components/ui/panel-scroll-area";
import {
  PROFILE_EMPTY_FACT,
  ProfileFact,
  ProfileFactGrid,
  ProfileSection,
} from "@/components/ui/profile-detail-row";
import { StatusBanner } from "@/components/ui/status-banner";
import { OmniChannelSummaryText } from "@/components/workspace/workspace-omni-channel-summary";
import { contactsApi } from "@/features/contacts/api";
import { useOmniChannelSummary } from "@/features/workspace/use-omni-channel-summary";
import { formatConversationTime } from "@/features/workspace/workspace-utils";
import { contentPanelClassName, contentPanelHeaderBorderClassName } from "@/lib/panel-chrome";
import {
  buildContactUpdateInput,
  contactAvatarClassName,
  contactDisplayName,
  contactFormFromContact,
  contactInitials,
  contactPreviewDisplayName,
  additionalContactFields,
  formatContactDate,
  type ContactFormState,
} from "@/features/contacts/contacts-utils";
import type { CdpContact } from "@/features/contacts/types";
import { useCopilotPage } from "@/features/assistant/copilot-page-context";
import { contactOutboundNumber } from "@/features/voice/sip-outbound";
import { getSipCallStatus, placeOutboundCall } from "@/features/voice/sip-ua";
import { cn } from "@/lib/utils";

type ContactDetailPanelProps = {
  contact: CdpContact | null;
  loading: boolean;
  error: string | null;
  onClose: () => void;
  onSaved?: (contact: CdpContact) => void;
  initialEditing?: boolean;
};

function formatFactValue(value: string | null | undefined): string {
  const trimmed = value?.trim();
  return trimmed ? trimmed : PROFILE_EMPTY_FACT;
}

function formatOptionalDate(value: string | null | undefined): string {
  if (!value?.trim()) return PROFILE_EMPTY_FACT;
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return formatFactValue(value);
  return formatContactDate(value);
}

function formatSourceSystem(source: string | null | undefined): string {
  if (!source?.trim()) return PROFILE_EMPTY_FACT;
  return source
    .trim()
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase())
    .replace(/\bWhatsapp\b/g, "WhatsApp");
}

function contactNotesFromCustomFields(customFields: Record<string, unknown>): string {
  const notes = customFields.notes;
  return typeof notes === "string" ? notes : "";
}

function editFormSnapshot(form: ContactFormState, notes: string): string {
  return JSON.stringify({ form, notes });
}

function ContactPreview({ contact }: { contact: CdpContact }) {
  const previewName = contactPreviewDisplayName(contact);
  const [callError, setCallError] = useState<string | null>(null);
  const additionalFields = additionalContactFields(contact.customFields);

  const {
    summary: omniChannelSummary,
    updatedAt: omniChannelSummaryUpdatedAt,
  } = useOmniChannelSummary(contact.id);
  const omniSummary = omniChannelSummary?.trim() ?? "";
  const companyLine = [contact.company, contact.industry].filter(Boolean).join(" · ");
  const detailFacts = [
    { label: "Primary phone", value: formatFactValue(contact.primaryPhone) },
    { label: "Primary email", value: formatFactValue(contact.primaryEmail) },
    { label: "Secondary phone", value: formatFactValue(contact.secondaryPhone) },
    { label: "Secondary email", value: formatFactValue(contact.secondaryEmail) },
    { label: "Gender", value: formatFactValue(contact.gender) },
    { label: "Date of birth", value: formatOptionalDate(contact.dateOfBirth) },
    { label: "Industry", value: formatFactValue(contact.industry) },
    { label: "City", value: formatFactValue(contact.city) },
    { label: "Region", value: formatFactValue(contact.region) },
    { label: "Country", value: formatFactValue(contact.country) },
    { label: "Language", value: formatFactValue(contact.language) },
    { label: "Timezone", value: formatFactValue(contact.timezone) },
  ];

  return (
    <>
      <div className="flex items-center gap-3">
        <div className={contactAvatarClassName(contact.id, "size-12 shrink-0 text-sm")}>
          {contactInitials(previewName)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate text-[18px] font-semibold text-neutral-900">{previewName}</p>
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-[11px] font-semibold",
                contact.isActive
                  ? "bg-emerald-50 text-emerald-700"
                  : "bg-neutral-100 text-neutral-600",
              )}
            >
              {contact.isActive ? "Active" : "Inactive"}
            </span>
            {contact.blocked ? (
              <span className="rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-semibold text-red-700">
                Blocked
              </span>
            ) : null}
          </div>
          {companyLine ? (
            <p className="mt-0.5 truncate text-sm text-neutral-600">{companyLine}</p>
          ) : null}
        </div>
        <Button
          type="button"
          variant="outline"
          className="ml-auto hidden shrink-0"
          onClick={() => {
            const number =
              contactOutboundNumber(contact.primaryPhone) ??
              contactOutboundNumber(contact.secondaryPhone);
            if (!number) {
              setCallError("There is no valid number for this contact to call.");
              return;
            }
            setCallError(null);
            const from = getSipCallStatus().outboundOptions[0]?.phoneNumber ?? null;
            void placeOutboundCall(number, from).then(() => {
              const error = getSipCallStatus().error;
              if (error) setCallError(error);
            });
          }}
        >
          <Phone className="size-[18px]" strokeWidth={2.25} aria-hidden="true" />
          Call
        </Button>
      </div>
      {callError ? <p className="text-sm text-red-600">{callError}</p> : null}

      <ProfileSection title="Details" description="Reachability and profile fields">
        <ProfileFactGrid>
          {detailFacts.map((fact) => (
            <ProfileFact key={fact.label} label={fact.label} value={fact.value} />
          ))}
        </ProfileFactGrid>
      </ProfileSection>

      {additionalFields.length > 0 ? (
        <ProfileSection title="Additional information" description="Custom details saved on this contact">
          <ProfileFactGrid>
            {additionalFields.map((field) => (
              <ProfileFact key={field.key} label={field.label} value={field.value} wrap />
            ))}
          </ProfileFactGrid>
        </ProfileSection>
      ) : null}

      <div className={omniSummary ? "space-y-4" : undefined}>
        <ProfileSection title="System" description="Record source and lifecycle">
          <ProfileFactGrid>
            <ProfileFact label="Source" value={formatSourceSystem(contact.sourceSystem)} />
            <ProfileFact label="Created" value={formatContactDate(contact.createdAt)} />
            <ProfileFact label="Updated" value={formatContactDate(contact.updatedAt)} />
          </ProfileFactGrid>
        </ProfileSection>

        {omniSummary ? (
          <ProfileSection
            title="Omni channel summary"
            description={
              omniChannelSummaryUpdatedAt
                ? `Updated ${formatConversationTime(omniChannelSummaryUpdatedAt)}`
                : "Across this customer's conversations"
            }
          >
            <OmniChannelSummaryText summary={omniSummary} />
          </ProfileSection>
        ) : null}
      </div>

      <ContactProfileRecords contactId={contact.id} />

      <ContactRecentActivities contactId={contact.id} contactName={previewName} />
    </>
  );
}

export function ContactDetailPanel({
  contact,
  loading,
  error,
  onClose,
  onSaved,
  initialEditing = false,
}: ContactDetailPanelProps) {
  const { setRecordLabel } = useCopilotPage();
  const [isEditing, setIsEditing] = useState(false);
  const [form, setForm] = useState<ContactFormState | null>(null);
  const [notes, setNotes] = useState("");
  const [initialSnapshot, setInitialSnapshot] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    setIsEditing(initialEditing);
    if (!contact) {
      setForm(null);
      setNotes("");
      setInitialSnapshot("");
      return;
    }
    const nextForm = contactFormFromContact(contact);
    const nextNotes = contactNotesFromCustomFields(contact.customFields);
    setForm(nextForm);
    setNotes(nextNotes);
    setInitialSnapshot(editFormSnapshot(nextForm, nextNotes));
    setSaveError(null);
  }, [contact, initialEditing]);

  const dirty = form ? editFormSnapshot(form, notes) !== initialSnapshot : false;
  const headerTitle = isEditing ? "Edit contact" : "Customer profile";
  const recordName = contact
    ? contactPreviewDisplayName(contact)
    : form
      ? contactDisplayName(form)
      : undefined;

  useEffect(() => {
    setRecordLabel(
      !recordName || recordName === "Unknown contact" ? undefined : recordName,
    );
    return () => setRecordLabel(undefined);
  }, [recordName, setRecordLabel]);

  function patchForm(patch: Partial<ContactFormState>) {
    setForm((current) => (current ? { ...current, ...patch } : current));
    setSaveError(null);
  }

  function resetFormFromContact() {
    if (!contact) return;
    const nextForm = contactFormFromContact(contact);
    const nextNotes = contactNotesFromCustomFields(contact.customFields);
    setForm(nextForm);
    setNotes(nextNotes);
    setInitialSnapshot(editFormSnapshot(nextForm, nextNotes));
    setSaveError(null);
  }

  function handleClose() {
    if (isEditing && dirty && !window.confirm("You have unsaved changes. Discard them and leave?")) {
      return;
    }
    onClose();
  }

  function handleCancelEdit() {
    if (dirty && !window.confirm("Discard unsaved changes?")) {
      return;
    }
    resetFormFromContact();
    setIsEditing(false);
  }

  function handleStartEdit() {
    resetFormFromContact();
    setIsEditing(true);
  }

  async function handleSave() {
    if (!contact || !form) return;
    setSaving(true);
    setSaveError(null);
    try {
      const trimmedNotes = notes.trim();
      const customFields = { ...contact.customFields };
      if (trimmedNotes) {
        customFields.notes = trimmedNotes;
      } else {
        delete customFields.notes;
      }
      const { contact: saved } = await contactsApi.updateContact(contact.id, {
        ...buildContactUpdateInput(form),
        customFields,
      });
      const savedForm = contactFormFromContact(saved);
      const savedNotes = contactNotesFromCustomFields(saved.customFields);
      setForm(savedForm);
      setNotes(savedNotes);
      setInitialSnapshot(editFormSnapshot(savedForm, savedNotes));
      setIsEditing(false);
      onSaved?.(saved);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Failed to save contact");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={contentPanelClassName}>
      <div className={`flex shrink-0 items-center justify-between gap-2 px-4 py-3 ${contentPanelHeaderBorderClassName}`}>
        <div className="flex min-w-0 items-center gap-2">
          <IconButton
            variant="ghostIcon"
            onClick={isEditing ? handleCancelEdit : handleClose}
            className="shrink-0 [&_svg]:size-[18px]"
            aria-label={isEditing ? "Back to contact profile" : "Back to contacts"}
          >
            <ChevronLeft />
          </IconButton>
          <div className="min-w-0">
            <h2 className="truncate text-[18px] font-semibold text-neutral-900">{headerTitle}</h2>
            {isEditing ? (
              <p className="mt-0.5 truncate text-sm text-neutral-600">Update contact details</p>
            ) : null}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {isEditing ? (
            <>
              {dirty ? (
                <Button onClick={() => void handleSave()} disabled={saving || loading || !form}>
                  {saving ? <LoaderCircle className="size-3.5 animate-spin" /> : null}
                  Save
                </Button>
              ) : null}
              <Button variant="secondary" onClick={handleCancelEdit} disabled={saving}>
                Cancel
              </Button>
            </>
          ) : (
            <IconButton onClick={handleStartEdit} aria-label="Edit contact" disabled={loading || !contact}>
              <Pencil />
            </IconButton>
          )}
          <PanelExpandButton side="right" />
        </div>
      </div>

      {error ? (
        <div className="mx-4 mt-3 shrink-0">
          <StatusBanner tone="error">{error}</StatusBanner>
        </div>
      ) : null}

      {saveError ? (
        <div className="mx-4 mt-3 shrink-0">
          <StatusBanner tone="error">{saveError}</StatusBanner>
        </div>
      ) : null}

      {loading ? (
        <div className="flex flex-1 items-center justify-center gap-2 text-sm text-neutral-600">
          <LoaderCircle className="size-4 animate-spin" />
          Loading contact…
        </div>
      ) : !contact || !form ? (
        <div className="flex flex-1 items-center justify-center px-6 text-sm text-neutral-600">
          Contact not found.
        </div>
      ) : (
        <PanelScrollArea className="min-h-0 flex-1">
          <div className="space-y-[16px] px-4 py-4">
            {isEditing ? (
              <ContactCreateForm
                form={form}
                notes={notes}
                onPatch={patchForm}
                onNotesChange={(value) => {
                  setNotes(value);
                  setSaveError(null);
                }}
                avatarKey={contact.id}
                idPrefix="edit"
                updatedAt={contact.updatedAt}
              />
            ) : (
              <ContactPreview contact={contact} />
            )}
          </div>
        </PanelScrollArea>
      )}
    </div>
  );
}
