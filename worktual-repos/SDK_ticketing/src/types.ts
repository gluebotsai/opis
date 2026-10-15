/** Intake channel sent to POST /api/intake/tickets */
export type IntakeChannel =
  | "email"
  | "web_form"
  | "chat"
  | "api"
  | "phone";

export type TicketChannel = "Email" | "Chat" | "Phone" | "Web";

export type TicketListScope =
  | "default"
  | "assignee"
  | "team"
  | "org"
  | "search"
  | "created"
  | "unassigned";

export type NoteVisibility = "public" | "internal";

export interface TicketingClientConfig {
  /** Ticketing API origin, e.g. http://127.0.0.1:3001 */
  baseUrl: string;
  /**
   * Org API key (`wt_live_…`) for server-to-server intake.
   * Do not expose this in a browser.
   */
  apiKey?: string;
  /**
   * Staff or CRM JWT used as `Authorization: Bearer` on staff routes.
   */
  accessToken?: string;
  /** Optional custom fetch (defaults to globalThis.fetch). */
  fetch?: typeof fetch;
}

export interface RequesterInput {
  name?: string;
  email?: string;
  phone?: string;
}

export interface IntakeCreateTicketInput {
  channel: IntakeChannel | string;
  requester: RequesterInput;
  subject: string;
  description?: string;
  priority?: string;
  category?: string;
  accountId?: string;
  externalRef?: string;
  organizationId?: string;
  metadata?: Record<string, unknown>;
  forceCreate?: boolean;
}

export interface IntakeTicketResult {
  ticketId: string;
  ticketNumber: string;
  status: string;
  channel: string;
  subject: string;
  assignee?: string;
  assigneeId?: string | null;
  resolver?: string | null;
  resolverId?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Ticket {
  id: string;
  subject: string;
  description: string;
  customerName: string;
  customerEmail: string;
  customerPhone?: string;
  channel: TicketChannel | string;
  assignee: string;
  assigneeId?: string | null;
  resolver?: string | null;
  resolverId?: string | null;
  createdById?: string | null;
  createdByName?: string | null;
  queue?: string;
  priority: string;
  status: string;
  updatedAt: string;
  createdAt: string;
  resolvedAt?: string | null;
  attachments?: string[];
  dueAt?: string;
  csatScore?: number | null;
  csatComment?: string | null;
  aiSummary?: string | null;
  category?: string | null;
  skill?: string | null;
}

export interface TicketListParams {
  scope?: TicketListScope | string;
  limit?: number;
  sort?: "newest" | "oldest" | "due" | "priority" | string;
  q?: string;
  status?: string;
  priority?: string;
  [key: string]: string | number | undefined;
}

export interface TicketUpdateInput {
  status?: string;
  priority?: string;
  assignee?: string;
  resolver?: string;
  subject?: string;
  description?: string;
  queue?: string;
  category?: string;
  aiSummary?: string;
  csatScore?: number;
}

export interface TicketNote {
  id: string;
  author: string;
  text: string;
  time: string;
  visibility?: NoteVisibility;
}

export interface AddNoteInput {
  text: string;
  visibility?: NoteVisibility;
}

export interface Customer {
  id: string;
  externalId?: string;
  name: string;
  email: string;
  phone?: string;
  totalTickets?: number;
  status?: string;
  createdAt?: string;
}

export interface CustomerListParams {
  q?: string;
  customerId?: string;
  exactEmail?: string;
  exactPhone?: string;
  [key: string]: string | undefined;
}

export interface AgentQueue {
  id: string;
  name: string;
  [key: string]: unknown;
}

export type AuthMode = "apiKey" | "accessToken";
