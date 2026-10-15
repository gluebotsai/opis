import crypto from "node:crypto";

import {
  cancelCustomerProductRequestRow,
  insertCustomerProductRequest,
  selectCustomerProductRequest,
  selectCustomerProductRequests,
} from "./repositories/raw/customerProductRequests.repo.js";
import { rowToCamel, toIso } from "./db/util.js";

function generateRequestNumber() {
  const year = new Date().getFullYear();
  const suffix = crypto.randomBytes(2).toString("hex").toUpperCase();
  return `REQ-${year}-${suffix}`;
}

function mapRequestRow(row) {
  const entry = rowToCamel(row);
  return {
    id: entry.id,
    requestNumber: entry.requestNumber,
    organizationId: entry.organizationId,
    customerUserId: entry.customerUserId,
    sourceLeadId: entry.sourceLeadId,
    requestType: entry.requestType,
    status: entry.status || "submitted",
    assignments: entry.assignments || [],
    productSummary: entry.productSummary || [],
    branchSummary: entry.branchSummary || null,
    customerNote: entry.customerNote || "",
    domainId: entry.domainId || "",
    companyName: entry.companyName || "",
    contactEmail: entry.contactEmail || "",
    createdAt: toIso(entry.createdAt),
    updatedAt: toIso(entry.updatedAt),
  };
}

export async function listCustomerProductRequests(organizationId) {
  const rows = await selectCustomerProductRequests(organizationId);
  return rows.map(mapRequestRow);
}

export async function getCustomerProductRequest(requestId, organizationId) {
  const row = await selectCustomerProductRequest(requestId, organizationId);
  return row ? mapRequestRow(row) : null;
}

export async function createCustomerProductRequest({
  organizationId,
  customerUserId,
  sourceLeadId,
  requestType = "new",
  assignments = [],
  productSummary = [],
  branchSummary = null,
  customerNote = "",
  domainId = "",
  companyName = "",
  contactEmail = "",
}) {
  if (!Array.isArray(assignments) || assignments.length === 0) {
    throw new Error("At least one product assignment is required.");
  }

  const row = await insertCustomerProductRequest([
    generateRequestNumber(),
    organizationId,
    customerUserId,
    sourceLeadId,
    requestType,
    JSON.stringify(assignments),
    JSON.stringify(productSummary),
    branchSummary ? JSON.stringify(branchSummary) : null,
    customerNote,
    domainId,
    companyName,
    contactEmail,
  ]);

  return mapRequestRow(row);
}

export async function cancelCustomerProductRequest({
  requestId,
  organizationId,
  customerUserId,
}) {
  const row = await cancelCustomerProductRequestRow(requestId, organizationId, customerUserId);
  return row ? mapRequestRow(row) : null;
}
