import {
  getDialCodeForCountry,
  MOBILE_VALIDATION_RULES,
  trimMobileNumberForDialCode,
  validateMobileForDialCode,
} from "./countryDefaults.js";
import { isValidEmailAddress } from "./emailValidation.js";
import { COUNTRY_OPTIONS } from "./leads.js";

export const BULK_USER_DEFAULT_PASSWORD = "Welcome@123";

export const USER_BULK_CSV_HEADERS = [
  "Work email",
  "Role",
  "Display name",
  "Country",
  "Mobile country code",
  "Mobile number",
];

export const USER_BULK_INVALID_HEADERS = [...USER_BULK_CSV_HEADERS, "Reason"];

const VALID_ROLES = new Set(["sales", "finance", "sales_admin", "number_management"]);
const VALID_MOBILE_CODES = new Set(Object.keys(MOBILE_VALIDATION_RULES));
const ROLE_ALIASES = {
  "sales executive": "sales",
  sales: "sales",
  finance: "finance",
  "sales admin": "sales_admin",
  sales_admin: "sales_admin",
  salesadmin: "sales_admin",
  "number management": "number_management",
  number_management: "number_management",
  numbermanagement: "number_management",
};

function escapeCsvCell(value: any) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

function detectDelimiter(line: any) {
  const candidates = [",", "\t", ";"];
  let best = ",";
  let bestCount = 0;

  for (const delimiter of candidates) {
    const count = line.split(delimiter).length;
    if (count > bestCount) {
      bestCount = count;
      best = delimiter;
    }
  }

  return bestCount > 1 ? best : ",";
}

function parseCsvLine(line: any, delimiter: any = ",") {
  if (delimiter !== ",") {
    return line.split(delimiter).map((cell: any) => cell.trim());
  }

  const cells: any[] = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      cells.push(current.trim());
      current = "";
      continue;
    }

    current += char;
  }

  cells.push(current.trim());
  return cells;
}

function normalizeHeader(value: any) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function normalizeRole(value: any) {
  const raw = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
  return (ROLE_ALIASES as Record<string, any>)[raw] || raw.replace(/\s+/g, "_");
}

function normalizeMobileCountryCode(value: any, country: any = "") {
  let code = String(value || "").trim();

  if (!code && country) {
    return getDialCodeForCountry(country);
  }

  if (!code) {
    return "";
  }

  if (/^\d+$/.test(code)) {
    return `+${code}`;
  }

  if (!code.startsWith("+")) {
    return `+${code.replace(/^\+/, "")}`;
  }

  return code;
}

export function isValidWorkEmail(value: any) {
  return isValidEmailAddress(value);
}

function hasMeaningfulValue(record: any) {
  return Boolean(
    String(record.email || "").trim() ||
      String(record.role || "").trim() ||
      String(record.displayName || "").trim() ||
      String(record.country || "").trim() ||
      String(record.mobileCountryCode || "").trim() ||
      String(record.mobileNumber || "").trim(),
  );
}

export function validateBulkUserRecord(record: any, { duplicateEmails }: any = { duplicateEmails: new Set() }) {
  const errors: any[] = [];
  const email = String(record.email || "").trim().toLowerCase();
  const role = normalizeRole(record.role);
  const displayName = String(record.displayName || "").trim();
  const country = String(record.country || "").trim();
  const mobileCountryCode = normalizeMobileCountryCode(record.mobileCountryCode, country);
  const mobileNumber = String(record.mobileNumber || "").replace(/\D/g, "");

  if (!email) {
    errors.push("Work email is required.");
  } else if (!isValidWorkEmail(email)) {
    errors.push("Work email must be a valid email address.");
  } else if (duplicateEmails.has(email)) {
    errors.push("Work email is duplicated in this file.");
  }

  if (!String(record.role || "").trim()) {
    errors.push("Role is required.");
  } else if (!VALID_ROLES.has(role)) {
    errors.push("Role must be sales, finance, sales_admin, or number_management.");
  }

  if (!displayName) {
    errors.push("Display name is required.");
  }

  if (!country) {
    errors.push("Country is required.");
  } else if (!COUNTRY_OPTIONS.includes(country)) {
    errors.push(`Country must be one of: ${COUNTRY_OPTIONS.join(", ")}.`);
  }

  if (!mobileCountryCode) {
    errors.push("Mobile country code is required.");
  } else if (!VALID_MOBILE_CODES.has(mobileCountryCode)) {
    errors.push(
      `Mobile country code must include a supported dial code (e.g. +91). Received "${String(record.mobileCountryCode || "").trim() || "empty"}".`,
    );
  }

  if (!mobileNumber) {
    errors.push("Mobile number is required.");
  } else if (mobileCountryCode && VALID_MOBILE_CODES.has(mobileCountryCode)) {
    const rule = (MOBILE_VALIDATION_RULES as Record<string, any>)[mobileCountryCode];
    if (mobileNumber.length !== rule.digits) {
      errors.push(
        `Mobile number must be exactly ${rule.digits} digits for ${rule.country}. Received ${mobileNumber.length} digits.`,
      );
    } else {
      const formatError = validateMobileForDialCode(mobileCountryCode, mobileNumber);
      if (formatError) {
        errors.push(formatError);
      }
    }
  }

  return {
    errors,
    normalized: {
      rowNumber: record.rowNumber,
      email,
      role,
      displayName,
      country,
      mobileCountryCode: mobileCountryCode || "+91",
      mobileNumber: mobileCountryCode
        ? trimMobileNumberForDialCode(mobileNumber, mobileCountryCode)
        : mobileNumber,
      password: BULK_USER_DEFAULT_PASSWORD,
    },
  };
}

/** Browser download helpers live in frontend/src/lib/userBulkUpload.js. */

export function parseUserBulkCsv(text: any) {
  const normalized = String(text || "")
    .replace(/^\uFEFF/, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
  const lines = normalized.split("\n").map((line: any) => line.trim()).filter(Boolean);

  if (!lines.length) {
    return {
      validRows: [],
      invalidRows: [],
      totalRows: 0,
      fileErrors: ["The uploaded file is empty."],
    };
  }

  const delimiter = detectDelimiter(lines[0]);
  const headerCells = parseCsvLine(lines[0], delimiter).map(normalizeHeader);
  const headerIndex = Object.fromEntries(headerCells.map((header: any, index: any) => [header, index]));

  const requiredHeaders = ["work email", "role", "display name", "country", "mobile number"];
  const missingHeaders = requiredHeaders.filter((header: any) => headerIndex[header] === undefined);

  if (missingHeaders.length) {
    return {
      validRows: [],
      invalidRows: [],
      totalRows: 0,
      fileErrors: [
        `Missing required columns: ${missingHeaders.join(", ")}. Use the downloaded CSV template.`,
      ],
    };
  }

  const rawRows: any[] = [];
  const emailCounts = new Map();

  for (let lineIndex = 1; lineIndex < lines.length; lineIndex += 1) {
    const cells = parseCsvLine(lines[lineIndex], delimiter);
    const read = (header: any) => cells[headerIndex[header]] ?? "";

    const record = {
      rowNumber: lineIndex + 1,
      email: read("work email"),
      role: read("role"),
      displayName: read("display name"),
      country: read("country"),
      mobileCountryCode: read("mobile country code"),
      mobileNumber: read("mobile number"),
    };

    if (!hasMeaningfulValue(record)) {
      continue;
    }

    rawRows.push(record);
    const emailKey = String(record.email || "").trim().toLowerCase();
    if (emailKey) {
      emailCounts.set(emailKey, (emailCounts.get(emailKey) || 0) + 1);
    }
  }

  if (!rawRows.length) {
    return {
      validRows: [],
      invalidRows: [],
      totalRows: 0,
      fileErrors: ["No user rows were found in the uploaded file."],
    };
  }

  const duplicateEmails = new Set(
    [...emailCounts.entries()].filter(([, count]: any) => count > 1).map(([email]: any) => email),
  );

  const validRows: any[] = [];
  const invalidRows: any[] = [];

  for (const record of rawRows) {
    const { errors, normalized } = validateBulkUserRecord(record, { duplicateEmails });

    if (errors.length) {
      invalidRows.push({
        rowNumber: record.rowNumber,
        email: record.email,
        role: record.role,
        displayName: record.displayName,
        country: record.country,
        mobileCountryCode: record.mobileCountryCode,
        mobileNumber: record.mobileNumber,
        errors,
      });
      continue;
    }

    validRows.push(normalized);
  }

  return {
    validRows,
    invalidRows,
    totalRows: rawRows.length,
    fileErrors: [],
  };
}

export function toInvalidImportRow(row: any, message: any) {
  return {
    rowNumber: row.rowNumber,
    email: row.email,
    role: row.role,
    displayName: row.displayName,
    country: row.country,
    mobileCountryCode: row.mobileCountryCode,
    mobileNumber: row.mobileNumber,
    errors: [message],
  };
}
