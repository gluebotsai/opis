import { api } from "./api";

export type Customer360Score = {
  churn: number | null;
  loyalty: number | null;
  value: number | null;
  purchaseProbability: number | null;
  retention: number | null;
  advocacy: number | null;
  webEngagement: number | null;
  predictedLtv: number | null;
  nextPurchaseDays: number | null;
  updatedAt: string | null;
};

export type Customer360Web = {
  sessions: number | null;
  pageViews: number | null;
  avgSessionDuration: number | null;
  bounceRate: number | null;
  scrollDepth: number | null;
  conversions: number | null;
  daysSinceLastSeen: number | null;
  metricDate: string | null;
};

export type Customer360Spend = {
  journeyStage: string | null;
  totalOrders: number | null;
  totalSpend: number | null;
  avgOrderValue: number | null;
  lastPurchaseAt: string | null;
  updatedAt: string | null;
};

export type Customer360Order = {
  orderId: string;
  number: string | null;
  status: string | null;
  amount: number | null;
  currency: string | null;
  paymentStatus: string | null;
  fulfillmentStatus: string | null;
  createdAt: string | null;
  items: Array<{
    productId: string | null;
    quantity: number | null;
    unitPrice: number | null;
  }>;
};

export type Customer360Ticket = {
  ticketId: string;
  ticketNumber: string | null;
  subject: string | null;
  channel: string | null;
  category: string | null;
  priority: string | null;
  assignee: string | null;
  dueAt: string | null;
  resolvedAt: string | null;
  csat: number | null;
  summary: string | null;
  occurredAt: string | null;
};

export type Customer360Event = {
  name: string;
  channel: string | null;
  page: string | null;
  amount: number | null;
  occurredAt: string | null;
};

export type Customer360Insight = {
  type: string;
  score: number | null;
  summary: string | null;
  explanation: string | null;
  generatedAt: string | null;
};

export type Customer360Recommendation = {
  type: string;
  text: string | null;
  confidence: number | null;
  generatedAt: string | null;
};

export type Customer360Segment = {
  name: string;
  assignedAt: string | null;
};

export type Customer360Campaign = {
  runId: string;
  title: string;
  channel: string;
  status: string;
  sentAt: string | null;
};

export type Customer360Profile = {
  acquisitionChannel: string | null;
  acquisitionDate: string | null;
  firstReferrer: string | null;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  blocked: boolean | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  deviceType?: string | null;
  country?: string | null;
  consent: Array<{ key: string; value: string }>;
  preferences: Array<{ key: string; value: string }>;
};

export type Customer360View = {
  scores: Customer360Score | null;
  web: Customer360Web | null;
  spend: Customer360Spend | null;
  orders: Customer360Order[];
  tickets: Customer360Ticket[];
  events: Customer360Event[];
  insights: Customer360Insight[];
  recommendations: Customer360Recommendation[];
  nextBestAction: string | null;
  nextBestActionAt: string | null;
  segments: Customer360Segment[];
  campaigns: Customer360Campaign[];
  profile: Customer360Profile | null;
  hasContent: boolean;
};

export async function fetchCustomer360(contactId: string) {
  const { data } = await api.get<{
    ok: true;
    customer360: Customer360View;
  } | { ok: false; error: string }>(`/api/contacts/${contactId}/customer-360`);
  return data;
}
