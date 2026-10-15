import { api, apiGet } from "./api";

type ApiBody<T> = {
  statusCode: number;
  message: string;
} & T;

export type AppPushEndpoint = {
  id: string;
  channel: string;
  platform: string | null;
  endpoint: string;
  contact_id: string | null;
  label: string | null;
  active: boolean;
  updated_at?: string;
  contact?: {
    id: string;
    first_name?: string;
    last_name?: string;
    email?: string | null;
    phone?: string | null;
  } | null;
};

export async function fetchAppPushEndpoints(opts?: {
  contactId?: string;
  activeOnly?: boolean;
}) {
  const { data } = await apiGet<
    ApiBody<{
      endpoints: AppPushEndpoint[];
      count: number;
      integration?: Record<string, unknown>;
    }>
  >("/app-push/endpoints", {
    params: {
      ...(opts?.contactId ? { contactId: opts.contactId } : {}),
      activeOnly: opts?.activeOnly === false ? "false" : "true",
    },
  });
  return {
    endpoints: data.endpoints ?? [],
    count: data.count ?? 0,
    integration: data.integration,
  };
}

/** Manual/test register from Campaign Management (same API the mobile app uses). */
export async function registerAppPushDevice(body: {
  endpoint: string;
  platform?: string;
  contactId?: string;
  email?: string;
  phone?: string;
  firstName?: string;
  lastName?: string;
  label?: string;
}) {
  const { data } = await api.post<
    ApiBody<{
      id: string;
      contact_id: string | null;
      contact_created?: boolean;
      contact?: Record<string, unknown>;
      endpoint: string;
      platform: string | null;
    }>
  >("/app-push/endpoints", body);
  return data;
}

export async function deactivateAppPushEndpoint(id: string) {
  const { data } = await api.delete<
    ApiBody<{ id: string; active: boolean; contact_id: string | null }>
  >(`/app-push/endpoints/${encodeURIComponent(id)}`);
  return data;
}
