import type { LocationType } from "@prisma/client";

type ContactLike = {
  id: string;
  ownerUserId: string | null;
  city?: string | null;
  locationId?: string | null;
};

type LocationLike = {
  id: string;
  type: LocationType;
  ownerUserId: string | null;
  name?: string | null;
  city?: string | null;
};

function normalizePlace(value: string | null | undefined): string | null {
  const v = value?.trim().toLowerCase();
  return v || null;
}

/**
 * Resolve which company location a contact belongs to.
 * 1. Explicit `locationId` (crm_qa.contact_profiles)
 * 2. City / location-name match
 * 3. Sole location for the company
 * 4. HQ (so company contacts always land on a location card)
 */
export function resolveContactLocationId(
  contact: ContactLike,
  allLocations: LocationLike[],
): string | null {
  if (allLocations.length === 0) return null;

  const explicit = contact.locationId?.trim() || null;
  if (explicit && allLocations.some((loc) => loc.id === explicit)) {
    return explicit;
  }

  const city = normalizePlace(contact.city);
  if (city) {
    const byPlace = allLocations.find((loc) => {
      const name = normalizePlace(loc.name);
      const locCity = normalizePlace(loc.city);
      return name === city || locCity === city;
    });
    if (byPlace) return byPlace.id;
  }

  if (allLocations.length === 1) return allLocations[0]!.id;

  const hq = allLocations.find((loc) => loc.type === "hq");
  return hq?.id ?? allLocations[0]!.id;
}

/** @deprecated Use resolveContactLocationId */
export const resolveLeadLocationId = resolveContactLocationId;

export function attributeContactsToLocation<T extends ContactLike>(
  contacts: T[],
  location: LocationLike,
  allLocations: LocationLike[],
): T[] {
  return contacts.filter(
    (contact) =>
      resolveContactLocationId(contact, allLocations) === location.id,
  );
}

/** @deprecated Use attributeContactsToLocation */
export const attributeLeadsToLocation = attributeContactsToLocation;

/**
 * Funnel counts for a location from its attributed contacts:
 * lead → LEADS, prospect (in pipeline) → DEALS, customer (won) → CUSTOMERS.
 */
export function funnelCountsFromContacts(
  contacts: Array<{
    contactType?: string | null;
    leadStatus?: string | null;
  }>,
): { leadCount: number; dealCount: number; customerCount: number } {
  let leadCount = 0;
  let dealCount = 0;
  let customerCount = 0;
  for (const c of contacts) {
    const stage = c.contactType;
    if (stage === "lead") {
      if (c.leadStatus !== "converted" && c.leadStatus !== "disqualified") {
        leadCount += 1;
      }
    } else if (stage === "prospect") {
      dealCount += 1;
    } else if (stage === "customer") {
      customerCount += 1;
    }
  }
  return { leadCount, dealCount, customerCount };
}
