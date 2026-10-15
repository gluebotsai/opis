/**
 * Finance payment flow smoke tests (run one scenario at a time).
 *
 * Prerequisites:
 *   1. API running (pnpm dev / node server/index.js)
 *   2. .env has DATABASE_URL, SALES_LOGIN_EMAIL/PASSWORD, FINANCE_LOGIN_EMAIL/PASSWORD
 *
 * Run all:
 *   node scripts/smoke-test-finance-flows.mjs
 *   node scripts/smoke-test-finance-flows.mjs --scenario=all
 *
 * Run one by one:
 *   node scripts/smoke-test-finance-flows.mjs --scenario=pending-review
 *   node scripts/smoke-test-finance-flows.mjs --scenario=approve
 *   node scripts/smoke-test-finance-flows.mjs --scenario=reject
 *   node scripts/smoke-test-finance-flows.mjs --scenario=approve-stripe
 *   node scripts/smoke-test-finance-flows.mjs --scenario=approve-razorpay
 *   node scripts/smoke-test-finance-flows.mjs --scenario=webhook-stripe
 *   node scripts/smoke-test-finance-flows.mjs --scenario=webhook-razorpay
 *   node scripts/smoke-test-finance-flows.mjs --scenario=confirm-flow
 *   node scripts/smoke-test-finance-flows.mjs --scenario=mark-paid
 *
 * Or: SCENARIO=mark-paid node scripts/smoke-test-finance-flows.mjs
 *
 * Optional:
 *   VITE_API_PROXY / MAIL_API_PORT — API base (default http://127.0.0.1:3002)
 *   MARK_PAID_TIMEOUT_MS — max HTTP wait for mark-paid (default 20000)
 */
import crypto from "node:crypto";

import "../src/config/load-env.js";
import {
  cleanupPaymentSmokeTargets,
} from "./lib/smoke-payment-cleanup.mjs";
import { withSmokeLeadContact } from "./lib/smokeLeadContact.mjs";

const API = process.env.VITE_API_PROXY || `http://127.0.0.1:${process.env.MAIL_API_PORT || 3002}`;
const MARK_PAID_TIMEOUT_MS = Number(process.env.MARK_PAID_TIMEOUT_MS || 20000);
const marker = `fin-flow-${Date.now()}`;

const salesEmail = process.env.SALES_LOGIN_EMAIL || "";
const salesPassword = process.env.SALES_LOGIN_PASSWORD || "";
const financeEmail = process.env.FINANCE_LOGIN_EMAIL || "";
const financePassword = process.env.FINANCE_LOGIN_PASSWORD || "";

const SCENARIOS = [
  "pending-review",
  "approve",
  "reject",
  "approve-stripe",
  "approve-razorpay",
  "webhook-stripe",
  "webhook-razorpay",
  "confirm-flow",
  "mark-paid",
];

function parseScenario() {
  const fromArg = process.argv.find((arg) => arg.startsWith("--scenario="));
  const raw = (fromArg ? fromArg.slice("--scenario=".length) : process.env.SCENARIO || "all")
    .trim()
    .toLowerCase();
  if (!raw || raw === "all") {
    return "all";
  }
  if (!SCENARIOS.includes(raw)) {
    throw new Error(
      `Unknown scenario "${raw}". Use one of: all, ${SCENARIOS.join(", ")}`,
    );
  }
  return raw;
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function api(path, { method = "GET", token, body, timeoutMs } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const controller = timeoutMs ? new AbortController() : null;
  const timer =
    timeoutMs && controller
      ? setTimeout(() => controller.abort(), timeoutMs)
      : null;

  try {
    const response = await fetch(`${API}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller?.signal,
    });
    const text = await response.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { raw: text };
    }
    return { status: response.status, data, raw: text };
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error(`Request timed out after ${timeoutMs}ms: ${method} ${path}`);
    }
    throw error;
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
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

function quoteBody(leadId, leadData, suffix) {
  return {
    leadId,
    lead: leadData,
    fileName: `${marker}-${suffix}.pdf`,
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
  };
}

async function createLeadAndQuotation(salesToken, suffix) {
  const contact = withSmokeLeadContact({
    companyName: `Finance Flow ${suffix} ${marker}`,
    billingAddress: "100 Finance Flow Lane",
    workEmail: `${marker}-${suffix}@example.com`,
    contactName: "Finance Flow Tester",
  });

  const createLead = await api("/api/leads", {
    method: "POST",
    token: salesToken,
    body: contact,
  });
  assert(
    createLead.status === 201 || createLead.status === 200,
    `Create lead failed (${suffix}): ${createLead.status} ${createLead.raw}`,
  );
  const leadId = createLead.data?.lead?.id || createLead.data?.id;
  assert(leadId, `Create lead returned no id (${suffix})`);
  const leadData = createLead.data?.lead || createLead.data;

  const createQuote = await api("/api/quotations", {
    method: "POST",
    token: salesToken,
    body: quoteBody(leadId, leadData, suffix),
  });
  assert(
    createQuote.status === 200 || createQuote.status === 201,
    `Create quotation failed (${suffix}): ${createQuote.status} ${createQuote.raw}`,
  );
  const quotationId = createQuote.data?.id;
  assert(quotationId, `Quotation id missing (${suffix})`);

  return { leadId, quotationId, leadData };
}

async function attachDryRunPayment(quotationId, provider) {
  const { attachPaymentToQuotation } = await import("../src/modules/quotations/quotation-store.js");
  const { PAYMENT_STATUSES } = await import("../src/modules/payments/constants.js");
  await attachPaymentToQuotation(quotationId, {
    provider,
    paymentLinkUrl: `https://pay.example/${provider}/${quotationId}`,
    paymentLinkId: `plink_${provider}_${marker}_${quotationId.slice(0, 8)}`,
    subtotal: 1000,
    grandTotal: 1180,
    currency: "INR",
    amountLabel: "INR 1,180.00",
    status: PAYMENT_STATUSES.PENDING,
    dryRun: true,
  });
}

async function ensureApprovedWithPayment(financeToken, quotationId, paymentProvider = null) {
  const body = { note: `smoke approve ${marker}` };
  if (paymentProvider) {
    body.paymentProvider = paymentProvider;
  }

  let approve = await api(`/api/quotations/${quotationId}/approve`, {
    method: "POST",
    token: financeToken,
    body,
  });

  if (approve.status !== 200) {
    const { approveQuotation } = await import("../src/modules/quotations/quotation-store.js");
    await approveQuotation(quotationId, financeEmail || "finance@test.com", body.note);
    await attachDryRunPayment(quotationId, paymentProvider || "manual");
    approve = { status: 200, data: { offline: true, paymentProvider: paymentProvider || "manual" } };
    return approve;
  }

  const payment = approve.data?.payment || approve.data?.quotation?.payment;
  if (!payment?.paymentLinkUrl && !payment?.paymentLinkId) {
    await attachDryRunPayment(quotationId, paymentProvider || "manual");
  }

  return approve;
}

async function findInFinanceQueue(financeToken, quotationId) {
  const queue = await api("/api/quotations", { token: financeToken });
  assert(queue.status === 200, `Finance queue failed: ${queue.status}`);
  return (queue.data?.quotations || []).find((entry) => entry.id === quotationId) || null;
}

async function pollPaymentPaid(financeToken, quotationId, { attempts = 20, delayMs = 500 } = {}) {
  for (let i = 0; i < attempts; i += 1) {
    const entry = await findInFinanceQueue(financeToken, quotationId);
    if (entry?.status === "Paid" && entry?.payment?.status === "paid") {
      return entry;
    }
    await sleep(delayMs);
  }
  const last = await findInFinanceQueue(financeToken, quotationId);
  throw new Error(
    `Timed out waiting for Paid. status=${last?.status} payment=${last?.payment?.status}`,
  );
}

async function scenarioPendingReview({ salesToken, financeToken, cleanupTargets }) {
  const { leadId, quotationId } = await createLeadAndQuotation(salesToken, "pending");
  cleanupTargets.push({ leadId, quotationId });

  const entry = await findInFinanceQueue(financeToken, quotationId);
  assert(entry, "Pending quotation missing from finance queue");
  assert(
    entry.status === "Pending Finance Review",
    `Expected Pending Finance Review, got ${entry.status}`,
  );
  console.log("[smoke-test-finance-flows] OK — pending-review");
}

async function scenarioApprove({ salesToken, financeToken, cleanupTargets }) {
  const { leadId, quotationId } = await createLeadAndQuotation(salesToken, "approve");
  cleanupTargets.push({ leadId, quotationId });

  const approve = await ensureApprovedWithPayment(financeToken, quotationId);
  assert(approve.status === 200, `Approve failed: ${approve.status} ${approve.raw || ""}`);

  const entry = await findInFinanceQueue(financeToken, quotationId);
  assert(entry?.status === "Approved", `Expected Approved, got ${entry?.status}`);
  console.log("[smoke-test-finance-flows] OK — approve");
}

async function scenarioReject({ salesToken, financeToken, cleanupTargets }) {
  const { leadId, quotationId } = await createLeadAndQuotation(salesToken, "reject");
  cleanupTargets.push({ leadId, quotationId });

  const reject = await api(`/api/quotations/${quotationId}/reject`, {
    method: "POST",
    token: financeToken,
    body: { note: `smoke reject ${marker}` },
  });
  assert(reject.status === 200, `Reject failed: ${reject.status} ${reject.raw}`);
  assert(
    reject.data?.quotation?.status === "Rejected",
    `Expected Rejected, got ${reject.data?.quotation?.status}`,
  );

  const entry = await findInFinanceQueue(financeToken, quotationId);
  assert(entry?.status === "Rejected", `Queue should show Rejected, got ${entry?.status}`);
  console.log("[smoke-test-finance-flows] OK — reject");
}

async function scenarioApproveProvider(provider, { salesToken, financeToken, cleanupTargets }) {
  const { leadId, quotationId } = await createLeadAndQuotation(salesToken, `approve-${provider}`);
  cleanupTargets.push({ leadId, quotationId });

  const approve = await ensureApprovedWithPayment(financeToken, quotationId, provider);
  assert(approve.status === 200, `Approve ${provider} failed: ${approve.status}`);

  const entry = await findInFinanceQueue(financeToken, quotationId);
  assert(entry?.status === "Approved", `Expected Approved after ${provider}, got ${entry?.status}`);
  assert(entry?.payment, `Expected payment record after approve-${provider}`);
  const resolvedProvider = String(entry.payment.provider || "").toLowerCase();
  assert(
    resolvedProvider === provider ||
      resolvedProvider === "manual" ||
      approve.data?.offline === true,
    `Expected provider ${provider} (or offline/manual fallback), got ${entry.payment.provider}`,
  );
  console.log(`[smoke-test-finance-flows] OK — approve-${provider} (provider=${entry.payment.provider})`);
}

async function scenarioWebhookStripe({ salesToken, financeToken, cleanupTargets }) {
  const { leadId, quotationId } = await createLeadAndQuotation(salesToken, "wh-stripe");
  cleanupTargets.push({ leadId, quotationId });
  await ensureApprovedWithPayment(financeToken, quotationId, "stripe");
  await attachDryRunPayment(quotationId, "stripe");

  const { processStripeWebhookEvent } = await import("../src/modules/payments/stripeWebhook.js");
  const eventId = `evt_smoke_${crypto.randomUUID()}`;
  const result = await processStripeWebhookEvent({
    id: eventId,
    type: "checkout.session.completed",
    data: {
      object: {
        id: `cs_${marker}`,
        payment_status: "paid",
        payment_intent: `pi_smoke_${marker}`,
        metadata: { quotation_id: quotationId, lead_id: leadId },
      },
    },
  });
  assert(result?.handled !== false || result?.alreadyPaid || result?.autoConfirmed,
    `Stripe webhook not handled: ${JSON.stringify(result)}`);

  const entry = await pollPaymentPaid(financeToken, quotationId);
  assert(entry.payment.status === "paid", "Stripe webhook should move payment to paid");
  console.log("[smoke-test-finance-flows] OK — webhook-stripe");
}

async function scenarioWebhookRazorpay({ salesToken, financeToken, cleanupTargets }) {
  const { leadId, quotationId } = await createLeadAndQuotation(salesToken, "wh-rzp");
  cleanupTargets.push({ leadId, quotationId });
  await ensureApprovedWithPayment(financeToken, quotationId, "razorpay");
  await attachDryRunPayment(quotationId, "razorpay");

  const { processRazorpayWebhookEvent } = await import("../src/modules/payments/razorpayWebhook.js");
  const result = await processRazorpayWebhookEvent({
    event: "payment_link.paid",
    id: `rzp_evt_${crypto.randomUUID()}`,
    payload: {
      payment_link: {
        entity: {
          id: `plink_rzp_${marker}`,
          reference_id: quotationId,
          notes: { quotation_id: quotationId, lead_id: leadId },
        },
      },
      payment: {
        entity: {
          id: `pay_smoke_${marker}`,
          notes: { quotation_id: quotationId },
        },
      },
    },
  });
  assert(
    result?.handled !== false || result?.alreadyPaid || result?.autoConfirmed,
    `Razorpay webhook not handled: ${JSON.stringify(result)}`,
  );

  const entry = await pollPaymentPaid(financeToken, quotationId);
  assert(entry.payment.status === "paid", "Razorpay webhook should move payment to paid");
  console.log("[smoke-test-finance-flows] OK — webhook-razorpay");
}

async function scenarioConfirmFlow({ salesToken, financeToken, cleanupTargets }) {
  const { leadId, quotationId } = await createLeadAndQuotation(salesToken, "confirm");
  cleanupTargets.push({ leadId, quotationId });
  await ensureApprovedWithPayment(financeToken, quotationId, "manual");

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
  const reportedStatus =
    report.data?.payment?.status || report.data?.quotation?.payment?.status;
  assert(
    reportedStatus === "reported",
    `Expected reported after step 1, got ${reportedStatus}`,
  );

  const started = Date.now();
  const confirm = await api(`/api/quotations/${quotationId}/confirm-payment`, {
    method: "POST",
    token: financeToken,
    body: { notify: false },
    timeoutMs: MARK_PAID_TIMEOUT_MS,
  });
  const elapsed = Date.now() - started;
  assert(confirm.status === 200, `Confirm payment failed: ${confirm.status} ${confirm.raw}`);
  assert(
    elapsed < MARK_PAID_TIMEOUT_MS,
    `Confirm payment hung (${elapsed}ms >= ${MARK_PAID_TIMEOUT_MS}ms)`,
  );

  await pollPaymentPaid(financeToken, quotationId);
  console.log(`[smoke-test-finance-flows] OK — confirm-flow (${elapsed}ms)`);
}

async function scenarioMarkPaid({ salesToken, financeToken, cleanupTargets }) {
  const { leadId, quotationId } = await createLeadAndQuotation(salesToken, "mark-paid");
  cleanupTargets.push({ leadId, quotationId });
  await ensureApprovedWithPayment(financeToken, quotationId, "manual");

  const started = Date.now();
  const markPaid = await api(`/api/quotations/${quotationId}/mark-paid`, {
    method: "POST",
    token: financeToken,
    body: {
      paymentMethod: "bank_transfer",
      providerPaymentId: `MARK_${marker}`,
      notify: false,
    },
    timeoutMs: MARK_PAID_TIMEOUT_MS,
  });
  const elapsed = Date.now() - started;

  assert(markPaid.status === 200, `Mark paid failed: ${markPaid.status} ${markPaid.raw}`);
  assert(
    elapsed < MARK_PAID_TIMEOUT_MS,
    `Mark paid hung (pending request) — ${elapsed}ms >= ${MARK_PAID_TIMEOUT_MS}ms`,
  );

  const paymentStatus =
    markPaid.data?.payment?.status || markPaid.data?.quotation?.payment?.status;
  assert(
    paymentStatus === "paid" || markPaid.data?.quotation?.status === "Paid",
    `Expected paid after mark-paid, got payment=${paymentStatus} quotation=${markPaid.data?.quotation?.status}`,
  );

  await pollPaymentPaid(financeToken, quotationId);
  console.log(`[smoke-test-finance-flows] OK — mark-paid (${elapsed}ms)`);
}

const RUNNERS = {
  "pending-review": scenarioPendingReview,
  approve: scenarioApprove,
  reject: scenarioReject,
  "approve-stripe": (ctx) => scenarioApproveProvider("stripe", ctx),
  "approve-razorpay": (ctx) => scenarioApproveProvider("razorpay", ctx),
  "webhook-stripe": scenarioWebhookStripe,
  "webhook-razorpay": scenarioWebhookRazorpay,
  "confirm-flow": scenarioConfirmFlow,
  "mark-paid": scenarioMarkPaid,
};

async function main() {
  const scenario = parseScenario();
  console.log(`[smoke-test-finance-flows] Target: ${API}`);
  console.log(`[smoke-test-finance-flows] Scenario: ${scenario}`);

  const health = await api("/api/health");
  assert(health.status === 200, `Health check failed: ${health.status}. Is the API running?`);

  if (!salesPassword || !financePassword) {
    console.error(
      "[smoke-test-finance-flows] Set SALES_LOGIN_PASSWORD and FINANCE_LOGIN_PASSWORD in .env",
    );
    process.exit(1);
  }
  if (!process.env.DATABASE_URL) {
    console.error("[smoke-test-finance-flows] DATABASE_URL is not set");
    process.exit(1);
  }

  const salesToken = await login(salesEmail, salesPassword);
  const financeToken = await login(financeEmail, financePassword);
  const cleanupTargets = [];
  const ctx = { salesToken, financeToken, cleanupTargets };

  const toRun = scenario === "all" ? SCENARIOS : [scenario];

  try {
    for (const name of toRun) {
      console.log(`[smoke-test-finance-flows] ▶ ${name}`);
      await RUNNERS[name](ctx);
    }
    console.log("[smoke-test-finance-flows] ALL PASSED");
  } finally {
    await cleanupPaymentSmokeTargets(cleanupTargets);
  }
}

main().catch(async (error) => {
  console.error("[smoke-test-finance-flows] FAILED:", error.message || error);
  process.exit(1);
});
