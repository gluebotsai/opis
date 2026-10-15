import { getAuthToken } from "./auth.js";
import { fetchJson } from "./http.js";

function authHeaders() {
  const token = getAuthToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function fetchCommissionSlabs({ country } = {}) {
  const query = country ? `?country=${encodeURIComponent(country)}` : "";
  const data = await fetchJson(`/api/commission-slabs${query}`);
  return data.slabs || [];
}

export async function fetchAdminCommissionSlabs({ country } = {}) {
  const query = country ? `?country=${encodeURIComponent(country)}` : "";
  const data = await fetchJson(`/api/admin/commission-slabs${query}`, { headers: authHeaders() });
  return data.slabs || [];
}

export async function createCommissionSlab(payload) {
  const data = await fetchJson("/api/admin/commission-slabs", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(payload),
  });
  return data.slab;
}

export async function updateCommissionSlab(slabId, payload) {
  const data = await fetchJson(`/api/admin/commission-slabs/${slabId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(payload),
  });
  return data.slab;
}

export async function deleteCommissionSlab(slabId) {
  return fetchJson(`/api/admin/commission-slabs/${slabId}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
}

export async function fetchPartnerBankAccountBundle() {
  const data = await fetchJson("/api/partner/bank-account");
  return {
    bankAccount: data.bankAccount || null,
    country: data.country || "India",
  };
}

export async function fetchPartnerBankAccount() {
  const { bankAccount } = await fetchPartnerBankAccountBundle();
  return bankAccount;
}

export async function savePartnerBankAccount(payload) {
  const data = await fetchJson("/api/partner/bank-account", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return data.bankAccount;
}

export async function fetchAdminPartnerBankAccount(partnerId) {
  const data = await fetchJson(`/api/admin/partners/${partnerId}/bank-account`, {
    headers: authHeaders(),
  });
  return data.bankAccount || null;
}

export async function fetchAdminPartnerBankAccountBundle(partnerId) {
  const data = await fetchJson(`/api/admin/partners/${partnerId}/bank-account`, {
    headers: authHeaders(),
  });
  return {
    bankAccount: data.bankAccount || null,
    country: data.country || "India",
  };
}

export async function saveAdminPartnerBankAccount(partnerId, payload) {
  const data = await fetchJson(`/api/admin/partners/${partnerId}/bank-account`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(payload),
  });
  return data.bankAccount;
}

export async function fetchPartnerCommissions() {
  return fetchJson("/api/partner/commissions");
}

export async function fetchFinanceCommissions({ status } = {}) {
  const query = status ? `?status=${encodeURIComponent(status)}` : "";
  const data = await fetchJson(`/api/finance/commissions${query}`, { headers: authHeaders() });
  return data.commissions || [];
}

export async function fetchFinanceCommissionPartners({ status } = {}) {
  const query = status ? `?status=${encodeURIComponent(status)}` : "";
  const data = await fetchJson(`/api/finance/commissions/partners${query}`, {
    headers: authHeaders(),
  });
  return data.partners || [];
}

export async function fetchFinancePartnerCommissionOverview(partnerId) {
  return fetchJson(`/api/finance/commissions/partners/${partnerId}`, {
    headers: authHeaders(),
  });
}

export async function markFinanceCommissionPaid(entryId, payload = {}) {
  const data = await fetchJson(`/api/finance/commissions/${entryId}/mark-paid`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(payload),
  });
  return data.commission;
}

export function formatInrAmount(amount, currency = "INR") {
  const value = Number(amount);
  if (!Number.isFinite(value)) {
    return "—";
  }
  const locale = currency === "INR" ? "en-IN" : "en-GB";
  return `${currency} ${value.toLocaleString(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function formatCurrencyAmount(amount, currency = "INR") {
  return formatInrAmount(amount, currency);
}

export function formatSlabRange(slab) {
  const locale = slab?.currency === "INR" ? "en-IN" : "en-GB";
  const min = Number(slab?.minAmount || 0).toLocaleString(locale);
  const max =
    slab?.maxAmount === null || slab?.maxAmount === undefined
      ? "—"
      : Number(slab.maxAmount).toLocaleString(locale);
  return `${min} – ${max}`;
}
