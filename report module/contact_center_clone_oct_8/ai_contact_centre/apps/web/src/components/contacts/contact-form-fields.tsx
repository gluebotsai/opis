import type { ReactNode } from "react";
import { Building2, Clock, Globe2, Mail, MapPin, Phone } from "lucide-react";

import { MenuSelect } from "@/components/ui/menu-select";
import { NativeSelect } from "@/components/ui/native-select";
import {
  CONTACT_LOCATION_COUNTRIES,
  OTHER_LOCATION,
  isPresetCountry,
  locationCities,
  locationStates,
} from "@/features/contacts/contact-location";
import {
  contactAvatarClassName,
  contactDisplayName,
  contactInitials,
  formatContactDate,
  formatUpdatedAt,
  type ContactFormState,
} from "@/features/contacts/contacts-utils";
import { StatusToggle } from "@/features/workforce/queues/status-toggle";

export const contactInputClassName =
  "h-[38px] w-full rounded-lg border-[0.6px] border-[#bfbfbf] bg-white px-3 text-[14px] text-neutral-800 outline-none placeholder:text-neutral-600 focus:border-neutral-400 focus:ring-2 focus:ring-neutral-200";

const CONTACT_TIMEZONE_PRESETS = [
  "Asia/Kolkata",
  "Asia/Dubai",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Asia/Seoul",
  "Europe/London",
  "Europe/Dublin",
  "Europe/Paris",
  "Europe/Berlin",
  "Europe/Madrid",
  "Europe/Oslo",
  "America/New_York",
  "America/Chicago",
  "America/Los_Angeles",
  "America/Toronto",
  "America/Lima",
  "Australia/Sydney",
  "UTC",
] as const;

const CONTACT_TIMEZONE_OTHER = "Other";

export function ContactLocationSelects({
  country,
  region,
  city,
  onChange,
  idPrefix,
  renderLabel,
}: {
  country: string;
  region: string;
  city: string;
  onChange: (next: { country?: string; region?: string; city?: string }) => void;
  idPrefix: string;
  renderLabel: (label: string) => ReactNode;
}) {
  const presetCountry = isPresetCountry(country);
  const countrySelectValue =
    country.length > 0 && !presetCountry ? OTHER_LOCATION : country;
  const customCountry = countrySelectValue === OTHER_LOCATION;
  const stateNames = locationStates(country).map((state) => state.name);
  const cityNames = locationCities(country, region);
  const stateDisabled = !presetCountry;
  const cityDisabled = !presetCountry || !region || !stateNames.includes(region);

  return (
    <div className="grid w-full gap-[16px] grid-cols-1 sm:grid-cols-3">
      <div className="min-w-0 space-y-2">
        {renderLabel("Country")}
        <MenuSelect
          id={`${idPrefix}-country`}
          ariaLabel="Country"
          placeholder="Country"
          value={countrySelectValue}
          options={[
            ...CONTACT_LOCATION_COUNTRIES.map((row) => ({ value: row.name, label: row.name })),
            { value: OTHER_LOCATION, label: OTHER_LOCATION },
          ]}
          onChange={(value) => {
            if (value === OTHER_LOCATION) {
              onChange({ country: presetCountry || !country ? "" : country, region: "", city: "" });
              return;
            }
            onChange({ country: value, region: "", city: "" });
          }}
        />
        {customCountry ? (
          <input
            type="text"
            value={country}
            onChange={(event) => onChange({ country: event.target.value })}
            placeholder="Enter country"
            className={contactInputClassName}
          />
        ) : null}
      </div>
      <div className="min-w-0 space-y-2">
        {renderLabel("Region / State")}
        {customCountry ? (
          <input
            type="text"
            value={region}
            onChange={(event) => onChange({ region: event.target.value, city: "" })}
            placeholder="Region"
            className={contactInputClassName}
          />
        ) : (
          <MenuSelect
            id={`${idPrefix}-region`}
            ariaLabel="Region / State"
            placeholder={stateDisabled ? "Select country first" : "Region / State"}
            value={stateNames.includes(region) ? region : ""}
            disabled={stateDisabled}
            options={stateNames.map((name) => ({ value: name, label: name }))}
            onChange={(value) => onChange({ region: value, city: "" })}
          />
        )}
      </div>
      <div className="min-w-0 space-y-2">
        {renderLabel("City")}
        {customCountry ? (
          <input
            type="text"
            value={city}
            onChange={(event) => onChange({ city: event.target.value })}
            placeholder="City"
            className={contactInputClassName}
          />
        ) : (
          <MenuSelect
            id={`${idPrefix}-city`}
            ariaLabel="City"
            placeholder={cityDisabled ? "Select state first" : "City"}
            value={cityNames.includes(city) ? city : ""}
            disabled={cityDisabled}
            options={cityNames.map((name) => ({ value: name, label: name }))}
            onChange={(value) => onChange({ city: value })}
          />
        )}
      </div>
    </div>
  );
}

export function ContactTimezoneSelect({
  id,
  value,
  onChange,
}: {
  id: string;
  value: string;
  onChange: (timezone: string) => void;
}) {
  const isCustom =
    value.length > 0 && !(CONTACT_TIMEZONE_PRESETS as readonly string[]).includes(value);
  const selectValue = isCustom ? CONTACT_TIMEZONE_OTHER : value;

  return (
    <div className="space-y-2">
      <NativeSelect
        id={id}
        value={selectValue}
        onChange={(event) => {
          const next = event.target.value;
          if (next === CONTACT_TIMEZONE_OTHER) {
            onChange(isCustom ? value : "");
            return;
          }
          onChange(next);
        }}
        className="h-[38px] rounded-lg bg-white text-neutral-800 focus:ring-2 focus:ring-neutral-200"
      >
        <option value="">Timezone</option>
        {CONTACT_TIMEZONE_PRESETS.map((timezone) => (
          <option key={timezone} value={timezone}>
            {timezone}
          </option>
        ))}
        <option value={CONTACT_TIMEZONE_OTHER}>{CONTACT_TIMEZONE_OTHER}</option>
      </NativeSelect>
      {selectValue === CONTACT_TIMEZONE_OTHER ? (
        <input
          type="text"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder="Enter timezone"
          className={contactInputClassName}
        />
      ) : null}
    </div>
  );
}

function FieldLabel({ children }: { children: ReactNode }) {
  return (
    <span className="text-[10px] font-medium uppercase tracking-[0.1em] text-neutral-600">
      {children}
    </span>
  );
}

function EditableField({
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
  type?: "text" | "email" | "tel";
  placeholder?: string;
  required?: boolean;
}) {
  return (
    <label htmlFor={id} className="block space-y-1.5">
      <FieldLabel>
        {label}
        {required ? " *" : null}
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

function EditDetailRow({
  icon: Icon,
  label,
  children,
}: {
  icon: typeof Phone;
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-start gap-3">
      <Icon className="mt-0.5 size-3.5 shrink-0 text-neutral-900" />
      <div className="min-w-0 flex-1">
        <FieldLabel>{label}</FieldLabel>
        <div className="mt-1.5">{children}</div>
      </div>
    </div>
  );
}

type ContactFormFieldsProps = {
  form: ContactFormState;
  onPatch: (patch: Partial<ContactFormState>) => void;
  avatarKey: string;
  updatedAt?: string;
};

export function ContactFormFields({
  form,
  onPatch,
  avatarKey,
  updatedAt,
}: ContactFormFieldsProps) {
  const displayName = contactDisplayName(form);

  return (
    <>
      <div className="flex items-start gap-3">
        <div className={contactAvatarClassName(avatarKey, "size-12 text-sm")}>
          {contactInitials(displayName)}
        </div>
        <div className="min-w-0 flex-1 space-y-3">
          <StatusToggle
            checked={form.isActive}
            compact
            showLabel
            onChange={(status) => onPatch({ isActive: status === "active" })}
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <EditableField
              id="edit-contact-first-name"
              label="First name"
              value={form.firstName}
              onChange={(firstName) => onPatch({ firstName })}
              placeholder="First name"
            />
            <EditableField
              id="edit-contact-last-name"
              label="Last name"
              value={form.lastName}
              onChange={(lastName) => onPatch({ lastName })}
              placeholder="Last name"
            />
          </div>
        </div>
      </div>

      <div className="space-y-4 rounded-xl border-[0.6px] border-[#bfbfbf] bg-white px-3 py-3">
        <EditDetailRow icon={Mail} label="Primary email">
          <input
            type="email"
            value={form.primaryEmail}
            onChange={(event) => onPatch({ primaryEmail: event.target.value })}
            placeholder="name@company.com"
            className={contactInputClassName}
          />
        </EditDetailRow>
        <EditDetailRow icon={Phone} label="Primary phone">
          <input
            type="tel"
            value={form.primaryPhone}
            onChange={(event) => onPatch({ primaryPhone: event.target.value })}
            placeholder="Phone number"
            className={contactInputClassName}
          />
        </EditDetailRow>
        <EditDetailRow icon={Phone} label="Secondary phone">
          <input
            type="tel"
            value={form.secondaryPhone}
            onChange={(event) => onPatch({ secondaryPhone: event.target.value })}
            placeholder="WhatsApp or secondary phone"
            className={contactInputClassName}
          />
        </EditDetailRow>
        <EditDetailRow icon={Mail} label="Secondary email">
          <input
            type="email"
            value={form.secondaryEmail}
            onChange={(event) => onPatch({ secondaryEmail: event.target.value })}
            placeholder="Secondary email"
            className={contactInputClassName}
          />
        </EditDetailRow>
        <EditDetailRow icon={Building2} label="Company">
          <div className="grid gap-3 sm:grid-cols-2">
            <input
              type="text"
              value={form.company}
              onChange={(event) => onPatch({ company: event.target.value })}
              placeholder="Company"
              className={contactInputClassName}
            />
            <input
              type="text"
              value={form.industry}
              onChange={(event) => onPatch({ industry: event.target.value })}
              placeholder="Industry"
              className={contactInputClassName}
            />
          </div>
        </EditDetailRow>
        <EditDetailRow icon={MapPin} label="Location">
          <ContactLocationSelects
            country={form.country}
            region={form.region}
            city={form.city}
            idPrefix="edit-contact"
            renderLabel={(label) => <FieldLabel>{label}</FieldLabel>}
            onChange={(next) => onPatch(next)}
          />
        </EditDetailRow>
        <EditDetailRow icon={Globe2} label="Locale">
          <div className="grid gap-3 sm:grid-cols-2">
            <input
              type="text"
              value={form.language}
              onChange={(event) => onPatch({ language: event.target.value })}
              placeholder="Language"
              className={contactInputClassName}
            />
            <ContactTimezoneSelect
              id="edit-contact-timezone"
              value={form.timezone}
              onChange={(timezone) => onPatch({ timezone })}
            />
          </div>
        </EditDetailRow>
        {!updatedAt ? null : (
          <EditDetailRow icon={Clock} label="Updated">
            <p className="text-sm text-neutral-800">
              {formatUpdatedAt(updatedAt)} · {formatContactDate(updatedAt)}
            </p>
          </EditDetailRow>
        )}
      </div>
    </>
  );
}
