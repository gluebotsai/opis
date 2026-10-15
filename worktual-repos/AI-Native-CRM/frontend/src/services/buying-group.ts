import { api } from "./api";

export type BuyingRole = {
  id: string;
  contactId: string;
  contactName: string;
  title: string | null;
  dealId: string | null;
  role: string;
  influence: string | null;
  attitude: string | null;
  status: string;
  confidence: number | null;
  evidence: string | null;
  source: string;
};

export type BuyingRelationship = {
  id: string;
  fromContactId: string;
  toContactId: string;
  fromName: string;
  toName: string;
  kind: string;
  strength: string | null;
  status: string;
  evidence: string | null;
  source: string;
};

export type BuyingActivity = {
  id: string;
  contactId: string;
  contactName: string;
  type: string;
  subject: string;
  bodyPreview?: string | null;
  dueAt?: string | null;
  createdAt: string;
  status?: "upcoming" | "overdue" | "logged";
  taskStatus?: string | null;
  source: "contact" | "deal";
  dealId: string | null;
};

export type BuyingCoverage = {
  contactId: string;
  contactName: string;
  userId: string;
  userName: string;
  touchCount: number;
  lastAt: string | null;
};

export type BuyingGroup = {
  contacts: Array<{ id: string; name: string; title: string | null }>;
  roles: BuyingRole[];
  relationships: BuyingRelationship[];
  activities: BuyingActivity[];
  coverage: BuyingCoverage[];
  neglected: Array<{
    contactId: string;
    contactName: string;
    title: string | null;
    lastAt: string | null;
  }>;
  warnings: string[];
};

type GroupResponse =
  | { ok: true; buyingGroup: BuyingGroup }
  | { ok: false; error?: string };

export const BUYING_ROLES = [
  { value: "decision_maker", label: "Decision maker" },
  { value: "economic_buyer", label: "Economic buyer" },
  { value: "champion", label: "Champion" },
  { value: "influencer", label: "Influencer" },
  { value: "technical_evaluator", label: "Technical evaluator" },
  { value: "user", label: "User" },
  { value: "procurement_legal", label: "Procurement / legal" },
  { value: "blocker", label: "Blocker" },
] as const;

export const BUYING_INFLUENCE = [
  { value: "high", label: "High influence" },
  { value: "medium", label: "Medium influence" },
  { value: "low", label: "Low influence" },
];

export const BUYING_ATTITUDE = [
  { value: "supporter", label: "Supporter" },
  { value: "neutral", label: "Neutral" },
  { value: "opponent", label: "Opponent" },
];

export function buyingRoleLabel(role: string): string {
  return BUYING_ROLES.find((item) => item.value === role)?.label ?? role.replaceAll("_", " ");
}

export function relationshipLabel(kind: string): string {
  const labels: Record<string, string> = {
    reports_to: "Reports to",
    influences: "Influences",
    former_colleague: "Former colleague",
    introduced_by: "Introduced by",
  };
  return labels[kind] ?? kind.replaceAll("_", " ");
}

export async function fetchCompanyBuyingGroup(companyId: string) {
  const { data } = await api.get<GroupResponse>(`/api/companies/${companyId}/buying-group`);
  return data;
}

export async function suggestCompanyBuyingGroup(companyId: string) {
  const { data } = await api.post<GroupResponse>(`/api/companies/${companyId}/buying-group/suggest`);
  return data;
}

export async function setCompanyBuyingRole(
  companyId: string,
  body: {
    contactId: string;
    dealId?: string | null;
    role: string;
    influence?: string | null;
    attitude?: string | null;
  },
) {
  const { data } = await api.post<GroupResponse>(`/api/companies/${companyId}/buying-roles`, body);
  return data;
}

export async function reviewCompanyBuyingRole(
  companyId: string,
  roleId: string,
  status: "confirmed" | "rejected",
) {
  const { data } = await api.post<GroupResponse>(
    `/api/companies/${companyId}/buying-roles/${roleId}`,
    { status },
  );
  return data;
}

export async function reviewCompanyRelationship(
  companyId: string,
  linkId: string,
  status: "confirmed" | "rejected",
) {
  const { data } = await api.post<GroupResponse>(
    `/api/companies/${companyId}/relationships/${linkId}`,
    { status },
  );
  return data;
}

export async function fetchDealBuyingGroup(dealId: string) {
  const { data } = await api.get<GroupResponse>(`/api/sales/deals/${dealId}/buying-group`);
  return data;
}
