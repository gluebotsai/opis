import { pool, withTransaction } from "../../db/pool.js";
import { rowToCamel, toIso } from "../../db/util.js";
import {
  BILLING_PHASES,
  PRODUCT_LIFECYCLE,
  UAT_DURATION_DAYS,
  UAT_DURATION_OPTIONS_DAYS,
  normalizeUatDurationDays,
} from "../payments/billingPhases.js";
import * as goLiveRepo from "../../repositories/raw/productGoLive.repo.js";
import { selectQuotationById } from "../../repositories/raw/quotations.repo.js";
import { logPayment, logPaymentError } from "../../infra/file-logger.js";
import { publishPaymentEvent } from "../../infra/events.js";

function hydrateGoLive(row: any) {
  if (!row) {
    return null;
  }
  const entry = rowToCamel(row);
  return {
    id: entry!.id,
    organizationId: entry!.organizationId,
    leadId: entry!.leadId,
    productId: entry!.productId,
    branchId: entry!.branchId,
    billingBranchId: entry!.billingBranchId || "hq",
    lifecycleStatus: entry!.lifecycleStatus,
    otcQuotationId: entry!.otcQuotationId || null,
    goLiveQuotationId: entry!.goLiveQuotationId || null,
    subscriptionId: entry!.subscriptionId || null,
    uatExpiresAt: toIso(entry!.uatExpiresAt),
    uatExtendedCount: Number(entry!.uatExtendedCount || 0),
    uatCredentials: entry!.uatCredentials || null,
    changeRequestNote: entry!.changeRequestNote || null,
    acceptedAt: toIso(entry!.acceptedAt),
    goLivePaidAt: toIso(entry!.goLivePaidAt),
    createdAt: toIso(entry!.createdAt),
    updatedAt: toIso(entry!.updatedAt),
  };
}

function addDaysIso(days: any) {
  const date = new Date();
  date.setDate(date.getDate() + Number(days || 0));
  return date.toISOString();
}

export async function listGoLiveForLead(leadId: any) {
  const rows = await goLiveRepo.selectGoLiveByLead(pool, leadId);
  return rows.map(hydrateGoLive);
}

export async function listGoLiveForOrganization(organizationId: any) {
  const rows = await goLiveRepo.selectGoLiveByOrganization(pool, organizationId);
  return rows.map(hydrateGoLive);
}

export async function seedGoLiveFromOtcQuotation(client: any, quotationId: any, leadId: any, organizationId: any) {
  if (!organizationId) {
    throw new Error("Organization is required to seed go-live products after OTC payment.");
  }

  const quotationRow = await selectQuotationById(client, quotationId);
  if (!quotationRow) {
    return [];
  }

  const { rows: assignments } = await client.query(
    `SELECT product_id, branch_id, billing_branch_id, config
     FROM product_assignments WHERE quotation_id = $1`,
    [quotationId],
  );

  const created = [];
  for (const assignment of assignments) {
    const row = await goLiveRepo.upsertProductGoLive(client, [
      organizationId,
      leadId,
      assignment.product_id,
      assignment.branch_id || "hq",
      assignment.billing_branch_id || assignment.branch_id || "hq",
      PRODUCT_LIFECYCLE.AWAITING_IMPLEMENTATION,
      quotationId,
      null,
      null,
    ]);
    created.push(hydrateGoLive(row));
  }
  return created;
}

export async function sendUatAccess({
  goLiveId,
  leadId = null,
  credentials = {},
  note = "",
  durationDays = UAT_DURATION_DAYS,
}: any) {
  return withTransaction(async (client: any) => {
    const existing = await goLiveRepo.selectGoLiveById(client, goLiveId);
    if (!existing) {
      throw new Error("Go-live product record not found.");
    }
    if (leadId && String(existing.lead_id) !== String(leadId)) {
      throw new Error("Go-live product does not belong to this lead.");
    }
    if (existing.lifecycle_status !== PRODUCT_LIFECYCLE.AWAITING_IMPLEMENTATION) {
      throw new Error(
        "UAT can only be sent once while the product is awaiting implementation. Use Extend UAT after it expires.",
      );
    }

    const days = normalizeUatDurationDays(durationDays);
    const expiresAt = addDaysIso(days);
    const payload = {
      ...(existing.uat_credentials || {}),
      ...credentials,
      note: note || credentials.note || "",
      durationDays: days,
      sentAt: new Date().toISOString(),
    };

    const row = await goLiveRepo.updateGoLiveUat(client, [
      goLiveId,
      PRODUCT_LIFECYCLE.UAT,
      expiresAt,
      JSON.stringify(payload),
      false,
    ]);

    logPayment("product.uat.sent", {
      goLiveId,
      leadId: existing.lead_id,
      productId: existing.product_id,
      durationDays: days,
      uatExpiresAt: expiresAt,
    });

    await publishPaymentEvent("payment.uat_updated", {
      leadId: existing.lead_id,
      goLiveId,
      productId: existing.product_id,
      status: PRODUCT_LIFECYCLE.UAT,
    });

    return hydrateGoLive(row);
  });
}

export async function extendUatAccess({
  goLiveId,
  leadId = null,
  credentials = null,
  note = "",
  durationDays = UAT_DURATION_DAYS,
}: any = {}) {
  return withTransaction(async (client: any) => {
    const existing = await goLiveRepo.selectGoLiveById(client, goLiveId);
    if (!existing) {
      throw new Error("Go-live product record not found.");
    }
    if (leadId && String(existing.lead_id) !== String(leadId)) {
      throw new Error("Go-live product does not belong to this lead.");
    }
    if (existing.lifecycle_status !== PRODUCT_LIFECYCLE.UAT_EXPIRED) {
      throw new Error("Extend UAT is only available after UAT has expired.");
    }

    const days = normalizeUatDurationDays(durationDays);
    const expiresAt = addDaysIso(days);
    let credentialsJson = null;
    if (credentials && typeof credentials === "object") {
      const payload = {
        ...(existing.uat_credentials || {}),
        ...credentials,
        note: note || credentials.note || existing.uat_credentials?.note || "",
        durationDays: days,
        sentAt: new Date().toISOString(),
        extendedAt: new Date().toISOString(),
      };
      credentialsJson = JSON.stringify(payload);
    } else {
      const previous =
        existing.uat_credentials && typeof existing.uat_credentials === "object"
          ? existing.uat_credentials
          : {};
      credentialsJson = JSON.stringify({
        ...previous,
        durationDays: days,
        extendedAt: new Date().toISOString(),
      });
    }

    const row = await goLiveRepo.updateGoLiveUat(client, [
      goLiveId,
      PRODUCT_LIFECYCLE.UAT,
      expiresAt,
      credentialsJson,
      true,
    ]);

    logPayment("product.uat.extended", {
      goLiveId,
      leadId: existing.lead_id,
      productId: existing.product_id,
      durationDays: days,
      uatExpiresAt: expiresAt,
    });

    await publishPaymentEvent("payment.uat_updated", {
      leadId: existing.lead_id,
      goLiveId,
      productId: existing.product_id,
      status: PRODUCT_LIFECYCLE.UAT,
    });

    return hydrateGoLive(row);
  });
}

export async function requestGoLiveChanges(goLiveId: any, note: any) {
  const existing = await goLiveRepo.selectGoLiveById(pool, goLiveId);
  if (!existing) {
    throw new Error("Go-live product record not found.");
  }
  if (
    ![PRODUCT_LIFECYCLE.UAT, PRODUCT_LIFECYCLE.UAT_EXPIRED].includes(existing.lifecycle_status)
  ) {
    throw new Error("Change requests are only allowed during UAT.");
  }

  const row = await goLiveRepo.updateGoLiveChangeRequest(
    pool,
    goLiveId,
    String(note || "").trim() || "Customer requested UAT changes",
  );

  await publishPaymentEvent("payment.uat_updated", {
    leadId: existing.lead_id,
    goLiveId,
    productId: existing.product_id,
    status: existing.lifecycle_status,
    changeRequested: true,
  });

  return hydrateGoLive(row);
}

export async function markGoLiveAccepted(goLiveId: any, goLiveQuotationId: any) {
  const row = await goLiveRepo.updateGoLiveAccepted(pool, [goLiveId, goLiveQuotationId]);
  return hydrateGoLive(row);
}

export async function markGoLiveProductsPaidForQuotation(client: any, quotationId: any) {
  const rows = await goLiveRepo.selectGoLiveByQuotation(client, quotationId);
  const updated = [];
  for (const row of rows) {
    if (row.go_live_quotation_id === quotationId || row.lifecycle_status === PRODUCT_LIFECYCLE.AWAITING_SUBSCRIPTION_PAYMENT) {
      const next = await goLiveRepo.updateGoLivePaid(client, row.id);
      updated.push(hydrateGoLive(next));
    }
  }
  return updated;
}

export async function expireDueUatAccess() {
  const rows = await goLiveRepo.expireDueUatRows(pool);
  for (const row of rows) {
    await publishPaymentEvent("payment.uat_updated", {
      leadId: row.lead_id,
      goLiveId: row.id,
      productId: row.product_id,
      status: PRODUCT_LIFECYCLE.UAT_EXPIRED,
    }).catch((error) => {
      logPaymentError("product.uat.expire_publish", error, { goLiveId: row.id });
    });
  }
  return rows.length;
}

export {
  BILLING_PHASES,
  PRODUCT_LIFECYCLE,
  UAT_DURATION_DAYS,
  UAT_DURATION_OPTIONS_DAYS,
  normalizeUatDurationDays,
};
