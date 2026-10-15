import { api } from "./api";

export type ActivityFeedStatus = "upcoming" | "overdue" | "logged";

export type ActivityFeedItem = {
  id: string;
  type: string;
  subject: string;
  bodyPreview: string | null;
  disposition?: string | null;
  dueAt: string | null;
  createdAt: string;
  status: ActivityFeedStatus;
  contactId: string;
  contactName: string;
  contactEmail: string | null;
  companyId: string | null;
  companyName: string | null;
  createdByUserId: string | null;
  assigneeUserId: string | null;
  taskStatus: string | null;
  threadId?: string | null;
  gmailThreadId?: string | null;
  emailDirection?: "outbound" | "inbound" | null;
  folder?: string | null;
};

export type ActivityStats = {
  total: number;
  upcoming: number;
  overdue: number;
  logged: number;
};

export async function fetchActivitiesPage(params: {
  page?: number;
  type?: string;
  status?: string;
  search?: string;
  ownerScope?: "mine" | "all";
}) {
  const { data } = await api.get<{
    ok: true;
    items: ActivityFeedItem[];
    pagination: {
      page: number;
      pageSize: number;
      total: number;
      totalPages: number;
      hasNext: boolean;
    };
    ownerScope: "mine" | "all";
    canViewAll: boolean;
  }>("/api/activities", {
    params: {
      page: params.page,
      type: params.type,
      status: params.status,
      q: params.search,
      owner: params.ownerScope,
    },
  });
  return data;
}

export async function fetchActivityStats(ownerScope: "mine" | "all" = "mine") {
  const { data } = await api.get<{
    ok: true;
  } & ActivityStats & {
      ownerScope: "mine" | "all";
      canViewAll: boolean;
    }>("/api/activities/stats", { params: { owner: ownerScope } });
  return data;
}

export async function completeActivityTask(activityId: string) {
  const { data } = await api.post(`/api/activities/${activityId}/complete`);
  return data as { ok: true; id: string } | { ok: false; error: string };
}
