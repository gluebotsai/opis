import { getFinanceToken } from "./auth.js";
import { fetchJson } from "./http.js";

function financeHeaders() {
  return {
    Authorization: `Bearer ${getFinanceToken()}`,
    "Content-Type": "application/json",
  };
}

export async function submitQuotation(payload) {
  const data = await fetchJson("/api/quotations", {
    method: "POST",
    headers: financeHeaders(),
    body: JSON.stringify(payload),
  });

  const quotations = Array.isArray(data?.quotations)
    ? data.quotations
    : data?.quotation
      ? [data.quotation]
      : data?.id
        ? [data]
        : [];

  return {
    ...data,
    quotations,
    quotation: quotations[0] || null,
  };
}

export async function fetchFinanceQuotations() {
  return fetchJson("/api/quotations", {
    headers: financeHeaders(),
  });
}

export async function fetchFinanceQuotation(id) {
  return fetchJson(`/api/quotations/${id}`, {
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
    body: JSON.stringify({
      note,
      ...(paymentProvider ? { paymentProvider } : { paymentProvider: null }),
    }),
  });
}

export async function rejectQuotation(id, note) {
  return fetchJson(`/api/quotations/${id}/reject`, {
    method: "POST",
    headers: financeHeaders(),
    body: JSON.stringify({ note }),
  });
}

/** Sales: cancel payment links and withdraw finance approval (quote → Rejected). */
export async function revertQuotationApproval(id, { note = "" } = {}) {
  return fetchJson(`/api/quotations/${id}/revert-approval`, {
    method: "POST",
    headers: financeHeaders(),
    body: JSON.stringify({ note }),
  });
}
