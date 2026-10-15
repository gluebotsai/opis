export {
  BULK_USER_DEFAULT_PASSWORD,
  isValidWorkEmail,
  parseUserBulkCsv,
  toInvalidImportRow,
  validateBulkUserRecord,
  USER_BULK_CSV_HEADERS,
  USER_BULK_INVALID_HEADERS,
} from "../../lib/userBulkUpload.js";

export function normalizeUploadedCsvText(text: any) {
  const raw = String(text || "");

  if (raw.startsWith("PK")) {
    throw new Error(
      "This looks like an Excel workbook (.xlsx). Save as CSV UTF-8 (Comma delimited) and upload again.",
    );
  }

  if (raw.includes("\u0000")) {
    throw new Error(
      "Could not read this CSV encoding. In Excel use File → Save As → CSV UTF-8 (Comma delimited).",
    );
  }

  return raw.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

export async function previewBulkUserCsv(csvText: any) {
  const { parseUserBulkCsv } = await import("../../lib/userBulkUpload.js");
  const parsed = parseUserBulkCsv(normalizeUploadedCsvText(csvText));
  return enrichBulkUploadWithExistingUsers(parsed);
}

async function getExistingUserEmails() {
  const { selectAllUserEmails } = await import("../../repositories/raw/users.repo.js");
  const emails = await selectAllUserEmails();
  return new Set(emails);
}

export async function enrichBulkUploadWithExistingUsers(parsed: any) {
  if (parsed.fileErrors?.length || !parsed.validRows?.length) {
    return parsed;
  }

  const { toInvalidImportRow } = await import("../../lib/userBulkUpload.js");
  const existingEmails = await getExistingUserEmails();
  const validRows = [];
  const invalidRows = [...(parsed.invalidRows || [])];

  for (const row of parsed.validRows) {
    const email = String(row.email || "").trim().toLowerCase();
    if (existingEmails.has(email)) {
      invalidRows.push(
        toInvalidImportRow(row, "A user with this email already exists."),
      );
      continue;
    }

    validRows.push(row);
  }

  return {
    ...parsed,
    validRows,
    invalidRows,
  };
}

export async function importBulkUserCsv(csvText: any, { actorEmail }: any) {
  const { BULK_USER_DEFAULT_PASSWORD, parseUserBulkCsv } = await import("../../lib/userBulkUpload.js");
  const { createUser } = await import("./user-store.js");
  const { notifyStaffUserCreated } = await import("../notifications/service.js");

  const parsed = await enrichBulkUploadWithExistingUsers(
    parseUserBulkCsv(normalizeUploadedCsvText(csvText)),
  );

  if (parsed.fileErrors?.length) {
    return {
      ...parsed,
      created: [],
      importInvalidRows: [],
      emailSentCount: 0,
      emailFailedCount: 0,
      emailFailures: [],
    };
  }

  const created = [];
  const importInvalidRows = [];
  const emailFailures = [];
  let emailSentCount = 0;

  for (const row of parsed.validRows) {
    try {
      const user = await createUser(
        {
          email: row.email,
          password: BULK_USER_DEFAULT_PASSWORD,
          role: row.role,
          displayName: row.displayName,
          country: row.country,
          mobileCountryCode: row.mobileCountryCode,
          mobileNumber: row.mobileNumber,
        },
        actorEmail,
      );
      created.push(row);

      try {
        await notifyStaffUserCreated({
          user,
          plainPassword: BULK_USER_DEFAULT_PASSWORD,
        });
        emailSentCount += 1;
      } catch (mailError) {
        emailFailures.push({
          email: row.email,
          error: mailError instanceof Error ? mailError.message : "Could not send login email.",
        });
      }
    } catch (error) {
      const { toInvalidImportRow } = await import("../../lib/userBulkUpload.js");
      importInvalidRows.push(
        toInvalidImportRow(
          row,
          error instanceof Error ? error.message : "Could not create this user.",
        ),
      );
    }
  }

  const invalidRows = [...(parsed.invalidRows || []), ...importInvalidRows];

  return {
    validRows: created,
    invalidRows,
    totalRows: parsed.totalRows,
    fileErrors: parsed.fileErrors,
    created,
    importInvalidRows,
    emailSentCount,
    emailFailedCount: emailFailures.length,
    emailFailures,
  };
}
