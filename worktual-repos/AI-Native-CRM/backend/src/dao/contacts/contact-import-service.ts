/**
 * Contact CSV import — parse + upsert through the same create command as the UI.
 */

import type { ContactInput } from "@/dao/contacts/contact-service";
import { parseCsv } from "@/lib/csv";
import { showCompanyOnContacts } from "@/lib/business-type-copy";
import type { BusinessType } from "@/config/modules";
import { getCurrentBusinessType } from "@/service/auth/require-role";
import { resolveContactTypeForChannels } from "@/lib/contact-lifecycle";

export const MAX_CONTACT_IMPORT_ROWS = 500;

export const CONTACT_CSV_SAMPLE_B2B = `first_name,last_name,email,phone,title,company,company_domain,contact_type,lead_status,lead_source,status
Priya,Nair,priya.nair@acme.com,+91 98765 43210,VP Sales,Acme Corp,acme.com,lead,new,csv_import,active
James,Chen,james.chen@globex.io,+1 415 555 0199,Director,Globex,globex.io,lead,contacted,csv_import,active
`;

export const CONTACT_CSV_SAMPLE_B2C = `first_name,last_name,email,phone,title,contact_type,lead_status,lead_source,status
Asha,Patel,asha.patel@gmail.com,+1 206 555 0144,,lead,new,csv_import,active
`;

export function contactImportSampleCsv(businessType: string | null | undefined): {
  filename: string;
  content: string;
} {
  if (businessType === "b2c") {
    return {
      filename: "contacts-import-sample-b2c.csv",
      content: CONTACT_CSV_SAMPLE_B2C,
    };
  }
  return {
    filename: "contacts-import-sample.csv",
    content: CONTACT_CSV_SAMPLE_B2B,
  };
}

export type ContactImportRowError = {
  row: number;
  message: string;
  email?: string;
  displayName?: string;
};

export type ContactImportDuplicate = {
  row: number;
  email: string;
  phone?: string | null;
  displayName: string;
  reason: string;
};

export type ContactImportResult = {
  parsed: number;
  created: number;
  updated: number;
  skipped: number;
  errors: ContactImportRowError[];
  duplicates: ContactImportDuplicate[];
};

type ImportField =
  | "firstName"
  | "lastName"
  | "email"
  | "phone"
  | "title"
  | "companyName"
  | "companyDomain"
  | "contactType"
  | "leadStatus"
  | "leadSource"
  | "status"
  | "city"
  | "country"
  | "notes"
  | "fullName";

const HEADER_ALIASES: Record<string, ImportField> = {
  first_name: "firstName",
  firstname: "firstName",
  first: "firstName",
  last_name: "lastName",
  lastname: "lastName",
  last: "lastName",
  name: "fullName",
  full_name: "fullName",
  fullname: "fullName",
  email: "email",
  e_mail: "email",
  phone: "phone",
  mobile: "phone",
  title: "title",
  job_title: "title",
  company: "companyName",
  company_name: "companyName",
  company_domain: "companyDomain",
  domain: "companyDomain",
  contact_type: "contactType",
  stage: "contactType",
  lifecycle: "contactType",
  lead_status: "leadStatus",
  leadstatus: "leadStatus",
  lead_source: "leadSource",
  source: "leadSource",
  status: "status",
  city: "city",
  country: "country",
  notes: "notes",
  note: "notes",
};

const LIFECYCLE_VALUES = new Set([
  "contact",
  "lead",
  "prospect",
  "customer",
  "churned",
]);
const LEAD_STATUS_VALUES = new Set([
  "new",
  "contacted",
  "qualifying",
  "qualified",
  "disqualified",
  "converted",
]);
const STATUS_VALUES = new Set(["active", "inactive", "archived"]);

function normalizeHeader(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, "_");
}

function splitFullName(name: string): { firstName: string; lastName: string } {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: "", lastName: "" };
  if (parts.length === 1) return { firstName: parts[0]!, lastName: "-" };
  return { firstName: parts[0]!, lastName: parts.slice(1).join(" ") };
}

function parseEnum(
  raw: string | undefined,
  allowed: Set<string>,
  fallback: string,
): string {
  const v = (raw ?? "").trim().toLowerCase().replace(/\s+/g, "_");
  if (!v) return fallback;
  if (allowed.has(v)) return v;
  return fallback;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type ParsedContactImportRow = {
  row: number;
  input: ContactInput;
};

export function csvToContactInputs(
  csvText: string,
  options: { includeCompany?: boolean } = {},
): { rows: ParsedContactImportRow[]; errors: ContactImportRowError[] } {
  const table = parseCsv(csvText.trim());
  if (table.length === 0) {
    return { rows: [], errors: [{ row: 0, message: "CSV is empty." }] };
  }

  const headers = table[0]!.map(normalizeHeader);
  const mapped = headers.map((h) => HEADER_ALIASES[h] ?? null);
  const hasEmail = mapped.includes("email");
  const hasName =
    mapped.includes("firstName") ||
    mapped.includes("lastName") ||
    mapped.includes("fullName");
  if (!hasEmail || !hasName) {
    return {
      rows: [],
      errors: [
        {
          row: 1,
          message:
            "CSV needs email plus name columns (first_name + last_name, or name). Optional: phone, title, company, company_domain, contact_type, lead_status, lead_source, status, city, country, notes.",
        },
      ],
    };
  }

  const includeCompany = options.includeCompany !== false;
  const rows: ParsedContactImportRow[] = [];
  const errors: ContactImportRowError[] = [];

  for (let i = 1; i < table.length; i++) {
    if (rows.length >= MAX_CONTACT_IMPORT_ROWS) {
      errors.push({
        row: i + 1,
        message: `Stopped at ${MAX_CONTACT_IMPORT_ROWS} data rows (max).`,
      });
      break;
    }
    const line = table[i]!;
    if (line.every((c) => !c.trim())) continue;

    const draft: Partial<Record<ImportField, string>> = {};
    mapped.forEach((key, col) => {
      if (!key) return;
      draft[key] = (line[col] ?? "").trim();
    });

    let firstName = (draft.firstName ?? "").trim();
    let lastName = (draft.lastName ?? "").trim();
    if ((!firstName || !lastName) && draft.fullName?.trim()) {
      const split = splitFullName(draft.fullName);
      if (!firstName) firstName = split.firstName;
      if (!lastName) lastName = split.lastName;
    }

    const email = (draft.email ?? "").trim().toLowerCase();
    const rowNum = i + 1;
    const identity = {
      ...(email ? { email } : {}),
      ...((firstName || lastName)
        ? { displayName: `${firstName} ${lastName}`.trim() || undefined }
        : {}),
    };
    if (!firstName) {
      errors.push({ row: rowNum, message: "Missing first name.", ...identity });
      continue;
    }
    if (email && !EMAIL_RE.test(email)) {
      errors.push({
        row: rowNum,
        message: "Enter a valid email address.",
        ...((firstName || lastName)
          ? { displayName: `${firstName} ${lastName}`.trim() }
          : {}),
      });
      continue;
    }

    const phone = draft.phone?.trim() || null;
    const requestedType = parseEnum(
      draft.contactType,
      LIFECYCLE_VALUES,
      "contact",
    );
    const contactType = resolveContactTypeForChannels({
      requested: requestedType,
      existing: "contact",
      email,
      phone,
    });

    const companyName = includeCompany
      ? draft.companyName?.trim() || null
      : null;
    const companyDomain = includeCompany
      ? draft.companyDomain?.trim() || null
      : null;

    rows.push({
      row: rowNum,
      input: {
        firstName,
        lastName,
        email,
        phone,
        title: draft.title?.trim() || null,
        companyName,
        companyDomain,
        contactType,
        leadStatus: parseEnum(draft.leadStatus, LEAD_STATUS_VALUES, "new"),
        leadSource: draft.leadSource?.trim() || "csv_import",
        status: parseEnum(draft.status, STATUS_VALUES, "active"),
        city: draft.city?.trim() || null,
        country: draft.country?.trim() || null,
        notes: draft.notes?.trim() || null,
      },
    });
  }

  return { rows, errors };
}

function normImportEmail(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function normImportPhone(value: string | null | undefined): string {
  return (value ?? "").replace(/\D+/g, "");
}

/**
 * Org-scoped email/phone duplicate for CSV import (skip, do not merge).
 * Matches primary or secondary identity keys on contacts in this tenant.
 */
export async function findImportDuplicateByEmailOrPhone(input: {
  organizationId: string;
  email: string;
  phone?: string | null;
}): Promise<{ reason: string } | null> {
  const orgId = input.organizationId.trim();
  const email = normImportEmail(input.email);
  const phoneDigits = normImportPhone(input.phone);
  if (!orgId || (!email && phoneDigits.length < 7)) return null;

  const { accountQuery } = await import("@/dao/db/account-pool");
  const { prisma } = await import("@/dao/db/prisma");

  if (email) {
    const { rows } = await accountQuery<{ id: string }>(
      `SELECT p.cdp_id::text AS id
       FROM cdp.identity_keys k
       INNER JOIN cdp.customer_profile p ON p.cdp_id = k.cdp_id
       WHERE k.key_type IN ('email', 'email_secondary')
         AND lower(k.key_value) = $1
         AND p.organization_id = $2::bigint
       LIMIT 1`,
      [email, orgId],
    );
    const accountContactId = rows[0]?.id ?? null;
    if (accountContactId) {
      const profile = await prisma.contactProfile.findFirst({
        where: { accountContactId, organizationId: orgId },
        select: { accountContactId: true },
      });
      if (profile) {
        return { reason: `Duplicate email (${email})` };
      }
    }
  }

  if (phoneDigits.length >= 7) {
    const { rows } = await accountQuery<{ id: string }>(
      `SELECT p.cdp_id::text AS id
       FROM cdp.identity_keys k
       INNER JOIN cdp.customer_profile p ON p.cdp_id = k.cdp_id
       WHERE k.key_type IN ('phone', 'phone_secondary')
         AND regexp_replace(k.key_value, '\\D', '', 'g') = $1
         AND length(regexp_replace(k.key_value, '\\D', '', 'g')) >= 7
         AND p.organization_id = $2::bigint
       LIMIT 1`,
      [phoneDigits, orgId],
    );
    const accountContactId = rows[0]?.id ?? null;
    if (accountContactId) {
      const profile = await prisma.contactProfile.findFirst({
        where: { accountContactId, organizationId: orgId },
        select: { accountContactId: true },
      });
      if (profile) {
        return { reason: `Duplicate phone (${input.phone?.trim() || phoneDigits})` };
      }
    }
  }

  return null;
}

export async function importContactsFromCsv(
  csvText: string,
  options: { dryRun?: boolean } = {},
): Promise<ContactImportResult> {
  const businessType: BusinessType = await getCurrentBusinessType();
  const includeCompany = showCompanyOnContacts(businessType);
  const parsed = csvToContactInputs(csvText, { includeCompany });
  const baseErrors = [...parsed.errors];

  const { getCurrentOrganizationId } = await import(
    "@/service/auth/require-role"
  );
  const organizationId = await getCurrentOrganizationId();

  const duplicates: ContactImportDuplicate[] = [];
  const seenEmails = new Set<string>();
  const seenPhones = new Set<string>();
  const createRows: Array<{ row: number; input: ContactInput }> = [];

  for (const entry of parsed.rows) {
    const email = normImportEmail(entry.input.email);
    const phoneDigits = normImportPhone(entry.input.phone);
    const displayName =
      `${entry.input.firstName} ${entry.input.lastName}`.trim();

    if (email && seenEmails.has(email)) {
      duplicates.push({
        row: entry.row,
        email,
        phone: entry.input.phone,
        displayName,
        reason: `Duplicate email in this CSV (${email})`,
      });
      continue;
    }
    if (phoneDigits.length >= 7 && seenPhones.has(phoneDigits)) {
      duplicates.push({
        row: entry.row,
        email,
        phone: entry.input.phone,
        displayName,
        reason: `Duplicate phone in this CSV (${entry.input.phone?.trim() || phoneDigits})`,
      });
      continue;
    }

    const existing = organizationId
      ? await findImportDuplicateByEmailOrPhone({
          organizationId,
          email,
          phone: entry.input.phone,
        })
      : null;
    if (existing) {
      duplicates.push({
        row: entry.row,
        email,
        phone: entry.input.phone,
        displayName,
        reason: existing.reason,
      });
      continue;
    }

    if (email) seenEmails.add(email);
    if (phoneDigits.length >= 7) seenPhones.add(phoneDigits);
    createRows.push(entry);
  }

  if (options.dryRun) {
    return {
      parsed: parsed.rows.length,
      created: createRows.length,
      updated: 0,
      skipped: duplicates.length,
      errors: baseErrors,
      duplicates,
    };
  }

  const { createContactCommand } = await import(
    "@/service/contacts/contact-commands"
  );

  let created = 0;
  const errors = [...baseErrors];

  for (const entry of createRows) {
    const result = await createContactCommand(entry.input, {
      mergeDuplicates: false,
    });
    if (!result.ok) {
      const msg = result.error;
      const looksDuplicate = /already exists|duplicate|unique/i.test(msg);
      if (looksDuplicate) {
        duplicates.push({
          row: entry.row,
          email: entry.input.email,
          phone: entry.input.phone,
          displayName: `${entry.input.firstName} ${entry.input.lastName}`.trim(),
          reason: msg,
        });
      } else {
        errors.push({
          row: entry.row,
          message: msg,
          email: entry.input.email,
          displayName: `${entry.input.firstName} ${entry.input.lastName}`.trim(),
        });
      }
      continue;
    }
    created += 1;
  }

  return {
    parsed: parsed.rows.length,
    created,
    updated: 0,
    skipped: duplicates.length,
    errors,
    duplicates,
  };
}
