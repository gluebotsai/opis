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
   * Partner sessions from `auth.createSession` also go here, or pass `sessionToken` per call.
   */
  accessToken?: string;
  /**
   * Org API key for partner session minting and usage reads.
   * Falls back to `apiKey` when omitted.
   */
  partnerApiKey?: string;
  /** Default BCP 47 locale for AI turns (`en`, `es`, `fr`, …). */
  locale?: string;
  /**
   * `ui` when a widget is calling. Omitted calls are metered as headless.
   */
  surface?: "ui" | "headless";
  /** Widget tag, such as `worktual-chat`. Sent only with `surface: "ui"`. */
  component?: string;
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

export interface HelpWidget {
  id: string;
  organizationId: string;
  name: string;
  publicId: string;
  allowedOrigins: string[];
  enabled: boolean;
  buttonLabel: string;
  createdAt: string;
  updatedAt: string;
}

export interface HelpWidgetEmbed {
  script: string;
  iframe: string;
}

export interface HelpWidgetCreateInput {
  name?: string;
  buttonLabel?: string;
  allowedOrigins?: string[];
  tenantId?: string;
}

export interface HelpWidgetUpdateInput {
  name?: string;
  buttonLabel?: string;
  allowedOrigins?: string[];
  enabled?: boolean;
  tenantId?: string;
}

export interface HelpWidgetPublic {
  publicId: string;
  name: string;
  buttonLabel: string;
  enabled: boolean;
}

export interface HelpWidgetTicketInput {
  name?: string;
  email?: string;
  phone?: string;
  subject: string;
  description?: string;
  priority?: string;
  externalRef?: string;
  requester?: RequesterInput;
  references?: Array<{ type: string; id: string }>;
  metadata?: Record<string, unknown>;
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

export type AuthMode = "apiKey" | "accessToken" | "partnerKey" | "none";

export interface SdkActorInput {
  id?: string;
  email?: string;
}

export interface SdkSession {
  sessionToken: string;
  sessionId: string;
  expiresAt: string;
  locale?: string;
  organizationId: string;
  actor: {
    id: string;
    name: string;
    email: string;
    role: string;
  };
}

export interface CreateSessionInput {
  actor: SdkActorInput;
  tenantId?: string;
  locale?: string;
}

export interface UsageSummary {
  from: string;
  to: string;
  organizationId: string;
  logins: number;
  sessionEnds: number;
  turns: number;
  streams: number;
  confirms: number;
  rejects: number;
  /** Calls rejected with 429 quota_exceeded. They are not counted as turns. */
  quotaExceeded: number;
  byFeature: Array<{ feature: string; count: number }>;
  /** Metered calls grouped by the Skill that ran. Logins are not included. */
  bySkill: Array<{ skill: string; count: number }>;
  /** Active cap for this organization. `0` means that cap is off. */
  quota?: { ratePerMinute: number; concurrent: number };
}

export interface UsageLogin {
  id: string;
  actorId: string | null;
  sessionId: string | null;
  locale: string | null;
  createdAt: string;
}

export interface UsageRange {
  from?: string;
  to?: string;
  tenantId?: string;
  limit?: number;
}

export interface UsageEvent {
  id: string;
  /** Org API key id that opened the session. */
  partnerId: string | null;
  tenantId: string;
  actorId: string | null;
  sessionId: string | null;
  surface: string;
  component: string | null;
  feature: string;
  skill: string | null;
  executor: string | null;
  locale: string | null;
  agentTurns: number;
  confirmRequired: boolean;
  ok: boolean;
  createdAt: string;
}

export interface UsageEventList {
  organizationId: string;
  events: UsageEvent[];
}

export interface RoutingTrace {
  agents: string[];
  routes: Array<{ from: string; to: string }>;
}

export interface AiTurnInput {
  message?: string;
  locale?: string;
  /** Overrides config.accessToken for this call. */
  sessionToken?: string;
  sessionId?: string;
  module?: string;
  page?: string;
  history?: Array<{ role: string; text: string }>;
  focusedTicketId?: string;
  focusedEntity?: Record<string, unknown>;
  ticketDraft?: Record<string, unknown>;
  sessionMemory?: Record<string, unknown>;
  confirmTool?: { name: string; args?: Record<string, unknown> };
  /** Partner button id. Express pins the registered Skill for this turn. */
  sdkTask?: string;
  /** Ask the server for the routing trace. Query text is not returned. */
  debug?: boolean;
  onProgress?: (event: Record<string, unknown>) => void;
}

export type SdkTaskId =
  | "ticket.summarize"
  | "ticket.classify"
  | "ticket.draftReply"
  | "ticket.similar"
  | "ticket.kb"
  | "intake.deflect"
  | "analytics.ask"
  | "analytics.why"
  | "ticket.list"
  | "ticket.create"
  | "ticket.assign"
  | "ticket.resolveSuggest"
  | "ticket.quality"
  | "sla.advise"
  | "ticket.workload";

export type AiInsightStatus = "answered" | "temporarily_unavailable";

export interface AiMetricValue {
  id?: string;
  label?: string;
  value: string | number;
}

export interface AiInsightResult extends Omit<AiTurnResult, "status"> {
  task: "analytics.ask" | "analytics.why" | "ticket.list";
  status: AiInsightStatus;
  code?: string;
  metrics: AiMetricValue[];
  rows: Array<Record<string, unknown>>;
  why?: string;
}

export type AiTaskStatus = AiTurnStatus | "recommendation" | "deflected";

export interface AiTaskInput {
  ticketNumber?: string;
  /** Issue text for deflect. Other tasks use a default instruction when omitted. */
  message?: string;
  locale?: string;
  sessionToken?: string;
  sessionId?: string;
  sessionMemory?: Record<string, unknown>;
}

export interface AiTaskArticle {
  id?: string;
  title: string;
  url?: string;
}

export interface AiTaskTicket {
  ticketNumber: string;
  subject?: string;
}

export type SdkProposalKind = "approval" | "recommendation";

export type SdkProposalStatus = "confirmation_required" | "recommendation" | "applied" | "rejected";

export interface SdkProposal {
  id: string;
  kind: SdkProposalKind;
  status: SdkProposalStatus;
  agentId: string;
  ticketNumber: string | null;
  summary: string;
  draft?: string;
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  createdAt?: string;
}

export interface ProposalListInput {
  ticketNumber?: string;
  /** `open` (default), `confirmation_required`, `recommendation`, or `decided`. */
  status?: string;
  sessionToken?: string;
}

export interface ProposalDecisionInput {
  id: string;
  decision: "confirm" | "reject";
  edits?: { text?: string; toolArgs?: Record<string, unknown> };
  sessionToken?: string;
}

export interface ProposalDecision {
  id: string;
  ok: true;
  status: string;
}

export interface AiTaskResult extends Omit<AiTurnResult, "status"> {
  task: SdkTaskId;
  status: AiTaskStatus;
  draft?: string;
  articles: AiTaskArticle[];
  tickets: AiTaskTicket[];
  proposal: AiToolProposal | null;
  deflected: boolean;
}

export type AiTurnStatus = "answered" | "confirmation_required" | "applied";

export interface AiToolProposal {
  name: string;
  args?: Record<string, unknown>;
  risk?: string;
  auto?: boolean;
}

export interface AiTurnResult {
  reply: string;
  status: AiTurnStatus;
  agent: string;
  sessionId?: string;
  requestId?: string;
  locale?: string;
  /** Stable partner code when the turn is a refusal, a missing customer, or unavailable. */
  code?: string;
  /** Present when the turn was sent with `debug: true`. */
  trace?: RoutingTrace;
  uiActions: Array<Record<string, unknown>>;
  toolProposals: AiToolProposal[];
  data?: Record<string, unknown>;
}
