import type { Row } from "../plugins/clickhouse.js";
import {
  isGenericContactType,
  isObfuscatedCustomerLabel,
  parseIdentityFromTraitsJson,
} from "./identityTraits.js";

export interface VisitorCdpProfile {
  cdp_id: string;
  contact_type: string;
  display_name: string;
  first_name: string;
  last_name: string;
  primary_email: string;
  primary_phone: string;
  company: string;
  acquisition_channel: string;
  /** Internal: SDK userId; not shown in admin profile UI. */
  webtracking_user_id: string;
  is_cdp_known: boolean;
  identity_label: string;
  linked_visitor_ids_count: number;
  linked_visitor_ids: string[];
  other_linked_visitor_ids: string[];
}

function trimJoin(first: unknown, last: unknown): string {
  const name = `${String(first ?? "").trim()} ${String(last ?? "").trim()}`.trim();
  return name;
}

export function buildVisitorCdpProfile(row: Row | null | undefined, currentVisitorId: string): VisitorCdpProfile | null {
  if (!row) return null;
  const cdpId = String(row.cdp_id ?? "").trim();
  if (!cdpId) return null;

  const linkedRaw = row.linked_visitor_ids;
  const linked: string[] = Array.isArray(linkedRaw)
    ? linkedRaw.map((id) => String(id)).filter(Boolean)
    : [];

  const webtrackingUserId = String(row.webtracking_user_id ?? "").trim();
  const fromTraits = parseIdentityFromTraitsJson(row.traits_json ?? row.cdp_traits_json);

  let firstName = String(row.cdp_first_name ?? "").trim() || fromTraits.firstName;
  let lastName = String(row.cdp_last_name ?? "").trim() || fromTraits.lastName;
  let primaryEmail = String(row.cdp_primary_email ?? "").trim() || fromTraits.email;
  let primaryPhone = String(row.cdp_primary_phone ?? "").trim() || fromTraits.phone;

  let contactType = String(row.contact_type ?? "").trim();
  if (isGenericContactType(contactType) && fromTraits.method) {
    contactType = fromTraits.method;
  }

  const displayName =
    trimJoin(firstName, lastName)
    || fromTraits.fullName
    || primaryEmail
    || (!isGenericContactType(contactType) ? contactType : "");

  const identityLabel = !isGenericContactType(contactType) ? contactType : "Contact";

  const otherLinked = linked.filter((id) => id !== currentVisitorId);

  return {
    cdp_id: cdpId,
    contact_type: contactType,
    display_name: displayName,
    first_name: firstName,
    last_name: lastName,
    primary_email: primaryEmail,
    primary_phone: primaryPhone,
    company: String(row.cdp_company ?? ""),
    acquisition_channel: String(row.cdp_acquisition_channel ?? ""),
    webtracking_user_id: webtrackingUserId,
    is_cdp_known: true,
    identity_label: identityLabel,
    linked_visitor_ids_count: Number(row.linked_visitor_ids_count ?? linked.length),
    linked_visitor_ids: linked,
    other_linked_visitor_ids: otherLinked,
  };
}

export function buildVisitorCdpProfileSummary(row: Row | null | undefined): VisitorCdpProfile | null {
  return buildVisitorCdpProfile(row, "");
}

function profilePrimaryName(profile: VisitorCdpProfile): string {
  const joined = trimJoin(profile.first_name, profile.last_name);
  if (joined && !isGenericContactType(joined) && !isObfuscatedCustomerLabel(joined)) return joined;
  const name = String(profile.display_name ?? "").trim();
  if (name && !isGenericContactType(name) && !isObfuscatedCustomerLabel(name)) return name;
  return "";
}

/** UI label for list / picker (Anonymous when no resolved login). */
export function profileDisplayLabel(profile: VisitorCdpProfile | null | undefined): string {
  if (!profile?.cdp_id || !profile.is_cdp_known) return "Anonymous";
  const name = profilePrimaryName(profile);
  if (name) return name;
  const email = String(profile.primary_email ?? "").trim();
  if (email) return email;
  const uid = String(profile.webtracking_user_id ?? "").trim();
  if (uid.includes("@")) return uid;
  return "Anonymous";
}

/** Visitors list: prefer "First Last · email" when both exist. */
export function profileListDisplayLabel(profile: VisitorCdpProfile | null | undefined): string {
  if (!profile?.cdp_id || !profile.is_cdp_known) return "Anonymous";
  const name = profilePrimaryName(profile);
  const email = String(profile.primary_email ?? "").trim();
  if (name && email) return `${name} · ${email}`;
  return profileDisplayLabel(profile);
}

/** Known login but no usable name/email — still not Anonymous for pickers. */
export function isWeakKnownProfileLabel(label: string): boolean {
  const s = String(label ?? "").trim();
  return s === "Anonymous" || isObfuscatedCustomerLabel(s);
}

/** Richness score for picking the best row when the same person appears under multiple user_ids. */
export function profileIdentityScore(profile: VisitorCdpProfile): number {
  let score = 0;
  if (profilePrimaryName(profile)) score += 10;
  const email = String(profile.primary_email ?? "").trim();
  if (email) score += 8;
  if (String(profile.primary_phone ?? "").trim()) score += 2;
  const type = String(profile.contact_type ?? "").trim();
  if (type && !isGenericContactType(type)) score += 1;
  return score;
}

/** Login user_id with no name, email, or phone — hide from multi-account picker. */
export function isEmptyKnownProfile(profile: VisitorCdpProfile | null | undefined): boolean {
  if (!profile?.cdp_id || !profile.is_cdp_known) return false;
  return profileIdentityScore(profile) === 0;
}

/** One picker entry per user_id / email; drop empty "Customer" stubs. */
export function dedupeLinkedKnownProfiles(profiles: VisitorCdpProfile[]): VisitorCdpProfile[] {
  const list = profiles.filter((p): p is VisitorCdpProfile => Boolean(p?.cdp_id && p.is_cdp_known));
  if (!list.length) return [];

  const byUserId = new Map<string, VisitorCdpProfile>();
  for (const profile of list) {
    const uid = String(profile.webtracking_user_id ?? "").trim();
    const key = uid || profile.cdp_id;
    const prev = byUserId.get(key);
    if (!prev || profileIdentityScore(profile) > profileIdentityScore(prev)) {
      byUserId.set(key, profile);
    }
  }

  const afterUser = [...byUserId.values()];
  const byEmail = new Map<string, VisitorCdpProfile>();
  const withoutEmail: VisitorCdpProfile[] = [];

  for (const profile of afterUser) {
    const email = String(profile.primary_email ?? "").trim().toLowerCase();
    if (!email) {
      withoutEmail.push(profile);
      continue;
    }
    const prev = byEmail.get(email);
    if (!prev || profileIdentityScore(profile) > profileIdentityScore(prev)) {
      byEmail.set(email, profile);
    }
  }

  const merged = [...byEmail.values(), ...withoutEmail];
  return merged.filter((p) => !isEmptyKnownProfile(p));
}

/** @deprecated Use resolveSessionDisplayProfiles — session-only identity, no visitor-level fallback. */
export function pickLiveSessionCdpProfile(
  sessionProfile: VisitorCdpProfile | null,
  _visitorLatestKnownProfile: VisitorCdpProfile | null,
): VisitorCdpProfile | null {
  return sessionProfile;
}

/** Fill name/email from dim_known_users by user_id when session row only had userId. */
export function enrichWeakProfileFromKnownUserIdentity(
  profile: VisitorCdpProfile | null,
  visitorId: string,
  websiteId: number,
  identity:
    | {
        first_name: string;
        last_name: string;
        email: string;
        phone: string;
        method: string;
        traits_json: string;
      }
    | undefined,
): VisitorCdpProfile | null {
  if (!profile || !identity) return profile;
  if (!isWeakKnownProfileLabel(profileDisplayLabel(profile))) return profile;
  const uid = String(profile.webtracking_user_id ?? "").trim();
  if (!uid) return profile;
  return (
    buildVisitorCdpProfile(
      {
        cdp_id: profile.cdp_id || `wt:${websiteId}:${uid}`,
        contact_type: identity.method || profile.contact_type,
        cdp_first_name: identity.first_name,
        cdp_last_name: identity.last_name,
        cdp_primary_email: identity.email,
        cdp_primary_phone: identity.phone,
        traits_json: identity.traits_json,
        webtracking_user_id: uid,
        is_cdp_known: true,
        linked_visitor_ids_count: profile.linked_visitor_ids_count,
        linked_visitor_ids: profile.linked_visitor_ids,
      },
      visitorId,
    ) ?? profile
  );
}

export function buildProfileLabelFromIdentityRow(
  row: Row,
  websiteId: number,
  visitorId: string,
): string {
  const uid = String(row.user_id ?? "").trim();
  if (!uid) return "Anonymous";
  const profile = buildVisitorCdpProfile(
    {
      cdp_id: `wt:${websiteId}:${uid}`,
      contact_type: row.method ?? row.contact_type ?? "",
      cdp_first_name: row.first_name ?? row.cdp_first_name ?? "",
      cdp_last_name: row.last_name ?? row.cdp_last_name ?? "",
      cdp_primary_email: row.email ?? row.cdp_primary_email ?? "",
      cdp_primary_phone: row.phone ?? row.cdp_primary_phone ?? "",
      traits_json: row.traits_json ?? "",
      webtracking_user_id: uid,
      is_cdp_known: true,
      linked_visitor_ids_count: 1,
      linked_visitor_ids: [visitorId],
    },
    visitorId,
  );
  return profileDisplayLabel(profile);
}
