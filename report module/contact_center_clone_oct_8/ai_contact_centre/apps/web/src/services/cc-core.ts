import { apiV1 } from "@/config/api-paths";
import { ccCoreHttp } from "@/services/http";
import type { AuthUser } from "@/types/auth";

type LoginResponse = {
  token: string;
  user: Omit<AuthUser, "token">;
  redirectTo?: string;
};

/** cc-core APIs (auth, runtime, etc.). */
export const ccCoreApi = {
  async login(email: string, password: string, options?: { force?: boolean }): Promise<AuthUser> {
    const { data } = await ccCoreHttp.post<LoginResponse>(apiV1("/auth/login"), {
      email,
      password,
      ...(options?.force ? { force: true } : {}),
    });
    return { ...data.user, token: data.token };
  },

  async exchangeOnboarding(code: string): Promise<AuthUser & { redirectTo: string }> {
    const { data } = await ccCoreHttp.post<LoginResponse>(apiV1("/auth/onboarding-exchange"), {
      code,
    });
    return {
      ...data.user,
      token: data.token,
      redirectTo: data.redirectTo || (data.user.role === "agent" ? "/agent/workspace" : "/admin/dashboard"),
    };
  },

  async logout(): Promise<void> {
    await ccCoreHttp.post(apiV1("/auth/logout"));
  },

  async listAgents() {
    const { data } = await ccCoreHttp.get(apiV1("/agents"));
    return data;
  },
};
