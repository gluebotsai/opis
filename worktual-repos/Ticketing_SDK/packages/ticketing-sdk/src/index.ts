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
  HelpWidget,
  HelpWidgetEmbed,
  HelpWidgetCreateInput,
  HelpWidgetUpdateInput,
  HelpWidgetPublic,
  HelpWidgetTicketInput,
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
  SdkActorInput,
  SdkSession,
  CreateSessionInput,
  UsageSummary,
  UsageLogin,
  UsageRange,
  AiTurnInput,
  AiTurnResult,
  AiTurnStatus,
  AiToolProposal,
  SdkTaskId,
  AiTaskStatus,
  AiTaskInput,
  AiTaskArticle,
  AiTaskTicket,
  AiTaskResult,
  AiInsightStatus,
  AiMetricValue,
  AiInsightResult,
  SdkProposalKind,
  SdkProposalStatus,
  SdkProposal,
  ProposalListInput,
  ProposalDecisionInput,
  ProposalDecision,
} from "./types.js";
export type { InboxItem } from "./resources/inbox.js";
export type { PortalLoginResult, PortalOtpRequest, StaffLoginResult } from "./resources/login.js";
