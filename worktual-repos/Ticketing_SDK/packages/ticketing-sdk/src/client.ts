import { createHttpClient } from "./http.js";
import { createAiResource } from "./resources/ai.js";
import { createInboxResource } from "./resources/inbox.js";
import { createLoginResource } from "./resources/login.js";
import { createCustomersResource } from "./resources/customers.js";
import { createIntakeResource } from "./resources/intake.js";
import { createNotesResource } from "./resources/notes.js";
import { createQueuesResource } from "./resources/queues.js";
import { createSessionsResource } from "./resources/sessions.js";
import { createTicketsResource } from "./resources/tickets.js";
import { createUsageResource } from "./resources/usage.js";
import { createWidgetsResource } from "./resources/widgets.js";
import type { TicketingClientConfig } from "./types.js";

export type TicketingClient = {
  auth: ReturnType<typeof createSessionsResource> & ReturnType<typeof createLoginResource>;
  usage: ReturnType<typeof createUsageResource>;
  inbox: ReturnType<typeof createInboxResource>;
  ai: ReturnType<typeof createAiResource>;
  intake: ReturnType<typeof createIntakeResource>;
  tickets: ReturnType<typeof createTicketsResource>;
  notes: ReturnType<typeof createNotesResource>;
  customers: ReturnType<typeof createCustomersResource>;
  queues: ReturnType<typeof createQueuesResource>;
  widgets: ReturnType<typeof createWidgetsResource>;
};

export function createTicketingClient(
  config: TicketingClientConfig
): TicketingClient {
  const http = createHttpClient(config);
  return {
    auth: { ...createSessionsResource(http), ...createLoginResource(http) },
    usage: createUsageResource(http),
    inbox: createInboxResource(http),
    ai: createAiResource(http),
    intake: createIntakeResource(http),
    tickets: createTicketsResource(http),
    notes: createNotesResource(http),
    customers: createCustomersResource(http),
    queues: createQueuesResource(http),
    widgets: createWidgetsResource(http),
  };
}
