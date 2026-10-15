import { getContact } from "@/dao/contacts/contact-service";
import {
  isSalesRepRoleName,
  listAssignmentCandidates,
  resolveRegionalSalesOwner,
  type AssignmentCandidate,
} from "@/dao/sales/territory-assignment";
import {
  findFreeSlotsOnDay,
  isSlotFree,
  mailboxHasGoogleCalendar,
} from "@/service/ai/demo-booking";

const RANK_TTL_MS = 2 * 60_000;

export type ResolveHostAtSlotResult =
  | {
      available: true;
      hostUserId: string;
      hostName: string;
      assignmentReason: string;
    }
  | {
      available: false;
      reason: "no_slots_available" | "contact_not_found" | "no_candidates";
    };

type RankedHosts = {
  ordered: AssignmentCandidate[];
  reason: string;
};

const rankCache = new Map<string, { at: number; ranking: RankedHosts | null }>();

export function clearAppointmentHostRankCache(): void {
  rankCache.clear();
}

function eligibleHost(candidate: AssignmentCandidate | undefined): candidate is AssignmentCandidate {
  if (!candidate || !isSalesRepRoleName(candidate.role)) return false;
  if (!candidate.acceptingLeads || candidate.onPto) return false;
  if (
    candidate.maxOpenDeals != null &&
    candidate.openDealCount >= candidate.maxOpenDeals
  ) {
    return false;
  }
  return true;
}

async function rankedHostsForContact(input: {
  organizationId: string;
  contactId: string;
  country?: string | null;
  city?: string | null;
  companyId?: string | null;
  locationId?: string | null;
}): Promise<RankedHosts | null> {
  const key = [
    input.organizationId,
    input.contactId,
    input.city ?? "",
    input.country ?? "",
    input.companyId ?? "",
    input.locationId ?? "",
  ].join("|");
  const cached = rankCache.get(key);
  if (cached && Date.now() - cached.at < RANK_TTL_MS) return cached.ranking;

  let businessType: "b2b" | "b2c" | "b2b2c" | null = null;
  try {
    const { getCurrentBusinessType } = await import("@/service/auth/require-role");
    businessType = await getCurrentBusinessType();
  } catch {
    businessType = null;
  }

  let ranking: RankedHosts | null = null;
  try {
    const decision = await resolveRegionalSalesOwner({
      organizationId: input.organizationId,
      businessType,
      country: input.country,
      city: input.city,
      contactId: input.contactId,
      companyId: input.companyId,
      locationId: input.locationId,
    });
    if (decision.status === "assigned") {
      const { candidates } = await listAssignmentCandidates({
        organizationId: input.organizationId,
      });
      const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]));
      const rankedIds = decision.owner.rankedUserIds?.length
        ? decision.owner.rankedUserIds
        : [decision.owner.userId];
      ranking = {
        ordered: rankedIds
          .map((id) => byId.get(id))
          .filter(eligibleHost),
        reason: decision.owner.reason,
      };
    }
  } catch (err) {
    console.error("appointment host ranking failed", input.contactId, err);
  }

  rankCache.set(key, { at: Date.now(), ranking });
  return ranking;
}

export async function resolveHostAtSlot(input: {
  organizationId: string;
  contactId: string;
  startsAt: Date;
  endsAt: Date;
}): Promise<ResolveHostAtSlotResult> {
  const contact = await getContact(input.contactId);
  if (!contact) {
    return { available: false, reason: "contact_not_found" };
  }

  const orgId = input.organizationId.trim();
  const contactOrg = contact.person.organizationId?.trim();
  if (contactOrg && contactOrg !== orgId) {
    return { available: false, reason: "contact_not_found" };
  }

  const ranked = await rankedHostsForContact({
    organizationId: orgId,
    contactId: input.contactId,
    country: contact.person.country,
    city: contact.person.city,
    companyId: contact.person.companyId,
    locationId: contact.person.locationId ?? null,
  });

  if (!ranked || ranked.ordered.length === 0) {
    return { available: false, reason: "no_candidates" };
  }

  for (const [index, candidate] of ranked.ordered.entries()) {
    const hasCal = await mailboxHasGoogleCalendar(candidate.id);
    if (!hasCal) continue;

    const free = await isSlotFree({
      mailboxUserId: candidate.id,
      start: input.startsAt,
      end: input.endsAt,
    });
    if (!free) continue;

    return {
      available: true,
      hostUserId: candidate.id,
      hostName: candidate.displayName,
      assignmentReason:
        index === 0
          ? ranked.reason
          : `${ranked.reason} Earlier ranked reps had no free slot.`,
    };
  }

  return { available: false, reason: "no_slots_available" };
}

export type AvailableDaySlot = {
  startsAt: string;
  hostUserId: string;
};

/** Alternative slots on the same local day when the requested time is busy. */
export async function findAvailableSlotsForDay(input: {
  organizationId: string;
  contactId: string;
  day: Date;
  timezone: string;
  durationMinutes: number;
  limit?: number;
}): Promise<AvailableDaySlot[]> {
  const contact = await getContact(input.contactId);
  if (!contact) return [];

  const orgId = input.organizationId.trim();
  const contactOrg = contact.person.organizationId?.trim();
  if (contactOrg && contactOrg !== orgId) return [];

  const ranked = await rankedHostsForContact({
    organizationId: orgId,
    contactId: input.contactId,
    country: contact.person.country,
    city: contact.person.city,
    companyId: contact.person.companyId,
    locationId: contact.person.locationId ?? null,
  });
  if (!ranked || ranked.ordered.length === 0) return [];

  const limit = input.limit ?? 8;
  const slotHosts = new Map<string, string>();

  for (const candidate of ranked.ordered) {
    if (!(await mailboxHasGoogleCalendar(candidate.id))) continue;

    const freeSlots = await findFreeSlotsOnDay({
      mailboxUserId: candidate.id,
      day: input.day,
      durationMinutes: input.durationMinutes,
      timeZone: input.timezone,
      limit,
    });

    for (const slot of freeSlots) {
      const iso = slot.toISOString();
      if (!slotHosts.has(iso)) {
        slotHosts.set(iso, candidate.id);
      }
    }
    if (slotHosts.size >= limit) break;
  }

  return [...slotHosts.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(0, limit)
    .map(([startsAt, hostUserId]) => ({ startsAt, hostUserId }));
}
