import { createHttpClient } from "./http.js";
import { createCustomersResource } from "./resources/customers.js";
import { createIntakeResource } from "./resources/intake.js";
import { createNotesResource } from "./resources/notes.js";
import { createQueuesResource } from "./resources/queues.js";
import { createTicketsResource } from "./resources/tickets.js";
import type { TicketingClientConfig } from "./types.js";

export type TicketingClient = {
  intake: ReturnType<typeof createIntakeResource>;
  tickets: ReturnType<typeof createTicketsResource>;
  notes: ReturnType<typeof createNotesResource>;
  customers: ReturnType<typeof createCustomersResource>;
  queues: ReturnType<typeof createQueuesResource>;
};

export function createTicketingClient(
  config: TicketingClientConfig
): TicketingClient {
  const http = createHttpClient(config);
  return {
    intake: createIntakeResource(http),
    tickets: createTicketsResource(http),
    notes: createNotesResource(http),
    customers: createCustomersResource(http),
    queues: createQueuesResource(http),
  };
}
