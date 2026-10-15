/**
 * Internal-domains resolver — foundation for future Internal Meeting Assist
 * routing (deterministic domain check, never an LLM decision — see
 * .cursor/skills/build-nlp-agents and the Assist roadmap discussion).
 *
 * Auto-derives an organization's "internal" email domain(s) from
 * `accounts.setup_users.work_email`, reusing the existing corporate/personal
 * classifier from lead scoring (`emailDomainType`) so free/public providers
 * (gmail, yahoo, outlook, ...) are never treated as internal. Caches the
 * result on `crm.organization_profiles`. If derivation yields an empty set
 * (e.g. the whole team is on free-provider addresses), the org is flagged
 * `needs_manual` rather than silently leaving routing broken — Configuration
 * surfaces a blocking prompt for an admin-entered list instead.
 */

import { listSetupUsersForOrg } from "@/service/account/setup-users";
import { parseCrmRole } from "@/service/auth/rbac";
import { emailDomainType } from "@/service/ai/lead-score";
import {
  getInternalDomainsState,
  saveDerivedInternalDomains,
  saveManualInternalDomains,
  saveInternalDomainOverrides,
  type InternalDomainsState,
} from "@/dao/org/organization-profile-store";

export type { InternalDomainsState, InternalDomainsMode } from "@/dao/org/organization-profile-store";

function domainOf(email: string): string | null {
  const domain = email.split("@")[1]?.trim().toLowerCase();
  return domain || null;
}

/**
 * Recompute the org's internal-domain set from its active users' work
 * emails. Pure function of current `setup_users` state — does not persist.
 */
export async function deriveInternalDomains(
  organizationId: string,
): Promise<string[]> {
  const users = await listSetupUsersForOrg(organizationId);
  const domains = new Set<string>();
  for (const user of users) {
    if (!parseCrmRole(user.crm_role_name)) continue;
    if (!user.email) continue;
    if (emailDomainType(user.email) !== "corporate") continue;
    const domain = domainOf(user.email);
    if (domain) domains.add(domain);
  }
  return [...domains].sort();
}

/**
 * Resolve the org's internal-domain state — recomputing and re-caching a
 * `derived` set, or returning the admin-entered list untouched when the org
 * is in `manual` mode. Never overwrites a manual entry with a derivation.
 */
export async function resolveInternalDomains(
  organizationId: string,
): Promise<InternalDomainsState> {
  const current = await getInternalDomainsState(organizationId);
  if (current.mode === "manual") return current;

  const derived = await deriveInternalDomains(organizationId);
  return saveDerivedInternalDomains(organizationId, derived);
}

/** Admin sets (or replaces) the manual domain list — used for `needs_manual` orgs. */
export async function setManualInternalDomains(
  organizationId: string,
  domains: string[],
): Promise<InternalDomainsState> {
  const cleaned = [
    ...new Set(
      domains
        .map((d) => d.trim().toLowerCase())
        .filter((d) => d.length > 0),
    ),
  ].sort();
  return saveManualInternalDomains(organizationId, cleaned);
}

/** Admin sets (or replaces) the specific-email override list. */
export async function setInternalDomainOverrides(
  organizationId: string,
  emails: string[],
): Promise<InternalDomainsState> {
  const cleaned = [
    ...new Set(
      emails
        .map((e) => e.trim().toLowerCase())
        .filter((e) => e.includes("@")),
    ),
  ].sort();
  return saveInternalDomainOverrides(organizationId, cleaned);
}

/**
 * Deterministic (non-LLM) check: is this attendee email "internal" to the
 * organization? Domain match against the resolved set, or a literal match
 * against the manual override list (alias/personal-email edge case).
 */
export function isInternalEmail(
  email: string | null | undefined,
  resolved: InternalDomainsState,
): boolean {
  const trimmed = email?.trim().toLowerCase();
  if (!trimmed) return false;
  if (resolved.overrideEmails.includes(trimmed)) return true;
  const domain = domainOf(trimmed);
  return domain ? resolved.domains.includes(domain) : false;
}
