import { fetchJson } from "./http.js";

export async function listMySupportTickets({ status = "all", productId = "all", days = "30" } = {}) {
  const params = new URLSearchParams();
  if (status) {
    params.set("status", status);
  }
  if (productId) {
    params.set("productId", productId);
  }
  if (days) {
    params.set("days", days);
  }

  const query = params.toString() ? `?${params.toString()}` : "";
  const data = await fetchJson(`/api/v1/me/support/tickets${query}`);
  return data.tickets || [];
}

export async function getMySupportTicket(ticketId) {
  const data = await fetchJson(`/api/v1/me/support/tickets/${ticketId}`);
  return data.ticket ? data : null;
}

export async function createSupportTicket(payload) {
  const data = await fetchJson("/api/v1/me/support/tickets", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return data;
}

export async function replyToSupportTicket(ticketId, body) {
  const data = await fetchJson(`/api/v1/me/support/tickets/${ticketId}/replies`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ body }),
  });
  return data;
}

/** Sales admin: all tickets. Sales executive: tickets for leads they created. */
export async function listSalesSupportTickets({
  status = "all",
  productId = "all",
  days = "30",
  search = "",
} = {}) {
  const params = new URLSearchParams();
  if (status) {
    params.set("status", status);
  }
  if (productId) {
    params.set("productId", productId);
  }
  if (days) {
    params.set("days", days);
  }
  if (search?.trim()) {
    params.set("search", search.trim());
  }

  const query = params.toString() ? `?${params.toString()}` : "";
  const data = await fetchJson(`/api/support/tickets${query}`);
  return data.tickets || [];
}

export async function getSalesSupportTicket(ticketId) {
  const data = await fetchJson(`/api/support/tickets/${ticketId}`);
  return data.ticket ? data : null;
}

export async function replyToSalesSupportTicket(ticketId, body, status = null) {
  const data = await fetchJson(`/api/support/tickets/${ticketId}/replies`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ body, status }),
  });
  return data;
}

export async function updateSalesSupportTicketStatus(ticketId, status) {
  const data = await fetchJson(`/api/support/tickets/${ticketId}/status`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status }),
  });
  return data;
}
