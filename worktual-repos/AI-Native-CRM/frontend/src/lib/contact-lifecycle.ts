/**
 * Keep lead pipeline status aligned with CRM lifecycle.
 * Mirrors backend/src/lib/contact-lifecycle.ts.
 */

const LATER_STAGES = new Set(["prospect", "customer", "churned"]);

export type ReachableChannelInput = {
  email?: string | null;
  phone?: string | null;
  secondaryEmails?: Array<string | null | undefined> | null;
  secondaryPhones?: Array<string | null | undefined> | null;
};

export function hasReachableChannel(input: ReachableChannelInput): boolean {
  if ((input.email ?? "").trim()) return true;
  if ((input.phone ?? "").trim()) return true;
  if (input.secondaryEmails?.some((v) => Boolean(v?.trim()))) return true;
  if (input.secondaryPhones?.some((v) => Boolean(v?.trim()))) return true;
  return false;
}

export function effectiveContactType(value: string | null | undefined): string {
  const v = (value ?? "").trim().toLowerCase();
  if (
    v === "contact" ||
    v === "lead" ||
    v === "prospect" ||
    v === "customer" ||
    v === "churned"
  ) {
    return v;
  }
  return "contact";
}

export function resolveContactTypeForChannels(
  input: ReachableChannelInput & {
    requested?: string | null;
    existing?: string | null;
  },
): string {
  const existing = effectiveContactType(input.existing);
  const requested =
    input.requested != null && String(input.requested).trim() !== ""
      ? effectiveContactType(input.requested)
      : existing;

  if (LATER_STAGES.has(existing) || LATER_STAGES.has(requested)) {
    return LATER_STAGES.has(requested) ? requested : existing;
  }
  if (existing === "lead") return "lead";
  if (hasReachableChannel(input)) return "lead";
  return "contact";
}

export function reconcileLeadStatusWithContactType(
  contactType: string,
  leadStatus: string,
): string {
  if (contactType === "customer" || contactType === "churned") {
    return "converted";
  }
  return leadStatus;
}
