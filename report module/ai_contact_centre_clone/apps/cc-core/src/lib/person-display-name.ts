function collapseDuplicateNameTokens(value: string): string {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return value.trim();
  if (parts.every((part) => part.toLowerCase() === parts[0]!.toLowerCase())) {
    return parts[0]!;
  }
  return parts.join(" ");
}

/** Prefer first/last name parts, then a preformatted full name, then visitor label. */
export function formatPersonDisplayName(input: {
  firstName?: string | null;
  lastName?: string | null;
  fullName?: string | null;
  visitorId?: string | null;
  fallback?: string;
}): string {
  const first = input.firstName?.trim() ?? "";
  const last = input.lastName?.trim() ?? "";
  if (first && last && first.toLowerCase() === last.toLowerCase()) {
    return first;
  }

  const fromParts = [first, last].filter(Boolean).join(" ").trim();
  if (fromParts) return fromParts;

  const full = input.fullName?.trim();
  if (full) return collapseDuplicateNameTokens(full);

  const visitorId = input.visitorId?.trim();
  if (visitorId) {
    if (/^v_/i.test(visitorId)) return `Visitor ${visitorId.slice(2)}`;
    return `Visitor ${visitorId}`;
  }

  return input.fallback ?? "Customer";
}

const GENERIC_PROFILE_NAMES = new Set([
  "customer",
  "visitor",
  "user",
  "unknown",
  "webchat",
  "whatsapp",
  "instagram",
  "facebook",
  "e2e customer",
]);

function isUsableProfileName(value: string | null | undefined): boolean {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) return false;
  return !GENERIC_PROFILE_NAMES.has(trimmed.toLowerCase());
}

/**
 * Resolve customer display label for conversations:
 * 1) CDP customer profile name
 * 2) Channel-provided identity (WhatsApp/IG/FB name, etc.)
 * 3) Visitor / customer ref
 * 4) Channel fallback label
 */
export function resolveCustomerDisplayLabel(input: {
  profileFullName?: string | null;
  profileFirstName?: string | null;
  profileLastName?: string | null;
  channelDisplayName?: string | null;
  visitorId?: string | null;
  channelFallback: string;
}): string {
  const fromProfile = formatPersonDisplayName({
    firstName: input.profileFirstName,
    lastName: input.profileLastName,
    fullName: input.profileFullName,
    fallback: "",
  }).trim();
  if (isUsableProfileName(fromProfile)) {
    return fromProfile;
  }

  const channelName = input.channelDisplayName?.trim() ?? "";
  if (isUsableProfileName(channelName)) {
    return channelName;
  }

  const visitorId = input.visitorId?.trim() ?? "";
  if (visitorId) {
    return formatPersonDisplayName({ visitorId, fallback: input.channelFallback });
  }

  return input.channelFallback;
}

