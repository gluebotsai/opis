import {
  findLeadContactConflicts,
  findTaxNumberUsages,
} from "../../repositories/raw/leads.repo.js";
import { selectUserIdByNormalizedPhone } from "../../repositories/raw/users.repo.js";
import { assertValidEmailAddress } from "../../lib/email-validation-runtime.js";
import { assertValidLeadTaxNumbers, normalizeTaxNumber } from "../platform/tax-number.js";
import { assertValidLeadMobiles } from "../../lib/mobile-validation.js";

export function normalizeEmail(email: any) {
  return String(email || "").trim().toLowerCase();
}

export function normalizePhone(countryCode = "", mobileNumber = "") {
  const numberDigits = String(mobileNumber || "").replace(/\D/g, "");
  if (!numberDigits) {
    return "";
  }

  return String(`${countryCode || ""}${mobileNumber || ""}`).replace(/\D/g, "");
}

export { normalizeTaxNumber };

export function normalizeState(state: any) {
  return String(state || "").trim().toLowerCase();
}

/**
 * HQ + branch work emails must be unique within a company.
 * adminEmail may match HQ workEmail and is not part of this check.
 */
export function assertUniqueLeadWorkEmails(payload = {}) {
  const entries = [];
  const hqEmail = normalizeEmail((payload as any).workEmail);
  if (hqEmail) {
    entries.push({ email: hqEmail, label: "Head office" });
  }

  for (const [index, entry] of ((payload as any).additionalAddresses || []).entries()) {
    const email = normalizeEmail(entry?.workEmail);
    if (!email) {
      continue;
    }
    entries.push({
      email,
      label: String(entry?.label || "").trim() || `Branch ${index + 1}`,
    });
  }

  const seen = new Map();
  for (const entry of entries) {
    const prior = seen.get(entry.email);
    if (prior) {
      throw new Error(
        `Work email ${entry.email} is used by both ${prior} and ${entry.label}. Each branch needs a unique work email.`,
      );
    }
    seen.set(entry.email, entry.label);
  }
}

function normalizeLeadAddress(value: any) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

const LEAD_ADDRESS_FORMAT_PATTERN = /^[A-Za-z0-9 ,.\-/#']+$/;

export function isValidLeadAddressFormat(value: any) {
  const text = String(value || "").trim();
  if (!text) {
    return true;
  }
  return LEAD_ADDRESS_FORMAT_PATTERN.test(text.replace(/\s+/g, " "));
}

export function assertValidLeadAddressFormats(payload = {}) {
  if (String((payload as any).billingAddress || "").trim() && !isValidLeadAddressFormat((payload as any).billingAddress)) {
    throw new Error(
      "Head office address can only include letters, numbers, spaces, and , . - / # '.",
    );
  }

  for (const [index, entry] of ((payload as any).additionalAddresses || []).entries()) {
    if (!String(entry?.address || "").trim()) {
      continue;
    }
    if (!isValidLeadAddressFormat(entry.address)) {
      const label = String(entry?.label || "").trim() || `Branch ${index + 1}`;
      throw new Error(
        `${label} address can only include letters, numbers, spaces, and , . - / # '.`,
      );
    }
  }
}

/**
 * HQ + branch physical addresses must be unique within a company.
 */
export function assertUniqueLeadAddresses(payload = {}) {
  const entries = [];
  const hqAddress = normalizeLeadAddress((payload as any).billingAddress);
  if (hqAddress) {
    entries.push({ address: hqAddress, label: "Head office" });
  }

  for (const [index, entry] of ((payload as any).additionalAddresses || []).entries()) {
    const address = normalizeLeadAddress(entry?.address);
    if (!address) {
      continue;
    }
    entries.push({
      address,
      label: String(entry?.label || "").trim() || `Branch ${index + 1}`,
    });
  }

  const seen = new Map();
  for (const entry of entries) {
    const prior = seen.get(entry.address);
    if (prior) {
      throw new Error(
        `Address is used by both ${prior} and ${entry.label}. Each branch needs a unique address.`,
      );
    }
    seen.set(entry.address, entry.label);
  }
}

export function resolveBranchWorkEmail(lead = {}, billingBranchId = "hq") {
  const branchId = String(billingBranchId || "hq");
  if (branchId && branchId !== "hq") {
    const addr = ((lead as any).additionalAddresses || []).find((entry: any) => String(entry.id) === branchId);
    return normalizeEmail(addr?.workEmail);
  }
  return normalizeEmail((lead as any).workEmail);
}

export function resolveBranchLabel(lead = {}, billingBranchId = "hq") {
  const branchId = String(billingBranchId || "hq");
  if (branchId && branchId !== "hq") {
    const addr = ((lead as any).additionalAddresses || []).find((entry: any) => String(entry.id) === branchId);
    return String(addr?.label || "").trim() || "Branch";
  }
  return "Head office";
}

function phonesFromContact(contact = {}) {
  const phones = [];
  const primary = normalizePhone((contact as any).mobileCountryCode, (contact as any).mobileNumber);
  const secondary = normalizePhone(
    (contact as any).secondaryMobileCountryCode,
    (contact as any).secondaryMobileNumber,
  );

  if (primary) {
    phones.push(primary);
  }
  if (secondary) {
    phones.push(secondary);
  }

  return phones;
}

function emailsFromContact(contact = {}) {
  const emails = [];
  const workEmail = normalizeEmail((contact as any).workEmail);
  const adminEmail = normalizeEmail((contact as any).adminEmail);

  if (workEmail) {
    emails.push(workEmail);
  }
  if (adminEmail) {
    emails.push(adminEmail);
  }

  return emails;
}

export function assertValidLeadEmails(payload = {}) {
  assertValidEmailAddress((payload as any).workEmail, "Work email");
  assertValidEmailAddress((payload as any).adminEmail, "Admin email");

  for (const [index, entry] of ((payload as any).additionalAddresses || []).entries()) {
    const label = String(entry?.label || "").trim() || `Branch ${index + 1}`;
    assertValidEmailAddress(entry?.workEmail, `${label} work email`);
    assertValidEmailAddress(entry?.adminEmail, `${label} admin email`);
  }
}

export function collectLeadContacts(payload = {}) {
  const emails = new Set();
  const phones = new Set();

  for (const email of emailsFromContact(payload)) {
    emails.add(email);
  }
  for (const phone of phonesFromContact(payload)) {
    phones.add(phone);
  }

  for (const entry of (payload as any).additionalAddresses || []) {
    for (const email of emailsFromContact(entry)) {
      emails.add(email);
    }
    for (const phone of phonesFromContact(entry)) {
      phones.add(phone);
    }
  }

  return {
    emails: [...emails],
    phones: [...phones],
  };
}

export function collectTaxEntries(payload = {}) {
  const entries = [];

  const hqTax = normalizeTaxNumber((payload as any).taxNumber);
  if (hqTax) {
    entries.push({
      taxNumber: hqTax,
      state: String((payload as any).state || "").trim(),
      scope: "hq",
      label: "Head office",
    });
  }

  for (const [index, entry] of ((payload as any).additionalAddresses || []).entries()) {
    const taxNumber = normalizeTaxNumber(entry.taxNumber);
    if (!taxNumber) {
      continue;
    }

    entries.push({
      taxNumber,
      state: String(entry.state || "").trim(),
      scope: "branch",
      label: String(entry.label || "").trim() || `Branch ${index + 1}`,
      index,
    });
  }

  return entries;
}

export class LeadContactConflictError extends Error {
  constructor(message: any, contactConflict: any) {
    super(message);
    this.name = "LeadContactConflictError";
    (this as any).contactConflict = contactConflict || null;
    (this as any).status = 400;
  }
}

function baseConflictMessage(conflict: any, { phoneKind = "mobile" } = {}) {
  const source = String(conflict.source || "");
  const secondary = phoneKind === "secondary";

  if (source.startsWith("staff_")) {
    if (source.includes("email")) {
      return "This email is already used by a staff user.";
    }
    return secondary
      ? "This secondary mobile number is already used by a staff user."
      : "This mobile number is already used by a staff user.";
  }

  if (source === "customer_portal_email") {
    return "This email is already used by a customer portal login.";
  }
  if (source.startsWith("org_")) {
    return "This email is already used by a customer.";
  }
  if (source === "reseller_user_email") {
    return "This email is already used by a reseller login.";
  }
  if (source.startsWith("reseller_")) {
    if (source.includes("email")) {
      return "This email is already used by a reseller.";
    }
    return "This mobile number is already used by a reseller.";
  }
  if (source === "partner_user_email") {
    return "This email is already used by a partner login.";
  }
  if (source.startsWith("partner_")) {
    if (source.includes("email")) {
      return "This email is already used by a partner.";
    }
    return "This mobile number is already used by a partner.";
  }

  if (source.includes("admin_email")) {
    return "Admin email is already used by another lead.";
  }
  if (source.includes("work_email")) {
    return "Work email is already used by another lead.";
  }
  if (source.includes("mobile") || source.includes("phone")) {
    return secondary
      ? "This secondary mobile number is already used by another lead."
      : "This mobile number is already used by another lead.";
  }

  return "Contact details are already used by another account.";
}

function contactConflictMessage(conflict: any, identity = {}) {
  const base = baseConflictMessage(conflict, { phoneKind: (identity as any).phoneKind || "mobile" });
  if ((identity as any).scope === "branch" && (identity as any).branchLabel) {
    return `Branch "${(identity as any).branchLabel}": ${base}`;
  }
  if ((identity as any).scope === "hq") {
    return `Head office: ${base}`;
  }
  return base;
}

function buildContactConflict(conflict: any, identity = {}) {
  const message = contactConflictMessage(conflict, identity);
  return {
    message,
    field: (identity as any).field || null,
    scope: (identity as any).scope || "hq",
    branchId: (identity as any).branchId || null,
    branchLabel: (identity as any).branchLabel || null,
    phoneKind: (identity as any).phoneKind || null,
    source: conflict?.source || null,
    value: conflict?.value || null,
  };
}

function throwContactConflict(conflict: any, identity = {}) {
  const contactConflict = buildContactConflict(conflict, identity);
  throw new LeadContactConflictError(contactConflict.message, contactConflict);
}

/** Per-field contact entries so conflicts can be mapped back to HQ or branch inputs. */
export function collectLeadContactEntries(payload = {}) {
  const entries = [];

  const hqWorkEmail = normalizeEmail((payload as any).workEmail);
  if (hqWorkEmail) {
    entries.push({
      kind: "email",
      value: hqWorkEmail,
      field: "workEmail",
      scope: "hq",
      branchId: null,
      branchLabel: "Head office",
    });
  }

  const hqAdminEmail = normalizeEmail((payload as any).adminEmail);
  if (hqAdminEmail) {
    entries.push({
      kind: "email",
      value: hqAdminEmail,
      field: "adminEmail",
      scope: "hq",
      branchId: null,
      branchLabel: "Head office",
    });
  }

  const hqPrimary = normalizePhone((payload as any).mobileCountryCode, (payload as any).mobileNumber);
  if (hqPrimary) {
    entries.push({
      kind: "phone",
      value: hqPrimary,
      field: "mobileNumber",
      phoneKind: "mobile",
      scope: "hq",
      branchId: null,
      branchLabel: "Head office",
    });
  }

  const hqSecondary = normalizePhone(
    (payload as any).secondaryMobileCountryCode,
    (payload as any).secondaryMobileNumber,
  );
  if (hqSecondary) {
    entries.push({
      kind: "phone",
      value: hqSecondary,
      field: "secondaryMobileNumber",
      phoneKind: "secondary",
      scope: "hq",
      branchId: null,
      branchLabel: "Head office",
    });
  }

  for (const [index, entry] of ((payload as any).additionalAddresses || []).entries()) {
    const branchId = entry?.id || null;
    const branchLabel = String(entry?.label || "").trim() || `Branch ${index + 1}`;

    const workEmail = normalizeEmail(entry?.workEmail);
    if (workEmail) {
      entries.push({
        kind: "email",
        value: workEmail,
        field: "workEmail",
        scope: "branch",
        branchId,
        branchLabel,
      });
    }

    const adminEmail = normalizeEmail(entry?.adminEmail);
    if (adminEmail) {
      entries.push({
        kind: "email",
        value: adminEmail,
        field: "adminEmail",
        scope: "branch",
        branchId,
        branchLabel,
      });
    }

    const primary = normalizePhone(entry?.mobileCountryCode, entry?.mobileNumber);
    if (primary) {
      entries.push({
        kind: "phone",
        value: primary,
        field: "mobileNumber",
        phoneKind: "mobile",
        scope: "branch",
        branchId,
        branchLabel,
      });
    }

    const secondary = normalizePhone(
      entry?.secondaryMobileCountryCode,
      entry?.secondaryMobileNumber,
    );
    if (secondary) {
      entries.push({
        kind: "phone",
        value: secondary,
        field: "secondaryMobileNumber",
        phoneKind: "secondary",
        scope: "branch",
        branchId,
        branchLabel,
      });
    }
  }

  return entries;
}

export async function assertLeadPhoneAvailable(
  { mobileCountryCode = "", mobileNumber = "", phoneKind = "mobile" } = {},
  { ignoreLeadId = null } = {},
) {
  const phone = normalizePhone(mobileCountryCode, mobileNumber);
  if (!phone) {
    return;
  }

  const conflicts = await findLeadContactConflicts({
    emails: [],
    phones: ([phone] as any),
    ignoreLeadId,
  });
  if (conflicts.length) {
    throwContactConflict(conflicts[0], {
      field: phoneKind === "secondary" ? "secondaryMobileNumber" : "mobileNumber",
      phoneKind,
      scope: "hq",
      branchLabel: "Head office",
    });
  }
}

export async function assertLeadContactsAvailable(payload: any, { ignoreLeadId = null } = {}) {
  const entries = collectLeadContactEntries(payload);

  for (const entry of entries) {
    const conflicts = await findLeadContactConflicts({
      emails: (entry.kind === "email" ? [entry.value] : [] as any),
      phones: (entry.kind === "phone" ? [entry.value] : [] as any),
      ignoreLeadId,
    });
    if (!conflicts.length) {
      continue;
    }

    throwContactConflict(conflicts[0], {
      field: entry.field,
      phoneKind: entry.phoneKind,
      scope: entry.scope,
      branchId: entry.branchId,
      branchLabel: entry.branchLabel,
    });
  }
}

function assertIntraLeadTaxRules(entries: any) {
  const byTax = new Map();

  for (const entry of entries) {
    if (!byTax.has(entry.taxNumber)) {
      byTax.set(entry.taxNumber, []);
    }
    byTax.get(entry.taxNumber).push(entry);
  }

  for (const grouped of byTax.values()) {
    const states = new Set(grouped.map((entry: any) => normalizeState(entry.state)).filter(Boolean));
    if (states.size > 1) {
      throw new Error(
        `${grouped[0].taxNumber} cannot be reused across different states within the same company.`,
      );
    }
  }
}

export async function assertTaxNumbersValid(payload: any, { ignoreLeadId = null } = {}) {
  const entries = collectTaxEntries(payload);
  if (!entries.length) {
    return;
  }

  for (const entry of entries) {
    if (!entry.state) {
      throw new Error(`State is required for ${entry.label} when a tax number is provided.`);
    }
  }

  assertIntraLeadTaxRules(entries);

  for (const entry of entries) {
    const usages = await findTaxNumberUsages(entry.taxNumber, { ignoreLeadId });
    for (const usage of usages) {
      const sameLead = ignoreLeadId && usage.lead_id === ignoreLeadId;
      const sameState = normalizeState(usage.state) === normalizeState(entry.state);

      if (sameLead && sameState) {
        continue;
      }

      if (usage.lead_id !== ignoreLeadId) {
        throw new Error(`${entry.taxNumber} is already registered to another company.`);
      }

      throw new Error(
        `${entry.taxNumber} is already used in a different state for this company (${entry.label}).`,
      );
    }
  }
}

export async function validateLeadPayload(
  payload: any,
  { ignoreLeadId = null, skipTaxValidation = false } = {},
) {
  assertValidLeadEmails(payload);
  assertUniqueLeadWorkEmails(payload);
  assertValidLeadAddressFormats(payload);
  assertUniqueLeadAddresses(payload);
  if (!skipTaxValidation) {
    await assertValidLeadTaxNumbers(payload);
    await assertTaxNumbersValid(payload, { ignoreLeadId });
  }
  assertValidLeadMobiles(payload);
  await assertLeadContactsAvailable(payload, { ignoreLeadId });
}

export async function assertStaffContactAvailable(
  { email, mobileCountryCode, mobileNumber, phone }: any,
  { ignoreUserId = null } = {},
) {
  const normalizedEmail = normalizeEmail(email);
  const normalizedPhone =
    normalizePhone(mobileCountryCode, mobileNumber) || normalizePhone("", phone);

  const emails = normalizedEmail ? [normalizedEmail] : [];
  const phones = normalizedPhone ? [normalizedPhone] : [];

  if (emails.length) {
    const conflicts = (await findLeadContactConflicts({
      emails: emails as any,
      phones: [],
      ignoreUserId,
    }) as any);
    const leadConflict = conflicts.find((conflict: any) => !(conflict.source as any)?.startsWith("staff_"));
    if (leadConflict) {
      throw new Error(baseConflictMessage(leadConflict));
    }
  }

  if (phones.length) {
    const conflicts = (await findLeadContactConflicts({
      emails: [],
      phones: phones as any,
      ignoreUserId,
    }) as any);
    const leadConflict = conflicts.find((conflict: any) => !(conflict.source as any)?.startsWith("staff_"));
    if (leadConflict) {
      throw new Error(baseConflictMessage(leadConflict, { phoneKind: "mobile" }));
    }

    const existingUser = await selectUserIdByNormalizedPhone(normalizedPhone, ignoreUserId);
    if (existingUser) {
      throw new Error("This mobile number is already used by another staff user.");
    }
  }
}

export async function assertExternalAccountContactsAvailable(
  {
    emails = [],
    mobileCountryCode = "",
    mobileNumber = "",
  }: {
    emails?: any[];
    mobileCountryCode?: any;
    mobileNumber?: any;
  },
  {
    ignorePartnerId = null,
    ignoreResellerId = null,
  }: {
    ignorePartnerId?: any;
    ignoreResellerId?: any;
  } = {},
) {
  const normalizedEmails = [
    ...new Set((emails || []).map((email) => normalizeEmail(email)).filter(Boolean)),
  ];
  const normalizedPhone = normalizePhone(mobileCountryCode, mobileNumber);

  for (const email of normalizedEmails) {
    const conflicts = await findLeadContactConflicts({
      emails: [email],
      phones: [],
      ignorePartnerId,
      ignoreResellerId,
    });
    if (conflicts.length) {
      throw new Error(baseConflictMessage(conflicts[0]));
    }
  }

  if (!normalizedPhone) {
    return;
  }

  const conflicts = await findLeadContactConflicts({
    emails: [],
    phones: [normalizedPhone],
    ignorePartnerId,
    ignoreResellerId,
  });
  if (conflicts.length) {
    throw new Error(baseConflictMessage(conflicts[0], { phoneKind: "mobile" }));
  }
}
