import { Check, Mail, PanelRightClose, Phone, ShieldCheck, UserRound } from "lucide-react";

import { PanelExpandButton } from "@/components/assistant/copilot-workspace";
import { IconButton } from "@/components/ui/button";
import { PanelScrollArea } from "@/components/ui/panel-scroll-area";
import {
  ASSISTANT_CANCEL_CONTACT_PREVIEW,
  ASSISTANT_CONFIRM_CONTACT,
  type ContactConfirmation,
} from "@/features/assistant/assistant-api";
import { contactAvatarClassName, contactInitials } from "@/features/contacts/contacts-utils";
import { cn } from "@/lib/utils";
import { contentPanel } from "@/lib/panel-chrome";

const FIELD_LABELS: Record<string, string> = {
  firstName: "First name",
  lastName: "Last name",
  primaryEmail: "Primary email",
  primaryPhone: "Primary phone",
  secondaryEmail: "Secondary email",
  secondaryPhone: "Secondary phone",
  gender: "Gender",
  dateOfBirth: "Date of birth",
  company: "Company",
  industry: "Industry",
  city: "City",
  region: "Region",
  country: "Country",
  language: "Language",
  timezone: "Timezone",
  customFields: "Custom fields",
  isActive: "Status",
};

function displayName(contact: Record<string, unknown>) {
  const fullName = typeof contact.fullName === "string" ? contact.fullName : "";
  if (fullName) return fullName;
  const name = [contact.firstName, contact.lastName]
    .filter((value): value is string => typeof value === "string" && Boolean(value.trim()))
    .join(" ");
  return name || String(contact.primaryEmail ?? "New contact");
}

function previewEntries(confirmation: ContactConfirmation) {
  const source = confirmation.preview.contact;
  const rows: Array<readonly [string, string, unknown]> = [];
  for (const key of Object.keys(FIELD_LABELS)) {
    if (key === "customFields") {
      const fields = source.customFields;
      if (!fields || typeof fields !== "object" || Array.isArray(fields)) continue;
      for (const [name, item] of Object.entries(fields)) {
        const label = name.trim();
        if (!label || label === "isActive" || label === "industry") continue;
        if (item === undefined || item === null || item === "" || typeof item === "object") continue;
        rows.push([`customFields:${label}`, label, item]);
      }
      continue;
    }
    rows.push([key, FIELD_LABELS[key] ?? key, source[key]]);
  }
  return rows;
}

export function ContactOperationPreview({
  confirmation,
  onClose,
}: {
  confirmation: ContactConfirmation;
  onClose: () => void;
}) {
  const contact = confirmation.preview.contact;
  const mode = confirmation.preview.mode;
  const name = displayName(contact);
  const entries = previewEntries(confirmation);

  function confirm() {
    window.dispatchEvent(
      new CustomEvent(ASSISTANT_CONFIRM_CONTACT, { detail: { id: confirmation.id } }),
    );
  }

  function cancel() {
    window.dispatchEvent(new CustomEvent(ASSISTANT_CANCEL_CONTACT_PREVIEW));
    onClose();
  }

  return (
    <div className={contentPanel("animate-in fade-in duration-300")}>
      <div className="shrink-0 border-b-[0.6px] border-[#bfbfbf] bg-gradient-to-br from-white to-neutral-50 px-5 py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <p className="text-xs font-medium text-neutral-600">Contact preview</p>
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                  mode === "create"
                    ? "bg-emerald-50 text-emerald-700"
                    : "bg-amber-50 text-amber-700",
                )}
              >
                {mode}
              </span>
            </div>
            <h2 className="mt-1 truncate text-xl font-semibold tracking-tight text-neutral-900">
              {name}
            </h2>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <PanelExpandButton side="right" />
            <IconButton onClick={cancel} aria-label="Close contact preview">
              <PanelRightClose className="size-4" />
            </IconButton>
          </div>
        </div>
      </div>

      <PanelScrollArea className="min-h-0 flex-1">
        <div className="space-y-5 px-5 py-5">
          <div className="flex items-start gap-3">
            <div className={contactAvatarClassName(String(contact.id ?? name), "size-12 text-sm")}>
              {contactInitials(name)}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-base font-semibold text-neutral-900">{name}</p>
              {contact.primaryEmail ? (
                <p className="mt-1 flex items-center gap-1.5 truncate text-sm text-neutral-600">
                  <Mail className="size-3.5 shrink-0 text-neutral-900" />
                  {String(contact.primaryEmail)}
                </p>
              ) : null}
              {contact.primaryPhone ? (
                <p className="mt-1 flex items-center gap-1.5 truncate text-sm text-neutral-600">
                  <Phone className="size-3.5 shrink-0 text-neutral-900" />
                  {String(contact.primaryPhone)}
                </p>
              ) : null}
            </div>
          </div>

          <div>
            <div className="mb-2 flex items-center gap-2">
              <UserRound className="size-3.5 text-neutral-900" />
              <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-900">
                Contact fields
              </p>
            </div>
            <dl className="divide-y divide-[#bfbfbf] overflow-hidden rounded-xl border-[0.6px] border-[#bfbfbf]">
              {entries.map(([key, label, value]) => (
                <div
                  key={key}
                  className="grid grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] gap-3 px-3 py-2.5 text-sm"
                >
                  <dt className="truncate text-neutral-600">{label}</dt>
                  <dd className="break-words font-medium text-neutral-900">
                    {key === "isActive"
                      ? value === undefined
                        ? "Not provided"
                        : value
                          ? "Active"
                          : "Inactive"
                      : value === undefined
                        ? "Not provided"
                      : value === null
                        ? "Clear value"
                        : String(value)}
                  </dd>
                </div>
              ))}
            </dl>
          </div>

          <div className="flex items-start gap-2 rounded-xl bg-neutral-50 px-3.5 py-3 text-xs leading-relaxed text-neutral-600">
            <ShieldCheck className="mt-0.5 size-4 shrink-0 text-neutral-900" />
            <p>No changes are written until you confirm. This operation is tenant-scoped and audited.</p>
          </div>
        </div>
      </PanelScrollArea>

      <div className="flex shrink-0 items-center justify-end gap-2 border-t-[0.6px] border-[#bfbfbf] px-5 py-3">
        <button
          type="button"
          onClick={cancel}
          className="h-9 rounded-lg border-[0.6px] border-[#bfbfbf] bg-white px-3.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={confirm}
          className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-neutral-900 px-4 text-xs font-semibold text-white hover:bg-neutral-800"
        >
          <Check className="size-3.5" />
          {mode === "create" ? "Create contact" : "Apply changes"}
        </button>
      </div>
    </div>
  );
}
