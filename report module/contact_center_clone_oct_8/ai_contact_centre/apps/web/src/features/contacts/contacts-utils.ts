import {
  isPhoneLikeDisplayName,
  profileAvatarClassName as contactAvatarClassName,
  profileAvatarTone as contactAvatarTone,
  profileInitials as contactInitials,
} from "@/lib/avatar-utils";
import { resolveContactDisplayName } from "@/lib/contact-display-name";

import type {
  CdpContact,
  ContactCreateInput,
  ContactListStats,
  ContactUpdateInput,
} from "./types";

export { contactAvatarClassName, contactAvatarTone, contactInitials };

export type ContactFormState = {
  firstName: string;
  lastName: string;
  primaryEmail: string;
  primaryPhone: string;
  secondaryEmail: string;
  secondaryPhone: string;
  gender: string;
  dateOfBirth: string;
  company: string;
  industry: string;
  city: string;
  region: string;
  country: string;
  language: string;
  timezone: string;
  isActive: boolean;
  blocked: boolean;
};

const READ_ONLY_CUSTOM_FIELD_KEYS = new Set(["isActive"]);

export function emptyContactForm(): ContactFormState {
  return {
    firstName: "",
    lastName: "",
    primaryEmail: "",
    primaryPhone: "",
    secondaryEmail: "",
    secondaryPhone: "",
    gender: "",
    dateOfBirth: "",
    company: "",
    industry: "",
    city: "",
    region: "",
    country: "",
    language: "",
    timezone: "",
    isActive: true,
    blocked: false,
  };
}

export function contactFormFromContact(contact: CdpContact): ContactFormState {
  return {
    firstName: contact.firstName ?? "",
    lastName: contact.lastName ?? "",
    primaryEmail: contact.primaryEmail ?? "",
    primaryPhone: contact.primaryPhone ?? "",
    secondaryEmail: contact.secondaryEmail ?? "",
    secondaryPhone: contact.secondaryPhone ?? "",
    gender: contact.gender ?? "",
    dateOfBirth: contact.dateOfBirth?.slice(0, 10) ?? "",
    company: contact.company ?? "",
    industry: contact.industry ?? "",
    city: contact.city ?? "",
    region: contact.region ?? "",
    country: contact.country ?? "",
    language: contact.language ?? "",
    timezone: contact.timezone ?? "",
    isActive: contact.isActive,
    blocked: contact.blocked ?? false,
  };
}

export function contactFormSnapshot(form: ContactFormState): string {
  return JSON.stringify(form);
}

export function isWhatsAppContact(contact: CdpContact): boolean {
  const source = contact.sourceSystem?.toLowerCase() ?? "";
  if (source === "whatsapp" || source.startsWith("inbound_whatsapp")) return true;
  return contact.customFields.inboundChannel === "whatsapp";
}

/** Capitalize the first letter of each word for display. Leaves emails and phones unchanged. */
export function formatShownContactName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed || trimmed.includes("@") || isPhoneLikeDisplayName(trimmed)) {
    return trimmed;
  }
  return trimmed.replace(/\S+/g, (word) => word.charAt(0).toUpperCase() + word.slice(1));
}

export function contactPreviewDisplayName(contact: CdpContact): string {
  return formatShownContactName(resolveContactDisplayName(contact));
}

function titleCaseNameSegment(segment: string): string {
  if (!segment) return segment;
  return segment.charAt(0).toUpperCase() + segment.slice(1).toLowerCase();
}

function titleCaseNameWord(word: string): string {
  return word
    .split(/([-'])/)
    .map((part) => (part === "-" || part === "'" ? part : titleCaseNameSegment(part)))
    .join("");
}

/** Title-case first/last name for display (e.g. "john doe" → "John Doe"). */
export function formatPersonalDisplayName(firstName: string, lastName: string): string {
  return [firstName, lastName]
    .map((part) =>
      part
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .map(titleCaseNameWord)
        .join(" "),
    )
    .filter(Boolean)
    .join(" ");
}

export function contactDisplayName(form: Pick<ContactFormState, "firstName" | "lastName" | "primaryEmail" | "primaryPhone">) {
  const parts = [form.firstName.trim(), form.lastName.trim()].filter(Boolean);
  if (parts.length > 0) return parts.join(" ");
  if (form.primaryEmail.trim()) return form.primaryEmail.trim();
  if (form.primaryPhone.trim()) return form.primaryPhone.trim();
  return "Unknown contact";
}

function contactPhonesMatch(left: string, right: string): boolean {
  const digits = (value: string) => {
    const numeric = value.replace(/\D/g, "");
    return numeric.startsWith("00") ? numeric.slice(2) : numeric;
  };
  const first = digits(left);
  const second = digits(right);
  if (!first || !second) return false;
  if (first === second) return true;
  const [shorter, longer] = first.length <= second.length ? [first, second] : [second, first];
  if (shorter.length < 10 || !longer.endsWith(shorter)) return false;
  const prefix = longer.slice(0, longer.length - shorter.length);
  return prefix.length >= 1 && prefix.length <= 3;
}

export function buildContactCreateInput(form: ContactFormState): ContactCreateInput {
  const primaryEmail = form.primaryEmail.trim();
  if (!primaryEmail) {
    throw new Error("Primary email is required");
  }
  return {
    ...buildContactUpdateInput(form),
    primaryEmail,
  };
}

export function buildContactUpdateInput(form: ContactFormState): ContactUpdateInput {
  const trim = (value: string) => value.trim();
  const primaryEmail = trim(form.primaryEmail);
  const secondaryEmail = trim(form.secondaryEmail);
  const primaryPhone = trim(form.primaryPhone);
  const secondaryPhone = trim(form.secondaryPhone);
  if (primaryEmail && secondaryEmail && primaryEmail.toLowerCase() === secondaryEmail.toLowerCase()) {
    throw new Error("Primary email and secondary email must be different.");
  }
  if (contactPhonesMatch(primaryPhone, secondaryPhone)) {
    throw new Error("Primary phone and secondary phone must be different.");
  }
  return {
    firstName: trim(form.firstName) || null,
    lastName: trim(form.lastName) || null,
    primaryEmail: primaryEmail || undefined,
    primaryPhone: primaryPhone || null,
    secondaryEmail: secondaryEmail || null,
    secondaryPhone: secondaryPhone || null,
    gender: trim(form.gender) || null,
    dateOfBirth: trim(form.dateOfBirth) || null,
    company: trim(form.company) || null,
    industry: trim(form.industry) || null,
    city: trim(form.city) || null,
    region: trim(form.region) || null,
    country: trim(form.country) || null,
    language: trim(form.language) || null,
    timezone: trim(form.timezone) || null,
    isActive: form.isActive,
    blocked: form.blocked,
  };
}

export function readOnlyCustomFields(customFields: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(customFields).filter(([key]) => READ_ONLY_CUSTOM_FIELD_KEYS.has(key)),
  );
}

export function contactLocation(contact: CdpContact) {
  return [contact.city, contact.region, contact.country].filter(Boolean).join(", ");
}

export function formatContactDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function formatUpdatedAt(iso: string) {
  const date = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60_000);

  if (diffMin < 1) return "Just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffMin < 24 * 60) return `${Math.floor(diffMin / 60)}h ago`;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function contactDialPhone(contact: CdpContact): string | null {
  const phone = contact.primaryPhone?.trim() || contact.secondaryPhone?.trim();
  return phone || null;
}

export function isContactProfileComplete(contact: CdpContact): boolean {
  const customName =
    typeof contact.customFields.customerName === "string"
      ? contact.customFields.customerName.trim()
      : typeof contact.customFields.displayName === "string"
        ? contact.customFields.displayName.trim()
        : "";
  const hasName = Boolean(
    contact.firstName?.trim() ||
      contact.lastName?.trim() ||
      customName ||
      (contact.fullName?.trim() && contact.fullName.trim() !== "Unknown contact"),
  );
  const hasReachability = Boolean(contact.primaryEmail?.trim() || contact.primaryPhone?.trim());
  return hasName && hasReachability;
}

export function contactStats(contacts: CdpContact[]): ContactListStats {
  return {
    total: contacts.length,
    active: contacts.filter((contact) => contact.isActive).length,
    completeProfile: contacts.filter(isContactProfileComplete).length,
  };
}

export function attributeEntries(value: Record<string, unknown>) {
  return Object.entries(value).filter(([, entry]) => entry !== null && entry !== "");
}
