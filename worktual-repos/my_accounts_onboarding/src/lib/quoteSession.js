import { fetchJson } from "./http.js";

export async function saveQuoteSession(leadId, payload) {
  const data = await fetchJson(`/api/quote-sessions/${leadId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
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
