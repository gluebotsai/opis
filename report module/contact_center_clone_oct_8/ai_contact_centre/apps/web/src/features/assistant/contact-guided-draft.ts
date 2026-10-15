import type { ContactDraftField, ContactGuidedDraft } from "./assistant-api";

export type ContactDraftSnapshot = Partial<Record<ContactDraftField, unknown>>;

export type ContactUpdateChange = {
  id: string;
  key: ContactDraftField;
  label: string;
  from: unknown;
  to: unknown;
};

export function hasContactDraftValue(value: unknown): boolean {
  return value !== undefined && value !== null && value !== "";
}

export function coerceContactActive(value: unknown): boolean | null {
  if (!hasContactDraftValue(value)) return null;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  const normalized = String(value).trim().toLowerCase();
  if (["false", "inactive", "0", "no", "off"].includes(normalized)) return false;
  if (["true", "active", "1", "yes", "on"].includes(normalized)) return true;
  return null;
}

function contactPhoneDigits(value: unknown): string {
  return String(value ?? "").replace(/\D/g, "");
}

export function contactPhonesEquivalent(left: unknown, right: unknown): boolean {
  const first = contactPhoneDigits(left);
  const second = contactPhoneDigits(right);
  if (!first && !second) return true;
  if (!first || !second) return false;
  if (first === second) return true;
  const [shorter, longer] = first.length <= second.length ? [first, second] : [second, first];
  if (!longer.endsWith(shorter)) return false;
  const prefix = longer.slice(0, longer.length - shorter.length);
  return prefix.length >= 1 && prefix.length <= 3;
}

export function contactDraftValuesEqual(
  left: unknown,
  right: unknown,
  key?: ContactDraftField,
): boolean {
  if (key === "isActive") {
    const leftActive = coerceContactActive(left);
    const rightActive = coerceContactActive(right);
    if (leftActive === null && rightActive === null) return true;
    return leftActive === rightActive;
  }
  if (key === "primaryPhone" || key === "secondaryPhone") {
    return contactPhonesEquivalent(left, right);
  }
  if (!hasContactDraftValue(left) && !hasContactDraftValue(right)) return true;
  if (typeof left === "object" || typeof right === "object") {
    return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
  }
  return String(left).trim() === String(right).trim();
}

export function contactToDraftSnapshot(
  contact: Partial<Record<ContactDraftField, unknown>> | null | undefined,
): ContactDraftSnapshot | null {
  if (!contact) return null;
  const snapshot: ContactDraftSnapshot = {};
  for (const key of [
    "firstName",
    "lastName",
    "primaryEmail",
    "primaryPhone",
    "secondaryEmail",
    "secondaryPhone",
    "gender",
    "dateOfBirth",
    "company",
    "industry",
    "city",
    "region",
    "country",
    "language",
    "timezone",
    "customFields",
    "isActive",
  ] as const) {
    if (key in contact) snapshot[key] = contact[key];
  }
  return snapshot;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** A custom-fields patch lists only keys being set. Existing keys stay unless named here. */
function customFieldPatchChanges(
  next: unknown,
  previous: unknown,
): ContactUpdateChange[] {
  if (!isPlainRecord(next)) return [];
  const current = isPlainRecord(previous) ? previous : {};
  return Object.entries(next).flatMap(([name, value]) => {
    const label = name.trim();
    if (!label || !hasContactDraftValue(value)) return [];
    const from = Object.prototype.hasOwnProperty.call(current, name) ? current[name] : undefined;
    if (contactDraftValuesEqual(from, value)) return [];
    return [
      {
        id: `customFields:${label}`,
        key: "customFields",
        label,
        from,
        to: value,
      },
    ];
  });
}

export function listContactUpdateChanges(
  fields: ContactDraftSnapshot,
  current: ContactDraftSnapshot | null | undefined,
  fieldDefs: Array<{ key: ContactDraftField; label: string }>,
): ContactUpdateChange[] {
  return fieldDefs.flatMap((field) => {
    if (!(field.key in fields)) return [];
    const next = fields[field.key];
    const previous = current?.[field.key];
    if (field.key === "customFields") return customFieldPatchChanges(next, previous);
    if (!hasContactDraftValue(next) && !hasContactDraftValue(previous)) return [];
    if (current && contactDraftValuesEqual(previous, next, field.key)) return [];
    if (!current && !hasContactDraftValue(next)) return [];
    return [{ id: field.key, key: field.key, label: field.label, from: previous, to: next }];
  });
}

const CONTACT_FIELD_LABELS: Array<{ key: ContactDraftField; labels: string[] }> = [
  { key: "firstName", labels: ["first name", "firstname"] },
  { key: "lastName", labels: ["last name", "lastname"] },
  { key: "primaryEmail", labels: ["primary email", "email"] },
  { key: "primaryPhone", labels: ["primary phone", "phone number", "phone"] },
  { key: "secondaryEmail", labels: ["secondary email"] },
  { key: "secondaryPhone", labels: ["whatsapp number", "secondary phone", "whatsapp"] },
  { key: "gender", labels: ["gender"] },
  { key: "dateOfBirth", labels: ["date of birth", "dob"] },
  { key: "company", labels: ["company"] },
  { key: "industry", labels: ["industry"] },
  { key: "city", labels: ["city"] },
  { key: "region", labels: ["region", "state"] },
  { key: "country", labels: ["country"] },
  { key: "language", labels: ["language"] },
  { key: "timezone", labels: ["timezone"] },
  { key: "isActive", labels: ["status", "active"] },
];

function normalizeFieldLabel(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

function isBlankDraftDisplay(value: string): boolean {
  return !value.trim() || /^(—|–|-|none|null|n\/a)$/i.test(value.trim());
}

function fieldKeyFromLabel(label: string): ContactDraftField | null {
  const normalized = normalizeFieldLabel(label);
  const match = CONTACT_FIELD_LABELS.find(({ labels }) =>
    labels.some((item) => item === normalized),
  );
  return match?.key ?? null;
}

function headerIndex(headers: string[], ...aliases: string[]): number {
  return headers.findIndex((header) => aliases.includes(header));
}

/** Build an update draft from a coworker FIELD / CURRENT / NEW VALUE table. */
export function contactDraftFromAssistantHtml(
  html: string,
  contactId?: string | null,
): ContactGuidedDraft | null {
  if (typeof DOMParser === "undefined" || !html.includes("<table")) return null;
  const doc = new DOMParser().parseFromString(html, "text/html");
  for (const table of Array.from(doc.querySelectorAll("table"))) {
    const headerRow = table.tHead?.rows[0] ?? table.querySelector("tr");
    if (!headerRow) continue;
    const headers = Array.from(headerRow.cells).map((cell) =>
      normalizeFieldLabel(cell.textContent ?? ""),
    );
    const fieldIdx = headerIndex(headers, "field");
    const newIdx = headerIndex(headers, "new value", "new");
    if (fieldIdx < 0 || newIdx < 0) continue;

    const fields: ContactGuidedDraft["fields"] = {};
    for (const row of Array.from(table.rows)) {
      if (row === headerRow) continue;
      const label = row.cells[fieldIdx]?.textContent ?? "";
      const next = (row.cells[newIdx]?.textContent ?? "").trim();
      const key = fieldKeyFromLabel(label);
      if (!key || isBlankDraftDisplay(next)) continue;
      if (key === "isActive") {
        const active = coerceContactActive(next);
        if (active === null) continue;
        fields[key] = active;
        continue;
      }
      fields[key] = next;
    }
    if (Object.keys(fields).length === 0) continue;
    return {
      mode: "update",
      contactId: contactId ?? null,
      fields,
      nextField: null,
      nextQuestion: null,
      skippedFields: [],
      ready: true,
    };
  }
  return null;
}

/** Merge a stateless LLM draft event into the contact preview's cumulative state. */
export function mergeContactGuidedDraft(
  previous: ContactGuidedDraft | null,
  incoming: ContactGuidedDraft,
): ContactGuidedDraft {
  if (
    !previous ||
    previous.mode !== incoming.mode ||
    (previous.contactId && incoming.contactId && previous.contactId !== incoming.contactId)
  ) {
    return incoming;
  }

  const fields = { ...previous.fields, ...incoming.fields };
  const restoredFields = new Set(Object.keys(incoming.fields));
  if (incoming.nextField) restoredFields.add(incoming.nextField);

  const skippedFields = Array.from(
    new Set([...(previous.skippedFields ?? []), ...(incoming.skippedFields ?? [])]),
  ).filter((field) => !restoredFields.has(field));

  return {
    ...previous,
    ...incoming,
    contactId: incoming.contactId ?? previous.contactId,
    fields,
    skippedFields,
  };
}
