/**
 * Per-org Finance billing settings (CRM DB).
 */
import type { OrgFinanceSettings } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { prisma } from "@/dao/db/prisma";
import {
  DEFAULT_PAYMENT_TERMS,
  DUPLICATE_INVOICE_GUARD,
  OFFLINE_REFERENCE_MIN_LEN,
  ZERO_AMOUNT_AUTO_PAID,
} from "@/config/finance-defaults";
import {
  decryptGatewaySecret,
  encryptGatewaySecret,
  maskSecret,
} from "@/service/finance/gateway-secret-crypto";

export type PaymentRoutingRules = {
  defaultProvider?: "stripe" | "razorpay";
  rules?: Array<{
    currency: string;
    offlineOnlyAbove?: number | null;
    allowedProviders?: Array<"stripe" | "razorpay">;
  }>;
};

export type BankDetails = {
  accountName?: string;
  bankName?: string;
  accountNumber?: string;
  ifsc?: string;
  iban?: string;
  swift?: string;
  routingNumber?: string;
  notes?: string;
};

export type EffectiveFinanceDefaults = {
  defaultPaymentTerms: string;
  zeroAmountAutoPaid: boolean;
  offlineReferenceMinLen: number;
  duplicateInvoiceGuard: boolean;
  onlinePaymentsEnabled: boolean;
  paymentRoutingRules: PaymentRoutingRules | null;
  bankDetails: BankDetails | null;
  billingCutoffDay: number;
  renewalWindowDays: number;
  autoRenewDefault: boolean;
  renewalQuoteAutoCreate: boolean;
};

export type OrgFinanceSettingsPublic = {
  organizationId: string;
  defaultPaymentTerms: string;
  zeroAmountAutoPaid: boolean;
  offlineReferenceMinLen: number;
  duplicateInvoiceGuard: boolean;
  onlinePaymentsEnabled: boolean;
  paymentRoutingRules: PaymentRoutingRules | null;
  bankDetails: BankDetails | null;
  invoiceNumberPrefix: string | null;
  invoiceNumberNextSeq: number;
  stripePublishableKey: string | null;
  stripeSecretKeyMasked: string | null;
  stripeWebhookSecretMasked: string | null;
  stripeConfigured: boolean;
  razorpayKeyId: string | null;
  razorpayKeySecretMasked: string | null;
  razorpayWebhookSecretMasked: string | null;
  razorpayConfigured: boolean;
  billingCutoffDay: number;
  renewalWindowDays: number;
  autoRenewDefault: boolean;
  renewalQuoteAutoCreate: boolean;
  updatedAt: string;
  updatedByUserId: string | null;
};

export type OrgFinanceSettingsSecrets = {
  stripeSecretKey: string | null;
  stripeWebhookSecret: string | null;
  razorpayKeySecret: string | null;
  razorpayWebhookSecret: string | null;
};

function parseRoutingRules(raw: unknown): PaymentRoutingRules | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as PaymentRoutingRules;
  return {
    defaultProvider:
      obj.defaultProvider === "stripe" || obj.defaultProvider === "razorpay"
        ? obj.defaultProvider
        : "stripe",
    rules: Array.isArray(obj.rules) ? obj.rules : [],
  };
}

function strField(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

export function parseBankDetails(raw: unknown): BankDetails | null {
  let value: unknown = raw;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    try {
      value = JSON.parse(trimmed);
    } catch {
      return null;
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const o = value as Record<string, unknown>;
  const parsed: BankDetails = {
    accountName: strField(o.accountName) ?? strField(o.account_name),
    bankName: strField(o.bankName) ?? strField(o.bank_name),
    accountNumber: strField(o.accountNumber) ?? strField(o.account_number),
    ifsc: strField(o.ifsc) ?? strField(o.IFSC),
    iban: strField(o.iban) ?? strField(o.IBAN),
    swift: strField(o.swift) ?? strField(o.SWIFT),
    routingNumber: strField(o.routingNumber) ?? strField(o.routing_number),
    notes: strField(o.notes),
  };
  return parsed;
}

/** Persist all known keys (including blanks) so a save clears stale fields. */
export function sanitizeBankDetails(raw: unknown): BankDetails | null {
  if (raw === null) return null;
  let value: unknown = raw;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const o = value as Record<string, unknown>;
  const pick = (...keys: string[]) => {
    for (const key of keys) {
      if (typeof o[key] === "string") return o[key].trim();
    }
    return "";
  };
  return {
    accountName: pick("accountName", "account_name"),
    bankName: pick("bankName", "bank_name"),
    accountNumber: pick("accountNumber", "account_number"),
    ifsc: pick("ifsc", "IFSC"),
    iban: pick("iban", "IBAN"),
    swift: pick("swift", "SWIFT"),
    routingNumber: pick("routingNumber", "routing_number"),
    notes: pick("notes"),
  };
}

export function formatBankDetailsBody(
  bank: BankDetails | null | undefined,
): string {
  if (!bank) return "";
  const lines: string[] = [];
  if (bank.accountName?.trim()) {
    lines.push(`Account name: ${bank.accountName.trim()}`);
  }
  if (bank.bankName?.trim()) lines.push(`Bank: ${bank.bankName.trim()}`);
  if (bank.accountNumber?.trim()) {
    lines.push(`Account number: ${bank.accountNumber.trim()}`);
  }
  const routing = bank.ifsc?.trim() || bank.routingNumber?.trim();
  if (routing) lines.push(`IFSC / routing: ${routing}`);
  if (bank.iban?.trim()) lines.push(`IBAN: ${bank.iban.trim()}`);
  if (bank.swift?.trim()) lines.push(`SWIFT: ${bank.swift.trim()}`);
  if (bank.notes?.trim()) lines.push(bank.notes.trim());
  return lines.join("\n");
}

export function overlayBankDetailsOnSections<
  T extends { key: string; body: string; title?: string },
>(sections: T[], bank: BankDetails | null | undefined): T[] {
  const block = formatBankDetailsBody(bank);
  if (!block) return sections;
  return sections.map((section) => {
    const key = (section.key || "").toLowerCase();
    if (key !== "payment" && key !== "bank") return section;
    const kept = (section.body || "")
      .split("\n")
      .map((line) => line.trimEnd())
      .filter((line) => {
        const t = line.trim();
        if (!t) return true;
        if (/\[[^\]]+\]/.test(t)) return false;
        return !/^(account\s*name|bank|account\s*number|ifsc|iban|swift|branch)\b/i.test(
          t,
        );
      })
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    return {
      ...section,
      title: section.title || "Bank details",
      body: [block, kept].filter(Boolean).join("\n\n"),
    };
  });
}

function decryptField(enc: string | null | undefined): string | null {
  if (!enc?.trim()) return null;
  try {
    return decryptGatewaySecret(enc);
  } catch {
    return null;
  }
}

function toPublic(row: OrgFinanceSettings): OrgFinanceSettingsPublic {
  const stripeSecret = decryptField(row.stripeSecretKeyEnc);
  const stripeWebhook = decryptField(row.stripeWebhookSecretEnc);
  const razorpaySecret = decryptField(row.razorpayKeySecretEnc);
  const razorpayWebhook = decryptField(row.razorpayWebhookSecretEnc);
  return {
    organizationId: row.organizationId.toString(),
    defaultPaymentTerms: row.defaultPaymentTerms,
    zeroAmountAutoPaid: row.zeroAmountAutoPaid,
    offlineReferenceMinLen: row.offlineReferenceMinLen,
    duplicateInvoiceGuard: row.duplicateInvoiceGuard,
    onlinePaymentsEnabled: row.onlinePaymentsEnabled,
    paymentRoutingRules: parseRoutingRules(row.paymentRoutingRules),
    bankDetails: parseBankDetails(row.bankDetails),
    invoiceNumberPrefix: row.invoiceNumberPrefix,
    invoiceNumberNextSeq: row.invoiceNumberNextSeq,
    stripePublishableKey: row.stripePublishableKey,
    stripeSecretKeyMasked: maskSecret(stripeSecret),
    stripeWebhookSecretMasked: maskSecret(stripeWebhook),
    stripeConfigured: Boolean(
      row.stripePublishableKey && stripeSecret,
    ),
    razorpayKeyId: row.razorpayKeyId,
    razorpayKeySecretMasked: maskSecret(razorpaySecret),
    razorpayWebhookSecretMasked: maskSecret(razorpayWebhook),
    razorpayConfigured: Boolean(row.razorpayKeyId && razorpaySecret),
    billingCutoffDay: row.billingCutoffDay,
    renewalWindowDays: row.renewalWindowDays,
    autoRenewDefault: row.autoRenewDefault,
    renewalQuoteAutoCreate: row.renewalQuoteAutoCreate,
    updatedAt: row.updatedAt.toISOString(),
    updatedByUserId: row.updatedByUserId?.toString() ?? null,
  };
}

export function rowToEffectiveDefaults(row: OrgFinanceSettings): EffectiveFinanceDefaults {
  const stored = parseRoutingRules(row.paymentRoutingRules);
  return {
    defaultPaymentTerms: row.defaultPaymentTerms || DEFAULT_PAYMENT_TERMS,
    zeroAmountAutoPaid: true,
    offlineReferenceMinLen: OFFLINE_REFERENCE_MIN_LEN,
    duplicateInvoiceGuard: true,
    onlinePaymentsEnabled: true,
    paymentRoutingRules: {
      defaultProvider: stored?.defaultProvider ?? "stripe",
      rules: [],
    },
    bankDetails: parseBankDetails(row.bankDetails),
    billingCutoffDay: row.billingCutoffDay,
    renewalWindowDays: row.renewalWindowDays,
    autoRenewDefault: row.autoRenewDefault,
    renewalQuoteAutoCreate: row.renewalQuoteAutoCreate,
  };
}

/** System fallbacks when no org row exists. */
export function systemFinanceDefaults(): EffectiveFinanceDefaults {
  return {
    defaultPaymentTerms: DEFAULT_PAYMENT_TERMS,
    zeroAmountAutoPaid: ZERO_AMOUNT_AUTO_PAID,
    offlineReferenceMinLen: OFFLINE_REFERENCE_MIN_LEN,
    duplicateInvoiceGuard: DUPLICATE_INVOICE_GUARD,
    onlinePaymentsEnabled: true,
    paymentRoutingRules: {
      defaultProvider: "stripe",
      rules: [],
    },
    bankDetails: null,
    billingCutoffDay: 20,
    renewalWindowDays: 30,
    autoRenewDefault: false,
    renewalQuoteAutoCreate: true,
  };
}

export async function getOrCreateOrgFinanceSettings(
  organizationId: string | bigint,
  updatedByUserId?: string | null,
): Promise<OrgFinanceSettings> {
  const orgId = typeof organizationId === "bigint" ? organizationId : BigInt(organizationId);
  const existing = await prisma.orgFinanceSettings.findUnique({
    where: { organizationId: orgId },
  });
  if (existing) return existing;

  return prisma.orgFinanceSettings.create({
    data: {
      organizationId: orgId,
      defaultPaymentTerms: DEFAULT_PAYMENT_TERMS,
      zeroAmountAutoPaid: ZERO_AMOUNT_AUTO_PAID,
      offlineReferenceMinLen: OFFLINE_REFERENCE_MIN_LEN,
      duplicateInvoiceGuard: DUPLICATE_INVOICE_GUARD,
      onlinePaymentsEnabled: true,
      paymentRoutingRules: {
        defaultProvider: "stripe",
        rules: [],
      },
      updatedByUserId: updatedByUserId ? BigInt(updatedByUserId) : null,
    },
  });
}

export async function getEffectiveFinanceDefaults(
  organizationId: string | bigint,
): Promise<EffectiveFinanceDefaults> {
  const orgId = typeof organizationId === "bigint" ? organizationId : BigInt(organizationId);
  const row = await prisma.orgFinanceSettings.findUnique({
    where: { organizationId: orgId },
  });
  if (!row) return systemFinanceDefaults();
  return rowToEffectiveDefaults(row);
}

export async function getOrgFinanceSettingsPublic(
  organizationId: string | bigint,
): Promise<OrgFinanceSettingsPublic> {
  const row = await getOrCreateOrgFinanceSettings(organizationId);
  return toPublic(row);
}

export async function getOrgFinanceSettingsSecrets(
  organizationId: string | bigint,
): Promise<OrgFinanceSettingsSecrets> {
  const orgId = typeof organizationId === "bigint" ? organizationId : BigInt(organizationId);
  const row = await prisma.orgFinanceSettings.findUnique({
    where: { organizationId: orgId },
  });
  if (!row) {
    return {
      stripeSecretKey: null,
      stripeWebhookSecret: null,
      razorpayKeySecret: null,
      razorpayWebhookSecret: null,
    };
  }
  return {
    stripeSecretKey: decryptField(row.stripeSecretKeyEnc),
    stripeWebhookSecret: decryptField(row.stripeWebhookSecretEnc),
    razorpayKeySecret: decryptField(row.razorpayKeySecretEnc),
    razorpayWebhookSecret: decryptField(row.razorpayWebhookSecretEnc),
  };
}

export type PatchOrgFinanceSettingsInput = {
  defaultPaymentTerms?: string;
  zeroAmountAutoPaid?: boolean;
  offlineReferenceMinLen?: number;
  duplicateInvoiceGuard?: boolean;
  onlinePaymentsEnabled?: boolean;
  paymentRoutingRules?: PaymentRoutingRules | null;
  bankDetails?: BankDetails | null;
  invoiceNumberPrefix?: string | null;
  invoiceNumberNextSeq?: number;
  stripePublishableKey?: string | null;
  stripeSecretKey?: string | null;
  stripeWebhookSecret?: string | null;
  razorpayKeyId?: string | null;
  razorpayKeySecret?: string | null;
  razorpayWebhookSecret?: string | null;
  billingCutoffDay?: number;
  renewalWindowDays?: number;
  autoRenewDefault?: boolean;
  renewalQuoteAutoCreate?: boolean;
};

export async function updateOrgFinanceSettings(
  organizationId: string | bigint,
  input: PatchOrgFinanceSettingsInput,
  updatedByUserId?: string | null,
): Promise<OrgFinanceSettingsPublic> {
  await getOrCreateOrgFinanceSettings(organizationId, updatedByUserId);
  const orgId = typeof organizationId === "bigint" ? organizationId : BigInt(organizationId);

  const data: Prisma.OrgFinanceSettingsUpdateInput = {
    updatedByUserId: updatedByUserId ? BigInt(updatedByUserId) : undefined,
  };

  if (input.defaultPaymentTerms !== undefined) {
    data.defaultPaymentTerms = input.defaultPaymentTerms.trim() || DEFAULT_PAYMENT_TERMS;
  }
  if (input.zeroAmountAutoPaid !== undefined) {
    data.zeroAmountAutoPaid = input.zeroAmountAutoPaid;
  }
  if (input.offlineReferenceMinLen !== undefined) {
    data.offlineReferenceMinLen = Math.max(1, Math.min(32, input.offlineReferenceMinLen));
  }
  if (input.duplicateInvoiceGuard !== undefined) {
    data.duplicateInvoiceGuard = input.duplicateInvoiceGuard;
  }
  if (input.onlinePaymentsEnabled !== undefined) {
    data.onlinePaymentsEnabled = input.onlinePaymentsEnabled;
  }
  if (input.paymentRoutingRules !== undefined) {
    data.paymentRoutingRules =
      input.paymentRoutingRules === null
        ? Prisma.JsonNull
        : (input.paymentRoutingRules as Prisma.InputJsonValue);
  }
  if (input.bankDetails !== undefined) {
    const sanitized =
      input.bankDetails === null ? null : sanitizeBankDetails(input.bankDetails);
    data.bankDetails =
      sanitized === null
        ? Prisma.JsonNull
        : (sanitized as Prisma.InputJsonValue);
  }
  if (input.invoiceNumberPrefix !== undefined) {
    data.invoiceNumberPrefix = input.invoiceNumberPrefix?.trim() || null;
  }
  if (input.invoiceNumberNextSeq !== undefined) {
    data.invoiceNumberNextSeq = Math.max(1, input.invoiceNumberNextSeq);
  }
  if (input.stripePublishableKey !== undefined) {
    data.stripePublishableKey = input.stripePublishableKey?.trim() || null;
  }
  if (input.stripeSecretKey !== undefined && input.stripeSecretKey?.trim()) {
    if (!input.stripeSecretKey.startsWith("****")) {
      data.stripeSecretKeyEnc = encryptGatewaySecret(input.stripeSecretKey.trim());
    }
  }
  if (input.stripeWebhookSecret !== undefined && input.stripeWebhookSecret?.trim()) {
    if (!input.stripeWebhookSecret.startsWith("****")) {
      data.stripeWebhookSecretEnc = encryptGatewaySecret(
        input.stripeWebhookSecret.trim(),
      );
    }
  }
  if (input.razorpayKeyId !== undefined) {
    data.razorpayKeyId = input.razorpayKeyId?.trim() || null;
  }
  if (input.razorpayKeySecret !== undefined && input.razorpayKeySecret?.trim()) {
    if (!input.razorpayKeySecret.startsWith("****")) {
      data.razorpayKeySecretEnc = encryptGatewaySecret(input.razorpayKeySecret.trim());
    }
  }
  if (input.razorpayWebhookSecret !== undefined && input.razorpayWebhookSecret?.trim()) {
    if (!input.razorpayWebhookSecret.startsWith("****")) {
      data.razorpayWebhookSecretEnc = encryptGatewaySecret(
        input.razorpayWebhookSecret.trim(),
      );
    }
  }
  if (input.billingCutoffDay !== undefined) {
    data.billingCutoffDay = Math.max(1, Math.min(28, input.billingCutoffDay));
  }
  if (input.renewalWindowDays !== undefined) {
    data.renewalWindowDays = Math.max(1, Math.min(365, input.renewalWindowDays));
  }
  if (input.autoRenewDefault !== undefined) {
    data.autoRenewDefault = input.autoRenewDefault;
  }
  if (input.renewalQuoteAutoCreate !== undefined) {
    data.renewalQuoteAutoCreate = input.renewalQuoteAutoCreate;
  }

  const updated = await prisma.orgFinanceSettings.update({
    where: { organizationId: orgId },
    data,
  });
  return toPublic(updated);
}
