import { api } from "./api";

export type MarketingStatus = {
  configured: boolean;
  connectReady: boolean;
  baseUrl: string | null;
  uiUrl: string | null;
  apiReachable: boolean;
  uiReachable: boolean;
  reachable: boolean;
};

export type MarketingEmbedSession = {
  token: string;
  uiOrigin: string | null;
  apiReachable: boolean;
  uiReachable: boolean;
  reachable: boolean;
};

export async function fetchMarketingStatus() {
  const { data } = await api.get<MarketingStatus>("/api/marketing/status");
  return data;
}

export async function fetchEmbedSession() {
  const { data } = await api.get<
    MarketingEmbedSession & { ok?: boolean; error?: string }
  >("/api/marketing/embed-session");
  if (data?.ok === false) {
    throw new Error(data.error || "Failed to load Campaign embed session.");
  }
  if (!data?.token) {
    throw new Error("Campaign embed session did not return a token.");
  }
  return data;
}

export async function fetchCampaigns(bucket = "all") {
  const { data } = await api.get<{
    bucket: string;
    campaigns: Record<string, unknown>[];
  }>("/api/marketing/campaigns", { params: { bucket } });
  return data;
}

export async function createCampaign(body: {
  name: string;
  description?: string | null;
  goal?: string | null;
  objective?: string | null;
  status?: string;
  startsAt?: string | null;
  endsAt?: string | null;
}) {
  const { data } = await api.post<{ id: string | number | null }>(
    "/api/marketing/campaigns",
    body,
  );
  return data;
}
