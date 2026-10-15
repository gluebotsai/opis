import { getCustomerToken } from "./customerAuth.js";
import { fetchJson } from "./http.js";

export async function listMyCancellationRequests() {
  const data = await fetchJson("/api/v1/me/cancellation-requests", {
    headers: {
      Authorization: `Bearer ${getCustomerToken()}`,
    },
  });
  return data.requests || [];
}

export async function submitCancellationRequest(payload) {
  const data = await fetchJson("/api/v1/me/cancellation-requests", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${getCustomerToken()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  return data.request || null;
}

export async function withdrawCancellationRequest(requestId) {
  const data = await fetchJson(`/api/v1/me/cancellation-requests/${requestId}/withdraw`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${getCustomerToken()}`,
    },
  });
  return data.request || null;
}

export function isPendingCancellationRequest(request) {
  return isOpenCancellationRequest(request);
}

export function isOpenCancellationRequest(request) {
  return (
    request?.status === "submitted" ||
    request?.status === "auto_escalated" ||
    request?.status === "approved_scheduled"
  );
}

export function canWithdrawCancellationRequest(request) {
  return (
    (request?.status === "submitted" || request?.status === "auto_escalated") &&
    request?.triggerSource === "customer"
  );
}

export function effectiveTimingLabel(timing) {
  return timing === "immediate" ? "Cancel immediately" : "Cancel at end of billing period";
}

export function cancellationRequestLabel(request) {
  if (!request) {
    return "";
  }

  if (request.requestKind === "drop_branch") {
    return "Branch drop";
  }

  return "Product cancellation";
}

export function cancellationStatusLabel(status) {
  switch (status) {
    case "submitted":
      return "Pending admin review";
    case "auto_escalated":
      return "Auto-escalated (unpaid)";
    case "approved":
      return "Approved";
    case "approved_scheduled":
      return "Scheduled — active until period end";
    case "rejected":
      return "Rejected";
    case "withdrawn":
      return "Withdrawn";
    default:
      return status || "Unknown";
  }
}
