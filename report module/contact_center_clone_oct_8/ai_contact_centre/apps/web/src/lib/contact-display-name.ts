import { isPhoneLikeDisplayName, resolveProfileDisplayName } from "@/lib/avatar-utils";

export type ContactDisplayNameInput = {
  firstName?: string | null;
  lastName?: string | null;
  fullName?: string | null;
  customFields?: Record<string, unknown> | null;
  primaryEmail?: string | null;
  primaryPhone?: string | null;
  sourceSystem?: string | null;
};

export function readContactCustomDisplayName(
  customFields?: Record<string, unknown> | null,
): string | null {
  if (!customFields) return null;
  if (typeof customFields.displayName === "string" && customFields.displayName.trim()) {
    return customFields.displayName.trim();
  }
  if (typeof customFields.customerName === "string" && customFields.customerName.trim()) {
    return customFields.customerName.trim();
  }
  return null;
}

function isWhatsAppSource(sourceSystem?: string | null, customFields?: Record<string, unknown> | null): boolean {
  const source = sourceSystem?.toLowerCase() ?? "";
  if (source === "whatsapp" || source.startsWith("inbound_whatsapp")) return true;
  return customFields?.inboundChannel === "whatsapp";
}

/**
 * Resolve a contact display label:
 * firstName/lastName → customFields.customerName/displayName → fullName → email/phone.
 */
export function resolveContactDisplayName(
  input: ContactDisplayNameInput,
  fallback = "Unknown contact",
): string {
  const customDisplayName = readContactCustomDisplayName(input.customFields);
  const resolved = resolveProfileDisplayName(
    [input.firstName, input.lastName].filter(Boolean).join(" "),
    customDisplayName,
    input.fullName,
  );

  if (resolved && !isPhoneLikeDisplayName(resolved)) {
    return resolved;
  }

  if (isWhatsAppSource(input.sourceSystem, input.customFields)) {
    return "WhatsApp contact";
  }

  return (
    resolved ||
    input.primaryEmail?.trim() ||
    input.primaryPhone?.trim() ||
    fallback
  );
}
