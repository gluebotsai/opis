import type { HttpClient } from "../http.js";
import type { AddNoteInput, TicketNote } from "../types.js";

export function createNotesResource(http: HttpClient) {
  return {
    /** GET /api/tickets/:ticketNumber/notes — requires accessToken. */
    list(ticketNumber: string): Promise<TicketNote[]> {
      const id = encodeURIComponent(String(ticketNumber).trim());
      return http.request<TicketNote[]>({
        method: "GET",
        path: `/api/tickets/${id}/notes`,
        auth: "accessToken",
      });
    },

    /** POST /api/tickets/:ticketNumber/notes — requires accessToken. */
    add(ticketNumber: string, input: AddNoteInput): Promise<TicketNote> {
      const id = encodeURIComponent(String(ticketNumber).trim());
      return http.request<TicketNote>({
        method: "POST",
        path: `/api/tickets/${id}/notes`,
        auth: "accessToken",
        body: {
          text: input.text,
          visibility: input.visibility,
        },
      });
    },
  };
}

export type NotesResource = ReturnType<typeof createNotesResource>;
