/** Build a contact display name without placeholder last names like "Contact". */
export function formatContactDisplayName(
  firstName: string | null | undefined,
  lastName: string | null | undefined,
): string {
  const first = firstName?.trim() ?? "";
  const last = lastName?.trim() ?? "";
  if (!last || last.toLowerCase() === "contact") {
    return first || "Unknown";
  }
  // Phone auto-leads used "Contact 1234" historically.
  if (/^contact\s+/i.test(last) && !first) {
    return last.replace(/^contact\s+/i, "").trim() || "Unknown";
  }
  if (/^contact\s+/i.test(last)) {
    return first;
  }
  return `${first} ${last}`.trim() || "Unknown";
}

/** True when a rep can identify or reach the contact (name, email, or phone). */
export function hasActionableContactIdentity(
  firstName: string | null | undefined,
  lastName: string | null | undefined,
  email?: string | null,
  phone?: string | null,
): boolean {
  if (formatContactDisplayName(firstName, lastName) !== "Unknown") return true;
  return Boolean(email?.trim() || phone?.trim());
}

/** List label — prefer name, then email, then phone. */
export function formatContactListLabel(
  firstName: string | null | undefined,
  lastName: string | null | undefined,
  email?: string | null,
  phone?: string | null,
): string {
  const name = formatContactDisplayName(firstName, lastName);
  if (name !== "Unknown") return name;
  const trimmedEmail = email?.trim();
  if (trimmedEmail) return trimmedEmail;
  const trimmedPhone = phone?.trim();
  if (trimmedPhone) return trimmedPhone;
  return "Unknown";
}
