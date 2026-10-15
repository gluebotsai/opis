import { fetchJson } from "./http.js";

export async function listMyProductRequests() {
  const data = await fetchJson("/api/v1/me/product-requests");
  return data.requests || [];
}

export async function createCustomerProductRequest(payload) {
  const data = await fetchJson("/api/v1/me/product-requests", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return data.request || null;
}

export async function cancelMyProductRequest(requestId) {
  const data = await fetchJson(`/api/v1/me/product-requests/${requestId}/cancel`, {
    method: "POST",
  });
  return data.request || null;
}

export function deriveRequestType(assignments = []) {
  const changeTypes = new Set(assignments.map((entry) => entry.changeType || "new"));

  if (changeTypes.size === 1 && changeTypes.has("new")) {
    return "new";
  }

  if ([...changeTypes].every((type) => type === "upgrade" || type === "addon")) {
    return "upgrade";
  }

  if (changeTypes.size === 1 && changeTypes.has("downgrade")) {
    return "downgrade";
  }

  return "mixed";
}
