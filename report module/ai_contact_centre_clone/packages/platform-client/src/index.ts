export interface PlatformClientOptions {
  baseUrl: string;
  getAuthToken?: () => string | undefined;
}

export interface PlatformUser {
  id: string;
  tenant_id: string;
  email: string;
  display_name: string;
}

export interface PlatformTeam {
  id: string;
  tenant_id: string;
  name: string;
}

export class PlatformClient {
  private readonly baseUrl: string;
  private readonly getAuthToken?: () => string | undefined;

  constructor(options: PlatformClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.getAuthToken = options.getAuthToken;
  }

  private async request<T>(path: string): Promise<T> {
    const headers: Record<string, string> = {
      Accept: "application/json",
    };
    const token = this.getAuthToken?.();
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    const response = await fetch(`${this.baseUrl}${path}`, { headers });
    if (!response.ok) {
      throw new Error(`Platform API error: ${response.status} ${response.statusText}`);
    }
    return (await response.json()) as T;
  }

  getUsers(tenantId: string): Promise<PlatformUser[]> {
    return this.request<PlatformUser[]>(`/api/v1/tenants/${tenantId}/users`);
  }

  getTeams(tenantId: string): Promise<PlatformTeam[]> {
    return this.request<PlatformTeam[]>(`/api/v1/tenants/${tenantId}/teams`);
  }
}

export function createPlatformClient(options: PlatformClientOptions): PlatformClient {
  return new PlatformClient(options);
}
