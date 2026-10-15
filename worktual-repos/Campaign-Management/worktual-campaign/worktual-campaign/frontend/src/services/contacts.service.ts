import axios from "axios";
import { api, apiGet } from "./api";
import { titleCasePersonName } from "@/lib/contact-validation";

export function formatContactsApiError(err: unknown, fallback: string): string {
  if (axios.isAxiosError(err)) {
    if (err.code === "ECONNABORTED") {
      return "Loading contacts timed out. Check that the campaign backend and contacts database are reachable, then retry.";
    }
    if (!err.response || err.code === "ERR_NETWORK") {
      return "Campaign backend is not running on :3001. Start the backend and retry.";
    }
    if (err.response.status === 404) return "Contact not found.";
    const data = err.response.data as { message?: string } | string | undefined;
    const msg =
      typeof data === "string"
        ? data
        : data && typeof data === "object"
          ? data.message
          : undefined;
    if (msg?.trim()) return msg.trim();
    return err.message || fallback;
  }
  return err instanceof Error ? err.message : fallback;
}

export type ContactPushEndpoint = {
  id: string;
  channel: string;
  platform: string | null;
  endpoint: string;
  label: string | null;
  active: boolean;
  updated_at?: string;
};

/** Shared account contact identity. */
export type ContactItem = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  company_name: string | null;
  city: string | null;
  created_at?: string | null;
  /** Extra attrs stored in CDP custom_fields JSONB. */
  custom_fields?: Record<string, unknown>;
  /** Campaign-only engagement from campaign_db (not on shared contacts table). */
  campaign_engagement?: CampaignContactEngagement | null;
  app_push?: ContactPushEndpoint[];
  web_push?: ContactPushEndpoint[];
};

export type ContactFormInput = {
  firstName: string;
  lastName?: string;
  email: string;
  phone: string;
  companyName?: string;
  city?: string;
  /** Non-column extras → custom_fields */
  customFields?: Record<string, unknown>;
  appPushToken?: string;
  appPushPlatform?: string;
  webPushEndpoint?: string;
  webPushP256dh?: string;
  webPushAuth?: string;
};

export type CampaignContactEngagement = {
  contact_id: string;
  email_unsubscribed: boolean;
  email_unsubscribed_at: string | null;
  email_unsubscribe_reason: string | null;
  last_email_opened_at: string | null;
  last_email_clicked_at: string | null;
  email_open_count: number;
  email_click_count: number;
};

export type ContactCampaignChannelActivity = {
  channel: string;
  outcome: string;
  status: string;
  skip_fail_reason: string | null;
  open_count: number | null;
  click_count: number | null;
  opened_at: string | null;
  clicked_at: string | null;
  destination: string | null;
  ab_variant: string | null;
  sent_at: string | null;
};

export type ContactCampaignActivityRow = {
  campaign_id: string;
  name: string;
  status: string;
  starts_at: string | null;
  ends_at: string | null;
  updated_at: string | null;
  in_audience: boolean;
  channels_planned: string[];
  outcome: string;
  channels: ContactCampaignChannelActivity[];
};

export type ContactChannelSummary = {
  sent: number;
  stub: number;
  failed: number;
  skipped: number;
  pending: number;
  opens: number | null;
  clicks: number | null;
  last_opened_at: string | null;
  last_clicked_at: string | null;
};

export type ContactCampaignActivity = {
  contact_id: string;
  summary: {
    campaigns_targeted: number;
    campaigns_with_sends: number;
    active_count: number;
    scheduled_count: number;
    past_count: number;
    draft_count: number;
    email_unsubscribed: boolean;
    by_channel: Record<string, ContactChannelSummary>;
  };
  active: ContactCampaignActivityRow[];
  draft: ContactCampaignActivityRow[];
  past: {
    total: number;
    page: number;
    limit: number;
    items: ContactCampaignActivityRow[];
  };
};

export function contactDisplayName(row: ContactItem): string {
  return (
    [titleCasePersonName(row.first_name), titleCasePersonName(row.last_name)]
      .filter(Boolean)
      .join(" ")
      .trim() || "—"
  );
}

/** Day of month only — e.g. "17" for "Added 17". */
export function formatContactAddedDay(value?: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return String(date.getDate());
}

export function formatContactAddedOn(value?: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Audience list row date — calendar date including year (not "1d ago"). */
export function formatContactRelativeTime(value?: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function sortContactsAlpha(rows: ContactItem[]): ContactItem[] {
  return [...rows].sort((a, b) => {
    const af = (a.first_name || "").toLowerCase();
    const bf = (b.first_name || "").toLowerCase();
    if (af !== bf) return af.localeCompare(bf);
    const al = (a.last_name || "").toLowerCase();
    const bl = (b.last_name || "").toLowerCase();
    return al.localeCompare(bl);
  });
}

type ApiBody<T> = {
  statusCode: number;
  message: string;
} & T;

export const CONTACTS_PAGE_SIZE = 20;

export type ContactsListResult = {
  contacts: ContactItem[];
  total: number;
  withChannel: number;
  page: number;
  limit: number;
  totalPages: number;
};

export async function fetchContacts(opts?: {
  page?: number;
  limit?: number;
  search?: string;
}): Promise<ContactsListResult> {
  const page = opts?.page ?? 1;
  const limit = opts?.limit ?? CONTACTS_PAGE_SIZE;
  const search = opts?.search?.trim();
  const { data } = await apiGet<
    ApiBody<{
      getContactDetails: ContactItem[];
      total: number;
      withChannel: number;
      page: number;
      limit: number;
      totalPages: number;
    }>
  >("/contacts", {
    params: {
      page,
      limit,
      ...(search ? { search } : {}),
    },
    timeout: 45_000,
  });
  return {
    contacts: sortContactsAlpha(data.getContactDetails ?? []),
    total: data.total ?? 0,
    withChannel: data.withChannel ?? 0,
    page: data.page ?? page,
    limit: data.limit ?? limit,
    totalPages: data.totalPages ?? 1,
  };
}

export async function getContact(id: string) {
    const { data } = await apiGet<ApiBody<{ contact: ContactItem }>>(
    `/contacts/${id}`,
  );
  return data.contact;
}

export async function fetchContactCampaignActivity(
  contactId: string,
  opts?: { pastPage?: number; pastLimit?: number },
): Promise<ContactCampaignActivity> {
  const { data } = await apiGet<
    ApiBody<{ campaign_activity: ContactCampaignActivity }>
  >(`/contacts/${contactId}/campaign-activity`, {
    params: {
      past_page: opts?.pastPage ?? 1,
      past_limit: opts?.pastLimit ?? 20,
    },
  });
  return data.campaign_activity;
}

export async function lookupContacts(input: {
  email?: string;
  phone?: string;
  fullName?: string;
}) {
  const { data } = await api.post<
    ApiBody<{ count: number; contacts: ContactItem[] }>
  >("/contacts/lookup", input);
  return data;
}

export async function filterContacts(filters: {
  city?: string;
  company?: string;
  job_title?: string;
  has_email?: boolean;
  has_phone?: boolean;
  search?: string;
  emails?: string[];
  phones?: string[];
  consent_source?: string;
  segment?: string;
  product_interest?: string;
}) {
  const { data } = await api.post<
    ApiBody<{
      count: number;
      contact_ids: string[];
      sample: ContactItem[];
      consent?: {
        by_source: Record<string, number>;
        weak_count: number;
        missing_count: number;
        warnings: string[];
      };
      quality?: {
        with_email: number;
        with_phone: number;
        missing_email: number;
        missing_phone: number;
        notes: string[];
      };
    }>
  >("/contacts/filter", { filters });
  return data;
}

export async function createContact(input: ContactFormInput) {
    const { data } = await api.post<ApiBody<{ contact: ContactItem }>>(
    "/contacts",
    {
      ...input,
      firstName: titleCasePersonName(input.firstName),
      lastName: input.lastName
        ? titleCasePersonName(input.lastName) || undefined
        : input.lastName,
    },
  );
  return data;
}

export async function updateContact(id: string, input: ContactFormInput) {
    const { data } = await api.put<ApiBody<{ contact: ContactItem }>>(
    `/contacts/${id}`,
    {
      ...input,
      firstName: titleCasePersonName(input.firstName),
      lastName: input.lastName
        ? titleCasePersonName(input.lastName) || undefined
        : input.lastName,
    },
  );
  return data;
}

export async function registerAppPushForContact(input: {
  contactId: string;
  endpoint: string;
  platform?: string;
  email?: string | null;
  phone?: string | null;
}) {
  const { data } = await api.post("/app-push/endpoints", {
    endpoint: input.endpoint,
    contactId: input.contactId,
    platform: input.platform || "android",
    email: input.email || undefined,
    phone: input.phone || undefined,
    label: "contact_form",
  });
  return data;
}

export async function registerWebPushForContact(input: {
  contactId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  email?: string | null;
  phone?: string | null;
}) {
  const { data } = await api.post("/web-push/subscriptions", {
    endpoint: input.endpoint,
    keys: { p256dh: input.p256dh, auth: input.auth },
    contactId: input.contactId,
    platform: "browser",
    email: input.email || undefined,
    phone: input.phone || undefined,
    label: "contact_form",
  });
  return data;
}

/** Save app/web push on a contact without rewriting identity (avoids 400 on existing phone). */
export async function saveContactPushFields(
  contact: ContactItem,
  form: {
    appPushToken?: string;
    appPushPlatform?: string;
    webPushEndpoint?: string;
    webPushP256dh?: string;
    webPushAuth?: string;
  },
): Promise<ContactItem> {
  const token = (form.appPushToken || "").trim();
  const webEndpoint = (form.webPushEndpoint || "").trim();
  const p256dh = (form.webPushP256dh || "").trim();
  const auth = (form.webPushAuth || "").trim();
  const webComplete = Boolean(webEndpoint && p256dh && auth);

  if (!token && !webComplete) {
    throw new Error(
      "Enter an App push device token, or a full Web push subscription (endpoint + p256dh + auth).",
    );
  }
  if (webEndpoint && !webComplete) {
    throw new Error(
      "Web push needs endpoint, p256dh, and auth together. Leave all three empty to skip Web push.",
    );
  }

  if (token) {
    await registerAppPushForContact({
      contactId: contact.id,
      endpoint: token,
      platform: form.appPushPlatform || "android",
      email: contact.email,
      phone: contact.phone,
    });
  }
  if (webComplete) {
    await registerWebPushForContact({
      contactId: contact.id,
      endpoint: webEndpoint,
      p256dh,
      auth,
      email: contact.email,
      phone: contact.phone,
    });
  }

  const latest = await getContact(contact.id);
  if (!latest) {
    throw new Error("Push saved, but the contact could not be reloaded.");
  }
  return latest;
}

export async function deleteContact(id: string) {
    const { data } = await api.delete<ApiBody<Record<string, never>>>(
    `/contacts/${id}`,
  );
  return data;
}

export type ContactImportRow = {
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  companyName?: string;
  city?: string;
  name?: string;
  customFields?: Record<string, unknown>;
  [key: string]: unknown;
};

export type ContactImportResult = {
  status: "completed" | "held_for_review" | "dry_run";
  consent_source: string;
  consent_weak: boolean;
  quality_score: number;
  summary: {
    total: number;
    created: number;
    updated: number;
    skipped: number;
    failed: number;
    held: number;
  };
  errors: Array<{
    row: number;
    action: string;
    message?: string;
    email?: string | null;
    phone?: string | null;
    first_name?: string | null;
    last_name?: string | null;
    name?: string | null;
    company_name?: string | null;
    city?: string | null;
  }>;
  results: Array<{
    row: number;
    action: string;
    contact_id?: string;
    message?: string;
    conflicts?: string[];
    email?: string | null;
    phone?: string | null;
  }>;
  created_ids: string[];
  updated_ids: string[];
};

/** CCUIA bulk import — FE parses CSV then posts JSON rows. */
export async function importContacts(body: {
  rows: ContactImportRow[];
  dryRun?: boolean;
  upsert?: boolean;
  consentSource?: string;
  complianceAcknowledged?: boolean;
  sourceLabel?: string;
}) {
  const { data } = await api.post<ApiBody<{ import: ContactImportResult }>>(
    "/contacts/import",
    body,
  );
  return data.import;
}
