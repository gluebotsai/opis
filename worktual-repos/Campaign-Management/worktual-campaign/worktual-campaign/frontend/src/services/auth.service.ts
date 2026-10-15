import { clearEmbedAuth } from "@/lib/embed-auth";
import { api, apiGet, setToken } from "./api";

export type CampaignUser = {
  id: string;
  email: string;
  name: string;
  role: string;
  initials: string;
  organizationId: string;
  branchId: string;
  orgName: string;
  /** From accounts.organizations.business_type */
  mode: "b2b" | "b2c";
  industry: "generic-b2b" | "generic-b2c";
  businessType?: string;
  industryType?: string | null;
};

type ApiBody<T> = {
  statusCode: number;
  message: string;
} & T;

export async function loginRequest(input: {
  email: string;
  password: string;
  remember?: boolean;
}) {
  const { data } = await api.post<
    ApiBody<{ token: string; user: CampaignUser }>
  >("/auth/login", input);
  // Standalone password login owns the session — drop any leftover CRM embed JWT.
  clearEmbedAuth();
  if (!data.token) {
    throw new Error("Sign-in succeeded but no session token was returned.");
  }
  if (!data.user?.id) {
    throw new Error(
      "Sign-in succeeded but the server did not return a user profile.",
    );
  }
  setToken(data.token);
  return data.user;
}

export async function meRequest() {
  const { data } = await apiGet<ApiBody<{ user: CampaignUser }>>("/auth/me");
  return data.user;
}

export async function logoutRequest() {
  try {
    await api.post<ApiBody<Record<string, never>>>("/auth/logout");
  } finally {
    setToken(null);
    clearEmbedAuth();
  }
}

export async function onboardingExchangeRequest(code: string) {
  const { data } = await api.post<
    ApiBody<{ token: string; user: CampaignUser; redirectTo: string }>
  >("/auth/onboarding-exchange", { code });
  clearEmbedAuth();
  if (!data.token) {
    throw new Error("Onboarding succeeded but no session token was returned.");
  }
  setToken(data.token);
  return data;
}
