import type { ReactNode } from "react";

import {
  contactInputClassName,
  ContactLocationSelects,
  ContactTimezoneSelect,
} from "@/components/contacts/contact-form-fields";
import { ContactPhoneField } from "@/components/contacts/contact-phone-field";
import { NativeSelect } from "@/components/ui/native-select";
import {
  contactAvatarClassName,
  contactInitials,
  formatContactDate,
  formatPersonalDisplayName,
  formatUpdatedAt,
  type ContactFormState,
} from "@/features/contacts/contacts-utils";
import { StatusToggle } from "@/features/workforce/queues/status-toggle";
import { cn } from "@/lib/utils";

const NOTES_MAX_LENGTH = 500;

const fieldGroupClassName = "grid w-full gap-[16px]";

const GENDER_OPTIONS = ["Female", "Male", "Other", "Prefer not to say"];

function FormSection({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-xl border-[0.6px] border-[#bfbfbf] bg-white px-5 py-5">
      <div>
        <h3 className="text-base font-semibold text-neutral-900">{title}</h3>
        <p className="mt-1 text-sm text-neutral-600">{description}</p>
      </div>
      <div className="mt-4 w-full">{children}</div>
    </section>
  );
}

function FieldLabel({
  children,
  required,
}: {
  children: ReactNode;
  required?: boolean;
}) {
  return (
    <span className="flex items-center gap-1.5 text-sm font-medium text-neutral-900">
      {children}
      {required ? <span className="text-red-500">*</span> : null}
    </span>
  );
}

function TextField({
  id,
  label,
  value,
  onChange,
  type = "text",
  placeholder,
  required,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: "text" | "email" | "tel" | "date";
  placeholder?: string;
  required?: boolean;
}) {
  return (
    <label htmlFor={id} className="block min-w-0 space-y-2">
      <FieldLabel required={required}>
        {label}
      </FieldLabel>
      <input
        id={id}
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        required={required}
        className={contactInputClassName}
      />
    </label>
  );
}

type ContactCreateFormProps = {
  form: ContactFormState;
  notes: string;
  onPatch: (patch: Partial<ContactFormState>) => void;
  onNotesChange: (notes: string) => void;
  avatarKey?: string;
  idPrefix?: string;
  updatedAt?: string;
};

export function ContactCreateForm({
  form,
  notes,
  onPatch,
  onNotesChange,
  avatarKey = "new-contact",
  idPrefix = "create",
  updatedAt,
}: ContactCreateFormProps) {
  const hasPersonalName = Boolean(form.firstName.trim() || form.lastName.trim());
  const personalName = formatPersonalDisplayName(form.firstName, form.lastName);

  return (
    <div className="space-y-[16px]">
      <div className="flex items-start gap-4 rounded-xl border-[0.6px] border-[#bfbfbf] bg-white px-5 py-4">
        <div className={contactAvatarClassName(avatarKey, "size-12 text-sm")}>
          {contactInitials(personalName || "New contact")}
        </div>
        <div className="min-w-0 flex-1">
          <p
            className={cn(
              "text-[18px] font-semibold break-words",
              hasPersonalName ? "text-neutral-900" : "text-neutral-400",
            )}
          >
            {hasPersonalName ? personalName : "New contact"}
          </p>
          {!hasPersonalName ? (
            <p className="mt-0.5 text-sm text-neutral-600">Add first and last name below</p>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-row items-center gap-3">
          <StatusToggle
            checked={form.blocked}
            compact
            showLabel
            checkedLabel="Blocked"
            uncheckedLabel="Unblocked"
            ariaLabel="Block contact"
            onChange={(status) => onPatch({ blocked: status === "active" })}
          />
          <StatusToggle
            checked={form.isActive}
            compact
            showLabel
            ariaLabel="Contact status"
            onChange={(status) => onPatch({ isActive: status === "active" })}
          />
        </div>
      </div>

      <FormSection
        title="Personal details"
        description="Add the basic information about this contact."
      >
        <div className={`${fieldGroupClassName} grid-cols-1 sm:grid-cols-2`}>
          <TextField
            id={`${idPrefix}-first-name`}
            label="First name"
            value={form.firstName}
            required
            onChange={(firstName) => onPatch({ firstName })}
            placeholder="First name"
          />
          <TextField
            id={`${idPrefix}-last-name`}
            label="Last name"
            value={form.lastName}
            onChange={(lastName) => onPatch({ lastName })}
            placeholder="Last name"
          />
          <div className="min-w-0 space-y-2">
            <FieldLabel>Gender</FieldLabel>
            <NativeSelect
              id={`${idPrefix}-gender`}
              value={form.gender}
              onChange={(event) => onPatch({ gender: event.target.value })}
              className="h-[38px] rounded-lg bg-white text-neutral-800 focus:ring-2 focus:ring-neutral-200"
            >
              <option value="">Gender</option>
              {form.gender && !GENDER_OPTIONS.includes(form.gender) ? (
                <option value={form.gender}>{form.gender}</option>
              ) : null}
              {GENDER_OPTIONS.map((gender) => (
                <option key={gender} value={gender}>
                  {gender}
                </option>
              ))}
            </NativeSelect>
          </div>
          <TextField
            id={`${idPrefix}-date-of-birth`}
            label="Date of birth"
            value={form.dateOfBirth}
            onChange={(dateOfBirth) => onPatch({ dateOfBirth })}
            type="date"
          />
        </div>
      </FormSection>

      <FormSection
        title="Contact information"
        description="Add the ways to contact this person."
      >
        <div className={`${fieldGroupClassName} grid-cols-1 sm:grid-cols-2`}>
          <TextField
            id={`${idPrefix}-primary-email`}
            label="Primary email"
            value={form.primaryEmail}
            onChange={(primaryEmail) => onPatch({ primaryEmail })}
            placeholder="name@company.com"
            type="email"
            required
          />
          <ContactPhoneField
            id={`${idPrefix}-primary-phone`}
            label="Primary phone"
            value={form.primaryPhone}
            onChange={(primaryPhone) => onPatch({ primaryPhone })}
            placeholder="Phone number"
          />
          <ContactPhoneField
            id={`${idPrefix}-secondary-phone`}
            label="Secondary phone"
            value={form.secondaryPhone}
            onChange={(secondaryPhone) => onPatch({ secondaryPhone })}
            placeholder="WhatsApp or secondary phone"
          />
          <TextField
            id={`${idPrefix}-secondary-email`}
            label="Secondary email"
            value={form.secondaryEmail}
            onChange={(secondaryEmail) => onPatch({ secondaryEmail })}
            placeholder="Secondary email"
            type="email"
          />
        </div>
      </FormSection>

      <FormSection
        title="Organization"
        description="Add organization details associated with this contact."
      >
        <div className={`${fieldGroupClassName} grid-cols-1 sm:grid-cols-2`}>
          <TextField
            id={`${idPrefix}-company`}
            label="Company"
            value={form.company}
            onChange={(company) => onPatch({ company })}
            placeholder="Company"
          />
          <TextField
            id={`${idPrefix}-industry`}
            label="Industry"
            value={form.industry}
            onChange={(industry) => onPatch({ industry })}
            placeholder="Industry"
          />
        </div>
      </FormSection>

      <FormSection
        title="Location"
        description="Add the location details."
      >
        <ContactLocationSelects
          country={form.country}
          region={form.region}
          city={form.city}
          idPrefix={idPrefix}
          renderLabel={(label) => <FieldLabel>{label}</FieldLabel>}
          onChange={(next) => onPatch(next)}
        />
      </FormSection>

      <FormSection
        title="Locale"
        description="Add the language and timezone for this contact."
      >
        <div className={`${fieldGroupClassName} grid-cols-1 sm:grid-cols-2`}>
          <TextField
            id={`${idPrefix}-language`}
            label="Language"
            value={form.language}
            onChange={(language) => onPatch({ language })}
            placeholder="Language"
          />
          <div className="min-w-0 space-y-2">
            <FieldLabel>Timezone</FieldLabel>
            <ContactTimezoneSelect
              id={`${idPrefix}-timezone`}
              value={form.timezone}
              onChange={(timezone) => onPatch({ timezone })}
            />
          </div>
        </div>
      </FormSection>

      <FormSection
        title="Additional notes"
        description="Add any additional notes about this contact."
      >
        <div className="w-full space-y-2">
          <textarea
            id={`${idPrefix}-notes`}
            value={notes}
            onChange={(event) => onNotesChange(event.target.value.slice(0, NOTES_MAX_LENGTH))}
            placeholder="Write a note (optional)"
            rows={5}
            className={cn(
              contactInputClassName,
              "min-h-[132px] resize-y py-3 leading-relaxed",
            )}
          />
          <p className="text-right text-xs text-neutral-400">
            {notes.length} / {NOTES_MAX_LENGTH}
          </p>
        </div>
      </FormSection>

      {updatedAt ? (
        <p className="px-1 text-xs text-neutral-400">
          Last updated {formatUpdatedAt(updatedAt)} · {formatContactDate(updatedAt)}
        </p>
      ) : null}
    </div>
  );
}

export { NOTES_MAX_LENGTH };
