import { Pencil } from "lucide-react";
import type { ContactDraftFields } from "@/services/agents.socket";
import {
  contactDisplayName,
  type ContactItem,
} from "@/services/contacts.service";
import {
  contactListAvatarClass,
  contactListInitials,
} from "@/components/contacts/ContactsSummaryPanel";
import {
  ContactPushPanel,
  type ContactPushFormValues,
} from "@/components/contacts/ContactPushFields";

function customField(
  row: ContactItem | null | undefined,
  ...keys: string[]
): string | null {
  const cf = row?.custom_fields;
  if (!cf || typeof cf !== "object") return null;
  for (const key of keys) {
    const raw = cf[key];
    if (typeof raw === "string" && raw.trim()) return raw.trim();
    if (typeof raw === "number" && Number.isFinite(raw)) return String(raw);
  }
  return null;
}

function fieldValue(
  draft: ContactDraftFields,
  detail: ContactItem | null | undefined,
  key: "phone" | "email" | "city" | "company_name",
  agentDraftOverlay: boolean,
): string | null {
  const draftVal =
    key === "phone"
      ? draft.phone
      : key === "email"
        ? draft.email
        : key === "city"
          ? draft.city
          : draft.company_name;
  const fromDraft = String(draftVal ?? "").trim();
  const fromDetail = String(detail?.[key] ?? "").trim();
  // Saved contact wins when browsing the list; chat draft overlays only for focused edit.
  if (agentDraftOverlay && fromDraft) return fromDraft;
  if (fromDetail) return fromDetail;
  return fromDraft || null;
}

function CrmDetailField({
  label,
  value,
}: {
  label: string;
  value?: string | null;
}) {
  const text = value?.trim();
  return (
    <div className="min-w-0">
      <p className="text-xs text-neutral-500">{label}</p>
      <p
        className={`mt-1 break-words text-sm [overflow-wrap:anywhere] ${
          text ? "font-semibold text-neutral-900" : "text-neutral-400"
        }`}
      >
        {text || "—"}
      </p>
    </div>
  );
}

export type ContactCrmProfilePanelProps = {
  draft: ContactDraftFields;
  detail: ContactItem | null | undefined;
  b2c?: boolean;
  onEdit?: () => void;
  appPush?: ContactItem["app_push"];
  webPush?: ContactItem["web_push"];
  pushEditable?: boolean;
  pushForm?: ContactPushFormValues;
  onPushFormChange?: (next: ContactPushFormValues) => void;
  onPushSave?: () => void | boolean | Promise<void | boolean>;
  pushSaving?: boolean;
  pushError?: string | null;
  pushSaveDisabled?: boolean;
  /** When true, show co-worker draft fields over saved contact (same contact in focus). */
  agentDraftOverlay?: boolean;
};

export function ContactCrmProfilePanel({
  draft,
  detail,
  agentDraftOverlay = false,
  onEdit,
  appPush,
  webPush,
  pushEditable = false,
  pushForm,
  onPushFormChange,
  onPushSave,
  pushSaving = false,
  pushError = null,
  pushSaveDisabled = false,
}: ContactCrmProfilePanelProps) {
  const first = String(
    (agentDraftOverlay ? draft.first_name : detail?.first_name ?? draft.first_name) ??
      "",
  ).trim();
  const last = String(
    (agentDraftOverlay ? draft.last_name : detail?.last_name ?? draft.last_name) ??
      "",
  ).trim();
  const profileName =
    first ||
    last ||
    (detail ? contactDisplayName(detail) : "Contact");
  const displayForAvatar =
    [first, last].filter(Boolean).join(" ") || profileName;
  const seed = detail?.id || displayForAvatar;

  const primaryPhone = fieldValue(draft, detail, "phone", agentDraftOverlay);
  const primaryEmail = fieldValue(draft, detail, "email", agentDraftOverlay);
  const hasChannel = Boolean(primaryPhone || primaryEmail);

  const industry =
    customField(detail, "industry") ||
    fieldValue(draft, detail, "company_name", agentDraftOverlay);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div
          className={`inline-flex size-14 shrink-0 items-center justify-center rounded-full text-base font-semibold ${contactListAvatarClass(seed)}`}
        >
          {contactListInitials(displayForAvatar)}
        </div>
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          <h2 className="text-lg font-semibold tracking-tight text-neutral-900">
            {profileName}
          </h2>
          {hasChannel ? (
            <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-800">
              Active
            </span>
          ) : null}
        </div>
      </div>

      <section className="rounded-2xl border-[0.6px] border-[#bfbfbf] bg-white p-5 shadow-none">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h3 className="text-base font-semibold text-neutral-900">Details</h3>
            <p className="mt-0.5 text-sm text-neutral-500">
              Reachability and profile fields
            </p>
          </div>
          {onEdit ? (
            <button
              type="button"
              className="inline-flex size-[38px] shrink-0 items-center justify-center rounded-lg text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900"
              aria-label="Edit contact"
              onClick={onEdit}
            >
              <Pencil className="size-[18px]" strokeWidth={2.25} />
            </button>
          ) : null}
        </div>

        <div className="mt-5 grid gap-x-10 gap-y-5 sm:grid-cols-2">
          <CrmDetailField label="Primary phone" value={primaryPhone} />
          <CrmDetailField label="Primary email" value={primaryEmail} />
          <CrmDetailField
            label="Secondary phone"
            value={customField(detail, "secondary_phone", "secondaryPhone")}
          />
          <CrmDetailField
            label="Secondary email"
            value={customField(detail, "secondary_email", "secondaryEmail")}
          />
          <CrmDetailField
            label="Gender"
            value={customField(detail, "gender")}
          />
          <CrmDetailField
            label="Date of birth"
            value={customField(detail, "date_of_birth", "dob", "dateOfBirth")}
          />
          <CrmDetailField label="Industry" value={industry} />
          <CrmDetailField
            label="City"
            value={fieldValue(draft, detail, "city", agentDraftOverlay)}
          />
          <CrmDetailField
            label="Region"
            value={customField(detail, "region", "state", "region_state")}
          />
          <CrmDetailField
            label="Country"
            value={customField(detail, "country")}
          />
          <CrmDetailField
            label="Language"
            value={customField(detail, "language")}
          />
          <CrmDetailField
            label="Timezone"
            value={customField(detail, "timezone", "time_zone")}
          />
        </div>

        {pushForm && onPushFormChange && onPushSave ? (
          <ContactPushPanel
            embedded
            showSectionTitle
            className="mt-5 border-t border-[#bfbfbf]/80 pt-5"
            appPush={appPush}
            webPush={webPush}
            editable={pushEditable}
            values={pushForm}
            onChange={onPushFormChange}
            saving={pushSaving}
            error={pushError}
            saveDisabled={pushSaveDisabled}
            onSave={onPushSave}
          />
        ) : null}
      </section>
    </div>
  );
}
