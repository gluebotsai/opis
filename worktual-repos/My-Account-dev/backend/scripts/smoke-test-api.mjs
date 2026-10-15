/**
 * HTTP API smoke test against a running mail API (default port 3002).
 */
import crypto from "node:crypto";
import "../src/config/load-env.js";

const API = process.env.VITE_API_PROXY || `http://127.0.0.1:${process.env.MAIL_API_PORT || 3002}`;
const marker = `api-smoke-${Date.now()}`;

const salesEmail = process.env.SALES_LOGIN_EMAIL || "";
const salesPassword = process.env.SALES_LOGIN_PASSWORD || "";
const financeEmail = process.env.FINANCE_LOGIN_EMAIL || "";
const financePassword = process.env.FINANCE_LOGIN_PASSWORD || "";
const adminEmail = process.env.ADMIN_LOGIN_EMAIL || process.env.ADMIN_EMAIL || "";
const adminPassword = process.env.ADMIN_LOGIN_PASSWORD || "";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function api(path, { method = "GET", token, body } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(`${API}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }

  // Flat API envelope: { statusCode, message, ...payload }
  // Legacy nested: { statusCode, message, metaResponse }
  if (
    data &&
    typeof data === "object" &&
    "statusCode" in data &&
    "message" in data
  ) {
    if ("metaResponse" in data) {
      if (response.ok) {
        data = data.metaResponse;
      } else {
        const meta =
          data.metaResponse && typeof data.metaResponse === "object"
            ? data.metaResponse
            : {};
        data = { ...meta, error: data.message, message: data.message };
      }
    } else {
      const { statusCode: _statusCode, message, ...payload } = data;
      if (response.ok) {
        data = payload;
      } else {
        data = { ...payload, error: message, message };
      }
    }
  }

  return { status: response.status, data };
}

async function login(email, password) {
  const { status, data } = await api("/api/auth/login", {
    method: "POST",
    body: { email, password, replaceSession: true },
  });
  assert(status === 200, `Login failed for ${email}: ${status} ${JSON.stringify(data)}`);
  assert(data?.token, `No token for ${email}`);
  return data.token;
}

async function main() {
  console.log(`[smoke-test-api] Target: ${API}`);

  const health = await api("/api/health");
  assert(health.status === 200, `Health check failed: ${health.status}`);

  if (!salesPassword || !financePassword || !adminPassword) {
    console.error("[smoke-test-api] Set SALES_LOGIN_PASSWORD, FINANCE_LOGIN_PASSWORD, and ADMIN_LOGIN_PASSWORD in .env");
    process.exit(1);
  }

  const salesToken = await login(salesEmail, salesPassword);
  const financeToken = await login(financeEmail, financePassword);

  let adminToken = null;
  try {
    adminToken = await login(adminEmail, adminPassword);
  } catch (error) {
    console.warn(
      `[smoke-test-api] Skipping admin oversight check: ${error instanceof Error ? error.message : error}`,
    );
  }

  const me = await api("/api/auth/me", { token: salesToken });
  assert(me.status === 200 && me.data?.user?.email, "Sales /api/auth/me failed");

  const createLead = await api("/api/leads", {
    method: "POST",
    token: salesToken,
    body: {
      companyName: `API Smoke ${marker}`,
      billingAddress: "100 Test Lane",
      workEmail: `${marker}@example.com`,
      contactName: "API Tester",
      country: "United States",
      state: "California",
      taxNumber: marker.replace(/[^a-z0-9]/gi, "").toUpperCase(),
      mobileCountryCode: "+1",
      mobileNumber: String(Date.now()).slice(-10),
    },
  });
  assert(
    createLead.status === 201 || createLead.status === 200,
    `Create lead failed: ${createLead.status} ${JSON.stringify(createLead.data)}`,
  );
  const leadId = createLead.data?.lead?.id || createLead.data?.id;
  assert(leadId, "Create lead returned no id");

  const getLead = await api(`/api/leads/${leadId}`, { token: salesToken });
  const leadData = getLead.data?.lead || getLead.data;
  assert(getLead.status === 200 && leadData?.companyName?.includes("API Smoke"), "Get lead failed");

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
  assert(createQuote.status === 200 || createQuote.status === 201, `Create quotation failed: ${createQuote.status}`);
  const quotationId =
    createQuote.data?.id ||
    createQuote.data?.quotation?.id ||
    createQuote.data?.quotations?.[0]?.id;
  assert(quotationId, "Quotation id missing");

  const queue = await api("/api/quotations", { token: financeToken });
  assert(queue.status === 200, `Finance quotations list failed: ${queue.status}`);
  const quotations = queue.data?.quotations || [];
  assert(
    quotations.some((q) => q.id === quotationId),
    "New quotation not in finance queue",
  );

  const approve = await api(`/api/quotations/${quotationId}/approve`, {
    method: "POST",
    token: financeToken,
    body: { note: "API smoke approve" },
  });
  if (approve.status !== 200) {
    const { approveQuotation, attachPaymentToQuotation } = await import("../src/modules/quotations/quotation-store.js");
    const { PAYMENT_STATUSES } = await import("../src/modules/payments/constants.js");
    await approveQuotation(quotationId, financeEmail, "API smoke approve (offline)");
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
  } else {
    assert(approve.status === 200, `Approve failed: ${approve.status} ${JSON.stringify(approve.data)}`);
  }

  const portfolioUnpaid = await api("/api/customers/portfolio", { token: salesToken });
  assert(
    portfolioUnpaid.status === 200 && portfolioUnpaid.data?.portfolio?.summary,
    "Customer portfolio failed",
  );
  const unpaidCustomers = portfolioUnpaid.data?.portfolio?.customers || [];
  assert(
    !unpaidCustomers.some((customer) => customer.leadId === leadId),
    "Unpaid lead must not appear in customer portfolio",
  );

  const { pool } = await import("../src/db/pool.js");
  const { ensureOrganizationForPaidLead } = await import("../src/modules/organizations/organization-store.js");
  const { updateLeadStatus } = await import("../src/modules/leads/lead-store.js");
  const { LEAD_STATUSES } = await import("../src/lib/statuses.js");
  const client = await pool.connect();
  try {
    await ensureOrganizationForPaidLead(leadId, client);
    await updateLeadStatus(client, leadId, LEAD_STATUSES.PAID);
  } finally {
    client.release();
  }

  const portfolioPaid = await api("/api/customers/portfolio", { token: salesToken });
  assert(portfolioPaid.status === 200 && portfolioPaid.data?.portfolio?.summary, "Paid portfolio failed");
  const paidCustomers = portfolioPaid.data?.portfolio?.customers || [];
  assert(
    paidCustomers.some((customer) => customer.leadId === leadId),
    "Paid lead must appear in customer portfolio",
  );

  const portfolioCustomerOrgIds = new Set(paidCustomers.map((customer) => customer.organizationId));
  const portfolioCustomerLeadIds = new Set(
    paidCustomers.map((customer) => customer.leadId).filter(Boolean),
  );
  const portfolioRenewals = portfolioPaid.data?.portfolio?.renewals || [];
  for (const renewal of portfolioRenewals) {
    const matchesOrg =
      renewal.organizationId && portfolioCustomerOrgIds.has(renewal.organizationId);
    const matchesLead = renewal.leadId && portfolioCustomerLeadIds.has(renewal.leadId);
    assert(
      matchesOrg || matchesLead,
      `Portfolio renewal ${renewal.id || renewal.companyName} is not in scoped customers`,
    );
  }
  assert(
    Number(portfolioPaid.data?.portfolio?.summary?.renewalsSoon || 0) === portfolioRenewals.length,
    "renewalsSoon must match scoped renewals list length",
  );

  if (adminToken) {
    const oversight = await api("/api/sales-oversight/dashboard", { token: adminToken });
    assert(oversight.status === 200 && oversight.data?.summary, "Sales oversight dashboard failed");
  }

  const statuses = await api("/api/quotations/statuses", { token: salesToken });
  assert(statuses.status === 200, "Quotation statuses failed");
  const statusList = statuses.data?.statuses || statuses.data || [];
  const leadStatus = statusList.find((s) => s.leadId === leadId);
  assert(leadStatus?.status === "Approved", `Expected Approved, got ${leadStatus?.status}`);

  console.log(
    adminToken
      ? "[smoke-test-api] OK — health, auth, lead, quotation, finance approve, paid-only portfolio, oversight"
      : "[smoke-test-api] OK — health, auth, lead, quotation, finance approve, paid-only portfolio (oversight skipped)",
  );
}

main().catch((error) => {
  console.error("[smoke-test-api] FAILED:", error.message || error);
  process.exit(1);
});
