/**
 * Deterministic Hub A2A field hydration from CRM/CDP data.
 * Only fills missing fields; never overwrites Hub-supplied ids.
 */
import { prisma } from "@/dao/db/prisma";
import {
  findCrmContactIdByEmails,
  normalizeEmail,
} from "@/dao/inbox/contact-by-email";

export type HubResolveInput = {
  organizationId: string;
  contactId?: string | null;
  dealId?: string | null;
  companyId?: string | null;
  instruction?: string | null;
  description?: string | null;
  text?: string | null;
  body?: string | null;
  emails?: string[];
};

export type HubResolveResult = {
  resolved: Record<string, string>;
  sources: Record<string, string>;
};

const EMAIL_RE =
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const QUOTED_RE = /['"]([^'"]{8,120})['"]/g;
const OPP_RE = /\bopp[-\w]+\b/gi;

function combinedText(input: HubResolveInput): string {
  return [
    input.instruction,
    input.description,
    input.text,
    input.body,
  ]
    .filter((part) => typeof part === "string" && part.trim())
    .join("\n");
}

export function extractEmailsFromHubText(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const match of text.matchAll(EMAIL_RE)) {
    const normalized = normalizeEmail(match[0]);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

function extractDealHints(text: string): string[] {
  const hints = new Set<string>();
  for (const match of text.matchAll(QUOTED_RE)) {
    const hint = match[1]?.trim();
    if (hint && hint.length >= 8) hints.add(hint);
  }
  for (const match of text.matchAll(OPP_RE)) {
    const hint = match[0]?.trim();
    if (hint) hints.add(hint);
  }
  return [...hints];
}

async function resolveContactIdFromEmails(
  emails: string[],
  organizationId: string,
): Promise<{ contactId: string; source: string } | null> {
  if (emails.length === 0) return null;
  const matches: string[] = [];
  for (const email of emails) {
    const id = await findCrmContactIdByEmails([email], organizationId);
    if (id && !matches.includes(id)) matches.push(id);
  }
  if (matches.length === 1) {
    return { contactId: matches[0], source: "email" };
  }
  return null;
}

async function resolveCompanyIdFromContact(
  contactId: string,
  organizationId: string,
): Promise<{ companyId: string; source: string } | null> {
  const profile = await prisma.contactProfile.findFirst({
    where: {
      accountContactId: contactId,
      organizationId,
    },
    select: { companyId: true },
  });
  const companyId = profile?.companyId?.trim();
  if (!companyId) return null;
  return { companyId, source: "contact_profile" };
}

async function resolveDealIdFromHints(
  organizationId: string,
  contactId: string | null,
  text: string,
): Promise<{ dealId: string; source: string } | null> {
  const hints = extractDealHints(text);
  for (const hint of hints) {
    const deals = await prisma.deal.findMany({
      where: {
        organizationId,
        ...(contactId ? { contactId } : {}),
        title: { contains: hint, mode: "insensitive" },
      },
      select: { id: true },
      take: 2,
      orderBy: { updatedAt: "desc" },
    });
    if (deals.length === 1) {
      return { dealId: deals[0].id, source: "deal_title" };
    }
  }
  return null;
}

export async function resolveHubPayloadFields(
  input: HubResolveInput,
): Promise<HubResolveResult> {
  const organizationId = String(input.organizationId || "").trim();
  const resolved: Record<string, string> = {};
  const sources: Record<string, string> = {};
  if (!organizationId) {
    return { resolved, sources };
  }

  const text = combinedText(input);
  let contactId = String(input.contactId || "").trim() || null;

  if (!contactId) {
    const emails = [
      ...(input.emails ?? []),
      ...extractEmailsFromHubText(text),
    ];
    const uniqueEmails = [...new Set(emails.map((e) => normalizeEmail(e)).filter(Boolean))] as string[];
    const fromEmail = await resolveContactIdFromEmails(uniqueEmails, organizationId);
    if (fromEmail) {
      contactId = fromEmail.contactId;
      resolved.contactId = fromEmail.contactId;
      sources.contactId = fromEmail.source;
    }
  }

  if (!String(input.companyId || "").trim() && contactId) {
    const fromContact = await resolveCompanyIdFromContact(contactId, organizationId);
    if (fromContact) {
      resolved.companyId = fromContact.companyId;
      sources.companyId = fromContact.source;
    }
  }

  if (!String(input.dealId || "").trim() && text.trim()) {
    const fromDeal = await resolveDealIdFromHints(organizationId, contactId, text);
    if (fromDeal) {
      resolved.dealId = fromDeal.dealId;
      sources.dealId = fromDeal.source;
    }
  }

  if (!String(input.instruction || "").trim()) {
    for (const key of ["description", "text"] as const) {
      const value = String(input[key] || "").trim();
      if (value) {
        resolved.instruction = value;
        sources.instruction = key;
        break;
      }
    }
  }

  if (!String(input.body || "").trim()) {
    const bodySource =
      String(input.instruction || "").trim() ||
      String(input.description || "").trim() ||
      String(input.text || "").trim();
    if (bodySource) {
      resolved.body = bodySource;
      sources.body = "instruction_text";
    }
  }

  return { resolved, sources };
}
