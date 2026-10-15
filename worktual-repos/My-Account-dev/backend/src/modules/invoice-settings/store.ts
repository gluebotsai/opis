import { pool } from "../../db/pool.js";
import { rowToCamel, toIso } from "../../db/util.js";
import * as invoiceSettingsRepo from "../../repositories/raw/invoiceSettings.repo.js";
import {
  DEFAULT_PURCHASE_CUTOFF_DAY,
  normalizeCutoffDay,
} from "../billing/dates.js";

function mapSettingsRow(row: any) {
  if (!row) {
    return null;
  }
  const entry = rowToCamel(row) as any;
  const year = entry.seriesYear == null ? new Date().getFullYear() : Number(entry.seriesYear);
  const prefix = String(entry.invoicePrefix || "WIPL").trim() || "WIPL";
  const nextSequence = Math.max(1, Number(entry.nextSequence) || 1);
  return {
    id: entry.id || "default",
    invoicePrefix: prefix,
    seriesYear: year,
    nextSequence,
    accountName: entry.accountName || "",
    bankName: entry.bankName || "",
    accountNumber: entry.accountNumber || "",
    ifsc: entry.ifsc || "",
    branch: entry.branch || "",
    purchaseCutoffDay: normalizeCutoffDay(
      entry.purchaseCutoffDay,
      DEFAULT_PURCHASE_CUTOFF_DAY,
    ),
    updatedAt: toIso(entry.updatedAt),
  };
}

export function bankDetailsFromSettings(settings: any) {
  if (!settings) {
    return null;
  }
  return {
    accountName: settings.accountName || "",
    bankName: settings.bankName || "",
    accountNumber: settings.accountNumber || "",
    ifsc: settings.ifsc || "",
    branch: settings.branch || "",
  };
}

export async function getInvoiceSettings() {
  let row = await invoiceSettingsRepo.selectInvoiceSettings(pool);
  if (!row) {
    row = await invoiceSettingsRepo.ensureDefaultInvoiceSettings(pool);
  }
  return mapSettingsRow(row);
}

export async function getPublicInvoiceSettings() {
  const settings = await getInvoiceSettings();
  const year = settings?.seriesYear || new Date().getFullYear();
  const prefix = settings?.invoicePrefix || "WIPL";
  return {
    prefix,
    year,
    draftNumber: `${prefix}-${year}-DRAFT`,
    bankDetails: bankDetailsFromSettings(settings),
    accountName: settings?.accountName || "",
    bankName: settings?.bankName || "",
    accountNumber: settings?.accountNumber || "",
    ifsc: settings?.ifsc || "",
    branch: settings?.branch || "",
    purchaseCutoffDay:
      settings?.purchaseCutoffDay ?? DEFAULT_PURCHASE_CUTOFF_DAY,
  };
}

export async function getPurchaseCutoffDay() {
  const settings = await getInvoiceSettings();
  return settings?.purchaseCutoffDay ?? DEFAULT_PURCHASE_CUTOFF_DAY;
}

export async function updateInvoiceSettings(payload: any = {}) {
  const invoicePrefix = String(payload.invoicePrefix ?? payload.prefix ?? "")
    .trim()
    .toUpperCase();
  if (!invoicePrefix) {
    throw new Error("Invoice prefix is required.");
  }
  if (!/^[A-Z0-9]{2,16}$/.test(invoicePrefix)) {
    throw new Error("Invoice prefix must be 2–16 letters or digits.");
  }

  let nextSequence: number | undefined;
  if (payload.nextSequence !== undefined && payload.nextSequence !== null && payload.nextSequence !== "") {
    nextSequence = Number(payload.nextSequence);
    if (!Number.isInteger(nextSequence) || nextSequence < 1) {
      throw new Error("Next sequence must be a positive integer.");
    }
  }

  let seriesYear: number | undefined;
  if (payload.seriesYear !== undefined && payload.seriesYear !== null && payload.seriesYear !== "") {
    seriesYear = Number(payload.seriesYear);
    if (!Number.isInteger(seriesYear) || seriesYear < 2000 || seriesYear > 2100) {
      throw new Error("Series year is invalid.");
    }
  }

  let purchaseCutoffDay: number | undefined;
  if (
    payload.purchaseCutoffDay !== undefined &&
    payload.purchaseCutoffDay !== null &&
    payload.purchaseCutoffDay !== ""
  ) {
    purchaseCutoffDay = Number(payload.purchaseCutoffDay);
    if (!Number.isInteger(purchaseCutoffDay) || purchaseCutoffDay < 1 || purchaseCutoffDay > 28) {
      throw new Error("Purchase cut-off day must be a whole number from 1 to 28.");
    }
  }

  const row = await invoiceSettingsRepo.updateInvoiceSettings(pool, {
    invoicePrefix,
    ...(nextSequence !== undefined ? { nextSequence } : {}),
    ...(seriesYear !== undefined ? { seriesYear } : {}),
    ...(purchaseCutoffDay !== undefined ? { purchaseCutoffDay } : {}),
    accountName: String(payload.accountName ?? "").trim(),
    bankName: String(payload.bankName ?? "").trim(),
    accountNumber: String(payload.accountNumber ?? "").trim(),
    ifsc: String(payload.ifsc ?? "").trim(),
    branch: String(payload.branch ?? "").trim(),
  });

  return mapSettingsRow(row);
}

export async function allocateNextInvoiceNumber(client: any) {
  return invoiceSettingsRepo.allocateNextInvoiceNumber(client);
}
