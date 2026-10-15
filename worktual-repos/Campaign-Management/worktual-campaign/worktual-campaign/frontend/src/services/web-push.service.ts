import { api, apiGet } from "./api";

type ApiBody<T> = {
  statusCode: number;
  message: string;
} & T;

export type WebPushSubscription = {
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

export async function fetchWebPushSubscriptions(opts?: {
  contactId?: string;
  activeOnly?: boolean;
}) {
  const { data } = await apiGet<
    ApiBody<{
      subscriptions: WebPushSubscription[];
      count: number;
      integration?: Record<string, unknown>;
    }>
  >("/web-push/subscriptions", {
    params: {
      ...(opts?.contactId ? { contactId: opts.contactId } : {}),
      activeOnly: opts?.activeOnly === false ? "false" : "true",
    },
  });
  return {
    subscriptions: data.subscriptions ?? [],
    count: data.count ?? 0,
    integration: data.integration,
  };
}

/** Manual/test register (same API the customer site uses). */
export async function registerWebPushSubscription(body: {
  endpoint: string;
  keys: { p256dh: string; auth: string };
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
  >("/web-push/subscriptions", body);
  return data;
}

export async function deactivateWebPushSubscription(id: string) {
  const { data } = await api.delete<
    ApiBody<{ id: string; active: boolean; contact_id: string | null }>
  >(`/web-push/subscriptions/${encodeURIComponent(id)}`);
  return data;
}
