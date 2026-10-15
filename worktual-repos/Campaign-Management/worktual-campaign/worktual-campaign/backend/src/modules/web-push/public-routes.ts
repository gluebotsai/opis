import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { AppError, sendSuccess } from "../../helpers/response-builders.js";
import {
  publicWebPushSession,
  resolvePublicWebPushByOrganization,
  resolvePublicWebPushSite,
  type PublicWebPushSite,
} from "../../dao/push-config.js";
import {
  attachWebPushToMatchingContactDao,
  upsertPushEndpointDao,
} from "../../dao/push-endpoints.js";
import {
  recordWebsiteSubscribeDao,
  recordWebsiteVisitDao,
  stampWebsiteContactAudienceIdDao,
} from "../../dao/website-contacts.js";
import {
  parseWebPushSubscribeBody,
  parseWebsiteVisitBody,
} from "./parse-subscription.js";

const hits = new Map<string, number[]>();
const WINDOW_MS = 10 * 60 * 1000;
const MAX_SUBSCRIBE = 30;
const MAX_VISIT = 120;

function rateLimit(ip: string, max: number) {
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= max) {
    throw new AppError("Too many attempts. Try again later.", 429);
  }
  recent.push(now);
  hits.set(ip, recent);
}

function queryString(
  q: Record<string, unknown> | undefined,
  key: string,
): string | null {
  const v = q?.[key];
  if (typeof v === "number" && Number.isFinite(v)) return String(Math.trunc(v));
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function requestOrigin(
  request: { headers: Record<string, unknown> },
  q: Record<string, unknown>,
): string {
  const header = request.headers.origin;
  if (typeof header === "string" && header.trim()) return header.trim();
  const referer = request.headers.referer;
  if (typeof referer === "string" && referer.trim()) {
    try {
      const u = new URL(referer);
      return `${u.protocol}//${u.host}`;
    } catch {
      /* ignore */
    }
  }
  return queryString(q, "origin") || "";
}

function userAgentOf(request: { headers: Record<string, unknown> }): string {
  const ua = request.headers["user-agent"];
  return typeof ua === "string" ? ua : "";
}

function requestQuery(request: { query?: unknown }): Record<string, unknown> {
  return typeof request.query === "object" && request.query
    ? (request.query as Record<string, unknown>)
    : {};
}

async function resolveSubscribeSite(
  request: FastifyRequest,
  body: Record<string, unknown>,
): Promise<{ site: PublicWebPushSite; parsed: ReturnType<typeof parseWebPushSubscribeBody> }> {
  const parsed = parseWebPushSubscribeBody(body);
  const q = requestQuery(request);
  const key =
    parsed.subscribeKey ||
    queryString(q, "key") ||
    queryString(q, "subscribe_key");
  const origin = requestOrigin(request, q);
  const organizationId =
    parsed.organizationId ||
    queryString(q, "organization_id") ||
    queryString(q, "organizationId");
  const channelConfigId =
    parsed.channelConfigId ||
    queryString(q, "channel_config_id") ||
    queryString(q, "channelConfigId") ||
    queryString(q, "channelId");

  if (organizationId) {
    const site = await resolvePublicWebPushByOrganization({
      organizationId,
      channelConfigId,
    });
    return { site, parsed };
  }

  const site = await resolvePublicWebPushSite({
    subscribeKey: key,
    origin: origin || null,
  });
  return { site, parsed };
}

export async function handlePublicWebPushSubscribe(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const ip = request.ip || "unknown";
  rateLimit(ip, MAX_SUBSCRIBE);
  const body =
    typeof request.body === "object" && request.body
      ? (request.body as Record<string, unknown>)
      : {};
  const { site, parsed } = await resolveSubscribeSite(request, body);
  const origin = requestOrigin(request, requestQuery(request));
  const result = await recordWebsiteSubscribeDao({
    organizationId: site.organizationId,
    visitorId: parsed.visitorId,
    origin,
    path: typeof body.path === "string" ? body.path : null,
    userAgent: userAgentOf(request),
    email: parsed.email,
    phone: parsed.phone,
    firstName: parsed.firstName,
    lastName: parsed.lastName,
    endpoint: parsed.endpoint,
    keys: parsed.keys,
    platform: parsed.platform,
  });
  let audience = false;
  let contact = result.contact;
  try {
    const session = await publicWebPushSession(site.organizationId);
    await upsertPushEndpointDao(session, {
      channel: "web",
      endpoint: parsed.endpoint,
      contactId: null,
      platform: parsed.platform || "browser",
      authKeys: parsed.keys,
      label: parsed.channelConfigId
        ? `snippet:${parsed.channelConfigId}`
        : "website_subscribe",
      active: true,
    });
    const audienceId = await attachWebPushToMatchingContactDao(session, {
      email: parsed.email || contact.email,
      phone: parsed.phone || contact.phone,
      endpoint: parsed.endpoint,
      keys: parsed.keys,
      platform: parsed.platform,
    });
    if (audienceId) {
      audience = true;
      await stampWebsiteContactAudienceIdDao(contact.id, audienceId);
      contact = { ...contact, contact_id: audienceId };
    }
  } catch (err) {
    request.log.warn({ err }, "website subscribe: audience web-push attach skipped");
  }
  return sendSuccess(
    reply,
    "Website web-push opt-in saved",
    {
      created: result.created,
      audience,
      contact,
    },
    200,
  );
}

export async function handlePublicWebPushConfig(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const q = requestQuery(request);
  const key = queryString(q, "key") || queryString(q, "subscribe_key");
  const origin = requestOrigin(request, q);
  const organizationId =
    queryString(q, "organization_id") || queryString(q, "organizationId");
  const channelConfigId =
    queryString(q, "channel_config_id") ||
    queryString(q, "channelConfigId") ||
    queryString(q, "channelId");

  const site = organizationId
    ? await resolvePublicWebPushByOrganization({
        organizationId,
        channelConfigId,
      })
    : await resolvePublicWebPushSite({
        subscribeKey: key,
        origin: origin || null,
      });
  const vapid = String(site.settings.vapid_public_key || "").trim();
  if (!vapid) {
    throw new AppError(
      "Web push is not configured yet (missing VAPID public key).",
      400,
    );
  }
  return sendSuccess(reply, "Web push public config", {
    vapid_public_key: vapid,
    organization_id: site.organizationId,
    site_origin: site.settings.site_origin || "",
    default_icon_url: site.settings.default_icon_url || "",
    default_badge_url: site.settings.default_badge_url || "",
    subscribe_path: "/api/v1/push/subscribe",
    visit_path: "/api/public/web-push/visit",
  });
}

/** Visitor site: no staff JWT. Tenant resolved by org snippet and/or Origin. */
export default async function webPushPublicRoutes(server: FastifyInstance) {
  server.get("/config", handlePublicWebPushConfig);

  server.post("/visit", async (request, reply) => {
    const ip = request.ip || "unknown";
    rateLimit(ip, MAX_VISIT);
    const body =
      typeof request.body === "object" && request.body
        ? (request.body as Record<string, unknown>)
        : {};
    const parsed = parseWebsiteVisitBody(body);
    const q = requestQuery(request);
    const key = queryString(q, "key") || queryString(q, "subscribe_key");
    const origin = requestOrigin(request, q);
    const organizationId =
      queryString(q, "organization_id") || queryString(q, "organizationId");
    const site = organizationId
      ? await resolvePublicWebPushByOrganization({ organizationId })
      : await resolvePublicWebPushSite({
          subscribeKey: key,
          origin: origin || null,
        });
    const row = await recordWebsiteVisitDao({
      organizationId: site.organizationId,
      visitorId: parsed.visitorId,
      origin,
      path: parsed.path,
      userAgent: userAgentOf(request),
    });
    return sendSuccess(reply, "Website visit saved", {
      visitor_id: row.visitor_id,
      visit_count: row.visit_count,
      audience: false,
    });
  });

  server.post("/subscribe", handlePublicWebPushSubscribe);
}
