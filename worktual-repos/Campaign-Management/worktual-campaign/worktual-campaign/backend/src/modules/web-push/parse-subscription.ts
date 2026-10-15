import { AppError } from "../../helpers/response-builders.js";

export type ParsedWebPushSubscribe = {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  contactId: string | null;
  email: string | null;
  phone: string | null;
  firstName: string | null;
  lastName: string | null;
  platform: string;
  label: string | null;
  active: boolean;
  subscribeKey: string | null;
  visitorId: string | null;
  organizationId: string | null;
  channelConfigId: string | null;
};

function readId(raw: unknown): string | null {
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return String(Math.trunc(raw));
  }
  if (typeof raw === "string" && raw.trim()) return raw.trim();
  return null;
}

export function parseWebPushSubscribeBody(
  body: Record<string, unknown>,
): ParsedWebPushSubscribe {
  const nested =
    body.subscription && typeof body.subscription === "object"
      ? (body.subscription as Record<string, unknown>)
      : null;
  const endpoint = String(body.endpoint || nested?.endpoint || "").trim();
  if (!endpoint) {
    throw new AppError("endpoint is required.", 400);
  }

  const rawKeys =
    body.keys && typeof body.keys === "object"
      ? (body.keys as Record<string, unknown>)
      : body.auth_keys && typeof body.auth_keys === "object"
        ? (body.auth_keys as Record<string, unknown>)
        : nested?.keys && typeof nested.keys === "object"
          ? (nested.keys as Record<string, unknown>)
          : {};

  return {
    endpoint,
    keys: {
      p256dh: String(rawKeys.p256dh || body.p256dh || ""),
      auth: String(rawKeys.auth || body.auth || ""),
    },
    contactId:
      typeof body.contact_id === "string"
        ? body.contact_id
        : typeof body.contactId === "string"
          ? body.contactId
          : null,
    email: typeof body.email === "string" ? body.email : null,
    phone:
      typeof body.phone === "string"
        ? body.phone
        : typeof body.mobile === "string"
          ? body.mobile
          : null,
    firstName:
      typeof body.firstName === "string"
        ? body.firstName
        : typeof body.first_name === "string"
          ? body.first_name
          : null,
    lastName:
      typeof body.lastName === "string"
        ? body.lastName
        : typeof body.last_name === "string"
          ? body.last_name
          : null,
    platform: typeof body.platform === "string" ? body.platform : "browser",
    label: typeof body.label === "string" ? body.label : null,
    active: body.active !== false,
    subscribeKey:
      typeof body.key === "string"
        ? body.key
        : typeof body.subscribe_key === "string"
          ? body.subscribe_key
          : typeof body.subscribeKey === "string"
            ? body.subscribeKey
            : null,
    visitorId:
      typeof body.visitor_id === "string"
        ? body.visitor_id
        : typeof body.visitorId === "string"
          ? body.visitorId
          : null,
    organizationId: readId(
      body.organization_id ?? body.organizationId,
    ),
    channelConfigId: readId(
      body.channel_config_id ??
        body.channelConfigId ??
        body.channelId ??
        body.channel_id,
    ),
  };
}

export function parseWebsiteVisitBody(body: Record<string, unknown>): {
  visitorId: string | null;
  path: string | null;
} {
  const visitorId =
    typeof body.visitor_id === "string"
      ? body.visitor_id
      : typeof body.visitorId === "string"
        ? body.visitorId
        : null;
  const path = typeof body.path === "string" ? body.path : null;
  return { visitorId, path };
}
