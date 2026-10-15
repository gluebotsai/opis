import { pool, withTransaction } from "../../db/pool.js";
import { rowToCamel, toIso } from "../../db/util.js";
import { updateLeadStatus } from "../leads/lead-store.js";
import { notifyPaymentReceived, notifyPaymentReported, notifyCustomerPaymentReported, notifyCustomerWelcomeEmail, assertCustomerOutboundMailboxConfigured } from "../notifications/service.js";
import { normalizeEmail } from "../../lib/customer-contact.js";
import { queuePaymentReceivedEmail, queuePaymentReportedEmail, queueCustomerPaymentReportedEmail } from "../../infra/notify.js";
import { publishPaymentEvent } from "../../infra/events.js";
import { resolveLeadPortalEventContext } from "../leads/portal-event-context.js";
import { ensureActiveProductsForQuotation } from "../quotations/quotation-store.js";
import { ensureOrganizationForPaidLead } from "../organizations/organization-store.js";
import { syncSubscriptionsFromQuotation, syncSubscriptionsForBillingTarget } from "../subscriptions/subscription-store.js";
import {
  ensureBranchCustomerUser,
  regenerateBranchPortalPassword,
} from "../customer-portal/customer-auth.js";
import { maybeCreateImmediateRenewalQuotation } from "../renewals/renewal-store.js";
import { PAYMENT_PROVIDERS, PAYMENT_STATUSES, WELCOME_EMAIL_STATUSES, FINANCE_ALERT_STATUSES, INTERNAL_CREDENTIALS_STATUSES } from "./constants.js";
import { QUOTATION_STATUSES } from "../../lib/statuses.js";
import * as paymentsRepo from "../../repositories/raw/payments.repo.js";
import * as branchPaymentsRepo from "../../repositories/raw/branchPayments.repo.js";
import { selectQuotationById, selectAssignmentsByQuotation } from "../../repositories/raw/quotations.repo.js";
import { accruePartnerCommissionForPaidQuotation } from "../commissions/commission-store.js";
import { fulfillLinkedProductRequestIfComplete } from "../customer-product-requests/request-store.js";
import { logPayment, logPaymentError, withTiming } from "../../infra/file-logger.js";
import {
  companyNameFromQuotation,
  paymentAmountDetails,
  paymentLogDetails,
} from "./logContext.js";
import {
  BILLING_PHASES,
  isGoLiveBillingPhase,
  isImplementationBillingPhase,
} from "./billingPhases.js";
import {
  markGoLiveProductsPaidForQuotation,
  seedGoLiveFromOtcQuotation,
} from "../product-go-live/go-live-store.js";

async function resolvePortalCredentialsForNotifyOutsideTx(productSync: any, quotationId: any) {
  const portalAccess = productSync?.portalAccess;
  const email = portalAccess?.email || portalAccess?.user?.email;

  if (email) {
    return {
      email,
      temporaryPassword: portalAccess.temporaryPassword || null,
      created: portalAccess.created === true || Boolean(portalAccess.temporaryPassword),
    };
  }

  if (!quotationId) {
    return null;
  }

  const client = await pool.connect();
  try {
    const quotationRow = await selectQuotationById(client, quotationId);
    if (!quotationRow) {
      return null;
    }

    return resolvePortalCredentialsForNotify(client, rowToCamel(quotationRow), productSync);
  } finally {
    client.release();
  }
}

async function resolvePortalCredentialsForNotify(client: any, quotationRow: any, productSync: any) {
  const leadSnapshot = quotationRow.leadSnapshot;
  const lead =
    typeof leadSnapshot === "string" ? JSON.parse(leadSnapshot) : leadSnapshot || {};
  const portalAccess = productSync?.portalAccess;

  if (portalAccess?.temporaryPassword && (portalAccess?.email || portalAccess?.user?.email)) {
    return {
      email: portalAccess.email || portalAccess.user.email,
      temporaryPassword: portalAccess.temporaryPassword,
      created: portalAccess.created === true,
    };
  }

  if (!portalAccess?.user?.email && !resolveBranchPortalEmail(lead, "hq")) {
    return null;
  }

  const { organization } = await ensureOrganizationForPaidLead(quotationRow.leadId, client);
  if (!organization) {
    return null;
  }

  const branchPortal = await provisionBranchPortalAccessForQuotation(
    client,
    quotationRow.leadId,
    quotationRow.id || quotationRow.quotationId,
    { resetCredentials: false },
  );
  if (!branchPortal?.email) {
    return null;
  }

  return {
    email: branchPortal.email,
    temporaryPassword: branchPortal.temporaryPassword || null,
    created: branchPortal.created === true,
  };
}

function resolveBranchPortalEmail(lead = {}, billingBranchId = "hq") {
  const branchId = String(billingBranchId || "hq");
  if (branchId && branchId !== "hq") {
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    const addr = (lead.additionalAddresses || []).find((entry: any) => String(entry.id) === branchId);
    const branchEmail = normalizeEmail(addr?.workEmail);
    if (branchEmail) {
      return branchEmail;
    }
  }
  // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
  return normalizeEmail(lead.workEmail || lead.adminEmail);
}

async function resolveQuotationBillingBranch(client: any, quotationId: any) {
  const invoiceRows = await quotationsRepoSelectInvoices(client, quotationId);
  if (invoiceRows.length === 1 && invoiceRows[0].billing_branch_id) {
    return {
      billingBranchId: String(invoiceRows[0].billing_branch_id),
      branchLabel: invoiceRows[0].branch_label || "",
    };
  }

  const assignmentRows = await selectAssignmentsByQuotation(client, quotationId);
  const branchIds = [
    ...new Set(assignmentRows.map((row: any) => String(row.branch_id || row.billing_branch_id || "hq"))),
  ];
  if (branchIds.length === 1) {
    return { billingBranchId: branchIds[0], branchLabel: "" };
  }

  return null;
}

async function quotationsRepoSelectInvoices(client: any, quotationId: any) {
  const { rows } = await client.query(
    `SELECT billing_branch_id, branch_label FROM quotation_invoices WHERE quotation_id = $1 ORDER BY id`,
    [quotationId],
  );
  return rows;
}

async function provisionBranchPortalAccessForQuotation(
  client: any,
  leadId: any,
  quotationId: any,
  { resetCredentials = false, billingBranchId: overrideBranchId = null, branchLabel: overrideLabel = "" } = {},
) {
  if (!leadId) {
    return null;
  }

  let billingBranchId = overrideBranchId;
  let branchLabel = overrideLabel;
  if (!billingBranchId && quotationId) {
    const branch = await resolveQuotationBillingBranch(client, quotationId);
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    billingBranchId = branch?.billingBranchId || null;
    branchLabel = branch?.branchLabel || branchLabel;
  }
  if (!billingBranchId) {
    return null;
  }

  const { getLeadById } = await import("../leads/lead-store.js");
  const lead = await getLeadById(leadId, client);
  if (!lead) {
    return null;
  }

  const email = resolveBranchPortalEmail(lead, billingBranchId);
  if (!email) {
    return null;
  }

  const { organization } = await ensureOrganizationForPaidLead(leadId, client);
  if (!organization) {
    return null;
  }

  const displayName =
    branchLabel ||
    (billingBranchId === "hq"
      ? "Head office"
      : (lead.additionalAddresses || []).find((entry: any) => String(entry.id) === String(billingBranchId))
          ?.label) ||
    lead.contactName ||
    "";

  const branchAccess = { branchId: billingBranchId, email, displayName };

  if (!resetCredentials) {
    try {
      const ensured = await ensureBranchCustomerUser(client, organization.id, branchAccess);
      if (!ensured?.user) {
        return null;
      }
      return {
        email: ensured.user.email,
        temporaryPassword: ensured.temporaryPassword || null,
        user: ensured.user,
        branchId: billingBranchId,
        role: "branch_user",
        created: ensured.created === true,
      };
    } catch (error) {
      // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
      if (String(error?.message || "").includes("already used for another portal role or branch")) {
        return null;
      }
      throw error;
    }
  }

  try {
    const regenerated = await regenerateBranchPortalPassword(client, organization.id, branchAccess);
    if (!regenerated?.temporaryPassword) {
      return null;
    }
    return {
      email: regenerated.email,
      temporaryPassword: regenerated.temporaryPassword,
      user: regenerated.user,
      branchId: billingBranchId,
      role: "branch_user",
      created: regenerated.created === true,
    };
  } catch (error) {
    // Shared company work-email across branches: keep payment fulfillment, skip duplicate branch login.
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    if (String(error?.message || "").includes("already used for another portal role or branch")) {
      return null;
    }
    throw error;
  }
}

/** Update lead payment status from quotations: Paid, Partially paid, or leave Approved. */
async function syncLeadPaidIfDealComplete(client: any, leadId: any) {
  if (!leadId) {
    return { leadFullyPaid: false, leadStatus: null };
  }
  const { rows } = await client.query(
    `SELECT q.status,
            COALESCE((
              SELECT bool_or(
                COALESCE((pa.config->>'isRenewalQuote')::boolean, false)
                OR LOWER(COALESCE(pa.change_type, '')) = 'renewal'
                OR LOWER(COALESCE(pa.config->>'changeType', '')) = 'renewal'
              )
              FROM product_assignments pa
              WHERE pa.quotation_id = q.id
            ), false) AS is_renewal
     FROM quotations q
     WHERE q.lead_id = $1 AND q.status <> $2`,
    [leadId, QUOTATION_STATUSES.REJECTED],
  );
  if (!rows.length) {
    return { leadFullyPaid: false, leadStatus: null };
  }

  // Renewal quotes are billing-cycle follow-ups, not unpaid deal fragments.
  const dealRows = rows.filter((row: any) => !row.is_renewal);
  const statusRows = dealRows.length > 0 ? dealRows : rows;

  const paidCount = statusRows.filter((row: any) => row.status === QUOTATION_STATUSES.PAID).length;
  const approvedCount = statusRows.filter((row: any) => row.status === QUOTATION_STATUSES.APPROVED).length;
  const allPaid = paidCount === statusRows.length;

  if (allPaid) {
    await updateLeadStatus(client, leadId, QUOTATION_STATUSES.PAID);
    return { leadFullyPaid: true, leadStatus: "Paid" };
  }

  // Partially paid only for Paid history + Approved (awaiting payment).
  // Pending Finance Review alone must not flip the lead off Paid.
  if (paidCount > 0 && approvedCount > 0) {
    await updateLeadStatus(client, leadId, "Partially paid");
    return { leadFullyPaid: false, leadStatus: "Partially paid" };
  }

  return { leadFullyPaid: false, leadStatus: null };
}

async function hydrateBranchPaymentRow(row: any) {
  if (!row) {
    return null;
  }

  const payment = rowToCamel(row);
  return {
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    id: payment.id,
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    billingBranchId: payment.billingBranchId,
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    branchLabel: payment.branchLabel || payment.billingBranchId || "",
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    provider: payment.provider,
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    paymentLinkUrl: payment.paymentLinkUrl,
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    paymentLinkId: payment.paymentLinkId,
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    subtotal: payment.subtotal !== null ? Number(payment.subtotal) : null,
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    grandTotal: payment.grandTotal !== null ? Number(payment.grandTotal) : null,
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    currency: payment.currency,
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    amountLabel: payment.amountLabel,
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    status: payment.status || PAYMENT_STATUSES.PENDING,
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    paidAt: toIso(payment.paidAt),
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    paymentReportedAt: toIso(payment.paymentReportedAt),
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    paymentReportedBy: payment.paymentReportedBy || null,
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    financeConfirmedAt: toIso(payment.financeConfirmedAt),
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    financeConfirmedBy: payment.financeConfirmedBy || null,
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    providerPaymentId: payment.providerPaymentId || null,
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    failureReason: payment.failureReason || null,
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    dryRun: payment.dryRun === true,
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    updatedAt: toIso(payment.updatedAt),
  };
}

async function loadFullPayment(client: any, quotationId: any, parentRow = null) {
  const row = parentRow || (await paymentsRepo.selectPaymentByQuotationId(client, quotationId));
  const payment = await hydratePaymentRow(row);
  if (!payment) {
    return null;
  }

  const branchRows = await branchPaymentsRepo.selectBranchPaymentsByQuotationId(client, quotationId);
  // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
  payment.branchPayments = await Promise.all(branchRows.map(hydrateBranchPaymentRow));
  return payment;
}

async function isMultiBranchPayment(client: any, quotationId: any) {
  const count = await branchPaymentsRepo.countBranchPayments(client, quotationId);
  return count > 1;
}

async function recomputeParentPaymentStatus(
  client: any,
  quotationId: any,
  { failureReason = null, providerEventId = null, providerPaymentId = null } = {},
) {
  const total = await branchPaymentsRepo.countBranchPayments(client, quotationId);
  if (total <= 1) {
    return null;
  }

  const paidCount = await branchPaymentsRepo.countBranchPaymentsByStatus(
    client,
    quotationId,
    PAYMENT_STATUSES.PAID,
  );

  if (paidCount >= total) {
    const { rows } = await client.query(
      `UPDATE payments SET
         status = $2,
         paid_at = COALESCE(paid_at, NOW()),
         failure_reason = NULL,
         updated_at = NOW()
       WHERE quotation_id = $1
       RETURNING *`,
      [quotationId, PAYMENT_STATUSES.PAID],
    );
    return rows[0] || null;
  }

  if (paidCount > 0) {
    return paymentsRepo.updatePaymentPartial(client, quotationId);
  }

  const reportedCount = await branchPaymentsRepo.countBranchPaymentsByStatus(
    client,
    quotationId,
    PAYMENT_STATUSES.REPORTED,
  );
  if (reportedCount > 0) {
    const { rows } = await client.query(
      `UPDATE payments SET
         status = $2,
         failure_reason = NULL,
         updated_at = NOW()
       WHERE quotation_id = $1 AND status IN ('pending', 'failed', 'reported')
       RETURNING *`,
      [quotationId, PAYMENT_STATUSES.REPORTED],
    );
    return rows[0] || paymentsRepo.selectPaymentByQuotationId(client, quotationId);
  }

  const failedCount = await branchPaymentsRepo.countBranchPaymentsByStatus(
    client,
    quotationId,
    PAYMENT_STATUSES.FAILED,
  );
  if (failedCount > 0) {
    const row = await paymentsRepo.updatePaymentFailed(client, [
      quotationId,
      PAYMENT_STATUSES.FAILED,
      failureReason || "Payment failed",
      providerEventId,
      providerPaymentId,
    ]);
    return row || paymentsRepo.selectPaymentByQuotationId(client, quotationId);
  }

  return paymentsRepo.selectPaymentByQuotationId(client, quotationId);
}

async function syncQuotationProductFulfillmentForBranch(
  client: any,
  quotationId: any,
  billingBranchId: any,
  { paidAt = null, resetPortalCredentials = false } = {},
) {
  await ensureActiveProductsForQuotation(quotationId, client);
  await paymentsRepo.confirmActiveProductsPaymentForBranch(client, quotationId, billingBranchId);

  const quotationRow = await paymentsRepo.selectQuotationLeadIdAndSnapshot(client, quotationId);
  const leadId = quotationRow?.lead_id;

  let hubSync = null;
  let portalAccess = null;
  if (leadId) {
    await ensureOrganizationForPaidLead(leadId, client);
    hubSync = await syncSubscriptionsForBillingTarget(quotationId, billingBranchId, client, {
      paidAt,
    });

    portalAccess = await provisionBranchPortalAccessForQuotation(client, leadId, quotationId, {
      resetCredentials: resetPortalCredentials,
      billingBranchId,
    });
  }

  return { hubSync, portalAccess, billingBranchId };
}

async function hydratePaymentRow(row: any) {
  if (!row) {
    return null;
  }

  const payment = rowToCamel(row);
  return {
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    provider: payment.provider,
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    paymentLinkUrl: payment.paymentLinkUrl,
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    paymentLinkId: payment.paymentLinkId,
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    subtotal: payment.subtotal !== null ? Number(payment.subtotal) : null,
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    grandTotal: payment.grandTotal !== null ? Number(payment.grandTotal) : null,
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    currency: payment.currency,
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    gstRate: payment.gstRate !== null ? Number(payment.gstRate) : null,
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    amountLabel: payment.amountLabel,
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    status: payment.status || PAYMENT_STATUSES.PENDING,
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    paidAt: toIso(payment.paidAt),
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    paymentReportedAt: toIso(payment.paymentReportedAt),
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    paymentReportedBy: payment.paymentReportedBy || null,
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    financeConfirmedAt: toIso(payment.financeConfirmedAt),
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    financeConfirmedBy: payment.financeConfirmedBy || null,
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    welcomeEmailStatus: payment.welcomeEmailStatus || null,
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    welcomeEmailSentAt: toIso(payment.welcomeEmailSentAt),
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    welcomeEmailLastError: payment.welcomeEmailLastError || null,
    welcomeEmailAttempts:
      // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
      payment.welcomeEmailAttempts !== null && payment.welcomeEmailAttempts !== undefined
        // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
        ? Number(payment.welcomeEmailAttempts)
        : 0,
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    financeAlertStatus: payment.financeAlertStatus || null,
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    financeAlertSentAt: toIso(payment.financeAlertSentAt),
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    financeAlertLastError: payment.financeAlertLastError || null,
    financeAlertAttempts:
      // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
      payment.financeAlertAttempts !== null && payment.financeAlertAttempts !== undefined
        // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
        ? Number(payment.financeAlertAttempts)
        : 0,
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    internalCredentialsStatus: payment.internalCredentialsStatus || null,
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    internalCredentialsSentAt: toIso(payment.internalCredentialsSentAt),
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    internalCredentialsLastError: payment.internalCredentialsLastError || null,
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    providerPaymentId: payment.providerPaymentId || null,
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    providerCustomerId: payment.providerCustomerId || null,
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    failureReason: payment.failureReason || null,
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    dryRun: payment.dryRun === true,
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    updatedAt: toIso(payment.updatedAt),
  };
}

export async function getPaymentByQuotationId(quotationId: any, client = null) {
  const runner = client || pool;
  return loadFullPayment(runner, quotationId);
}

export async function getPaymentByProviderPaymentId(providerPaymentId: any) {
  const row = await paymentsRepo.selectPaymentByProviderPaymentId(pool, providerPaymentId);
  return hydratePaymentRow(row);
}

async function loadQuotationForFulfillment(client: any, quotationId: any) {
  const row = await selectQuotationById(client, quotationId);
  return row ? rowToCamel(row) : null;
}

async function syncQuotationProductFulfillment(
  client: any,
  quotationId: any,
  { paidAt = null, resetPortalCredentials = false } = {},
) {
  return withTiming(
    "perf",
    "fulfillment.syncQuotationProduct",
    async () => {
      const quotationMeta = await loadQuotationForFulfillment(client, quotationId);
      const billingPhase = quotationMeta?.billingPhase || BILLING_PHASES.STANDARD;
      const isImplementation = isImplementationBillingPhase(billingPhase);
      const isGoLive = isGoLiveBillingPhase(billingPhase);

      const syncResult = await withTiming(
        "perf",
        "fulfillment.ensureActiveProducts",
        () => ensureActiveProductsForQuotation(quotationId, client),
        { quotationId },
      );
      console.log(`[perf] START fulfillment.confirmActiveProducts  quotationId=${quotationId}`);
      await paymentsRepo.confirmActiveProductsPayment(client, quotationId);

      const quotationRow = await paymentsRepo.selectQuotationLeadIdAndSnapshot(client, quotationId);
      const leadId = quotationRow?.lead_id;

      let hubSync = null;
      let portalAccess = null;
      let goLiveRows = [];
      if (leadId) {
        console.log(
          `[perf] START fulfillment.ensureOrganization  quotationId=${quotationId}  leadId=${leadId}`,
        );
        const orgResult = await ensureOrganizationForPaidLead(leadId, client);
        // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
        const organizationId = orgResult?.organization?.id || orgResult?.id || null;

        if (isImplementation) {
          // OTC paid: portal + welcome only; products stay awaiting UAT (no live subscription / day-20).
          goLiveRows = await seedGoLiveFromOtcQuotation(
            client,
            quotationId,
            leadId,
            organizationId,
          );
          hubSync = { deferred: true, billingPhase: BILLING_PHASES.IMPLEMENTATION, goLiveRows };
        } else {
          hubSync = await withTiming(
            "perf",
            "fulfillment.syncSubscriptions",
            () => syncSubscriptionsFromQuotation(quotationId, client, { paidAt }),
            { quotationId, leadId },
          );
          if (isGoLive) {
            goLiveRows = await markGoLiveProductsPaidForQuotation(client, quotationId);
            hubSync = { ...hubSync, goLiveRows, billingPhase: BILLING_PHASES.GO_LIVE_PRORATION };
          }
        }

        portalAccess = await withTiming(
          "perf",
          "fulfillment.provisionBranchPortal",
          () =>
            provisionBranchPortalAccessForQuotation(client, leadId, quotationId, {
              resetCredentials: resetPortalCredentials,
            }),
          { quotationId, leadId },
        );
      }

      return { ...syncResult, hubSync, portalAccess };
    },
    { quotationId },
  );
}

/** Repair missing active_products + payment confirmation for already-paid quotations. */
export async function repairQuotationProductFulfillment(quotationId: any) {
  return withTransaction(async (client: any) => {
    await client.query(`SET LOCAL lock_timeout = '15s'`);
    await client.query(`SET LOCAL statement_timeout = '60s'`);
    return syncQuotationProductFulfillment(client, quotationId);
  });
}

/**
 * Product/org/portal fulfillment must not run inside the payment FOR UPDATE transaction.
 * Holding payment/quotation locks during org provisioning causes lock storms and hanging
 * Finance "Complete confirmation" / sync-payment requests on staging.
 */
function scheduleDeferredImmediateRenewals(deferred = []) {
  return Promise.all(
    (deferred || []).map(async (item) => {
      // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
      if (!item?.subscription?.id) {
        return null;
      }
      try {
        // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
        return await maybeCreateImmediateRenewalQuotation(item.subscription, item.purchaseDate);
      } catch (error) {
        console.warn(
          // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
          `[renewals] Deferred immediate renewal quote failed for subscription ${item.subscription.id}:`,
          error instanceof Error ? error.message : error,
        );
        return null;
      }
    }),
  );
}

function collectDeferredImmediateRenewals(result: any) {
  const fromHub = result?.hubSync?.deferredImmediateRenewals || [];
  const fromRoot = result?.deferredImmediateRenewals || [];
  return [...fromHub, ...fromRoot];
}

async function runProductFulfillmentOutsidePaymentLock({
  // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
  quotationId,
  billingBranchId = null,
  paidAt = null,
  isFirstBranchPaid = true,
  multiBranch = false,
}) {
  const result = await withTransaction(async (client: any) => {
    await client.query(`SET LOCAL lock_timeout = '15s'`);
    await client.query(`SET LOCAL statement_timeout = '60s'`);

    if (multiBranch && billingBranchId) {
      return syncQuotationProductFulfillmentForBranch(client, quotationId, billingBranchId, {
        paidAt,
        resetPortalCredentials: false,
        // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
        isFirstBranchPaid,
      });
    }

    return syncQuotationProductFulfillment(client, quotationId, {
      paidAt,
      resetPortalCredentials: false,
    });
  });

  // Run after commit so renewal quote creation does not contend for fulfillment locks.
  // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
  await scheduleDeferredImmediateRenewals(collectDeferredImmediateRenewals(result));
  return result;
}

async function runProductFulfillmentWithRetry(options: any, { attempts = 3, baseDelayMs = 600 } = {}) {
  let lastError = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await runProductFulfillmentOutsidePaymentLock(options);
    } catch (error) {
      lastError = error;
      if (!isTransientPaymentDbError(error) || attempt >= attempts) {
        throw error;
      }
      const delayMs = baseDelayMs * attempt;
      console.warn(
        `[payments] product fulfillment transient failure (attempt ${attempt}/${attempts}), retrying in ${delayMs}ms:`,
        error instanceof Error ? error.message : error,
      );
      await sleep(delayMs);
    }
  }

  throw lastError || new Error("Could not complete product fulfillment after retries.");
}

function resolveProviderOverride(source: any) {
  return source !== PAYMENT_PROVIDERS.STRIPE && source !== PAYMENT_PROVIDERS.RAZORPAY ? source : null;
}

function isGatewayPaymentSource(source: any) {
  return source === PAYMENT_PROVIDERS.STRIPE || source === PAYMENT_PROVIDERS.RAZORPAY;
}

function isTransientPaymentDbError(error: any) {
  const message = error instanceof Error ? error.message : String(error);
  const code = error && typeof error === "object" ? error.code : null;
  return (
    code === "40P01" ||
    code === "55P03" ||
    code === "40001" ||
    /lock timeout|deadlock detected|could not serialize|canceling statement due to lock timeout/i.test(
      message,
    )
  );
}

function sleep(ms: any) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Confirm with retries for staging lock contention (migrate / concurrent traffic).
 * Keeps gateway webhooks from leaving payments stuck at "reported".
 */
export async function confirmFinancePaymentWithRetry(options: any, { attempts = 5, baseDelayMs = 750 } = {}) {
  let lastError = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await confirmFinancePayment(options);
    } catch (error) {
      lastError = error;
      if (!isTransientPaymentDbError(error) || attempt >= attempts) {
        throw error;
      }
      const delayMs = baseDelayMs * attempt;
      console.warn(
        `[payments] confirmFinancePayment transient failure (attempt ${attempt}/${attempts}), retrying in ${delayMs}ms:`,
        error instanceof Error ? error.message : error,
      );
      await sleep(delayMs);
    }
  }

  throw lastError || new Error("Could not confirm payment after retries.");
}

/**
 * Finish confirm for any gateway payment stuck at reported (parent or branch rows).
 */
export async function finishGatewayReportedPayment(quotation: any, source: any) {
  const payment = quotation?.payment;
  if (!payment) {
    return { synced: false, reason: "missing_payment" };
  }

  const provider =
    source ||
    (payment.provider === PAYMENT_PROVIDERS.RAZORPAY
      ? PAYMENT_PROVIDERS.RAZORPAY
      : PAYMENT_PROVIDERS.STRIPE);

  const reportedBranches = (payment.branchPayments || []).filter(
    (entry: any) => entry?.status === PAYMENT_STATUSES.REPORTED,
  );

  if (reportedBranches.length > 0) {
    let last = null;
    for (const branch of reportedBranches) {
      last = await confirmFinancePaymentWithRetry({
        quotationId: quotation.id,
        billingBranchId: branch.billingBranchId,
        providerPaymentId: branch.providerPaymentId || payment.providerPaymentId || null,
        providerCustomerId: branch.providerCustomerId || payment.providerCustomerId || null,
        source: provider,
        financeConfirmedBy: `auto:${provider}`,
      });
    }
    return { synced: true, alreadyReported: true, autoConfirmed: true, ...last };
  }

  if (payment.status === PAYMENT_STATUSES.REPORTED) {
    const confirmed = await confirmFinancePaymentWithRetry({
      quotationId: quotation.id,
      providerPaymentId: payment.providerPaymentId || null,
      providerCustomerId: payment.providerCustomerId || null,
      source: provider,
      financeConfirmedBy: `auto:${provider}`,
    });
    return { synced: true, alreadyReported: true, autoConfirmed: true, ...confirmed };
  }

  return { synced: false, reason: "not_reported" };
}

function assertQuotationPayable(quotationRow: any) {
  if (!quotationRow) {
    throw new Error("Quotation not found.");
  }

  if (quotationRow.status === QUOTATION_STATUSES.REJECTED) {
    throw new Error("Cannot mark payment on a rejected quotation.");
  }

  if (quotationRow.status === QUOTATION_STATUSES.PENDING) {
    throw new Error("Quotation must be finance-approved before payment can be recorded.");
  }
}

function buildQuotationPayload(quotationRow: any, payment: any, status = quotationRow.status) {
  const leadSnapshot = quotationRow.leadSnapshot;
  const lead =
    typeof leadSnapshot === "string" ? JSON.parse(leadSnapshot) : leadSnapshot || null;

  return {
    id: quotationRow.id,
    leadId: quotationRow.leadId,
    lead,
    status,
    submittedBy: quotationRow.submittedBy || "",
    payment,
  };
}

function welcomeEmailAlreadySent(paymentRow: any) {
  const status = paymentRow?.welcome_email_status || paymentRow?.welcomeEmailStatus;
  return status === WELCOME_EMAIL_STATUSES.SENT;
}

/** Stuck PENDING older than this is treated as failed so auto-delivery can retry. */
const WELCOME_PENDING_RETRY_MS = 2 * 60 * 1000;

function welcomePendingUpdatedAtMs(paymentRow: any) {
  const raw =
    paymentRow?.updated_at ||
    paymentRow?.updatedAt ||
    paymentRow?.welcome_email_sent_at ||
    paymentRow?.welcomeEmailSentAt ||
    null;
  if (!raw) {
    return 0;
  }
  const ms = new Date(raw).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

/** Skip auto welcome when already sent, or PENDING and still within the in-flight window. */
function shouldSkipAutoWelcomeDelivery(paymentRow: any) {
  const status = paymentRow?.welcome_email_status || paymentRow?.welcomeEmailStatus;
  if (status === WELCOME_EMAIL_STATUSES.SENT) {
    return true;
  }
  if (status !== WELCOME_EMAIL_STATUSES.PENDING) {
    return false;
  }
  const updatedAt = welcomePendingUpdatedAtMs(paymentRow);
  if (!updatedAt) {
    return false;
  }
  return Date.now() - updatedAt < WELCOME_PENDING_RETRY_MS;
}


async function withLeadPortalContext(leadId: any, payload: any) {
  const portal = await resolveLeadPortalEventContext(leadId);
  return { ...payload, ...portal };
}

async function publishWelcomeEmailUpdated(quotationId: any, payment: any, leadId = null) {
  await publishPaymentEvent(
    "payment.welcome_email_updated",
    await withLeadPortalContext(leadId, {
      quotationId,
      leadId,
      welcomeEmailStatus: payment?.welcomeEmailStatus || null,
      internalCredentialsStatus: payment?.internalCredentialsStatus || null,
    }),
  );
}

async function persistFinanceAlertDelivery(
  quotationId: any,
  // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
  { status, error = null, incrementAttempts = false },
  client = null,
) {
  const runner = client || pool;
  const currentRow = await paymentsRepo.selectPaymentByQuotationId(runner, quotationId);
  const currentStatus = currentRow?.finance_alert_status;
  if (
    currentStatus === FINANCE_ALERT_STATUSES.SENT &&
    status !== FINANCE_ALERT_STATUSES.SENT
  ) {
    return hydratePaymentRow(currentRow);
  }

  const row = await paymentsRepo.updateFinanceAlertDelivery(runner, [
    quotationId,
    status,
    error,
    incrementAttempts,
  ]);
  return hydratePaymentRow(row);
}

export async function recordFinanceAlertDeliveryFromNotify(
  quotationId: any,
  notifyResult: any,
  { channel = "queue" } = {},
) {
  const status = notifyResult?.notified
    ? FINANCE_ALERT_STATUSES.SENT
    : FINANCE_ALERT_STATUSES.FAILED;
  const error = notifyResult?.notified ? null : notifyResult?.reason || notifyResult?.error || "Finance alert failed";

  const payment = await persistFinanceAlertDelivery(quotationId, {
    status,
    error,
    incrementAttempts: false,
  });

  console.log("[finance_alert.delivery]", {
    quotationId,
    status: payment?.financeAlertStatus || status,
    channel,
  });

  return payment;
}

async function persistInternalCredentialsDelivery(
  quotationId: any,
  // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
  { status, error = null },
  client = null,
) {
  const runner = client || pool;
  const row = await paymentsRepo.updateInternalCredentialsDelivery(runner, [
    quotationId,
    status,
    error,
  ]);
  return hydratePaymentRow(row);
}

async function persistWelcomeEmailDelivery(
  quotationId: any,
  // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
  { status, error = null, incrementAttempts = false },
  client = null,
) {
  const runner = client || pool;
  const currentRow = await paymentsRepo.selectPaymentByQuotationId(runner, quotationId);
  const currentStatus = currentRow?.welcome_email_status;
  if (
    currentStatus === WELCOME_EMAIL_STATUSES.SENT &&
    status !== WELCOME_EMAIL_STATUSES.SENT
  ) {
    return hydratePaymentRow(currentRow);
  }

  const row = await paymentsRepo.updateWelcomeEmailDelivery(runner, [
    quotationId,
    status,
    error,
    incrementAttempts,
  ]);
  return hydratePaymentRow(row);
}

function resolveWelcomeEmailStatusFromNotify(notifyResult: any) {
  if (!notifyResult?.customerNotified) {
    return WELCOME_EMAIL_STATUSES.FAILED;
  }

  if (notifyResult.credentialsDelivered) {
    return WELCOME_EMAIL_STATUSES.SENT;
  }

  // Existing portal users keep their password; payment confirmation without a new
  // temporary password is still a successful welcome delivery.
  if (notifyResult.existingPortalLogin) {
    return WELCOME_EMAIL_STATUSES.SENT;
  }

  return WELCOME_EMAIL_STATUSES.SENT_WITHOUT_CREDENTIALS;
}

export async function recordWelcomeEmailDeliveryFromNotify(
  quotationId: any,
  notifyResult: any,
  { channel = "queue", leadId = null } = {},
) {
  const status = resolveWelcomeEmailStatusFromNotify(notifyResult);
  const error = notifyResult?.customerNotified ? null : notifyResult?.customerEmailError || null;

  const payment = await persistWelcomeEmailDelivery(quotationId, {
    status,
    error,
    incrementAttempts: false,
  });

  if (notifyResult?.internalCredentialsSent) {
    await persistInternalCredentialsDelivery(quotationId, {
      status: INTERNAL_CREDENTIALS_STATUSES.SENT,
      error: null,
    });
  } else if (notifyResult?.internalCredentialsError) {
    await persistInternalCredentialsDelivery(quotationId, {
      status: INTERNAL_CREDENTIALS_STATUSES.FAILED,
      error: notifyResult.internalCredentialsError,
    });
  } else if (!notifyResult?.credentialsNotified) {
    await persistInternalCredentialsDelivery(quotationId, {
      status: INTERNAL_CREDENTIALS_STATUSES.NOT_APPLICABLE,
      error: null,
    });
  }

  const refreshed = await getPaymentByQuotationId(quotationId);

  console.log("[welcome_email.delivery]", {
    quotationId,
    status: refreshed?.welcomeEmailStatus || status,
    credentialsDelivered: Boolean(notifyResult?.credentialsDelivered),
    internalCredentialsStatus: refreshed?.internalCredentialsStatus || null,
    channel,
  });

  await publishWelcomeEmailUpdated(quotationId, refreshed, leadId);

  return refreshed;
}

async function regeneratePortalAccessForQuotation(quotationId: any, { billingBranchId = null } = {}) {
  const client = await pool.connect();
  try {
    const quotationRow = await selectQuotationById(client, quotationId);
    if (!quotationRow) {
      return null;
    }

    const quotation = rowToCamel(quotationRow);
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    const { organization } = await ensureOrganizationForPaidLead(quotation.leadId, client);
    if (!organization) {
      return null;
    }

    const branchPortal = await provisionBranchPortalAccessForQuotation(
      client,
      // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
      quotation.leadId,
      quotationId,
      { resetCredentials: true, billingBranchId },
    );
    if (!branchPortal?.temporaryPassword) {
      return null;
    }

    return {
      email: branchPortal.email,
      temporaryPassword: branchPortal.temporaryPassword,
    };
  } finally {
    client.release();
  }
}

async function deliverFinanceAlert({
  // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
  quotationId,
  // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
  quotation,
  source = PAYMENT_PROVIDERS.MANUAL,
}) {
  await persistFinanceAlertDelivery(quotationId, {
    status: FINANCE_ALERT_STATUSES.PENDING,
    error: null,
    incrementAttempts: true,
  });

  const { getQuotation } = await import("../quotations/quotation-store.js");
  const hydrated = (await getQuotation(quotationId)) || quotation;

  try {
    const notifyResult = await notifyPaymentReported(hydrated, { source });
    const payment = await persistFinanceAlertDelivery(quotationId, {
      status: notifyResult.notified ? FINANCE_ALERT_STATUSES.SENT : FINANCE_ALERT_STATUSES.FAILED,
      // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
      error: notifyResult.notified ? null : notifyResult.reason || "Finance alert failed",
      incrementAttempts: false,
    });
    return { notified: notifyResult.notified, payment, notifyResult };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const payment = await persistFinanceAlertDelivery(quotationId, {
      status: FINANCE_ALERT_STATUSES.FAILED,
      // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
      error: message,
      incrementAttempts: false,
    });

    try {
      await queuePaymentReportedEmail(hydrated, { source, quotationId });
      return { notified: false, notificationQueued: true, payment };
    } catch (queueError) {
      console.error(
        "[payments] Finance alert fallback queue failed:",
        queueError instanceof Error ? queueError.message : queueError,
      );
      return { notified: false, notificationQueued: false, payment };
    }
  }
}

async function deliverCustomerPaymentReported({
  // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
  quotationId,
  // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
  quotation,
  source = PAYMENT_PROVIDERS.MANUAL,
}) {
  const { getQuotation } = await import("../quotations/quotation-store.js");
  const hydrated = (await getQuotation(quotationId)) || quotation;

  try {
    const result = await notifyCustomerPaymentReported(hydrated, { source });
    return { notified: result.notified, notificationQueued: false };
  } catch (error) {
    console.error(
      "[payments] Customer payment reported email failed:",
      error instanceof Error ? error.message : error,
    );
    try {
      await queueCustomerPaymentReportedEmail(hydrated, { source, quotationId });
      return { notified: false, notificationQueued: true };
    } catch (queueError) {
      console.error(
        "[payments] Customer payment reported queue failed:",
        queueError instanceof Error ? queueError.message : queueError,
      );
      return { notified: false, notificationQueued: false };
    }
  }
}

async function applyWelcomeNotifyResult(quotationId: any, notifyResult: any, leadId = null) {
  const payment = await persistWelcomeEmailDelivery(quotationId, {
    status: resolveWelcomeEmailStatusFromNotify(notifyResult),
    error: notifyResult.customerNotified ? null : notifyResult.customerEmailError,
    incrementAttempts: false,
  });

  if (notifyResult.internalCredentialsSent) {
    await persistInternalCredentialsDelivery(quotationId, {
      status: INTERNAL_CREDENTIALS_STATUSES.SENT,
      error: null,
    });
  } else if (notifyResult.internalCredentialsError) {
    await persistInternalCredentialsDelivery(quotationId, {
      status: INTERNAL_CREDENTIALS_STATUSES.FAILED,
      error: notifyResult.internalCredentialsError,
    });
  } else if (!notifyResult.credentialsNotified) {
    await persistInternalCredentialsDelivery(quotationId, {
      status: INTERNAL_CREDENTIALS_STATUSES.NOT_APPLICABLE,
      error: null,
    });
  }

  const refreshed = await getPaymentByQuotationId(quotationId);
  await publishWelcomeEmailUpdated(quotationId, refreshed, leadId);
  return refreshed;
}

async function deliverWelcomeEmail({
  // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
  quotationId,
  // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
  quotation,
  source = PAYMENT_PROVIDERS.MANUAL,
  productSync = null,
  regenerateCredentials = false,
  deferNotifications = false,
  autoRepairCredentials = true,
  leadId = null,
  mailContext = null,
  recipientMode = "default",
  skipInternal = false,
  billingBranchId = null,
}) {
  const isSalesResend = source === "sales_resend" || recipientMode === "customer_only";

  if (isSalesResend) {
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    if (!mailContext?.accountId) {
      const error = new Error(
        "Connect your Microsoft Outlook account before resending customer credentials.",
      );
      // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
      error.code = "needs_outlook_connect";
      // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
      error.needsOutlookConnect = true;
      throw error;
    }
  } else {
    await assertCustomerOutboundMailboxConfigured("sales");
  }

  await persistWelcomeEmailDelivery(quotationId, {
    status: WELCOME_EMAIL_STATUSES.PENDING,
    error: null,
    incrementAttempts: true,
  });

  let portalAccess = null;
  if (regenerateCredentials) {
    // Explicit resend / password reset path — rotate credentials.
    portalAccess = await regeneratePortalAccessForQuotation(quotationId, { billingBranchId });
  } else {
    // First purchase creates credentials; later purchases keep the existing password.
    portalAccess = await resolvePortalCredentialsForNotifyOutsideTx(productSync, quotationId);
  }

  const { getQuotation } = await import("../quotations/quotation-store.js");
  const hydrated = (await getQuotation(quotationId)) || quotation;

  if (deferNotifications) {
    await queuePaymentReceivedEmail(hydrated, { source, portalAccess });
    return {
      notified: false,
      notificationQueued: true,
      payment: await getPaymentByQuotationId(quotationId),
    };
  }

  const notifyOptions = {
    source,
    portalAccess,
    mailContext,
    recipientMode: isSalesResend ? "customer_only" : recipientMode,
    skipInternal: isSalesResend || skipInternal,
  };

  try {
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    let notifyResult = await notifyPaymentReceived(hydrated, notifyOptions);

    // Only rotate to repair when we intended to issue credentials (first-time or explicit resend)
    // and the customer email went out without them.
    if (
      autoRepairCredentials &&
      regenerateCredentials &&
      notifyResult.customerNotified &&
      !notifyResult.credentialsDelivered
    ) {
      const repairedAccess = await regeneratePortalAccessForQuotation(quotationId, {
        billingBranchId,
      });
      if (repairedAccess?.temporaryPassword) {
        portalAccess = repairedAccess;
        const customerRetry = await notifyCustomerWelcomeEmail(hydrated, {
          // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
          portalAccess,
          mailContext,
          recipientMode: notifyOptions.recipientMode,
        });
        notifyResult = {
          ...notifyResult,
          customerNotified: customerRetry.customerNotified,
          // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
          customerEmailError: customerRetry.customerEmailError,
          // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
          credentialsDelivered: customerRetry.credentialsDelivered,
          // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
          existingPortalLogin: customerRetry.existingPortalLogin,
          notified: notifyResult.internalNotified || customerRetry.customerNotified,
        };
        console.log("[welcome_email.repair]", {
          quotationId,
          repaired: customerRetry.credentialsDelivered,
        });
      }
    }

    if (notifyResult.customerEmailError && !notifyResult.customerNotified && isSalesResend) {
      throw new Error(notifyResult.customerEmailError);
    }

    const payment = await applyWelcomeNotifyResult(quotationId, notifyResult, leadId);

    return {
      notified: notifyResult.credentialsDelivered || notifyResult.existingPortalLogin || notifyResult.customerNotified,
      notificationQueued: false,
      notifyResult,
      payment,
      portalAccess,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const payment = await persistWelcomeEmailDelivery(quotationId, {
      status: WELCOME_EMAIL_STATUSES.FAILED,
      // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
      error: message,
      incrementAttempts: false,
    });

    if (isSalesResend) {
      throw error instanceof Error ? error : new Error(message);
    }

    try {
      await queuePaymentReceivedEmail(hydrated, { source, portalAccess });
      return { notified: false, notificationQueued: true, payment, portalAccess };
    } catch (queueError) {
      console.error(
        "[payments] Welcome email fallback queue failed:",
        queueError instanceof Error ? queueError.message : queueError,
      );
      return { notified: false, notificationQueued: false, payment, portalAccess };
    }
  }
}

/**
 * Step 1 — record gateway/manual payment report without fulfillment or customer email.
 * Stripe/Razorpay reports auto-run Step 2 (confirm + fulfillment + welcome). Manual/bank stays two-step.
 */
export async function recordProviderPaymentReported({
  // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
  quotationId,
  billingBranchId = null,
  providerPaymentId = null,
  providerCustomerId = null,
  providerEventId = null,
  source = PAYMENT_PROVIDERS.MANUAL,
  paidAt = new Date(),
  reportedBy = null,
  sendNotifications = true,
}) {
  logPayment(
    "payment.report.start",
    paymentLogDetails({
      quotationId,
      billingBranchId,
      providerPaymentId,
      providerCustomerId,
      providerEventId,
      source,
      reportedBy,
    }),
  );

  const result = await withTransaction(async (client: any) => {
    const quotationRow = await loadQuotationForFulfillment(client, quotationId);
    assertQuotationPayable(quotationRow);

    const existing = await paymentsRepo.selectPaymentForUpdate(client, quotationId);
    if (!existing) {
      throw new Error(`No payment record for quotation ${quotationId}`);
    }

    const multiBranch = await isMultiBranchPayment(client, quotationId);

    if (multiBranch) {
      if (!billingBranchId) {
        throw new Error("billingBranchId is required for multi-branch payment reporting.");
      }

      const branchRow = await branchPaymentsRepo.selectBranchPaymentForUpdate(
        client,
        quotationId,
        billingBranchId,
      );
      if (!branchRow) {
        throw new Error(`No branch payment record for billing target ${billingBranchId}.`);
      }

      if (branchRow.status === PAYMENT_STATUSES.PAID) {
        const payment = await loadFullPayment(client, quotationId, existing);
        return {
          quotation: buildQuotationPayload(quotationRow, payment),
          payment,
          alreadyPaid: true,
          alreadyReported: false,
          billingBranchId,
        };
      }

      const alreadyReported = branchRow.status === PAYMENT_STATUSES.REPORTED;
      const reportedAt = paidAt instanceof Date ? paidAt.toISOString() : paidAt;

      const updatedBranchRow = await branchPaymentsRepo.updateBranchPaymentReported(client, [
        quotationId,
        billingBranchId,
        PAYMENT_STATUSES.REPORTED,
        reportedAt,
        providerPaymentId,
        providerCustomerId,
        providerEventId,
        resolveProviderOverride(source),
        reportedAt,
        reportedBy,
      ]);

      if (!updatedBranchRow) {
        throw new Error("Could not record branch payment report for this quotation.");
      }

      const parentRow = await recomputeParentPaymentStatus(client, quotationId);
      const payment = await loadFullPayment(client, quotationId, parentRow || existing);
      return {
        quotation: buildQuotationPayload(quotationRow, payment),
        payment,
        alreadyPaid: false,
        alreadyReported,
        billingBranchId,
      };
    }

    if (existing.status === PAYMENT_STATUSES.PAID) {
      return {
        quotation: buildQuotationPayload(quotationRow, await loadFullPayment(client, quotationId, existing)),
        payment: await loadFullPayment(client, quotationId, existing),
        alreadyPaid: true,
        alreadyReported: false,
      };
    }

    const alreadyReported = existing.status === PAYMENT_STATUSES.REPORTED;
    const reportedAt = paidAt instanceof Date ? paidAt.toISOString() : paidAt;

    const updatedPaymentRow = await paymentsRepo.updatePaymentReported(client, [
      quotationId,
      PAYMENT_STATUSES.REPORTED,
      reportedAt,
      providerPaymentId,
      providerCustomerId,
      providerEventId,
      resolveProviderOverride(source),
      reportedAt,
      reportedBy,
    ]);

    if (!updatedPaymentRow) {
      const current = await paymentsRepo.selectPaymentForUpdate(client, quotationId);
      if (current?.status === PAYMENT_STATUSES.PAID) {
        return {
          quotation: buildQuotationPayload(quotationRow, await loadFullPayment(client, quotationId, current)),
          payment: await loadFullPayment(client, quotationId, current),
          alreadyPaid: true,
          alreadyReported: false,
        };
      }

      throw new Error("Could not record payment report for this quotation.");
    }

    const payment = await loadFullPayment(client, quotationId, updatedPaymentRow);
    return {
      quotation: buildQuotationPayload(quotationRow, payment),
      payment,
      alreadyPaid: false,
      alreadyReported,
    };
  });

  const reportContext = paymentLogDetails({
    quotationId,
    leadId: result.quotation?.leadId || null,
    companyName: companyNameFromQuotation(result.quotation),
    billingBranchId: result.billingBranchId || billingBranchId,
    providerPaymentId,
    providerCustomerId,
    providerEventId,
    source,
    provider: source,
    reportedBy,
    ...paymentAmountDetails(result.payment),
  });

  if (result.alreadyPaid) {
    logPayment(
      "payment.report.skipped",
      paymentLogDetails({ ...reportContext, alreadyPaid: true, reason: "already_paid" }),
    );
    return { ...result, notified: false };
  }

  if (result.alreadyReported) {
    logPayment(
      "payment.report.skipped",
      paymentLogDetails({
        ...reportContext,
        alreadyReported: true,
        reason: "already_reported",
      }),
    );
  } else {
    logPayment("payment.reported", reportContext);
  }

  // Gateway payments: skip "verify bank" emails and auto-run finance confirm + fulfillment.
  // Also retry confirm when a prior webhook left the row stuck at "reported".
  if (isGatewayPaymentSource(source)) {
    try {
      const confirmed = await confirmFinancePaymentWithRetry({
        quotationId,
        billingBranchId: result.billingBranchId || billingBranchId,
        providerPaymentId,
        providerCustomerId,
        providerEventId,
        source,
        paidAt,
        financeConfirmedBy: `auto:${source}`,
        sendNotifications,
      });

      return {
        ...confirmed,
        autoConfirmed: true,
        alreadyPaid: Boolean(confirmed.alreadyPaid),
        alreadyReported: Boolean(result.alreadyReported),
      };
    } catch (error) {
      logPaymentError("payment.auto_confirm.failed", error, {
        ...reportContext,
        financeConfirmedBy: `auto:${source}`,
      });
      // Re-throw so Stripe/Razorpay retry the webhook and sync endpoints can finish confirm.
      throw error;
    }
  }

  if (result.alreadyReported) {
    return { ...result, notified: false };
  }

  if (!sendNotifications) {
    return { ...result, notified: false, financeAlertNotified: false };
  }

  const financeAlert = await deliverFinanceAlert({
    quotationId,
    quotation: result.quotation,
    source,
  });

  const customerAck = await deliverCustomerPaymentReported({
    quotationId,
    quotation: result.quotation,
    source,
  });

  await publishPaymentEvent(
    "payment.reported",
    await withLeadPortalContext(result.quotation.leadId, {
      quotationId,
      leadId: result.quotation.leadId,
      status: "reported",
    }),
  );

  return {
    ...result,
    notified: financeAlert.notified,
    financeAlertNotified: financeAlert.notified,
    financeAlertQueued: financeAlert.notificationQueued,
    payment: financeAlert.payment || result.payment,
    customerAckNotified: customerAck.notified,
    customerAckQueued: customerAck.notificationQueued,
  };
}

/**
 * Step 2 — finance confirms payment, runs fulfillment, and sends customer email.
 *
 * Mark-paid is a short transaction (payment/quotation row locks only). Org/product
 * fulfillment runs after commit so lock timeouts and hanging sync-payment are avoided.
 */
export async function confirmFinancePayment({
  // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
  quotationId,
  billingBranchId = null,
  providerPaymentId = null,
  providerCustomerId = null,
  providerEventId = null,
  source = PAYMENT_PROVIDERS.MANUAL,
  paidAt = new Date(),
  financeConfirmedBy = null,
  sendNotifications = true,
  deferNotifications = false,
  awaitFulfillment = true,
}) {
  logPayment(
    "payment.confirm.start",
    paymentLogDetails({
      quotationId,
      billingBranchId,
      providerPaymentId,
      providerCustomerId,
      providerEventId,
      source,
      financeConfirmedBy,
      awaitFulfillment,
    }),
  );

  const markResult = await withTransaction(async (client: any) => {
    // Short timeouts: this TX only flips payment/quotation status under row locks.
    await client.query(`SET LOCAL lock_timeout = '8s'`);
    await client.query(`SET LOCAL statement_timeout = '25s'`);

    const quotationRow = await loadQuotationForFulfillment(client, quotationId);
    assertQuotationPayable(quotationRow);

    const existing = await paymentsRepo.selectPaymentForUpdate(client, quotationId);
    if (!existing) {
      throw new Error(`No payment record for quotation ${quotationId}`);
    }

    const multiBranch = await isMultiBranchPayment(client, quotationId);

    if (multiBranch) {
      if (!billingBranchId) {
        throw new Error("billingBranchId is required for multi-branch payment confirmation.");
      }

      const branchRow = await branchPaymentsRepo.selectBranchPaymentForUpdate(
        client,
        quotationId,
        billingBranchId,
      );
      if (!branchRow) {
        throw new Error(`No branch payment record for billing target ${billingBranchId}.`);
      }

      if (branchRow.status === PAYMENT_STATUSES.PAID) {
        const payment = await loadFullPayment(client, quotationId, existing);
        return {
          // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
          quotation: buildQuotationPayload(quotationRow, payment, quotationRow.status),
          payment,
          alreadyPaid: true,
          welcomeEmailSent: welcomeEmailAlreadySent(existing),
          skipWelcomeDelivery: shouldSkipAutoWelcomeDelivery(existing),
          notified: false,
          billingBranchId,
          needsProductFulfillment: true,
          fulfillmentPaidAt: branchRow.paid_at || paidAt,
          isFirstBranchPaid: false,
          multiBranch: true,
        };
      }

      if (branchRow.status !== PAYMENT_STATUSES.REPORTED) {
        throw new Error(
          "Branch payment must be reported before finance can confirm. Record the branch payment first.",
        );
      }

      const confirmedAt = paidAt instanceof Date ? paidAt.toISOString() : paidAt;
      const paidBefore = await branchPaymentsRepo.countBranchPaymentsByStatus(
        client,
        quotationId,
        PAYMENT_STATUSES.PAID,
      );
      const isFirstBranchPaid = paidBefore === 0;

      await branchPaymentsRepo.updateBranchPaymentPaid(client, [
        quotationId,
        billingBranchId,
        PAYMENT_STATUSES.PAID,
        confirmedAt,
        providerPaymentId,
        providerCustomerId,
        providerEventId,
        resolveProviderOverride(source),
        confirmedAt,
        financeConfirmedBy,
      ]);

      const parentRow = await recomputeParentPaymentStatus(client, quotationId);
      const totalBranches = await branchPaymentsRepo.countBranchPayments(client, quotationId);
      const paidCount = await branchPaymentsRepo.countBranchPaymentsByStatus(
        client,
        quotationId,
        PAYMENT_STATUSES.PAID,
      );
      const allPaid = paidCount >= totalBranches;

      // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
      let quotationStatus = quotationRow.status;
      let leadStatus = null;
      if (allPaid) {
        await paymentsRepo.updateQuotationStatusPaid(client, quotationId, QUOTATION_STATUSES.PAID);
        // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
        const leadSync = await syncLeadPaidIfDealComplete(client, quotationRow.leadId);
        leadStatus = leadSync.leadStatus;
        quotationStatus = QUOTATION_STATUSES.PAID;
        await fulfillLinkedProductRequestIfComplete(client, {
          ...quotationRow,
          id: quotationId,
          // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
          lead_id: quotationRow.leadId,
          status: QUOTATION_STATUSES.PAID,
        });
      }

      const payment = await loadFullPayment(client, quotationId, parentRow || existing);
      const quotation = buildQuotationPayload(quotationRow, payment, quotationStatus);

      // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
      if (isFirstBranchPaid && payment.welcomeEmailStatus !== WELCOME_EMAIL_STATUSES.SENT) {
        await persistWelcomeEmailDelivery(
          quotationId,
          { status: WELCOME_EMAIL_STATUSES.PENDING, error: null, incrementAttempts: false },
          client,
        );
      }

      return {
        quotation,
        payment,
        alreadyPaid: false,
        welcomeEmailSent: false,
        billingBranchId,
        allBranchesPaid: allPaid,
        isFirstBranchPaid,
        leadStatus,
        needsProductFulfillment: true,
        fulfillmentPaidAt: confirmedAt,
        multiBranch: true,
      };
    }

    const alreadyPaid = existing.status === PAYMENT_STATUSES.PAID;

    if (alreadyPaid) {
      const payment = await loadFullPayment(client, quotationId, existing);
      return {
        quotation: buildQuotationPayload(quotationRow, payment, QUOTATION_STATUSES.PAID),
        payment,
        alreadyPaid: true,
        welcomeEmailSent: welcomeEmailAlreadySent(existing),
        skipWelcomeDelivery: shouldSkipAutoWelcomeDelivery(existing),
        notified: false,
        needsProductFulfillment: true,
        fulfillmentPaidAt: existing.paid_at || paidAt,
        multiBranch: false,
        billingBranchId: null,
      };
    }

    if (existing.status !== PAYMENT_STATUSES.REPORTED) {
      throw new Error(
        "Payment must be reported before finance can confirm. Record the payment first.",
      );
    }

    const confirmedAt = paidAt instanceof Date ? paidAt.toISOString() : paidAt;

    const updatedPaymentRow = await paymentsRepo.updatePaymentPaid(client, [
      quotationId,
      PAYMENT_STATUSES.PAID,
      confirmedAt,
      providerPaymentId,
      providerCustomerId,
      providerEventId,
      resolveProviderOverride(source),
      confirmedAt,
      financeConfirmedBy,
    ]);

    await paymentsRepo.updateQuotationStatusPaid(client, quotationId, QUOTATION_STATUSES.PAID);
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    const leadSync = await syncLeadPaidIfDealComplete(client, quotationRow.leadId);
    await fulfillLinkedProductRequestIfComplete(client, {
      ...quotationRow,
      id: quotationId,
      // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
      lead_id: quotationRow.leadId,
      status: QUOTATION_STATUSES.PAID,
    });

    const payment = await loadFullPayment(client, quotationId, updatedPaymentRow);
    const quotation = buildQuotationPayload(quotationRow, payment, QUOTATION_STATUSES.PAID);
    const branchTarget = await resolveQuotationBillingBranch(client, quotationId);

    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    if (payment.welcomeEmailStatus !== WELCOME_EMAIL_STATUSES.SENT) {
      await persistWelcomeEmailDelivery(
        quotationId,
        { status: WELCOME_EMAIL_STATUSES.PENDING, error: null, incrementAttempts: false },
        client,
      );
    }

    return {
      quotation,
      payment,
      alreadyPaid: false,
      welcomeEmailSent: false,
      billingBranchId: branchTarget?.billingBranchId || null,
      leadStatus: leadSync.leadStatus,
      needsProductFulfillment: true,
      fulfillmentPaidAt: confirmedAt,
      multiBranch: false,
    };
  });

  const finishAfterMarkPaid = async () => {
    let productSync = null;
    let fulfillmentError = null;

    if (markResult.needsProductFulfillment) {
      try {
        productSync = await runProductFulfillmentWithRetry({
          quotationId,
          billingBranchId: markResult.billingBranchId || billingBranchId,
          paidAt: markResult.fulfillmentPaidAt,
          isFirstBranchPaid: markResult.isFirstBranchPaid !== false,
          multiBranch: markResult.multiBranch === true,
        });
      } catch (error) {
        fulfillmentError = error instanceof Error ? error.message : String(error);
        console.error(
          `[payments] Product fulfillment deferred for quotation ${quotationId} (payment already marked paid):`,
          fulfillmentError,
        );
      }
    }

    const result = {
      ...markResult,
      productSync,
      fulfillmentDeferred: Boolean(fulfillmentError),
      fulfillmentError,
    };

    const paymentFullyPaid =
      result.payment?.status === PAYMENT_STATUSES.PAID ||
      result.allBranchesPaid === true ||
      result.quotation?.status === QUOTATION_STATUSES.PAID;

    if (paymentFullyPaid) {
      try {
        const accrued = await accruePartnerCommissionForPaidQuotation(result.quotation, result.payment);
        if (!accrued && result.quotation?.leadId) {
          const { getLeadById } = await import("../leads/lead-store.js");
          const paidLead = await getLeadById(result.quotation.leadId);
          if (paidLead?.resellerId && !paidLead?.partnerId) {
            const { queuePortalCustomerPaidEmail } = await import("../../infra/notify.js");
            void queuePortalCustomerPaidEmail(result.quotation.id);
          }
        }
      } catch (error) {
        console.error(
          `[commissions] Failed to accrue partner commission for quotation ${quotationId}:`,
          error instanceof Error ? error.message : error,
        );
      }
    }

    if (result.alreadyPaid) {
      if (result.skipWelcomeDelivery || result.welcomeEmailSent || !sendNotifications) {
        return { ...result, notified: false, notificationQueued: false };
      }

      const delivery = await deliverWelcomeEmail({
        quotationId,
        quotation: result.quotation,
        source,
        productSync: result.productSync,
        regenerateCredentials: false,
        deferNotifications,
        leadId: result.quotation.leadId,
        // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
        billingBranchId: result.billingBranchId || null,
      });

      return {
        ...result,
        payment: delivery.payment || result.payment,
        notified: delivery.notified,
        notificationQueued: delivery.notificationQueued,
        portalAccess: delivery.portalAccess || null,
      };
    }

    if (!sendNotifications) {
      return { ...result, notified: false, notificationQueued: false };
    }

    // First purchase: issue credentials if the portal user is new.
    // Additional purchases: keep the existing password and send payment confirmation only.
    let delivery = {
      notified: false,
      notificationQueued: false,
      payment: result.payment,
      portalAccess: null,
    };

    try {
      // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
      delivery = await deliverWelcomeEmail({
        quotationId,
        quotation: result.quotation,
        source,
        productSync: result.productSync,
        regenerateCredentials: false,
        deferNotifications,
        leadId: result.quotation.leadId,
        // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
        billingBranchId: result.billingBranchId || null,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[payments] Welcome email failed for quotation ${quotationId}:`, message);
      try {
        await persistWelcomeEmailDelivery(quotationId, {
          status: WELCOME_EMAIL_STATUSES.FAILED,
          // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
          error: message,
          incrementAttempts: false,
        });
        await publishWelcomeEmailUpdated(
          quotationId,
          { welcomeEmailStatus: WELCOME_EMAIL_STATUSES.FAILED },
          result.quotation?.leadId || null,
        );
      } catch (persistError) {
        console.error(
          `[payments] Could not mark welcome email failed for ${quotationId}:`,
          persistError instanceof Error ? persistError.message : persistError,
        );
      }
    }

    // Always publish so dashboards refresh even if welcome email fails.
    if (
      result.allBranchesPaid ||
      result.payment?.status === PAYMENT_STATUSES.PAID ||
      result.quotation?.status === QUOTATION_STATUSES.PAID
    ) {
      const publishStatus =
        result.leadStatus === "Partially paid"
          ? "partial"
          : result.leadStatus === "Paid" ||
              result.allBranchesPaid ||
              result.payment?.status === PAYMENT_STATUSES.PAID
            ? "Paid"
            : "partial";
      await publishPaymentEvent(
        "payment.paid",
        await withLeadPortalContext(result.quotation.leadId, {
          quotationId,
          leadId: result.quotation.leadId,
          status: publishStatus,
          billingBranchId: result.billingBranchId || null,
        }),
      );
    }

    return {
      ...result,
      payment: delivery.payment || result.payment,
      notified: delivery.notified,
      notificationQueued: delivery.notificationQueued,
      portalAccess: delivery.portalAccess || null,
    };
  };

  const logConfirmOutcome = (outcome: any) => {
    logPayment(
      outcome.alreadyPaid ? "payment.confirm.skipped" : "payment.confirmed",
      paymentLogDetails({
        quotationId,
        leadId: outcome.quotation?.leadId || null,
        companyName: companyNameFromQuotation(outcome.quotation),
        billingBranchId: outcome.billingBranchId || billingBranchId,
        providerPaymentId,
        providerCustomerId,
        providerEventId,
        source,
        provider: source,
        financeConfirmedBy,
        alreadyPaid: Boolean(outcome.alreadyPaid),
        reason: outcome.alreadyPaid ? "already_paid" : null,
        fulfillmentDeferred: outcome.fulfillmentDeferred,
        ...paymentAmountDetails(outcome.payment),
      }),
    );
  };

  // Finance HTTP mark-paid / confirm-payment must return after payment is paid.
  // Product fulfillment + emails continue in the background.
  if (!awaitFulfillment && markResult.needsProductFulfillment) {
    void finishAfterMarkPaid().catch(async (error) => {
      const message = error instanceof Error ? error.message : String(error);
      logPaymentError("payment.fulfillment.background_failed", error, {
        quotationId,
        billingBranchId: markResult.billingBranchId || billingBranchId,
        source,
      });
      try {
        await persistWelcomeEmailDelivery(quotationId, {
          status: WELCOME_EMAIL_STATUSES.FAILED,
          // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
          error: message,
          incrementAttempts: false,
        });
        await publishWelcomeEmailUpdated(
          quotationId,
          { welcomeEmailStatus: WELCOME_EMAIL_STATUSES.FAILED },
          markResult.quotation?.leadId || null,
        );
      } catch {
        /* best-effort status for Finance resend */
      }
    });
    const deferredResult = {
      ...markResult,
      productSync: null,
      fulfillmentDeferred: true,
      fulfillmentError: null,
      notified: false,
      notificationQueued: Boolean(sendNotifications),
    };
    logConfirmOutcome(deferredResult);
    return deferredResult;
  }

  const finalResult = await finishAfterMarkPaid();
  logConfirmOutcome(finalResult);
  return finalResult;
}

/**
 * Resend customer welcome email for an already-paid quotation.
 */
export async function resendCustomerWelcomeEmail(
  quotationId: any,
  { source = "manual_resend", actorUserId = null } = {},
) {
  const quotationRow = await loadQuotationForFulfillment(pool, quotationId);
  if (!quotationRow) {
    throw new Error(`Quotation not found: ${quotationId}`);
  }

  if (quotationRow.status !== QUOTATION_STATUSES.PAID) {
    throw new Error("Welcome email can only be resent after payment is confirmed.");
  }

  const payment = await getPaymentByQuotationId(quotationId);
  if (payment?.status !== PAYMENT_STATUSES.PAID) {
    throw new Error("Payment must be confirmed before resending the welcome email.");
  }

  const quotation = buildQuotationPayload(quotationRow, payment, QUOTATION_STATUSES.PAID);

  let mailContext = null;
  let recipientMode = "default";
  let skipInternal = false;

  if (source === "sales_resend") {
    if (!actorUserId) {
      throw new Error("Sales user is required to resend credentials.");
    }
    const { resolveMailContextForUser } = await import("../notifications/service.js");
    mailContext = await resolveMailContextForUser(actorUserId);
    if (!mailContext?.accountId) {
      const error = new Error(
        "Connect your Microsoft Outlook account before resending customer credentials.",
      );
      // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
      error.code = "needs_outlook_connect";
      // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
      error.needsOutlookConnect = true;
      throw error;
    }
    recipientMode = "customer_only";
    skipInternal = true;
  }

  const delivery = await deliverWelcomeEmail({
    quotationId,
    quotation,
    source,
    productSync: null,
    regenerateCredentials: true,
    deferNotifications: false,
    autoRepairCredentials: true,
    leadId: quotation.leadId,
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    mailContext,
    recipientMode,
    skipInternal,
  });

  return {
    quotation: {
      ...quotation,
      payment: delivery.payment || payment,
    },
    payment: delivery.payment || payment,
    notified: delivery.notified,
    notificationQueued: delivery.notificationQueued,
    portalAccess: delivery.portalAccess || null,
    passwordRotated: true,
  };
}

/**
 * Resend finance alert for a reported payment.
 */
export async function resendFinancePaymentAlert(quotationId: any, { source = "manual_resend" } = {}) {
  const payment = await getPaymentByQuotationId(quotationId);
  if (payment?.status !== PAYMENT_STATUSES.REPORTED) {
    throw new Error("Finance alert can only be resent while payment is awaiting confirmation.");
  }

  const quotationRow = await loadQuotationForFulfillment(pool, quotationId);
  if (!quotationRow) {
    throw new Error(`Quotation not found: ${quotationId}`);
  }

  const quotation = buildQuotationPayload(quotationRow, payment);
  const delivery = await deliverFinanceAlert({ quotationId, quotation, source });

  return {
    quotation,
    payment: delivery.payment || payment,
    notified: delivery.notified,
    notificationQueued: delivery.notificationQueued,
  };
}

/**
 * Mark a quotation payment as paid. Idempotent — safe to call multiple times.
 * For scripts and legacy callers: auto-reports pending payments, then confirms.
 * @returns {{ quotation, payment, alreadyPaid: boolean, notified: boolean }}
 */
export async function markQuotationPaymentPaid({
  // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
  quotationId,
  billingBranchId = null,
  providerPaymentId = null,
  providerCustomerId = null,
  providerEventId = null,
  source = PAYMENT_PROVIDERS.MANUAL,
  paidAt = new Date(),
  sendNotifications = true,
  deferNotifications = false,
  financeConfirmedBy = null,
  awaitFulfillment = true,
}) {
  const payment = await getPaymentByQuotationId(quotationId);
  // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
  const multiBranch = (payment?.branchPayments?.length || 0) > 1;
  const branchTarget = billingBranchId || (multiBranch ? null : undefined);

  if (multiBranch && !billingBranchId) {
    throw new Error("billingBranchId is required for multi-branch payment confirmation.");
  }

  const branchRow = multiBranch
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    ? payment.branchPayments.find((entry: any) => entry.billingBranchId === billingBranchId)
    : null;

  if (multiBranch && branchRow?.status === PAYMENT_STATUSES.PENDING) {
    await recordProviderPaymentReported({
      quotationId,
      billingBranchId,
      providerPaymentId,
      providerCustomerId,
      providerEventId,
      source,
      paidAt,
      sendNotifications: false,
    });
  } else if (!multiBranch && payment?.status === PAYMENT_STATUSES.PENDING) {
    await recordProviderPaymentReported({
      quotationId,
      providerPaymentId,
      providerCustomerId,
      providerEventId,
      source,
      paidAt,
      sendNotifications: false,
    });
  }

  return confirmFinancePayment({
    quotationId,
    billingBranchId: branchTarget,
    providerPaymentId,
    providerCustomerId,
    providerEventId,
    source,
    paidAt,
    financeConfirmedBy,
    sendNotifications,
    deferNotifications,
    awaitFulfillment,
  });
}

export async function markQuotationPaymentFailed({
  // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
  quotationId,
  billingBranchId = null,
  failureReason = "Payment failed",
  providerEventId = null,
  providerPaymentId = null,
}) {
  const payment = await withTransaction(async (client: any) => {
    const existing = await paymentsRepo.selectPaymentForUpdate(client, quotationId);
    if (!existing) {
      return null;
    }

    const multiBranch = await isMultiBranchPayment(client, quotationId);

    if (multiBranch && billingBranchId) {
      const branchRow = await branchPaymentsRepo.selectBranchPaymentForUpdate(
        client,
        quotationId,
        billingBranchId,
      );
      if (!branchRow) {
        return null;
      }

      if (
        branchRow.status === PAYMENT_STATUSES.PAID ||
        branchRow.status === PAYMENT_STATUSES.REPORTED ||
        branchRow.status === PAYMENT_STATUSES.PARTIAL
      ) {
        return loadFullPayment(client, quotationId, existing);
      }

      const updatedBranch = await branchPaymentsRepo.updateBranchPaymentFailed(client, [
        quotationId,
        billingBranchId,
        PAYMENT_STATUSES.FAILED,
        failureReason,
        providerEventId,
        providerPaymentId,
      ]);
      if (!updatedBranch) {
        return loadFullPayment(client, quotationId, existing);
      }

      const parentRow = await recomputeParentPaymentStatus(client, quotationId, {
        // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
        failureReason,
        providerEventId,
        providerPaymentId,
      });
      return loadFullPayment(client, quotationId, parentRow || existing);
    }

    if (
      existing.status === PAYMENT_STATUSES.PAID ||
      existing.status === PAYMENT_STATUSES.REPORTED ||
      existing.status === PAYMENT_STATUSES.PARTIAL ||
      existing.status === PAYMENT_STATUSES.REFUNDED
    ) {
      return loadFullPayment(client, quotationId, existing);
    }

    const row = await paymentsRepo.updatePaymentFailed(client, [
      quotationId,
      PAYMENT_STATUSES.FAILED,
      failureReason,
      providerEventId,
      providerPaymentId,
    ]);

    return loadFullPayment(client, quotationId, row || existing);
  });

  logPayment(
    "payment.failed",
    paymentLogDetails({
      quotationId,
      billingBranchId,
      providerEventId,
      providerPaymentId,
      failureReason,
      ...paymentAmountDetails(payment),
      paymentStatus: payment?.status || PAYMENT_STATUSES.FAILED,
    }),
  );

  if (payment?.status === PAYMENT_STATUSES.FAILED) {
    try {
      const quotationRow = await paymentsRepo.selectQuotationLeadIdAndSnapshot(pool, quotationId);
      await publishPaymentEvent(
        "payment.failed",
        await withLeadPortalContext(quotationRow?.lead_id || null, {
          quotationId,
          leadId: quotationRow?.lead_id || null,
          status: PAYMENT_STATUSES.FAILED,
          billingBranchId,
          failureReason,
        }),
      );
    } catch (error) {
      logPaymentError("payment.failed.publish", error, { quotationId });
    }
  }

  return payment;
}

export async function markQuotationPaymentRefunded({
  // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
  quotationId,
  providerEventId = null,
  failureReason = "Payment refunded",
}) {
  const payment = await withTransaction(async (client: any) => {
    const row = await paymentsRepo.updatePaymentRefunded(client, [
      quotationId,
      PAYMENT_STATUSES.REFUNDED,
      failureReason,
      providerEventId,
      PAYMENT_STATUSES.PAID,
    ]);

    return hydratePaymentRow(row);
  });

  logPayment(
    "payment.refunded",
    paymentLogDetails({
      quotationId,
      providerEventId,
      failureReason,
      ...paymentAmountDetails(payment),
      paymentStatus: payment?.status || PAYMENT_STATUSES.REFUNDED,
    }),
  );

  return payment;
}

export async function resolveQuotationIdFromStripeMetadata(metadata = {}) {
  // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
  const quotationId = metadata.quotation_id || metadata.quotationId;
  if (quotationId && String(quotationId).trim()) {
    return String(quotationId).trim();
  }

  return null;
}

export async function resolveQuotationIdFromStripePaymentLink(paymentLinkId: any) {
  const context = await paymentsRepo.resolvePaymentLinkContext(pool, paymentLinkId);
  return context?.quotationId || null;
}

export async function resolvePaymentLinkContext(paymentLinkId: any) {
  return paymentsRepo.resolvePaymentLinkContext(pool, paymentLinkId);
}
