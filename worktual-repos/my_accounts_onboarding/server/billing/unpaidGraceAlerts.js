import { pool } from "../db/pool.js";
import { env } from "../infra/env.js";
import { createSystemCancellationRequest, REQUEST_KINDS, TRIGGER_SOURCES } from "../branchCancellationRequests.js";
import { insertBranchCancellationAlert } from "../repositories/raw/branchCancellationRequests.repo.js";
import { notifyAdminBranchCancellationAlert } from "../notifications.js";
import { QUOTATION_STATUSES } from "../statuses.js";
import { PAYMENT_STATUSES } from "../payments/constants.js";

function graceDays() {
  const configured = Number(env("BRANCH_PAYMENT_GRACE_DAYS") || 14);
  return Number.isFinite(configured) && configured > 0 ? configured : 14;
}

async function processInitialUnpaidAlerts(client) {
  const days = graceDays();
  const { rows } = await client.query(
    `SELECT q.id AS quotation_id, q.lead_id, q.reviewed_at, q.lead_snapshot,
            p.status AS payment_status, p.grand_total, p.currency,
            l.converted_organization_id AS organization_id
     FROM quotations q
     JOIN payments p ON p.quotation_id = q.id
     JOIN leads l ON l.id = q.lead_id
     WHERE q.status = $1
       AND p.status = $2
       AND q.reviewed_at IS NOT NULL
       AND q.reviewed_at + make_interval(days => $3) < NOW()`,
    [QUOTATION_STATUSES.APPROVED, PAYMENT_STATUSES.PENDING, days],
  );

  let created = 0;

  for (const quotation of rows) {
    if (!quotation.organization_id) {
      continue;
    }

    const { rows: assignments } = await client.query(
      `SELECT product_id, branch_id FROM product_assignments WHERE quotation_id = $1`,
      [quotation.quotation_id],
    );

    const leadSnapshot =
      typeof quotation.lead_snapshot === "string"
        ? JSON.parse(quotation.lead_snapshot)
        : quotation.lead_snapshot || {};
    const companyName = leadSnapshot.companyName || "";
    const domainId = leadSnapshot.domainId || "";
    const graceDeadline = new Date(quotation.reviewed_at);
    graceDeadline.setDate(graceDeadline.getDate() + days);

    for (const assignment of assignments) {
      const alertRow = await insertBranchCancellationAlert(client, [
        "initial_unpaid",
        quotation.organization_id,
        assignment.branch_id,
        assignment.product_id,
        null,
        quotation.quotation_id,
        graceDeadline.toISOString(),
        null,
      ]);

      if (!alertRow) {
        continue;
      }

      const request = await createSystemCancellationRequest(
        {
          organizationId: quotation.organization_id,
          sourceLeadId: quotation.lead_id,
          requestKind: REQUEST_KINDS.CANCEL_PRODUCT,
          locationId: assignment.branch_id,
          productId: assignment.product_id,
          subscriptionId: null,
          triggerSource: TRIGGER_SOURCES.SYSTEM_UNPAID_INITIAL,
          graceDeadlineAt: graceDeadline.toISOString(),
          relatedQuotationId: quotation.quotation_id,
          customerNote: `Initial payment not received within ${days} day grace period after finance approval.`,
          companyName,
          domainId,
        },
        client,
      );

      if (request) {
        await client.query(
          `UPDATE branch_cancellation_alerts SET request_id = $2 WHERE id = $1`,
          [alertRow.id, request.id],
        );
        await notifyAdminBranchCancellationAlert(request, {
          scenario: "initial_unpaid",
          amountDue: quotation.grand_total,
          currency: quotation.currency,
        });
        created += 1;
      }
    }
  }

  return created;
}

async function processRenewalUnpaidAlerts(client) {
  const days = graceDays();
  const { rows } = await client.query(
    `SELECT s.*, o.company_name, o.domain_id
     FROM subscriptions s
     JOIN organizations o ON o.id = s.organization_id
     WHERE s.status = 'active'
       AND s.payment_confirmed_at IS NOT NULL
       AND s.renews_at IS NOT NULL
       AND s.renews_at + make_interval(days => $1) < NOW()`,
    [days],
  );

  let created = 0;

  for (const sub of rows) {
    const graceDeadline = new Date(sub.renews_at);
    graceDeadline.setDate(graceDeadline.getDate() + days);

    const alertRow = await insertBranchCancellationAlert(client, [
      "renewal_unpaid",
      sub.organization_id,
      sub.location_id,
      sub.product_id,
      sub.id,
      null,
      graceDeadline.toISOString(),
      null,
    ]);

    if (!alertRow) {
      continue;
    }

    const request = await createSystemCancellationRequest(
      {
        organizationId: sub.organization_id,
        sourceLeadId: sub.source_lead_id,
        requestKind: REQUEST_KINDS.CANCEL_PRODUCT,
        locationId: sub.location_id,
        productId: sub.product_id,
        subscriptionId: sub.id,
        triggerSource: TRIGGER_SOURCES.SYSTEM_UNPAID_RENEWAL,
        graceDeadlineAt: graceDeadline.toISOString(),
        relatedQuotationId: sub.quotation_id,
        customerNote: `Renewal payment not received within ${days} day grace period after subscription expiry.`,
        companyName: sub.company_name || "",
        domainId: sub.domain_id || "",
      },
      client,
    );

    if (request) {
      await client.query(`UPDATE branch_cancellation_alerts SET request_id = $2 WHERE id = $1`, [
        alertRow.id,
        request.id,
      ]);
      await notifyAdminBranchCancellationAlert(request, {
        scenario: "renewal_unpaid",
        renewsAt: sub.renews_at,
      });
      created += 1;
    }
  }

  return created;
}

export async function processUnpaidGraceAlerts(client = null) {
  const runner = client || (await pool.connect());
  const shouldRelease = !client;

  try {
    const initialCount = await processInitialUnpaidAlerts(runner);
    const renewalCount = await processRenewalUnpaidAlerts(runner);
    return { initialCount, renewalCount, total: initialCount + renewalCount };
  } finally {
    if (shouldRelease) {
      runner.release();
    }
  }
}

export { graceDays };
