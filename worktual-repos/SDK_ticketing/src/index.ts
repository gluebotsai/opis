export { createTicketingClient } from "./client.js";
export type { TicketingClient } from "./client.js";

export { TicketingApiError } from "./http.js";
export { TicketingAuthError } from "./auth.js";
export {
  verifyWorktualSignature,
  signWorktualPayload,
} from "./webhooks.js";

export type {
  TicketingClientConfig,
  IntakeChannel,
  IntakeCreateTicketInput,
  IntakeTicketResult,
  Ticket,
  TicketListParams,
  TicketListScope,
  TicketUpdateInput,
  TicketNote,
  AddNoteInput,
  NoteVisibility,
  Customer,
  CustomerListParams,
  AgentQueue,
  RequesterInput,
  TicketChannel,
  AuthMode,
} from "./types.js";
