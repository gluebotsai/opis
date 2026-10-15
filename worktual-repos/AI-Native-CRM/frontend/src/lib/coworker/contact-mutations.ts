import type { AgentToolProposal } from "@/services/coworker";
import type { ContactInput } from "@/services/contact-types";
import {
  deleteContact,
  fetchContactDetail,
  updateContact,
} from "@/services/contacts";
import { setManualLeadScore } from "@/services/leadSummary";

const LEAD_STATUSES = new Set([
  "new",
  "contacted",
  "qualifying",
  "qualified",
  "disqualified",
  "converted",
]);

const CONTACT_PATCH_KEYS = [
  "firstName",
  "lastName",
  "email",
  "phone",
  "title",
  "notes",
  "city",
  "country",
  "addressLine",
  "status",
  "ownerUserId",
  "contactType",
  "leadStatus",
  "leadSource",
  "companyId",
  "locationId",
] as const;

function parseCsvList(raw: unknown): string[] | undefined {
  if (typeof raw !== "string" || !raw.trim()) return undefined;
  return raw
    .split(/[,;\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function distinctEmails(values: string[], primary: string | null | undefined) {
  const primaryNormalized = (primary ?? "").trim().toLowerCase();
  return values.filter(
    (value, index, all) =>
      value.toLowerCase() !== primaryNormalized &&
      all.findIndex(
        (candidate) => candidate.toLowerCase() === value.toLowerCase(),
      ) === index,
  );
}

function comparablePhone(value: string | null | undefined): string {
  const trimmed = (value ?? "").trim();
  const digits = trimmed.replace(/\D/g, "");
  return digits || trimmed.toLowerCase();
}

function distinctPhones(values: string[], primary: string | null | undefined) {
  const primaryComparable = comparablePhone(primary);
  return values.filter(
    (value, index, all) =>
      comparablePhone(value) !== primaryComparable &&
      all.findIndex(
        (candidate) => comparablePhone(candidate) === comparablePhone(value),
      ) === index,
  );
}

function parseBant(raw: unknown): boolean | null | undefined {
  if (raw == null || raw === "") return undefined;
  if (typeof raw === "boolean") return raw;
  const s = String(raw).trim().toLowerCase();
  if (["true", "yes", "y", "1"].includes(s)) return true;
  if (["false", "no", "n", "0"].includes(s)) return false;
  return undefined;
}

/**
 * Apply chat propose_update_contact / propose_delete_contact via Fastify.
 * MCP must not own these writes — person fields live in CDP + CRM overlays.
 */
export async function runContactCoworkerMutation(
  tool: AgentToolProposal,
  opts: { activeContactId?: string | null },
): Promise<true | false | string> {
  if (tool.name === "propose_set_lead_score") {
    const contactId = String(tool.args.contactId || opts.activeContactId || "").trim();
    const score = Number(tool.args.score);
    const reason = String(tool.args.reason || "").trim();
    if (!contactId) return "Open the contact before changing the lead score.";
    if (!Number.isInteger(score) || score < 0 || score > 100) {
      return "Lead score must be a whole number from 0 to 100.";
    }
    if (!reason) {
      return "Tell me why this score should change before I update it.";
    }
    const result = await setManualLeadScore(contactId, { score, reason });
    return result.ok ? true : result.error;
  }

  if (tool.name === "propose_update_contact") {
    const contactId = String(tool.args.contactId || opts.activeContactId || "");
    if (!contactId) return false;
    const detail = await fetchContactDetail(contactId);
    if (!detail.ok) return false;
    const person = detail.contact.person;
    const patch: Partial<ContactInput> = {};
    for (const key of CONTACT_PATCH_KEYS) {
      const val = tool.args[key];
      if (typeof val === "string" && val.trim()) {
        (patch as Record<string, string>)[key] = val.trim();
      }
    }
    if (
      patch.leadStatus !== undefined &&
      !LEAD_STATUSES.has(patch.leadStatus)
    ) {
      return "Lead status must be New, Contacted, Qualifying, Qualified, Disqualified, or Converted. Use the lead score action for a numeric score.";
    }
    const tags = parseCsvList(tool.args.tags);
    const requestedSecondaryEmails = parseCsvList(tool.args.secondaryEmails);
    const requestedSecondaryPhones = parseCsvList(tool.args.secondaryPhones);
    const secondaryEmails = requestedSecondaryEmails
      ? distinctEmails(requestedSecondaryEmails, patch.email ?? person.email)
      : undefined;
    const secondaryPhones = requestedSecondaryPhones
      ? distinctPhones(requestedSecondaryPhones, patch.phone ?? person.phone)
      : undefined;
    if (requestedSecondaryEmails?.length && !secondaryEmails?.length) {
      return "That email is already the primary email. Send a different address to add it as secondary.";
    }
    if (requestedSecondaryPhones?.length && !secondaryPhones?.length) {
      return "That number is already the primary phone. Send a different number to add it as secondary.";
    }
    const bantBudget = parseBant(tool.args.bantBudget);
    const bantAuthority = parseBant(tool.args.bantAuthority);
    const bantNeed = parseBant(tool.args.bantNeed);
    const bantTimeline = parseBant(tool.args.bantTimeline);

    if (
      Object.keys(patch).length === 0 &&
      tags === undefined &&
      secondaryEmails === undefined &&
      secondaryPhones === undefined &&
      bantBudget === undefined &&
      bantAuthority === undefined &&
      bantNeed === undefined &&
      bantTimeline === undefined
    ) {
      return false;
    }

    const payload: ContactInput = {
      firstName: patch.firstName ?? person.firstName,
      lastName: patch.lastName ?? person.lastName,
      email: patch.email ?? person.email,
      phone: patch.phone !== undefined ? patch.phone : person.phone,
      title: patch.title !== undefined ? patch.title : person.title,
      notes: patch.notes !== undefined ? patch.notes : person.notes,
      companyId:
        patch.companyId !== undefined ? patch.companyId : person.companyId,
      locationId:
        patch.locationId !== undefined ? patch.locationId : person.locationId,
      contactType:
        patch.contactType !== undefined
          ? patch.contactType
          : (person.contactType ?? undefined),
      leadStatus: patch.leadStatus !== undefined ? patch.leadStatus : person.leadStatus,
      status: patch.status !== undefined ? patch.status : (person.status ?? undefined),
      ownerUserId:
        patch.ownerUserId !== undefined
          ? patch.ownerUserId
          : person.ownerUserId,
      city: patch.city !== undefined ? patch.city : person.city,
      country: patch.country !== undefined ? patch.country : person.country,
      addressLine:
        patch.addressLine !== undefined
          ? patch.addressLine
          : person.addressLine,
      leadSource:
        patch.leadSource !== undefined ? patch.leadSource : person.leadSource,
      tags: tags ?? person.tags,
      secondaryEmails: secondaryEmails ?? person.secondaryEmails,
      secondaryPhones: secondaryPhones ?? person.secondaryPhones,
      bantBudget: bantBudget !== undefined ? bantBudget : person.bantBudget,
      bantAuthority:
        bantAuthority !== undefined ? bantAuthority : person.bantAuthority,
      bantNeed: bantNeed !== undefined ? bantNeed : person.bantNeed,
      bantTimeline:
        bantTimeline !== undefined ? bantTimeline : person.bantTimeline,
    };
    const result = await updateContact(contactId, payload);
    return result.ok ? true : false;
  }

  if (tool.name === "propose_delete_contact") {
    const contactId = String(tool.args.contactId || opts.activeContactId || "");
    if (!contactId) return false;
    const result = await deleteContact(contactId);
    if (result.ok) return true;
    return result.error?.trim() || false;
  }

  return false;
}
