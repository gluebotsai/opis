import crypto from "node:crypto";

import { pool } from "../../db/pool.js";
import { rowToCamel, toIso } from "../../db/util.js";
import {
  insertBranchAddRequest,
  selectBranchAddRequestById,
  selectBranchAddRequestsByLeadId,
  selectBranchAddRequestsByOrganization,
  withdrawBranchAddRequest as withdrawBranchAddRequestRow,
} from "../../repositories/raw/branchAddRequests.repo.js";
import { publishRequestEvent } from "../../infra/events.js";

export const BRANCH_ADD_STATUSES = {
  SUBMITTED: "submitted",
  WITHDRAWN: "withdrawn",
  ACKNOWLEDGED: "acknowledged",
};

function generateRequestNumber() {
  const year = new Date().getFullYear();
  const suffix = crypto.randomBytes(2).toString("hex").toUpperCase();
  return `BAR-${year}-${suffix}`;
}

function mapRequestRow(row: any) {
  if (!row) {
    return null;
  }

  const entry = rowToCamel(row);
  const payload =
    typeof entry!.payload === "string" ? JSON.parse(entry!.payload) : entry!.payload || {};

  return {
    id: entry!.id,
    requestNumber: entry!.requestNumber,
    organizationId: entry!.organizationId,
    sourceLeadId: entry!.sourceLeadId || null,
    requestedByCustomerUserId: entry!.requestedByCustomerUserId || null,
    status: entry!.status,
    companyName: entry!.companyName || "",
    contactEmail: entry!.contactEmail || "",
    payload: {
      label: payload.label || "",
      address: payload.address || "",
      city: payload.city || "",
      state: payload.state || "",
      country: payload.country || "",
      workEmail: payload.workEmail || "",
      mobileCountryCode: payload.mobileCountryCode || "",
      mobileNumber: payload.mobileNumber || "",
      note: payload.note || "",
    },
    createdAt: toIso(entry!.createdAt),
    updatedAt: toIso(entry!.updatedAt),
  };
}

function emitBranchAddEvent(event: any, request: any) {
  if (!request?.id) {
    return;
  }
  void publishRequestEvent(event, {
    requestId: request.id,
    organizationId: request.organizationId,
    leadId: request.sourceLeadId || null,
    status: request.status,
  });
}

function normalizePayload(body: any = {}) {
  // Confirmation-only portal flow may send an empty body; sales collects details later.
  const label = String((body as any).label || "").trim();
  const address = String((body as any).address || "").trim();
  const city = String((body as any).city || "").trim();
  const state = String((body as any).state || "").trim();
  const country = String((body as any).country || "").trim();
  const workEmail = String((body as any).workEmail || "").trim().toLowerCase();
  const mobileCountryCode = String((body as any).mobileCountryCode || "").trim();
  const mobileNumber = String((body as any).mobileNumber || "").trim();
  const note = String((body as any).note || "").trim();

  if (workEmail && !workEmail.includes("@")) {
    throw Object.assign(new Error("Enter a valid work email."), { status: 400 });
  }

  return {
    label,
    address,
    city,
    state,
    country,
    workEmail,
    mobileCountryCode,
    mobileNumber,
    note,
  };
}

async function assertHeadOfficeRequester(organizationId: any, customerUser: any) {
  const branchId = String(customerUser?.branchId || "").trim();
  if (!branchId) {
    throw Object.assign(new Error("Only the head office portal can request a new branch."), {
      status: 403,
    });
  }

  const { rows } = await pool.query(
    `SELECT id::text AS id
     FROM organization_locations
     WHERE organization_id = $1 AND is_primary = TRUE
     ORDER BY id ASC
     LIMIT 1`,
    [organizationId],
  );
  const primaryId = rows[0]?.id || "hq";
  if (String(primaryId) !== branchId) {
    throw Object.assign(new Error("Only the head office portal can request a new branch."), {
      status: 403,
    });
  }
}

export async function createBranchAddRequest({
  organizationId,
  customerUserId,
  customerUser,
  sourceLeadId,
  companyName = "",
  contactEmail = "",
  body = {},
  /** When the route already verified head-office via entitlements. */
  headOfficeVerified = false,
}: any) {
  if (!headOfficeVerified) {
    await assertHeadOfficeRequester(organizationId, customerUser);
  }
  const payload = normalizePayload(body);
  const id = crypto.randomUUID();
  const requestNumber = generateRequestNumber();

  const row = await insertBranchAddRequest(pool, [
    id,
    requestNumber,
    organizationId,
    sourceLeadId || null,
    customerUserId || null,
    JSON.stringify(payload),
    BRANCH_ADD_STATUSES.SUBMITTED,
    companyName || "",
    contactEmail || customerUser?.email || "",
  ]);

  const mapped = mapRequestRow(row);
  emitBranchAddEvent("branch_add.submitted", mapped);
  return mapped;
}

export async function listBranchAddRequestsForOrganization(organizationId: any) {
  const rows = await selectBranchAddRequestsByOrganization(pool, organizationId);
  return rows.map(mapRequestRow);
}

export async function listBranchAddRequestsForLead(leadId: any) {
  const rows = await selectBranchAddRequestsByLeadId(pool, leadId);
  return rows.map(mapRequestRow);
}

export async function withdrawBranchAddRequest(requestId: any, organizationId: any, customerUserId: any) {
  const row = await withdrawBranchAddRequestRow(pool, requestId, organizationId, customerUserId);
  const mapped = mapRequestRow(row);
  if (mapped) {
    emitBranchAddEvent("branch_add.withdrawn", mapped);
  }
  return mapped;
}

export async function getBranchAddRequestById(requestId: any) {
  const row = await selectBranchAddRequestById(pool, requestId);
  return mapRequestRow(row);
}
