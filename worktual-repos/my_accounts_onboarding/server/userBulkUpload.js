export {
  BULK_USER_DEFAULT_PASSWORD,
  downloadInvalidUserBulkRecords,
  downloadUserBulkTemplate,
  isValidWorkEmail,
  parseUserBulkCsv,
  toInvalidImportRow,
  validateBulkUserRecord,
  USER_BULK_CSV_HEADERS,
  USER_BULK_INVALID_HEADERS,
} from "../src/lib/userBulkUpload.js";

export function normalizeUploadedCsvText(text) {
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

export async function previewBulkUserCsv(csvText) {
  const { parseUserBulkCsv } = await import("../src/lib/userBulkUpload.js");
  const parsed = parseUserBulkCsv(normalizeUploadedCsvText(csvText));
  return enrichBulkUploadWithExistingUsers(parsed);
}

async function getExistingUserEmails() {
  const { selectAllUserEmails } = await import("./repositories/raw/users.repo.js");
  const emails = await selectAllUserEmails();
  return new Set(emails);
}

export async function enrichBulkUploadWithExistingUsers(parsed) {
  if (parsed.fileErrors?.length || !parsed.validRows?.length) {
    return parsed;
  }

  const { toInvalidImportRow } = await import("../src/lib/userBulkUpload.js");
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

export async function importBulkUserCsv(csvText, { actorEmail }) {
  const { BULK_USER_DEFAULT_PASSWORD, parseUserBulkCsv } = await import("../src/lib/userBulkUpload.js");
  const { createUser } = await import("./users.js");

  const parsed = await enrichBulkUploadWithExistingUsers(
    parseUserBulkCsv(normalizeUploadedCsvText(csvText)),
  );

  if (parsed.fileErrors?.length) {
    return {
      ...parsed,
      created: [],
      importInvalidRows: [],
    };
  }

  const created = [];
  const importInvalidRows = [];

  for (const row of parsed.validRows) {
    try {
      await createUser(
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
    } catch (error) {
      const { toInvalidImportRow } = await import("../src/lib/userBulkUpload.js");
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
  };
}
