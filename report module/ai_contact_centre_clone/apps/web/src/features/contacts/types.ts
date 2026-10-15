/** Mirrors `cdp.customer_profile` joined with `cdp.identity_keys`. */
export type CdpProfile = {
  id: string;
  organizationId: string;
  externalId: string | null;
  email: string | null;
  attributes: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type CdpContact = {
  id: string;
  organizationId: string;
  firstName: string | null;
  lastName: string | null;
  fullName: string;
  primaryEmail: string | null;
  primaryPhone: string | null;
  secondaryEmail: string | null;
  secondaryPhone: string | null;
  gender: string | null;
  dateOfBirth: string | null;
  company: string | null;
  industry: string | null;
  city: string | null;
  region: string | null;
  country: string | null;
  language: string | null;
  timezone: string | null;
  sourceSystem: string | null;
  customFields: Record<string, unknown>;
  isActive: boolean;
  blocked: boolean;
  createdAt: string;
  updatedAt: string;
  profile: CdpProfile | null;
};

export type ContactListFilter = "all" | "active" | "inactive" | "unknown";

export type ContactListQuery = {
  search?: string;
  filter?: ContactListFilter;
  sort?: "updatedAt" | "fullName" | "primaryEmail";
  order?: "asc" | "desc";
  page?: number;
  pageSize?: number;
  includeStats?: boolean;
};

export type ContactListResponse = {
  contacts: CdpContact[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
  stats: ContactListStats | null;
};

export type ContactListStats = {
  total: number;
  active: number;
  completeProfile: number;
};

export type ContactMutationInput = {
  firstName?: string | null;
  lastName?: string | null;
  primaryEmail?: string;
  primaryPhone?: string | null;
  secondaryEmail?: string | null;
  secondaryPhone?: string | null;
  gender?: string | null;
  dateOfBirth?: string | null;
  company?: string | null;
  industry?: string | null;
  city?: string | null;
  region?: string | null;
  country?: string | null;
  language?: string | null;
  timezone?: string | null;
  sourceSystem?: string | null;
  customFields?: Record<string, unknown>;
  isActive?: boolean;
  blocked?: boolean;
};

export type ContactCreateInput = ContactMutationInput & {
  primaryEmail: string;
};

export type ContactUpdateInput = ContactMutationInput;

export type ContactInteractionHistory = {
  id: string;
  conversationId: string;
  messageId: string;
  channel: string;
  queue: string;
  subject: string;
  summary: string;
  occurredAt: string;
  createdAt?: string;
  endedAt?: string | null;
  resolvedAt?: string | null;
  endReason?: string | null;
  dispositionCode?: string | null;
  resolutionCode?: string | null;
  handoffReason?: string | null;
  status?: string;
  agentConnected?: boolean;
  direction?: "inbound" | "outbound";
  botMemory?: {
    rollingSummary: string | null;
    extractedFacts: string[];
  } | null;
};

export type ContactInteractionsPage = {
  interactions: ContactInteractionHistory[];
  total: number;
  offset: number;
  hasMore: boolean;
};
