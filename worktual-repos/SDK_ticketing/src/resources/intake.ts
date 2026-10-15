import type { HttpClient } from "../http.js";
import type { IntakeCreateTicketInput, IntakeTicketResult } from "../types.js";

export function createIntakeResource(http: HttpClient) {
  return {
    /** Create a ticket via POST /api/intake/tickets (requires apiKey). */
    createTicket(input: IntakeCreateTicketInput): Promise<IntakeTicketResult> {
      return http.request<IntakeTicketResult>({
        method: "POST",
        path: "/api/intake/tickets",
        auth: "apiKey",
        body: input,
      });
    },
  };
}

export type IntakeResource = ReturnType<typeof createIntakeResource>;
