import { fetchJson } from "./http.js";

export async function listMyInvoices() {
  const data = await fetchJson("/api/v1/me/invoices");
  return data.invoices || [];
}

export async function fetchMyInvoice(quotationId) {
  const data = await fetchJson(`/api/v1/me/invoices/${encodeURIComponent(quotationId)}`);
  return data.invoice || null;
}

export function formatInvoiceAmount(value, currency = "INR") {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return "—";
  }
  try {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: currency || "INR",
      maximumFractionDigits: 0,
    }).format(Number(value));
  } catch {
    return `${currency || "INR"} ${Number(value).toLocaleString("en-IN")}`;
  }
}

export function formatInvoiceDate(value) {
  if (!value) {
    return "—";
  }
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
  }).format(new Date(value));
}
