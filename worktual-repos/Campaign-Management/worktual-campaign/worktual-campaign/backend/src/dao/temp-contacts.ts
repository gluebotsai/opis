// @ts-nocheck — worktual_bigint Prisma BigInt ids; runtime coerced to string in plugins/prisma.ts
import type { Prisma } from "@prisma/client";
import { prisma } from "../plugins/prisma.js";
import type { CampaignSessionUser } from "../types/auth.js";
import { AppError } from "../helpers/response-builders.js";
import { toStableDbId } from "../helpers/id-schema.js";
import {
  isValidEmailFormat,
  parseAndValidatePhone,
} from "../helpers/contact-validation.js";

export const MAX_TEMP_CONTACT_ROWS = 2000;

export type TempContactRowInput = {
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  phone?: string | null;
  companyName?: string | null;
  city?: string | null;
  name?: string | null;
  [key: string]: unknown;
};

export type TempContactPublic = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  companyName: string;
  city: string;
};

export type TempContactReplaceResult = {
  status: "completed";
  summary: {
    total: number;
    inserted: number;
    failed: number;
  };
  sample: TempContactPublic[];
  errors: Array<{ row: number; message: string; email?: string; phone?: string }>;
  temporary_contact_summary: string;
};

function splitName(raw: string): { first: string; last: string } {
  const parts = raw.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return { first: "", last: "" };
  if (parts.length === 1) return { first: parts[0], last: "" };
  return { first: parts[0], last: parts.slice(1).join(" ") };
}

function normalizeRow(row: TempContactRowInput, index: number) {
  const nameHint = String(row.name || "").trim();
  const split = nameHint ? splitName(nameHint) : { first: "", last: "" };
  const firstName =
    String(row.firstName || row.first_name || "").trim() || split.first;
  const lastName =
    String(row.lastName || row.last_name || "").trim() || split.last;
  const emailRaw = String(row.email || "").trim();
  const phoneRaw = String(row.phone || row.whatsappNumber || row.phoneNumber || "").trim();

  const email = emailRaw ? emailRaw.toLowerCase() : "";
  let phone = "";
  const errors: string[] = [];

  if (email) {
    if (!isValidEmailFormat(email)) {
      errors.push("Invalid email format");
    }
  }

  if (phoneRaw) {
    const parsed = parseAndValidatePhone(phoneRaw);
    if (!parsed.ok) {
      errors.push(parsed.message || "Invalid phone");
    } else {
      phone = parsed.e164;
    }
  }

  if (!email && !phone) {
    errors.push("Email or phone is required");
  }

  if (!firstName && !email && !phone) {
    errors.push("Name, email, or phone is required");
  }

  return {
    index: index + 1,
    ok: errors.length === 0,
    errors,
    firstName: firstName || (email ? email.split("@")[0] : "Contact"),
    lastName,
    email: errors.some((e) => e.includes("email")) ? "" : email,
    phone,
    companyName: String(row.companyName || row.company || "").trim(),
    city: String(row.city || "").trim(),
    raw: row as Prisma.InputJsonValue,
  };
}

async function assertOwnedSession(
  user: CampaignSessionUser,
  sessionId: string,
) {
  const id = toStableDbId(sessionId);
  const row = await prisma.campaignAgentSession.findFirst({
    where: {
      id,
      organizationId: user.organizationId,
      createdByUserId: user.id,
    },
    select: { id: true },
  });
  if (!row) {
    throw new AppError("Agent session not found", 404);
  }
  return String(row.id);
}

export async function listTempContactsDao(
  user: CampaignSessionUser,
  sessionId: string,
) {
  const sid = await assertOwnedSession(user, sessionId);
  const rows = await prisma.campaignSessionTempContact.findMany({
    where: { sessionId: sid, organizationId: user.organizationId },
    orderBy: { id: "asc" },
    take: MAX_TEMP_CONTACT_ROWS,
  });
  const sample = rows.slice(0, 5).map((r) => ({
    id: String(r.id),
    firstName: r.firstName,
    lastName: r.lastName,
    email: r.email,
    phone: r.phone,
    companyName: r.companyName,
    city: r.city,
  }));
  const summary =
    rows.length > 0
      ? `${rows.length} temporary contact(s) uploaded for this campaign`
      : "";
  return {
    count: rows.length,
    sample,
    temporary_contact_summary: summary,
  };
}

export async function clearTempContactsDao(
  user: CampaignSessionUser,
  sessionId: string,
) {
  const sid = await assertOwnedSession(user, sessionId);
  const result = await prisma.campaignSessionTempContact.deleteMany({
    where: { sessionId: sid, organizationId: user.organizationId },
  });
  return { deleted: result.count };
}

export async function replaceTempContactsDao(
  user: CampaignSessionUser,
  sessionId: string,
  rows: TempContactRowInput[],
): Promise<TempContactReplaceResult> {
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new AppError("Provide at least one contact row.", 400);
  }
  if (rows.length > MAX_TEMP_CONTACT_ROWS) {
    throw new AppError(
      `Temporary upload is limited to ${MAX_TEMP_CONTACT_ROWS} rows.`,
      400,
    );
  }

  const sid = await assertOwnedSession(user, sessionId);
  const normalized = rows.map((row, i) => normalizeRow(row, i));
  const valid = normalized.filter((r) => r.ok);
  const errors = normalized
    .filter((r) => !r.ok)
    .map((r) => ({
      row: r.index,
      message: r.errors.join("; "),
      email: String((rows[r.index - 1] as TempContactRowInput)?.email || ""),
      phone: String((rows[r.index - 1] as TempContactRowInput)?.phone || ""),
    }));

  await prisma.$transaction(async (tx) => {
    await tx.campaignSessionTempContact.deleteMany({
      where: { sessionId: sid, organizationId: user.organizationId },
    });
    if (valid.length) {
      await tx.campaignSessionTempContact.createMany({
        data: valid.map((r) => ({
          sessionId: sid,
          organizationId: user.organizationId,
          firstName: r.firstName,
          lastName: r.lastName,
          email: r.email,
          phone: r.phone,
          companyName: r.companyName,
          city: r.city,
          raw: r.raw,
        })),
      });
    }
  });

  const listed = await listTempContactsDao(user, sessionId);
  return {
    status: "completed",
    summary: {
      total: rows.length,
      inserted: valid.length,
      failed: errors.length,
    },
    sample: listed.sample,
    errors,
    temporary_contact_summary: listed.temporary_contact_summary,
  };
}
