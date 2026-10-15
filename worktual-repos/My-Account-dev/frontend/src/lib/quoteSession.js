import { fetchJson } from "./http.js";

/** Drop preview dataUrls so we do not upload duplicate PDF payloads. */
export function slimQuoteSessionForSave(payload = {}) {
  const invoices = Array.isArray(payload.invoices)
    ? payload.invoices.map((entry) => {
        if (!entry || typeof entry !== "object") {
          return entry;
        }
        const { dataUrl: _dataUrl, ...rest } = entry;
        return rest;
      })
    : [];

  const lead = payload.lead && typeof payload.lead === "object" ? { ...payload.lead } : payload.lead;
  if (lead && typeof lead === "object") {
    lead.quoteHandoff = {
      paymentTotals: payload.paymentTotals || null,
      sourceProductRequestId: payload.sourceProductRequestId || null,
    };
  }

  return {
    ...payload,
    lead,
    invoices,
  };
}

export async function saveQuoteSession(leadId, payload) {
  const data = await fetchJson(`/api/quote-sessions/${leadId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(slimQuoteSessionForSave(payload)),
  });
  return data.session;
}

export async function getQuoteSession(leadId) {
  const data = await fetchJson(`/api/quote-sessions/${leadId}`);
  return data.session || null;
}

export async function clearQuoteSession(leadId) {
  await fetchJson(`/api/quote-sessions/${leadId}`, { method: "DELETE" });
}
