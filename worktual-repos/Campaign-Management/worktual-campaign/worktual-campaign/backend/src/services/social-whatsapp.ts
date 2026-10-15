/**
 * social-service WhatsApp template APIs (Meta Cloud adapter).
 *
 * Base URL (env SOCIAL_SERVICE_BASE_URL):
 *   QA:    https://rebuild-ccaas-api.worktual.com/social-api
 *   ngrok: https://uninvited-skinless-eel.ngrok-free.dev (+ ngrok-skip-browser-warning)
 *
 * Paths (after base) match WHATSAPP_TEMPLATE_API.md:
 *   POST /internal/v1/whatsapp/templates/submit-approval
 *   GET  /internal/v1/whatsapp/templates
 *   GET  /internal/v1/whatsapp/templates/approval-status
 *   GET  /internal/v1/whatsapp/templates/detail
 *   POST /internal/v1/whatsapp/templates
 *
 * Auth: x-internal-service-key. channelConfigId must be numeric digits.
 */

import { env } from "../config/env.js";
import { AppError } from "../helpers/response-builders.js";

/** MD: channelConfigId is a numeric string (e.g. "1063"), never a UUID. */
function assertNumericChannelConfigId(raw: string): string {
  const id = String(raw || "").trim();
  if (!/^\d+$/.test(id)) {
    throw new AppError(
      `channelConfigId must be a numeric string (got "${id || "(empty)"}").`,
      400,
      "invalid_request",
    );
  }
  return id;
}

type SocialErrorBody = {
  error?:
    | string
    | { code?: string; message?: string; retryable?: boolean; details?: unknown };
  message?: string;
  details?: unknown;
  meta?: { message?: string; error?: { message?: string; error_user_msg?: string } };
  errors?: Array<{ message?: string } | string>;
};

/** Pull the most useful human message from social-service / Meta-shaped bodies. */
export function formatSocialErrorMessage(
  status: number,
  body: unknown,
  text: string,
): string {
  const bits: string[] = [];
  const push = (v: unknown) => {
    if (typeof v === "string" && v.trim()) bits.push(v.trim());
  };

  if (body && typeof body === "object") {
    const b = body as SocialErrorBody;
    if (typeof b.error === "string") push(b.error);
    else if (b.error && typeof b.error === "object") {
      push(b.error.message);
      push(b.error.code);
      if (b.error.details != null) {
        push(
          typeof b.error.details === "string"
            ? b.error.details
            : JSON.stringify(b.error.details),
        );
      }
    }
    push(b.message);
    if (b.meta && typeof b.meta === "object") {
      push(b.meta.message);
      push(b.meta.error?.message);
      push(b.meta.error?.error_user_msg);
    }
    if (Array.isArray(b.errors)) {
      for (const e of b.errors) {
        if (typeof e === "string") push(e);
        else push(e?.message);
      }
    }
    // Nested Meta Graph error often under data / response
    const anyBody = body as Record<string, unknown>;
    for (const key of ["data", "response", "providerError", "cause"]) {
      const nested = anyBody[key];
      if (nested && typeof nested === "object") {
        const n = nested as Record<string, unknown>;
        push(n.message as string);
        const err = n.error;
        if (typeof err === "string") push(err);
        else if (err && typeof err === "object") {
          push((err as { message?: string }).message);
          push((err as { error_user_msg?: string }).error_user_msg);
        }
      }
    }
  }

  const looksHtml = (v: string) =>
    /<!DOCTYPE|<html[\s>]|<body[\s>]/i.test(v) || /^\s*</.test(v);

  if (!bits.length && text?.trim() && !looksHtml(text)) {
    push(text.length > 180 ? `${text.slice(0, 180)}…` : text);
  }

  const cleaned = bits.filter((b) => !looksHtml(b));
  if (!cleaned.length) {
    return `social-service error (${status}): unexpected HTML or empty response (check social-service URL)`;
  }

  const detail = cleaned.join(" — ");
  const compact = detail.length > 180 ? `${detail.slice(0, 180)}…` : detail;
  return compact.startsWith("social-service")
    ? compact
    : `social-service error (${status}): ${compact}`;
}

function socialHeaders(): Record<string, string> {
  const key = env.social.internalServiceKey;
  if (!key) {
    throw new AppError(
      "INTERNAL_SERVICE_KEY is not configured on Campaign backend.",
      500,
      "SOCIAL_NOT_CONFIGURED",
    );
  }
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "x-internal-service-key": key,
  };
  if (env.social.ngrokSkipBrowserWarning) {
    headers["ngrok-skip-browser-warning"] = "true";
  }
  return headers;
}

async function socialFetch<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const url = `${env.social.baseUrl.replace(/\/$/, "")}${path}`;
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      headers: {
        ...socialHeaders(),
        ...(init?.headers || {}),
      },
    });
  } catch (err) {
    throw new AppError(
      `Cannot reach social-service (${env.social.baseUrl}): ${
        err instanceof Error ? err.message : "network error"
      }`,
      502,
      "SOCIAL_UNREACHABLE",
    );
  }

  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { raw: text };
  }

  if (!res.ok) {
    const msg = formatSocialErrorMessage(res.status, body, text);
    // Log full body once so ops can see Meta detail even if UI truncates.
    console.error("[social-whatsapp]", res.status, path, text?.slice(0, 2000));
    throw new AppError(
      msg,
      res.status >= 400 && res.status < 600 ? res.status : 502,
      "SOCIAL_ERROR",
    );
  }

  return body as T;
}

export type SubmitApprovalPayload = {
  channelConfigId: string;
  name: string;
  language: string;
  category: string;
  allowCategoryChange?: boolean;
  components: Array<Record<string, unknown>>;
};

export type SubmitApprovalResult = {
  submitted?: boolean;
  channelConfigId?: string;
  templateId?: string;
  templateName?: string;
  status?: string;
  category?: string;
};

export async function socialSubmitTemplateApproval(
  payload: SubmitApprovalPayload,
): Promise<SubmitApprovalResult> {
  const channelConfigId = assertNumericChannelConfigId(payload.channelConfigId);
  return socialFetch<SubmitApprovalResult>(
    "/internal/v1/whatsapp/templates/submit-approval",
    {
      method: "POST",
      body: JSON.stringify({
        ...payload,
        channelConfigId,
      }),
    },
  );
}

export type ApprovalStatusRow = {
  id?: string;
  name?: string;
  language?: string;
  status?: string;
  category?: string;
  rejectedReason?: string | null;
};

export type ApprovalStatusResult = {
  channelConfigId?: string;
  templates?: ApprovalStatusRow[];
};

export async function socialGetTemplateApprovalStatus(params: {
  channelConfigId: string;
  templateName?: string;
  templateId?: string;
  language?: string;
  status?: string;
}): Promise<ApprovalStatusResult> {
  const q = new URLSearchParams();
  q.set(
    "channelConfigId",
    assertNumericChannelConfigId(params.channelConfigId),
  );
  if (params.templateId) q.set("templateId", params.templateId);
  else if (params.templateName) q.set("templateName", params.templateName);
  if (params.language) q.set("language", params.language);
  if (params.status) q.set("status", params.status);
  return socialFetch<ApprovalStatusResult>(
    `/internal/v1/whatsapp/templates/approval-status?${q.toString()}`,
    { method: "GET" },
  );
}

export type SendTemplatePayload = {
  channelConfigId: string;
  to: string;
  templateName: string;
  /** Required — must match the language used at submit (en ≠ en_US). */
  languageCode: string;
  /** Lowercase types: body / header / button (only when template has {{n}}). */
  components?: Array<Record<string, unknown>>;
};

export type SendTemplateResult = {
  sent?: boolean;
  providerMessageId?: string;
  channelConfigId?: string;
};

export async function socialSendApprovedTemplate(
  payload: SendTemplatePayload,
): Promise<SendTemplateResult> {
  const channelConfigId = assertNumericChannelConfigId(payload.channelConfigId);
  const languageCode = String(payload.languageCode || "").trim();
  if (!languageCode) {
    throw new AppError(
      "languageCode is required for WhatsApp template send.",
      400,
      "invalid_request",
    );
  }
  const to = String(payload.to || "").replace(/\D/g, "");
  if (!to) {
    throw new AppError(
      "to must be country code + digits with no + for WhatsApp send.",
      400,
      "invalid_request",
    );
  }
  return socialFetch<SendTemplateResult>("/internal/v1/whatsapp/templates", {
    method: "POST",
    body: JSON.stringify({
      channelConfigId,
      to,
      templateName: payload.templateName,
      languageCode,
      ...(payload.components?.length ? { components: payload.components } : {}),
    }),
  });
}

export type MetaWhatsAppTemplateRow = {
  id?: string;
  name?: string;
  language?: string;
  status?: string;
  category?: string;
  rejectedReason?: string | null;
  components?: Array<Record<string, unknown>>;
};

export type ListWhatsAppTemplatesResult = {
  channelConfigId?: string;
  count?: number;
  templates?: MetaWhatsAppTemplateRow[];
};

export type WhatsAppTemplateDetailResult = {
  channelConfigId?: string;
  template?: MetaWhatsAppTemplateRow;
};

/** List WABA templates from Meta via social-service (GET). */
export async function socialListWhatsAppTemplates(params: {
  channelConfigId: string;
  templateName?: string;
  language?: string;
  status?: string;
  returnTemplate?: boolean;
}): Promise<ListWhatsAppTemplatesResult> {
  const q = new URLSearchParams();
  q.set(
    "channelConfigId",
    assertNumericChannelConfigId(params.channelConfigId),
  );
  if (params.templateName) q.set("templateName", params.templateName);
  if (params.language) q.set("language", params.language);
  if (params.status) q.set("status", params.status);
  if (params.returnTemplate) q.set("return_template", "true");
  return socialFetch<ListWhatsAppTemplatesResult>(
    `/internal/v1/whatsapp/templates?${q.toString()}`,
    { method: "GET" },
  );
}

/** Fetch one template with full components (GET …/detail). */
export async function socialGetWhatsAppTemplateDetail(params: {
  channelConfigId: string;
  templateName?: string;
  templateId?: string;
  language?: string;
  returnTemplate?: boolean;
}): Promise<WhatsAppTemplateDetailResult> {
  const q = new URLSearchParams();
  q.set(
    "channelConfigId",
    assertNumericChannelConfigId(params.channelConfigId),
  );
  if (params.templateId) q.set("templateId", params.templateId);
  else if (params.templateName) q.set("templateName", params.templateName);
  if (params.language) q.set("language", params.language);
  if (params.returnTemplate === false) q.set("return_template", "false");
  return socialFetch<WhatsAppTemplateDetailResult>(
    `/internal/v1/whatsapp/templates/detail?${q.toString()}`,
    { method: "GET" },
  );
}

export type UploadWhatsAppMediaPayload = {
  channelConfigId: string;
  mimeType: string;
  dataBase64: string;
};

export type UploadWhatsAppMediaResult = {
  handle?: string;
  mediaHandle?: string;
  media_handle?: string;
  id?: string;
};

/** Upload image bytes to Meta via social-service (returns header media handle). */
export async function socialUploadWhatsAppMedia(
  payload: UploadWhatsAppMediaPayload,
): Promise<{ handle: string }> {
  const body = await socialFetch<UploadWhatsAppMediaResult>(
    "/internal/v1/whatsapp/media/upload",
    {
      method: "POST",
      body: JSON.stringify({
        channelConfigId: assertNumericChannelConfigId(payload.channelConfigId),
        mimeType: payload.mimeType,
        dataBase64: payload.dataBase64,
      }),
    },
  );
  const handle = String(
    body.handle || body.mediaHandle || body.media_handle || body.id || "",
  ).trim();
  if (!handle) {
    throw new AppError(
      "Meta media upload returned no handle from social-service.",
      502,
      "SOCIAL_MEDIA_NO_HANDLE",
    );
  }
  return { handle };
}

/** Map Meta template components → library header / body / footer / buttons. */
export function metaComponentsToFields(
  components: Array<Record<string, unknown>> | undefined | null,
): { header: string; body: string; footer: string; buttons: string } {
  let header = "";
  let body = "";
  let footer = "";
  const buttonLabels: string[] = [];
  for (const raw of components || []) {
    if (!raw || typeof raw !== "object") continue;
    const type = String(raw.type || "")
      .trim()
      .toUpperCase();
    if (type === "HEADER") {
      header = String(raw.text || "").trim();
    } else if (type === "BODY") {
      body = String(raw.text || "").trim();
    } else if (type === "FOOTER") {
      footer = String(raw.text || "").trim();
    } else if (type === "BUTTONS") {
      const buttons = Array.isArray(raw.buttons) ? raw.buttons : [];
      for (const b of buttons) {
        if (!b || typeof b !== "object") continue;
        const label = String(
          (b as { text?: string; title?: string }).text ||
            (b as { title?: string }).title ||
            "",
        ).trim();
        if (label) buttonLabels.push(label);
      }
    }
  }
  return {
    header,
    body,
    footer,
    buttons: buttonLabels.join("\n"),
  };
}

/** Map Meta status string → our enum. */
export function mapMetaStatusToLocal(
  status: string | undefined | null,
): "pending" | "approved" | "rejected" | "paused" | "disabled" {
  const s = String(status || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "_");
  if (s === "APPROVED" || s === "ACTIVE") return "approved";
  if (s === "REJECTED" || s === "DISAPPROVED") return "rejected";
  if (s === "PAUSED") return "paused";
  if (s === "DISABLED" || s === "DELETED") return "disabled";
  // PENDING, IN_REVIEW, SUBMITTED, etc.
  return "pending";
}
