/**
 * Activity create: ensure the agent catalog includes the draft / deal handoff contact.
 */

import { effectiveContactType } from "@/lib/contact-lifecycle";

export async function ensureContactInSelectCatalog(
  catalog: Record<string, unknown>,
  contactId: string,
): Promise<void> {
  const id = contactId.trim();
  if (!id) return;
  const rows = Array.isArray(catalog.contacts)
    ? (catalog.contacts as Array<Record<string, unknown>>)
    : [];
  if (rows.some((row) => String(row.id) === id)) return;
  try {
    const { getContact } = await import("@/dao/contacts/contact-service");
    const view = await getContact(id);
    if (!view) return;
    catalog.contacts = [
      {
        id: view.id,
        displayName: view.displayName,
        email: view.person.email,
        companyId: view.person.companyId,
      },
      ...rows,
    ].slice(0, 200);
  } catch {
    // optional
  }
}

async function attachOpenContact(
  catalog: Record<string, unknown>,
  contactId: string,
): Promise<void> {
  const id = contactId.trim();
  if (!id) return;
  try {
    const { getContact } = await import("@/dao/contacts/contact-service");
    const view = await getContact(id);
    if (!view) return;
    const person = view.person;
    const emails = [person.email, ...(person.secondaryEmails ?? [])]
      .map((value) => String(value ?? "").trim())
      .filter(
        (value, index, all) =>
          value.includes("@") &&
          all.findIndex((item) => item.toLowerCase() === value.toLowerCase()) ===
            index,
      );
    catalog.openContact = {
      id: view.id,
      displayName: view.displayName,
      firstName: person.firstName,
      lastName: person.lastName,
      email: person.email,
      emails,
      companyId: person.companyId ?? null,
      companyName: person.company?.name || person.companyName || null,
      contactType: effectiveContactType(person.contactType),
    };
    const companyId = person.companyId?.trim();
    if (companyId) {
      try {
        const { getCompany } = await import("@/dao/companies/company-service");
        const company = await getCompany(companyId);
        if (company) {
          catalog.openCompany = {
            id: company.id,
            name: company.name,
          };
        }
      } catch {
        // optional
      }
    }
  } catch {
    // optional
  }
}

function handoffDealId(
  catalog: Record<string, unknown>,
  sessionMemory?: Record<string, unknown> | null,
): string | null {
  const fromCatalog =
    typeof catalog.handoffDealId === "string"
      ? catalog.handoffDealId.trim()
      : "";
  if (fromCatalog) return fromCatalog;
  if (!sessionMemory || typeof sessionMemory !== "object") return null;
  const slots =
    sessionMemory.slots && typeof sessionMemory.slots === "object"
      ? (sessionMemory.slots as Record<string, unknown>)
      : {};
  const last =
    sessionMemory.lastEntities &&
    typeof sessionMemory.lastEntities === "object"
      ? (sessionMemory.lastEntities as Record<string, unknown>)
      : {};
  const fromSlots =
    typeof slots.dealId === "string" ? slots.dealId.trim() : "";
  if (fromSlots) return fromSlots;
  const fromLast =
    typeof last.dealId === "string" ? last.dealId.trim() : "";
  return fromLast || null;
}

function draftContactId(catalog: Record<string, unknown>): string | null {
  const draft = catalog.currentDraft;
  if (!draft || typeof draft !== "object") return null;
  const id = (draft as { contactId?: unknown }).contactId;
  return typeof id === "string" && id.trim() ? id.trim() : null;
}

/** Deal handoff + draft contact for activity log / create turns. */
export async function enrichActivitiesCreateCatalog(
  catalog: Record<string, unknown>,
  sessionMemory?: Record<string, unknown> | null,
): Promise<void> {
  let contactId = draftContactId(catalog);

  const dealId = handoffDealId(catalog, sessionMemory);
  if (dealId) {
    try {
      const { getDeal } = await import("@/dao/sales/deal-service");
      const deal = await getDeal(dealId);
      if (deal) {
        catalog.openDeal = {
          id: deal.id,
          title: deal.title,
          stage: deal.stage,
          companyName: deal.company?.name ?? "",
          contactName: deal.contactName ?? "",
          contactId: deal.contactId ?? null,
        };
        const dealContact = deal.contactId?.trim() || "";
        if (dealContact && !contactId) {
          contactId = dealContact;
        }
      }
    } catch {
      // optional
    }
  }

  const openDeal = catalog.openDeal;
  if (
    !contactId &&
    openDeal &&
    typeof openDeal === "object" &&
    typeof (openDeal as { contactId?: unknown }).contactId === "string"
  ) {
    const cid = String((openDeal as { contactId: string }).contactId).trim();
    if (cid) contactId = cid;
  }

  if (contactId) {
    await ensureContactInSelectCatalog(catalog, contactId);
    await attachOpenContact(catalog, contactId);
  }
}
