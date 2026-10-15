import type { ContactType, LeadStatus } from "@/service/account/types";

const LATER_STAGES = new Set<ContactType>(["prospect", "customer", "churned"]);

export type ReachableChannelInput = {
  email?: string | null;
  phone?: string | null;
  secondaryEmails?: Array<string | null | undefined> | null;
  secondaryPhones?: Array<string | null | undefined> | null;
};

/** At least one email or phone (primary or secondary). */
export function hasReachableChannel(input: ReachableChannelInput): boolean {
  if ((input.email ?? "").trim()) return true;
  if ((input.phone ?? "").trim()) return true;
  if (input.secondaryEmails?.some((v) => Boolean(v?.trim()))) return true;
  if (input.secondaryPhones?.some((v) => Boolean(v?.trim()))) return true;
  return false;
}

/**
 * Null/empty/unknown CDP contact_type is a contact — not a lead.
 * Leads require a reachable channel (applied in resolveContactTypeForChannels).
 */
export function effectiveContactType(
  value: string | null | undefined,
): ContactType {
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

/**
 * Create/update type:
 * - prospect/customer/churned are kept
 * - existing leads are never demoted
 * - otherwise lead iff a reachable channel exists
 */
export function resolveContactTypeForChannels(input: ReachableChannelInput & {
  requested?: string | null;
  existing?: string | null;
}): ContactType {
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

export function becameLead(
  from: string | null | undefined,
  to: string | null | undefined,
): boolean {
  const prev = effectiveContactType(from);
  const next = effectiveContactType(to);
  if (next !== "lead") return false;
  return prev === "contact";
}

export function isLeadPipelineStage(
  value: string | null | undefined,
): boolean {
  return effectiveContactType(value) === "lead";
}

export function isSalesPipelineStage(
  value: string | null | undefined,
): boolean {
  const stage = effectiveContactType(value);
  return stage === "prospect" || stage === "customer";
}

/**
 * Keep lead pipeline status aligned with CDP contact_type.
 * Customers (and churned) are past the lead desk — lead status must be converted.
 */
export function reconcileLeadStatusWithContactType(
  contactType: ContactType,
  leadStatus: LeadStatus,
): LeadStatus {
  const stage = effectiveContactType(contactType);
  if (stage === "customer" || stage === "churned") {
    return "converted";
  }
  return leadStatus;
}

/** @deprecated Use reconcileLeadStatusWithContactType */
export const reconcileLeadStatusWithLifecycle = reconcileLeadStatusWithContactType;
