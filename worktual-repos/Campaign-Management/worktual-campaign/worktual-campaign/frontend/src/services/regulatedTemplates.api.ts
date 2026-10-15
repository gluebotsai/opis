import { apiGet, apiPost, apiPatch, apiDelete } from "@/services/api";

export type RegulatedChannel = "sms" | "whatsapp";

export type RegulatedApprovalStatus =
  | "draft"
  | "pending"
  | "approved"
  | "rejected"
  | "paused"
  | "disabled";

export type RegulatedTemplateDto = {
  id: string;
  channel: string;
  name: string;
  externalId: string;
  providerTemplateId: string | null;
  language: string;
  category: string;
  header: string;
  body: string;
  footer: string;
  buttons: string;
  status: RegulatedApprovalStatus;
  rejectedReason: string | null;
  campaignName?: string;
  goal?: string;
  objective?: string;
  sourceCampaignId?: string | null;
  submittedAt: string | null;
  lastStatusCheckedAt: string | null;
  createdAt: string;
  updatedAt: string;
  locked: boolean;
};

type ApiBody<T> = { statusCode: number; message: string } & T;


function assertNotFinanceSandbox() {
  }

export async function fetchRegulatedTemplates(params?: {
  channel?: RegulatedChannel;
  status?: RegulatedApprovalStatus;
}) {
  // Finance must not show live B2B approved/rejected WhatsApp or SMS templates.
  const q = new URLSearchParams();
  if (params?.channel) q.set("channel", params.channel);
  if (params?.status) q.set("status", params.status);
  const qs = q.toString();
  const { data } = await apiGet<ApiBody<{ templates: RegulatedTemplateDto[] }>>(
    `/templates/regulated${qs ? `?${qs}` : ""}`,
  );
  return data.templates || [];
}

export async function fetchWhatsAppConfigReady() {
    const { data } = await apiGet<
    ApiBody<{ ready: boolean; message: string }>
  >("/templates/regulated/whatsapp/ready");
  return { ready: Boolean(data.ready), message: data.message || "" };
}

export async function fetchSmsConfigReady() {
    const { data } = await apiGet<
    ApiBody<{ ready: boolean; message: string }>
  >("/templates/regulated/sms/ready");
  return { ready: Boolean(data.ready), message: data.message || "" };
}

export async function createRegulatedTemplateApi(body: {
  channel: RegulatedChannel;
  name: string;
  externalId?: string;
  language?: string;
  category?: string;
  header?: string;
  body: string;
  footer?: string;
  buttons?: string;
  asApproved?: boolean;
}) {
  assertNotFinanceSandbox();
  const { data } = await apiPost<ApiBody<{ template: RegulatedTemplateDto }>>(
    "/templates/regulated",
    body,
  );
  return data.template;
}

export async function updateRegulatedTemplateApi(
  id: string,
  body: Partial<{
    name: string;
    externalId: string;
    language: string;
    category: string;
    header: string;
    body: string;
    footer: string;
    buttons: string;
  }>,
) {
  assertNotFinanceSandbox();
  const { data } = await apiPatch<ApiBody<{ template: RegulatedTemplateDto }>>(
    `/templates/regulated/${id}`,
    body,
  );
  return data.template;
}

export async function deleteRegulatedTemplateApi(id: string) {
  assertNotFinanceSandbox();
  await apiDelete(`/templates/regulated/${id}`);
}

export async function setRegulatedStatusApi(
  id: string,
  status: "pending" | "approved" | "rejected",
  rejectedReason?: string,
) {
  assertNotFinanceSandbox();
  const { data } = await apiPost<ApiBody<{ template: RegulatedTemplateDto }>>(
    `/templates/regulated/${id}/status`,
    { status, rejectedReason },
  );
  return data.template;
}

export async function submitWhatsAppApprovalApi(id: string) {
  assertNotFinanceSandbox();
  const { data } = await apiPost<
    ApiBody<{
      template: RegulatedTemplateDto;
      meta?: { submitted?: boolean; status?: string };
    }>
  >(`/templates/regulated/${id}/submit-approval`, {});
  return data;
}

export async function refreshWhatsAppStatusApi(id: string) {
  assertNotFinanceSandbox();
  const { data } = await apiPost<
    ApiBody<{
      template: RegulatedTemplateDto;
      meta?: { found?: boolean; status?: string };
    }>
  >(`/templates/regulated/${id}/refresh-status`, {});
  return data;
}

/** Pull Meta WABA catalog into Pending / Approved / Rejected. */
export async function syncMetaWhatsAppTemplatesApi() {
    const { data } = await apiPost<
    ApiBody<{
      sync: {
        channelConfigId: string;
        fetched: number;
        upserted: number;
        skipped: number;
        byStatus: {
          pending: number;
          approved: number;
          rejected: number;
          other: number;
        };
      };
      templates: RegulatedTemplateDto[];
    }>
  >("/templates/regulated/whatsapp/sync-meta", {});
  return data;
}

export async function sendWhatsAppTemplateApi(
  id: string,
  to: string | string[],
  bodyParams?: string[],
  contactIds?: string[],
) {
  assertNotFinanceSandbox();
  const payload: {
    to?: string;
    tos?: string[];
    contactIds?: string[];
    bodyParams?: string[];
  } = {};
  if (contactIds?.length) {
    payload.contactIds = contactIds;
  }
  if (typeof to === "string" && to.trim()) {
    payload.to = to.trim();
  } else if (Array.isArray(to) && to.length === 1) {
    payload.to = to[0];
  } else if (Array.isArray(to) && to.length > 1) {
    payload.tos = to;
  }
  if (bodyParams?.length) payload.bodyParams = bodyParams;
  if (!payload.to && !payload.tos?.length && !payload.contactIds?.length) {
    throw new Error("Provide phone numbers or contactIds to send.");
  }
  const { data } = await apiPost<
    ApiBody<{
      sent: boolean;
      providerMessageId: string | null;
      stub?: boolean;
      recipient_count?: number;
      results?: Array<{
        to: string;
        sent: boolean;
        providerMessageId: string | null;
      }>;
      template: RegulatedTemplateDto;
    }>
  >(`/templates/regulated/${id}/send`, payload);
  return data;
}

/** Send approved SMS or WhatsApp template (same endpoint). */
export async function sendRegulatedTemplateApi(
  id: string,
  to: string | string[],
  bodyParams?: string[],
  contactIds?: string[],
) {
  return sendWhatsAppTemplateApi(id, to, bodyParams, contactIds);
}
