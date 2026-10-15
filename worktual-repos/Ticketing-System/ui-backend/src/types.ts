/** System defaults; orgs may add custom labels via Priorities setup. */
export type Priority = string;
/** System defaults + org custom labels via Priorities / status catalog. */
export type TicketStatus = string;
export type Channel = 'Email' | 'Chat' | 'Phone' | 'Web';

export interface Ticket {
  id: string; // e.g. "#12503"
  subject: string;
  description: string;
  customerName: string;
  customerEmail: string;
  customerPhone?: string;
  channel: Channel;
  assignee: string;
  assigneeId?: string | null;
  /** L2 resolver (optional); null/empty when unassigned */
  resolver?: string | null;
  resolverId?: string | null;
  createdById?: string | null;
  createdByName?: string | null;
  queue?: string;
  priority: Priority;
  status: TicketStatus;
  updatedAt: string;
  /** Ticket creation time (ISO). */
  createdAt: string;
  /** Ticket solved/resolved time (ISO); null while open. */
  resolvedAt?: string | null;
  attachments?: string[];
  dueAt?: string;
  /** Customer satisfaction 1–5; set after resolve (portal/customer only) */
  csatScore?: number | null;
  /** Optional customer review text with CSAT */
  csatComment?: string | null;
    aiSummary?: string | null;
    /** Triage category / required skill from assignment engine */
    category?: string | null;
  skill?: string | null;
}

export interface TicketNote {
  id: string;
  author: string;
  text: string;
  time: string;
}

export interface AuthUser {
  id: string;
  /** Authoritative accounts.setup_users.id; absent only for SEED_DEMO users. */
  myAccountUserId?: string;
  name: string;
  email: string;
  initials: string;
  role: "admin" | "agent" | "resolver" | "customer" | "viewer" | "portal_guest" | "portal_customer";
  organizationId: string;
  organizationName?: string;
  sessionId?: string;
}

export interface AnalyticsAgentRow {
  name: string;
  assigned: number;
  resolved: number;
  overdue: number;
  avgResolveHours: string;
  avgCsat: string;
  ratings: number;
}

export interface AnalyticsSlaReport {
  breached: number;
  openOverdue: number;
  breachRate: string;
  recent: Array<{
    id: string;
    subject: string;
    assignee: string;
    customerName: string;
    dueAt: string;
  }>;
}

export interface AnalyticsPayload {
  totalTickets: string;
  totalTicketsChange: string;
  totalTicketsUp: boolean;
  resolvedTickets: string;
  resolvedTicketsChange: string;
  resolvedTicketsUp: boolean;
  firstResponse: string;
  firstResponseChange: string;
  firstResponseUp: boolean;
  resolutionTime: string;
  resolutionTimeChange: string;
  resolutionTimeUp: boolean;
  csat: string;
  csatChange: string;
  csatUp: boolean;
  csatRatings: number;
  weeklyPoints: number[];
  weeklyLabels: string[];
  channels: Array<{
    name: string;
    percentage: string;
    count: string;
    colorClass: string;
  }>;
  totalChannelsText: string;
  agentPerformance: AnalyticsAgentRow[];
  slaReport: AnalyticsSlaReport;
}

export interface CustomerProduct {
  id: string;
  code: string;
  name: string;
}

export interface Customer {
  id: string;
  name: string;
  email: string;
  phone: string;
  totalTickets: number;
  status: 'Active' | 'Inactive';
  createdAt: string;
  externalId?: string;
  accountId?: string | null;
  accountName?: string | null;
  products?: CustomerProduct[];
}

export interface KBArticle {
  id: string;
  title: string;
  content: string;
  category: 'Billing' | 'Troubleshooting' | 'Accounts' | 'General';
  author: string;
  status: 'Published' | 'Draft';
  views: number;
  updatedAt: string;
  /** Uploaded file URLs under /uploads/… */
  attachments?: string[];
}

export interface AgentQueue {
  id: string;
  queueName: string;
  type: 'Private' | 'Shared';
  openTickets: number;
  assigned: number;
  slaStatus: 'At Risk' | 'On Track';
  description?: string;
  /** Agents assigned to this team (an agent may belong to multiple teams). */
  members?: string[];
  memberIds?: string[];
  memberDetails?: Array<{
    id: string;
    name: string;
    email: string;
    role: string;
    skills: string[];
  }>;
}

export interface ActivityLog {
  id: string;
  text: string;
  time: string;
}

export interface DashboardMetrics {
  openTickets: number;
  onHold: number;
  overdue: number;
  dueToday: number;
  createdToday: number;
  unassigned: number;
  openChange: string; // e.g. "+12%"
  onHoldChange: string;
  overdueChange: string;
  dueTodayChange: string;
  unassignedChange: string;
  /** Open (non-resolved) tickets by priority — live SQL, not client rollup. */
  priorityCounts: {
    low: number;
    medium: number;
    high: number;
    urgent: number;
  };
  /** Top open queues by ticket count — live SQL. */
  topQueues: Array<{ name: string; count: number }>;
}

export interface Notification {
  id: string;
  title: string;
  message: string;
  createdAt: string;
  read: boolean;
  ticketId?: string;
  customerName?: string;
}

