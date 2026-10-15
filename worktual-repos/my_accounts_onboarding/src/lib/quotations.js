import { getFinanceToken } from "./auth.js";
import { fetchJson } from "./http.js";

function financeHeaders() {
  return {
    Authorization: `Bearer ${getFinanceToken()}`,
    "Content-Type": "application/json",
  };
}

export async function submitQuotation(payload) {
  return fetchJson("/api/quotations", {
    method: "POST",
    headers: financeHeaders(),
    body: JSON.stringify(payload),
  });
}

export async function fetchFinanceQuotations() {
  return fetchJson("/api/quotations", {
    headers: financeHeaders(),
  });
}

export async function fetchQuotationStatuses() {
  return fetchJson("/api/quotations/statuses", {
    headers: financeHeaders(),
  });
}

export async function approveQuotation(id, { note = "", paymentProvider = "stripe" } = {}) {
  return fetchJson(`/api/quotations/${id}/approve`, {
    method: "POST",
    headers: financeHeaders(),
    body: JSON.stringify({ note, paymentProvider }),
  });
}

export async function rejectQuotation(id, note) {
  return fetchJson(`/api/quotations/${id}/reject`, {
    method: "POST",
    headers: financeHeaders(),
    body: JSON.stringify({ note }),
  });
}
