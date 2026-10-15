import type { HttpClient } from "../http.js";
import type { Ticket, TicketListParams, TicketUpdateInput } from "../types.js";

export function createTicketsResource(http: HttpClient) {
  return {
    /** GET /api/tickets — requires accessToken. */
    list(params: TicketListParams = {}): Promise<Ticket[]> {
      const { scope, ...rest } = params;
      return http.request<Ticket[]>({
        method: "GET",
        path: "/api/tickets",
        auth: "accessToken",
        query: { scope: scope ?? "default", ...rest },
      });
    },

    /** GET /api/tickets/:ticketNumber — requires accessToken. */
    get(ticketNumber: string): Promise<Ticket> {
      const id = encodeURIComponent(String(ticketNumber).trim());
      return http.request<Ticket>({
        method: "GET",
        path: `/api/tickets/${id}`,
        auth: "accessToken",
      });
    },

    /** PUT /api/tickets/:ticketNumber — requires accessToken. */
    update(ticketNumber: string, body: TicketUpdateInput): Promise<Ticket> {
      const id = encodeURIComponent(String(ticketNumber).trim());
      return http.request<Ticket>({
        method: "PUT",
        path: `/api/tickets/${id}`,
        auth: "accessToken",
        body,
      });
    },
  };
}

export type TicketsResource = ReturnType<typeof createTicketsResource>;
