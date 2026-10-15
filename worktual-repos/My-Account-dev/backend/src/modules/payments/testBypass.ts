import { getLeadById } from "../leads/lead-store.js";
import { getApprovedQuotationPayment } from "../quotations/quotation-store.js";
import { isProduction } from "../../infra/env.js";
import { PAYMENT_STATUSES } from "./constants.js";
import { markQuotationPaymentPaid } from "./fulfillment.js";

const DEFAULT_TEST_PHONES = ["7358021408"];

function env(name: any) {
  let value = process.env[name]?.trim() || "";
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }
  return value;
}

export function normalizePhoneDigits(value: any) {
  return String(value || "").replace(/\D/g, "");
}

export function getPaymentTestPhoneNumbers() {
  const configured = env("PAYMENT_TEST_PHONES");
  if (!configured) {
    return DEFAULT_TEST_PHONES;
  }

  return configured
    .split(",")
    .map((entry) => normalizePhoneDigits(entry.trim()))
    .filter(Boolean);
}

export function leadPhoneDigits(lead = {}) {
  // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
  const mobile = normalizePhoneDigits(lead.mobileNumber);
  if (!mobile) {
    return "";
  }

  if (mobile.length >= 10) {
    return mobile;
  }

  // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
  const country = normalizePhoneDigits(lead.mobileCountryCode || "");
  return `${country}${mobile}`;
}

export function isPaymentTestPhoneLead(lead: any) {
  if (!lead) {
    return false;
  }

  const testPhones = getPaymentTestPhoneNumbers();
  const mobileDigits = normalizePhoneDigits(lead.mobileNumber);
  const fullDigits = leadPhoneDigits(lead);

  return testPhones.some((testPhone) => {
    if (!testPhone) {
      return false;
    }

    return (
      mobileDigits === testPhone ||
      fullDigits === testPhone ||
      mobileDigits.endsWith(testPhone) ||
      fullDigits.endsWith(testPhone)
    );
  });
}

/**
 * For configured test phone numbers, auto-mark the latest approved quotation as paid.
 * Idempotent — safe on repeated API calls.
 */
export async function maybeAutoMarkTestPhonePaymentPaid(leadId: any, { sendNotifications = false } = {}) {
  if (isProduction()) {
    return null;
  }

  const lead = await getLeadById(leadId);
  if (!isPaymentTestPhoneLead(lead)) {
    return null;
  }

  const quotation = await getApprovedQuotationPayment(leadId);
  if (!quotation?.payment) {
    return { testPhone: true, skipped: true, reason: "no_payment_record" };
  }

  if (quotation.payment.status === PAYMENT_STATUSES.PAID) {
    return {
      testPhone: true,
      alreadyPaid: true,
      quotationId: quotation.id,
      leadId,
    };
  }

  const result = await markQuotationPaymentPaid({
    quotationId: quotation.id,
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    providerPaymentId: `test_phone_${normalizePhoneDigits(lead.mobileNumber)}_${quotation.id}`,
    source: "test_phone",
    sendNotifications,
  });

  console.log(
    `[payments] Test phone auto-paid lead ${leadId} (${lead.mobileNumber}) → quotation ${quotation.id}`,
  );

  return {
    testPhone: true,
    quotationId: quotation.id,
    leadId,
    ...result,
  };
}
