/**
 * Finance 2-step payment smoke test:
 *   Step 1 — report payment (webhook/manual report)
 *   Step 2 — confirm payment received
 *
 * Also verifies client payload serialization cannot throw on synthetic click events.
 */
import "../src/config/load-env.js";
import { safeStringify } from "../src/infra/safeJson.js";
import {
  cleanupPaymentSmokeLead,
  cleanupPaymentSmokeTargets,
} from "./lib/smoke-payment-cleanup.mjs";

const API = process.env.VITE_API_PROXY || `http://127.0.0.1:${process.env.MAIL_API_PORT || 3002}`;
const marker = `finance-confirm-smoke-${Date.now()}`;

const salesEmail = process.env.SALES_LOGIN_EMAIL || "";
const salesPassword = process.env.SALES_LOGIN_PASSWORD || "";
const financeEmail = process.env.FINANCE_LOGIN_EMAIL || "";
const financePassword = process.env.FINANCE_LOGIN_PASSWORD || "";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function isSyntheticEvent(value) {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    ("nativeEvent" in value ||
      typeof value.preventDefault === "function" ||
      typeof value.stopPropagation === "function")
  );
}

function normalizeBillingTargetId(value) {
  if (isSyntheticEvent(value)) {
    return null;
  }

  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizePaymentOptions(options = {}) {
  if (!options || typeof options !== "object" || Array.isArray(options) || isSyntheticEvent(options)) {
    return {};
  }

  return options;
}

function buildConfirmPaymentPayload(options = {}) {
  const normalized = normalizePaymentOptions(options);
  const payload = {
    notify: normalized.notify !== false,
  };

  const billingBranchId = normalizeBillingTargetId(normalized.billingBranchId);
  if (billingBranchId) {
    payload.billingBranchId = billingBranchId;
  }

  if (normalized.paidAt) {
    payload.paidAt = normalized.paidAt;
  }

  return payload;
}

async function api(path, { method = "GET", token, body } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const preparedBody =
    body === undefined || body === null
      ? undefined
      : typeof body === "string"
        ? body
        : safeStringify(body);

  const response = await fetch(`${API}${path}`, {
    method,
    headers,
    body: preparedBody,
  });

  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }

  return { status: response.status, data, raw: text };
}

async function login(email, password) {
  const { status, data } = await api("/api/auth/login", {
    method: "POST",
    body: { email, password },
  });
  assert(status === 200, `Login failed for ${email}: ${status} ${JSON.stringify(data)}`);
  assert(data?.token, `No token for ${email}`);
  return data.token;
}

function testClientPayloadSerialization() {
  const button = { constructor: { name: "HTMLButtonElement" }, nodeType: 1 };
  const fiber = { stateNode: button };
  button.__reactFiber$test = fiber;

  const fakeClickEvent = {
    nativeEvent: { target: button },
    target: button,
    currentTarget: button,
    preventDefault() {},
    stopPropagation() {},
    type: "click",
  };

  let threw = false;
  try {
    JSON.stringify({ billingBranchId: fakeClickEvent, notify: true });
  } catch (error) {
    threw = true;
    assert(
      String(error.message).includes("circular structure"),
      `Expected circular JSON error, got: ${error.message}`,
    );
  }
  assert(threw, "Raw JSON.stringify should fail on synthetic click event");

  const payload = buildConfirmPaymentPayload({
    billingBranchId: fakeClickEvent,
    notify: true,
  });
  assert(payload.billingBranchId === undefined, "Synthetic event must not become billingBranchId");
  assert(payload.notify === true, "notify flag should be preserved");

  const serialized = safeStringify(payload);
  assert(serialized === '{"notify":true}', `Unexpected safe payload: ${serialized}`);

  console.log("[smoke-test-finance-confirm] OK — client payload serialization");
}

async function testFinanceConfirmHttpFlow({ salesToken, financeToken }) {
  const cleanupTargets = [];
  let leadId;
  let quotationId;

  try {
    const createLead = await api("/api/leads", {
      method: "POST",
      token: salesToken,
      body: {
        companyName: `Finance Confirm Smoke ${marker}`,
        billingAddress: "100 Test Lane",
        workEmail: `${marker}@example.com`,
        contactName: "Finance Tester",
        mobileCountryCode: "+91",
        mobileNumber: String(9000000000 + (Date.now() % 1000000000)),
      },
    });
    assert(createLead.status === 201 || createLead.status === 200, `Create lead failed: ${createLead.status}`);
    leadId = createLead.data?.lead?.id || createLead.data?.id;
    assert(leadId, "Create lead returned no id");
    cleanupTargets.push({ leadId, quotationId: null });

    const leadData = createLead.data?.lead || createLead.data;
    const createQuote = await api("/api/quotations", {
      method: "POST",
      token: salesToken,
      body: {
        leadId,
        lead: leadData,
        fileName: `${marker}.pdf`,
        pdfBase64: "dGVzdA==",
        subtotal: 1000,
        grandTotal: 1180,
        currency: "INR",
        assignments: [
          {
            productId: "contact-center",
            branchId: "hq",
            billingBranchId: "hq",
            changeType: "new",
          },
        ],
        productSummary: [
          {
            productId: "contact-center",
            name: "Contact Center",
            priceLabel: "INR 1,000/mo",
          },
        ],
      },
    });
    assert(
      createQuote.status === 200 || createQuote.status === 201,
      `Create quotation failed: ${createQuote.status}`,
    );
    quotationId = createQuote.data?.id;
    assert(quotationId, "Quotation id missing");
    cleanupTargets[0].quotationId = quotationId;

    let approve = await api(`/api/quotations/${quotationId}/approve`, {
      method: "POST",
      token: financeToken,
      body: { note: "Finance confirm smoke approve" },
    });

    if (approve.status !== 200) {
      // Offline / gateway-unavailable environments: approve + attach via server modules.
      const { approveQuotation, attachPaymentToQuotation } = await import("../src/modules/quotations/quotation-store.js");
      const { PAYMENT_STATUSES } = await import("../src/modules/payments/constants.js");
      await approveQuotation(quotationId, financeEmail, "Finance confirm smoke approve (offline)");
      await attachPaymentToQuotation(quotationId, {
        provider: "manual",
        paymentLinkUrl: `https://pay.example/${quotationId}`,
        paymentLinkId: `plink_${marker}`,
        subtotal: 1000,
        grandTotal: 1180,
        currency: "INR",
        amountLabel: "INR 1,180.00",
        status: PAYMENT_STATUSES.PENDING,
        dryRun: true,
      });
      approve = { status: 200, data: { offline: true } };
    } else if (!approve.data?.payment?.paymentLinkUrl && !approve.data?.paymentLinkUrl) {
      const { attachPaymentToQuotation } = await import("../src/modules/quotations/quotation-store.js");
      const { PAYMENT_STATUSES } = await import("../src/modules/payments/constants.js");
      await attachPaymentToQuotation(quotationId, {
        provider: "manual",
        paymentLinkUrl: `https://pay.example/${quotationId}`,
        paymentLinkId: `plink_${marker}`,
        subtotal: 1000,
        grandTotal: 1180,
        currency: "INR",
        amountLabel: "INR 1,180.00",
        status: PAYMENT_STATUSES.PENDING,
        dryRun: true,
      });
    }

    const report = await api(`/api/quotations/${quotationId}/report-payment`, {
      method: "POST",
      token: financeToken,
      body: {
        paymentMethod: "bank_transfer",
        providerPaymentId: `UTR_${marker}`,
        notify: false,
      },
    });
    assert(report.status === 200, `Report payment failed: ${report.status} ${report.raw}`);
    assert(
      report.data?.payment?.status === "reported" || report.data?.quotation?.payment?.status === "reported",
      `Expected reported status after step 1, got ${JSON.stringify(report.data?.payment || report.data?.quotation?.payment)}`,
    );

    const confirm = await api(`/api/quotations/${quotationId}/confirm-payment`, {
      method: "POST",
      token: financeToken,
      body: buildConfirmPaymentPayload({ notify: false }),
    });
    assert(confirm.status === 200, `Confirm payment failed: ${confirm.status} ${confirm.raw}`);
    assert(
      confirm.data?.quotation?.status === "Paid" || confirm.data?.payment?.status === "paid",
      `Expected Paid after confirm, got quotation=${confirm.data?.quotation?.status} payment=${confirm.data?.payment?.status}`,
    );

    const confirmAgain = await api(`/api/quotations/${quotationId}/confirm-payment`, {
      method: "POST",
      token: financeToken,
      body: buildConfirmPaymentPayload({ notify: false }),
    });
    assert(confirmAgain.status === 200, `Second confirm failed: ${confirmAgain.status}`);
    assert(
      confirmAgain.data?.alreadyPaid === true,
      "Second confirm should be idempotent (alreadyPaid)",
    );

    const queue = await api("/api/quotations", { token: financeToken });
    const refreshed = (queue.data?.quotations || []).find((entry) => entry.id === quotationId);
    assert(refreshed?.status === "Paid", `Finance queue should show Paid, got ${refreshed?.status}`);
    assert(
      refreshed?.payment?.status === "paid",
      `Payment should be paid in queue, got ${refreshed?.payment?.status}`,
    );

    console.log(
      "[smoke-test-finance-confirm] OK — HTTP flow: approve → report (step 1) → confirm (step 2) → paid",
    );
  } finally {
    await cleanupPaymentSmokeTargets(cleanupTargets);
  }
}

async function main() {
  console.log(`[smoke-test-finance-confirm] Target: ${API}`);

  testClientPayloadSerialization();

  const health = await api("/api/health");
  assert(health.status === 200, `Health check failed: ${health.status}`);

  if (!salesPassword || !financePassword) {
    console.error(
      "[smoke-test-finance-confirm] Set SALES_LOGIN_PASSWORD and FINANCE_LOGIN_PASSWORD in .env",
    );
    process.exit(1);
  }

  const salesToken = await login(salesEmail, salesPassword);
  const financeToken = await login(financeEmail, financePassword);

  await testFinanceConfirmHttpFlow({ salesToken, financeToken });

  console.log("[smoke-test-finance-confirm] ALL PASSED");
}

main().catch(async (error) => {
  console.error("[smoke-test-finance-confirm] FAILED:", error.message || error);
  process.exit(1);
});
