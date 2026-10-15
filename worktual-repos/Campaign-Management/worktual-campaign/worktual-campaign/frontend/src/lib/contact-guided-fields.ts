import { isValidEmailFormat, parseAndValidatePhone } from "@/lib/contact-validation";
import type { ContactDraftFields } from "@/services/agents.socket";

export type GuidedFieldKey =
  | "first_name"
  | "last_name"
  | "email"
  | "phone"
  | "company_name"
  | "city";

export type GuidedFieldDef = {
  key: GuidedFieldKey;
  label: string;
  /** Hard-required for create ready state. */
  required?: boolean;
  optional?: boolean;
};

/** CRM Contact Setup field order (chat + right panel). */
export function createGuidedFields(b2c: boolean): GuidedFieldDef[] {
  return [
    { key: "first_name", label: "First name", required: true },
    { key: "last_name", label: "Last name", optional: true },
    { key: "email", label: "Email", required: true },
    { key: "phone", label: "Phone", required: true },
    {
      key: "company_name",
      label: b2c ? "Company (optional)" : "Company (optional)",
      optional: true,
    },
    { key: "city", label: "City (optional)", optional: true },
  ];
}

function hasValue(value: unknown): boolean {
  return value !== undefined && value !== null && String(value).trim() !== "";
}

export function draftHasChannel(draft: ContactDraftFields): boolean {
  const email = String(draft.email || "").trim();
  const hasEmail = Boolean(email) && isValidEmailFormat(email);
  const hasPhone = parseAndValidatePhone(String(draft.phone || "")).ok;
  return hasEmail || hasPhone;
}

/** Ready to create: first name + (valid email or valid phone). */
export function draftIsCreateReady(draft: ContactDraftFields): boolean {
  return hasValue(draft.first_name) && draftHasChannel(draft);
}

export function isHardRequiredKey(key: GuidedFieldKey): boolean {
  return key === "first_name";
}

export function computeMissingGuidedKeys(
  draft: ContactDraftFields,
  _b2c: boolean,
): GuidedFieldKey[] {
  const miss: GuidedFieldKey[] = [];
  if (!hasValue(draft.first_name)) miss.push("first_name");
  if (!draftHasChannel(draft)) {
    if (!hasValue(draft.email)) miss.push("email");
    else if (!hasValue(draft.phone)) miss.push("phone");
  }
  return miss;
}

/** Progress across all guided fields (CRM-style done / left). */
export function computeFieldProgress(
  draft: ContactDraftFields,
  b2c: boolean,
): {
  done: number;
  left: number;
  total: number;
  percent: number;
} {
  const fields = createGuidedFields(b2c);
  const total = fields.length;
  const done = fields.filter(({ key }) => hasValue(draft[key])).length;
  const left = Math.max(0, total - done);
  return {
    done,
    left,
    total,
    percent: total ? Math.round((done / total) * 100) : 0,
  };
}

/** Hard essentials only (for status copy). */
export function computeHardProgress(draft: ContactDraftFields): {
  done: number;
  total: number;
  percent: number;
} {
  let done = 0;
  const total = 2;
  if (hasValue(draft.first_name)) done += 1;
  if (draftHasChannel(draft)) done += 1;
  return {
    done,
    total,
    percent: Math.round((done / total) * 100),
  };
}

export function draftStatusLine(draft: ContactDraftFields): string {
  if (!hasValue(draft.first_name)) return "Need a first name.";
  if (!draftHasChannel(draft)) return "Need an email or phone with country code.";
  return "Ready to create — confirm in chat.";
}

export function guidedDraftTitle(draft: ContactDraftFields): string {
  const name = [draft.first_name, draft.last_name]
    .map((v) => String(v || "").trim())
    .filter(Boolean)
    .join(" ");
  if (name) return name;
  if (hasValue(draft.email)) return String(draft.email).trim();
  if (hasValue(draft.phone)) return String(draft.phone).trim();
  return "New contact";
}

export function displayDraftValue(
  key: GuidedFieldKey,
  draft: ContactDraftFields,
): string {
  return String(draft[key] || "").trim();
}

/** Next empty field in create ask order. */
export function nextEmptyGuidedKey(
  draft: ContactDraftFields,
  b2c: boolean,
): GuidedFieldKey | null {
  void b2c;
  if (!hasValue(draft.first_name)) return "first_name";
  const email = String(draft.email || "").trim();
  const phone = String(draft.phone || "").trim();
  const hasEmail = Boolean(email) && isValidEmailFormat(email);
  const hasPhone = Boolean(phone) && parseAndValidatePhone(phone).ok;
  // Ask last name before channel; if channel already given, do not force last again.
  if (!hasValue(draft.last_name) && !hasEmail && !hasPhone) return "last_name";
  if (!hasEmail) return "email";
  if (!hasPhone) return "phone";
  if (!hasValue(draft.company_name)) return "company_name";
  if (!hasValue(draft.city)) return "city";
  return null;
}
